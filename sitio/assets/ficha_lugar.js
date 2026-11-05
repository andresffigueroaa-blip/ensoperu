/* ════════════════════════════════════════════════════════════════════════
   ENSO PERÚ · ficha_lugar.js
   Ficha de una figurita del mapa: estación, presa, embalse, laguna, glaciar o
   cumbre. Lo fijo sale de geo/lugares.geojson. Lo vivo se pide desde el navegador
   al abrir la ficha, solo para ese punto: clima y caudal a Open-Meteo, descripción
   a Wikipedia. Si algo no responde, esa sección lo dice y el resto sigue.
   Todo texto externo pasa por esc().
   ════════════════════════════════════════════════════════════════════════ */

const CATE_ESTACION = {
  CO: "Climatológica ordinaria", CP: "Climatológica principal", PE: "Pluviométrica especial", PLU: "Pluviométrica",
  MAP: "Meteorológica agrícola principal", EMA: "Meteorológica automática", EAMA: "Agrometeorológica automática",
  HLM: "Hidrológica limnimétrica", HLG: "Hidrológica limnigráfica", EHA: "Hidrológica automática", EHMA: "Hidrometeorológica automática",
};
const ESTADO_ESTACION = { REAL: "Transmite en tiempo real", AUTOMATICA: "Automática", DIFERIDO: "Datos en diferido" };
const QUE_ES = {
  presa: "Muro que retiene agua. Con lluvias fuertes importa su capacidad y si llega a rebosar; con sequía, cuánta agua guarda.",
  embalse: "Agua guardada para riego, consumo o energía. En El Niño puede llenarse rápido en el norte y quedar corto en el sur.",
  laguna: "Cuerpo de agua natural. Las de origen glaciar pueden crecer con el deshielo.",
  glaciar: "Hielo de montaña, reserva de agua para la estación seca. El calor de El Niño acelera su pérdida.",
  cumbre: "Punto alto de la cordillera. La altura de la isoterma de 0 °C dice si allí cae nieve o lluvia.",
  estacion: "Punto de medición del SENAMHI. Sus datos son observaciones reales, a diferencia de los modelos de esta ficha.",
};
const TEMAS_LUGAR = { presa: ["agua", "inundaciones"], embalse: ["agua"], laguna: ["agua", "glaciares"], glaciar: ["glaciares", "agua"], cumbre: ["glaciares"], estacion: ["lluvias"] };

let turnoFicha = 0;

function kmEntre(a, b){      // distancia aproximada en km entre [lon, lat]
  const k = Math.PI / 180, x = (b[0] - a[0]) * k * Math.cos((a[1] + b[1]) / 2 * k), y = (b[1] - a[1]) * k;
  return Math.sqrt(x * x + y * y) * 6371;
}
const num = (v, d = 0) => v === null || v === undefined || Number.isNaN(v) ? "–" : Number(v).toFixed(d).replace(".", ",");

function marcarLugar(coord){
  const s = M.mapa.getSource("sel-lugar");
  if (s) s.setData({ type: "FeatureCollection", features: coord ? [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: coord } }] : [] });
}

// Abre la ficha de una figurita. f: elemento de geo/lugares.geojson
async function pintarFichaLugar(f){
  const p = f.properties, c = f.geometry.coordinates, turno = ++turnoFicha;
  const d = M.datos, u = d.porId[p.distrito];
  const idProv = p.distrito.slice(0, 4), idReg = p.distrito.slice(0, 2);
  const titulo = p.nombre || `${ICONOS[p.tipo].nombre} sin nombre`;
  marcarLugar(c);
  M.mapa.flyTo({ center: c, zoom: Math.max(M.mapa.getZoom(), 9), duration: 900 });
  await asegurarRiesgo();
  if (turno !== turnoFicha) return;

  const filas = [];
  const fila = (n, v) => { if (v !== null && v !== undefined && v !== "") filas.push(`<div><dt>${esc(n)}</dt><dd class="dd-txt">${esc(v)}</dd></div>`); };
  if (p.tipo === "estacion"){
    fila("Tipo", CATE_ESTACION[p.cate] || p.cate); fila("Mide", p.clase === "H" ? "Caudal o nivel de río" : "Lluvia, temperatura y otras");
    fila("Transmisión", ESTADO_ESTACION[p.estado] || p.estado); fila("Código", p.cod);
  } else {
    fila("Tipo", p.volcan ? "Volcán" : ICONOS[p.tipo].nombre); fila("Operador", p.operador); fila("Altura del muro", p.altura ? `${p.altura} m` : null);
    fila("Volumen", p.capacidad); fila("Río", p.rio); fila("Uso", p.uso); fila("También llamado", p.alias);
  }
  fila("Altitud", p.altitud ? `${p.altitud} m` : null);
  fila("Coordenadas", `${Math.abs(c[1]).toFixed(3).replace(".", ",")}° S, ${Math.abs(c[0]).toFixed(3).replace(".", ",")}° O`);

  // Alrededor: con datos que ya están en el navegador
  const focos = (d.focos?.features || []).filter(x => kmEntre(c, x.geometry.coordinates) <= 25);
  const otros = (d.lugares?.features || []).filter(x => x !== f && x.properties.nombre && kmEntre(c, x.geometry.coordinates) <= 15)
    .map(x => ({ x, km: kmEntre(c, x.geometry.coordinates) })).sort((a, b) => a.km - b.km).slice(0, 6);
  d.indiceLugares = d.lugares.features;
  const rioCerca = (d.rios?.rios || []).map(r => ({ r, km: kmEntre(c, [r.lon, r.lat]) })).sort((a, b) => a.km - b.km)[0];
  const rs = d.riesgo?.valores?.[p.distrito];
  const rj = D.regiones.regiones[d.claveRegion[idReg]];
  const avisos = (D.avisos?.avisos || []).filter(a => a.zonas?.includes(rj?.z) || a.regiones?.includes(d.claveRegion[idReg]));
  const est = (d.estudios?.estudios || []).filter(s => (TEMAS_LUGAR[p.tipo] || []).some(t => s.temas?.includes(t))
    && s.lugares.some(l => ["Peru", rj?.nombre, d.claveRegion[idReg], p.distrito, idProv].includes(l)));
  const enfenTema = { embalse: "embalses", presa: "embalses", estacion: null }[p.tipo];
  const textoEnfen = enfenTema ? D.estado.temas?.[enfenTema] : null;

  const enlaces = [];
  if (p.tipo === "estacion") enlaces.push(`<a href="https://www.senamhi.gob.pe/mapas/mapa-estaciones-2/map_red_graf.php?cod=${encodeURIComponent(p.cod)}&estado=${encodeURIComponent(p.estado)}&tipo_esta=${encodeURIComponent(p.clase)}&cate=${encodeURIComponent(p.cate)}&cod_old=${encodeURIComponent(p.cod_old || "")}" target="_blank" rel="noopener">Ver sus datos en el SENAMHI</a>`);
  if (p.osm) enlaces.push(`<a href="https://www.openstreetmap.org/${esc(p.osm)}" target="_blank" rel="noopener">OpenStreetMap</a>`);
  enlaces.push(`<a href="https://www.google.com/maps?q=${c[1]},${c[0]}" target="_blank" rel="noopener">Cómo llegar</a>`);

  $("#panel").innerHTML = `<div class="grab"></div>
    <div class="p-head">
      <div class="miga"><button class="enlace" onclick="elegirUnidad('${idReg}')">${esc(d.porId[idReg]?.nombre || "")}</button> · <button class="enlace" onclick="elegirUnidad('${idProv}')">${esc(d.porId[idProv]?.nombre || "")}</button> · <button class="enlace" onclick="elegirUnidad('${p.distrito}')">${esc(u?.nombre || "")}</button></div>
      <h2 class="h-lugar">${iconoHTML(p.tipo, 26)} ${esc(titulo)}</h2>
      <div class="zone">${esc(p.volcan ? "Volcán" : ICONOS[p.tipo].nombre)} · ${esc(u?.nombre || "")}, ${esc(d.porId[idReg]?.nombre || "")}</div>
      <p class="f-nota f-que">${esc(QUE_ES[p.tipo])}</p>
      <div class="f-acc">${enlaces.join("")}</div>
    </div>
    <div id="fl-wiki"></div>
    <section class="f-sec"><h3>${dibujo("libro")} Datos del lugar</h3><dl class="f-grid">${filas.join("")}</dl>
      ${p.tipo === "estacion" ? `<p class="f-fuente">Red de estaciones del SENAMHI.</p>` : `<p class="f-fuente">OpenStreetMap, inventario colaborativo; lo oficial está en la ANA y el INAIGEM.</p>`}</section>
    <section class="f-sec" id="fl-clima"><h3>${dibujo("lluvia")} Tiempo en este punto</h3><p class="f-nota">Consultando…</p></section>
    ${["presa", "embalse", "estacion"].includes(p.tipo) && (p.tipo !== "estacion" || p.clase === "H") ? `<section class="f-sec" id="fl-caudal"><h3>${dibujo("rio")} Caudal del río en este punto</h3><p class="f-nota">Consultando…</p></section>` : ""}
    ${textoEnfen ? `<section class="f-sec"><h3>${dibujo("embalse")} Qué dice el ENFEN de los embalses</h3><p class="f-txt">${esc(textoEnfen)}</p><p class="f-fuente">${esc(D.estado.alerta.fuente)}, ${fecha(D.estado.alerta.fecha)}.</p></section>` : ""}
    <section class="f-sec"><h3>${dibujo("ojo")} Alrededor</h3>
      <dl class="f-grid">
        <div><dt>Focos de calor a menos de 25 km, 7 días</dt><dd>${focos.length}</dd></div>
        <div><dt>Riesgo por inundación del distrito</dt><dd class="dd-chip">${rs?.inu?.riesgo ? chipNivel(rs.inu.riesgo) : "–"}</dd></div>
        <div><dt>Riesgo por movimientos en masa</dt><dd class="dd-chip">${rs?.mm?.riesgo ? chipNivel(rs.mm.riesgo) : "–"}</dd></div>
        <div><dt>Avisos del SENAMHI en su zona</dt><dd>${avisos.length}</dd></div>
      </dl>
      ${rioCerca && rioCerca.km <= 60 ? `<div class="rank-f" onclick="pintarFichaRio('${rioCerca.r.id}')"><span>${dibujo("rio")} <b>Río ${esc(rioCerca.r.nombre)}</b> <small>a ${Math.round(rioCerca.km)} km, ${esc(rioCerca.r.lugar)}</small></span><span>${chipNivel(rioCerca.r.nivel)}</span></div>` : ""}
      ${otros.length ? `<h4>Cerca de aquí</h4><ul class="f-lista">${otros.map(o => `<li><a href="#" onclick="abrirLugarIdx(${d.lugares.features.indexOf(o.x)});return false">${iconoHTML(o.x.properties.tipo, 14)} ${esc(o.x.properties.nombre)}</a></li>`).join("")}</ul>` : ""}
      <p class="f-fuente"><button class="enlace" onclick="elegirUnidad('${p.distrito}')">Ver la ficha completa del distrito</button></p>
    </section>
    ${est.length ? `<section class="f-sec"><h3>${dibujo("libro")} Estudios relacionados</h3><ul class="f-est">${est.map(s => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.titulo)}</a><span>${esc(s.autores)}, ${s.anio}</span><p>${esc(s.hallazgo)}</p></li>`).join("")}</ul></section>` : ""}`;
  $("#panel").classList.add("up"); $("#panel").scrollTop = 0;

  fichaClima(p, c, turno);
  if ($("#fl-caudal")) fichaCaudal(c, turno);
  fichaWiki(p, titulo, turno);
}
window.pintarFichaLugar = pintarFichaLugar;
window.abrirLugarIdx = i => pintarFichaLugar(M.datos.lugares.features[i]);

async function fichaClima(p, c, turno){
  const caja = () => $("#fl-clima");
  const alta = p.tipo === "glaciar" || p.tipo === "cumbre";
  try {
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${c[1]}&longitude=${c[0]}`
      + `&current=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m`
      + `&daily=precipitation_sum,temperature_2m_max,temperature_2m_min&hourly=${alta ? "freezing_level_height" : "soil_moisture_0_to_7cm"}`
      + `&past_days=7&forecast_days=16&timezone=America%2FLima`;
    const r = await fetch(u); if (!r.ok) throw new Error(r.status);
    const x = await r.json();
    if (turno !== turnoFicha || !caja()) return;
    const hoy = x.daily.time.indexOf(x.current.time.slice(0, 10));
    const pas = x.daily.precipitation_sum.slice(0, hoy), fut = x.daily.precipitation_sum.slice(hoy);
    const suma = a => a.reduce((s, v) => s + (v || 0), 0);
    const altitud = p.altitud ? parseFloat(p.altitud) : x.elevation;
    const h = alta ? x.hourly.freezing_level_height : x.hourly.soil_moisture_0_to_7cm;
    // Valor medio de los próximos 7 días: desde la hora actual
    const i0 = x.hourly.time.findIndex(t => t >= x.current.time), prox = h.slice(i0, i0 + 168).filter(v => v !== null);
    const medio = prox.length ? suma(prox) / prox.length : null;
    const extra = alta
      ? `<div><dt>Isoterma de 0 °C, media de 7 días</dt><dd>${entero(medio)} m</dd><small>${medio === null ? "" : medio > altitud ? `Sobre la cumbre o el hielo (${entero(altitud)} m): allí tiende a llover o derretir, no a nevar` : `Bajo este punto (${entero(altitud)} m): allí puede nevar`}</small></div>`
      : `<div><dt>Humedad del suelo, 0 a 7 cm</dt><dd>${num(medio, 2)}</dd><small>m³/m³, media de 7 días</small></div>`;
    caja().innerHTML = `<h3>${dibujo("lluvia")} Tiempo en este punto</h3>
      <dl class="f-grid">
        <div><dt>Temperatura ahora</dt><dd>${num(x.current.temperature_2m, 1)} °C</dd><small>Humedad ${num(x.current.relative_humidity_2m)} %, viento ${num(x.current.wind_speed_10m)} km/h</small></div>
        <div><dt>Lluvia, próximos 16 días</dt><dd>${entero(suma(fut))} mm</dd><small>Últimos 7 días: ${entero(suma(pas))} mm</small></div>
        <div><dt>Máxima y mínima de hoy</dt><dd class="dd-txt">${num(x.daily.temperature_2m_max[hoy], 1)} / ${num(x.daily.temperature_2m_min[hoy], 1)} °C</dd></div>
        ${extra}
      </dl>
      ${barras(x.daily.precipitation_sum, x.daily.time.map(fecha), { min: 10, linea: 20, u: "mm", color: (v, i) => i < hoy ? "#B7C2BD" : v >= 20 ? "#1C5CAB" : "#86B6EF" })}
      <p class="f-fuente">Gris: últimos 7 días; azul: pronóstico. La línea marca 20 mm. Open-Meteo, modelos globales, a ${entero(x.elevation)} m en su grilla: en montaña puede diferir del lugar exacto. Avisos oficiales: SENAMHI.</p>`;
  } catch (e) {
    if (turno === turnoFicha && caja()) caja().innerHTML = `<h3>${dibujo("lluvia")} Tiempo en este punto</h3><p class="f-nota">Open-Meteo no respondió ahora. Vuelve a abrir la ficha en un momento.</p>`;
  }
}

async function fichaCaudal(c, turno){
  const caja = () => $("#fl-caudal");
  const tit = `<h3>${dibujo("rio")} Caudal del río en este punto</h3>`;
  try {
    // El centro de un embalse o una estación no siempre cae sobre el río en la grilla
    // de 5 km: se mira alrededor y se toma la celda con más caudal, el cauce principal.
    const dd = 0.05, lats = [0, dd, -dd, 0, 0, dd, dd, -dd, -dd].map(v => (c[1] + v).toFixed(3));
    const lons = [0, 0, 0, dd, -dd, dd, -dd, dd, -dd].map(v => (c[0] + v).toFixed(3));
    const r = await fetch(`https://flood-api.open-meteo.com/v1/flood?latitude=${lats}&longitude=${lons}&daily=river_discharge&past_days=15&forecast_days=30`);
    if (!r.ok) throw new Error(r.status);
    const todas = await r.json();
    if (turno !== turnoFicha || !caja()) return;
    const medio = s => { const v = s.daily.river_discharge.filter(a => a !== null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : -1; };
    const x = [...todas].sort((a, b) => medio(b) - medio(a))[0];
    const q = x.daily.river_discharge, hoy = 15, val = q.filter(v => v !== null);
    if (!val.length || Math.max(...val) < 0.5){
      caja().innerHTML = `${tit}<p class="f-nota">El modelo no ve un río de tamaño apreciable en este punto. Es global, de 5 km: no representa quebradas ni canales.</p>`; return;
    }
    const fut = q.slice(hoy).filter(v => v !== null), pico = Math.max(...fut), iPico = hoy + q.slice(hoy).indexOf(pico);
    caja().innerHTML = `${tit}<dl class="f-grid">
        <div><dt>Hoy</dt><dd>${entero(q[hoy])}</dd><small>m³/s</small></div>
        <div><dt>Pico en 30 días</dt><dd>${entero(pico)}</dd><small>m³/s, ${fecha(x.daily.time[iPico])}</small></div></dl>
      ${barras(q, x.daily.time.map(fecha), { min: 1, u: "m³/s", color: (v, i) => i < hoy ? "#B7C2BD" : "#2A78D6" })}
      <p class="f-fuente">Gris: últimos 15 días; azul: pronóstico. Celda con más caudal a menos de 7 km. GloFAS (Copernicus), modelo global de 5 km: orienta, no mide, y no conoce la operación de las presas. Caudales oficiales: SENAMHI y ANA.</p>`;
  } catch (e) {
    if (turno === turnoFicha && caja()) caja().innerHTML = `${tit}<p class="f-nota">GloFAS no respondió ahora. Vuelve a abrir la ficha en un momento.</p>`;
  }
}

// Solo se muestra el artículo que OpenStreetMap enlaza a este lugar: buscar por
// nombre traería homónimos (hay muchas "Laguna Negra") y diría algo falso.
async function fichaWiki(p, titulo, turno){
  const caja = $("#fl-wiki"); if (!caja) return;
  const buscar = `<section class="f-sec"><p class="f-nota">Sin artículo enlazado. <a href="https://es.wikipedia.org/w/index.php?search=${encodeURIComponent(titulo + " Perú")}" target="_blank" rel="noopener">Buscar en Wikipedia</a></p></section>`;
  try {
    let lengua = "es", art = null;
    if (p.wikipedia?.includes(":")){ [lengua, art] = [p.wikipedia.split(":")[0], p.wikipedia.split(":").slice(1).join(":")]; }
    if (p.wikidata){
      const w = await fetch(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(p.wikidata)}&props=sitelinks&sitefilter=eswiki&format=json&origin=*`).then(r => r.json());
      const es = w.entities?.[p.wikidata]?.sitelinks?.eswiki?.title;
      if (es){ lengua = "es"; art = es; }
    }
    if (!art){ if (turno === turnoFicha) $("#fl-wiki").innerHTML = buscar; return; }
    const r = await fetch(`https://${encodeURIComponent(lengua)}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(art.replace(/ /g, "_"))}`);
    if (!r.ok) throw new Error(r.status);
    const x = await r.json();
    if (turno !== turnoFicha || !$("#fl-wiki")) return;
    const foto = x.thumbnail?.source?.startsWith("https://") ? x.thumbnail.source : null;
    $("#fl-wiki").innerHTML = `<section class="f-sec f-wiki">
      ${foto ? `<img src="${esc(foto)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ""}
      ${lengua === "es" ? `<p class="f-txt">${esc(x.extract || "")}</p>` : ""}
      <p class="f-fuente"><a href="${esc(x.content_urls?.desktop?.page || "#")}" target="_blank" rel="noopener">${lengua === "es" ? "Wikipedia" : "Artículo en Wikipedia, en otro idioma"}</a>, enciclopedia colaborativa.</p></section>`;
  } catch (e) {
    if (turno === turnoFicha && $("#fl-wiki")) $("#fl-wiki").innerHTML = buscar;
  }
}
