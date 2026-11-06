/* ════════════════════════════════════════════════════════════════════════
   ENSO PERÚ · mapa.js
   Mapa interactivo (MapLibre GL) y ficha de lugar.

   De abajo hacia arriba: mapa base oscuro (OpenFreeMap) · relieve sombreado ·
   campo de anomalía de TSM (imagen del pipeline) · coropletas por región,
   provincia o distrito · focos de calor (NASA FIRMS) · ríos (GloFAS) · lugares
   con ícono (OpenStreetMap).

   El navegador no calcula nada: cada valor viene de un archivo de sitio/datos/
   y se cruza por el código INEI de la unidad (2 dígitos región, 4 provincia,
   6 distrito). Todo texto que viene de datos pasa por esc().
   ════════════════════════════════════════════════════════════════════════ */

const M = {                    // estado del mapa
  mapa: null, listo: false, capa: "tsm", nivel: "region", tema: null, mesEst: 0,
  lugares: { estacion: false, cumbre: false, presa: false, embalse: true, laguna: false, laguna_glaciar: false, glaciar: true }, incendios: false, rios: true, riosAna: true,
  turno: 0,      // solo la última orden de pintar puede escribir colores
  sel: null, datos: {},
};

const NIVELES_R = { "Muy bajo": "#3E5A63", Bajo: "#3E5A63", Medio: "#F0C178", Alto: "#E18C3E", "Muy alto": "#B4101C" };
const CAPAS_MAPA = {
  ninguna:  { n: "Solo el mapa", niveles: [] },
  aviso:    { n: "Avisos del SENAMHI hoy", u: "", tipo: "aviso", niveles: ["region"], fuente: "SENAMHI. Según las zonas que nombra el texto de cada aviso; el detalle oficial está en su enlace" },
  tsm:      { n: "Temperatura del mar", u: "°C", lo: -2, hi: 6, tipo: "divergente", niveles: ["region"], fuente: "NOAA OISST, franja marina a menos de 110 km del litoral, media de 7 días" },
  lluvia:   { n: "Lluvia, próximos 16 días", u: "mm", lo: 0, hi: 240, tipo: "azul", niveles: ["region", "provincia"], fuente: "Open-Meteo (modelos globales). No es un aviso oficial: para alertas, SENAMHI" },
  ult30:    { n: "Lluvia, últimos 30 días", u: "mm", lo: 0, hi: 300, tipo: "azul", niveles: ["region", "provincia"], fuente: "Estimación de modelos (Open-Meteo), no estaciones" },
  estacional:{ n: "Tendencia estacional", u: "mm", lo: -200, hi: 200, tipo: "divergente-inv", niveles: ["region"], fuente: "ECMWF SEAS5, anomalía del mes frente a su propia historia. Vale a escala de región" },
  tmax:     { n: "Calor, próximos 7 días", u: "°C", lo: 8, hi: 38, tipo: "naranja", niveles: ["region", "provincia"], fuente: "Temperatura máxima media pronosticada. Open-Meteo" },
  incendios:{ n: "Focos de calor, 7 días (no todos son incendios)", u: "focos", lo: 0, hi: 60, tipo: "naranja", niveles: ["region", "provincia", "distrito"], fuente: "NASA FIRMS, satélite VIIRS. Un foco no siempre es un incendio forestal" },
  esc:      { n: "Riesgo por la lluvia de hoy", u: "", tipo: "esc", niveles: ["distrito"], fuente: "CENEPRED, escenario de riesgo del aviso de lluvia vigente del SENAMHI" },
  queb:     { n: "Activación de quebradas", u: "", tipo: "queb", niveles: ["distrito"], fuente: "SENAMHI, aviso de activación de quebradas por distrito, vía INDECI" },
  dee:      { n: "Estado de emergencia", u: "", tipo: "dee", niveles: ["distrito"], fuente: "PCM, decretos de estado de emergencia vigentes, publicados por la ANA" },
  prep:     { n: "Preparación del distrito", u: "", tipo: "prep", niveles: ["distrito"], fuente: "Geoperú (PCM), distritos priorizados del DS 124-2026-PCM" },
  r_inu:    { n: "Riesgo oficial: inundación", u: "", tipo: "riesgo", clave: "inu", niveles: ["distrito"], fuente: "CENEPRED, escenario de riesgo ante El Niño (SIGRID)" },
  r_mm:     { n: "Riesgo oficial: movimientos en masa", u: "", tipo: "riesgo", clave: "mm", niveles: ["distrito"], fuente: "CENEPRED, escenario de riesgo ante El Niño (SIGRID)" },
};
const NIVELES = [["region", "Regiones"], ["provincia", "Provincias"], ["distrito", "Distritos"]];

// Temas: una combinación de capa, nivel, lugares y encuadre para cada pregunta
const TEMAS = {
  lluvias:   { n: "Norte: lluvias e inundaciones", capa: "lluvia", nivel: "provincia", lugares: { presa: true, embalse: true }, rios: true, caja: [[-81.5, -9.2], [-74, -3]], texto: "Lluvia a 16 días, ríos, presas y embalses de la costa y sierra norte, donde el ENFEN espera lluvias sobre lo normal." },
  incendios: { n: "Sur: sequía e incendios", capa: "estacional", nivel: "region", lugares: { laguna: true }, focos: true, rios: false, caja: [[-76, -17.5], [-68.5, -11]], texto: "Tendencia de la lluvia del mes elegido frente a lo normal, por región (rojo: menos lluvia; azul: más), y focos de calor. El ENFEN y el SENAMHI esperan lluvias bajo lo normal en el sur andino y déficit en el Titicaca. Cambia el mes arriba." },
  mar:       { n: "Mar y pesca", capa: "tsm", nivel: "region", lugares: {}, caja: [[-86, -19], [-69, -1]], texto: "El mar frente a la costa y su anomalía." },
  riosana:   { n: "Ríos: seguimiento", capa: "lluvia", nivel: "provincia", lugares: { embalse: true }, riosAna: true, cuencas: true, pcs: true, caja: [[-82, -18.6], [-68.4, 0.1]], texto: "Los ríos de la ANA, coloreados por su estado: azul normal, ámbar vigilancia, rojo crecida, morado nivel bajo; gris, sin estación (no sabemos). Sobre la lluvia esperada y con las obras de prevención. Toca un río para ver su seguimiento." },
  hoy:       { n: "Hoy: riesgo y emergencias", capa: "esc", nivel: "distrito", lugares: {}, emergencias: true, caja: [[-82, -18.6], [-68.4, 0.1]], texto: "Distritos en riesgo por el aviso de lluvia vigente (CENEPRED) y emergencias registradas en 7 días (INDECI). Toca un punto para ver el reporte." },
  riesgo:    { n: "Riesgo oficial por distrito", capa: "r_inu", nivel: "distrito", lugares: {}, caja: [[-82, -18.6], [-68.4, 0.1]], texto: "Escenario del CENEPRED: viviendas, colegios, salud, vías y cultivos expuestos a inundación." },
  glaciares: { n: "Agua, nevados y cumbres", capa: "ninguna", nivel: "provincia", lugares: { glaciar: true, laguna_glaciar: true, embalse: true, cumbre: true }, caja: [[-78.5, -10.5], [-76.5, -8.5]], texto: "Glaciares, cumbres, lagunas y embalses en la Cordillera Blanca y el resto de los Andes. Toca una figura para ver su ficha." },
  estaciones:{ n: "Estaciones del SENAMHI", capa: "lluvia", nivel: "provincia", lugares: { estacion: true }, rios: false, caja: [[-82, -18.6], [-68.4, 0.1]], texto: "La red de estaciones del SENAMHI sobre la lluvia pronosticada. Acércate para ver más; toca una para ver su ficha y sus datos oficiales." },
  pacifico:  { n: "Pacífico ecuatorial", capa: "tsm", nivel: "region", lugares: {}, rios: false, caja: [[-178, -22], [-66, 14]], texto: "El campo de temperatura del mar en todo el Pacífico, con las regiones Niño." },
};

const COLOR_INCENDIO = "#F28C28";
const RAMPA_AZUL = ["#DCEBF7", "#9EC5F4", "#5598E7", "#2A78D6", "#1C5CAB", "#104281"];
const RAMPA_NARANJA = ["#FCE3CF", "#F7B27E", "#EF8A3F", "#D96A1B", "#A8460C", "#6E2A05"];
const COLOR_RIO = { normal: "#79C2D0", elevado: "#F0A23C", "muy alto": "#E2341D" };
const COLOR_AVISO = { AMARILLO: "#E9C46A", NARANJA: "#E18C3E", ROJO: "#B4101C" };

const COLOR_ESTADO = {
  esc: { MA: "#B4101C", A: "#E18C3E", M: "#F0C178" },
  queb: { 1: "#F0C178", 2: "#E18C3E", 3: "#B4101C" },
  dee: { 1: "#8B6FB8" },
  prep: { critico: "#B4101C", parcial: "#F0C178", adecuado: "#3E8E7E", sin_informacion: "#7C8A90" },
};
const LEYENDA_ESTADO = {
  esc: [["MA", "Muy alto"], ["A", "Alto"], ["M", "Medio"]], queb: [["3", "Nivel 3"], ["2", "Nivel 2"], ["1", "Nivel 1"]],
  dee: [["1", "En estado de emergencia"]], prep: [["critico", "Crítica"], ["parcial", "Parcial"], ["adecuado", "Adecuada"], ["sin_informacion", "Sin información"]],
};

function colorCapa(c, v){
  if (v === null || v === undefined) return null;
  if (COLOR_ESTADO[c.tipo]) return COLOR_ESTADO[c.tipo][v] || null;
  if (c.tipo === "riesgo") return NIVELES_R[v] || null;
  if (c.tipo === "aviso") return COLOR_AVISO[v] || null;      // el nivel; el peligro va en el texto emergente
  if (c.tipo === "naranja" && c.lo === 0 && v === 0) return null;
  if (c.tipo === "divergente") return escala(v, c.lo, c.hi, false);
  if (c.tipo === "divergente-inv") return escala(c.desplaza ? v - c.desplaza : v, c.lo, c.hi, true);
  const r = c.tipo === "azul" ? RAMPA_AZUL : RAMPA_NARANJA;
  const t = Math.max(0, Math.min(1, (v - c.lo) / (c.hi - c.lo)));
  return r[Math.min(r.length - 1, Math.floor(t * r.length))];
}

/* ── Datos ──────────────────────────────────────────────────────────────── */
let promesaDatos = null, promesaRiesgo = null;
function asegurarDatos(){
  promesaDatos ??= (async () => {
    const [unidades, incendios, lluvia, estudios, lugares0, focos, spi, estacional, rios, oleaje, antecedentes, hidro] = await Promise.all([
      traer("datos/geo/unidades.json"), traerOpcional("datos/unidades/incendios.json"), traerOpcional("datos/unidades/lluvia_16d.json"),
      traerOpcional("datos/estudios.json"), traerOpcional("datos/geo/lugares.geojson"), traerOpcional("datos/campos/incendios.geojson"),
      traerOpcional("datos/unidades/spi.json"), traerOpcional("datos/unidades/estacional.json"), traerOpcional("datos/rios/pronostico.json"),
      traerOpcional("datos/unidades/oleaje.json"), traerOpcional("datos/antecedentes.json"), traerOpcional("datos/geo/hidro_lugares.json"),
    ]);
    // Glaciares y lagunas oficiales (INAIGEM, ANA) en lugar de los de OpenStreetMap; cada lugar con su número
    const lugares = lugares0 ? lugaresOficiales(lugares0, hidro) : null;
    (lugares?.features || []).forEach((f, i) => { f.properties.uid = i; });
    Object.assign(M.datos, { incendios, lluvia, estudios, lugares, focos, spi, estacional, rios, oleaje, antecedentes, unidades: unidades.unidades });
    M.datos.porId = Object.fromEntries(unidades.unidades.map(u => [u.id, u]));
    M.conteoLugares = {};
    for (const f of lugares?.features || []) M.conteoLugares[f.properties.tipo] = (M.conteoLugares[f.properties.tipo] || 0) + 1;
    M.datos.claveRegion = Object.fromEntries(unidades.unidades.filter(u => u.nivel === "region").map(u => [u.id, u.clave]));
    D.nombres = Object.fromEntries(unidades.unidades.map(u => [u.id, u.nombre]));
  })();
  return promesaDatos;
}
function asegurarRiesgo(){
  promesaRiesgo ??= Promise.all([traerOpcional("datos/unidades/riesgo.json"), traerOpcional("datos/peru/distritos.json"), traerOpcional("datos/geo/poblacion_2025.json")])
    .then(([r, e, p]) => { M.datos.riesgo = r; M.datos.estadoDist = e; M.datos.pob2025 = p?.valores || {}; });
  return promesaRiesgo;
}

// Valor de una unidad para la capa activa (null si no hay dato)
function valorUnidad(id, capa = M.capa){
  const d = M.datos, c = CAPAS_MAPA[capa];
  const ll = d.lluvia?.valores?.[id];
  switch (capa){
    case "aviso": return D.panorama?.regiones?.[id]?.aviso ?? null;
    case "tsm": { const r = D.regiones.regiones[d.claveRegion[id]]; return r?.c ? r?.v?.tsm?.now ?? null : null; }
    case "lluvia": return ll?.total ?? null;
    case "lluvia_n": return D.panorama?.lluvia_vs_normal?.[id]?.pct ?? null;
    case "ult30": return ll?.ult30 ?? null;
    case "tmax": return ll?.tmax7 ?? null;
    case "estacional": return d.estacional?.valores?.[id]?.anom?.[M.mesEst] ?? null;
    case "spi": return d.spi?.valores?.[id]?.spi3 ?? null;
    case "incendios": return d.incendios?.valores?.[id]?.focos ?? 0;
    case "r_inu": case "r_mm": return d.riesgo?.valores?.[id]?.[c.clave]?.riesgo ?? null;
    case "esc": return d.estadoDist?.valores?.[id]?.esc ?? null;
    case "queb": return d.estadoDist?.valores?.[id]?.queb ?? null;
    case "dee": return d.estadoDist?.valores?.[id]?.dee ? 1 : null;
    case "prep": return d.estadoDist?.valores?.[id]?.prep?.nivel ?? null;
  }
  return null;
}
function textoValor(v, c){
  if (v === null || v === undefined) return "sin dato";
  if (c.tipo === "esc") return { MA: "Muy alto", A: "Alto", M: "Medio" }[v] || v;
  if (c.tipo === "queb") return `Nivel ${v}`;
  if (c.tipo === "dee") return "En estado de emergencia";
  if (c.tipo === "prep") return { critico: "Crítica", parcial: "Parcial", adecuado: "Adecuada", sin_informacion: "Sin información" }[v] || v;
  if (c.tipo === "aviso") return v ? `${v[0]}${v.slice(1).toLowerCase()}` : v;
  if (typeof v === "string") return v;
  if (!c.u) return sg(v);
  if (c.u === "focos") return `${v} focos`;
  if (c.u === "%") return `${v} % de lo normal`;
  if (c.tipo === "azul") return `${Math.round(v)} mm`;
  return `${c.tipo === "naranja" ? String(v).replace(".", ",") : sg(v, Math.abs(v) < 10 ? 1 : 0)} ${c.u}`;
}

/* ── Mapa ───────────────────────────────────────────────────────────────── */
async function iniciarMapa(){
  if (M.mapa){ M.mapa.resize(); return; }
  await asegurarDatos();
  llenarBuscador();
  pintarControles();

  const mapa = new maplibregl.Map({
    container: "mapa", style: "https://tiles.openfreemap.org/styles/dark",
    center: [-75.3, -9.6], zoom: 4.4, minZoom: 2.5, maxZoom: 12, attributionControl: false,
  });
  M.mapa = mapa;
  mapa.on("error", e => { console.error("mapa:", e.error?.message || e); });
  mapa.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  mapa.addControl(new maplibregl.GeolocateControl({ fitBoundsOptions: { maxZoom: 9 } }), "top-right");
  mapa.addControl(new maplibregl.AttributionControl({ compact: true,
    customAttribution: "Datos: ENFEN, SENAMHI, CENEPRED, NOAA, NASA, Copernicus, Open-Meteo · © colaboradores de OpenStreetMap" }));

  mapa.on("load", async () => {
    const estilo = mapa.getStyle();
    const primerSimbolo = estilo.layers.find(l => l.type === "symbol")?.id;
    for (const l of estilo.layers){    // etiquetas en español cuando existen
      if (l.type === "symbol" && l.layout?.["text-field"])
        mapa.setLayoutProperty(l.id, "text-field", ["coalesce", ["get", "name:es"], ["get", "name:latin"], ["get", "name"]]);
    }

    mapa.addSource("relieve", { type: "raster-dem", tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
      encoding: "terrarium", tileSize: 256, maxzoom: 13 });
    mapa.addLayer({ id: "relieve", type: "hillshade", source: "relieve",
      paint: { "hillshade-exaggeration": 0.35, "hillshade-shadow-color": "#0B1217", "hillshade-highlight-color": "#3C5661", "hillshade-accent-color": "#16222A" } }, primerSimbolo);

    if (D.campo?.lonlat_ml){
      const [W, S, E, N] = D.campo.lonlat_ml;
      mapa.addSource("tsm", { type: "image", url: recurso("datos/campos/" + D.campo.archivo_ml), coordinates: [[W, N], [E, N], [E, S], [W, S]] });
      mapa.addLayer({ id: "tsm", type: "raster", source: "tsm", paint: { "raster-opacity": 0.85, "raster-resampling": "linear" } }, primerSimbolo);
    }

    // Recuadros de las regiones Niño
    const caja = (n, o, s, e, en) => ({ type: "Feature", properties: { n }, geometry: { type: "Polygon", coordinates: [[[o, s], [e, s], [e, en], [o, en], [o, s]]] } });
    mapa.addSource("cajas", { type: "geojson", data: { type: "FeatureCollection", features: [caja("Niño 1+2", -90, -10, -80, 0), caja("Niño 3", -150, -5, -90, 5), caja("Niño 3.4", -170, -5, -120, 5)] } });
    mapa.addLayer({ id: "cajas", type: "line", source: "cajas", paint: { "line-color": "#E7EDEC", "line-width": 1, "line-dasharray": [3, 2] } }, primerSimbolo);
    mapa.addLayer({ id: "cajas-txt", type: "symbol", source: "cajas", layout: { "text-field": ["get", "n"], "text-font": ["Noto Sans Regular"], "text-size": 11, "symbol-placement": "point" },
      paint: { "text-color": "#E7EDEC", "text-halo-color": "#16222A", "text-halo-width": 1.2 } });

    for (const [nivel] of NIVELES) if (nivel !== "distrito") agregarUnidades(nivel, primerSimbolo);
    M.primerSimbolo = primerSimbolo;

    if (M.datos.focos){
      mapa.addSource("focos", { type: "geojson", data: M.datos.focos });
      mapa.addLayer({ id: "focos-halo", type: "heatmap", source: "focos", maxzoom: 8,
        paint: { "heatmap-weight": ["interpolate", ["linear"], ["get", "frp"], 0, 0.3, 30, 1],
                 "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 3, 0.6, 8, 1.6],
                 "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 3, 6, 8, 22],
                 "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 3, 0.7, 6.5, 0.75, 8, 0],
                 "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"], 0, "rgba(242,140,40,0)", 0.25, "rgba(242,140,40,.45)", 0.6, "rgba(239,106,27,.8)", 1, "rgba(255,221,150,.95)"] } });
      mapa.addLayer({ id: "focos", type: "circle", source: "focos", minzoom: 6,
        paint: { "circle-color": COLOR_INCENDIO, "circle-stroke-color": "#16222A", "circle-stroke-width": 0.8,
                 "circle-opacity": ["interpolate", ["linear"], ["zoom"], 6, 0, 7.5, 0.9],
                 "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, ["interpolate", ["linear"], ["get", "frp"], 1, 2, 50, 5], 11, ["interpolate", ["linear"], ["get", "frp"], 1, 4, 50, 12]] } });
      mapa.on("mousemove", "focos", e => { const p = e.features[0].properties;
        tipMapa(e.point, "Foco de calor", `${fecha(p.fecha)} ${p.hora.slice(0, 2)}:${p.hora.slice(2)} UTC · potencia ${p.frp} MW`); });
      mapa.on("mouseleave", "focos", () => $("#tip").style.opacity = 0);
    }

    if (M.datos.lugares){
      for (const k of Object.keys(ICONOS)) mapa.addImage("ic-" + k, await imagenIcono(k), { pixelRatio: 2 });
      mapa.addSource("lugares", { type: "geojson", data: M.datos.lugares });
      mapa.addLayer({ id: "lugares", type: "symbol", source: "lugares", minzoom: 3.5,
        layout: { "icon-image": ["concat", "ic-", ["get", "tipo"]], "icon-size": ["interpolate", ["linear"], ["zoom"], 3.5, 0.5, 6, 0.7, 9, 1.05],
                  "icon-allow-overlap": false, "icon-padding": 1,
                  // Al quedar poco espacio ganan los que tienen nombre y artículo
                  "symbol-sort-key": ["case", ["==", ["get", "nombre"], ""], 3, ["has", "wikidata"], 0, ["==", ["get", "tipo"], "embalse"], 0, 1],
                  "text-field": ["step", ["zoom"], "", 8, ["get", "nombre"]], "text-font": ["Noto Sans Regular"],
                  "text-size": 11, "text-offset": [0, 1.2], "text-anchor": "top", "text-optional": true },
        paint: { "text-color": "#E7EDEC", "text-halo-color": "#16222A", "text-halo-width": 1.2 } });
      // Marca del lugar elegido
      mapa.addSource("sel-lugar", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      mapa.addLayer({ id: "sel-lugar", type: "circle", source: "sel-lugar", paint: { "circle-radius": 17, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#FFFFFF", "circle-stroke-width": 2.5 } });
      mapa.on("mousemove", "lugares", e => { const p = e.features[0].properties;
        mapa.getCanvas().style.cursor = "pointer";
        tipMapa(e.point, p.nombre || `${ICONOS[p.tipo].nombre} sin nombre`, `${ICONOS[p.tipo].nombre}${p.altitud ? ` · ${p.altitud} m` : ""} · toca para ver su ficha`); });
      mapa.on("mouseleave", "lugares", () => { $("#tip").style.opacity = 0; mapa.getCanvas().style.cursor = ""; });
    }

    // Ríos vigilados: un círculo por punto, color según crecida pronosticada
    if (M.datos.rios?.rios){
      mapa.addSource("rios", { type: "geojson", data: { type: "FeatureCollection", features: M.datos.rios.rios.map(r => ({
        type: "Feature", properties: { id: r.id, nombre: r.nombre, nivel: r.nivel }, geometry: { type: "Point", coordinates: [r.lon, r.lat] } })) } });
      mapa.addLayer({ id: "rios", type: "circle", source: "rios",
        paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 5, 9, 10],
                 "circle-color": ["match", ["get", "nivel"], "muy alto", COLOR_RIO["muy alto"], "elevado", COLOR_RIO.elevado, COLOR_RIO.normal],
                 "circle-stroke-color": "#F4FAFC", "circle-stroke-width": 1.6 } });
      mapa.addLayer({ id: "rios-txt", type: "symbol", source: "rios", minzoom: 5,
        layout: { "text-field": ["concat", "Río ", ["get", "nombre"]], "text-font": ["Noto Sans Regular"], "text-size": 11, "text-offset": [0, 1.1], "text-anchor": "top", "text-optional": true },
        paint: { "text-color": "#E7EDEC", "text-halo-color": "#16222A", "text-halo-width": 1.2 } });
      mapa.on("mouseenter", "rios", () => mapa.getCanvas().style.cursor = "pointer");
      mapa.on("mousemove", "rios", e => { const p = e.features[0].properties; const r = M.datos.rios.rios.find(x => x.id === p.id);
        tipMapa(e.point, "Río " + p.nombre, `${r.lugar}: pico ${Math.round(r.pico)} m³/s en 15 días (nivel ${r.nivel})`); });
      mapa.on("mouseleave", "rios", () => { $("#tip").style.opacity = 0; mapa.getCanvas().style.cursor = ""; });
    }

    // Un solo clic para todo el mapa: primero lo que está encima (figuras, ríos, focos)
    // y solo si no hay nada, la unidad de abajo. Con margen, para acertar con el dedo.
    mapa.on("click", e => {
      const m = 8, caja = [[e.point.x - m, e.point.y - m], [e.point.x + m, e.point.y + m]];
      const visibles = l => mapa.getLayer(l) && mapa.getLayoutProperty(l, "visibility") !== "none";
      const pick = l => visibles(l) ? mapa.queryRenderedFeatures(caja, { layers: [l] }) : [];
      const rio = pick("rios")[0];
      if (rio) return pintarFichaRio(rio.properties.id);
      const em = pick("emergencias")[0];
      if (em) return pintarFichaPunto("emergencia", em.properties, em.geometry.coordinates);
      const pc = pick("pc")[0];
      if (pc) return pintarFichaPunto("pc", pc.properties, pc.geometry.coordinates);
      const lug = pick("lugares")[0];
      if (lug){
        const f = M.datos.lugares.features[lug.properties.uid];
        if (f) return pintarFichaLugar(f);
      }
      const ra = pick("rios-ana")[0];
      if (ra) return pintarFichaRioANA(ra.properties.rio);
      const cu = visibles("cuencas-fill") ? mapa.queryRenderedFeatures(e.point, { layers: ["cuencas-fill"] })[0] : null;
      if (cu && !visibles(`${M.nivel}-relleno`)) return pintarFichaCuenca(cu.properties.id);
      const u = visibles(`${M.nivel}-relleno`) ? mapa.queryRenderedFeatures(e.point, { layers: [`${M.nivel}-relleno`] })[0] : null;
      if (u) elegirUnidad(u.id);
    });

    await agregarRiosANA(mapa, "lugares");

    // Los créditos quedan plegados en su botón (i): abiertos tapan el pie del mapa
    mapa.getContainer().querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
    // Emergencias del COEN (7 días) y puntos críticos de ríos de la ANA
    const puntos = [["emergencias", "datos/peru/emergencias.geojson", "#F5F0E6", "#B4101C"], ["pc", "datos/peru/puntos_criticos.geojson", "#C9A227", "#16222A"]];
    for (const [id, url, relleno, borde] of puntos){
      mapa.addSource(id, { type: "geojson", data: url });
      mapa.addLayer({ id, type: "circle", source: id, layout: { visibility: "none" },
        paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 3.5, 9, 7], "circle-color": id === "pc"
          ? ["match", ["get", "estado"], "Ejecutado", "#3E8E7E", "En Ejecución", "#C9A227", "#B9C4C9"] : relleno,
          "circle-stroke-color": borde, "circle-stroke-width": id === "emergencias" ? 2 : 1 } });
      mapa.on("mousemove", id, e => { const p = e.features[0].properties; mapa.getCanvas().style.cursor = "pointer";
        tipMapa(e.point, id === "pc" ? `Río ${p.rio}: ${p.sector || ""}` : p.peligro, id === "pc" ? `${p.estado}, avance ${p.avance ?? "–"} %` : `${p.fecha} · ${p.lugar}`); });
      mapa.on("mouseleave", id, () => { $("#tip").style.opacity = 0; mapa.getCanvas().style.cursor = ""; });
    }
    M.listo = true;
    document.body.dataset.mapaListo = "1";      // marca para pruebas automáticas
    await aplicarCapa(); aplicarLugares();
    window.dispatchEvent(new Event("mapa-listo"));
    if (window.vistaInicialMapa === "pacifico"){ setTema("pacifico"); window.vistaInicialMapa = null; }
  });
}
window.iniciarMapa = iniciarMapa;

function agregarUnidades(nivel, antes){
  const mapa = M.mapa;
  mapa.addSource(nivel, { type: "geojson", data: `datos/geo/${nivel === "region" ? "regiones" : nivel + "s"}.geojson`, promoteId: "id" });
  mapa.addLayer({ id: `${nivel}-relleno`, type: "fill", source: nivel, layout: { visibility: "none" },
    paint: { "fill-color": ["coalesce", ["feature-state", "color"], "rgba(0,0,0,0)"],
             "fill-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.88, 0.66] } }, antes);
  mapa.addLayer({ id: `${nivel}-borde`, type: "line", source: nivel, layout: { visibility: "none" },
    paint: { "line-color": ["case", ["boolean", ["feature-state", "sel"], false], "#FFFFFF", ["boolean", ["feature-state", "hover"], false], "#E7EDEC", "#5A7178"],
             "line-width": ["case", ["boolean", ["feature-state", "sel"], false], 2.4, ["boolean", ["feature-state", "hover"], false], 1.6, nivel === "distrito" ? 0.35 : 0.8] } }, antes);
  let encima = null;
  mapa.on("mousemove", `${nivel}-relleno`, e => {
    const f = e.features[0]; if (!f) return;
    if (["lugares", "rios"].some(l => mapa.getLayer(l) && mapa.getLayoutProperty(l, "visibility") !== "none" && mapa.queryRenderedFeatures(e.point, { layers: [l] }).length)) return;
    if (encima !== null && encima !== f.id) mapa.setFeatureState({ source: nivel, id: encima }, { hover: false });
    encima = f.id; mapa.setFeatureState({ source: nivel, id: f.id }, { hover: true });
    mapa.getCanvas().style.cursor = "pointer";
    const c = CAPAS_MAPA[M.capa];
    const ra = M.capa === "aviso" ? D.panorama?.regiones?.[f.id] : null;
    tipMapa(e.point, f.properties.nombre, c.tipo ? `${c.n}: ${textoValor(valorUnidad(f.id), c)}${ra?.aviso_tipo ? ` · ${ra.aviso_tipo}` : ""}${ra?.aviso_desde ? `, desde el ${fecha(ra.aviso_desde)}` : ""}` : "Haz clic para ver su ficha");
  });
  mapa.on("mouseleave", `${nivel}-relleno`, () => {
    if (encima !== null) mapa.setFeatureState({ source: nivel, id: encima }, { hover: false });
    encima = null; mapa.getCanvas().style.cursor = ""; $("#tip").style.opacity = 0;
  });
}

function tipMapa(pt, titulo, detalle){
  const t = $("#tip");
  t.innerHTML = `<b>${esc(titulo)}</b><span>${esc(detalle || "")}</span>`;
  t.style.left = pt.x + "px"; t.style.top = pt.y + "px"; t.style.opacity = 1;
}

/* ── Capas y niveles ────────────────────────────────────────────────────── */
async function aplicarCapa(){
  if (!M.listo) return;
  const turno = ++M.turno;
  const c0 = CAPAS_MAPA[M.capa];
  if (c0.niveles.length && !c0.niveles.includes(M.nivel)) M.nivel = c0.niveles[c0.niveles.length - 1];
  pintarControles(); pintarLeyendaMapa();      // la respuesta al clic es inmediata; los colores llegan después
  if (c0.tipo === "riesgo" || COLOR_ESTADO[c0.tipo]) await asegurarRiesgo();
  if (M.nivel === "distrito" && !M.mapa.getSource("distrito")) agregarUnidades("distrito", M.primerSimbolo);
  // El relleno de distritos necesita sus datos cargados antes de pintar estados
  if (M.nivel === "distrito"){
    $("#mapa-aviso").textContent = "Cargando los distritos…";
    await new Promise(r => { const s = M.mapa.getSource("distrito"); if (s.loaded?.()) r(); else { M.mapa.once("idle", r); setTimeout(r, 4000); } });
  }
  if (turno !== M.turno) return;               // mientras tanto el usuario eligió otra cosa
  const c = CAPAS_MAPA[M.capa];
  if (M.nivel === "distrito") $("#mapa-aviso").textContent = TEMAS[M.tema]?.texto || "Toca un distrito para ver su ficha.";
  for (const [nivel] of NIVELES){
    if (!M.mapa.getSource(nivel)) continue;
    const on = nivel === M.nivel;
    M.mapa.setLayoutProperty(`${nivel}-relleno`, "visibility", on ? "visible" : "none");
    M.mapa.setLayoutProperty(`${nivel}-borde`, "visibility", on ? "visible" : "none");
    // La capa de mar es del mar: en tierra, apenas un tinte para ubicar la región
    const op = M.capa === "tsm" ? [0.42, 0.14] : [0.88, 0.66];
    M.mapa.setPaintProperty(`${nivel}-relleno`, "fill-opacity", ["case", ["boolean", ["feature-state", "hover"], false], op[0], op[1]]);
    if (on) for (const u of M.datos.unidades.filter(u => u.nivel === nivel))
      M.mapa.setFeatureState({ source: nivel, id: u.id }, { color: M.capa === "ninguna" ? null : colorCapa(c, valorUnidad(u.id)) });
  }
  const verTsm = M.capa === "tsm" ? "visible" : "none";
  if (M.mapa.getLayer("tsm")) M.mapa.setLayoutProperty("tsm", "visibility", verTsm);
  for (const l of ["cajas", "cajas-txt"]) if (M.mapa.getLayer(l)) M.mapa.setLayoutProperty(l, "visibility", verTsm);
  const vf = M.incendios || M.capa === "incendios" ? "visible" : "none";
  for (const l of ["focos", "focos-halo"]) if (M.mapa.getLayer(l)) M.mapa.setLayoutProperty(l, "visibility", vf);
  for (const l of ["rios", "rios-txt"]) if (M.mapa.getLayer(l)) M.mapa.setLayoutProperty(l, "visibility", M.rios ? "visible" : "none");
  if (M.mapa.getLayer("emergencias")) M.mapa.setLayoutProperty("emergencias", "visibility", M.emergencias ? "visible" : "none");
  if (M.mapa.getLayer("pc")) M.mapa.setLayoutProperty("pc", "visibility", M.pcs ? "visible" : "none");
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
function setMesEst(i){ M.mesEst = i; aplicarCapa(); }
function toggleLugar(k){
  M.lugares[k] = !M.lugares[k]; aplicarLugares();
  if (M.lugares[k]) $("#mapa-aviso").textContent = `${M.conteoLugares[k]} ${ICONOS[k].plural.toLowerCase()} en total. De lejos se muestran menos para que se lean: acércate para ver más y toca una para abrir su ficha.`;
}
function toggleIncendios(){ M.incendios = !M.incendios; aplicarCapa(); }
function toggleRios(){ M.rios = !M.rios; aplicarCapa(); }
function toggleEmergencias(){ M.emergencias = !M.emergencias; aplicarCapa(); }
function togglePcs(){ M.pcs = !M.pcs; aplicarCapa(); }
window.toggleEmergencias = toggleEmergencias; window.togglePcs = togglePcs;
function setTema(k){
  const t = TEMAS[k]; M.tema = k; M.capa = t.capa; M.nivel = t.nivel;
  for (const l of Object.keys(M.lugares)) M.lugares[l] = !!t.lugares[l];
  M.incendios = !!t.focos;
  M.rios = t.rios !== false;
  M.emergencias = !!t.emergencias; M.pcs = !!t.pcs;
  M.riosAna = t.riosAna !== false && k !== "pacifico"; M.cuencas = !!t.cuencas; aplicarRiosANA();
  M.mapa.fitBounds(t.caja, { padding: 30, duration: 1200 });
  $("#mapa-aviso").textContent = t.texto;
  aplicarLugares(); return aplicarCapa();
}
Object.assign(window, { setCapaMapa, setNivel, setMesEst, toggleLugar, toggleIncendios, toggleRios, setTema });

function pintarControles(){
  $("#temas").innerHTML = Object.entries(TEMAS).map(([k, t]) =>
    `<button aria-pressed="${M.tema === k}" onclick="setTema('${k}')">${esc(t.n)}</button>`).join("");
  $("#capas").innerHTML = Object.entries(CAPAS_MAPA).map(([k, c]) =>
    `<button class="layer" aria-pressed="${M.capa === k}" onclick="setCapaMapa('${k}')"><i></i>${esc(c.n)}</button>`).join("");
  const E = M.datos.estacional;
  $("#meses-ctl").innerHTML = M.capa === "estacional" && E ? `<div class="meses-est">${E.meses.map((m, i) =>
    `<button aria-pressed="${M.mesEst === i}" onclick="setMesEst(${i})">${nombreMes(m)}</button>`).join("")}</div>` : "";
  const niv = CAPAS_MAPA[M.capa].niveles.length ? CAPAS_MAPA[M.capa].niveles : NIVELES.map(n => n[0]);
  $("#niveles").innerHTML = NIVELES.map(([k, n]) =>
    `<button aria-pressed="${M.nivel === k}" ${niv.includes(k) ? "" : "disabled"} onclick="setNivel('${k}')">${n}</button>`).join("");
  $("#lugares-ctl").innerHTML =
    `<button class="layer" aria-pressed="${M.rios}" onclick="toggleRios()"><span class="foco rio"></span>Pronóstico de caudal <small class="cuenta">GloFAS</small></button>`
    + `<button class="layer" aria-pressed="${M.incendios}" onclick="toggleIncendios()"><span class="foco"></span>Focos de calor</button>`
    + `<button class="layer" aria-pressed="${!!M.riosAna}" onclick="toggleRiosANA()"><span class="foco rioana"></span>Ríos y quebradas <small class="cuenta">ANA</small></button>`
    + `<button class="layer" aria-pressed="${!!M.cuencas}" onclick="toggleCuencas()"><span class="foco cuenca"></span>Cuencas <small class="cuenta">ANA</small></button>`
    + `<button class="layer" aria-pressed="${!!M.emergencias}" onclick="toggleEmergencias()"><span class="foco emerg"></span>Emergencias, 7 días <small class="cuenta">INDECI</small></button>`
    + `<button class="layer" aria-pressed="${!!M.pcs}" onclick="togglePcs()"><span class="foco pcrit"></span>Puntos críticos de ríos <small class="cuenta">ANA</small></button>`
    + Object.keys(ICONOS).map(k =>
      `<button class="layer" aria-pressed="${!!M.lugares[k]}" onclick="toggleLugar('${k}')">${iconoHTML(k, 16)}${ICONOS[k].plural} <small class="cuenta">${M.conteoLugares?.[k] ?? ""}</small></button>`).join("");
}

function pintarLeyendaMapa(){
  const c = CAPAS_MAPA[M.capa];
  const L = $("#legend"), lo = $("#leg-lo"), hi = $("#leg-hi");
  lo.textContent = hi.textContent = ""; L.innerHTML = "";
  $("#leg-title").textContent = c.n;
  if (M.capa === "ninguna"){ $("#leg-src").textContent = "Elige lugares arriba, o haz clic en una unidad para ver su ficha."; return; }
  if (LEYENDA_ESTADO[c.tipo]){ L.classList.add("leg-cat"); L.innerHTML = LEYENDA_ESTADO[c.tipo].map(([k, n]) => `<span><i style="background:${COLOR_ESTADO[c.tipo][k]}"></i>${n}</span>`).join(""); }
  else if (c.tipo === "riesgo"){ L.classList.add("leg-cat"); L.innerHTML = ["Bajo", "Medio", "Alto", "Muy alto"].map(n => `<span><i style="background:${NIVELES_R[n]}"></i>${n}</span>`).join(""); }
  else if (c.tipo === "aviso"){ L.classList.add("leg-cat"); L.innerHTML = ["AMARILLO", "NARANJA", "ROJO"].map(n => `<span><i style="background:${COLOR_AVISO[n]}"></i>${n[0] + n.slice(1).toLowerCase()}</span>`).join(""); }
  else {
    L.classList.remove("leg-cat");
    L.innerHTML = Array.from({ length: 24 }, (_, i) => `<i style="background:${colorCapa(c, (c.desplaza || 0) + c.lo + (i / 23) * (c.hi - c.lo)) || "#3E5A63"}"></i>`).join("");
    const un = c.u && c.u !== "focos" ? ` ${c.u}` : "";
    if (c.u === "%"){ lo.textContent = "Mucho menos"; hi.textContent = "Mucho más"; }
    else { lo.textContent = `${c.tipo.startsWith("div") ? sg(c.lo, c.lo % 1 ? 1 : 0) : c.lo}${un}`; hi.textContent = `${c.tipo.startsWith("div") ? sg(c.hi, c.hi % 1 ? 1 : 0) : c.hi}+${un}`; }
  }
  const F = D.meta?.fuentes || {};
  const f = { tsm: F.oisst, lluvia: F.openmeteo, lluvia_n: F.openmeteo, ult30: F.openmeteo, tmax: F.openmeteo, incendios: F.firms, spi: F.clima, estacional: F.estacional, aviso: F.senamhi }[M.capa];
  const cuando = M.capa === "lluvia" && M.datos.lluvia ? `Del ${fecha(M.datos.lluvia.desde)} al ${fecha(M.datos.lluvia.hasta)}.`
    : M.capa === "estacional" ? `Mes: ${nombreMes(M.datos.estacional?.meses?.[M.mesEst])}.`
    : f?.ultimo_dato ? "Dato al " + fecha(f.ultimo_dato) + "." : "";
  $("#leg-src").textContent = `${c.fuente}. ${cuando}${f?.estado === "fallo" ? " ⚠ La última actualización falló." : ""}`;
}

/* ── Buscador ───────────────────────────────────────────────────────────── */
function llenarBuscador(){
  const dl = $("#lista-unidades");
  if (dl.options.length) return;
  dl.innerHTML = M.datos.unidades.map(u => {
    const ctx = u.nivel === "distrito" ? `${u.provincia_nombre}, ${u.region_nombre}` : u.nivel === "provincia" ? `provincia, ${u.region_nombre}` : "región";
    return `<option value="${esc(u.nombre)} (${esc(ctx)})" data-id="${u.id}">`;
  }).join("");
  // Figuras con nombre: también se buscan. Solo en el buscador del mapa cuentan (Comparar usa data-id).
  dl.insertAdjacentHTML("beforeend", (M.datos.lugares?.features || []).map((f, i) => {
    const p = f.properties; if (!p.nombre) return "";
    return `<option value="${esc(p.nombre)} (${esc(ICONOS[p.tipo].nombre.toLowerCase())}, ${esc(M.datos.porId[p.distrito]?.nombre || "")})" data-lugar="${i}">`;
  }).join(""));
  const inp = $("#buscar");
  inp.addEventListener("change", () => {
    const op = [...dl.options].find(o => o.value === inp.value);
    if (op?.dataset.lugar){
      const f = M.datos.lugares.features[+op.dataset.lugar], k = f.properties.tipo;
      if (!M.lugares[k]){ M.lugares[k] = true; aplicarLugares(); }
      pintarFichaLugar(f); inp.blur();
    } else if (op){ elegirUnidad(op.dataset.id); inp.blur(); }
  });
}

/* ── Ficha de lugar ─────────────────────────────────────────────────────── */
async function elegirUnidad(id, lugar = null){
  const u = M.datos.porId[id]; if (!u) return;
  marcarLugar(null); turnoFicha++;
  if (M.mapa.getLayer("rios-ana-sel")) M.mapa.setFilter("rios-ana-sel", ["==", ["get", "rio"], ""]);
  if (M.sel) for (const [n] of NIVELES) if (M.mapa.getSource(n)) M.mapa.removeFeatureState({ source: n, id: M.sel }, "sel");
  M.sel = id;
  if (u.nivel !== M.nivel){
    M.nivel = u.nivel;
    if (!CAPAS_MAPA[M.capa].niveles.includes(u.nivel)) M.capa = u.nivel === "distrito" ? "incendios" : "lluvia";
    await aplicarCapa();
  }
  M.mapa.setFeatureState({ source: u.nivel, id }, { sel: true });
  M.mapa.fitBounds([[u.caja[0], u.caja[1]], [u.caja[2], u.caja[3]]], { padding: 60, maxZoom: 10, duration: 900 });
  $("#panel").innerHTML = `<div class="grab"></div><div class="empty"><b>${esc(u.nombre)}</b>Cargando su ficha…</div>`;
  $("#panel").scrollTop = 0;
  $("#panel").classList.add("up");
  await pintarFicha(u, lugar);
}
window.elegirUnidad = elegirUnidad;

function nivelAtencion(clave, v){
  const a = M.datos.estudios?.atencion?.[clave]; if (!a || v === null || v === undefined) return null;
  const i = a.cortes.filter(c => v >= c).length;
  return { n: ["Bajo", "Medio", "Alto", "Muy alto"][i], clase: ["bajo", "medio", "alto", "muyalto"][i], regla: a.regla };
}
function chipAtencion(na){
  if (!na) return `<span class="chip sin">Sin dato</span>`;
  return `<span class="chip ${na.clase}" title="${esc(na.regla)}">${na.n}</span>`;
}

function barras(serie, etiquetas, op = {}){
  const W = 320, H = op.alto || 70, vals = serie.filter(v => v !== null);
  const max = Math.max(op.min || 1, ...vals), min = Math.min(0, ...vals);
  const y = v => H - ((v - min) / (max - min || 1)) * H;
  const bw = W / serie.length;
  return `<svg viewBox="0 0 ${W} ${H + 16}" class="mini" role="img">
    ${serie.map((v, i) => { if (v === null) return ""; const y0 = y(0), y1 = y(v), col = op.color ? op.color(v, i) : "#86B6EF";
      return `<rect x="${(i * bw + 1).toFixed(1)}" y="${Math.min(y0, y1).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${Math.max(1, Math.abs(y1 - y0)).toFixed(1)}" rx="2" fill="${col}"><title>${esc(etiquetas[i])}: ${sg(v, op.dec ?? 0).replace("+", op.signo ? "+" : "")} ${op.u || ""}</title></rect>`; }).join("")}
    ${op.linea !== undefined ? `<line x1="0" y1="${y(op.linea)}" x2="${W}" y2="${y(op.linea)}" stroke="#D9452C" stroke-opacity=".6" stroke-dasharray="3 3"/>` : ""}
    <text x="2" y="${H + 12}" fill="#84959A" font-size="10" font-family="IBM Plex Sans">${esc(etiquetas[0])}</text>
    <text x="${W - 2}" y="${H + 12}" text-anchor="end" fill="#84959A" font-size="10" font-family="IBM Plex Sans">${esc(etiquetas[etiquetas.length - 1])}</text></svg>`;
}

async function pintarFicha(u, lugar){
  await asegurarRiesgo();
  const d = M.datos, e = D.estado, P = D.panorama;
  const idProv = u.nivel === "distrito" ? u.provincia : u.id;
  const idReg = u.nivel === "region" ? u.id : u.region;
  const reg = d.porId[idReg];
  const rj = D.regiones.regiones[d.claveRegion[idReg]];
  const clima = await traerOpcional(`datos/clima/${idProv}.json`);
  const miga = u.nivel === "distrito" ? `<button class="enlace" onclick="elegirUnidad('${u.region}')">${esc(u.region_nombre)}</button> · <button class="enlace" onclick="elegirUnidad('${u.provincia}')">${esc(u.provincia_nombre)}</button>`
    : u.nivel === "provincia" ? `<button class="enlace" onclick="elegirUnidad('${u.region}')">${esc(u.region_nombre)}</button>` : "Región";

  const tsm = rj?.c ? rj.v?.tsm?.now ?? null : null;
  const inc = d.incendios?.valores?.[u.id]?.focos ?? 0;
  const ll = d.lluvia?.valores?.[idProv];
  const spi = d.spi?.valores?.[idProv];
  const naMar = rj?.c ? nivelAtencion("mar", tsm) : null;
  const naInc = nivelAtencion("incendios", inc);
  const naLl = ll ? nivelAtencion("lluvia", ll.dias_fuertes) : null;
  const vsN = P?.lluvia_vs_normal?.[idProv];
  const ola = d.oleaje?.valores?.[idReg];

  // Avisos que tocan a esta región, según las zonas que nombra el texto
  const avisos = (D.avisos?.avisos || []).filter(a => a.regiones?.includes(d.claveRegion[idReg]) || a.zonas?.includes(rj?.z));

  // Lectura en una frase, armada con los datos
  const frases = [];
  if (avisos.length){ const rojos = avisos.filter(a => a.nivel === "ROJO").length; frases.push(`${avisos.length} ${avisos.length > 1 ? "avisos del SENAMHI tocan" : "aviso del SENAMHI toca"} esta zona${rojos ? `, ${rojos} en rojo` : ""}.`); }
  if (inc >= 10) frases.push(`Hay ${inc} focos de calor en los últimos 7 días.`);
  const rs = d.riesgo?.valores?.[u.id];
  // En región o provincia el riesgo es el de su peor distrito: se dice cuántos hay
  const fraseRiesgo = (r, peligro) => {
    if (!r) return;
    if (r.niveles){ const n = (r.niveles["Muy alto"] || 0) + (r.niveles.Alto || 0);
      if (n) frases.push(`CENEPRED: ${n} de sus ${rs.distritos} distritos en riesgo alto o muy alto por ${peligro}.`); }
    else if (r.riesgo === "Muy alto" || r.riesgo === "Alto") frases.push(`CENEPRED: riesgo ${r.riesgo.toLowerCase()} por ${peligro}.`);
  };
  fraseRiesgo(rs?.inu, "inundación"); fraseRiesgo(rs?.mm, "movimientos en masa");

  // Tendencia estacional
  const E = d.estacional, ev = E?.valores?.[idReg];
  const rios = (d.rios?.rios || []).filter(r => r.region === idReg);

  // Lugares dentro de la unidad
  const dentro = (d.lugares?.features || []).filter(f => f.properties.distrito?.startsWith(u.id));
  const porTipo = {}; dentro.forEach(f => (porTipo[f.properties.tipo] = (porTipo[f.properties.tipo] || 0) + 1));
  const conNombre = dentro.filter(f => f.properties.nombre).slice(0, 8);

  // Estudios y antecedentes que tocan este lugar
  const claves = new Set(["Peru", rj?.nombre, reg?.clave, reg?.nombre, u.id, u.provincia, u.region].filter(Boolean));
  const toca = s => s.lugares.some(l => claves.has(l));
  const est = (d.estudios?.estudios || []).filter(toca);
  const ante = (d.antecedentes?.antecedentes || []).filter(toca);
  const esGuardado = guardados().lugares.includes(u.id);

  const cli = clima?.reciente;
  const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

  $("#panel").innerHTML = `
    <div class="grab"></div>
    <div class="p-head">
      <div class="miga">${miga}</div>
      <h2>${esc(rj && u.nivel === "region" ? rj.nombre : u.nombre)}</h2>
      <div class="zone">${{ region: "Región", provincia: "Provincia", distrito: "Distrito" }[u.nivel]} · ${esc(rj?.z || "")}</div>
      ${lugar ? `<div class="p-when">${iconoHTML(lugar.tipo, 16)} ${esc(lugar.nombre || ICONOS[lugar.tipo].nombre)}${lugar.altitud ? `, ${esc(lugar.altitud)} m` : ""}</div>` : ""}
      <div class="f-acc">
        <button class="enlace" id="f-guardar" onclick="const g=alternarLugar('${u.id}');this.textContent=g?'★ Guardado':'☆ Guardar';pintarMisLugares()">${esGuardado ? "★ Guardado" : "☆ Guardar"}</button>
        <button class="enlace" onclick="compararCon('${u.id}')">Comparar con otro lugar</button>
      </div>
      ${frases.length ? `<p class="f-lectura">${esc(frases.join(" "))}</p>` : ""}
    </div>

    ${fichaEstado(u)}
    ${avisos.length ? `<section class="f-sec"><h3>${dibujo("aviso")} Avisos del SENAMHI</h3>${avisos.slice(0, 5).map(a => `<div class="f-aviso"><span class="chip ${NIVEL_AVISO[a.nivel]}">${esc(a.nivel)}</span> <a href="${esc(a.enlace)}" target="_blank" rel="noopener">${esc(a.titulo.charAt(0) + a.titulo.slice(1).toLowerCase())}</a><small>${fecha(a.inicio)} a ${fecha(a.fin)}</small></div>`).join("")}<p class="f-fuente">Según las zonas que nombra el aviso; el área exacta está en el detalle oficial.</p></section>` : ""}

    <section class="f-sec">
      <h3>${dibujo("ojo")} Ahora</h3>
      <dl class="f-grid">
        ${rj?.c ? `<div><dt>Mar frente a la costa</dt><dd>${tsm === null ? "sin dato" : sg(tsm) + " °C"}</dd>${chipAtencion(naMar)}</div>` : ""}
        <div><dt>Focos de calor, 7 días</dt><dd>${inc}</dd>${chipAtencion(naInc)}</div>
        <div><dt>Días de lluvia fuerte, próximos 16</dt><dd>${ll ? ll.dias_fuertes : "sin dato"}</dd>${chipAtencion(naLl)}</div>
        ${ll?.ult30 !== undefined ? `<div><dt>Lluvia, últimos 30 días</dt><dd>${Math.round(ll.ult30)} mm</dd><small>Estimación de modelos</small></div>` : ""}
        ${ll?.tmax7 !== undefined ? `<div><dt>Temperatura máxima, 7 días</dt><dd>${String(ll.tmax7).replace(".", ",")} °C</dd><small>Mínima ${String(ll.tmin7).replace(".", ",")} °C</small></div>` : ""}
        ${ola ? `<div><dt>Ola máxima, 7 días</dt><dd>${String(ola.max).replace(".", ",")} m</dd><small><a href="https://www.dhn.mil.pe/portal/" target="_blank" rel="noopener">Avisos oficiales: DHN</a></small></div>` : ""}
      </dl>
      <p class="f-nota">Los niveles siguen reglas fijas (pasa el cursor sobre cada uno); no son pronósticos. ${u.nivel === "distrito" ? "La lluvia es de su provincia; el mar, de su región." : ""}</p>
    </section>

    <section class="f-sec">
      <h3>${dibujo("lluvia")} Lo que viene</h3>
      ${ll ? `<p class="f-txt"><b>${Math.round(ll.total)} mm</b> en 16 días según los modelos; el día más lluvioso, ${Math.round(ll.max_dia)} mm.</p>
        ${barras(ll.serie, d.lluvia.fechas.map(fecha), { min: 25, linea: 20, u: "mm", color: v => v >= 20 ? "#1C5CAB" : "#86B6EF" })}
        <p class="f-fuente">Open-Meteo, modelos globales. La línea marca 20 mm. Avisos oficiales: SENAMHI.</p>` : ""}
      ${ev ? `<h4>Tendencia de los próximos meses en la región</h4>
        ${barras(ev.anom, E.meses.map(m => `${nombreMes(m)} ${m.slice(2, 4)}`), { min: 20, u: "mm", signo: true, color: v => v >= 0 ? "#2A78D6" : "#D9452C" })}
        <p class="f-fuente">ECMWF SEAS5: lluvia sobre o bajo lo normal. Vale para toda la región, no para un punto.</p>` : ""}
      <p class="f-txt">ENFEN: <b>${esc(e.alerta.estado)}</b>. ${esc(e.alerta.titular ? oracion(e.alerta.titular) : "")}.</p>
      <p class="f-fuente">${esc(e.alerta.fuente)}, ${fecha(e.alerta.fecha)}.</p>
    </section>

    ${rios.length ? `<section class="f-sec"><h3>${dibujo("rio")} Ríos de la región</h3>
      ${rios.map(r => `<div class="rank-f" onclick="pintarFichaRio('${r.id}')"><span><b>${esc(r.nombre)}</b> <small>${esc(r.lugar)}</small></span><span>${Math.round(r.pico)} m³/s ${chipNivel(r.nivel)}</span></div>`).join("")}
      <p class="f-fuente">Pico pronosticado en 15 días frente a su historia. GloFAS, un modelo global: orienta, no mide.</p></section>` : ""}

    ${rs ? `<section class="f-sec"><h3>${dibujo("casa")} Qué está expuesto</h3>
      <dl class="f-grid">
        <div><dt>Riesgo por inundación</dt><dd class="dd-chip">${rs.inu.niveles ? "" : rs.inu.riesgo ? chipNivel(rs.inu.riesgo) : "–"}</dd>${rs.inu.vuln ? `<small>Vulnerabilidad: ${esc(rs.inu.vuln.toLowerCase())}</small>` : conteoNiveles(rs.inu.niveles)}</div>
        <div><dt>Riesgo por movimientos en masa</dt><dd class="dd-chip">${rs.mm.niveles ? "" : rs.mm.riesgo ? chipNivel(rs.mm.riesgo) : "–"}</dd>${rs.mm.vuln ? `<small>Vulnerabilidad: ${esc(rs.mm.vuln.toLowerCase())}</small>` : conteoNiveles(rs.mm.niveles)}</div>
      </dl>
      <div class="tabla-scroll"><table class="tabla tabla-exp"><tr><th></th><th>Total</th><th>Ante inundación</th><th>Ante mov. en masa</th></tr>
        <tr><td>Viviendas</td><td>${entero(rs.viv)}</td><td>${entero(rs.inu.viv)}</td><td>${entero(rs.mm.viv)}</td></tr>
        <tr><td>Colegios</td><td>${entero(rs.iiee)}</td><td>${entero(rs.inu.iiee)}</td><td>${entero(rs.mm.iiee)}</td></tr>
        <tr><td>Establecimientos de salud</td><td>${entero(rs.eess)}</td><td>${entero(rs.inu.eess)}</td><td>${entero(rs.mm.eess)}</td></tr>
        <tr><td>Vías (km)</td><td>${entero(Math.round(rs.vias))}</td><td>${entero(Math.round(rs.inu.vias))}</td><td>${entero(Math.round(rs.mm.vias))}</td></tr>
        <tr><td>Superficie agrícola (ha)</td><td>${entero(rs.agri)}</td><td>${entero(rs.inu.agri)}</td><td>${entero(rs.mm.agri)}</td></tr></table></div>
      <p class="f-fuente">Población: ${pob2025(u) ? `${entero(pob2025(u))} (censo 2025); ` : ""}${entero(rs.pob)} (censo 2017). CENEPRED, escenario de riesgo ante El Niño (SIGRID).${rs.distritos ? ` Suma de ${rs.distritos} distritos.` : ""}</p>
      ${Object.keys(porTipo).length ? `<div class="f-lugares">${Object.keys(ICONOS).map(k => porTipo[k] ? `<span>${iconoHTML(k, 16)} ${porTipo[k]} ${ICONOS[k].nombre.toLowerCase()}${porTipo[k] > 1 ? "s" : ""}</span>` : "").join("")}</div>
        ${conNombre.length ? `<ul class="f-lista">${conNombre.map(f => `<li><a href="#" onclick="volarA(${f.geometry.coordinates[0]},${f.geometry.coordinates[1]});return false">${iconoHTML(f.properties.tipo, 14)} ${esc(f.properties.nombre)}</a></li>`).join("")}</ul>` : ""}
        <p class="f-fuente">Lugares de OpenStreetMap, inventario colaborativo; los oficiales son de la ANA y del INAIGEM.</p>` : ""}
    </section>` : ""}

    ${clima ? `<section class="f-sec"><h3>${dibujo("historia")} Lo que pasó antes aquí</h3>
      <h4>Lluvia de diciembre a abril en años El Niño</h4>
      ${barras([clima.normal_temporada, ...clima.eventos.map(x => x.lluvia)], ["Normal", ...clima.eventos.map(x => x.id)], { min: 20, u: "mm", color: (v, i) => i === 0 ? "#B7C2BD" : "#2A78D6", alto: 80 })}
      <p class="f-txt">${clima.eventos.filter(x => x.pct !== null && x.pct !== undefined).map(x => `${esc(x.id)}: ${x.pct} %`).join(" · ") || "En esta zona la lluvia normal es casi nula: los porcentajes no dicen mucho."}</p>
      <p class="f-fuente">Porcentaje frente a lo normal 1991-2020. NASA POWER (MERRA-2), unos 50 km: compara años en un mismo lugar, no es una medición local.</p>
      ${ante.map(a => `<p class="f-txt"><b>${esc(a.evento)}.</b> ${esc(a.texto)} <small><a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.fuente)}</a></small></p>`).join("")}
      ${cli ? `<h4>Lluvia de los últimos meses</h4>${barras(cli.lluvia.slice(-18), cli.meses.slice(-18).map(m => `${nombreMes(m)} ${m.slice(2, 4)}`), { min: 10, u: "mm" })}
        <h4>Clima normal: lluvia por mes</h4>${barras(clima.normal.p, MESES, { min: 10, u: "mm", color: () => "#B7C2BD" })}
        <p class="f-fuente">Temperatura media anual ${String((clima.normal.t.reduce((a, b) => a + b, 0) / 12).toFixed(1)).replace(".", ",")} °C · humedad ${Math.round(clima.normal.h.reduce((a, b) => a + b, 0) / 12)} % · viento ${String((clima.normal.v.reduce((a, b) => a + b, 0) / 12).toFixed(1)).replace(".", ",")} m/s · humedad del suelo ${String((clima.normal.s.reduce((a, b) => a + b, 0) / 12).toFixed(2)).replace(".", ",")} (0 a 1).</p>` : ""}
    </section>` : ""}

    <section class="f-sec">
      <h3>${dibujo("libro")} Estudios relacionados</h3>
      ${est.length ? `<ul class="f-est">${est.map(s => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.titulo)}</a><span>${esc(s.autores)}, ${s.anio}</span><p>${esc(s.hallazgo)}</p></li>`).join("")}</ul>`
        : `<p class="f-txt">Todavía no hay estudios cargados para este lugar.</p>`}
    </section>`;
}

// Lo que el Estado reporta hoy para esta unidad. En región o provincia se suman sus distritos.
function fichaEstado(u){
  const E = M.datos.estadoDist?.valores; if (!E) return "";
  const ids = u.nivel === "distrito" ? [u.id] : Object.keys(E).filter(k => k.startsWith(u.id));
  const xs = ids.map(k => E[k]).filter(Boolean);
  if (!xs.length) return "";
  const n = f => xs.filter(f).length, uno = u.nivel === "distrito" ? xs[0] : null;
  const filas = [];
  if (uno){
    if (uno.esc) filas.push(["Riesgo por la lluvia de estos días", chipNivel({ MA: "Muy alto", A: "Alto", M: "Medio" }[uno.esc]), "CENEPRED"]);
    if (uno.queb) filas.push(["Posible activación de quebradas", `Nivel ${uno.queb}`, "SENAMHI"]);
    if (uno.dee) filas.push(["Estado de emergencia", uno.dee.map(d => `${esc(d.ds)} hasta el ${fecha(d.fin)}`).join("; "), "PCM"]);
    if (uno.prep) filas.push(["Preparación del distrito", `${{ critico: "Crítica", parcial: "Parcial", adecuado: "Adecuada", sin_informacion: "Sin información" }[uno.prep.nivel] || esc(uno.prep.nivel)}${uno.prep.brigadas ? `, ${uno.prep.brigadas} brigada${uno.prep.brigadas > 1 ? "s" : ""}` : ""}${uno.prep.almacen === false ? ", sin almacén" : ""}`, "Geoperú"]);
    if (uno.coen) filas.push(["Emergencias registradas, 7 días", uno.coen, "INDECI"]);
    if (uno.agua) filas.push(["Cortes de agua en curso", `${uno.agua.cortes}, ${entero(uno.agua.conexiones)} conexiones`, "SUNASS"]);
  } else {
    const t = (k, n2, src) => { if (n2) filas.push([k, `${n2} distrito${n2 > 1 ? "s" : ""}`, src]); };
    t("Distritos en riesgo muy alto o alto por la lluvia de estos días", n(x => x.esc === "MA" || x.esc === "A"), "CENEPRED");
    t("Con posible activación de quebradas", n(x => x.queb), "SENAMHI");
    t("En estado de emergencia", n(x => x.dee), "PCM");
    t("Con preparación crítica", n(x => x.prep?.nivel === "critico"), "Geoperú");
    const em = xs.reduce((a, x) => a + (x.coen || 0), 0);
    if (em) filas.push(["Emergencias registradas, 7 días", em, "INDECI"]);
  }
  if (!filas.length) return "";
  return `<section class="f-sec f-estado"><h3>${dibujo("mano")} Lo que reporta el Estado hoy</h3>
    ${filas.map(([k, v, s]) => `<div class="rank-f"><span>${esc(k)} <small>${esc(s)}</small></span><span>${v}</span></div>`).join("")}
    <p class="f-fuente"><button class="enlace" onclick="ir('vivo')">Ver todo lo que reporta el Estado</button></p></section>`;
}

// Población del censo 2025: la del distrito, o la suma de sus distritos
function pob2025(u){
  const P = M.datos.pob2025 || {};
  if (u.nivel === "distrito") return P[u.id] || null;
  const s = Object.entries(P).filter(([k]) => k.startsWith(u.id)).reduce((a, [, v]) => a + v, 0);
  return s || null;
}

// "2026-09" -> "jul a sep 2026": los 3 meses que mide el SPI-3
function periodoSPI(mes){
  if (!mes) return "";
  const m = +mes.slice(5, 7), a = mes.slice(0, 4), mc = i => ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"][(i + 12) % 12];
  return `${mc(m - 3)} a ${mc(m - 1)} ${a}`;
}
window.periodoSPI = periodoSPI;

function conteoNiveles(n){
  if (!n) return "";
  return `<small>${["Muy alto", "Alto"].filter(k => n[k]).map(k => `${n[k]} distritos en ${k.toLowerCase()}`).join(", ") || "Sin distritos en alto"}</small>`;
}

function pintarFichaRio(id){
  const R = M.datos.rios, r = R.rios.find(x => x.id === id);
  if (!r) return;
  M.mapa.flyTo({ center: [r.lon, r.lat], zoom: Math.max(M.mapa.getZoom(), 8), duration: 900 });
  const nd = R.dias_pasado;
  const W = 320, H = 110, q = r.serie.map(v => v ?? null), maxv = Math.max(r.p99, r.pico, ...q.filter(v => v !== null)) * 1.05;
  const x = i => (i / (q.length - 1)) * W, y = v => H - (v / maxv) * H;
  let dd = "", pl = false;
  q.forEach((v, i) => { if (v === null){ pl = false; return; } dd += (pl ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1); pl = true; });
  const reg = M.datos.porId[r.region];
  $("#panel").innerHTML = `<div class="grab"></div><div class="p-head"><div class="miga"><button class="enlace" onclick="elegirUnidad('${r.region}')">${esc(reg?.nombre || "")}</button></div>
    <h2>Río ${esc(r.nombre)}</h2><div class="zone">${esc(r.lugar)}</div></div>
    <section class="f-sec"><h3>${dibujo("rio")} Caudal pronosticado</h3>
      <dl class="f-grid"><div><dt>Hoy</dt><dd>${entero(Math.round(r.hoy))}</dd><small>m³/s · normal del mes ${entero(Math.round(r.normal_mes))}</small></div>
        <div><dt>Pico en 15 días</dt><dd>${entero(Math.round(r.pico))}</dd>${chipNivel(r.nivel)}<small>${fecha(r.fecha_pico)}</small></div></dl>
      <svg viewBox="0 0 ${W} ${H + 16}" class="mini" role="img" aria-label="Caudal del río en el tiempo">
        <line x1="${x(nd)}" y1="0" x2="${x(nd)}" y2="${H}" stroke="#84959A" stroke-dasharray="2 3"/>
        <line x1="0" y1="${y(r.p90)}" x2="${W}" y2="${y(r.p90)}" stroke="#E18C3E" stroke-dasharray="4 3"/>
        <line x1="0" y1="${y(r.p99)}" x2="${W}" y2="${y(r.p99)}" stroke="#B4101C" stroke-dasharray="4 3"/>
        <path d="${dd}" fill="none" stroke="#2A78D6" stroke-width="2"/>
        <text x="2" y="${H + 12}" fill="#84959A" font-size="10" font-family="IBM Plex Sans">${fecha(R.fechas[0])}</text>
        <text x="${x(nd) + 3}" y="${H + 12}" fill="#84959A" font-size="10" font-family="IBM Plex Sans">hoy</text>
        <text x="${W - 2}" y="${H + 12}" text-anchor="end" fill="#84959A" font-size="10" font-family="IBM Plex Sans">${fecha(R.fechas[R.fechas.length - 1])}</text></svg>
      <p class="f-nota">Líneas: 9 de cada 10 días fueron menores a ${entero(Math.round(r.p90))} m³/s (naranja) y 99 de cada 100, a ${entero(Math.round(r.p99))} m³/s (rojo), de 1984 a 2023. Máximo del modelo: ${entero(Math.round(r.maximo))} m³/s.</p>
      <p class="f-fuente">GloFAS (Copernicus), vía Open-Meteo. Modelo global de 5 km: en cuencas pequeñas o con presas puede errar. Caudales oficiales: SENAMHI y ANA.</p></section>`;
  $("#panel").classList.add("up");
}
window.pintarFichaRio = pintarFichaRio;

function compararCon(id){
  const u = M.datos.porId[id];
  const op = [...$("#lista-unidades").options].find(o => o.dataset.id === id);
  ir("comparar");
  $("#comp-a").value = op?.value || u.nombre; pintarComparar(); $("#comp-b").focus();
}
window.compararCon = compararCon;

function volarA(lon, lat){ M.mapa.flyTo({ center: [lon, lat], zoom: 11, duration: 1000 }); }
window.volarA = volarA;
