/* ════════════════════════════════════════════════════════════════════════
   ENSO PERÚ · vistas.js
   Portada de situación, Comparar, Boletín, Noticias, guardados y tema.
   Lo cuenta todo el pipeline (datos/panorama.json, estado.json...): aquí solo
   se dibuja. Todo texto que viene de datos pasa por esc().
   ════════════════════════════════════════════════════════════════════════ */

/* ── Tema claro / oscuro ────────────────────────────────────────────────── */
function cambiarTema(){
  const r = document.documentElement;
  const oscuro = r.dataset.theme ? r.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  r.dataset.theme = oscuro ? "light" : "dark";
  try { localStorage.setItem("ensoperu_tema", r.dataset.theme); } catch (e) {}
}
window.cambiarTema = cambiarTema;

/* ── Guardados (solo en este navegador) ─────────────────────────────────── */
function guardados(){
  try { return JSON.parse(localStorage.getItem("ensoperu_guardados")) || { lugares: [], noticias: [] }; }
  catch (e) { return { lugares: [], noticias: [] }; }
}
function escribirGuardados(g){ try { localStorage.setItem("ensoperu_guardados", JSON.stringify(g)); } catch (e) {} }
function alternarLugar(id){
  const g = guardados(); const i = g.lugares.indexOf(id);
  if (i >= 0) g.lugares.splice(i, 1); else g.lugares.unshift(id);
  escribirGuardados(g); return i < 0;
}
function alternarNoticia(enlace){
  const g = guardados(); const i = g.noticias.findIndex(n => n.enlace === enlace);
  if (i >= 0) g.noticias.splice(i, 1);
  else { const n = D.noticias?.noticias.find(x => x.enlace === enlace); if (n) g.noticias.unshift(n); }
  escribirGuardados(g); pintarNoticias();
}
Object.assign(window, { alternarLugar, alternarNoticia });

/* ── Ayudas ─────────────────────────────────────────────────────────────── */
const NIVEL_CLASE = { normal: "bajo", elevado: "alto", bajo: "bajo", medio: "medio", alto: "alto", "muy alto": "muyalto", Bajo: "bajo", Medio: "medio", Alto: "alto", "Muy alto": "muyalto", "Muy bajo": "bajo" };
const chipNivel = (n, sinTexto = "sin dato") => !n ? `<span class="chip sin">${sinTexto}</span>`
  : `<span class="chip ${NIVEL_CLASE[n] || "sin"}">${esc(String(n)[0].toUpperCase() + String(n).slice(1))}</span>`;
const NIVEL_AVISO = { ROJO: "muyalto", NARANJA: "alto", AMARILLO: "medio" };
// Miles con espacio: con coma decimal, "1,044" se leería como uno coma cero
const entero = v => v === null || v === undefined ? "–" : Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 }).replace(/,/g, " ");
const decimal = v => String(v).replace(".", ",");
// En región o provincia el riesgo es el de su peor distrito: se dice cuántos hay, no un solo nivel
function riesgoCorto(r){
  if (!r) return null;
  if (!r.niveles) return r.riesgo ? chipNivel(r.riesgo) : null;
  const n = ["Muy alto", "Alto"].filter(k => r.niveles[k]).map(k => `${r.niveles[k]} en ${k.toLowerCase()}`);
  return n.length ? `${n.join(", ")} <small>(distritos)</small>` : "Sin distritos en alto";
}

function abrirLugar(id){ ir("mapa"); const f = () => M.listo ? elegirUnidad(id) : setTimeout(f, 300); f(); }
// Tiempo desde la última corrida del robot, para que se vea que está vivo
function haceCuanto(){
  const c = Object.values(D.meta?.fuentes || {}).map(f => f.corrida).filter(Boolean).sort().pop();
  if (!c) return "";
  const min = Math.max(0, Math.round((Date.now() - new Date(c)) / 6e4));
  return min < 60 ? `hace ${min} min` : min < 2880 ? `hace ${Math.round(min / 60)} h` : `hace ${Math.round(min / 1440)} días`;
}
window.abrirLugar = abrirLugar;

// El ENFEN escribe los titulares en mayúsculas: se pasan a oración
const oracion = t => (t.charAt(0) + t.slice(1).toLowerCase()).replace(/\bel niño/gi, "El Niño").replace(/\bla niña/gi, "La Niña").replace(/\benso\b/g, "ENSO");
const nombreMes = m => ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"][+String(m).slice(5, 7) - 1];

/* ── PORTADA ────────────────────────────────────────────────────────────── */
const COLOR_CAT = ["#163D66", "#1B6A87", "#79A8B4", "#C9D2CC", "#F0C178", "#E18C3E", "#D9452C", "#8E0F16"];
const TINTA_CAT = ["#fff", "#fff", "#101A1D", "#101A1D", "#101A1D", "#101A1D", "#fff", "#fff"];
let regionProbs = "n12";

// Un aviso vencido no se muestra, aunque el archivo sea de una lectura anterior
function quitarAvisosVencidos(){
  if (!D.avisos) return;
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Lima" });
  D.avisos.avisos = (D.avisos.avisos || []).filter(a => a.fin >= hoy);
}

function pintarPortada(){
  const e = D.estado, I = e.indices || {}, P = D.panorama;
  quitarAvisosVencidos();
  const rojos = (D.avisos?.avisos || []).filter(a => a.nivel === "ROJO").length;
  const horasAvisos = D.avisos?.leido ? (Date.now() - new Date(D.avisos.leido)) / 36e5 : null;
  const dias = e.alerta.proximo ? Math.ceil((new Date(e.alerta.proximo + "T12:00") - new Date()) / 864e5) : null;

  $("#alerta-bar").innerHTML = `<b>${esc(e.alerta.estado)}</b>
    ${I.icen?.magnitud ? `<span>ICEN: ${esc(I.icen.magnitud)} (${fecha(I.icen.fecha)})</span>` : ""}
    ${rojos ? `<span>${rojos} ${rojos > 1 ? "avisos rojos" : "aviso rojo"} del SENAMHI</span>` : ""}
    ${e.alerta.proximo ? `<span>Próximo comunicado: ${fecha(e.alerta.proximo)}${dias >= 0 ? ` (en ${dias} días)` : ""}</span>` : ""}
    ${haceCuanto() ? `<span class="alerta-act">Datos revisados ${haceCuanto()}</span>` : ""}`;

  $("#titular").textContent = e.alerta.titular
    ? oracion(e.alerta.titular)
    : "El Niño en el Perú, hoy.";
  $("#lede-txt").textContent = e.alerta.resumen || "";
  $("#ribbon").innerHTML = e.alerta.estados.map(x =>
    `<div ${x === e.alerta.estado ? "data-on" : ""}>${esc(x)}</div>`).join("");
  $("#alerta-fuente").innerHTML = `${esc(e.alerta.fuente)}, ${fecha(e.alerta.fecha)}.`
    + (e.alerta.url ? ` <a href="${esc(e.alerta.url)}" target="_blank" rel="noopener">Leer el comunicado</a>` : "");

  // Indicadores
  const u = D.atm;                  // última fila no vacía de cada columna
  const ultimo = k => { if (!u) return null; for (let i = u.fechas.length - 1; i >= 0; i--) if (u.cols[k]?.[i] !== null && u.cols[k]?.[i] !== undefined) return { valor: u.cols[k][i], fecha: u.fechas[i] }; return null; };
  const kp = [
    ["Mar, Niño 1+2", I.n12?.valor, " °C", I.n12?.fecha, "Frente a la costa norte. Media de 7 días"],
    ["Mar, Niño 3.4", I.n34?.valor, " °C", I.n34?.fecha, "Pacífico central. Media de 7 días"],
    ["ICEN", I.icen?.valor, "", I.icen?.fecha, I.icen?.magnitud || "Índice oficial de la costa"],
    ["RONI", I.roni?.valor, "", I.roni?.fecha, "Pacífico central, índice oficial de NOAA"],
    ["Calor 0-300 m", ultimo("calor")?.valor, " °C", ultimo("calor")?.fecha, "Reserva de calor bajo el mar"],
    ["SOI", ultimo("soi")?.valor, "", ultimo("soi")?.fecha, "Negativo: la atmósfera acompaña a El Niño"],
  ];
  $("#kpis").innerHTML = kp.map(([n, v, un, f, d]) => `<div><dt>${esc(n)}</dt>
    <dd ${v === null || v === undefined ? 'class="pend"' : ""}>${v === null || v === undefined ? "sin dato" : sg(v) + un}</dd>
    <small>${esc(d)}${f ? " · " + fecha(f) : ""}</small></div>`).join("");

  // Lectura del día
  $("#lectura").innerHTML = (P?.lectura || []).map(t => `<li>${esc(t)}</li>`).join("");
  pintarMisLugares();

  // Avisos del SENAMHI
  const A = D.avisos?.avisos || [];
  const atraso = horasAvisos !== null && horasAvisos > 36
    ? `<b>Lectura atrasada: última del ${fecha(D.avisos.leido.slice(0, 10))}. Puede haber avisos nuevos.</b> ` : "";
  $("#avisos-sub").innerHTML = `${atraso}Vigentes o por empezar, de mayor a menor nivel. <a href="${esc(D.avisos?.url || "https://www.senamhi.gob.pe/?p=aviso-meteorologico")}" target="_blank" rel="noopener">Ver en el SENAMHI</a>`;
  $("#avisos").innerHTML = A.map(a => `<article class="aviso ${NIVEL_AVISO[a.nivel]}">
    <div class="aviso-top"><span class="chip ${NIVEL_AVISO[a.nivel]}">${esc(a.nivel)}</span><span>N° ${a.numero} · ${fecha(a.inicio)} a ${fecha(a.fin)}</span></div>
    <h3>${esc(oracion(a.titulo))}</h3>
    <p>${esc((a.texto || "").replace(/^El SENAMHI informa que,?\s*/, "").slice(0, 240))}${(a.texto || "").length > 240 ? "…" : ""}</p>
    <a href="${esc(a.enlace)}" target="_blank" rel="noopener">Detalle oficial</a></article>`).join("")
    || `<p class="f-txt">No hay avisos vigentes registrados.</p>`;

  // Temas del ENFEN, con su dibujo
  const T = e.temas || {};
  const defs = [["lluvias", "Lluvias, próximos meses", "lluvia"], ["verano", "Lluvias en el verano", "lluvia"], ["caudales", "Ríos y caudales", "rio"],
    ["embalses", "Embalses", "embalse"], ["temperatura", "Temperatura del aire", "calor"], ["pesca", "Pesca y vida marina", "pez"],
    ["mar", "Nivel del mar y oleaje", "ola"], ["poblacion", "Para la población", "casa"], ["autoridades", "Para las autoridades", "mano"]];
  $("#temas-sub").textContent = `Texto del ${e.alerta.fuente}, ${fecha(e.alerta.fecha)}. Extraído del PDF oficial: ante cualquier duda, manda el comunicado.`;
  $("#temas-enfen").innerHTML = defs.filter(([k]) => T[k]).map(([k, n, ic]) =>
    `<article><h3>${dibujo(ic)} ${esc(n)}</h3><p>${esc(T[k])}</p></article>`).join("");

  pintarProbs();

  // Tabla de regiones
  const R = P?.regiones || {};
  const orden = { "muy alto": 4, alto: 3, medio: 2, bajo: 1 }, ordenAviso = { ROJO: 3, NARANJA: 2, AMARILLO: 1 };
  const peso = r => (ordenAviso[r.aviso] || 0) * 100 + (orden[r.n_lluvia] || 0) + (orden[r.n_mar] || 0) + (orden[r.n_focos] || 0);
  const filas = Object.entries(R).sort((a, b) => peso(b[1]) - peso(a[1]));
  $("#tabla-regiones").innerHTML = `<tr><th>Región</th><th>Aviso</th><th>Mar</th><th>Lluvia, 16 días</th><th>Focos, 7 días</th><th>Sequía (SPI-3)</th><th>Ríos en crecida</th></tr>`
    + filas.map(([id, r]) => `<tr onclick="abrirLugar('${id}')" tabindex="0" onkeydown="if(event.key==='Enter')abrirLugar('${id}')">
      <td><b>${esc(r.nombre)}</b></td>
      <td>${r.aviso ? `<span class="chip ${NIVEL_AVISO[r.aviso]}">${esc(r.aviso[0] + r.aviso.slice(1).toLowerCase())}</span>` : '<span class="chip sin">–</span>'}</td>
      <td>${r.mar === null || r.mar === undefined ? "–" : `${sg(r.mar)} °C ${chipNivel(r.n_mar)}`}</td>
      <td>${r.lluvia16 === null || r.lluvia16 === undefined ? "–" : `${Math.round(r.lluvia16)} mm ${chipNivel(r.n_lluvia)}`}</td>
      <td>${r.focos} ${chipNivel(r.n_focos)}</td>
      <td>${r.spi3 === null || r.spi3 === undefined ? "–" : sg(r.spi3)}</td>
      <td>${r.rios_altos?.length ? esc(r.rios_altos.join(", ")) : "–"}</td></tr>`).join("");

  // Rankings
  const rr = P?.rios_altos || [];
  $("#rios-sub").textContent = "Máximo en 15 días frente a su historia 1984-2023. GloFAS, un modelo global: orienta, no mide.";
  $("#rank-rios").innerHTML = rr.slice(0, 8).map(r => `<div class="rank-f" onclick="abrirLugar('${r.region}')"><span>${dibujo("rio")} <b>${esc(r.nombre)}</b> <small>${esc(r.lugar)}</small></span><span>${entero(Math.round(r.pico))} m³/s ${chipNivel(r.nivel)}</span></div>`).join("")
    || `<p class="f-txt">Sin crecidas inusuales pronosticadas en los ríos vigilados.</p>`;
  $("#rank-lluvia").innerHTML = (P?.top_lluvia || []).slice(0, 8).map(r => `<div class="rank-f" onclick="abrirLugar('${r.id}')"><span><b>${esc(r.nombre)}</b> <small>${esc(r.region)}</small></span><span>${Math.round(r.total)} mm</span></div>`).join("");
  $("#rank-focos").innerHTML = (P?.top_focos || []).slice(0, 8).map(r => `<div class="rank-f" onclick="abrirLugar('${r.id}')"><span><b>${esc(r.nombre)}</b> <small>${esc(r.region)}</small></span><span>${r.focos}</span></div>`).join("");

  // Noticias y comunicados
  const conFoto = (D.noticias?.noticias || []).filter(n => n.ambito === "nacional");
  $("#portada-noticias").innerHTML = [...conFoto.filter(n => n.imagen), ...conFoto.filter(n => !n.imagen)].slice(0, 4).map(n => tarjetaNoticia(n, false)).join("");
  $("#bulletins").innerHTML = (e.comunicados || []).map(c =>
    `<div class="bul"><time>${fecha(c.fecha)}</time><p>${c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.id)}</a>` : esc(c.id)}. ${esc(c.texto)}</p></div>`).join("");
}

function pintarMisLugares(){
  const g = guardados();
  const lugares = g.lugares.filter(id => M.datos?.porId?.[id] || D.panorama?.regiones?.[id]);
  $("#mis-lugares").innerHTML = g.lugares.length ? `<div class="mis"><b>Mis lugares:</b> ${g.lugares.map(id =>
    `<button class="enlace" onclick="abrirLugar('${esc(id)}')">${esc(D.nombres?.[id] || id)}</button>`).join(" · ")}</div>` : "";
}

function setProbs(k){ regionProbs = k; pintarProbs(); }
window.setProbs = setProbs;

// Barras apiladas por mes: las probabilidades del ENFEN. Si la tabla es de un
// comunicado anterior se dice, y las figuras originales siempre están debajo.
function pintarProbs(){
  const P = D.estado.probabilidades || {};
  $$("#probs-ctl button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.k === regionProbs)));
  const filas = P[regionProbs] || [], cat = regionProbs === "n12" ? P.categorias_icen : P.categorias_roni;
  $("#probs-sub").textContent = P.vigente
    ? `Transcritas de la figura del ${D.estado.alerta.fuente}.`
    : `Tabla del comunicado ${P.comunicado || "anterior"}: el vigente es otro; mira sus figuras abajo.`;
  $("#probs").innerHTML = filas.map((f, i) => `<div class="pm-fila"><span>${nombreMes(P.meses[i])} ${String(P.meses[i]).slice(2, 4)}</span>
    <div class="pm-barra">${f.map((v, j) => v ? `<i style="width:${v}%;background:${COLOR_CAT[j]}" title="${esc(cat[j])}: ${v} %"><span style="color:${TINTA_CAT[j]}">${v >= 12 ? v : ""}</span></i>` : "").join("")}</div></div>`).join("");
  $("#probs-ley").innerHTML = (cat || []).map((c, j) => `<span><i style="background:${COLOR_CAT[j]};height:10px"></i>${esc(c)}</span>`).join("");
  $("#figs").innerHTML = (D.estado.figuras || []).map(f => `<img loading="lazy" src="${recurso("datos/enfen/" + f)}" alt="Figura del comunicado del ENFEN">`).join("");
}

/* ── BOLETÍN ────────────────────────────────────────────────────────────── */
async function iniciarBoletin(){
  const ind = await traerOpcional("datos/boletines/indice.json");
  const f = (ind?.fechas || []).slice().reverse();
  $("#bol-fecha").innerHTML = f.map(x => `<option value="${x}">${fecha(x)}</option>`).join("");
  pintarBoletin(f[0]);
}
async function pintarBoletin(fec){
  const hoy = D.panorama?.fecha === fec;
  const P = hoy ? D.panorama : await traerOpcional(`datos/boletines/${fec}.json`);
  if (!P){ $("#boletin").innerHTML = "<p>Sin boletín para esa fecha.</p>"; return; }
  const e = D.estado, A = D.avisos?.avisos || [];
  const tabla = (cab, filas) => `<table class="tabla"><tr>${cab.map(c => `<th>${c}</th>`).join("")}</tr>${filas.join("")}</table>`;
  $("#boletin").innerHTML = `
    <header class="bol-cab"><div><div class="thermo"></div><h1>Boletín ENSO Perú</h1><p>${fecha(P.fecha)}</p></div></header>
    <section><h2>Lo más importante</h2><ul class="lectura">${P.lectura.map(t => `<li>${esc(t)}</li>`).join("")}</ul></section>
    ${hoy && e.alerta.resumen ? `<section><h2>Comunicado vigente del ENFEN</h2><p>${esc(e.alerta.resumen)}</p><p class="f-fuente">${esc(e.alerta.fuente)}, ${fecha(e.alerta.fecha)}. Próximo: ${fecha(e.alerta.proximo)}.</p></section>` : ""}
    ${hoy && A.length ? `<section><h2>Avisos del SENAMHI</h2>${tabla(["Nivel", "Aviso", "Vigencia"], A.map(a => `<tr><td><span class="chip ${NIVEL_AVISO[a.nivel]}">${esc(a.nivel)}</span></td><td>${esc(oracion(a.titulo))}</td><td>${fecha(a.inicio)} a ${fecha(a.fin)}</td></tr>`))}</section>` : ""}
    ${P.rios_altos?.length ? `<section><h2>Ríos con crecida pronosticada</h2>${tabla(["Río", "Lugar", "Pico en 15 días", "Nivel"], P.rios_altos.map(r => `<tr><td>${esc(r.nombre)}</td><td>${esc(r.lugar)}</td><td>${entero(Math.round(r.pico))} m³/s, ${fecha(r.fecha_pico)}</td><td>${chipNivel(r.nivel)}</td></tr>`))}<p class="f-fuente">GloFAS (Copernicus), modelo global: orienta, no mide.</p></section>` : ""}
    <section class="bol-2"><div><h2>Más lluvia próxima</h2>${tabla(["Provincia", "Región", "16 días"], P.top_lluvia.map(r => `<tr><td>${esc(r.nombre)}</td><td>${esc(r.region)}</td><td>${Math.round(r.total)} mm</td></tr>`))}</div>
      <div><h2>Más focos de calor</h2>${tabla(["Provincia", "Región", "7 días"], P.top_focos.map(r => `<tr><td>${esc(r.nombre)}</td><td>${esc(r.region)}</td><td>${r.focos}</td></tr>`))}</div></section>
    ${hoy && P.expuestos_inundacion ? `<section><h2>Distritos con mayor riesgo oficial ante inundación</h2>${tabla(["Distrito", "Provincia, región", "Riesgo", "Viviendas expuestas", "Colegios", "Salud"], P.expuestos_inundacion.map(r => `<tr><td>${esc(r.nombre)}</td><td>${esc(r.provincia)}, ${esc(r.region)}</td><td>${chipNivel(r.riesgo)}</td><td>${entero(r.viv)}</td><td>${entero(r.iiee)}</td><td>${entero(r.eess)}</td></tr>`))}<p class="f-fuente">CENEPRED, escenario de riesgo ante El Niño (SIGRID). Censo 2017.</p></section>` : ""}
    <footer class="bol-pie"><p>ENSO Perú reúne datos oficiales y de centros globales; no emite alertas ni pronósticos propios. Para decisiones operativas consulte al ENFEN, al SENAMHI y a INDECI.</p>
      <p>${esc(location.origin + location.pathname)}#boletin</p></footer>`;
}
window.pintarBoletin = pintarBoletin;

/* ── NOTICIAS ───────────────────────────────────────────────────────────── */
const TEMAS_NOT = { todos: "Todas", guardadas: "★ Guardadas", nacional: "Perú", internacional: "Mundo", oficial: "Oficial", lluvias: "Lluvias", incendios: "Incendios", mar: "Mar y pesca", agua: "Agua", agro: "Agro" };
let filtroNot = "todos", verNot = 24;
function setFiltroNot(k){ filtroNot = k; verNot = 24; pintarNoticias(); }
function masNoticias(){ verNot += 24; pintarNoticias(); }
window.masNoticias = masNoticias;
window.setFiltroNot = setFiltroNot;
// Dibujo de reserva por tema: si la nota no trae foto o su servidor no la entrega
const DIBUJO_TEMA = { lluvias: "lluvia", incendios: "calor", mar: "ola", agua: "embalse", agro: "pez", oficial: "aviso", global: "ojo" };
function fotoNoticia(n){
  const reserva = `<div class="not-sinfoto">${dibujo(DIBUJO_TEMA[n.tema] || "ojo", 34)}</div>`;
  return n.imagen?.startsWith("https://")
    ? `<div class="not-foto"><img src="${esc(n.imagen)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.classList.add('fallo')">${reserva}</div>`
    : `<div class="not-foto fallo">${reserva}</div>`;
}
function tarjetaNoticia(n, estrella, guardada){
  return `<article class="noticia">
    <a class="not-enl" href="${esc(n.enlace)}" target="_blank" rel="noopener">${fotoNoticia(n)}
      <span class="not-tit">${esc(n.titulo)}</span></a>
    <div class="not-pie"><span class="not-meta">${fecha(n.fecha)} · ${esc(n.medio)}${n.idioma === "en" ? " · en inglés" : ""}</span>
    ${estrella ? `<button class="estrella" aria-pressed="${guardada}" aria-label="Guardar" title="Guardar en este navegador" data-e="${esc(n.enlace)}" onclick="alternarNoticia(this.dataset.e)">${guardada ? "★" : "☆"}</button>` : ""}</div></article>`;
}
function pintarNoticias(){
  const g = guardados();
  // Dentro de un mismo día, primero las que traen foto
  const todas = [...(D.noticias?.noticias || [])].sort((a, b) => b.fecha.localeCompare(a.fecha) || (b.imagen ? 1 : 0) - (a.imagen ? 1 : 0));
  const cuenta = k => k === "todos" ? todas.length : k === "guardadas" ? g.noticias.length : todas.filter(n => n.ambito === k || n.tema === k).length;
  const lista = filtroNot === "guardadas" ? g.noticias : filtroNot === "todos" ? todas
    : todas.filter(n => n.ambito === filtroNot || n.tema === filtroNot);
  const guard = new Set(g.noticias.map(n => n.enlace));
  $("#not-ctl").innerHTML = Object.entries(TEMAS_NOT).filter(([k]) => k === "guardadas" || cuenta(k)).map(([k, n]) => `<button aria-pressed="${filtroNot === k}" onclick="setFiltroNot('${k}')">${n}</button>`).join("");
  $("#noticias").innerHTML = lista.slice(0, verNot).map(n => tarjetaNoticia(n, true, guard.has(n.enlace))).join("")
    || `<p class="f-txt">${filtroNot === "guardadas" ? "Todavía no guardaste noticias. Usa la estrella: quedan en este navegador." : "Sin noticias en este tema."}</p>`;
  const mas = $("#not-mas");
  if (mas) mas.innerHTML = lista.length > verNot ? `<button class="enlace" onclick="masNoticias()">Ver más noticias (quedan ${lista.length - verNot})</button>` : "";
}

/* ── COMPARAR ───────────────────────────────────────────────────────────── */
async function datosLugar(id){
  await asegurarDatos(); await asegurarRiesgo();
  const u = M.datos.porId[id]; if (!u) return null;
  const idProv = u.nivel === "distrito" ? u.provincia : u.id;
  const idReg = u.nivel === "region" ? u.id : u.region;
  const [cl] = await Promise.all([traerOpcional(`datos/clima/${idProv}.json`)]);
  return { u, idProv, idReg, clima: cl, ll: M.datos.lluvia?.valores?.[idProv], inc: M.datos.incendios?.valores?.[id],
           rs: M.datos.riesgo?.valores?.[id], reg: D.panorama?.regiones?.[idReg], est: M.datos.estacional?.valores?.[idReg] };
}
function idDeTexto(txt){
  const op = [...$("#lista-unidades").options].find(o => o.value === txt);
  return op?.dataset.id || (op?.dataset.lugar ? M.datos.lugares.features[+op.dataset.lugar].properties.distrito : undefined);
}
async function pintarComparar(){
  await asegurarDatos();
  llenarBuscador();
  const a = idDeTexto($("#comp-a").value), b = idDeTexto($("#comp-b").value);
  const res = $("#comp-res");
  if (!a || !b){ res.innerHTML = `<p class="f-txt">Escribe y elige dos lugares de la lista. Por ejemplo, Piura y Puno muestran las dos caras de El Niño: exceso de lluvia en el norte, déficit en el altiplano.</p>`; return; }
  const [A, B] = await Promise.all([datosLugar(a), datosLugar(b)]);
  const fila = (n, fa, fb) => `<tr><th>${n}</th><td>${fa ?? "–"}</td><td>${fb ?? "–"}</td></tr>`;
  const ev = (X, id) => X.clima?.eventos?.find(e => e.id === id);
  const evStr = e => e?.lluvia === null || !e ? "–" : `${entero(e.lluvia)} mm${e.pct ? ` (${e.pct} % de lo normal)` : ""}`;
  const f = fn => [fn(A), fn(B)];
  res.innerHTML = `<div class="tabla-scroll"><table class="tabla tabla-comp">
    <tr><th></th><th>${esc(A.u.nombre)}<small>${esc(A.u.region_nombre || "Región")}</small></th><th>${esc(B.u.nombre)}<small>${esc(B.u.region_nombre || "Región")}</small></th></tr>
    ${fila("Mar frente a la costa", ...f(X => X.reg?.mar === null || X.reg?.mar === undefined ? null : `${sg(X.reg.mar)} °C ${chipNivel(X.reg.n_mar)}`))}
    ${fila("Lluvia, próximos 16 días", ...f(X => X.ll ? `${Math.round(X.ll.total)} mm` : null))}
    ${fila("Días de lluvia fuerte, 16 días", ...f(X => X.ll ? decimal(X.ll.dias_fuertes) : null))}
    ${fila("Lluvia, últimos 30 días (modelo)", ...f(X => X.ll?.ult30 !== undefined ? `${Math.round(X.ll.ult30)} mm` : null))}
    ${fila("Temperatura máxima, próximos 7 días", ...f(X => X.ll?.tmax7 !== undefined ? `${String(X.ll.tmax7).replace(".", ",")} °C` : null))}
    ${fila("Focos de calor, 7 días", ...f(X => X.inc?.focos ?? 0))}
    ${fila("Sequía, SPI-3", ...f(X => M.datos.spi?.valores?.[X.idProv]?.spi3 !== undefined ? sg(M.datos.spi.valores[X.idProv].spi3) : null))}
    ${fila("Tendencia estacional, próximo mes", ...f(X => X.est ? `${sg(X.est.anom[1] ?? X.est.anom[0], 0)} mm` : null))}
    ${fila("Riesgo por inundación", ...f(X => riesgoCorto(X.rs?.inu)))}
    ${fila("Riesgo por movimientos en masa", ...f(X => riesgoCorto(X.rs?.mm)))}
    ${fila("Población (censo 2017)", ...f(X => X.rs ? entero(X.rs.pob) : null))}
    ${fila("Viviendas expuestas a inundación", ...f(X => X.rs ? entero(X.rs.inu.viv) : null))}
    ${fila("Lluvia dic-abr normal", ...f(X => X.clima ? `${entero(X.clima.normal_temporada)} mm` : null))}
    ${["1982-83", "1997-98", "2016-17", "2023-24"].map(id => fila(`Lluvia dic-abr en ${id}`, ...f(X => evStr(ev(X, id))))).join("")}
  </table></div>
  <p class="f-fuente">Riesgo: CENEPRED. Lluvia futura: Open-Meteo. Estacional: ECMWF SEAS5. Historia: NASA POWER, unos 50 km. En distritos, los datos de lluvia e historia son de su provincia.</p>`;
}
$("#comp-a").addEventListener("change", pintarComparar);
$("#comp-b").addEventListener("change", pintarComparar);
window.pintarComparar = pintarComparar;

/* ── Fuentes (Acerca de) ────────────────────────────────────────────────── */
function pintarFuentes(){
  const filas = [
    ["Alerta y comunicados", "ENFEN", "Oficial", "Cada ~15 días"], ["Avisos meteorológicos", "SENAMHI", "Oficial", "Diario"],
    ["ICEN", "IGP / ENFEN", "Oficial", "Mensual"], ["Riesgo por inundación y movimientos en masa", "CENEPRED (SIGRID)", "Oficial", "Por campaña"],
    ["Temperatura del mar, 25 km", "NOAA OISST v2.1", "Observado", "Diario"], ["ONI, RONI, SOI, OLR, vientos, calor", "NOAA CPC", "Observado", "Mensual"],
    ["MEI, PDO", "NOAA PSL, NCEI", "Observado", "Mensual"], ["Focos de calor", "NASA FIRMS (VIIRS)", "Satélite", "Diario"],
    ["Lluvia y temperatura a 16 días", "Open-Meteo (ECMWF, GFS, ICON)", "Modelo", "Diario"], ["Caudales a 30 días", "GloFAS (Copernicus)", "Modelo", "Diario"],
    ["Tendencia estacional, 6 meses", "ECMWF SEAS5", "Modelo", "Mensual"], ["Altura de ola, 7 días", "Open-Meteo Marine", "Modelo", "Diario"],
    ["Clima histórico y sequía (SPI)", "NASA POWER (MERRA-2)", "Reanálisis, ~50 km", "Mensual"],
    ["Presas, embalses, lagunas, glaciares", "OpenStreetMap", "Colaborativo", "Mensual"], ["Límites", "CENEPRED, INEI", "Oficial", "Fijo"], ["Noticias", "Google Noticias", "Prensa", "Diario"],
  ];
  $("#tabla-fuentes").innerHTML = `<tr><th>Dato</th><th>Fuente</th><th>Tipo</th><th>Frecuencia</th></tr>` + filas.map(f => `<tr>${f.map(x => `<td>${esc(x)}</td>`).join("")}</tr>`).join("");
}
