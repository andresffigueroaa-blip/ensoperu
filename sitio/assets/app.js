/* ════════════════════════════════════════════════════════════════════════
   ENSO PERÚ · app.js
   ════════════════════════════════════════════════════════════════════════

   PRINCIPIO: el navegador no calcula nada. Solo lee archivos que el pipeline
   ya dejó preparados en datos/. Por eso la página es gratuita de operar,
   instantánea, y no se cae aunque entren miles de personas a la vez.

   ARCHIVOS QUE LEE (todos los escribe pipeline/run.py; ver README)
   ----------------
     datos/_meta.json                   fecha y estado de cada fuente
     datos/estado.json                  alerta ENFEN, índices, probabilidades
     datos/config.json                  capas, meses y sectores
     datos/regiones.json                zonificación y valor por capa y mes
     datos/geo/departamentos.json       geometrías pre-proyectadas
     datos/series/tsm.json              evento actual y análogos (OISST)
     datos/analisis/_plantillas.json    textos de respaldo por zona
     datos/analisis/<region>/<mes>.json texto generado por el pipeline

   Prioridad de los análisis:
     1. Si existe datos/analisis/<region>/<mes>.json  →  se usa ese
     2. Si no existe                                 →  se usa la plantilla

   REGLA: todo texto que viene de un JSON pasa por esc() antes de entrar al
   HTML. Los análisis los redacta una IA y no se confía en su formato.
   ════════════════════════════════════════════════════════════════════════ */

const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

/* Estado de la aplicación */
let D = {};                         // todos los datos cargados
let capa = "tsm", mes = "now", scope = "peru", sel = null, sector = "pesca";
let indiceHero = "n12";             // curva de portada: n12 o n34
const cacheAnalisis = {};           // análisis reales ya descargados

/* ── Utilidades de texto ─────────────────────────────────────────────── */
const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
// "2026-09-29" → "29 sep 2026". Se arma a mano para no depender del huso horario.
function fecha(iso){
  if (!iso) return "";
  const [a, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  if (!m) return String(iso);
  return (d ? d + " " : "") + MESES_CORTOS[m - 1] + " " + a;
}
// Número con signo y coma decimal: +5,1 · −0,4
const sg = (v, dec = 1) => v === null || v === undefined || Number.isNaN(v) ? null
  : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(dec).replace(".", ",");

/* ── Proyección Mercator, idéntica a pipeline/herramientas/build_geo.py ─
   Permite dibujar en el mismo sistema elementos que no vienen del GeoJSON:
   la retícula de paralelos y meridianos. Las longitudes son continuas:
   160°E se escribe -200 para que el Pacífico no se parta en dos. */
const PJ = { LON0: -176, SCALE: 22 };
const mercY = lat => (180 / Math.PI) *
  Math.log(Math.tan(Math.PI / 4 + (Math.max(-84, Math.min(84, lat)) * Math.PI) / 360));
PJ.Y0 = mercY(14);
const px = lon => (lon - PJ.LON0) * PJ.SCALE;
const py = lat => (PJ.Y0 - mercY(lat)) * PJ.SCALE;

const gradoLat = v => v === 0 ? "0°" : Math.abs(v) + "°" + (v < 0 ? "S" : "N");
function gradoLon(v){
  const w = ((v + 540) % 360) - 180;           // lleva -200 a 160
  if (w === 0) return "0°";
  if (Math.abs(w) === 180) return "180°";
  return Math.abs(w) + "°" + (w < 0 ? "W" : "E");
}

/* Identificador de carpeta a partir del nombre de región.
   "Madre De Dios" → "madre-de-dios" */
const slug = n => n.toLowerCase()
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/\s+/g, "-");

const nombreRegion = n => D.regiones.regiones[n]?.nombre || n;

/* ════════════════════════════════════════════════════════════════════════
   ESCALA DE ANOMALÍAS
   Azul profundo → teal de Humboldt → neutro → rojo de anomalía extrema.
   Único lugar del sistema donde se usan azules y rojos.
   ════════════════════════════════════════════════════════════════════════ */
const PARADAS = [
  [0.00, [ 22,  61, 102]], [0.18, [ 27, 106, 135]], [0.36, [121, 168, 180]],
  [0.50, [222, 226, 220]], [0.62, [240, 193, 120]], [0.76, [225, 140,  62]],
  [0.88, [217,  69,  44]], [1.00, [142,  15,  22]]
];

function escala(v, lo, hi, invertida){
  let t = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
  if (invertida) t = 1 - t;
  for (let i = 0; i < PARADAS.length - 1; i++){
    const [p0, c0] = PARADAS[i], [p1, c1] = PARADAS[i + 1];
    if (t >= p0 && t <= p1){
      const k = (t - p0) / (p1 - p0);
      const c = c0.map((x, j) => Math.round(x + (c1[j] - x) * k));
      return `rgb(${c[0]},${c[1]},${c[2]})`;
    }
  }
  return "rgb(142,15,22)";
}

/* Colores de las magnitudes del ENFEN. Son decisión de diseño, no dato:
   por eso viven aquí y no en estado.json. Siguen la mitad cálida de la escala. */
const COLOR_MAGNITUD = { "Débil": "#E9C46A", "Moderado": "#E2913C", "Fuerte": "#D9452C", "Extraordinario": "#8E0F16" };

/* ════════════════════════════════════════════════════════════════════════
   NAVEGACIÓN
   ════════════════════════════════════════════════════════════════════════ */
const VISTAS = ["home", "mapa", "about"];
function ir(v){
  if (!VISTAS.includes(v)) v = "home";
  $$(".view").forEach(e => e.classList.remove("on"));
  $("#v-" + v).classList.add("on");
  VISTAS.forEach(k => $("#nav-" + k).setAttribute("aria-current", String(k === v)));
  // La vista queda en la dirección (…/#mapa) para poder compartir el enlace
  history.replaceState(null, "", v === "home" ? location.pathname : "#" + v);
  window.scrollTo(0, 0);
  if (v === "mapa") requestAnimationFrame(dibujarMapa);
}
window.ir = ir;

/* ════════════════════════════════════════════════════════════════════════
   PORTADA · curva del evento actual contra sus análogos
   ════════════════════════════════════════════════════════════════════════ */
const DIAS_VISTA = 730;      // de julio del año previo a junio del siguiente

function pintarHero(){
  const svg = $("#hero"), W = 1200, H = 240;
  const S = D.serie;
  const eventos = (S?.eventos || []).filter(e => e[indiceHero]?.some(v => v !== null));
  const actual = eventos.find(e => e.actual);

  $$("#hero-idx button").forEach(b =>
    b.setAttribute("aria-pressed", String(b.dataset.k === indiceHero)));

  if (!actual){
    svg.innerHTML = `<text x="20" y="${H / 2}" fill="#84959A" font-size="14"
      font-family="IBM Plex Sans">Sin datos de temperatura del mar todavía.</text>`;
    $("#band-estado").textContent = "sin datos";
    return;
  }
  $("#band-estado").textContent = "dato al " + fecha(S.ultimo_dato);
  const otros = eventos.filter(e => !e.actual).map(e => e.id);
  $("#band-analogos").textContent = `Media móvil centrada de ${S.suavizado_dias} días`
    + (otros.length ? ". En gris, años análogos: " + otros.join(", ") : "");

  const tramo = e => e[indiceHero].slice(0, DIAS_VISTA);
  const todos = eventos.flatMap(e => tramo(e)).filter(v => v !== null);
  const lo = Math.min(-1.5, Math.floor(Math.min(...todos))), hi = Math.max(3, Math.ceil(Math.max(...todos) + 0.3));
  const y = v => H - 30 - ((v - lo) / (hi - lo)) * (H - 66);
  const x = i => (i / (DIAS_VISTA - 1)) * W;

  const trazo = s => {
    let d = "", pluma = false;
    s.forEach((v, i) => {
      if (v === null){ pluma = false; return; }
      d += (pluma ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1);
      pluma = true;
    });
    return d;
  };

  // Análogos: gris fino, con su nombre junto al pico. El color queda
  // reservado para el evento actual, que es el que importa.
  const etiquetas = [];
  const analogos = eventos.filter(e => !e.actual).map(e => {
    const s = tramo(e);
    let im = s.findIndex(v => v !== null);
    s.forEach((v, i) => { if (v !== null && v > s[im]) im = i; });
    etiquetas.push({ x: Math.min(W - 30, Math.max(30, x(im))), y: y(s[im]) - 6, t: e.id });
    return `<path d="${trazo(s)}" fill="none" stroke="#B7C2BD" stroke-width="1.2"/>`;
  }).join("");
  // Si dos etiquetas caen encima una de otra, la segunda sube una línea
  etiquetas.sort((a, b) => a.y - b.y).forEach((a, i) => {
    for (const b of etiquetas.slice(0, i))
      if (Math.abs(a.x - b.x) < 56 && Math.abs(a.y - b.y) < 13) a.y = b.y - 13;
  });
  const textosAnalogos = etiquetas.map(a =>
    `<text x="${a.x.toFixed(1)}" y="${Math.max(12, a.y).toFixed(1)}" text-anchor="middle"
       fill="#97A6A2" font-size="11" font-family="IBM Plex Sans">${esc(a.t)}</text>`).join("");

  // Meses de referencia en el eje: enero y julio de cada año del evento
  const a0 = actual.anio - 1;
  const marcas = [[0, "jul " + a0], [184, "ene " + (a0 + 1)], [365, "jul " + (a0 + 1)], [549, "ene " + (a0 + 2)]]
    .map(([i, t]) => `<line x1="${x(i)}" y1="${H - 24}" x2="${x(i)}" y2="${H - 18}" stroke="#C9D2CC"/>
      <text x="${x(i) + 4}" y="${H - 8}" fill="#84959A" font-size="11" font-family="IBM Plex Sans">${t}</text>`).join("");

  // El trazo actual se colorea con la propia escala de anomalías, según su valor.
  const s = tramo(actual);
  const n = s.length, iu = s.findLastIndex(v => v !== null);
  let stops = "";
  for (let p = 0; p <= 100; p += 4){
    const v = s[Math.round((p / 100) * (n - 1))];
    if (v !== null) stops += `<stop offset="${p}%" stop-color="${escala(v, -1, 3, false)}"/>`;
  }
  const last = s[iu], xu = x(iu), yu = y(last);
  const y0 = y(0), dA = trazo(s);
  const derecha = xu > W - 160;      // si el punto está muy a la derecha, la cifra va a la izquierda

  svg.innerHTML = `
    <defs>
      <linearGradient id="g" gradientUnits="userSpaceOnUse" x1="0" x2="${x(n - 1)}">${stops}</linearGradient>
    </defs>
    <line x1="0" y1="${y0}" x2="${W}" y2="${y0}" stroke="#C9D2CC" stroke-width="1"/>
    <text x="8" y="${y0 - 7}" fill="#84959A" font-size="11" font-family="IBM Plex Sans">normal</text>
    ${marcas}
    ${analogos}
    ${textosAnalogos}
    <path id="heroline" d="${dA}" fill="none" stroke="url(#g)" stroke-width="2.8"
          stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${xu}" cy="${yu}" r="5" fill="${escala(last, -1, 3, false)}"/>
    <circle cx="${xu}" cy="${yu}" r="11" fill="none" stroke="${escala(last, -1, 3, false)}" stroke-opacity=".35"/>
    <text x="${derecha ? xu - 16 : xu + 16}" y="${yu + 6}" text-anchor="${derecha ? "end" : "start"}"
          fill="#101A1D" font-size="19" font-family="IBM Plex Serif">${sg(last)} °C</text>`;

  // Único movimiento no provocado por el usuario: la curva se traza al cargar.
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches){
    const ln = $("#heroline"), L = ln.getTotalLength();
    ln.style.strokeDasharray = L;
    ln.style.strokeDashoffset = L;
    ln.animate([{ strokeDashoffset: L }, { strokeDashoffset: 0 }],
      { duration: 1500, easing: "cubic-bezier(.3,.8,.3,1)", fill: "forwards" });
  }
}
function setIndiceHero(k){ indiceHero = k; pintarHero(); }
window.setIndiceHero = setIndiceHero;

// El titular se deduce del dato, nunca se escribe a mano.
function titular(n12){
  if (n12 === null || n12 === undefined) return "Monitoreo del mar frente al Perú y de sus impactos.";
  if (n12 >= 0.5)  return `El mar frente al Perú está <i>más caliente de lo normal</i>.`;
  if (n12 <= -0.5) return `El mar frente al Perú está <i>más frío de lo normal</i>.`;
  return `El mar frente al Perú está <i>cerca de lo normal</i>.`;
}

function kpi(id, ind, unidad){
  const v = ind?.valor, falta = v === null || v === undefined;
  $("#k-" + id).textContent = falta ? "pendiente" : sg(v) + (unidad || "");
  $("#k-" + id).classList.toggle("pend", falta);
  $("#f-" + id).textContent = ind?.fecha ? "al " + fecha(ind.fecha) : falta ? "sin conectar todavía" : "";
}

function pintarPortada(){
  const e = D.estado, I = e.indices || {};
  kpi("icen", I.icen, "");
  kpi("roni", I.roni, "");
  kpi("n12", I.n12, " °C");
  kpi("n34", I.n34, " °C");
  $("#titular").innerHTML = titular(I.n12?.valor);

  $("#ribbon").innerHTML = e.alerta.estados.map(x =>
    `<div ${x === e.alerta.estado ? "data-on" : ""}>${esc(x)}</div>`).join("");
  $("#alerta-fuente").textContent = e.alerta.fuente + (e.alerta.fecha ? ", " + fecha(e.alerta.fecha) : "");

  const P = e.probabilidades;
  $("#probs-titulo").textContent = `Qué tan fuerte sería el ${P.periodo || "próximo verano"}`;
  $("#probs-sub").textContent = `Probabilidad por magnitud en la región ${P.region || "Niño 1+2"}. ${P.fuente}.`;
  const pmax = Math.max(...P.valores.map(p => p.p || 0), 1);
  $("#probs").innerHTML = P.valores.map(p => `
    <div class="prob-row">
      <span>${esc(p.magnitud)}</span>
      <span class="prob-bar"><i style="width:${(p.p / pmax) * 100}%;background:${COLOR_MAGNITUD[p.magnitud] || "#84959A"}"></i></span>
      <b>${p.p} %</b>
    </div>`).join("");

  $("#bulletins").innerHTML = e.comunicados.map(c =>
    `<div class="bul"><time>${fecha(c.fecha)}</time><p>${esc(c.texto)}</p></div>`).join("");
}

/* Estado de los datos: qué tan fresco está cada dato. Si la última
   actualización falló, se dice, y se muestra la fecha del último dato bueno. */
const NOMBRE_FUENTE = {
  oisst:  "Temperatura del mar · NOAA OISST",
  estado: "Alerta y probabilidades · ENFEN (ingreso manual)",
};
function pintarFrescura(){
  const F = D.meta?.fuentes || {};
  $("#frescura").innerHTML = Object.entries(NOMBRE_FUENTE).filter(([k]) => F[k]).map(([k, nom]) => {
    const f = F[k], fallo = f.estado === "fallo";
    const dato = f.ultimo_dato ? "dato al " + fecha(f.ultimo_dato)
      : k === "estado" && D.estado.alerta.fecha ? "comunicado del " + fecha(D.estado.alerta.fecha)
      : "revisado el " + fecha(f.actualizado);
    return `<li ${fallo ? 'class="falla"' : ""}><span>${esc(nom)}</span>
      <span>${esc(dato)}${fallo ? " · la última actualización falló; se muestra el último dato bueno" : ""}</span></li>`;
  }).join("") + (D.meta?.generado ? `<li><span>Última corrida del pipeline</span><span>${fecha(D.meta.generado)}</span></li>` : "");
}

/* ════════════════════════════════════════════════════════════════════════
   MAPA
   ════════════════════════════════════════════════════════════════════════ */

// Valor de una región para la capa y el mes activos (null si no hay dato).
function valor(nombre, cp, ms){
  const v = D.regiones.regiones[nombre]?.v?.[cp]?.[ms];
  return v === undefined ? null : v;
}

function fmt(v, cp){
  if (v === null) return "sin dato";
  const c = D.config.capas[cp];
  return sg(v, Math.abs(v) < 10 ? 1 : 0) + (c.u ? " " + c.u : "");
}

// Retícula de paralelos y meridianos. No es decoración: ubica al usuario
// y hace explícita la escala del mapa, como en una carta náutica.
function reticula(vb){
  const p = scope === "peru"
    ? { lat: 5,  lon: 5,  lat0: 0,  lat1: -20, lon0: -80,  lon1: -68 }
    : { lat: 10, lon: 20, lat0: 10, lat1: -20, lon0: -200, lon1: -70 };
  const fs = (vb[2] / 92).toFixed(1);
  let g = "";
  for (let la = p.lat0; la >= p.lat1; la -= p.lat){
    const y = py(la);
    if (y < vb[1] || y > vb[1] + vb[3]) continue;
    g += `<line class="grat" x1="${vb[0]}" y1="${y.toFixed(1)}" x2="${vb[0] + vb[2]}" y2="${y.toFixed(1)}"/>`
      +  `<text class="gratlab" x="${(vb[0] + vb[2] * .008).toFixed(1)}" y="${(y - vb[2] * .006).toFixed(1)}" font-size="${fs}">${gradoLat(la)}</text>`;
  }
  for (let lo = p.lon0; lo <= p.lon1; lo += p.lon){
    const x = px(lo);
    if (x < vb[0] || x > vb[0] + vb[2]) continue;
    g += `<line class="grat" x1="${x.toFixed(1)}" y1="${vb[1]}" x2="${x.toFixed(1)}" y2="${vb[1] + vb[3]}"/>`
      +  `<text class="gratlab" x="${(x + vb[2] * .006).toFixed(1)}" y="${(vb[1] + vb[2] * .02).toFixed(1)}" font-size="${fs}">${gradoLon(lo)}</text>`;
  }
  return g;
}

function dibujarMapa(){
  const svg = $("#map");
  const G   = D.geo;
  const vb  = scope === "peru" ? G.viewPeru : G.viewPac;
  svg.setAttribute("viewBox", vb.join(" "));

  const c  = D.config.capas[capa];
  const fs = (vb[2] / 92).toFixed(1);

  const deps = G.deps.map(d => {
    const v = valor(d.n, capa, mes);
    const f = v === null ? "var(--stage-3)" : escala(v, c.lo, c.hi, c.invertida);
    // style y no el atributo fill: la regla .dep del CSS le ganaría al atributo
    return `<path class="dep" d="${d.d}" style="fill:${f}" data-n="${esc(d.n)}"
             ${sel === d.n ? 'data-sel="1"' : ""} tabindex="0" role="button"
             aria-label="${esc(nombreRegion(d.n))}"></path>`;
  }).join("");

  // Recuadros de las regiones Niño. En la vista Perú solo la 1+2, que es
  // la que gobierna El Niño costero.
  const cajas = (scope === "pac"
    ? [["nino4", "Niño 4"], ["nino34", "Niño 3.4"], ["nino3", "Niño 3"], ["nino12", "Niño 1+2"]]
    : [["nino12", "Niño 1+2"]]
  ).map(([k, lab]) => {
    const b = G[k], on = (k === "nino12" || k === "nino34");
    return `<rect class="nbox ${on ? "nbox-on" : ""}" x="${b[0]}" y="${b[1]}"
              width="${b[2]}" height="${b[3]}" rx="2"/>
            <text class="nlab" x="${b[0] + vb[2] * .012}" y="${b[1] + vb[2] * .032}"
              font-size="${fs}" fill="${on ? "#D9452C" : "#8CA2A8"}">${lab}</text>`;
  }).join("");

  svg.innerHTML = reticula(vb) + cajas + deps;

  svg.querySelectorAll(".dep").forEach(p => {
    p.addEventListener("click", () => elegir(p.dataset.n));
    p.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " "){ e.preventDefault(); elegir(p.dataset.n); }
    });
    p.addEventListener("pointerenter", e => mostrarTip(e, p.dataset.n));
    p.addEventListener("pointermove",  e => moverTip(e));
    p.addEventListener("pointerleave", () => $("#tip").style.opacity = 0);
  });

  pintarLeyenda();
}

function mostrarTip(e, n){
  const t = $("#tip");
  t.innerHTML = `<b>${esc(nombreRegion(n))}</b><span>${esc(D.config.capas[capa].n)}: ${fmt(valor(n, capa, mes), capa)}</span>`;
  t.style.opacity = 1;
  moverTip(e);
}
function moverTip(e){
  const r = $("#stage").getBoundingClientRect(), t = $("#tip");
  t.style.left = (e.clientX - r.left) + "px";
  t.style.top  = (e.clientY - r.top)  + "px";
}

function pintarLeyenda(){
  const c = D.config.capas[capa];
  $("#leg-title").innerHTML = esc(c.n) + (c.demo ? ' <span class="demo">demo</span>' : "");
  $("#legend").innerHTML = Array.from({ length: 28 }, (_, i) => {
    const v = c.lo + (i / 27) * (c.hi - c.lo);
    return `<i style="background:${escala(v, c.lo, c.hi, c.invertida)}"></i>`;
  }).join("");
  $("#leg-lo").textContent = c.loTx;
  $("#leg-hi").textContent = c.hiTx;
}

function setCapa(k){
  capa = k;
  $$("#layers .layer").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.k === k)));
  dibujarMapa();
  if (sel) pintarPanel();
}
function setScope(s){
  scope = s;
  $("#sc-peru").setAttribute("aria-pressed", String(s === "peru"));
  $("#sc-pac").setAttribute("aria-pressed",  String(s === "pac"));
  dibujarMapa();
}
async function setMes(m){
  mes = m;
  $$("#months button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.m === m)));
  dibujarMapa();
  if (sel) { await cargarAnalisis(sel, mes); pintarPanel(); }
}
window.setCapa = setCapa; window.setScope = setScope; window.setMes = setMes;

/* ════════════════════════════════════════════════════════════════════════
   PANEL DE REGIÓN
   ════════════════════════════════════════════════════════════════════════ */

// Intenta traer el análisis real que publicó el pipeline. Si aún no existe
// para esa región y ese mes, se queda sin nada y se usa la plantilla.
async function cargarAnalisis(n, ms){
  const k = slug(n) + "/" + ms;
  if (k in cacheAnalisis) return cacheAnalisis[k];
  cacheAnalisis[k] = await traerOpcional(`datos/analisis/${k}.json`);
  return cacheAnalisis[k];
}

function sectoresDe(zona){
  const g = D.plantillas.guiones[zona] || {};
  return D.config.sectores.filter(s => g[s.id]);
}

// Texto de respaldo, construido con las plantillas por zona.
// En cuanto exista el JSON real de esa región y mes, este camino no se usa.
function textoPlantilla(n, ms, sc){
  const r = D.regiones.regiones[n];
  if (!r) return [];
  const g = (D.plantillas.guiones[r.z] || {})[sc] || [];
  return g.map(t => t
    .replace(/{r}/g, r.nombre || n)
    .replace(/{tsm}/g,    fmt(valor(n, "tsm", ms), "tsm"))
    .replace(/{lluvia}/g, fmt(valor(n, "lluvia", ms), "lluvia"))
    .replace(/{rios}/g,   fmt(valor(n, "rios", ms), "rios")));
}

async function elegir(n){
  sel = n;
  const zona = D.regiones.regiones[n]?.z || "";
  const disp = sectoresDe(zona);
  if (!disp.find(s => s.id === sector)) sector = disp[0]?.id;
  dibujarMapa();
  $("#panel").classList.add("up");
  await cargarAnalisis(n, mes);
  pintarPanel();
}

function lectura(rot, v, cp){
  const c = D.config.capas[cp];
  if (!c) return "";
  const col = v === null ? "var(--fog-dim)" : escala(v, c.lo, c.hi, c.invertida);
  return `<div><dt>${esc(rot)}${c.demo ? ' <span class="demo">demo</span>' : ""}</dt>
          <dd style="color:${col}">${fmt(v, cp)}</dd></div>`;
}

function pintarPanel(){
  const n = sel, r = D.regiones.regiones[n];
  const m = D.config.meses.find(x => x.id === mes);
  const disp = sectoresDe(r.z);
  const real = cacheAnalisis[slug(n) + "/" + mes];
  const parr = (real?.sectores?.[sector]) || textoPlantilla(n, mes, sector);
  const ant  = real?.antecedentes || D.plantillas.antecedentes[r.z] || "Sin antecedentes documentados.";
  const marca = !real ? "Texto de demostración"
    : real.demo ? "Ejemplo del formato, no es un análisis real"
    : `Generado con IA el ${fecha(real.generado)}`;

  $("#panel").innerHTML = `
    <div class="grab"></div>

    <div class="p-head">
      <h2>${esc(r.nombre || n)}</h2>
      <div class="zone">${esc(r.z)}${r.c ? " · con litoral" : ""}</div>
      <div class="p-when">${mes === "now"
        ? `Condición <b>observada</b>`
        : `Escenario para <b>${esc(m.n)} ${esc(m.s)}</b>, según pronóstico estacional`}</div>
    </div>

    <dl class="reads">
      ${r.c ? lectura("Temperatura del mar", valor(n, "tsm", mes), "tsm") : ""}
      ${lectura("Precipitación", valor(n, "lluvia", mes), "lluvia")}
      ${lectura("Sequía (SPI-6)", valor(n, "sequia", mes), "sequia")}
      ${lectura("Caudal de ríos", valor(n, "rios", mes), "rios")}
    </dl>

    <div class="tabs" role="tablist">
      ${disp.map(s => `<button role="tab" data-s="${esc(s.id)}"
        aria-selected="${s.id === sector}">${esc(s.n)}</button>`).join("")}
    </div>

    <div class="body">
      <span class="ai ${real && !real.demo ? "real" : ""}"><i></i>${marca}</span>
      ${parr.map(p => `<p>${esc(p)}</p>`).join("") || "<p>Sin análisis disponible para este sector.</p>"}

      <div class="hist">
        <h3>Antecedentes</h3>
        <p>${esc(ant)}</p>
      </div>

      <div class="src">${esc(real?.fuentes || D.plantillas.fuentes)}</div>
    </div>`;

  $("#panel").querySelectorAll('[role="tab"]').forEach(b =>
    b.addEventListener("click", () => { sector = b.dataset.s; pintarPanel(); }));
}

/* ════════════════════════════════════════════════════════════════════════
   ARRANQUE
   ════════════════════════════════════════════════════════════════════════ */

// pipeline/herramientas/bundle.py incrusta todos los JSON en
// window.__DATOS__ para que la página funcione sin servidor.
async function traer(ruta){
  if (window.__DATOS__){
    if (ruta in window.__DATOS__) return window.__DATOS__[ruta];
    throw new Error(`No se pudo leer ${ruta}`);
  }
  const r = await fetch(ruta, { cache: "no-cache" });
  if (!r.ok) throw new Error(`No se pudo leer ${ruta} (${r.status})`);
  return r.json();
}
// Para archivos que pueden no existir (análisis por región, metadatos)
async function traerOpcional(ruta){
  try { return await traer(ruta); } catch { return null; }
}

async function iniciar(){
  try{
    const [estado, config, regiones, geo, serie, plantillas, meta] = await Promise.all([
      traer("datos/estado.json"),
      traer("datos/config.json"),
      traer("datos/regiones.json"),
      traer("datos/geo/departamentos.json"),
      traerOpcional("datos/series/tsm.json"),
      traer("datos/analisis/_plantillas.json"),
      traerOpcional("datos/_meta.json"),
    ]);
    D = { estado, config, regiones, geo, serie, plantillas, meta };
  }catch(err){
    document.body.innerHTML =
      `<div style="padding:60px 24px;max-width:600px;margin:0 auto;font-family:system-ui">
         <h1 style="font-size:24px;margin-bottom:12px">No se pudieron cargar los datos</h1>
         <p style="color:#55666A;line-height:1.6">${esc(err.message)}</p>
         <p style="color:#55666A;line-height:1.6;margin-top:14px">
           Si abriste el archivo con doble click, el navegador bloquea la lectura
           de archivos locales. Levanta un servidor con
           <code>python pipeline/servir.py</code> y entra a
           <code>http://localhost:8000</code>.</p>
       </div>`;
    return;
  }

  capa = Object.keys(D.config.capas)[0];
  mes  = D.config.meses[0].id;

  $("#layers").innerHTML = Object.entries(D.config.capas).map(([k, c]) =>
    `<button class="layer" data-k="${esc(k)}" aria-pressed="${k === capa}"
       onclick="setCapa('${esc(k)}')"><i></i>${esc(c.n)}</button>`).join("");

  $("#months").innerHTML = D.config.meses.map(m =>
    `<button data-m="${esc(m.id)}" aria-pressed="${m.id === mes}" onclick="setMes('${esc(m.id)}')">
       ${esc(m.n)}<small>${esc(m.s)}</small></button>`).join("");

  // Cada parte se pinta por separado: si una falla, las demás siguen.
  for (const f of [pintarPortada, pintarHero, pintarFrescura, pintarLeyenda]){
    try { f(); } catch (e) { console.error(f.name, e); }
  }
  if (location.hash) ir(location.hash.slice(1));
}

iniciar();
