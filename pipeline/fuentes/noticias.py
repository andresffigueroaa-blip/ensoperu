"""
Fuente: noticias sobre El Niño y clima, por los canales RSS de Google Noticias.
Se guarda solo titular, medio, fecha y enlace al medio; el contenido es de cada
medio. No es una fuente de datos: las noticias pueden traer cifras preliminares.

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


def _norm(t: str) -> str:
    return re.sub(r"[^a-záéíóúñ0-9 ]", "", t.lower())[:70]


def ejecutar(estado: dict) -> dict:
    cfg = leer_catalogo("noticias")
    previas = (leer_json(SALIDA) or {}).get("noticias", [])
    vistas = {_norm(n["titulo"]) for n in previas}
    nuevas, fallas = [], 0
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
            if not titulo or k in vistas:
                continue
            vistas.add(k)
            try:
                f = email.utils.parsedate_to_datetime(it.findtext("pubDate")).date().isoformat()
            except (TypeError, ValueError):
                f = hoy().isoformat()
            nuevas.append({"titulo": titulo, "medio": medio, "fecha": f, "enlace": it.findtext("link"),
                           "tema": c["tema"], "ambito": c["ambito"], "idioma": c.get("idioma", "es")})
    if fallas == len(cfg["consultas"]):
        raise ErrorFuente("Google Noticias no respondió a ninguna consulta")
    corte = (hoy() - dt.timedelta(days=DIAS_MAX)).isoformat()
    todas = sorted(nuevas + [n for n in previas if n["fecha"] >= corte], key=lambda n: n["fecha"], reverse=True)[:MAX_GUARDADAS]
    escribir_json(SALIDA, {"_": "Generado por pipeline/fuentes/noticias.py. Titulares y enlaces; el contenido es de cada medio.",
                           "actualizado": ahora_utc(), "noticias": todas}, compacto=True)
    log(f"  {len(nuevas)} nuevas, {len(todas)} guardadas")
    return {"estado": "ok" if nuevas else "sin_cambios", "ultimo_dato": hoy().isoformat(), "fuente": "Google Noticias (RSS), titulares"}
