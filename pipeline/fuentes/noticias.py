"""
Fuente: noticias sobre El Niño y clima, por los canales RSS de los medios (traen
imagen) y de Google Noticias (no la traen).
Se guarda solo titular, medio, fecha, enlace e imagen de portada, que se muestra
desde el servidor del propio medio; el contenido es de cada medio. No es una
fuente de datos: las noticias pueden traer cifras preliminares.

Temas según catalogo/noticias.yaml. Escribe sitio/datos/noticias.json (las más
recientes, sin repetir) y conserva las anteriores hasta MAX_GUARDADAS.
"""
from __future__ import annotations

import datetime as dt
import email.utils
import html
import re
import urllib.parse
import xml.etree.ElementTree as ET

import requests

from comun import DATOS, ErrorFuente, ahora_utc, escribir_json, hoy, leer_catalogo, leer_json, log

SALIDA = DATOS / "noticias.json"
MAX_GUARDADAS = 240
DIAS_MAX = 45
UA = {"User-Agent": "Mozilla/5.0 (ensoperu; noticias)"}


def _rss(q: str, idioma: str) -> str:
    hl, gl, ceid = {"es": ("es-419", "PE", "PE:es-419"), "en": ("en", "US", "US:en")}[idioma]
    return f"https://news.google.com/rss/search?q={urllib.parse.quote(q + ' when:14d')}&hl={hl}&gl={gl}&ceid={ceid}"


# "El Niño" con mayúsculas: "el niño de 5 años" no es la noticia que se busca
TOCA_TEMA = re.compile(r"\bEl Niño\b(?! de \d)|\bENFEN\b|[Ff]en[óo]meno El|[Ss]enamhi|SENAMHI|INDECI|[Hh]uaico|[Ii]nundaci[óo]n|[Dd]esborde"
                       r"|[Ii]ncendios? forestal|[Aa]nchoveta|[Ss]equ[íi]a|[Ll]luvias? (?:intensa|fuerte)|\bflood|\bdrought|\bwildfire")
TEMAS = [("incendios", r"incendio|wildfire"), ("mar", r"anchoveta|pesca|oleaje|\bmar\b"), ("agro", r"cultivo|agr[ií]col|agricultor|ganad|arroz|mango|lim[oó]n"),
         ("agua", r"embalse|represa|sequ[íi]a|titicaca|drought|caudal"), ("oficial", r"enfen|indeci|decreto|estado de emergencia"), ("lluvias", r".")]


def _tema(titulo: str) -> str:
    return next(k for k, pat in TEMAS if re.search(pat, titulo, flags=re.I))


def _imagen(it) -> str | None:
    """Imagen de portada de un elemento RSS: media:content, media:thumbnail, enclosure o <img>."""
    ns = "{http://search.yahoo.com/mrss/}"
    for nodo in (it.find(ns + "content"), it.find(ns + "thumbnail"), it.find("enclosure")):
        if nodo is not None and nodo.get("url") and "video" not in (nodo.get("type") or ""):
            return nodo.get("url")
    for campo in ("description", "{http://purl.org/rss/1.0/modules/content/}encoded"):
        m = re.search(r"""<img[^>]+src=["']([^"']+)""", it.findtext(campo) or "")
        if m:
            return html.unescape(m.group(1))
    return None


def _canales(cfg: dict, vistas: dict) -> list[dict]:
    """Notas de los canales directos que tocan el tema. Se leen antes que Google: traen imagen."""
    salida = []
    for c in cfg.get("canales", []):
        try:
            r = requests.get(c["url"], headers=UA, timeout=45)
            r.raise_for_status()
            items = ET.fromstring(r.content).findall(".//item")
        except (requests.RequestException, ET.ParseError) as e:
            log(f"  canal {c['medio']}: {type(e).__name__}")
            continue
        for it in items:
            titulo = html.unescape(it.findtext("title") or "").strip()
            enlace = (it.findtext("link") or "").strip()
            if not titulo or not enlace.startswith("https://") or not TOCA_TEMA.search(titulo):
                continue
            k = _norm(titulo)
            if k in vistas:
                if not vistas[k].get("imagen") and _imagen(it):   # la misma nota, ahora con foto
                    vistas[k]["imagen"] = _imagen(it).replace("http://", "https://", 1)
                continue
            try:
                d = email.utils.parsedate_to_datetime(it.findtext("pubDate"))
                f, ts = d.date().isoformat(), d.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%MZ")
            except (TypeError, ValueError):
                f, ts = hoy().isoformat(), ""
            img = _imagen(it)
            n = {"titulo": titulo, "medio": c["medio"], "fecha": f, "ts": ts, "enlace": enlace, "tema": _tema(titulo),
                 "ambito": c["ambito"], "idioma": c.get("idioma", "es")}
            if img:
                n["imagen"] = img.replace("http://", "https://", 1)
            vistas[k] = n
            salida.append(n)
    return salida


def _sin_casi_duplicados(xs: list[dict]) -> list[dict]:
    """La misma nota con otro titular (en vivo, "pronóstico del día"): se queda la primera, que es la más reciente."""
    import difflib
    salida, vistos = [], []
    for n in xs:
        k = _norm(n["titulo"])
        if n.get("enlace") in {x.get("enlace") for x in salida} or any(difflib.SequenceMatcher(None, k, v).ratio() >= 0.85 for v in vistos[-150:]):
            continue
        salida.append(n); vistos.append(k)
    return salida


def _norm(t: str) -> str:
    return re.sub(r"[^a-záéíóúñ0-9 ]", "", t.lower())[:70]


def ejecutar(estado: dict) -> dict:
    cfg = leer_catalogo("noticias")
    previas = (leer_json(SALIDA) or {}).get("noticias", [])
    vistas = {_norm(n["titulo"]): n for n in previas}
    nuevas = _canales(cfg, vistas)
    con_foto = len(nuevas)
    fallas = 0
    for c in cfg["consultas"]:
        try:
            r = requests.get(_rss(c["q"], c.get("idioma", "es")), headers=UA, timeout=45)
            r.raise_for_status()
            items = ET.fromstring(r.content).findall(".//item")
        except (requests.RequestException, ET.ParseError):
            fallas += 1
            continue
        for it in items[:cfg.get("max_por_consulta", 15)]:
            titulo = html.unescape(it.findtext("title") or "").strip()
            medio = (it.findtext("source") or "").strip()
            titulo = re.sub(rf"\s+-\s+{re.escape(medio)}$", "", titulo)
            k = _norm(titulo)
            if not titulo or k in vistas or not TOCA_TEMA.search(titulo):
                continue
            vistas[k] = {}
            try:
                f = email.utils.parsedate_to_datetime(it.findtext("pubDate")).date().isoformat()
            except (TypeError, ValueError):
                f = hoy().isoformat()
            nuevas.append({"titulo": titulo, "medio": medio, "fecha": f, "enlace": it.findtext("link"),
                           "tema": c["tema"], "ambito": c["ambito"], "idioma": c.get("idioma", "es")})
    if fallas == len(cfg["consultas"]):
        raise ErrorFuente("Google Noticias no respondió a ninguna consulta")
    corte = (hoy() - dt.timedelta(days=DIAS_MAX)).isoformat()
    # Las guardadas también pasan el filtro de tema (entraron antes de que existiera)
    previas = [n for n in previas if TOCA_TEMA.search(n["titulo"])]
    todas = sorted(nuevas + [n for n in previas if n["fecha"] >= corte], key=lambda n: (n["fecha"], n.get("ts", "")), reverse=True)[:MAX_GUARDADAS]
    todas = _sin_casi_duplicados(todas)
    escribir_json(SALIDA, {"_": "Generado por pipeline/fuentes/noticias.py. Titulares y enlaces; el contenido es de cada medio.",
                           "actualizado": ahora_utc(), "noticias": todas}, compacto=True)
    log(f"  {len(nuevas)} nuevas ({con_foto} de canales con foto), {len(todas)} guardadas, {sum(1 for n in todas if n.get('imagen'))} con imagen")
    return {"estado": "ok" if nuevas else "sin_cambios", "ultimo_dato": hoy().isoformat(), "fuente": "Google Noticias (RSS), titulares"}
