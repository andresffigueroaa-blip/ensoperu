"""
Fuente: comunicados oficiales del ENFEN (PDF).

Busca el comunicado más reciente, lo lee y publica:
  sitio/datos/enfen/comunicado.json   número, fecha, alerta, titular, texto por tema,
                                      próximo comunicado, enlaces
  sitio/datos/enfen/figura_N.jpg      figuras del PDF (mapa de TSM y probabilidades)
  sitio/datos/enfen/historial.json    comunicados anteriores (número, fecha, titular)

Rutas, en orden: el portal del ENFEN y la réplica de la DHN. Ojo: el portal
suele no responder desde fuera del Perú (GitHub Actions). Por eso una falla de
red aquí NO es un error mientras el comunicado guardado tenga menos de
DIAS_MAX días: la página sigue con el último leído. Desde una computadora en
el Perú basta `python pipeline/run.py --solo enfen,estado`.

Las probabilidades mensuales vienen como imagen en el PDF: la tabla se
transcribe a mano en catalogo/enfen.yaml (y aquí se publican las figuras, que
siempre están al día).
"""
from __future__ import annotations

import html
import io
import re

import requests
from pypdf import PdfReader

from comun import DATOS, ErrorFuente, ErrorValidacion, ahora_utc, escribir_json, hoy, leer_json, log

PORTAL = "https://enfen.imarpe.gob.pe/comunicados/"
DESCARGA = "https://enfen.imarpe.gob.pe/download/comunicado-oficial-enfen-n-{n:02d}-{a}/"
DHN = "https://www.dhn.mil.pe/Archivos/oceanografia/enfen/comunicado-oficial/{n:02d}-{a}.pdf"
DIR = DATOS / "enfen"
SALIDA = DIR / "comunicado.json"
HISTORIAL = DIR / "historial.json"
UA = {"User-Agent": "Mozilla/5.0 (ensoperu; datos publicos)"}
DIAS_MAX = 21           # el ENFEN publica cada ~2 semanas; más que esto es un fallo
ALERTAS = ["No activo", "Vigilancia de El Niño Costero", "Alerta de El Niño Costero",
           "Vigilancia de La Niña Costera", "Alerta de La Niña Costera"]
MESES = {m: i + 1 for i, m in enumerate(["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
                                         "septiembre", "octubre", "noviembre", "diciembre"])}
MESES["setiembre"] = 9

# Inicio de cada párrafo temático del comunicado
TEMAS = [
    ("lluvias", r"Las lluvias,? de "),
    ("verano", r"Para el verano de"),
    ("caudales", r"Los caudales"),
    ("temperatura", r"La temperatura del aire"),
    ("pesca", r"La anchoveta"),
    ("embalses", r"Los principales embalses"),
    ("mar", r"El\s+n\s*ivel\s+del\s+mar"),
    ("poblacion", r"Se recomienda a la población"),
    ("autoridades", r"Se exhorta a los tomadores"),
]


def _bajar_pdf(url: str) -> bytes | None:
    try:
        r = requests.get(url, headers=UA, timeout=60)
    except requests.RequestException:
        return None
    return r.content if r.ok and r.content[:4] == b"%PDF" else None


def _pdf_del_portal(n: int, a: int) -> tuple[bytes | None, str | None]:
    """Página de descarga del portal -> enlace firmado -> PDF."""
    pagina = DESCARGA.format(n=n, a=a)
    try:
        r = requests.get(pagina, headers=UA, timeout=45)
    except requests.RequestException:
        return None, None
    if r.content[:4] == b"%PDF":
        return r.content, pagina
    if not r.ok:
        return None, None
    # El enlace de descarga viene en un href o en un atributo de JavaScript
    m = re.search(r"""(https://enfen\.imarpe\.gob\.pe/download/[^"' ]*wpdmdl=\d+[^"' ]*)""", r.text)
    return (_bajar_pdf(html.unescape(m.group(1))), pagina) if m else (None, None)


def _buscar(n: int, a: int) -> tuple[bytes | None, str | None]:
    pdf, url = _pdf_del_portal(n, a)
    if pdf:
        return pdf, url
    url = DHN.format(n=n, a=a)
    pdf = _bajar_pdf(url)
    return (pdf, url) if pdf else (None, None)


def _ultimo_listado() -> tuple[int, int] | None:
    try:
        r = requests.get(PORTAL, headers=UA, timeout=45)
        r.raise_for_status()
    except requests.RequestException:
        return None
    n = re.findall(r"comunicado-oficial-enfen-n-(\d+)-(\d{4})", r.text)
    return max(((int(x), int(y)) for x, y in n), key=lambda t: (t[1], t[0])) if n else None


def _limpiar(t: str) -> str:
    """Quita marcas de nota al pie pegadas al texto ('extraordinaria2', 'enero 20276')
    y arregla los espacios que deja el PDF ('e sta', 'E l')."""
    t = re.sub(r"\s+", " ", t)
    t = re.sub(r"\b(20\d\d)\d\b", r"\1", t)
    t = re.sub(r"\b(20\d\d) \d\b(?=,| )", r"\1", t)
    t = re.sub(r"([a-záéíóúñ])\d{1,2}\b", r"\1", t)
    t = re.sub(r"\b([Ee]) (sta|l|n)\b", lambda m: m.group(1) + m.group(2), t)
    t = re.sub(r"\bn ivel", "nivel", t)
    return t.replace(" ,", ",").replace(" .", ".").strip()


def leer(pdf: bytes) -> dict:
    lector = PdfReader(io.BytesIO(pdf))
    crudo = "\n".join(p.extract_text() or "" for p in lector.pages)
    # encabezados y notas al pie repetidos en cada página
    t = re.sub(r"COMISIÓN MULTISECTORIAL ENCARGADA.*?democracia\s*[“\"”]?\s*", " ", crudo, flags=re.S)
    # Las llamadas a esas notas quedan sueltas en el texto ('Oleajes 9 publicados'):
    # se quitan solo los números que de verdad tienen nota, sin tocar cantidades
    notas = re.findall(r"(?m)^\s*(\d{1,2})\s+https?://", t)
    t = re.sub(r"(?m)^\s*\d{1,2}\s+https?://\S+.*$", " ", t)
    if notas:
        t = re.sub(rf"(?<=[A-Za-zÁÉÍÓÚáéíóúñ])(?<!Figura)(?<!Tabla) ({'|'.join(sorted(set(notas)))})"
                   r"(?=\s+[A-Za-zÁÉÍÓÚ])(?!\s+(?:de|días|meses|años|mm|m|km)\b)", "", t)

    m = re.search(r"COMUNICADO OFICIAL ENFEN\s*N\s*[°º]?\s*(\d+)\s*-\s*(\d{4})", t)
    if not m:
        raise ErrorValidacion("ENFEN: no encontré el número del comunicado; ¿cambió el formato?")
    numero, anio = int(m.group(1)), int(m.group(2))

    mf = re.search(r"(\d{1,2})\s+(?:de\s+)?(enero|febrero|marzo|abril|mayo|junio|julio|agosto|se(?:p|t)iembre|octubre|noviembre|diciembre)\s+(?:de\s+)?(\d{4})", t[m.end():m.end() + 120], re.I)
    if not mf:
        raise ErrorValidacion("ENFEN: no encontré la fecha del comunicado")
    fecha = f"{mf.group(3)}-{MESES[mf.group(2).lower()]:02d}-{int(mf.group(1)):02d}"

    alerta = next((a for a in ALERTAS if re.search(a.replace(" ", r"\s+"), t[m.end():m.end() + 300], re.I)), None)
    if alerta is None:
        ma = re.search(r"Estado del sistema de alerta:\s*([^\n\d]+)", t)
        alerta = ma.group(1).strip() if ma else None
    if not alerta:
        raise ErrorValidacion("ENFEN: no encontré el estado de alerta")

    # Titular: la línea en mayúsculas después de la alerta
    tras = t[m.end():m.end() + 500]
    mt = re.search(r"\n\s*([A-ZÁÉÍÓÚÑ0-9][A-ZÁÉÍÓÚÑ0-9 ,.;:\-]{15,})\n", tras)
    titular = _limpiar(mt.group(1)) if mt else ""
    if titular.upper().startswith("RESUMEN"):   # formato anterior: sin titular propio
        titular = ""

    # Resumen: desde el titular hasta la primera figura
    ini = (m.end() + mt.end()) if mt else m.end()
    # La leyenda ("Figura 1.") cierra el resumen; "(Figura 1)" es solo una cita en el texto
    mfig = re.search(r"\n\s*Figura 1\s*\.", t[ini:])
    resumen = _limpiar(t[ini:ini + mfig.start() if mfig else ini + 900])
    resumen = re.sub(r"\s*\(Figuras? [\d, y]+\)", "", resumen)

    # Párrafos por tema: de cada inicio hasta el siguiente inicio
    pos = sorted((mm.start(), k) for k, pat in TEMAS if (mm := re.search(pat, t)))
    temas = {}
    corte = re.search(r"Esta Comisión mantiene|El próximo Comunicado", t)
    limite = corte.start() if corte else len(t)
    for i, (p, k) in enumerate(pos):
        f = pos[i + 1][0] if i + 1 < len(pos) else limite
        temas[k] = _limpiar(t[p:min(f, limite)])

    mp = re.search(r"próximo\s+Comunicado\s+Oficial\s+se\s+emitirá\s+el\s+\w+\s+(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})", t, re.I)
    proximo = f"{mp.group(3)}-{MESES.get(mp.group(2).lower(), 0):02d}-{int(mp.group(1)):02d}" if mp else None

    figuras = []
    for im in lector.pages[0].images:
        if im.name.lower().endswith((".jpg", ".jpeg")) and len(im.data) > 20000:
            figuras.append(im.data)
    return {"numero": numero, "anio": anio, "id": f"N° {numero:02d}-{anio}", "fecha": fecha, "alerta": alerta,
            "titular": titular, "resumen": resumen, "temas": temas, "proximo": proximo, "_figuras": figuras}


def ejecutar(estado: dict) -> dict:
    previo = leer_json(SALIDA) or {}
    hist = leer_json(HISTORIAL) or {"comunicados": []}
    vistos = {(c["numero"], c["anio"]) for c in hist["comunicados"]}

    ultimo = _ultimo_listado()
    if ultimo is None and previo:          # se sondea desde lo que ya se tiene
        ultimo = (previo["numero"], previo["anio"])
    if ultimo is None:
        ultimo = (1, hoy().year)

    # El listado puede atrasarse: se sondean hasta 3 números siguientes
    n, a = ultimo
    pdf, url = None, None
    for k in (3, 2, 1, 0):
        pdf, url = _buscar(n + k, a)
        if pdf:
            n += k
            break

    if not pdf:
        # sin red hacia el ENFEN: normal desde GitHub Actions
        if previo:
            import datetime as dt
            dias = (hoy() - dt.date.fromisoformat(previo["fecha"])).days
            if dias > DIAS_MAX:
                raise ErrorFuente(f"el comunicado guardado tiene {dias} días y el ENFEN no responde desde aquí")
            log(f"  ENFEN no responde; se conserva {previo['id']} ({dias} días)")
            return {"estado": "sin_cambios", "ultimo_dato": previo["fecha"],
                    "aviso": "portal del ENFEN sin respuesta desde este equipo"}
        raise ErrorFuente("el ENFEN no responde desde este equipo y no hay comunicado guardado")

    d = leer(pdf)
    figuras = d.pop("_figuras")
    if previo and (d["anio"], d["numero"]) < (previo["anio"], previo["numero"]):
        raise ErrorValidacion(f"ENFEN: el comunicado leído ({d['id']}) es anterior al guardado ({previo['id']})")
    if len(d["temas"]) < 3:
        raise ErrorValidacion(f"ENFEN: solo reconocí {len(d['temas'])} temas en {d['id']}; ¿cambió el formato?")

    nuevo = d["id"] != previo.get("id")
    DIR.mkdir(parents=True, exist_ok=True)
    for i, f in enumerate(figuras[:4], 1):
        (DIR / f"figura_{i}.jpg").write_bytes(f)
    escribir_json(SALIDA, {"_": "Generado por pipeline/fuentes/enfen.py desde el PDF oficial. No editar a mano.",
                           **d, "url": url, "figuras": [f"figura_{i}.jpg" for i in range(1, min(len(figuras), 4) + 1)],
                           "leido": ahora_utc()})

    # Historial: el nuevo y, la primera vez, los anteriores del año
    def agregar(c, u):
        if (c["numero"], c["anio"]) not in vistos:
            hist["comunicados"].append({"numero": c["numero"], "anio": c["anio"], "id": c["id"], "fecha": c["fecha"],
                                        "alerta": c["alerta"], "titular": c["titular"], "url": u})
            vistos.add((c["numero"], c["anio"]))
    agregar(d, url)
    for k in range(1, 7):
        if d["numero"] - k < 1 or (d["numero"] - k, d["anio"]) in vistos:
            continue
        p, u = _buscar(d["numero"] - k, d["anio"])
        if p:
            try:
                agregar(leer(p), u)
            except ErrorFuente:
                pass
    hist["comunicados"].sort(key=lambda c: (c["anio"], c["numero"]), reverse=True)
    hist["_"] = "Comunicados del ENFEN ya leídos. Lo acumula pipeline/fuentes/enfen.py."
    escribir_json(HISTORIAL, hist)

    log(f"  {d['id']} del {d['fecha']}: {d['alerta']}; {len(d['temas'])} temas; próximo {d['proximo']}; {len(figuras)} figuras")
    return {"estado": "ok" if nuevo else "sin_cambios", "ultimo_dato": d["fecha"], "comunicado": d["id"],
            "fuente": "ENFEN, comunicados oficiales"}
