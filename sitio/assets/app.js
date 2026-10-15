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
let indiceHero = "n12";             // curva de portada: n12 o n34

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
const VISTAS = ["home", "mapa", "monitoreo", "about"];
function ir(v){
  // Enlaces compartibles: …/#mapa y …/#pacifico (el mapa abre sobre el Pacífico)
  if (v === "pacifico"){ window.vistaInicialMapa = "pacifico"; v = "mapa"; }
  if (!VISTAS.includes(v)) v = "home";
  $$(".view").forEach(e => e.classList.remove("on"));
  $("#v-" + v).classList.add("on");
  VISTAS.forEach(k => $("#nav-" + k).setAttribute("aria-current", String(k === v)));
  history.replaceState(null, "", v === "home" ? location.pathname : "#" + v);
  window.scrollTo(0, 0);
  if (v === "mapa") requestAnimationFrame(() => window.iniciarMapa?.());
  if (v === "monitoreo") pintarMonitoreo();
}

/* ════════════════════════════════════════════════════════════════════════
   MONITOREO · dashboards de series
   Los CSV del pipeline se leen tal cual (pocas decenas de KB) y se dibujan
   con un trazador de líneas genérico. Nada se calcula aquí salvo recortar
   el período y buscar el último valor.
   ════════════════════════════════════════════════════════════════════════ */
let periodoAnios = 1;
const csvCache = {};

// CSV con cabecera y primera columna de fecha -> {fechas:[], cols:{nombre:[]}}
async function traerCsv(ruta){
  if (csvCache[ruta]) return csvCache[ruta];
  try{
    let texto;
    if (window.__DATOS__){                       // archivo único: viene incrustado
      texto = window.__DATOS__[ruta]; if (!texto) return null;
    } else {
      const r = await fetch(ruta, { cache: "no-cache" });
      if (!r.ok) return null;
      texto = await r.text();
    }
    const lineas = texto.trim().split("\n");
    const cab = lineas[0].split(",").slice(1);
    const fechas = [], cols = Object.fromEntries(cab.map(c => [c, []]));
    for (const l of lineas.slice(1)){
      const p = l.split(",");
      fechas.push(p[0]);
      cab.forEach((c, i) => cols[c].push(p[i + 1] === "" || p[i + 1] === undefined ? null : +p[i + 1]));
    }
    return (csvCache[ruta] = { fechas, cols });
  }catch{ return null; }
}

// Colores de las series del monitoreo: pocos y fijos. Niño 1+2 en rojo
// (es el que gobierna la costa), 3.4 en teal, el resto en grises.
const COLORES = ["#D9452C", "#1B6A87", "#8E0F16", "#79A8B4", "#E18C3E", "#163D66", "#84959A", "#55666A", "#C9A227", "#5B8C5A", "#9B59B6"];

// Trazador genérico: series = [{n, v:[], c}], fechas alineadas, umbrales opcionales
function grafLineas(svg, fechas, series, op = {}){
  const W = 1200, H = 300, L = 44, R = 14, T = 16, B = 30;
  const vals = series.flatMap(s => s.v).filter(x => x !== null);
  if (!vals.length){ svg.innerHTML = `<text x="20" y="150" fill="#84959A" font-size="14" font-family="IBM Plex Sans">Sin datos en este período.</text>`; return; }
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (op.minRango){ lo = Math.min(lo, op.minRango[0]); hi = Math.max(hi, op.minRango[1]); }
  const m = (hi - lo) * 0.08 || 1; lo -= m; hi += m;
  const n = fechas.length;
  const x = i => L + (i / Math.max(1, n - 1)) * (W - L - R);
  const y = t => T + (1 - (t - lo) / (hi - lo)) * (H - T - B);

  // Ejes: una marca por mes en períodos cortos, por trimestre en series
  // mensuales, por año (o cada 5) en períodos largos
  let ejes = "";
  const mensual = fechas[0].length === 7;
  const corto = mensual ? n <= 48 : n < 500;
  fechas.forEach((f, i) => {
    const mes = f.slice(5, 7), dia = f.slice(8, 10);
    let esMarca;
    if (mensual) esMarca = corto ? +mes % 3 === 1 : mes === "01" && +f.slice(0, 4) % (n > 600 ? 5 : 1) === 0;
    else esMarca = corto ? dia === "01" : mes === "01" && dia === "01" && +f.slice(0, 4) % (n > 3000 ? 5 : 1) === 0;
    if (!esMarca) return;
    const et = corto ? MESES_CORTOS[+mes - 1] + (mes === "01" ? " " + f.slice(0, 4) : "") : f.slice(0, 4);
    ejes += `<line x1="${x(i)}" y1="${T}" x2="${x(i)}" y2="${H - B}" stroke="#E2E8E3"/>
             <text x="${x(i) + 3}" y="${H - 10}" fill="#84959A" font-size="11" font-family="IBM Plex Sans">${et}</text>`;
  });
  // Eje vertical: 5 marcas redondas
  let ejeY = "";
  const paso = [0.1, 0.2, 0.5, 1, 2, 5, 10].find(p => (hi - lo) / p <= 7) || 10;
  for (let t = Math.ceil(lo / paso) * paso; t <= hi; t += paso){
    ejeY += `<line x1="${L}" y1="${y(t)}" x2="${W - R}" y2="${y(t)}" stroke="${Math.abs(t) < 1e-9 ? "#9FB0AC" : "#EEF2EF"}"/>
             <text x="${L - 6}" y="${y(t) + 4}" text-anchor="end" fill="#84959A" font-size="11" font-family="IBM Plex Sans">${sg(t, paso < 1 ? 1 : 0)}</text>`;
  }
  const umbrales = (op.umbrales || []).map(([t, c]) =>
    `<line x1="${L}" y1="${y(t)}" x2="${W - R}" y2="${y(t)}" stroke="${c}" stroke-opacity=".6" stroke-dasharray="4 4"/>`).join("");

  const trazos = series.map(s => {
    let d = "", pluma = false;
    s.v.forEach((t, i) => {
      if (t === null){ pluma = false; return; }
      d += (pluma ? "L" : "M") + x(i).toFixed(1) + " " + y(t).toFixed(1); pluma = true;
    });
    const iu = s.v.findLastIndex(t => t !== null);
    const punto = iu >= 0 && s.destacar ? `<circle cx="${x(iu)}" cy="${y(s.v[iu])}" r="4" fill="${s.c}"/>` : "";
    return `<path d="${d}" fill="none" stroke="${s.c}" stroke-width="${s.destacar ? 2.4 : 1.4}" stroke-opacity="${s.destacar ? 1 : .85}" stroke-linejoin="round"/>${punto}`;
  }).join("");
  svg.innerHTML = ejeY + ejes + umbrales + trazos;
}

function leyenda(el, series){
  el.innerHTML = series.map(s => {
    const iu = s.v.findLastIndex(t => t !== null);
    return `<span><i style="background:${s.c}"></i>${esc(s.n)}${iu >= 0 ? ` <b>${sg(s.v[iu])}</b>` : ""}</span>`;
  }).join("");
}

// Recorta un conjunto de fechas/series al período elegido
function recortar(fechas, cols, anios){
  if (!anios) return { fechas, cols };
  const ult = fechas[fechas.length - 1];
  const desde = (+ult.slice(0, 4) - anios) + ult.slice(4);
  const i0 = fechas.findIndex(f => f >= desde);
  return { fechas: fechas.slice(i0), cols: Object.fromEntries(Object.entries(cols).map(([k, v]) => [k, v.slice(i0)])) };
}

async function pintarMonitoreo(){
  $$(".mon-ctl button").forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.p === periodoAnios)));
  const I = D.estado.indices || {};
  $("#mon-kpi").innerHTML = [
    ["Niño 1+2", I.n12, " °C"], ["Niño 3.4", I.n34, " °C"], ["ICEN", I.icen, ""], ["RONI", I.roni, ""],
  ].map(([n, ind, u]) => {
    const v = ind?.valor; const f = ind?.fecha;
    return `<div><dt>${n}</dt><dd ${v == null ? 'class="pend"' : ""}>${v == null ? "pendiente" : sg(v) + u}</dd>
            <small>${f ? (String(f).length > 7 ? "al " + fecha(f) : fecha(f)) : ""}${ind?.fuente ? " · " + esc(ind.fuente) : ""}</small></div>`;
  }).join("");

  // 1. OISST diario por caja Niño
  const o = await traerCsv("datos/indices/oisst_diario.csv");
  if (o){
    const r = recortar(o.fechas, o.cols, periodoAnios);
    const nom = { n12: "Niño 1+2", n3: "Niño 3", n34: "Niño 3.4", n4: "Niño 4" };
    const series = Object.keys(r.cols).map((k, i) => ({ n: nom[k] || k, v: r.cols[k], c: COLORES[i], destacar: k === "n12" || k === "n34" }));
    grafLineas($("#g-oisst"), r.fechas, series, { umbrales: [[0.5, "#D9452C"], [-0.5, "#1B6A87"]], minRango: [-2, 2] });
    leyenda($("#g-oisst-ley"), series);
    $("#g-oisst-sub").textContent = `NOAA OISST v2.1, anomalía respecto de 1991-2020, sin suavizar. Dato al ${fecha(o.fechas[o.fechas.length - 1])}. `
      + (periodoAnios === 0 ? "Solo están cargados los años análogos y el actual; el histórico completo se carga una vez." : "");
  }

  // 2. TSM costera por región
  const c = await traerCsv("datos/indices/tsm_costera_diaria.csv");
  if (c){
    const r = recortar(c.fechas, c.cols, periodoAnios);
    const orden = ["Tumbes", "Piura", "Lambayeque", "La Libertad", "Ancash", "Lima", "Callao", "Ica", "Arequipa", "Moquegua", "Tacna"];
    const series = orden.filter(k => r.cols[k]).map((k, i) => ({ n: k, v: r.cols[k], c: COLORES[i % COLORES.length], destacar: i === 0 }));
    grafLineas($("#g-costa"), r.fechas, series, { umbrales: [[0, "#9FB0AC"]] });
    leyenda($("#g-costa-ley"), series);
    $("#g-costa-sub").textContent = `Anomalía OISST promediada en la franja marina a menos de 110 km del litoral de cada departamento. Dato al ${fecha(c.fechas[c.fechas.length - 1])}.`;
  }

  // 3. Índices mensuales
  const S = D.indices;
  if (S){
    const fechas = S.fechas, cols = { icen: S.icen, oni: S.oni, roni: S.roni };
    const r = recortar(fechas, cols, periodoAnios ? Math.max(periodoAnios, 3) : 0);
    const series = [["icen", "ICEN"], ["oni", "ONI"], ["roni", "RONI"]].map(([k, n], i) =>
      ({ n, v: r.cols[k], c: COLORES[i], destacar: k === "icen" }));
    grafLineas($("#g-idx"), r.fechas, series, { umbrales: [[0.5, "#D9452C"], [-0.5, "#1B6A87"]], minRango: [-2, 2] });
    leyenda($("#g-idx-ley"), series);
    $("#g-idx-sub").textContent = `ICEN del IGP/ENFEN (Niño 1+2); ONI y RONI del NOAA CPC (Niño 3.4). Trimestres móviles. Último mes: ${fecha(S.hasta)}.`
      + (periodoAnios === 1 ? " Para los mensuales se muestran al menos 3 años." : "");
  }

  // 4. Datos abiertos
  const F = D.meta?.fuentes || {};
  const filas = [
    ["datos/indices/oisst_diario.csv", "Anomalía diaria de TSM en Niño 1+2, 3, 3.4 y 4", "NOAA OISST v2.1 (PSL)", F.oisst],
    ["datos/indices/tsm_costera_diaria.csv", "Anomalía diaria de TSM costera por región", "Calculado de OISST", F.oisst],
    ["datos/indices/icen.csv", "ICEN mensual desde 1950", "IGP / ENFEN", F.igp],
    ["datos/indices/cpc_mensual.csv", "ONI y RONI mensuales desde 1950", "NOAA CPC", F.cpc],
    ["datos/series/tsm.json", "Evento actual y análogos alineados", "Calculado de OISST", F.serie_tsm],
    ["datos/campos/tsm_anom.png", "Campo del último día (imagen georreferenciada, ver tsm_anom.json)", "NOAA OISST", F.mapa_tsm],
    ["datos/estado.json", "Alerta, probabilidades e índices vigentes", "ENFEN, IGP, CPC, OISST", F.estado],
    ["datos/_meta.json", "Estado y fecha de cada fuente", "pipeline", null],
  ];
  $("#tabla-datos").innerHTML = `<tr><th>Archivo</th><th>Contenido</th><th>Fuente</th><th>Actualizado</th></tr>` +
    filas.map(([ruta, desc, fuente, m]) => `<tr><td><a href="${ruta}" download>${ruta.split("/").pop()}</a></td>
      <td>${esc(desc)}</td><td>${esc(fuente)}</td><td>${m?.ultimo_dato ? fecha(m.ultimo_dato) : m?.actualizado ? fecha(m.actualizado) : ""}${m?.estado === "fallo" ? " ⚠" : ""}</td></tr>`).join("");
}
function setPeriodo(p){ periodoAnios = p; pintarMonitoreo(); }
window.setPeriodo = setPeriodo;
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

/* ── Historia: índice mensual desde 1950 ─────────────────────────────── */
let indiceHist = "icen";
function pintarHistoria(){
  const S = D.indices, svg = $("#hist");
  if (!S || !S[indiceHist]?.length){ $(".hist-idx").style.display = "none"; return; }
  $$(".hist-idx-ctl button").forEach(b =>
    b.setAttribute("aria-pressed", String(b.dataset.k === indiceHist)));
  const W = 1200, H = 260, PAD = 26;
  const v = S[indiceHist], n = v.length;
  const vals = v.filter(x => x !== null);
  const lo = Math.min(-3, Math.floor(Math.min(...vals))), hi = Math.max(3, Math.ceil(Math.max(...vals)));
  const x = i => (i / (n - 1)) * W;
  const y = t => H - PAD - ((t - lo) / (hi - lo)) * (H - 2 * PAD);
  // Solo se dibujan los umbrales verificados en fuente oficial; si falta
  // uno (p. ej. La Niña costera en la nota ENFEN 2024), no se inventa.
  const U = S.umbrales[indiceHist === "roni" ? "oni" : indiceHist];
  const um = U.nino?.[0]?.[1] ?? null, ul = U.nina?.[0]?.[1] ?? null;

  // Barras: cálido por encima del umbral, frío por debajo, neutro en gris
  let barras = "";
  const bw = Math.max(0.8, W / n);
  v.forEach((t, i) => {
    if (t === null) return;
    const col = (um !== null && t >= um) ? escala(t, -1, 3, false) : (ul !== null && t <= ul) ? escala(t, -3, 1, false) : "#C9D2CC";
    const y0 = y(0), y1 = y(t);
    barras += `<rect x="${x(i).toFixed(1)}" y="${Math.min(y0, y1).toFixed(1)}" width="${bw.toFixed(2)}" height="${Math.abs(y1 - y0).toFixed(1)}" fill="${col}"/>`;
  });
  // Décadas en el eje
  let ejes = "";
  S.fechas.forEach((f, i) => {
    if (f.endsWith("-01") && f.slice(0, 4) % 10 === 0)
      ejes += `<line x1="${x(i)}" y1="${PAD}" x2="${x(i)}" y2="${H - PAD}" stroke="#E2E8E3"/>
               <text x="${x(i) + 3}" y="${H - 8}" fill="#84959A" font-size="11" font-family="IBM Plex Sans">${f.slice(0, 4)}</text>`;
  });
  const ult = vals[vals.length - 1];
  svg.innerHTML = `${ejes}
    ${um === null ? "" : `<rect x="0" y="${y(um)}" width="${W}" height="${y(0) - y(um)}" fill="#D9452C" fill-opacity=".06"/>
    <line x1="0" y1="${y(um)}" x2="${W}" y2="${y(um)}" stroke="#D9452C" stroke-opacity=".5" stroke-dasharray="4 4"/>`}
    ${ul === null ? "" : `<rect x="0" y="${y(0)}" width="${W}" height="${y(ul) - y(0)}" fill="#1B6A87" fill-opacity=".06"/>
    <line x1="0" y1="${y(ul)}" x2="${W}" y2="${y(ul)}" stroke="#1B6A87" stroke-opacity=".5" stroke-dasharray="4 4"/>`}
    <line x1="0" y1="${y(0)}" x2="${W}" y2="${y(0)}" stroke="#C9D2CC"/>
    ${barras}
    <text x="${W - 6}" y="${y(ult) - 8}" text-anchor="end" fill="#101A1D" font-size="16" font-family="IBM Plex Serif">${sg(ult)}</text>`;
  const nombres = { icen: "ICEN", oni: "ONI", roni: "RONI" };
  const iPrim = v.findIndex(t => t !== null), iUlt = v.findLastIndex(t => t !== null);
  $("#hist-ejes").textContent = `${nombres[indiceHist]} de ${fecha(S.fechas[iPrim])} a ${fecha(S.fechas[iUlt])} · ${S.fuentes[indiceHist]} · `
    + (um !== null ? `${U.nino[0][0]} desde ${sg(um)}` : "") + (ul !== null ? `, ${U.nina[0][0]} desde ${sg(ul)}` : "")
    + ` (${U.fuente}). Eje de ${sg(lo, 0)} a ${sg(hi, 0)}.`;
}
function setIndiceHist(k){ indiceHist = k; pintarHistoria(); }
window.setIndiceHist = setIndiceHist;

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
  // Con día: "al 10 oct 2026". Solo mes (índices trimestrales): "(jul 2026)".
  const f = ind?.fecha;
  $("#f-" + id).textContent = !f ? (falta ? "sin conectar todavía" : "")
    : String(f).length > 7 ? "al " + fecha(f) : `(${fecha(f)})`;
}

function pintarPortada(){
  const e = D.estado, I = e.indices || {};
  kpi("icen", I.icen, "");
  kpi("roni", I.roni, "");
  kpi("n12", I.n12, " °C");
  kpi("n34", I.n34, " °C");
  // El ONI clásico acompaña al RONI como dato secundario
  $("#k-oni").textContent = I.oni?.valor === null || I.oni?.valor === undefined ? ""
    : `ONI clásico: ${sg(I.oni.valor)} (${fecha(I.oni.fecha)}).`;
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
// Dirección de una imagen: en el archivo único viene incrustada como data URI
const recurso = ruta => window.__DATOS__?.[ruta] ?? ruta;

async function iniciar(){
  try{
    const [estado, config, regiones, geo, serie, plantillas, meta, campo, indices] = await Promise.all([
      traer("datos/estado.json"),
      traer("datos/config.json"),
      traer("datos/regiones.json"),
      traer("datos/geo/departamentos.json"),
      traerOpcional("datos/series/tsm.json"),
      traer("datos/analisis/_plantillas.json"),
      traerOpcional("datos/_meta.json"),
      traerOpcional("datos/campos/tsm_anom.json"),
      traerOpcional("datos/series/indices.json"),
    ]);
    D = { estado, config, regiones, geo, serie, plantillas, meta, campo, indices };
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

  // Cada parte se pinta por separado: si una falla, las demás siguen.
  for (const f of [pintarPortada, pintarHero, pintarHistoria, pintarFrescura]){
    try { f(); } catch (e) { console.error(f.name, e); }
  }
  if (location.hash) ir(location.hash.slice(1));
}

iniciar();
