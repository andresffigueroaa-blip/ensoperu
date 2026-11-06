/* ════════════════════════════════════════════════════════════════════════
   ENSO PERÚ · boletin.js
   Boletín imprimible, del Perú o de una región, en cuatro partes:
     1. La región hoy   avisos, riesgo, emergencias, ríos, mar, lluvia, focos, agua
     2. El país hoy     ENFEN, índices, lo que reporta el Estado
     3. Noticias        de la región, nacionales e internacionales
     4. Lo que viene    SENAMHI por sector, tendencia estacional, ENFEN, NOAA
   Todo sale de los archivos que ya usa el sitio; cada cifra con su fuente.
   El boletín regional es siempre el de hoy; el nacional guarda uno por día.
   ════════════════════════════════════════════════════════════════════════ */

const CIUDAD_REGION = { Tumbes: "24", Piura: "20", Chiclayo: "14", Trujillo: "13", Lima: "15", Ica: "11", Arequipa: "04", Tacna: "23",
  Cajamarca: "06", Huaraz: "02", Huancayo: "12", Ayacucho: "05", Cusco: "08", Puno: "21", Iquitos: "16", Tarapoto: "22",
  Pucallpa: "25", "Puerto Maldonado": "17" };
const PALABRAS_VAGAS = new Set(["santa", "general", "mariscal", "padre", "del", "sur", "norte", "grande", "alto", "bajo", "san", "rio"]);
const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
let regionBol = "PE";
// Los últimos n días de una serie {fechas, cols}
const ultimos = (s, n, cols = s.cols) => ({ fechas: s.fechas.slice(-n), cols: Object.fromEntries(Object.entries(cols).map(([k, v]) => [k, v.slice(-n)])) });

// Barras horizontales con valor: [{n, v, txt, c}]
const barrasH = (xs, max) => { const m = max || Math.max(1, ...xs.map(x => x.v || 0));
  return `<div class="barras-h">${xs.map(x => `<div><span>${esc(x.n)}</span><i style="width:${Math.max(0.5, (x.v || 0) / m * 100)}%;background:${x.c || "#2A78D6"}"></i><b>${x.txt ?? entero(x.v)}</b></div>`).join("")}</div>`; };
// Columnas con valores, eje cero y etiquetas. Tamaño fijo: se lee igual en pantalla y en papel.
// op: u (unidad), dec, color(v, i), cada (cada cuántas columnas va la etiqueta), linea [valor, texto], alto
function columnas(v, etq, op = {}){
  const W = 440, H = op.alto || 190, T = 32, B = 40, L = 4, R = 4, n = v.length;
  const xs = v.filter(x => x !== null && x !== undefined);
  if (!xs.length) return `<p class="f-nota">Sin datos.</p>`;
  let hi = Math.max(0, ...xs, op.linea ? op.linea[0] : 0), lo = Math.min(0, ...xs);
  if (hi === lo) hi = lo + 1;
  const y = t => T + (hi - t) / (hi - lo) * (H - T - B), bw = (W - L - R) / n, cada = op.cada || 1;
  const fmt = x => (op.signo && x > 0 ? "+" : "") + Number(x).toFixed(op.dec || 0).replace(".", ",");
  const cols = v.map((x, i) => {
    if (x === null || x === undefined) return "";
    const y0 = y(0), y1 = y(x), col = op.color ? op.color(x, i) : "#2A78D6", cx = L + i * bw + bw / 2;
    const valor = n <= 14 ? `<text x="${cx}" y="${x >= 0 ? y1 - 4 : y1 + 12}" text-anchor="middle" class="cv">${fmt(x)}</text>` : "";
    return `<rect x="${(L + i * bw + bw * 0.12).toFixed(1)}" y="${Math.min(y0, y1).toFixed(1)}" width="${(bw * 0.76).toFixed(1)}" height="${Math.max(1, Math.abs(y1 - y0)).toFixed(1)}" rx="1.5" fill="${col}"><title>${esc(etq[i])}: ${fmt(x)} ${op.u || ""}</title></rect>${valor}`;
  }).join("");
  const etiquetas = etq.map((e, i) => i % cada === 0 || i === n - 1 ? `<text x="${L + i * bw + bw / 2}" y="${H - 10}" text-anchor="middle" class="ce">${esc(e)}</text>` : "").join("");
  const linea = op.linea ? `<line x1="${L}" x2="${W - R}" y1="${y(op.linea[0])}" y2="${y(op.linea[0])}" stroke="#D9452C" stroke-dasharray="4 3"/><text x="${W - R}" y="${y(op.linea[0]) - 4}" text-anchor="end" class="ce" fill="#D9452C">${esc(op.linea[1])}</text>` : "";
  return `<svg class="col-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(op.titulo || "Gráfico de columnas")}">
    <line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" stroke="#84959A"/>${cols}${linea}${etiquetas}
    ${op.u ? `<text x="${L}" y="12" class="ce">${esc(op.u)}</text>` : ""}</svg>`;
}

// Leyenda de colores
const leyendaColores = xs => `<div class="probs-ley">${xs.map(([c, n]) => `<span><i style="background:${c}"></i>${esc(n)}</span>`).join("")}</div>`;

const svgVacio = id => `<svg id="${id}" class="bol-svg" viewBox="0 0 1200 300" preserveAspectRatio="none"></svg><div class="leyenda" id="${id}-ley"></div>`;
const seccion = (n, titulo, cuerpo) => `<section class="bol-sec"><h2><span class="bol-num">${n}</span> ${titulo}</h2>${cuerpo}</section>`;
const kpis = xs => `<dl class="bol-kpis">${xs.filter(Boolean).map(([n, v, d]) => `<div><dt>${esc(n)}</dt><dd>${v}</dd>${d ? `<small>${esc(d)}</small>` : ""}</div>`).join("")}</dl>`;

async function iniciarBoletin(){
  await asegurarDatos(); await asegurarRiesgo(); await asegurarRiosANA();
  const sel = $("#bol-region");
  if (!sel.options.length){
    sel.innerHTML = `<option value="PE">Todo el Perú</option>` + M.datos.unidades.filter(u => u.nivel === "region")
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es")).map(u => `<option value="${u.id}">${esc(D.regiones.regiones[M.datos.claveRegion[u.id]]?.nombre || u.nombre)}</option>`).join("");
    const ind = await traerOpcional("datos/boletines/indice.json");
    $("#bol-fecha").innerHTML = (ind?.fechas || [D.panorama?.fecha]).slice().reverse().map(x => `<option value="${x}">${fecha(x)}</option>`).join("");
  }
  sel.value = regionBol;
  pintarBoletin();
}

async function pintarBoletin(){
  regionBol = $("#bol-region").value || "PE";
  const fec = $("#bol-fecha").value, hoy = !fec || fec === D.panorama?.fecha;
  $("#bol-fecha").disabled = regionBol !== "PE";
  $("#bol-fecha-nota").textContent = regionBol !== "PE" ? "El boletín regional es siempre el de hoy." : "";
  if (!hoy && regionBol === "PE") return boletinArchivado(fec);
  $("#boletin").innerHTML = `<p class="f-nota">Armando el boletín…</p>`;
  const [emerg, tsm, focos, oisst, clima] = await Promise.all([
    traerOpcional("datos/peru/emergencias.geojson"), traerCsv("datos/indices/tsm_costera_diaria.csv"),
    traerCsv("datos/indices/incendios_diarios.csv"), traerCsv("datos/indices/oisst_diario.csv"),
    regionBol !== "PE" ? traerOpcional(`datos/clima/${regionBol}.json`) : null]);
  const ctx = { emerg, tsm, focos, oisst, clima };
  const partes = regionBol === "PE" ? boletinNacional(ctx) : boletinRegional(regionBol, ctx);
  const nombre = regionBol === "PE" ? "Perú" : D.regiones.regiones[M.datos.claveRegion[regionBol]]?.nombre || M.datos.porId[regionBol].nombre;
  $("#boletin").innerHTML = `
    <header class="bol-cab">
      <div class="bol-marca"><span class="bol-logo"></span>ENSO Perú · Boletín</div>
      <h1>${regionBol === "PE" ? "Perú" : esc(nombre)}</h1>
      <div class="bol-meta"><span>${fecha(D.panorama.fecha)}</span><span class="bol-estado">${esc(D.estado.alerta.estado)}</span><span>Datos revisados ${haceCuanto()}</span></div>
      <nav class="bol-indice">${["La región hoy", "El país hoy", "Noticias", "Lo que viene"].map((n, i) => `<span><b>${i + 1}</b> ${regionBol === "PE" && i === 0 ? "El Perú hoy" : regionBol === "PE" && i === 1 ? "El Niño y el país" : n}</span>`).join("")}</nav>
    </header>
    ${partes.html}
    <footer class="bol-pie"><p>ENSO Perú reúne datos oficiales y de centros globales; no emite alertas ni pronósticos propios. Para decisiones operativas consulte al ENFEN, al SENAMHI, a INDECI y a su gobierno local.</p>
      <p>${esc(location.origin + location.pathname)}#boletin</p></footer>`;
  partes.graficos?.forEach(f => { try { f(); } catch (e) { console.error(e); } });
  $$("#boletin img").forEach(i => { i.loading = "eager"; });     // que estén cargadas al imprimir
}

// Al imprimir, una foto que no cargó se cambia por su dibujo en vez de quedar como un cuadro gris
window.addEventListener("beforeprint", () => $$("#boletin .not-foto img").forEach(i => {
  if (!i.complete || !i.naturalWidth) i.parentNode.classList.add("fallo");
}));
window.pintarBoletin = pintarBoletin;
window.iniciarBoletin = iniciarBoletin;

/* ── Piezas comunes ─────────────────────────────────────────────────────── */
function noticiasDe(filtro, n){
  const xs = (D.noticias?.noticias || []).filter(filtro);
  return [...xs.filter(x => x.imagen), ...xs.filter(x => !x.imagen)].slice(0, n);
}
const listaNoticias = xs => xs.length ? `<div class="bol-noticias">${xs.map(n => tarjetaNoticia(n, false)).join("")}</div>` : `<p class="f-nota">Sin noticias en los últimos días.</p>`;

function parteNoticias(rid){
  let deRegion = [];
  if (rid){
    const reg = M.datos.porId[rid];
    const terminos = [norm(D.regiones.regiones[M.datos.claveRegion[rid]]?.nombre || reg.nombre),
      ...M.datos.unidades.filter(u => u.nivel === "provincia" && u.region === rid).map(u => norm(u.nombre))]
      .filter(t => t.length >= 4 && !PALABRAS_VAGAS.has(t));
    const re = new RegExp(`\\b(${[...new Set(terminos)].map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`);
    deRegion = noticiasDe(n => re.test(norm(n.titulo)), 6);
  }
  const usados = new Set(deRegion.map(n => n.enlace));
  const nac = noticiasDe(n => n.ambito === "nacional" && !usados.has(n.enlace), rid ? 4 : 6);
  const intl = noticiasDe(n => n.ambito === "internacional", 4);
  return (rid ? `<h3>De la región</h3>${listaNoticias(deRegion)}` : "")
    + `<h3>Nacionales</h3>${listaNoticias(nac)}<h3>Internacionales</h3>${listaNoticias(intl)}`
    + `<p class="f-fuente">Titulares de la prensa, con enlace a cada medio. No son fuente oficial.</p>`;
}

// El país: ENFEN, índices y lo que reporta el Estado
function parteNacional(ctx, graficos, corta){
  const e = D.estado, I = e.indices || {}, O = D.oficial || {}, R = O.escenario?.resumen || {};
  const o = ctx.oisst;
  if (o){
    const r = ultimos(o, 120);
    graficos.push(() => {
      const s = [{ n: "Niño 1+2, frente a la costa", v: r.cols.n12, c: COLORES[1] }, { n: "Niño 3.4, Pacífico central", v: r.cols.n34, c: COLORES[0] }];
      grafLineas($("#bg-mar"), r.fechas, s, { umbrales: [[0.5, "#D9452C"]] }); leyenda($("#bg-mar-ley"), s);
    });
  }
  return `<p class="f-txt"><b>${esc(e.alerta.estado)}.</b> ${esc(oracion(e.alerta.titular || ""))}. ${corta ? "" : esc(e.alerta.resumen || "")}</p>
    <p class="f-fuente">${esc(e.alerta.fuente)}, ${fecha(e.alerta.fecha)}. Próximo comunicado: ${fecha(e.alerta.proximo)}.</p>
    ${kpis([["Mar, Niño 1+2", `${sg(I.n12?.valor)} °C`, `media de 7 días, ${fecha(I.n12?.fecha)}`], ["Mar, Niño 3.4", `${sg(I.n34?.valor)} °C`, `${fecha(I.n34?.fecha)}`],
      ["ICEN", sg(I.icen?.valor), `${I.icen?.magnitud || ""}, ${fecha(I.icen?.fecha)}`],
      O.coen && ["Emergencias, 7 días", entero(O.coen.total), "INDECI"],
      O.escenario?.vigente && ["Distritos en riesgo muy alto por lluvia", entero(R.MA?.distritos || 0), `${entero(R.MA?.poblacion || 0)} personas · CENEPRED`],
      O.emergencia && ["Distritos en estado de emergencia", entero(Object.keys(O.emergencia.distritos || {}).length), "PCM"]])}
    <h3>Temperatura del mar, últimos 4 meses</h3><div class="bol-graf">${svgVacio("bg-mar")}</div>
    <p class="f-fuente">Anomalía diaria frente a 1991-2020. NOAA OISST. La línea roja marca +0,5 °C.</p>
    ${corta ? "" : `<ul class="lectura">${(D.panorama.lectura || []).map(t => `<li>${esc(t)}</li>`).join("")}</ul>`}`;
}

// Lo que viene: SENAMHI por sector, ENFEN y NOAA
function parteProbabilidades(){
  const e = D.estado, P = e.probabilidades || {}, cpc = D.inter?.cpc;
  const filas = (P.n12 || []).slice(0, 6).map((f, i) => `<div class="pm-fila"><span>${nombreMes(P.meses[i])} ${String(P.meses[i]).slice(2, 4)}</span>
    <div class="pm-barra">${f.map((v, j) => v ? `<i style="width:${v}%;background:${COLOR_CAT[j]}"><span style="color:${TINTA_CAT[j]}">${v >= 12 ? v : ""}</span></i>` : "").join("")}</div></div>`).join("");
  return `<h3>ENFEN: magnitud esperada de El Niño costero, mes a mes</h3><div class="probs-m">${filas}</div>
    <div class="probs-ley">${(P.categorias_icen || []).map((c, j) => `<span><i style="background:${COLOR_CAT[j]}"></i>${esc(c)}</span>`).join("")}</div>
    <p class="f-fuente">Probabilidades del comunicado ${esc(P.comunicado || "")} del ENFEN.</p>
    ${cpc?.probabilidades ? `<h3>NOAA: probabilidad de El Niño en el Pacífico central, por trimestre</h3>
      <div class="probs-m">${cpc.probabilidades.slice(1, 7).map(p => `<div class="pm-fila"><span>${esc(p.trimestre)}</span><div class="pm-barra">${[["nina", "#1B6A87", "#fff"], ["neutral", "#C9D2CC", "#101A1D"], ["nino", "#D9452C", "#fff"]].map(([k, c, tc]) => p[k] ? `<i style="width:${p[k]}%;background:${c}"><span style="color:${tc}">${p[k] >= 10 ? p[k] : ""}</span></i>` : "").join("")}</div></div>`).join("")}</div>
      ${leyendaColores([["#1B6A87", "La Niña"], ["#C9D2CC", "Neutral"], ["#D9452C", "El Niño"]])}
      <p class="f-fuente">NOAA CPC, ${esc(cpc.estado_es)}, emitido el ${fecha(cpc.emitido)}. Trimestres en inglés: NDJ es noviembre a enero.</p>` : ""}`;
}

/* ── Boletín de una región ──────────────────────────────────────────────── */
function boletinRegional(rid, ctx){
  const d = M.datos, O = D.oficial || {}, P = D.panorama.regiones?.[rid] || {};
  const clave = d.claveRegion[rid], rj = D.regiones.regiones[clave] || {}, nombre = rj.nombre || d.porId[rid].nombre;
  const nNombre = norm(nombre).replace(/^callao$/, "callao");
  const graficos = [], frases = [];
  const enRegion = lugar => norm(String(lugar || "").split(",").pop()).trim() === nNombre;

  // Avisos del SENAMHI que nombran su zona
  const avisos = (D.avisos?.avisos || []).filter(a => a.regiones?.includes(clave) || a.zonas?.includes(rj.z));
  if (avisos.length) frases.push(`${avisos.length} ${avisos.length > 1 ? "avisos del SENAMHI tocan" : "aviso del SENAMHI toca"} la región, ${avisos.filter(a => a.nivel === "ROJO").length} en rojo.`);

  // Riesgo de hoy (CENEPRED), quebradas, emergencias, estado de emergencia
  const escD = Object.entries(O.escenario?.distritos || {}).filter(([u]) => u.startsWith(rid));
  const porNivel = k => escD.filter(([, v]) => v.nivel === k);
  const pobMA = porNivel("MA").reduce((a, [, v]) => a + (v.poblacion || 0), 0);
  if (porNivel("MA").length) frases.push(`CENEPRED: ${porNivel("MA").length} distritos en riesgo muy alto${porNivel("A").length ? ` y ${porNivel("A").length} en alto` : ""} por la lluvia de estos días (${entero(pobMA)} personas en muy alto).`);
  else if (porNivel("A").length) frases.push(`CENEPRED: ${porNivel("A").length} ${porNivel("A").length > 1 ? "distritos" : "distrito"} en riesgo alto por la lluvia de estos días.`);
  const queb = Object.entries(O.quebradas?.distritos || {}).filter(([u]) => u.startsWith(rid));
  if (queb.length) frases.push(`SENAMHI: posible activación de quebradas en ${queb.length} distritos.`);
  const em = (ctx.emerg?.features || []).filter(f => f.properties.distrito?.startsWith(rid)).map(f => f.properties);
  if (em.length) frases.push(`INDECI registró ${em.length} ${em.length > 1 ? "emergencias" : "emergencia"} en 7 días.`);
  const dee = Object.keys(O.emergencia?.distritos || {}).filter(u => u.startsWith(rid)).length;
  if (dee) frases.push(`${dee} distritos están en estado de emergencia.`);

  // Ríos: GloFAS, ANA y SENAMHI
  const riosG = (d.rios?.rios || []).filter(r => r.region === rid);
  const riosAna = (O.ana_rios?.estaciones || []).filter(e => enRegion(e.lugar));
  const riosSen = (O.phisis?.estaciones || []).filter(e => enRegion(e.lugar));
  const sobre = [...riosAna.filter(e => e.estado !== "normal"), ...riosSen.filter(e => e.nivel !== "normal")];
  // Ríos de la ANA en la región con estaciones, primero los que no están normales
  const riosANA = Object.entries(H.fichas || {}).filter(([k, f]) => f.regiones.includes(rid) && estadoDe(k) !== "sin_datos")
    .sort((a, b) => (ORDEN_EST[estadoDe(b[0])] - ORDEN_EST[estadoDe(a[0])]) || b[1].personas - a[1].personas).slice(0, 8);
  if (sobre.length) frases.push(`${sobre.length} estaciones de ríos están sobre su umbral.`);
  if (riosG.some(r => r.nivel !== "normal")) frases.push(`Crecida inusual pronosticada en ${riosG.filter(r => r.nivel !== "normal").map(r => r.nombre).join(", ")} (GloFAS).`);
  if (rj.c && P.mar !== null && P.mar !== undefined) frases.push(`El mar frente a la región está ${sg(P.mar)} °C sobre lo normal.`);
  if (P.lluvia16) frases.push(`Los modelos esperan ${Math.round(P.lluvia16)} mm de lluvia en 16 días.`);
  if (P.focos) frases.push(`${P.focos} ${P.focos > 1 ? "focos" : "foco"} de calor en 7 días.`);

  // Gráficos
  const provs = d.unidades.filter(u => u.nivel === "provincia" && u.region === rid)
    .map(u => ({ n: u.nombre, v: d.lluvia?.valores?.[u.id]?.total || 0 })).sort((a, b) => b.v - a.v);
  const lluviaProv = barrasH(provs.map(p => ({ ...p, txt: `${Math.round(p.v)} mm` })));
  const ll = d.lluvia?.valores?.[rid];
  const lluviaDia = ll ? columnas(ll.serie, d.lluvia.fechas.map(f => f.slice(8, 10)), { u: "mm por día", dec: 0, cada: 3, linea: [20, "20 mm"], color: v => v >= 20 ? "#1C5CAB" : "#86B6EF" }) : "";
  if (rj.c && ctx.tsm?.cols?.[clave]){
    const r = ultimos(ctx.tsm, 120, { v: ctx.tsm.cols[clave] });
    graficos.push(() => grafLineas($("#bg-tsm"), r.fechas, [{ n: `Mar frente a ${nombre}`, v: r.cols.v, c: COLORES[1] }], { umbrales: [[0, "#9FB0AC"]] }));
  }
  const hoyUTC = new Date().toISOString().slice(0, 10);
  if (ctx.focos && !ctx.focos._sinHoy){        // sin el día en curso, incompleto
    const nf = ctx.focos.fechas.filter(f => f < hoyUTC).length;
    ctx.focos = { fechas: ctx.focos.fechas.slice(0, nf), cols: Object.fromEntries(Object.entries(ctx.focos.cols).map(([k, v]) => [k, v.slice(0, nf)])), _sinHoy: true };
  }
  const fc = ctx.focos?.cols?.[rid];
  const focosDia = fc ? columnas(fc.slice(-30), ctx.focos.fechas.slice(-30).map(f => `${+f.slice(8, 10)}/${+f.slice(5, 7)}`), { u: "focos por día", cada: 5, color: () => "#E18C3E" }) : "";
  const embalses = (O.ana_embalses?.embalses || []).filter(e => enRegion(e.lugar) || norm(e.influencia) === nNombre);
  const ev = ctx.clima;
  const antecedentes = ev ? columnas([ev.normal_temporada, ...ev.eventos.map(x => x.lluvia)], ["Normal", ...ev.eventos.map(x => x.id)], { u: "mm, diciembre a abril", color: (v, i) => i === 0 ? "#B7C2BD" : "#2A78D6" }) : "";
  // Lluvia de los últimos 12 meses frente a lo normal de cada mes
  const rc = ev?.reciente, ultimos12 = rc ? rc.meses.map((m, i) => [m, rc.lluvia[i]]).filter(x => x[1] !== null).slice(-12) : [];
  const lluvia12 = ultimos12.length ? columnas(ultimos12.map(([m, v]) => Math.round(v - ev.normal.p[+m.slice(5, 7) - 1])), ultimos12.map(([m]) => nombreMes(m)),
    { u: "mm sobre o bajo lo normal", signo: true, color: v => v >= 0 ? "#2A78D6" : "#B8865B" }) : "";
  const riesgo = d.riesgo?.valores?.[rid];

  const parte1 = `
    <ul class="lectura">${frases.map(t => `<li>${esc(t)}</li>`).join("") || "<li>Sin avisos ni emergencias registradas para la región.</li>"}</ul>
    ${kpis([["Aviso del SENAMHI", P.aviso ? `<span class="chip ${NIVEL_AVISO[P.aviso]}">${esc(P.aviso[0] + P.aviso.slice(1).toLowerCase())}</span>` : "Ninguno", ""],
      ["Riesgo muy alto por lluvia", `${porNivel("MA").length} distritos`, "CENEPRED, aviso vigente"], ["Emergencias, 7 días", entero(em.length), "INDECI"],
      ["Lluvia próxima, 16 días", P.lluvia16 ? `${Math.round(P.lluvia16)} mm` : "–", "Open-Meteo"], rj.c ? ["Mar frente a la costa", `${sg(P.mar)} °C`, "NOAA OISST"] : ["Lluvia pasada, SPI-3", P.spi3 === null || P.spi3 === undefined ? "No aplica" : sg(P.spi3), P.spi3 === null || P.spi3 === undefined ? "temporada seca" : "últimos 3 meses con dato"],
      ["Focos de calor, 7 días", entero(P.focos), "NASA FIRMS"]])}
    ${avisos.length ? `<h3>Avisos del SENAMHI</h3>${avisos.map(a => `<div class="f-aviso"><span class="chip ${NIVEL_AVISO[a.nivel]}">${esc(a.nivel)}</span> ${esc(oracion(a.titulo))}<small>${fecha(a.inicio)} a ${fecha(a.fin)}</small></div>`).join("")}` : ""}
    <div class="cols-2">
      <div><h3>Lluvia esperada en 16 días, por provincia</h3>${lluviaProv}<p class="f-fuente">Open-Meteo, modelos globales.</p></div>
      <div><h3>Lluvia día a día en la región</h3>${lluviaDia}<p class="f-fuente">La línea marca 20 mm. Avisos oficiales: SENAMHI.</p>
        ${escD.length ? `<h3>Distritos en riesgo por la lluvia de estos días</h3>${barrasH([["MA", "Muy alto", "#B4101C"], ["A", "Alto", "#E18C3E"], ["M", "Medio", "#F0C178"]].map(([k, n, c]) => ({ n, v: porNivel(k).length, c })))}<p class="f-fuente">CENEPRED, escenario del aviso vigente.</p>` : ""}</div>
    </div>
    ${rj.c ? `<h3>Mar frente a ${esc(nombre)}, últimos 4 meses</h3><div class="bol-graf">${svgVacio("bg-tsm")}</div><p class="f-fuente">Anomalía en la franja a menos de 110 km del litoral. NOAA OISST.</p>` : ""}
    <div class="cols-2">
      <div><h3>Ríos</h3>
        ${riosG.map(r => `<div class="rank-f"><span><b>${esc(r.nombre)}</b> <small>${esc(r.lugar)}, pico ${entero(Math.round(r.pico))} m³/s el ${fecha(r.fecha_pico)}</small></span><span>${chipNivel(r.nivel)}</span></div>`).join("")}
        ${sobre.map(e => `<div class="rank-f"><span><b>${esc(e.rio ? "Río " + e.rio : e.estacion)}</b> <small>${esc(e.estacion || "")}</small></span><span class="chip alto">${e.estiaje ? "Nivel bajo" : "Sobre umbral"}</span></div>`).join("")}
        ${riosANA.length ? riosANA.map(([k, f]) => `<div class="rank-f"><span><b>${esc(f.nombre)}</b> <small>${esc(H.mon.rios[k]?.motivos?.[0] || "estaciones dentro de lo normal")}${f.personas ? `; ${entero(f.personas)} personas junto al cauce` : ""}</small></span><span class="chip ${ESTADO_RIO[estadoDe(k)][2]}">${ESTADO_RIO[estadoDe(k)][0]}</span></div>`).join("") : ""}
        ${!riosG.length && !sobre.length && !riosANA.length ? `<p class="f-nota">Sin ríos vigilados con crecida en la región.</p>` : ""}
        <p class="f-fuente">GloFAS (pronóstico), ANA y SENAMHI (observado). Seguimiento completo en la vista «Ríos».</p></div>
      <div>${embalses.length ? `<h3>Embalses</h3>${barrasH(embalses.map(e => ({ n: e.nombre, v: e.porcentaje, txt: `${String(e.porcentaje).replace(".", ",")} %`, c: "#5FA8D3" })), 100)}<p class="f-fuente">ANA, volumen útil almacenado.</p>` : ""}
        ${fc ? `<h3>Focos de calor por día, último mes</h3>${focosDia}<p class="f-fuente">NASA FIRMS.</p>` : ""}</div>
    </div>
    ${em.length ? `<h3>Emergencias recientes</h3>${em.slice(0, 4).map(x => `<div class="bul"><time>${fecha(x.fecha.slice(0, 10))}</time><p><b>${esc(x.peligro)}</b> en ${esc(x.lugar)}. ${esc(x.hechos.slice(0, 120))}${x.hechos.length > 120 ? "…" : ""}</p></div>`).join("")}${em.length > 4 ? `<p class="f-fuente">Y ${em.length - 4} más en los últimos 7 días. INDECI, COEN.</p>` : ""}` : ""}
    ${riesgo ? `<p class="f-txt">Riesgo estructural ante El Niño (CENEPRED): ${riesgo.inu?.niveles ? `${(riesgo.inu.niveles["Muy alto"] || 0) + (riesgo.inu.niveles.Alto || 0)} de ${riesgo.distritos} distritos en riesgo alto o muy alto por inundación` : ""}; ${entero(riesgo.inu?.viv)} viviendas expuestas.</p>` : ""}
    <div class="cols-2">
      ${lluvia12 ? `<div><h3>Lluvia de los últimos 12 meses frente a lo normal</h3>${lluvia12}<p class="f-fuente">NASA POWER, normal 1991-2020. Unos 50 km de resolución.</p></div>` : ""}
      ${antecedentes ? `<div><h3>Lluvia de diciembre a abril en años El Niño</h3>${antecedentes}<p class="f-fuente">NASA POWER, frente a lo normal 1991-2020.</p></div>` : ""}
    </div>`;

  // Lo que viene en la región
  const pr = O.prono || {}, sectores = pr.regiones?.[rid] || [];
  const sec = cual => sectores.map(([s, f]) => ({ ...(pr[cual] || []).find(x => x.sector.trim() === s.trim()), parte: f })).filter(x => x.sector);
  const es = d.estacional?.valores?.[rid];
  const zonas = ["W2", "W3"].map(s => (D.inter?.gth?.semanas?.[s]?.zonas || []).filter(z => z.ciudades?.some(c => CIUDAD_REGION[c] === rid))
    .map(z => `${{ WET: "más lluvia", DRY: "menos lluvia", WARM: "más calor", COLD: "más frío" }[z.tipo]}`).join(" y "));
  const meses = (d.estacional?.meses || []).map(m => `${nombreMes(m)} ${m.slice(2, 4)}`);
  const parte4 = `
    ${parteProbabilidades()}
    ${sec("trimestral").length ? `<h3>SENAMHI: lluvia de ${esc((pr.trimestral[0]?.periodo || "").toLowerCase())}, en los sectores de la región</h3>${terciles(sec("trimestral").map(s => ({ ...s, sector: `${s.sector} (${Math.round(s.parte * 100)} %)` })))}` : ""}
    ${sec("verano").length ? `<h3>SENAMHI: verano, ${esc((pr.verano[0]?.periodo || "").toLowerCase())}</h3>${terciles(sec("verano").map(s => ({ ...s, sector: `${s.sector} (${Math.round(s.parte * 100)} %)` })))}` : ""}
    ${sectores.length ? `<p class="f-fuente">SENAMHI, pronóstico climático por sector. Entre paréntesis, la parte de los distritos de la región en cada sector.</p>` : ""}
    ${es ? `<div class="cols-2">
      <div><h3>Lluvia mes a mes frente a lo normal</h3>${columnas(es.anom, meses, { u: "mm sobre o bajo lo normal", signo: true, color: v => v >= 0 ? "#2A78D6" : "#B8865B" })}</div>
      <div><h3>Temperatura del aire mes a mes frente a lo normal</h3>${columnas(es.t_anom, meses, { u: "°C sobre o bajo lo normal", dec: 1, signo: true, color: v => v >= 0 ? "#E18C3E" : "#1B6A87" })}</div>
    </div><p class="f-fuente">Modelo europeo ECMWF SEAS5, promedio de la región. Orienta la tendencia; el pronóstico oficial es el del SENAMHI, arriba.</p>` : ""}
    ${zonas.some(Boolean) ? `<p class="f-txt"><b>Próximas semanas (NOAA):</b> ${zonas[0] ? `semana 2, ${zonas[0]}` : ""}${zonas[0] && zonas[1] ? "; " : ""}${zonas[1] ? `semana 3, ${zonas[1]}` : ""}.</p>` : ""}`;

  return { graficos, html: seccion(1, "La región hoy", parte1) + seccion(2, "El país hoy", parteNacional(ctx, graficos, true))
    + seccion(3, "Noticias", parteNoticias(rid)) + seccion(4, "Lo que viene", parte4) };
}

/* ── Boletín nacional ───────────────────────────────────────────────────── */
function boletinNacional(ctx){
  const P = D.panorama, A = D.avisos?.avisos || [], O = D.oficial || {}, R = O.escenario?.resumen || {}, graficos = [];
  const tabla = (cab, filas) => `<div class="tabla-scroll"><table class="tabla">${`<tr>${cab.map(c => `<th>${c}</th>`).join("")}</tr>`}${filas.join("")}</table></div>`;
  const hoyUTC = new Date().toISOString().slice(0, 10), nf = ctx.focos ? ctx.focos.fechas.filter(f => f < hoyUTC).length : 0;
  const fc = ctx.focos ? { fechas: ctx.focos.fechas.slice(0, nf), cols: Object.fromEntries(Object.entries(ctx.focos.cols).map(([k, v]) => [k, v.slice(0, nf)])) } : null;
  const totalFocos = fc ? fc.fechas.map((_, i) => Object.values(fc.cols).reduce((a, s) => a + (s[i] || 0), 0)).slice(-30) : [];
  const porRegion = Object.entries(O.coen?.por_region || {}).map(([k, v]) => ({ n: D.regiones.regiones[M.datos.claveRegion[k]]?.nombre || k, v })).sort((a, b) => b.v - a.v).slice(0, 10);
  const parte1 = `
    ${A.length ? `<h3>Avisos del SENAMHI</h3>${tabla(["Nivel", "Aviso", "Vigencia"], A.map(a => `<tr><td><span class="chip ${NIVEL_AVISO[a.nivel]}">${esc(a.nivel)}</span></td><td>${esc(oracion(a.titulo))}</td><td>${fecha(a.inicio)} a ${fecha(a.fin)}</td></tr>`))}` : ""}
    <div class="cols-2">
      <div><h3>Emergencias en 7 días, por tipo</h3>${barrasH(Object.entries(O.coen?.por_peligro || {}).slice(0, 7).map(([n, v]) => ({ n, v })))}<p class="f-fuente">INDECI, COEN.</p></div>
      <div><h3>Emergencias en 7 días, por región</h3>${barrasH(porRegion)}<p class="f-fuente">INDECI, COEN.</p></div>
    </div>
    <div class="cols-2">
      <div><h3>Distritos en riesgo por la lluvia de estos días</h3>${O.escenario?.vigente ? barrasH([["MA", "Muy alto", "#B4101C"], ["A", "Alto", "#E18C3E"], ["M", "Medio", "#F0C178"]].map(([k, n, c]) => ({ n, v: R[k]?.distritos || 0, c, txt: `${R[k]?.distritos || 0} · ${entero(R[k]?.poblacion || 0)} personas` }))) : `<p class="f-nota">Sin aviso de lluvia vigente.</p>`}<p class="f-fuente">CENEPRED.</p></div>
      <div><h3>Focos de calor por día, último mes</h3>${totalFocos.length ? columnas(totalFocos, fc.fechas.slice(-30).map(f => `${+f.slice(8, 10)}/${+f.slice(5, 7)}`), { u: "focos por día", cada: 5, color: () => "#E18C3E" }) : ""}<p class="f-fuente">NASA FIRMS, todo el Perú.</p></div>
    </div>
    ${P.rios_altos?.length ? `<h3>Ríos con crecida pronosticada</h3>${tabla(["Río", "Lugar", "Pico en 15 días", "Nivel"], P.rios_altos.map(r => `<tr><td>${esc(r.nombre)}</td><td>${esc(r.lugar)}</td><td>${entero(Math.round(r.pico))} m³/s, ${fecha(r.fecha_pico)}</td><td>${chipNivel(r.nivel)}</td></tr>`))}<p class="f-fuente">GloFAS (Copernicus), modelo global: orienta, no mide.</p>` : ""}
    <div class="cols-2">
      <div><h3>Más lluvia próxima</h3>${barrasH(P.top_lluvia.slice(0, 8).map(r => ({ n: `${r.nombre} (${r.region})`, v: r.total, txt: `${Math.round(r.total)} mm` })))}</div>
      <div><h3>Más focos de calor</h3>${barrasH(P.top_focos.slice(0, 8).map(r => ({ n: `${r.nombre} (${r.region})`, v: r.focos, c: "#E18C3E" })))}</div>
    </div>`;
  const pr = O.prono || {};
  const parte4 = `${parteProbabilidades()}${pr.trimestral ? `<h3>SENAMHI: lluvia de ${esc((pr.trimestral[0]?.periodo || "").toLowerCase())}, por sector</h3>${terciles(pr.trimestral)}<p class="f-fuente">SENAMHI, emitido el ${fecha(pr.trimestral[0]?.emision)}.</p>` : ""}`;
  return { graficos, html: seccion(1, "El Perú hoy", parte1) + seccion(2, "El Niño y el país", parteNacional(ctx, graficos, false))
    + seccion(3, "Noticias", parteNoticias(null)) + seccion(4, "Lo que viene", parte4) };
}

// Boletines de días anteriores: solo lo que se archivó ese día
async function boletinArchivado(fec){
  const P = await traerOpcional(`datos/boletines/${fec}.json`);
  if (!P){ $("#boletin").innerHTML = "<p>Sin boletín para esa fecha.</p>"; return; }
  $("#boletin").innerHTML = `<header class="bol-cab"><div class="thermo"></div><h1>Boletín ENSO Perú</h1><p>${fecha(P.fecha)} · archivado</p></header>
    ${seccion(1, "Lo más importante", `<ul class="lectura">${P.lectura.map(t => `<li>${esc(t)}</li>`).join("")}</ul>`)}
    ${P.top_lluvia ? seccion(2, "Más lluvia esperada", barrasH(P.top_lluvia.slice(0, 8).map(r => ({ n: `${r.nombre} (${r.region})`, v: r.total, txt: `${Math.round(r.total)} mm` })))) : ""}`;
}
