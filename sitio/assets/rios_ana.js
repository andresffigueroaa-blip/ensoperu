/* ════════════════════════════════════════════════════════════════════════
   ENSO PERÚ · rios_ana.js
   Ríos y cuencas oficiales de la ANA, su seguimiento, y las capas de agua del
   INAIGEM (glaciares y lagunas glaciares).

   Datos fijos (herramientas/build_hidro.py, desde los shapefiles del equipo):
     geo/rios_ana.geojson, geo/rios_ana.json, geo/cuencas.geojson,
     geo/hidro_lugares.json, geo/poblacion_2025.json
   Datos de cada corrida (productos/rios_monitoreo.py):
     rios/monitoreo.json, rios/historial_estaciones.csv, rios/historial.csv
   ════════════════════════════════════════════════════════════════════════ */

const ESTADO_RIO = {
  emergencia: ["Emergencia", "#B4101C", "muyalto"], alerta: ["Alerta", "#E2341D", "alto"], vigilancia: ["Vigilancia", "#F0A23C", "medio"],
  normal: ["Normal", "#2F8FE0", "bajo"], sin_datos: ["Sin estación", "#7FB8D6", "sin"],
};
const H = { rios: null, fichas: null, mon: null, cuencas: null, hist: null };

/* ── Carga ──────────────────────────────────────────────────────────────── */
let promesaRios = null;
function asegurarRiosANA(){
  promesaRios ??= Promise.all([traerOpcional("datos/geo/rios_ana.geojson"), traerOpcional("datos/geo/rios_ana.json"),
    traerOpcional("datos/rios/monitoreo.json"), traerOpcional("datos/geo/cuencas.geojson")])
    .then(([g, f, m, c]) => { H.rios = g; H.fichas = f?.rios || {}; H.mon = m || { rios: {}, conteo: {} }; H.cuencas = c; });
  return promesaRios;
}
const estadoDe = rid => H.mon?.rios?.[rid]?.estado || "sin_datos";

// Glaciares y lagunas oficiales: reemplazan a los de OpenStreetMap, que son incompletos
function lugaresOficiales(lugares, hidro){
  if (!hidro) return lugares;
  const pt = (lon, lat) => ({ type: "Point", coordinates: [lon, lat] });
  const nuevos = [
    ...hidro.glaciar.map(([lon, lat, n, c, a, mn, mx]) => ({ type: "Feature", geometry: pt(lon, lat),
      properties: { tipo: "glaciar", nombre: n, cordillera: hidro.cordilleras[c], area_km2: a, alt_min: mn, alt_max: mx, fuente: hidro.fuentes.glaciar } })),
    ...hidro.laguna_glaciar.map(([lon, lat, n, c, a, alt]) => ({ type: "Feature", geometry: pt(lon, lat),
      properties: { tipo: "laguna_glaciar", nombre: n, cordillera: hidro.cordilleras[c], area_km2: a, altitud: alt, fuente: hidro.fuentes.laguna_glaciar } })),
    ...hidro.laguna.map(([lon, lat, n, cu]) => ({ type: "Feature", geometry: pt(lon, lat),
      properties: { tipo: "laguna", nombre: n, cuenca: hidro.cuencas[cu], fuente: hidro.fuentes.laguna } })),
  ];
  // El distrito de cada punto oficial: el del lugar de OpenStreetMap más cercano no sirve; se deja vacío
  // y la ficha lo ubica al abrirse
  lugares.features = [...lugares.features.filter(f => !["glaciar", "laguna"].includes(f.properties.tipo)), ...nuevos];
  return lugares;
}

/* ── Capas del mapa ─────────────────────────────────────────────────────── */
async function agregarRiosANA(mapa, antes){
  await asegurarRiosANA();
  if (!H.rios) return;
  const colores = ["match", ["get", "rio"]];
  const seguidos = Object.keys(H.mon.rios || {}).filter(k => H.mon.rios[k].estado !== "sin_datos");
  for (const [rid, r] of Object.entries(H.mon.rios || {})) colores.push(rid, ESTADO_RIO[r.estado][1]);
  colores.push(ESTADO_RIO.sin_datos[1]);
  if (H.cuencas){
    mapa.addSource("cuencas", { type: "geojson", data: H.cuencas, promoteId: "id" });
    mapa.addLayer({ id: "cuencas-fill", type: "fill", source: "cuencas", layout: { visibility: "none" }, paint: { "fill-color": "rgba(0,0,0,0)" } }, antes);
    mapa.addLayer({ id: "cuencas-borde", type: "line", source: "cuencas", layout: { visibility: "none" },
      paint: { "line-color": "#C9A227", "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.6, 9, 1.6], "line-opacity": 0.8 } }, antes);
    mapa.addLayer({ id: "cuencas-txt", type: "symbol", source: "cuencas", minzoom: 6.5, layout: { visibility: "none", "text-field": ["get", "nombre"],
      "text-font": ["Noto Sans Regular"], "text-size": 11 }, paint: { "text-color": "#E8D9A0", "text-halo-color": "#16222A", "text-halo-width": 1.2 } });
  }
  mapa.addSource("rios-ana", { type: "geojson", data: H.rios });
  // Borde oscuro bajo cada río: así se distingue sobre cualquier capa de colores (lluvia, riesgo, mar)
  const ancho = (base, seg) => ["interpolate", ["linear"], ["zoom"],
    4, ["case", ["in", ["get", "rio"], ["literal", seguidos]], 2 + seg, ["match", ["get", "tipo"], "río", 1.1 + base, 0.6 + base]],
    9, ["case", ["in", ["get", "rio"], ["literal", seguidos]], 4.5 + seg, ["match", ["get", "tipo"], "río", 3 + base, 1.6 + base]]];
  mapa.addLayer({ id: "rios-ana-borde", type: "line", source: "rios-ana", layout: { visibility: "none", "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#0B1217", "line-opacity": 0.75, "line-width": ancho(1.6, 2.2) } }, antes);
  mapa.addLayer({ id: "rios-ana", type: "line", source: "rios-ana", layout: { visibility: "none", "line-cap": "round", "line-join": "round" },
    paint: { "line-color": colores,
      "line-opacity": ["case", ["in", ["get", "rio"], ["literal", seguidos]], 1, 0.8],
      "line-width": ["interpolate", ["linear"], ["zoom"],
        4, ["case", ["in", ["get", "rio"], ["literal", seguidos]], 2, ["match", ["get", "tipo"], "río", 1.1, 0.6]],
        9, ["case", ["in", ["get", "rio"], ["literal", seguidos]], 4.5, ["match", ["get", "tipo"], "río", 3, 1.6]]] } }, antes);
  mapa.addLayer({ id: "rios-ana-sel", type: "line", source: "rios-ana", filter: ["==", ["get", "rio"], ""],
    paint: { "line-color": "#FFFFFF", "line-width": ["interpolate", ["linear"], ["zoom"], 4, 3, 9, 6], "line-opacity": 0.85 } }, "rios-ana");
  mapa.addLayer({ id: "rios-ana-txt", type: "symbol", source: "rios-ana", minzoom: 6, filter: ["==", ["get", "tipo"], "río"], layout: { visibility: "none", "symbol-placement": "line",
    "text-field": ["get", "nombre"], "text-font": ["Noto Sans Regular"], "text-size": 11 },
    paint: { "text-color": "#CFE6F2", "text-halo-color": "#16222A", "text-halo-width": 1.4 } });
  mapa.on("mousemove", "rios-ana", e => {
    const p = e.features[0].properties, f = H.fichas[p.rio];
    mapa.getCanvas().style.cursor = "pointer";
    tipMapa(e.point, p.nombre, `${ESTADO_RIO[estadoDe(p.rio)][0]}${f ? ` · ${f.cuenca} · ${f.long_km} km` : ""} · toca para su ficha`);
  });
  mapa.on("mouseleave", "rios-ana", () => { $("#tip").style.opacity = 0; mapa.getCanvas().style.cursor = ""; });
  aplicarRiosANA();
}

function aplicarRiosANA(){
  if (!M.mapa?.getLayer("rios-ana")) return;
  const v = k => k ? "visible" : "none";
  for (const l of ["rios-ana-borde", "rios-ana", "rios-ana-txt"]) M.mapa.setLayoutProperty(l, "visibility", v(M.riosAna));
  for (const l of ["cuencas-fill", "cuencas-borde", "cuencas-txt"]) if (M.mapa.getLayer(l)) M.mapa.setLayoutProperty(l, "visibility", v(M.cuencas));
  leyendaRiosANA();
}
// Leyenda de los ríos, debajo de la de la capa activa
function leyendaRiosANA(){
  const el = $("#leg-rios"); if (!el) return;
  if (!M.riosAna){ el.innerHTML = ""; return; }
  el.innerHTML = `<h4>Ríos y quebradas (ANA)</h4><div class="leg-rios">${["emergencia", "alerta", "vigilancia", "normal", "sin_datos"].map(k =>
    `<span><i style="background:${ESTADO_RIO[k][1]}"></i>${ESTADO_RIO[k][0]}</span>`).join("")}</div>
    <p class="leg-src">Estado según sus estaciones (ANA, SENAMHI) y el pronóstico GloFAS. Toca un río para su ficha. <button class="enlace" onclick="ir('rios')">Seguimiento</button></p>`;
}

function toggleRiosANA(){ M.riosAna = !M.riosAna; aplicarRiosANA(); pintarControles(); }
function toggleCuencas(){ M.cuencas = !M.cuencas; aplicarRiosANA(); pintarControles(); }

/* ── Historial de una estación ──────────────────────────────────────────── */
async function historial(){
  if (H.hist) return H.hist;
  try {
    const t = await (await fetch(recurso("datos/rios/historial_estaciones.csv"))).text();
    H.hist = {};
    for (const l of t.trim().split("\n").slice(1)){
      const [fh, est, v, a, e] = l.split(",");
      (H.hist[est] ??= []).push({ t: fh, v: +v, a: +a, e: +e });
    }
  } catch (e) { H.hist = {}; }
  return H.hist;
}
// Línea simple con los umbrales de alerta (naranja) y emergencia (rojo)
function lineaUmbral(xs, unidad){
  const W = 320, Hh = 110, T = 10, B = 18, vals = xs.map(x => x.v), um = xs[xs.length - 1];
  const crecida = um.e >= um.a;
  const hi = Math.max(...vals, crecida ? um.a * 1.05 : 0) * 1.05, lo = Math.min(0, ...vals);
  const x = i => xs.length === 1 ? W / 2 : 6 + i / (xs.length - 1) * (W - 12), y = v => T + (hi - v) / (hi - lo || 1) * (Hh - T - B);
  const d = xs.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.v).toFixed(1)}`).join("");
  const um_ = (v, c, n) => v <= hi && v >= lo ? `<line x1="0" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="${c}" stroke-dasharray="4 3"/><text x="${W - 2}" y="${y(v) - 3}" text-anchor="end" font-size="9" fill="${c}" font-family="IBM Plex Sans">${n}</text>` : "";
  return `<svg viewBox="0 0 ${W} ${Hh}" class="mini" role="img" aria-label="Historia del ${esc(unidad)}">
    ${um_(um.a, "#E18C3E", "alerta")}${um_(um.e, "#B4101C", "emergencia")}
    <path d="${d}" fill="none" stroke="#2A78D6" stroke-width="2"/>${xs.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.v)}" r="2.5" fill="#2A78D6"><title>${esc(p.t)}: ${String(p.v).replace(".", ",")} ${esc(unidad)}</title></circle>`).join("")}
    <text x="4" y="${Hh - 4}" font-size="9" fill="#84959A" font-family="IBM Plex Sans">${esc(xs[0].t.slice(0, 10))}</text>
    <text x="${W - 4}" y="${Hh - 4}" text-anchor="end" font-size="9" fill="#84959A" font-family="IBM Plex Sans">${esc(um.t.slice(0, 10))}</text></svg>`;
}

/* ── Ficha de un río ────────────────────────────────────────────────────── */
async function pintarFichaRioANA(rid){
  await asegurarRiosANA();
  const f = H.fichas[rid], m = H.mon.rios?.[rid] || { estado: "sin_datos", motivos: [], estaciones: [], obras: {}, emergencias: [] };
  if (!f) return;
  const turno = ++turnoFicha; marcarLugar(null);
  M.mapa.setFilter("rios-ana-sel", ["==", ["get", "rio"], rid]);
  M.mapa.fitBounds([[f.caja[0], f.caja[1]], [f.caja[2], f.caja[3]]], { padding: 60, maxZoom: 10, duration: 900 });
  const [n, color, clase] = ESTADO_RIO[m.estado];
  const hist = await historial();
  const anaEst = m.estaciones.filter(e => e.fuente === "ANA"), otras = m.estaciones.filter(e => e.fuente !== "ANA");
  const regs = f.regiones.map(r => M.datos.porId[r]?.nombre).filter(Boolean).join(", ");
  $("#panel").innerHTML = `<div class="grab"></div>
    <div class="p-head"><div class="miga">${esc(f.cuenca || "")} · ${esc(regs)}</div>
      <h2 class="h-lugar">${dibujo("rio", 24)} ${esc(f.nombre)}</h2>
      <div class="zone">${esc(f.tipo === "río" ? "Río" : "Quebrada")} · ${String(f.long_km).replace(".", ",")} km · ${esc(f.vertiente || "")}</div>
      <p class="f-lectura"><span class="chip ${clase}">${n}</span> ${m.motivos.length ? esc(m.motivos.join("; ")) + "." : m.estado === "sin_datos" ? "Este río no tiene estaciones cerca: no se puede seguir con datos medidos." : "Sus estaciones están dentro de lo normal."}${m.nivel_bajo ? " Hay estaciones con nivel bajo." : ""}</p>
    </div>
    ${anaEst.length ? `<section class="f-sec"><h3>${dibujo("rio")} Caudal o nivel medido (ANA)</h3>
      ${anaEst.map(e => { const xs = hist[`ANA|${e.nombre}|${f.nombre.replace(/^Río\s+/i, "")}`] || hist[Object.keys(hist).find(k => k.startsWith(`ANA|${e.nombre}|`))] || [];
        return `<div class="est-ana"><div class="rank-f"><span><b>${esc(e.nombre)}</b> <small>${esc((e.tendencia || "").toLowerCase())}, ${esc(e.hora || "")}</small></span>
          <span>${String(e.valor).replace(".", ",")} ${esc(e.unidad || "")} ${e.estado === "normal" ? chipNivel("normal") : `<span class="chip ${e.estado === "emergencia" ? "muyalto" : "alto"}">${e.estiaje ? "Nivel bajo" : e.estado === "emergencia" ? "Emergencia" : "Alerta"}</span>`}</span></div>
          <div class="umbral"><i style="width:${Math.min(100, e.valor / Math.max(e.alerta, e.emergencia) * 100)}%"></i><b style="left:${Math.min(100, e.alerta / Math.max(e.alerta, e.emergencia) * 100)}%" title="Alerta"></b></div>
          <small class="f-nota">Umbral de alerta ${String(e.alerta).replace(".", ",")}, de emergencia ${String(e.emergencia).replace(".", ",")} ${esc(e.unidad || "")}${e.estiaje ? " (umbrales de nivel bajo)" : ""}.</small>
          ${xs.length >= 2 ? lineaUmbral(xs.slice(-60), e.unidad || "") : `<small class="f-nota">La historia se arma con cada lectura diaria: ${xs.length} hasta hoy.</small>`}</div>`; }).join("")}
      <p class="f-fuente">ANA, reporte nacional de caudales y niveles.</p></section>` : ""}
    ${otras.length ? `<section class="f-sec"><h3>${dibujo("ojo")} Otras estaciones y pronóstico</h3>
      ${otras.map(e => e.fuente === "SENAMHI"
        ? `<div class="rank-f"><span><b>${esc(e.nombre)}</b> <small>SENAMHI, ${esc(e.variable || "")}</small></span><span class="chip ${{ amarillo: "medio", naranja: "alto", rojo: "muyalto" }[e.nivel] || "bajo"}">${esc(e.nivel)}</span></div>`
        : `<div class="rank-f" onclick="pintarFichaRio('${esc(e.id)}')"><span><b>${esc(e.nombre)}</b> <small>GloFAS: hoy ${entero(Math.round(e.hoy))} m³/s, pico ${entero(Math.round(e.pico))} el ${fecha(e.fecha_pico)}</small></span><span>${chipNivel(e.nivel)}</span></div>`).join("")}
    </section>` : ""}
    <section class="f-sec" id="fl-caudal"><h3>${dibujo("rio")} Caudal del río en este punto</h3><p class="f-nota">Consultando…</p></section>
    <section class="f-sec"><h3>${dibujo("casa")} Junto al río</h3>
      <dl class="f-grid">
        <div><dt>Personas a menos de 1 km del cauce</dt><dd>${entero(f.personas)}</dd><small>${entero(f.poblados)} centros poblados</small></div>
        <div><dt>Obras de prevención de la ANA</dt><dd>${entero(m.obras?.total || 0)}</dd><small>${m.obras?.total ? `${m.obras.ejecutadas} ejecutadas, ${m.obras.en_ejecucion} en ejecución; avance medio ${String(m.obras.avance_medio ?? "–").replace(".", ",")} %` : "Ninguna a menos de 2 km"}</small></div>
        <div><dt>Emergencias a menos de 3 km, 7 días</dt><dd>${entero(m.emergencias?.length || 0)}</dd><small>INDECI</small></div>
      </dl>
      ${f.mayores.length ? `<h4>Centros poblados más grandes junto al río</h4>${barrasH(f.mayores.slice(0, 8).map(([nm, p]) => ({ n: nm, v: p })))}` : ""}
      ${(m.emergencias || []).map(e => `<div class="f-aviso"><b>${esc(e.peligro)}</b> en ${esc(e.lugar)}<small>${esc(e.fecha)} ${e.pdf ? `· <a href="${esc(e.pdf)}" target="_blank" rel="noopener">reporte</a>` : ""}</small></div>`).join("")}
      ${m.obras?.total ? `<p><button class="enlace" onclick="M.pcs=true;aplicarCapa()">Ver las obras en el mapa</button></p>` : ""}
      <p class="f-fuente">Centros poblados: INEI. Obras: ANA, puntos críticos 2026. Distancias medidas al cauce dibujado por la ANA.</p></section>
    <section class="f-sec"><h3>${dibujo("libro")} Datos del río</h3><dl class="f-grid">
      <div><dt>Cuenca</dt><dd class="dd-txt">${esc(f.cuenca || "–")}</dd></div><div><dt>Autoridad del agua</dt><dd class="dd-txt">AAA ${esc(f.aaa || "–")}</dd></div>
      <div><dt>Tramos</dt><dd>${f.tramos.length}</dd></div><div><dt>Categoría de calidad (ECA)</dt><dd class="dd-txt">${esc(f.categorias.join(", ") || "–")}</dd></div></dl>
      <p class="f-fuente">ANA, ríos y quebradas categorizados.</p></section>`;
  $("#panel").classList.add("up"); $("#panel").scrollTop = 0;
  fichaCaudal(f.centro, turno);
}

/* ── Ficha de una cuenca ────────────────────────────────────────────────── */
async function pintarFichaCuenca(cid){
  await asegurarRiosANA();
  const c = H.cuencas.features.find(x => x.properties.id === cid)?.properties; if (!c) return;
  turnoFicha++; marcarLugar(null);
  const rios = Object.entries(H.fichas).filter(([, f]) => f.cuenca === c.nombre).sort((a, b) => (ORDEN_EST[estadoDe(b[0])] - ORDEN_EST[estadoDe(a[0])]) || b[1].long_km - a[1].long_km);
  const pers = rios.reduce((s, [, f]) => s + f.personas, 0);
  $("#panel").innerHTML = `<div class="grab"></div>
    <div class="p-head"><div class="miga">${esc(c.vertiente || "")}</div><h2>${esc(c.nombre)}</h2>
      <div class="zone">${entero(c.area)} km² · ${rios.length} ríos y quebradas en el inventario</div></div>
    <section class="f-sec"><h3>${dibujo("rio")} Sus ríos</h3>
      ${rios.slice(0, 25).map(([rid, f]) => `<div class="rank-f" onclick="pintarFichaRioANA('${rid}')"><span><b>${esc(f.nombre)}</b> <small>${String(f.long_km).replace(".", ",")} km${f.personas ? `, ${entero(f.personas)} personas junto al cauce` : ""}</small></span><span class="chip ${ESTADO_RIO[estadoDe(rid)][2]}">${ESTADO_RIO[estadoDe(rid)][0]}</span></div>`).join("") || `<p class="f-nota">Sin ríos del inventario en esta cuenca.</p>`}
      <p class="f-fuente">${entero(pers)} personas viven a menos de 1 km de estos cauces. ANA e INEI.</p></section>`;
  $("#panel").classList.add("up"); $("#panel").scrollTop = 0;
}
const ORDEN_EST = { emergencia: 4, alerta: 3, vigilancia: 2, normal: 1, sin_datos: 0 };

/* ── Vista «Ríos»: el seguimiento ───────────────────────────────────────── */
let filtroRios = { estado: "seguidos", region: "", texto: "" };
async function pintarVistaRios(){
  await asegurarDatos(); await asegurarRiosANA();
  const m = H.mon, c = m.conteo || {};
  const seguidos = Object.keys(H.fichas).filter(k => estadoDe(k) !== "sin_datos").length;
  const nb = Object.values(m.rios || {}).filter(r => r.nivel_bajo).length;
  const obras = Object.values(m.rios || {}).reduce((s, r) => s + (r.obras?.total || 0), 0);
  $("#rios-kpis").innerHTML = [
    tarjetaKpi("Ríos con estaciones", entero(seguidos), `de ${entero(Object.keys(H.fichas).length)} del inventario de la ANA`, null),
    tarjetaKpi("En emergencia o alerta", entero((c.emergencia || 0) + (c.alerta || 0)), "ANA y SENAMHI", "setFiltroRios('estado','alerta')"),
    tarjetaKpi("En vigilancia", entero(c.vigilancia || 0), "SENAMHI amarillo o crecida pronosticada", "setFiltroRios('estado','vigilancia')"),
    tarjetaKpi("Con nivel bajo", entero(nb), "Umbrales de estiaje", "setFiltroRios('estado','bajo')"),
  ].join("");
  const regiones = M.datos.unidades.filter(u => u.nivel === "region").sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  if (!$("#rios-region").options.length) $("#rios-region").innerHTML = `<option value="">Todas las regiones</option>` + regiones.map(u => `<option value="${u.id}">${esc(u.nombre)}</option>`).join("");
  $("#rios-estado").innerHTML = [["seguidos", "Con estaciones"], ["alerta", "Emergencia o alerta"], ["vigilancia", "Vigilancia"], ["bajo", "Nivel bajo"], ["obras", "Con obras"], ["todos", "Todos"]]
    .map(([k, n]) => `<button aria-pressed="${filtroRios.estado === k}" onclick="setFiltroRios('estado','${k}')">${n}</button>`).join("");
  const t = norm(filtroRios.texto);
  const filas = Object.entries(H.fichas).filter(([rid, f]) => {
    const r = m.rios?.[rid], e = estadoDe(rid);
    if (filtroRios.region && !f.regiones.includes(filtroRios.region)) return false;
    if (t && !norm(f.nombre).includes(t) && !norm(f.cuenca).includes(t)) return false;
    return { seguidos: e !== "sin_datos", alerta: e === "alerta" || e === "emergencia", vigilancia: e === "vigilancia", bajo: r?.nivel_bajo,
      obras: r?.obras?.total > 0, todos: true }[filtroRios.estado];
  }).sort((a, b) => (ORDEN_EST[estadoDe(b[0])] - ORDEN_EST[estadoDe(a[0])]) || b[1].personas - a[1].personas);
  $("#rios-tabla").innerHTML = `<tr><th>Río</th><th>Región</th><th>Estado</th><th>Medición más reciente</th><th>Pronóstico GloFAS</th><th>Obras ANA</th><th>Personas junto al cauce</th></tr>`
    + filas.slice(0, 200).map(([rid, f]) => {
      const r = m.rios?.[rid] || {}, e = estadoDe(rid), ana = (r.estaciones || []).find(x => x.fuente === "ANA"), g = (r.estaciones || []).find(x => x.fuente === "GloFAS");
      const sen = (r.estaciones || []).find(x => x.fuente === "SENAMHI");
      return `<tr tabindex="0" onclick="abrirRio('${rid}')" onkeydown="if(event.key==='Enter')abrirRio('${rid}')">
        <td><b>${esc(f.nombre)}</b><small class="sub-td">${esc(f.cuenca || "")}</small></td>
        <td>${esc(f.regiones.map(x => M.datos.porId[x]?.nombre).filter(Boolean).join(", "))}</td>
        <td><span class="chip ${ESTADO_RIO[e][2]}">${ESTADO_RIO[e][0]}</span>${r.nivel_bajo ? ` <span class="chip alto">Nivel bajo</span>` : ""}</td>
        <td>${ana ? `${esc(ana.nombre)}: ${String(ana.valor).replace(".", ",")} ${esc(ana.unidad || "")} <small class="sub-td">alerta ${String(ana.alerta).replace(".", ",")} · ${esc((ana.tendencia || "").toLowerCase())}</small>` : sen ? `${esc(sen.nombre)}: ${esc(sen.nivel)} <small class="sub-td">SENAMHI</small>` : "–"}</td>
        <td>${g ? `${entero(Math.round(g.pico))} m³/s el ${fecha(g.fecha_pico)} ${chipNivel(g.nivel)}` : "–"}</td>
        <td>${r.obras?.total ? `${r.obras.total} <small class="sub-td">avance ${String(r.obras.avance_medio ?? "–").replace(".", ",")} %</small>` : "–"}</td>
        <td>${f.personas ? entero(f.personas) : "–"}</td></tr>`; }).join("");
  $("#rios-nota").textContent = `${filas.length} ríos${filas.length > 200 ? "; se muestran los 200 primeros" : ""}. Ordenados por estado y por la gente que vive junto al cauce.`;
  // Cómo va: cambios de estado frente a la lectura del día anterior
  try {
    const t2 = await (await fetch(recurso("datos/rios/historial.csv"))).text();
    const filasH = t2.trim().split("\n").slice(1).map(l => l.split(","));
    const fechas = [...new Set(filasH.map(x => x[0]))].sort();
    const [ayer, hoy] = fechas.slice(-2);
    const de = f => Object.fromEntries(filasH.filter(x => x[0] === f).map(x => [x[1], x[2]]));
    const A = de(ayer), Bb = de(hoy);
    const cambios = fechas.length < 2 ? [] : Object.keys({ ...A, ...Bb }).filter(k => (A[k] || "sin_datos") !== (Bb[k] || "sin_datos"));
    $("#rios-cambios").innerHTML = fechas.length < 2 ? `<p class="f-nota">El seguimiento empezó el ${fecha(fechas[0] || hoy)}: desde mañana aquí se verá qué ríos cambiaron de estado.</p>`
      : cambios.length ? cambios.map(k => `<div class="rank-f" onclick="abrirRio('${k}')"><span><b>${esc(H.fichas[k]?.nombre || k)}</b> <small>${esc(H.fichas[k]?.cuenca || "")}</small></span><span>${ESTADO_RIO[A[k] || "sin_datos"][0]} → <b>${ESTADO_RIO[Bb[k] || "sin_datos"][0]}</b></span></div>`).join("")
      : `<p class="f-nota">Ningún río cambió de estado entre el ${fecha(ayer)} y el ${fecha(hoy)}.</p>`;
  } catch (e) { $("#rios-cambios").innerHTML = ""; }
}
function setFiltroRios(k, v){ filtroRios[k] = v; pintarVistaRios(); }
function abrirRio(rid){
  ir("mapa");
  const f = () => M.listo && M.mapa.getLayer("rios-ana") ? (M.riosAna = true, aplicarRiosANA(), pintarControles(), pintarFichaRioANA(rid)) : setTimeout(f, 300); f();
}
Object.assign(window, { pintarFichaRioANA, pintarFichaCuenca, pintarVistaRios, setFiltroRios, abrirRio, toggleRiosANA, toggleCuencas });
