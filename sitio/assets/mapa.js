/* ════════════════════════════════════════════════════════════════════════
   ENSO PERÚ · mapa.js
   Mapa interactivo (MapLibre GL) y ficha de lugar.

   Qué dibuja, de abajo hacia arriba:
     mapa base oscuro (OpenFreeMap) · relieve sombreado (AWS Terrain) ·
     campo de anomalía de TSM (imagen del pipeline) · coropletas por región,
     provincia o distrito · focos de calor (NASA FIRMS) · lugares con ícono
     (presas, embalses, lagunas, glaciares; OpenStreetMap)

   El navegador no calcula nada: cada valor viene de un archivo de
   sitio/datos/ y se cruza por el código INEI de la unidad (2 dígitos
   región, 4 provincia, 6 distrito).

   Todo texto que viene de datos pasa por esc() antes de entrar al HTML.
   ════════════════════════════════════════════════════════════════════════ */

const M = {                    // estado del mapa
  mapa: null, listo: false,
  capa: "tsm", nivel: "region", tema: null,
  lugares: { presa: true, embalse: true, laguna: false, glaciar: true },
  incendios: true,
  sel: null,                   // id INEI de la unidad elegida
  datos: {},                   // unidades, incendios, lluvia, estudios, lugares…
};

const CAPAS_MAPA = {
  ninguna:  { n: "Solo mapa", niveles: [] },
  tsm:      { n: "Temperatura del mar", u: "°C", lo: -2, hi: 4, tipo: "divergente", niveles: ["region"],
              fuente: "NOAA OISST, franja marina a menos de 110 km del litoral, media de 7 días" },
  lluvia:   { n: "Lluvia próximos 16 días", u: "mm", lo: 0, hi: 200, tipo: "secuencial-azul", niveles: ["region", "provincia"],
              fuente: "Open-Meteo (combinación de modelos globales). No es un aviso oficial: para alertas, SENAMHI" },
  incendios:{ n: "Focos de calor 7 días", u: "focos", lo: 0, hi: 60, tipo: "secuencial-naranja", niveles: ["region", "provincia", "distrito"],
              fuente: "NASA FIRMS, satélite VIIRS. Un foco no siempre es un incendio forestal" },
};
const NIVELES = [["region", "Regiones"], ["provincia", "Provincias"], ["distrito", "Distritos"]];

// Temas: una combinación de capa, nivel, lugares y encuadre para cada pregunta
const TEMAS = {
  mar:       { n: "Mar y pesca",           capa: "tsm",      nivel: "region",    lugares: {},
               caja: [[-84, -18.5], [-70, -1]], texto: "El mar frente a la costa, su anomalía y lo que mira la pesca." },
  lluvias:   { n: "Lluvias e inundaciones", capa: "lluvia",   nivel: "provincia", lugares: { presa: true, embalse: true },
               caja: [[-81.5, -9], [-74, -3]], texto: "Lluvia pronosticada a 16 días, presas y embalses de la costa y sierra norte." },
  incendios: { n: "Sequía e incendios",    capa: "incendios", nivel: "distrito", lugares: {},
               caja: [[-76, -17], [-68.5, -11]], texto: "Focos de calor de los últimos 7 días en el sur andino, donde El Niño trae déficit de lluvia." },
  glaciares: { n: "Agua y glaciares",      capa: "ninguna",  nivel: "provincia", lugares: { glaciar: true, laguna: true, embalse: true },
               caja: [[-78.5, -10.5], [-76.5, -8.5]], texto: "Glaciares, lagunas y embalses de la Cordillera Blanca y el resto de los Andes." },
};

const COLOR_INCENDIO = "#F28C28";

/* ── Colores (mismas reglas que app.js: divergente solo para anomalías) ── */
const RAMPA_AZUL = ["#DCEBF7", "#9EC5F4", "#5598E7", "#2A78D6", "#1C5CAB", "#104281"];
const RAMPA_NARANJA = ["#FCE3CF", "#F7B27E", "#EF8A3F", "#D96A1B", "#A8460C", "#6E2A05"];

function colorCapa(c, v){
  if (v === null || v === undefined) return null;
  if (c.tipo === "secuencial-naranja" && v === 0) return null;   // sin focos: sin color
  if (c.tipo === "divergente") return escala(v, c.lo, c.hi, false);
  const r = c.tipo === "secuencial-azul" ? RAMPA_AZUL : RAMPA_NARANJA;
  const t = Math.max(0, Math.min(1, (v - c.lo) / (c.hi - c.lo)));
  return r[Math.min(r.length - 1, Math.floor(t * r.length))];
}

/* ── Datos ──────────────────────────────────────────────────────────────── */
async function cargarDatosMapa(){
  const [unidades, incendios, lluvia, estudios, lugares, focos] = await Promise.all([
    traer("datos/geo/unidades.json"),
    traerOpcional("datos/unidades/incendios.json"),
    traerOpcional("datos/unidades/lluvia_16d.json"),
    traerOpcional("datos/estudios.json"),
    traerOpcional("datos/geo/lugares.geojson"),
    traerOpcional("datos/campos/incendios.geojson"),
  ]);
  M.datos = { incendios, lluvia, estudios, lugares, focos };
  M.datos.porId = Object.fromEntries(unidades.unidades.map(u => [u.id, u]));
  M.datos.unidades = unidades.unidades;
  // región: código de 2 dígitos -> clave de regiones.json ("Madre De Dios")
  M.datos.claveRegion = Object.fromEntries(unidades.unidades.filter(u => u.nivel === "region").map(u => [u.id, u.clave]));
}

// Valor de una unidad para la capa activa (null si no hay dato)
function valorUnidad(id, capa = M.capa){
  const d = M.datos;
  if (capa === "tsm"){
    const r = D.regiones.regiones[d.claveRegion[id]];
    return r?.v?.tsm?.now ?? null;
  }
  if (capa === "lluvia") return d.lluvia?.valores?.[id]?.total ?? null;
  if (capa === "incendios") return d.incendios?.valores?.[id]?.focos ?? 0;
  return null;
}

/* ── Mapa ───────────────────────────────────────────────────────────────── */
async function iniciarMapa(){
  if (M.mapa){ M.mapa.resize(); return; }
  await cargarDatosMapa();
  llenarBuscador();
  pintarControles();

  const mapa = new maplibregl.Map({
    container: "mapa",
    style: "https://tiles.openfreemap.org/styles/dark",
    center: [-75.3, -9.6], zoom: 4.4, minZoom: 3.2, maxZoom: 12,
    attributionControl: false,
  });
  M.mapa = mapa;
  mapa.on("error", e => { console.error("mapa:", e.error?.message || e); });
  mapa.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  mapa.addControl(new maplibregl.AttributionControl({ compact: true,
    customAttribution: "Datos: NOAA, NASA FIRMS, Open-Meteo, IGP, ENFEN · Lugares: © colaboradores de OpenStreetMap · Límites: INEI" }));

  mapa.on("load", async () => {
    const estilo = mapa.getStyle();
    const primerSimbolo = estilo.layers.find(l => l.type === "symbol")?.id;

    // Etiquetas del mapa base en español cuando OpenStreetMap las tiene
    for (const l of estilo.layers){
      if (l.type === "symbol" && l.layout?.["text-field"])
        mapa.setLayoutProperty(l.id, "text-field", ["coalesce", ["get", "name:es"], ["get", "name:latin"], ["get", "name"]]);
    }

    // Relieve sombreado, sutil, debajo de las etiquetas
    mapa.addSource("relieve", { type: "raster-dem", tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
      encoding: "terrarium", tileSize: 256, maxzoom: 13 });
    mapa.addLayer({ id: "relieve", type: "hillshade", source: "relieve",
      paint: { "hillshade-exaggeration": 0.35, "hillshade-shadow-color": "#0B1217", "hillshade-highlight-color": "#3C5661", "hillshade-accent-color": "#16222A" } }, primerSimbolo);

    // Campo de anomalía de TSM (imagen georreferenciada del pipeline)
    if (D.campo?.lonlat_ml){
      const [W, S, E, N] = D.campo.lonlat_ml;
      mapa.addSource("tsm", { type: "image", url: recurso("datos/campos/" + D.campo.archivo_ml),
        coordinates: [[W, N], [E, N], [E, S], [W, S]] });
      mapa.addLayer({ id: "tsm", type: "raster", source: "tsm", paint: { "raster-opacity": 0.85, "raster-resampling": "linear" } }, primerSimbolo);
    }

    // Unidades: una fuente por nivel, valores por feature-state
    for (const [nivel] of NIVELES){
      mapa.addSource(nivel, { type: "geojson", data: `datos/geo/${nivel === "region" ? "regiones" : nivel + "s"}.geojson`, promoteId: "id" });
      mapa.addLayer({ id: `${nivel}-relleno`, type: "fill", source: nivel, layout: { visibility: "none" },
        paint: { "fill-color": ["coalesce", ["feature-state", "color"], "rgba(0,0,0,0)"],
                 "fill-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.85, 0.62] } }, primerSimbolo);
      mapa.addLayer({ id: `${nivel}-borde`, type: "line", source: nivel, layout: { visibility: "none" },
        paint: { "line-color": ["case", ["boolean", ["feature-state", "sel"], false], "#FFFFFF",
                                ["boolean", ["feature-state", "hover"], false], "#E7EDEC", "#5A7178"],
                 "line-width": ["case", ["boolean", ["feature-state", "sel"], false], 2.4,
                                ["boolean", ["feature-state", "hover"], false], 1.6, nivel === "distrito" ? 0.4 : 0.8] } }, primerSimbolo);
      let encima = null;
      mapa.on("mousemove", `${nivel}-relleno`, e => {
        const f = e.features[0]; if (!f) return;
        if (encima !== null && encima !== f.id) mapa.setFeatureState({ source: nivel, id: encima }, { hover: false });
        encima = f.id; mapa.setFeatureState({ source: nivel, id: f.id }, { hover: true });
        mapa.getCanvas().style.cursor = "pointer";
        tipMapa(e.point, f.properties.nombre, valorUnidad(f.id));
      });
      mapa.on("mouseleave", `${nivel}-relleno`, () => {
        if (encima !== null) mapa.setFeatureState({ source: nivel, id: encima }, { hover: false });
        encima = null; mapa.getCanvas().style.cursor = ""; $("#tip").style.opacity = 0;
      });
      mapa.on("click", `${nivel}-relleno`, e => { const f = e.features[0]; if (f) elegirUnidad(f.id); });
    }

    // Focos de calor: de lejos, un resplandor (mapa de calor); de cerca, cada foco
    if (M.datos.focos){
      mapa.addSource("focos", { type: "geojson", data: M.datos.focos });
      mapa.addLayer({ id: "focos-halo", type: "heatmap", source: "focos", maxzoom: 8,
        paint: { "heatmap-weight": ["interpolate", ["linear"], ["get", "frp"], 0, 0.3, 30, 1],
                 "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 3, 0.6, 8, 1.6],
                 "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 3, 6, 8, 22],
                 "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 3, 0.7, 6.5, 0.75, 8, 0],
                 "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"],
                   0, "rgba(242,140,40,0)", 0.25, "rgba(242,140,40,.45)", 0.6, "rgba(239,106,27,.8)", 1, "rgba(255,221,150,.95)"] } });
      mapa.addLayer({ id: "focos", type: "circle", source: "focos", minzoom: 6,
        paint: { "circle-color": COLOR_INCENDIO, "circle-stroke-color": "#16222A", "circle-stroke-width": 0.8,
                 "circle-opacity": ["interpolate", ["linear"], ["zoom"], 6, 0, 7.5, 0.9],
                 "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, ["interpolate", ["linear"], ["get", "frp"], 1, 2, 50, 5],
                                   11, ["interpolate", ["linear"], ["get", "frp"], 1, 4, 50, 12]] } });
      mapa.on("mousemove", "focos", e => { const p = e.features[0].properties;
        tipMapa(e.point, "Foco de calor", null, `${fecha(p.fecha)} ${p.hora.slice(0, 2)}:${p.hora.slice(2)} UTC · potencia ${p.frp} MW`); });
      mapa.on("mouseleave", "focos", () => $("#tip").style.opacity = 0);
    }

    // Lugares con ícono
    if (M.datos.lugares){
      for (const k of Object.keys(ICONOS)) mapa.addImage("ic-" + k, await imagenIcono(k), { pixelRatio: 2 });
      mapa.addSource("lugares", { type: "geojson", data: M.datos.lugares });
      // Los lugares aparecen al acercarse (de lejos solo estorban; la ficha los cuenta)
      mapa.addLayer({ id: "lugares", type: "symbol", source: "lugares", minzoom: 5.8,
        layout: { "icon-image": ["concat", "ic-", ["get", "tipo"]], "icon-size": ["interpolate", ["linear"], ["zoom"], 5.8, 0.55, 9, 1],
                  "icon-allow-overlap": false, "icon-padding": 1,
                  "text-field": ["step", ["zoom"], "", 8, ["get", "nombre"]], "text-font": ["Noto Sans Regular"],
                  "text-size": 11, "text-offset": [0, 1.2], "text-anchor": "top", "text-optional": true },
        paint: { "text-color": "#E7EDEC", "text-halo-color": "#16222A", "text-halo-width": 1.2 } });
      mapa.on("mousemove", "lugares", e => { const p = e.features[0].properties;
        tipMapa(e.point, p.nombre || ICONOS[p.tipo].nombre, null, ICONOS[p.tipo].nombre + (p.altitud ? ` · ${p.altitud} m` : "")); });
      mapa.on("mouseleave", "lugares", () => $("#tip").style.opacity = 0);
      mapa.on("click", "lugares", e => { const p = e.features[0].properties; if (p.distrito) elegirUnidad(p.distrito, p); });
    }

    M.listo = true;
    document.body.dataset.mapaListo = "1";      // marca para pruebas automáticas
    aplicarCapa(); aplicarLugares();
    if (window.vistaInicialMapa === "pacifico"){ mapa.fitBounds([[-150, -22], [-66, 12]], { padding: 20 }); window.vistaInicialMapa = null; }
  });
}
window.iniciarMapa = iniciarMapa;

function tipMapa(pt, titulo, v, detalle){
  const t = $("#tip"), c = CAPAS_MAPA[M.capa];
  const val = v === null || v === undefined ? (detalle ? "" : "sin dato") : sg(v, Math.abs(v) < 10 ? 1 : 0) + " " + c.u;
  t.innerHTML = `<b>${esc(titulo)}</b><span>${esc(detalle || (c.n ? c.n + ": " : "") + val)}</span>`;
  t.style.left = pt.x + "px"; t.style.top = pt.y + "px"; t.style.opacity = 1;
}

/* ── Capas y niveles ────────────────────────────────────────────────────── */
function aplicarCapa(){
  if (!M.listo) return;
  const c = CAPAS_MAPA[M.capa];
  if (c.niveles.length && !c.niveles.includes(M.nivel)) M.nivel = c.niveles[c.niveles.length - 1];
  for (const [nivel] of NIVELES){
    const on = M.capa !== "ninguna" && nivel === M.nivel;
    M.mapa.setLayoutProperty(`${nivel}-relleno`, "visibility", on ? "visible" : "none");
    M.mapa.setLayoutProperty(`${nivel}-borde`, "visibility", on || (M.capa === "ninguna" && nivel === M.nivel) ? "visible" : "none");
    if (on){
      for (const u of M.datos.unidades.filter(u => u.nivel === nivel))
        M.mapa.setFeatureState({ source: nivel, id: u.id }, { color: colorCapa(c, valorUnidad(u.id)) });
    }
  }
  if (M.mapa.getLayer("tsm")) M.mapa.setLayoutProperty("tsm", "visibility", M.capa === "tsm" ? "visible" : "none");
  if (M.mapa.getLayer("focos")){
    const vis = M.incendios || M.capa === "incendios" ? "visible" : "none";
    M.mapa.setLayoutProperty("focos", "visibility", vis); M.mapa.setLayoutProperty("focos-halo", "visibility", vis);
  }
  pintarControles(); pintarLeyendaMapa();
}

function aplicarLugares(){
  if (!M.listo || !M.mapa.getLayer("lugares")) return;
  const activos = Object.entries(M.lugares).filter(([, v]) => v).map(([k]) => k);
  M.mapa.setFilter("lugares", ["in", ["get", "tipo"], ["literal", activos]]);
  M.mapa.setLayoutProperty("lugares", "visibility", activos.length ? "visible" : "none");
  pintarControles();
}

function setCapaMapa(k){ M.capa = k; M.tema = null; aplicarCapa(); }
function setNivel(n){ M.nivel = n; M.tema = null; aplicarCapa(); }
function toggleLugar(k){ M.lugares[k] = !M.lugares[k]; aplicarLugares(); }
function toggleIncendios(){ M.incendios = !M.incendios; aplicarCapa(); }
function setTema(k){
  const t = TEMAS[k]; M.tema = k; M.capa = t.capa; M.nivel = t.nivel;
  for (const l of Object.keys(M.lugares)) M.lugares[l] = !!t.lugares[l];
  M.incendios = k === "incendios";
  aplicarCapa(); aplicarLugares();
  M.mapa.fitBounds(t.caja, { padding: 30, duration: 1200 });
  $("#mapa-aviso").textContent = t.texto;
}
Object.assign(window, { setCapaMapa, setNivel, toggleLugar, toggleIncendios, setTema });

function pintarControles(){
  $("#temas").innerHTML = Object.entries(TEMAS).map(([k, t]) =>
    `<button data-k="${k}" aria-pressed="${M.tema === k}" onclick="setTema('${k}')">${esc(t.n)}</button>`).join("");
  $("#capas").innerHTML = Object.entries(CAPAS_MAPA).map(([k, c]) =>
    `<button class="layer" aria-pressed="${M.capa === k}" onclick="setCapaMapa('${k}')"><i></i>${esc(c.n)}</button>`).join("");
  const niv = CAPAS_MAPA[M.capa].niveles.length ? CAPAS_MAPA[M.capa].niveles : NIVELES.map(n => n[0]);
  $("#niveles").innerHTML = NIVELES.map(([k, n]) =>
    `<button aria-pressed="${M.nivel === k}" ${niv.includes(k) ? "" : "disabled"} onclick="setNivel('${k}')">${n}</button>`).join("");
  $("#lugares-ctl").innerHTML = Object.keys(ICONOS).map(k =>
    `<button class="layer" aria-pressed="${M.lugares[k]}" onclick="toggleLugar('${k}')">${iconoHTML(k, 16)}${ICONOS[k].nombre}s</button>`).join("")
    + `<button class="layer" aria-pressed="${M.incendios}" onclick="toggleIncendios()"><span class="foco"></span>Focos de calor</button>`;
}

function pintarLeyendaMapa(){
  const c = CAPAS_MAPA[M.capa];
  if (M.capa === "ninguna"){ $("#leg-title").textContent = "Lugares"; $("#legend").innerHTML = ""; $("#leg-lo").textContent = ""; $("#leg-hi").textContent = "";
    $("#leg-src").textContent = "Presas, embalses, lagunas y glaciares de OpenStreetMap; focos de calor de NASA FIRMS."; return; }
  $("#leg-title").textContent = c.n;
  $("#legend").innerHTML = Array.from({ length: 24 }, (_, i) => `<i style="background:${colorCapa(c, c.lo + (i / 23) * (c.hi - c.lo))}"></i>`).join("");
  $("#leg-lo").textContent = `${sg(c.lo, 0)} ${c.u}`; $("#leg-hi").textContent = `${sg(c.hi, 0)}+ ${c.u}`;
  const f = { tsm: D.meta?.fuentes?.oisst, lluvia: D.meta?.fuentes?.openmeteo, incendios: D.meta?.fuentes?.firms }[M.capa];
  const cuando = M.capa === "lluvia" && M.datos.lluvia ? `del ${fecha(M.datos.lluvia.desde)} al ${fecha(M.datos.lluvia.hasta)}`
    : f?.ultimo_dato ? "dato al " + fecha(f.ultimo_dato) : "";
  $("#leg-src").textContent = `${c.fuente}. ${cuando}${f?.estado === "fallo" ? " · ⚠ la última actualización falló" : ""}`;
}

/* ── Buscador ───────────────────────────────────────────────────────────── */
function llenarBuscador(){
  const dl = $("#lista-unidades");
  dl.innerHTML = M.datos.unidades.map(u => {
    const ctx = u.nivel === "distrito" ? `${u.provincia_nombre}, ${u.region_nombre}` : u.nivel === "provincia" ? u.region_nombre : "región";
    return `<option value="${esc(u.nombre)} (${esc(ctx)})" data-id="${u.id}">`;
  }).join("");
  const inp = $("#buscar");
  inp.addEventListener("change", () => {
    const op = [...dl.options].find(o => o.value === inp.value);
    if (op){ elegirUnidad(op.dataset.id); inp.blur(); }
  });
}

/* ── Ficha de lugar ─────────────────────────────────────────────────────── */
function elegirUnidad(id, lugar = null){
  const u = M.datos.porId[id]; if (!u) return;
  if (M.sel) for (const [n] of NIVELES) M.mapa.removeFeatureState({ source: n, id: M.sel }, "sel");
  M.sel = id;
  M.mapa.setFeatureState({ source: u.nivel, id }, { sel: true });
  if (u.nivel !== M.nivel){ M.nivel = u.nivel; aplicarCapa(); }
  M.mapa.fitBounds([[u.caja[0], u.caja[1]], [u.caja[2], u.caja[3]]], { padding: 60, maxZoom: 10, duration: 900 });
  pintarFicha(u, lugar);
  $("#panel").classList.add("up");
}
window.elegirUnidad = elegirUnidad;

function nivelAtencion(clave, v){
  const a = M.datos.estudios?.atencion?.[clave]; if (!a || v === null || v === undefined) return null;
  const i = a.cortes.filter(c => v >= c).length;
  const nombres = ["Bajo", "Medio", "Alto", "Muy alto"], clases = ["bajo", "medio", "alto", "muyalto"];
  return { n: nombres[i], clase: clases[i], regla: a.regla, nombre: a.nombre };
}

function chipAtencion(na){
  if (!na) return `<span class="chip sin">Sin dato</span>`;
  return `<span class="chip ${na.clase}" title="${esc(na.regla)}">● ${na.n}</span>`;
}

function barrasLluvia(serie, fechas){
  const max = Math.max(20, ...serie), W = 320, H = 70;
  const bw = W / serie.length;
  return `<svg viewBox="0 0 ${W} ${H + 16}" class="mini">
    ${serie.map((v, i) => { const h = (v / max) * H; const fuerte = v >= 20;
      return `<rect x="${(i * bw + 1).toFixed(1)}" y="${(H - h).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${fuerte ? "#1C5CAB" : "#86B6EF"}"><title>${fecha(fechas[i])}: ${sg(v, 0)} mm</title></rect>`; }).join("")}
    <line x1="0" y1="${H - (20 / max) * H}" x2="${W}" y2="${H - (20 / max) * H}" stroke="#D9452C" stroke-opacity=".5" stroke-dasharray="3 3"/>
    <text x="2" y="${H + 12}" fill="#84959A" font-size="10" font-family="IBM Plex Sans">${fecha(fechas[0])}</text>
    <text x="${W - 2}" y="${H + 12}" text-anchor="end" fill="#84959A" font-size="10" font-family="IBM Plex Sans">${fecha(fechas[fechas.length - 1])}</text>
  </svg>`;
}

function pintarFicha(u, lugar){
  const d = M.datos, e = D.estado;
  const pref = u.id;
  const miga = u.nivel === "distrito" ? `${esc(u.provincia_nombre)} · ${esc(u.region_nombre)}` : u.nivel === "provincia" ? esc(u.region_nombre) : "Región";
  const escalaNota = { region: "Datos a escala de región.", provincia: "Lluvia e incendios a escala de provincia; el mar y el ENFEN, a escala de región.",
    distrito: "Incendios y lugares a escala de distrito; la lluvia, de su provincia; el mar y el ENFEN, de su región." }[u.nivel];

  // Ahora
  const reg = u.nivel === "region" ? u : d.porId[u.region];
  const rj = D.regiones.regiones[d.claveRegion[reg.id]];
  const tsm = rj?.c ? rj.v?.tsm?.now ?? null : null;
  const inc = d.incendios?.valores?.[pref]?.focos ?? 0;
  const idLluvia = u.nivel === "distrito" ? u.provincia : u.id;
  const ll = d.lluvia?.valores?.[idLluvia];
  const naMar = rj?.c ? nivelAtencion("mar", tsm) : null;
  const naInc = nivelAtencion("incendios", inc);
  const naLl = ll ? nivelAtencion("lluvia", ll.dias_fuertes) : null;

  // Lugares dentro de la unidad
  const dentro = (d.lugares?.features || []).filter(f => f.properties.distrito.startsWith(pref));
  const porTipo = {}; dentro.forEach(f => (porTipo[f.properties.tipo] = (porTipo[f.properties.tipo] || 0) + 1));
  const conNombre = dentro.filter(f => f.properties.nombre).slice(0, 8);

  // Estudios que tocan este lugar
  const claves = new Set(["Peru", reg.nombre, u.id, u.provincia, u.region].filter(Boolean));
  const est = (d.estudios?.estudios || []).filter(s => s.lugares.some(l => claves.has(l) || (l.length <= pref.length && pref.startsWith(l) && /^\d+$/.test(l))));

  $("#panel").innerHTML = `
    <div class="grab"></div>
    <div class="p-head">
      <div class="miga">${miga}</div>
      <h2>${esc(u.nombre)}</h2>
      <div class="zone">${{ region: "Región", provincia: "Provincia", distrito: "Distrito" }[u.nivel]} · código INEI ${u.id}</div>
      ${lugar ? `<div class="p-when">${iconoHTML(lugar.tipo, 16)} ${esc(lugar.nombre || ICONOS[lugar.tipo].nombre)}${lugar.altitud ? `, ${esc(lugar.altitud)} m` : ""}</div>` : ""}
    </div>

    <section class="f-sec">
      <h3>Ahora</h3>
      <dl class="f-grid">
        ${rj?.c ? `<div><dt>Mar frente a la costa</dt><dd>${tsm === null ? "sin dato" : sg(tsm) + " °C"}</dd>${chipAtencion(naMar)}</div>` : ""}
        <div><dt>Focos de calor, 7 días</dt><dd>${inc}</dd>${chipAtencion(naInc)}</div>
        <div><dt>Días con lluvia fuerte, próximos 16</dt><dd>${ll ? sg(ll.dias_fuertes, 0).replace("+", "") : "sin dato"}</dd>${chipAtencion(naLl)}</div>
      </dl>
      <p class="f-nota">${escalaNota} Los niveles siguen reglas fijas (pasa el cursor sobre cada uno); no son pronósticos.</p>
    </section>

    <section class="f-sec">
      <h3>Lo que viene</h3>
      ${ll ? `<p class="f-txt"><b>${sg(ll.total, 0).replace("+", "")} mm</b> de lluvia en 16 días para ${u.nivel === "distrito" ? "la provincia de " + esc(u.provincia_nombre) : "esta unidad"}; día más lluvioso ${sg(ll.max_dia, 0).replace("+", "")} mm.</p>${barrasLluvia(ll.serie, d.lluvia.fechas)}
        <p class="f-fuente">Open-Meteo, modelos globales. Para avisos oficiales, SENAMHI.</p>` : `<p class="f-txt">Sin pronóstico de lluvia para esta unidad.</p>`}
      <p class="f-txt">ENFEN: <b>${esc(e.alerta.estado)}</b>. ${esc(e.probabilidades.periodo || "")} en ${esc(e.probabilidades.region || "")}: ${e.probabilidades.valores.map(p => `${esc(p.magnitud)} ${p.p} %`).join(", ")}.</p>
      <p class="f-fuente">${esc(e.probabilidades.fuente)}, ${fecha(e.alerta.fecha)}.</p>
    </section>

    <section class="f-sec">
      <h3>Qué hay expuesto</h3>
      <div class="f-lugares">${Object.keys(ICONOS).map(k => porTipo[k] ? `<span>${iconoHTML(k, 16)} ${porTipo[k]} ${ICONOS[k].nombre.toLowerCase()}${porTipo[k] > 1 ? "s" : ""}</span>` : "").join("")}
        ${dentro.length ? "" : "<span>Sin lugares registrados en OpenStreetMap.</span>"}</div>
      ${conNombre.length ? `<ul class="f-lista">${conNombre.map(f => `<li><a href="#" onclick="volarA(${f.geometry.coordinates[0]},${f.geometry.coordinates[1]});return false">${iconoHTML(f.properties.tipo, 14)} ${esc(f.properties.nombre)}</a></li>`).join("")}</ul>` : ""}
      <p class="f-fuente">Inventario colaborativo de OpenStreetMap; los inventarios de la ANA y del INAIGEM son la referencia oficial.</p>
    </section>

    <section class="f-sec">
      <h3>Estudios relacionados</h3>
      ${est.length ? `<ul class="f-est">${est.map(s => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.titulo)}</a><span>${esc(s.autores)}, ${s.anio}</span><p>${esc(s.hallazgo)}</p></li>`).join("")}</ul>`
        : `<p class="f-txt">Todavía no hay estudios cargados para este lugar. El equipo los agrega en <code>catalogo/estudios.yaml</code>, siempre con referencia verificable.</p>`}
    </section>`;
}

function volarA(lon, lat){ M.mapa.flyTo({ center: [lon, lat], zoom: 11, duration: 1000 }); }
window.volarA = volarA;
