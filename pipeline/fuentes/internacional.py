"""
Fuente: pronósticos internacionales de El Niño, en un solo archivo.

Cada producto se lee por separado: si uno falla, los demás siguen y el archivo
dice cuál falló. Nada se traduce como pronóstico propio: cada valor lleva su
centro, su fecha de emisión y su enlace.

  cpc       NOAA CPC: estado, sinopsis, probabilidades, percentiles e intensidad (RONI)
  jma       Japón: anomalía mensual observada de Niño 1+2 y Niño 3
  mjo       Oscilación Madden-Julian: amplitud diaria (NOAA PSL, índice ROMI)

Australia (BoM) bloquea expresamente el acceso automático: no se usa.
  gth       CPC Global Tropics Hazards: zonas de lluvia o sequía favorecidas en semanas 2 y 3
  ciifen    Centro Internacional para la Investigación del Fenómeno de El Niño: boletines
  wmo       Organización Meteorológica Mundial: último El Niño/La Niña Update
  imagenes  gráficos que solo existen como imagen (C3S, SEAS5, IRI, NMME, MJO, CHIRPS)

Escribe sitio/datos/pronosticos/internacional.json y las imágenes en
sitio/datos/pronosticos/img/ (solo si cambiaron, para no inflar el repositorio).
"""
from __future__ import annotations

import datetime as dt
import hashlib
import html
import re
import xml.etree.ElementTree as ET

import requests

from comun import DATOS, ErrorFuente, ahora_utc, escribir_json, leer_json, log

SALIDA = DATOS / "pronosticos" / "internacional.json"
IMG = DATOS / "pronosticos" / "img"
UA = {"User-Agent": "Mozilla/5.0 (ensoperu; https://github.com/andresffigueroaa-blip/ensoperu)"}
CPC = "https://www.cpc.ncep.noaa.gov/products/analysis_monitoring"
CAJA_PERU = (-85.0, -20.0, -66.0, 2.0)    # lon0, lat0, lon1, lat1, con el mar de Grau
# Ciudades de referencia para decir qué parte del país toca cada zona de las semanas 2 y 3
CIUDADES = {"Tumbes": (-80.45, -3.57), "Piura": (-80.63, -5.19), "Chiclayo": (-79.84, -6.77), "Trujillo": (-79.03, -8.11),
            "Lima": (-77.04, -12.05), "Ica": (-75.73, -14.07), "Arequipa": (-71.54, -16.41), "Tacna": (-70.25, -18.01),
            "Cajamarca": (-78.51, -7.16), "Huaraz": (-77.53, -9.53), "Huancayo": (-75.21, -12.07), "Ayacucho": (-74.22, -13.16),
            "Cusco": (-71.97, -13.53), "Puno": (-70.02, -15.84), "Iquitos": (-73.25, -3.75), "Tarapoto": (-76.36, -6.49),
            "Pucallpa": (-74.55, -8.38), "Puerto Maldonado": (-69.19, -12.59)}


def _dentro(p, anillo) -> bool:
    """Punto en polígono por cruce de rayos."""
    x, y, dentro = p[0], p[1], False
    for (x1, y1), (x2, y2) in zip(anillo, anillo[1:] + anillo[:1]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            dentro = not dentro
    return dentro

ESTADOS_CPC = {"El Niño Advisory": "Advertencia de El Niño", "El Niño Watch": "Vigilancia de El Niño",
               "La Niña Advisory": "Advertencia de La Niña", "La Niña Watch": "Vigilancia de La Niña",
               "Final El Niño Advisory": "Fin de la advertencia de El Niño", "Final La Niña Advisory": "Fin de la advertencia de La Niña",
               "Not Active": "No activo"}
MESES_EN = {m: i for i, m in enumerate(["January", "February", "March", "April", "May", "June", "July", "August",
                                         "September", "October", "November", "December"], 1)}


def _get(url: str, **k) -> requests.Response:
    r = requests.get(url, headers=UA, timeout=60, **k)
    r.raise_for_status()
    return r


def _fecha_en(texto: str) -> str | None:
    """'8 October 2026' o 'October 8, 2026' -> '2026-10-08'."""
    m = re.search(r"(\d{1,2})\s+([A-Z][a-z]+)\s+(\d{4})", texto) or re.search(r"([A-Z][a-z]+)\s+(\d{1,2}),\s+(\d{4})", texto)
    if not m:
        return None
    a, b, c = m.groups()
    dia, mes = (a, b) if a.isdigit() else (b, a)
    return f"{c}-{MESES_EN[mes]:02d}-{int(dia):02d}" if mes in MESES_EN else None


def _filas(html_txt: str, ancla: str) -> list[list[str]]:
    """Filas de la primera tabla que sigue al ancla, como listas de texto."""
    i = html_txt.find(ancla)
    if i < 0:
        return []
    tabla = html_txt[i:html_txt.find("</table>", i)]
    filas = []
    for tr in re.findall(r"<tr.*?</tr>", tabla, flags=re.S):
        celdas = [re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", c))).strip()
                  for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, flags=re.S)]
        if celdas:
            filas.append(celdas)
    return filas


def _num(x: str):
    try:
        return float(x.replace("%", "").strip())
    except ValueError:
        return None


# ── NOAA CPC ────────────────────────────────────────────────────────────
def cpc() -> dict:
    t = _get(f"{CPC}/enso_advisory/ensodisc.txt").content.decode("cp1252", errors="replace")
    estado = re.search(r"ENSO Alert System Status:\s*(.+)", t)
    sinopsis = re.search(r"Synopsis:\s*(.+?)(?:\n\s*\n)", t, flags=re.S)
    proxima = re.search(r"scheduled for\s+(\d{1,2} \w+ \d{4})", t)
    salida = {"emitido": _fecha_en(t[:200]), "estado": estado.group(1).strip() if estado else None,
              "sinopsis": re.sub(r"\s+", " ", sinopsis.group(1)).strip() if sinopsis else None,
              "proxima": _fecha_en(proxima.group(1)) if proxima else None,
              "url": f"{CPC}/enso_advisory/ensodisc.shtml"}
    salida["estado_es"] = ESTADOS_CPC.get(salida["estado"], salida["estado"])

    h = _get(f"{CPC}/enso/roni/probabilities/").text
    salida["probabilidades"] = [{"trimestre": f[0][:3], "nina": _num(f[-3]), "neutral": _num(f[-2]), "nino": _num(f[-1])}
                                for f in _filas(h, 'id="probabilities-table"') if len(f) >= 4 and _num(f[-1]) is not None]
    h = _get(f"{CPC}/enso/roni/outlook/").text
    salida["percentiles"] = [{"trimestre": f[0][:3], "p": [_num(x) for x in f[-7:]]}
                             for f in _filas(h, 'id="outlook-table"') if len(f) >= 8 and _num(f[-1]) is not None and re.match(r"[A-Z]{3}\b", f[0])]
    h = _get(f"{CPC}/enso/roni/strengths/").text
    filas = _filas(h, 'id="probabilities-table"')
    if filas:
        salida["intensidad"] = {"bandas": filas[0][1:], "filas": [{"trimestre": f[0][:3], "p": [_num(x) for x in f[1:]]}
                                                                   for f in filas[1:] if len(f) > 2 and re.match(r"[A-Z]{3}\b", f[0])]}
    if not salida["probabilidades"]:
        raise ValueError("CPC: no encontré la tabla de probabilidades")
    return salida


# ── Japón ───────────────────────────────────────────────────────────────
def jma() -> dict:
    base = "https://ds.data.jma.go.jp/tcc/tcc/products/elnino/index/sstindex/base_period_9120"
    salida = {"url": "https://ds.data.jma.go.jp/tcc/tcc/products/elnino/outlook.html"}
    for clave, ruta in (("n12", "Nino_1+2"), ("n3", "Nino_3")):
        serie = []
        for linea in _get(f"{base}/{ruta}/anomaly").text.splitlines():
            p = linea.split()
            if len(p) == 13 and p[0].isdigit() and int(p[0]) >= dt.date.today().year - 2:
                serie += [{"mes": f"{p[0]}-{i:02d}", "valor": float(v)} for i, v in enumerate(p[1:], 1) if float(v) < 99]
        salida[clave] = serie[-24:]
    try:
        o = _get(salida["url"]).text
        m = re.search(r"Next update will be on\s*([^)<]+)", o)
        salida["proxima"] = _fecha_en(m.group(1)) if m else None
    except requests.RequestException:
        pass
    if not salida.get("n12"):
        raise ValueError("JMA: serie vacía")
    return salida


# ── MJO ─────────────────────────────────────────────────────────────────
def mjo() -> dict:
    """ROMI de NOAA PSL: año, mes, día, bandera, PC1, PC2, amplitud. Amplitud sobre 1: MJO activa."""
    filas = []
    for linea in _get("https://psl.noaa.gov/mjo/mjoindex/romi.cpcolr.1x.txt").text.splitlines():
        p = linea.split()
        if len(p) >= 7 and p[0].isdigit():
            a, m, d, _, pc1, pc2, amp = p[:7]
            filas.append({"fecha": f"{a}-{int(m):02d}-{int(d):02d}", "pc1": round(float(pc1), 3), "pc2": round(float(pc2), 3),
                          "amplitud": round(float(amp), 2)})
    if not filas:
        raise ValueError("MJO: sin datos")
    return {"ultimo": filas[-1], "serie": filas[-45:], "activa": filas[-1]["amplitud"] >= 1,
            "fuente": "NOAA PSL, índice ROMI", "url": "https://www.cpc.ncep.noaa.gov/products/precip/CWlink/MJO/mjo.shtml"}


# ── CPC Global Tropics Hazards, semanas 2 y 3 ───────────────────────────
def _intersecta(coords: list) -> bool:
    lons = [c[0] for c in coords]; lats = [c[1] for c in coords]
    x0, y0, x1, y1 = CAJA_PERU
    return min(lons) <= x1 and max(lons) >= x0 and min(lats) <= y1 and max(lats) >= y0


def gth() -> dict:
    base = "https://www.cpc.ncep.noaa.gov/products/precip/CWlink/ghaz/kmzs"
    ns = "{http://www.opengis.net/kml/2.2}"
    salida = {"url": "https://www.cpc.ncep.noaa.gov/products/precip/CWlink/ghaz/", "semanas": {}}
    feats = []
    for sem in ("W2", "W3"):
        info = {"zonas": []}
        for tipo in ("WET", "DRY", "WARM", "COLD"):
            try:
                raiz = ET.fromstring(_get(f"{base}/{sem}_{tipo}.kml").content)
            except (requests.RequestException, ET.ParseError):
                continue
            nombre = raiz.findtext(f".//{ns}name") or ""
            m = re.search(r"Issued:\s*(\d{2}/\d{2}/\d{4}).*?Valid:\s*(\d{2}/\d{2}/\d{4})\s*-\s*(\d{2}/\d{2}/\d{4})", nombre)
            if m:
                fm = lambda s: dt.datetime.strptime(s, "%m/%d/%Y").date().isoformat()
                info.update(emitido=fm(m.group(1)), desde=fm(m.group(2)), hasta=fm(m.group(3)))
            for pm in raiz.iter(f"{ns}Placemark"):
                prob = re.search(r"(\d+)", (pm.findtext(f"{ns}name") or "") + " " + (pm.findtext(f"{ns}description") or ""))
                for anillo in pm.iter(f"{ns}coordinates"):
                    coords = [[round(float(a), 2), round(float(b), 2)] for a, b, *_ in
                              (c.split(",") for c in anillo.text.split()) if a and b]
                    if len(coords) > 3 and _intersecta(coords):
                        ciudades = [n for n, p in CIUDADES.items() if _dentro(p, coords)]
                        if ciudades:
                            z = next((z for z in info["zonas"] if z["tipo"] == tipo), None)
                            if not z:
                                z = {"tipo": tipo, "ciudades": []}; info["zonas"].append(z)
                            z["ciudades"] = sorted(set(z["ciudades"]) | set(ciudades))
                        feats.append({"type": "Feature", "properties": {"semana": sem, "tipo": tipo, "prob": int(prob.group(1)) if prob else None},
                                      "geometry": {"type": "Polygon", "coordinates": [coords]}})
        salida["semanas"][sem] = info
    escribir_json(DATOS / "pronosticos" / "gth.geojson", {"type": "FeatureCollection", "features": feats}, compacto=True)
    return salida


# ── CIIFEN y WMO: los documentos más recientes ──────────────────────────
def ciifen() -> dict:
    media = _get("https://ciifen.org/wp-json/wp/v2/media?per_page=40&mime_type=application/pdf").json()
    salida = {"url": "https://ciifen.org/"}
    for clave, pat in (("boletin_enso", r"Boletin_ElNino_LaNina"), ("estacional", r"Pronostico_Estacional"), ("oceano", r"[Oo]ceano")):
        docs = sorted((x for x in media if re.search(pat, x.get("source_url", ""))), key=lambda x: x["date"], reverse=True)
        if docs:
            salida[clave] = {"titulo": html.unescape(docs[0]["title"]["rendered"]), "fecha": docs[0]["date"][:10], "url": docs[0]["source_url"]}
    if len(salida) == 1:
        raise ValueError("CIIFEN: no encontré boletines")
    return salida


def wmo() -> dict:
    base = "https://wmo.int"
    h = _get(f"{base}/publication-series/el-ninola-nina-updates").text
    enlaces = re.findall(r'href="(/resources/publication-series/el-ninola-nina-updates/[a-z0-9-]+)"', h)
    if not enlaces:
        raise ValueError("WMO: no encontré el último Update")
    pagina = base + enlaces[0]
    p = _get(pagina).text
    titulo = re.search(r"<h1[^>]*>(.*?)</h1>", p, flags=re.S)
    pdf = re.search(r'href="([^"]+\.pdf)"', p)
    return {"titulo": re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", titulo.group(1)))).strip() if titulo else "El Niño/La Niña Update",
            "url": pagina, "pdf": (pdf.group(1) if pdf and pdf.group(1).startswith("http") else base + pdf.group(1)) if pdf else None}


# ── Imágenes: solo se guardan si cambiaron ──────────────────────────────
def _opencharts(producto: str, area: str | None = None) -> str:
    u = f"https://charts.ecmwf.int/opencharts-api/v1/products/{producto}/" + (f"?area={area}" if area else "")
    return _get(u).json()["data"]["link"]["href"]


def _iri_plume() -> str:
    hoy = dt.date.today()
    for k in range(3):
        a, m = (hoy.year, hoy.month - k) if hoy.month - k > 0 else (hoy.year - 1, hoy.month - k + 12)
        u = f"https://ensoforecast.iri.columbia.edu/figure4_plot/{a}/{m:02d}/png"
        try:
            if requests.head(u, headers=UA, timeout=30).ok:
                return u
        except requests.RequestException:
            continue
    raise ValueError("IRI: sin pluma reciente")


IMAGENES = [
    ("c3s_n12", "Pluma multimodelo Copernicus C3S, Niño 1+2", "Copernicus C3S / ECMWF", lambda: _opencharts("c3s_seasonal_plume_mm", "nino12")),
    ("c3s_n34", "Pluma multimodelo Copernicus C3S, Niño 3.4", "Copernicus C3S / ECMWF", lambda: _opencharts("c3s_seasonal_plume_mm", "nino34")),
    ("seas5", "Pluma del modelo ECMWF SEAS5, regiones Niño", "ECMWF", lambda: _opencharts("seasonal_system5_nino_plumes")),
    ("iri", "Pluma de modelos dinámicos y estadísticos, Niño 3.4", "IRI, Universidad de Columbia", _iri_plume),
    ("nmme", "Media de los modelos NMME, Niño 3.4", "NOAA CPC, NMME", lambda: "https://www.cpc.ncep.noaa.gov/products/NMME/current/images/nino34.rescaling.ENSMEAN.png"),
    ("mjo", "Pronóstico de la MJO, ECMWF corregido", "NOAA CPC", lambda: "https://www.cpc.ncep.noaa.gov/products/precip/mjo/img/ECMF_BC.png"),
    ("gth", "Zonas de riesgo tropical, semanas 2 y 3", "NOAA CPC", lambda: "https://www.cpc.ncep.noaa.gov/products/precip/CWlink/ghaz/gth_full.png"),
    ("chirps10", "Lluvia pronosticada a 10 días, Sudamérica", "CIIFEN (CHIRPS-GEFS)", lambda: "https://ciifen.org/wp-content/uploads/imagenes_clima/pronostico/pron_precipitacion/chirps_forecast_10days.png"),
]


def imagenes(previas: dict) -> list[dict]:
    IMG.mkdir(parents=True, exist_ok=True)
    salida = []
    for clave, titulo, fuente, url_de in IMAGENES:
        prev = previas.get(clave, {})
        try:
            url = url_de()
            r = _get(url)
            if not r.headers.get("content-type", "").startswith("image"):
                raise ValueError(f"no es imagen: {r.headers.get('content-type')}")
            ext = "jpg" if "jpeg" in r.headers["content-type"] else "png"
            huella = hashlib.sha1(r.content).hexdigest()[:12]
            archivo = f"{clave}.{ext}"
            if huella != prev.get("huella") or not (IMG / archivo).exists():
                (IMG / archivo).write_bytes(r.content)
                fecha = r.headers.get("last-modified")
                prev = {"huella": huella, "archivo": archivo,
                        "fecha": dt.datetime.strptime(fecha, "%a, %d %b %Y %H:%M:%S %Z").date().isoformat() if fecha else dt.date.today().isoformat()}
            salida.append({"id": clave, "titulo": titulo, "fuente": fuente, "origen": url, **prev})
        except (requests.RequestException, ValueError, KeyError) as e:
            log(f"  imagen {clave}: {type(e).__name__} {str(e)[:80]}")
            if prev:
                salida.append({"id": clave, "titulo": titulo, "fuente": fuente, **prev, "atrasada": True})
    return salida


def ejecutar(estado: dict) -> dict:
    previo = leer_json(SALIDA) or {}
    salida = {"_": "Generado por pipeline/fuentes/internacional.py. Cada bloque con su centro, fecha y enlace.",
              "actualizado": ahora_utc(), "fallas": []}
    for clave, f in (("cpc", cpc), ("jma", jma), ("mjo", mjo), ("gth", gth), ("ciifen", ciifen), ("wmo", wmo)):
        try:
            salida[clave] = f()
        except Exception as e:     # una fuente rota no tumba a las demás; se conserva su último dato
            log(f"  {clave}: {type(e).__name__} {str(e)[:120]}")
            salida["fallas"].append(clave)
            if clave in previo:
                salida[clave] = {**previo[clave], "atrasado": True}
    salida["imagenes"] = imagenes({i["id"]: i for i in previo.get("imagenes", [])})
    if len(salida["fallas"]) >= 6:
        raise ErrorFuente(f"casi todos los centros fallaron: {salida['fallas']}")
    escribir_json(SALIDA, salida)
    c = salida.get("cpc", {})
    log(f"  CPC: {c.get('estado')} ({c.get('emitido')}); MJO amplitud {salida.get('mjo', {}).get('ultimo', {}).get('amplitud')}; "
        f"{len(salida['imagenes'])} imágenes; fallas {salida['fallas']}")
    return {"estado": "ok", "ultimo_dato": c.get("emitido"), "aviso": f"fallaron: {', '.join(salida['fallas'])}" if salida["fallas"] else None}
