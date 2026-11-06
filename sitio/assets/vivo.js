/* ════════════════════════════════════════════════════════════════════════
   ENSO PERÚ · vivo.js
   Dos vistas que reúnen lo que publican otros:
     «El Estado hoy»  INDECI, CENEPRED, SENAMHI, ANA, SUNASS, SERFOR, PCM, INAIGEM
     «Pronósticos»    ENFEN, SENAMHI, IGP, DHN, NOAA CPC, JMA, IRI, Copernicus, CIIFEN, WMO
   Datos: datos/peru/oficial.json y datos/pronosticos/internacional.json. Nada se
   recalcula aquí: cada cifra sale con su institución, su fecha y su enlace.
   ════════════════════════════════════════════════════════════════════════ */

const NIVEL_ESC = { MA: ["Muy alto", "muyalto"], A: ["Alto", "alto"], M: ["Medio", "medio"] };
const PREP = { adecuado: ["Adecuada", "bajo"], parcial: ["Parcial", "medio"], critico: ["Crítica", "muyalto"], sin_informacion: ["Sin información", "sin"] };
const SEMAFORO = { verde: "bajo", amarillo: "medio", naranja: "alto", rojo: "muyalto" };

const fuenteDe = (b, nombre) => b ? `<p class="f-fuente">${esc(nombre)}${b.leido ? `, leído ${fechaHora(b.leido)}` : ""}${b.atrasado ? " · ⚠ la última lectura falló; se muestra la anterior" : ""}. ${b.url ? `<a href="${esc(b.url)}" target="_blank" rel="noopener">Ver la fuente</a>` : ""}</p>` : "";
function fechaHora(iso){
  try { return new Date(iso).toLocaleString("es-PE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Lima" }); }
  catch (e) { return iso; }
}
const tarjetaKpi = (n, v, d, destino) => `<div ${destino ? `class="kpi-enl" tabindex="0" onclick="${destino}"` : ""}><dt>${esc(n)}</dt><dd>${v}</dd><small>${d}</small></div>`;

// Barras horizontales apiladas de tres categorías (bajo, normal, sobre)
function terciles(filas){
  return `<div class="terc">${filas.map(f => `<div class="terc-f"><span>${esc(f.sector)}</span>
    <div class="pm-barra"><i style="width:${f.bajo}%;background:#B8865B"><span>${f.bajo >= 12 ? f.bajo : ""}</span></i><i style="width:${f.normal}%;background:#C9D2CC"><span style="color:#101A1D">${f.normal >= 12 ? f.normal : ""}</span></i><i style="width:${f.sobre}%;background:#2A78D6"><span>${f.sobre >= 12 ? f.sobre : ""}</span></i></div></div>`).join("")}</div>
    <div class="probs-ley"><span><i style="background:#B8865B"></i>Bajo lo normal</span><span><i style="background:#C9D2CC"></i>Normal</span><span><i style="background:#2A78D6"></i>Sobre lo normal</span></div>`;
}

/* ── EL ESTADO HOY ──────────────────────────────────────────────────────── */
function pintarVivo(){
  const O = D.oficial;
  if (!O){ $("#vivo").innerHTML = `<p class="f-txt">Todavía no hay lectura de los servicios del Estado.</p>`; return; }
  const esc0 = O.escenario || {}, R = esc0.resumen || {}, coen = O.coen || {}, ph = O.phisis || {}, ar = O.ana_rios || {};
  const rios = (ph.sobre_umbral || 0) + (ar.en_alerta || 0) + (ar.en_emergencia || 0);
  const quebr = Object.keys(O.quebradas?.distritos || {}).length;
  const dee = Object.keys(O.emergencia?.distritos || {}).length;
  const lagunas = (O.inaigem?.estaciones || []).filter(e => e.semaforo !== "verde");

  $("#vivo-kpis").innerHTML = [
    tarjetaKpi("Emergencias registradas, 7 días", entero(coen.total), "INDECI, COEN", "document.getElementById('vivo-coen').scrollIntoView()"),
    tarjetaKpi("Distritos en riesgo muy alto por lluvia", esc0.vigente ? entero(R.MA?.distritos || 0) : "0", esc0.vigente ? `${entero(R.MA?.poblacion || 0)} personas · CENEPRED` : "Sin aviso de lluvia vigente", "document.getElementById('vivo-esc').scrollIntoView()"),
    tarjetaKpi("Distritos con posible activación de quebradas", entero(quebr), "SENAMHI", "abrirCapa('queb')"),
    tarjetaKpi("Estaciones de ríos sobre umbral", entero(rios), "SENAMHI y ANA", "document.getElementById('vivo-rios').scrollIntoView()"),
    tarjetaKpi("Distritos en estado de emergencia", entero(dee), Object.keys(O.emergencia?.decretos || {}).join(", ") || "PCM", "abrirCapa('dee')"),
    tarjetaKpi("Cortes de agua en curso", entero(O.agua?.total), `${entero(O.agua?.conexiones)} conexiones · SUNASS`, "document.getElementById('vivo-agua').scrollIntoView()"),
    tarjetaKpi("Incendios forestales, 7 días", entero(O.incendios?.total), "SERFOR", null),
    tarjetaKpi("Lagunas glaciares en vigilancia", `${lagunas.length} de ${(O.inaigem?.estaciones || []).length}`, lagunas.length ? `En ${lagunas.map(l => l.semaforo).join(", ")} · INAIGEM` : "Todas en verde · INAIGEM", null),
  ].join("");

  // Escenario de riesgo
  $("#vivo-esc").innerHTML = esc0.vigente ? `
    <p class="f-txt">El CENEPRED cruza cada aviso de lluvia del SENAMHI con la exposición de cada distrito. Vigentes: ${(esc0.escenarios || []).map(e => `<b>${esc(e.ambito.toLowerCase())}</b> hasta el ${fecha(e.fin_vigencia.slice(0, 10))}`).join("; ")}.</p>
    <div class="tabla-scroll"><table class="tabla"><tr><th>Riesgo</th><th>Distritos</th><th>Población</th><th>Viviendas</th></tr>
      ${["MA", "A", "M"].map(k => `<tr><td>${chipNivel(NIVEL_ESC[k][0])}</td><td>${entero(R[k]?.distritos || 0)}</td><td>${entero(R[k]?.poblacion || 0)}</td><td>${entero(R[k]?.vivienda || 0)}</td></tr>`).join("")}</table></div>
    <p><button class="enlace" onclick="abrirCapa('esc')">Verlos en el mapa</button></p>${fuenteDe(esc0, "CENEPRED, escenarios de riesgo por aviso meteorológico")}`
    : `<p class="f-txt">Hoy no hay un aviso de lluvia con escenario de riesgo vigente.</p>${fuenteDe(esc0, "CENEPRED")}`;

  // Emergencias COEN
  const pp = Object.entries(coen.por_peligro || {}).slice(0, 8), maxp = Math.max(1, ...pp.map(x => x[1]));
  $("#vivo-coen").innerHTML = `
    <div class="barras-h">${pp.map(([n, v]) => `<div><span>${esc(n)}</span><i style="width:${v / maxp * 100}%"></i><b>${v}</b></div>`).join("")}</div>
    <h3 class="h3-sep">Las más recientes</h3>
    ${(coen.ultimas || []).slice(0, 12).map(e => `<div class="bul"><time>${fecha(e.fecha.slice(0, 10))}</time><p><b>${esc(e.peligro)}</b> en ${esc(e.lugar)}. ${esc(e.hechos.slice(0, 220))}${e.hechos.length > 220 ? "…" : ""} ${e.pdf ? `<a href="${esc(e.pdf)}" target="_blank" rel="noopener">Reporte</a>` : ""} ${e.distrito ? `<button class="enlace" onclick="abrirLugar('${e.distrito}')">Ficha del distrito</button>` : ""}</p></div>`).join("")}
    ${fuenteDe(coen, "INDECI, Centro de Operaciones de Emergencia Nacional")}`;

  // Ríos
  const sobre = (ph.estaciones || []).filter(e => e.nivel !== "normal");
  const anaAl = (ar.estaciones || []).filter(e => e.estado !== "normal");
  const emb = [...(O.ana_embalses?.embalses || [])].filter(e => e.porcentaje !== null).sort((a, b) => b.porcentaje - a.porcentaje);
  $("#vivo-rios").innerHTML = `
    <div class="cols-2">
      <div><h3>Estaciones sobre su umbral</h3>
        ${sobre.length || anaAl.length ? [...sobre.map(e => { const av = (O.hidro?.avisos || []).find(a => a.estacion.toLowerCase() === e.estacion.toLowerCase());
          const baja = av && /descenso/i.test(av.titulo);
          return `<div class="rank-f"><span><b>${esc(e.estacion)}</b> <small>${esc(e.cuenca || "")}, ${esc(e.lugar)}${baja ? " · por descenso del nivel" : ""}</small></span><span class="chip ${{ amarillo: "medio", naranja: "alto", rojo: "muyalto" }[e.nivel] || "sin"}">${esc(e.nivel[0].toUpperCase() + e.nivel.slice(1))}</span></div>`; }),
          ...anaAl.map(e => `<div class="rank-f"><span><b>Río ${esc(e.rio)}</b> <small>${esc(e.estacion)}, ${esc(e.lugar)}: ${String(e.valor).replace(".", ",")} ${esc(e.unidad || "")}, ${esc((e.tendencia || "").toLowerCase())}</small></span><span><span class="chip ${e.estado === "emergencia" ? "muyalto" : "alto"}">${e.estiaje ? "Nivel bajo" : e.estado === "emergencia" ? "Emergencia" : "Alerta"}</span></span></div>`)].join("")
          : `<p class="f-txt">Ninguna estación está sobre su umbral ahora.</p>`}
        ${fuenteDe(ph, `SENAMHI, monitoreo hidrológico de ${(ph.estaciones || []).length} estaciones`)}${fuenteDe(ar, `ANA, reporte nacional de ${(ar.estaciones || []).length} estaciones`)}
        ${(O.hidro?.avisos || []).length ? `<h3 class="h3-sep">Avisos hidrológicos del SENAMHI</h3>${O.hidro.avisos.map(a => `<div class="f-aviso"><span class="chip ${NIVEL_AVISO[a.nivel] || "sin"}">${esc(a.nivel || "")}</span> ${esc(a.titulo)}<small>${esc(a.lugar)} · ${esc(a.fecha || "")}</small></div>`).join("")}` : ""}
      </div>
      <div><h3>Embalses: cuánta agua guardan</h3>
        <div class="barras-h embalses">${emb.map(e => `<div><span>${esc(e.nombre)} <small>${esc((e.lugar || "").split(",").pop().trim())}</small></span><i style="width:${Math.min(100, e.porcentaje)}%"></i><b>${String(e.porcentaje).replace(".", ",")} %</b></div>`).join("")}</div>
        ${fuenteDe(O.ana_embalses, `ANA, volumen útil almacenado al ${emb[0]?.fecha || ""}`)}</div>
    </div>`;

  // Prevención y preparación
  const pc = O.ana_pc || {}, pr = O.preparacion?.conteo || {}, totPr = Object.values(pr).reduce((a, b) => a + b, 0) || 1;
  $("#vivo-prev").innerHTML = `
    <div class="cols-2">
      <div><h3>Obras en puntos críticos de ríos</h3>
        <dl class="f-grid">${Object.entries(pc.por_estado || {}).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join("")}<div><dt>Avance medio en km</dt><dd>${String(pc.avance_medio ?? "–").replace(".", ",")} %</dd></div></dl>
        <p><button class="enlace" onclick="abrirCapa('pc')">Ver los ${entero(pc.total)} puntos en el mapa</button></p>${fuenteDe(pc, "ANA, puntos críticos priorizados 2026")}</div>
      <div><h3>Preparación de los distritos priorizados</h3>
        <div class="pm-barra pm-alto">${Object.entries(PREP).map(([k, [n]]) => pr[k] ? `<i style="width:${pr[k] / totPr * 100}%;background:${{ adecuado: "#3E8E7E", parcial: "#F0C178", critico: "#B4101C", sin_informacion: "#9FB0AC" }[k]}" title="${n}: ${pr[k]}"><span>${pr[k]}</span></i>` : "").join("")}</div>
        <div class="probs-ley">${Object.entries(PREP).map(([k, [n]]) => `<span><i style="background:${{ adecuado: "#3E8E7E", parcial: "#F0C178", critico: "#B4101C", sin_informacion: "#9FB0AC" }[k]}"></i>${n}</span>`).join("")}</div>
        <p class="f-txt">${entero(totPr)} distritos del decreto de prevención (DS 124-2026-PCM), según su comité de emergencia, brigadas y almacén.</p>
        <p><button class="enlace" onclick="abrirCapa('prep')">Ver en el mapa</button></p>${fuenteDe(O.preparacion, "Geoperú, PCM")}
        <h3 class="h3-sep">Estados de emergencia vigentes</h3>
        ${Object.entries(O.emergencia?.decretos || {}).map(([ds, d]) => `<p class="f-txt"><b>${esc(ds)}</b>: ${esc(d.peligro)}, ${entero(d.distritos)} distritos, del ${fecha(d.inicio)} al ${fecha(d.fin)}.</p>`).join("") || `<p class="f-txt">Sin decretos vigentes en el servicio consultado.</p>`}
        ${fuenteDe(O.emergencia, "PCM, publicado por la ANA")}</div>
    </div>`;

  // Agua, incendios y lagunas
  $("#vivo-agua").innerHTML = `
    <div class="cols-2">
      <div><h3>Cortes de agua más grandes</h3>
        ${(O.agua?.cortes || []).slice(0, 10).map(c => `<div class="rank-f"><span><b>${esc(c.lugar)}</b> <small>${esc(c.eps)} · ${esc(c.motivo)} · ${esc(c.tipo.toLowerCase())}</small></span><span>${entero(c.conexiones)} conexiones</span></div>`).join("")}
        ${fuenteDe(O.agua, "SUNASS, semáforo de interrupciones. Solo cortes iniciados en los últimos 30 días")}</div>
      <div><h3>Incendios forestales reportados</h3>
        ${(O.incendios?.lista || []).slice(0, 10).map(i => `<div class="rank-f"><span><b>${esc(i.lugar)}</b> <small>${esc(i.cobertura || "")}</small></span><span>${fecha(i.fecha)}</span></div>`).join("")}
        ${fuenteDe(O.incendios, "SERFOR. A diferencia de los focos de calor, son incendios confirmados")}
        <h3 class="h3-sep">Lagunas glaciares vigiladas</h3>
        ${(O.inaigem?.estaciones || []).map(e => `<div class="rank-f"><span><b>${esc(e.nombre)}</b> <small>${entero(e.altitud)} m</small></span><span class="chip ${SEMAFORO[e.semaforo] || "sin"}">${esc(e.semaforo || "")}</span></div>`).join("")}
        ${fuenteDe(O.inaigem, "INAIGEM, monitoreo de lagunas de origen glaciar")}</div>
    </div>`;

  // Últimos documentos
  $("#vivo-docs").innerHTML = `
    <div class="cols-2">
      <div><h3>Reportes del COEN</h3>${(O.indeci_rss?.reportes || []).slice(0, 10).map(r => `<div class="bul"><time>${r.fecha ? fechaHora(r.fecha + "Z") : ""}</time><p><a href="${esc(r.enlace)}" target="_blank" rel="noopener">${esc(r.titulo.replace(/^REPORTE COMPLEMENTARIO N\.[°º]\s*/i, "N.° "))}</a></p></div>`).join("")}</div>
      <div><h3>Documentos del ENFEN</h3>${(O.enfen_docs?.docs || []).slice(0, 10).map(d => `<div class="bul"><time>${fecha(d.fecha)}</time><p><a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.titulo)}</a></p></div>`).join("")}</div>
    </div>`;
}

// Abre el mapa con una capa del Estado
function abrirCapa(k){
  ir("mapa");
  const f = () => M.listo ? setCapaMapa(k) : setTimeout(f, 300); f();
}
window.abrirCapa = abrirCapa;

/* ── PRONÓSTICOS ────────────────────────────────────────────────────────── */
function pintarPronosticos(){
  const I = D.inter || {}, O = D.oficial || {}, e = D.estado, P = e.probabilidades || {};
  const cpc = I.cpc || {}, pr = O.prono || {}, igp = O.igp || {}, dhn = O.dhn || {};

  // Lo que dice cada centro, en una tabla
  const mesN12 = (P.n12 || []).map((f, i) => ({ mes: P.meses[i], fuerte: (f[6] || 0) + (f[7] || 0), nino: f.slice(4).reduce((a, b) => a + (b || 0), 0) }));
  const filas = [
    ["ENFEN (Perú)", "Comisión oficial", `${esc(e.alerta.estado)}. ${mesN12.length ? `Probabilidad de El Niño costero en ${nombreMes(mesN12[1]?.mes)}: ${mesN12[1]?.nino} %, fuerte o extraordinario ${mesN12[1]?.fuerte} %` : ""}`, e.alerta.fecha, e.alerta.url],
    ["SENAMHI (Perú)", "Pronóstico estacional", (pr.trimestral || []).filter(s => /Costa Norte|Sierra Sur Oriental|Altiplano/i.test(s.sector)).map(s => `${esc(s.sector)}: ${s.sobre >= s.bajo ? `${s.sobre} % de lluvia sobre lo normal` : `${s.bajo} % bajo lo normal`}`).join("; ") + ` (${esc((pr.trimestral || [])[0]?.periodo || "")})`, (pr.trimestral || [])[0]?.emision, pr.url],
    ["IGP (Perú)", "Modelo de inteligencia artificial", igp.prob_fuerte ? `Probabilidad de El Niño fuerte en el Pacífico oriental en ${igp.prob_fuerte.anio}: ${String(igp.prob_fuerte.clasificacion).replace(".", ",")} %` : "", null, igp.url],
    ["Marina, DHN (Perú)", "Observación diaria", dhn.nino12 ? `Niño 1+2: ${sg(dhn.nino12.atsm_actual)} °C; Niño 3.4: ${sg(dhn.nino34?.atsm_actual)} °C` : "", dhn.nino12?.atsm_fecha, dhn.url],
    ["NOAA CPC (EE. UU.)", "Oficial de EE. UU.", `${esc(cpc.estado_es || "")}. ${(cpc.probabilidades || []).slice(1, 4).map(p => `${p.trimestre}: ${p.nino} % El Niño`).join(", ")}`, cpc.emitido, cpc.url],
    ["JMA (Japón)", "Observación mensual", I.jma?.n12?.length ? `Niño 1+2 en ${nombreMes(I.jma.n12.at(-1).mes)}: ${sg(I.jma.n12.at(-1).valor)} °C` : "", I.jma?.n12?.at(-1)?.mes, I.jma?.url],
    ["CIIFEN (regional)", "Boletín", I.ciifen?.boletin_enso ? `<a href="${esc(I.ciifen.boletin_enso.url)}" target="_blank" rel="noopener">${esc(I.ciifen.boletin_enso.titulo.replace(/_/g, " "))}</a>` : "", I.ciifen?.boletin_enso?.fecha, I.ciifen?.url],
    ["OMM (mundial)", "Actualización", I.wmo ? `<a href="${esc(I.wmo.pdf || I.wmo.url)}" target="_blank" rel="noopener">${esc(I.wmo.titulo)}</a>` : "", null, I.wmo?.url],
  ];
  $("#pron-tabla").innerHTML = `<tr><th>Centro</th><th>Tipo</th><th>Qué dice</th><th>Emitido</th></tr>` + filas.filter(f => f[2]).map(f =>
    `<tr><td><b>${f[4] ? `<a href="${esc(f[4])}" target="_blank" rel="noopener">${esc(f[0])}</a>` : esc(f[0])}</b></td><td>${esc(f[1])}</td><td>${f[2]}</td><td>${f[3] ? fecha(String(f[3]).slice(0, 10)) : "–"}</td></tr>`).join("");

  // SENAMHI por sector
  $("#pron-senamhi").innerHTML = pr.trimestral ? `
    <h3>${esc(pr.trimestral[0]?.periodo || "")}</h3>${terciles(pr.trimestral)}
    ${pr.verano?.length ? `<h3 class="h3-sep">Verano: ${esc(pr.verano[0].periodo.toLowerCase())}</h3>${terciles(pr.verano)}` : ""}
    <p class="f-fuente">SENAMHI, pronóstico climático por sector, emitido el ${fecha(pr.trimestral[0]?.emision)}. Probabilidad de que la lluvia del periodo quede bajo, dentro o sobre su rango normal. <a href="${esc(pr.url)}" target="_blank" rel="noopener">Ver la fuente</a></p>` : `<p class="f-txt">Sin lectura del pronóstico del SENAMHI.</p>`;

  // CPC
  $("#pron-cpc").innerHTML = cpc.probabilidades ? `
    <p class="f-txt"><b>${esc(cpc.estado_es)}</b>. ${esc(cpc.sinopsis || "")}</p>
    ${cpc.probabilidades.map(p => `<div class="pm-fila"><span>${esc(p.trimestre)}</span><div class="pm-barra">${[["nina", "#1B6A87"], ["neutral", "#C9D2CC"], ["nino", "#D9452C"]].map(([k, c]) => p[k] ? `<i style="width:${p[k]}%;background:${c}"><span style="color:${k === "neutral" ? "#101A1D" : "#fff"}">${p[k] >= 10 ? p[k] : ""}</span></i>` : "").join("")}</div></div>`).join("")}
    <div class="probs-ley"><span><i style="background:#1B6A87"></i>La Niña</span><span><i style="background:#C9D2CC"></i>Neutral</span><span><i style="background:#D9452C"></i>El Niño</span></div>
    ${cpc.percentiles?.length ? `<p class="f-txt">Valor más probable del RONI (mediana): ${cpc.percentiles.slice(0, 5).map(p => `${p.trimestre} ${sg(p.p[3])}`).join(" · ")}.</p>` : ""}
    <p class="f-fuente">NOAA CPC, emitido el ${fecha(cpc.emitido)}; próximo el ${fecha(cpc.proxima)}. Trimestres móviles en inglés (OND: octubre a diciembre). <a href="${esc(cpc.url)}" target="_blank" rel="noopener">Ver la fuente</a></p>` : "";

  // Índices E y C del IGP; temperatura del mar de la DHN
  if (igp.e?.length){
    grafLineas($("#g-ec"), igp.e.map(x => x.mes), [{ n: "Índice E, Pacífico oriental", v: igp.e.map(x => x.valor), c: COLORES[1] }, { n: "Índice C, Pacífico central", v: igp.c.map(x => x.valor), c: COLORES[0] }], {});
    leyenda($("#g-ec-ley"), [{ n: "Índice E, Pacífico oriental", v: igp.e.map(x => x.valor), c: COLORES[1] }, { n: "Índice C, Pacífico central", v: igp.c.map(x => x.valor), c: COLORES[0] }]);
  }
  const at = dhn.nino12?.atsm;
  if (at?.length){
    const cl = Array.isArray(at[0]) ? at : at.map(x => [x.fecha, x.valor]);
    const sd = [{ n: "Niño 1+2, frente a la costa", v: cl.map(x => x[1]), c: COLORES[1] }, ...(dhn.nino34?.atsm?.length ? [{ n: "Niño 3.4, Pacífico central", v: dhn.nino34.atsm.map(x => Array.isArray(x) ? x[1] : x.valor), c: COLORES[0] }] : [])];
    grafLineas($("#g-dhn"), cl.map(x => x[0]), sd, {}); leyenda($("#g-dhn-ley"), sd);
  }

  // Subestacional
  const mj = I.mjo?.ultimo, g = I.gth?.semanas || {};
  const zonas = s => (g[s]?.zonas || []).filter(z => z.ciudades?.length).map(z => `${{ WET: "Más lluvia", DRY: "Menos lluvia", WARM: "Más calor", COLD: "Más frío" }[z.tipo]} en ${z.ciudades.join(", ")}`).join(". ");
  $("#pron-sub").innerHTML = `
    <dl class="f-grid">
      <div><dt>Oscilación Madden-Julian (MJO)</dt><dd>${mj ? String(mj.amplitud).replace(".", ",") : "–"}</dd><small>${mj ? `${mj.amplitud >= 1 ? "Activa" : "Débil"} al ${fecha(mj.fecha)}. Cuando está activa puede adelantar o frenar lluvias por semanas` : ""}</small></div>
      <div><dt>Semana 2${g.W2?.desde ? `, del ${fecha(g.W2.desde)} al ${fecha(g.W2.hasta)}` : ""}</dt><dd class="dd-txt">${zonas("W2") ? zonas("W2") : "Ninguna zona marcada sobre las ciudades del Perú"}</dd></div>
      <div><dt>Semana 3${g.W3?.desde ? `, del ${fecha(g.W3.desde)} al ${fecha(g.W3.hasta)}` : ""}</dt><dd class="dd-txt">${zonas("W3") ? zonas("W3") : "Ninguna zona marcada sobre las ciudades del Perú"}</dd></div>
    </dl>
    <p class="f-fuente">MJO: NOAA PSL, índice ROMI. Semanas 2 y 3: NOAA CPC, Global Tropics Hazards, emitido el ${fecha(g.W2?.emitido)}; marca zonas amplias, no lugares. <a href="${esc(I.gth?.url || "#")}" target="_blank" rel="noopener">Ver la fuente</a></p>`;

  // Galería de gráficos de los centros
  $("#pron-galeria").innerHTML = (I.imagenes || []).map(im => `<figure class="pron-fig">
    <a href="${recurso("datos/pronosticos/img/" + im.archivo)}" target="_blank" rel="noopener"><img loading="lazy" src="${recurso("datos/pronosticos/img/" + im.archivo)}" alt="${esc(im.titulo)}"></a>
    <figcaption><b>${esc(im.titulo)}</b><span>${esc(im.fuente)}${im.fecha ? ` · ${fecha(im.fecha)}` : ""}${im.atrasada ? " · ⚠ no se pudo renovar" : ""}</span></figcaption></figure>`).join("");
  const docs = [I.ciifen?.boletin_enso, I.ciifen?.estacional, I.ciifen?.oceano].filter(Boolean);
  $("#pron-docs").innerHTML = docs.map(d => `<div class="bul"><time>${fecha(d.fecha)}</time><p><a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.titulo.replace(/_/g, " "))}</a> <small>CIIFEN</small></p></div>`).join("")
    + (I.wmo ? `<div class="bul"><time></time><p><a href="${esc(I.wmo.pdf || I.wmo.url)}" target="_blank" rel="noopener">${esc(I.wmo.titulo)}</a> <small>OMM</small></p></div>` : "");
}
Object.assign(window, { pintarVivo, pintarPronosticos });
