/* ════════════════════════════════════════════════════════════════════════
   ENSO PERÚ · app.js
   ════════════════════════════════════════════════════════════════════════

   PRINCIPIO: el navegador no calcula nada. Solo lee archivos que el pipeline
   ya dejó preparados en data/. Por eso la página es gratuita de operar,
   instantánea, y no se cae aunque entren miles de personas a la vez.

   ARCHIVOS QUE LEE
   ----------------
     data/estado.json                   estado ENSO actual y probabilidades
     data/config.json                   capas, meses y sectores disponibles
     data/regiones.json                 zonificación y valores por región
     data/geo/departamentos.json        geometrías pre-proyectadas
     data/series/sst.json               serie diaria de anomalía de TSM
     data/analisis/_plantillas.json     textos de respaldo (demo)
     data/analisis/<region>/<mes>.json  texto real generado por el pipeline

   CÓMO ENCHUFAR DATOS REALES
   --------------------------
   No hay que tocar este archivo. Basta con sobrescribir los JSON de data/.
   Para los análisis, el orden de prioridad es:

     1. Si existe data/analisis/<region>/<mes>.json  →  se usa ese
     2. Si no existe                                →  se usa la plantilla

   Así el Equipo 1 puede ir publicando región por región sin romper nada.
   Hay un ejemplo real en data/analisis/tumbes/2027-02.json.
   ════════════════════════════════════════════════════════════════════════ */

const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

/* Estado de la aplicación */
let D = {};                         // todos los datos cargados
let capa = "tsm", mes = "now", scope = "peru", sel = null, sector = "pesca";
const cacheAnalisis = {};           // análisis reales ya descargados

/* ── Proyección Mercator, idéntica a pipeline/build_geo.py ──────────────
   Permite dibujar en el mismo sistema elementos que no vienen del GeoJSON:
   la retícula de paralelos y meridianos, y los recuadros de las regiones Niño. */
const PJ = { LON0: -176, SCALE: 22 };
const mercY = lat => (180 / Math.PI) *
  Math.log(Math.tan(Math.PI / 4 + (Math.max(-84, Math.min(84, lat)) * Math.PI) / 360));
PJ.Y0 = mercY(14);
const px = lon => (lon - PJ.LON0) * PJ.SCALE;
const py = lat => (PJ.Y0 - mercY(lat)) * PJ.SCALE;

const gradoLat = v => v === 0 ? "0°" : Math.abs(v) + "°" + (v < 0 ? "S" : "N");
const gradoLon = v => Math.abs(v) + "°" + (v < 0 ? "W" : "E");

/* Identificador de carpeta a partir del nombre de región.
   "Madre De Dios" → "madre-de-dios" */
const slug = n => n.toLowerCase()
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/\s+/g, "-");

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

/* ════════════════════════════════════════════════════════════════════════
   NAVEGACIÓN
   ════════════════════════════════════════════════════════════════════════ */
function ir(v){
  $$(".view").forEach(e => e.classList.remove("on"));
  $("#v-" + v).classList.add("on");
  ["home", "mapa", "about"].forEach(k =>
    $("#nav-" + k).setAttribute("aria-current", String(k === v)));
  window.scrollTo(0, 0);
  if (v === "mapa") requestAnimationFrame(dibujarMapa);
}
window.ir = ir;

/* ════════════════════════════════════════════════════════════════════════
   PORTADA
   ════════════════════════════════════════════════════════════════════════ */
function pintarHero(){
  const svg = $("#hero"), W = 1200, H = 240;
  const s = D.serie.valores;
  const lo = -1, hi = Math.max(3.4, Math.max(...s) + 0.4);
  const y = v => H - 26 - ((v - lo) / (hi - lo)) * (H - 56);
  const x = i => (i / (s.length - 1)) * W;

  // El trazo se colorea con la propia escala de anomalías, según su valor.
  let stops = "";
  for (let p = 0; p <= 100; p += 4){
    const v = s[Math.round((p / 100) * (s.length - 1))];
    stops += `<stop offset="${p}%" stop-color="${escala(v, -1, 3, false)}"/>`;
  }

  let d = `M0 ${y(s[0]).toFixed(1)}`;
  s.forEach((v, i) => { if (i) d += `L${x(i).toFixed(1)} ${y(v).toFixed(1)}`; });
  const y0 = y(0), last = s[s.length - 1];

  svg.innerHTML = `
    <defs>
      <linearGradient id="g" x1="0" x2="1">${stops}</linearGradient>
      <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stop-color="#D9452C" stop-opacity=".16"/>
        <stop offset="100%" stop-color="#D9452C" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <path d="${d}L${W} ${H} L0 ${H} Z" fill="url(#fade)"/>
    <line x1="0" y1="${y0}" x2="${W}" y2="${y0}" stroke="#C9D2CC" stroke-width="1"/>
    <text x="8" y="${y0 - 7}" fill="#84959A" font-size="11" font-family="IBM Plex Sans">normal</text>
    <path id="heroline" d="${d}" fill="none" stroke="url(#g)" stroke-width="2.6"
          stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${W}" cy="${y(last)}" r="5" fill="#D9452C"/>
    <circle cx="${W}" cy="${y(last)}" r="11" fill="none" stroke="#D9452C" stroke-opacity=".3"/>
    <text x="${W - 14}" y="${y(last) - 18}" text-anchor="end" fill="#101A1D"
          font-size="19" font-family="IBM Plex Serif">+${last.toFixed(1)} °C</text>`;

  // Único movimiento no provocado por el usuario en toda la página:
  // la curva se traza una vez al cargar.
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches){
    const ln = $("#heroline"), L = ln.getTotalLength();
    ln.style.strokeDasharray = L;
    ln.style.strokeDashoffset = L;
    ln.animate([{ strokeDashoffset: L }, { strokeDashoffset: 0 }],
      { duration: 1500, easing: "cubic-bezier(.3,.8,.3,1)", fill: "forwards" });
  }
}

function pintarPortada(){
  const e = D.estado, sg = v => (v > 0 ? "+" : "") + v.toFixed(1);
  $("#k-icen").textContent = sg(e.icen);
  $("#k-roni").textContent = sg(e.roni);
  $("#k-n12").textContent  = sg(e.n12) + " °C";
  $("#k-n34").textContent  = sg(e.n34) + " °C";

  $("#ribbon").innerHTML = e.estados.map(x =>
    `<div ${x === e.alerta ? "data-on" : ""}>${x}</div>`).join("");

  $("#probs").innerHTML = e.probs.map(p => `
    <div class="prob-row">
      <span>${p.m}</span>
      <span class="prob-bar"><i style="width:${p.p * 2.2}%;background:${p.c}"></i></span>
      <b>${p.p} %</b>
    </div>`).join("");

  $("#bulletins").innerHTML = e.comunicados.map(c =>
    `<div class="bul"><time>${c.f}</time><p>${c.t}</p></div>`).join("");
}

/* ════════════════════════════════════════════════════════════════════════
   MAPA
   ════════════════════════════════════════════════════════════════════════ */

// Valor de una región para la capa y el mes activos.
function valor(nombre, cp, ms){
  const r = D.regiones.regiones[nombre];
  if (!r) return null;
  const base = r.b[cp];
  if (base === null || base === undefined) return null;
  return base * (D.regiones.modificadorMes[ms] ?? 1);
}

function fmt(v, cp){
  if (v === null) return "sin dato";
  const c = D.config.capas[cp];
  return (v > 0 ? "+" : "") +
    (Math.abs(v) < 10 ? v.toFixed(1) : Math.round(v)) +
    (c.u ? " " + c.u : "");
}

// Retícula de paralelos y meridianos. No es decoración: ubica al usuario
// y hace explícita la escala del mapa, como en una carta náutica.
function reticula(vb){
  const p = scope === "peru"
    ? { lat: 5,  lon: 5,  lat0: 0,  lat1: -20, lon0: -80,  lon1: -68 }
    : { lat: 10, lon: 20, lat0: 10, lat1: -20, lon0: -170, lon1: -70 };
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
    return `<path class="dep" d="${d.d}" fill="${f}" data-n="${d.n}"
             ${sel === d.n ? 'data-sel="1"' : ""} tabindex="0" role="button"
             aria-label="${d.n}"></path>`;
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
  t.innerHTML = `<b>${n}</b><span>${D.config.capas[capa].n}: ${fmt(valor(n, capa, mes), capa)}</span>`;
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
  $("#leg-title").textContent = c.n;
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
  try{
    const r = await fetch(`data/analisis/${k}.json`);
    cacheAnalisis[k] = r.ok ? await r.json() : null;
  }catch{
    cacheAnalisis[k] = null;
  }
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
    .replace(/{r}/g, n)
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
  const col = v === null ? "var(--fog-dim)" : escala(v, c.lo, c.hi, c.invertida);
  return `<div><dt>${rot}</dt><dd style="color:${col}">${fmt(v, cp)}</dd></div>`;
}

function pintarPanel(){
  const n = sel, r = D.regiones.regiones[n];
  const m = D.config.meses.find(x => x.id === mes);
  const disp = sectoresDe(r.z);
  const real = cacheAnalisis[slug(n) + "/" + mes];
  const parr = (real?.sectores?.[sector]) || textoPlantilla(n, mes, sector);
  const ant  = real?.antecedentes || D.plantillas.antecedentes[r.z] || "Sin antecedentes documentados.";

  $("#panel").innerHTML = `
    <div class="grab"></div>

    <div class="p-head">
      <h2>${n}</h2>
      <div class="zone">${r.z}${r.c ? " · con litoral" : ""}</div>
      <div class="p-when">${mes === "now"
        ? `Condición <b>observada</b>, actualizada el ${D.estado.actualizado}`
        : `Escenario para <b>${m.n} ${m.s}</b>, según pronóstico estacional`}</div>
    </div>

    <dl class="reads">
      ${r.b.tsm !== null ? lectura("Temperatura del mar", valor(n, "tsm", mes), "tsm") : ""}
      ${lectura("Precipitación", valor(n, "lluvia", mes), "lluvia")}
      ${lectura("Sequía (SPI-6)", valor(n, "sequia", mes), "sequia")}
      ${lectura("Caudal de ríos", valor(n, "rios", mes), "rios")}
    </dl>

    <div class="tabs" role="tablist">
      ${disp.map(s => `<button role="tab" data-s="${s.id}"
        aria-selected="${s.id === sector}">${s.n}</button>`).join("")}
    </div>

    <div class="body">
      <span class="ai ${real ? "real" : ""}"><i></i>${real
        ? `Generado con IA el ${(real.generado || "").slice(0, 10)}`
        : "Texto de demostración"}</span>
      ${parr.map(p => `<p>${p}</p>`).join("") || "<p>Sin análisis disponible para este sector.</p>"}

      <div class="hist">
        <h3>Antecedentes</h3>
        <p>${ant}</p>
      </div>

      <div class="src">${real?.fuentes || D.plantillas.fuentes}</div>
    </div>`;

  $("#panel").querySelectorAll('[role="tab"]').forEach(b =>
    b.addEventListener("click", () => { sector = b.dataset.s; pintarPanel(); }));
}

/* ════════════════════════════════════════════════════════════════════════
   ARRANQUE
   ════════════════════════════════════════════════════════════════════════ */
async function traer(ruta){
  const r = await fetch(ruta);
  if (!r.ok) throw new Error(`No se pudo leer ${ruta} (${r.status})`);
  return r.json();
}

async function iniciar(){
  try{
    const [estado, config, regiones, geo, serie, plantillas] = await Promise.all([
      traer("data/estado.json"),
      traer("data/config.json"),
      traer("data/regiones.json"),
      traer("data/geo/departamentos.json"),
      traer("data/series/sst.json"),
      traer("data/analisis/_plantillas.json")
    ]);
    D = { estado, config, regiones, geo, serie, plantillas };
  }catch(err){
    document.body.innerHTML =
      `<div style="padding:60px 24px;max-width:600px;margin:0 auto;font-family:system-ui">
         <h1 style="font-size:24px;margin-bottom:12px">No se pudieron cargar los datos</h1>
         <p style="color:#55666A;line-height:1.6">${err.message}</p>
         <p style="color:#55666A;line-height:1.6;margin-top:14px">
           Si abriste el archivo con doble click, el navegador bloquea la lectura
           de archivos locales. Levanta un servidor con
           <code>python3 -m http.server 8000</code> y entra a
           <code>http://localhost:8000</code>.</p>
       </div>`;
    return;
  }

  capa = Object.keys(D.config.capas)[0];
  mes  = D.config.meses[0].id;

  $("#layers").innerHTML = Object.entries(D.config.capas).map(([k, c]) =>
    `<button class="layer" data-k="${k}" aria-pressed="${k === capa}"
       onclick="setCapa('${k}')"><i></i>${c.n}</button>`).join("");

  $("#months").innerHTML = D.config.meses.map(m =>
    `<button data-m="${m.id}" aria-pressed="${m.id === mes}" onclick="setMes('${m.id}')">
       ${m.n}<small>${m.s}</small></button>`).join("");

  pintarPortada();
  pintarHero();
  pintarLeyenda();
}

iniciar();
