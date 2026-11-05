#!/usr/bin/env python3
"""
Lugares sensibles a El Niño para el mapa: presas, embalses, lagunas, glaciares,
cumbres y estaciones.

Se corre a mano (OpenStreetMap cambia poco), por ejemplo una vez al mes:
    python pipeline/herramientas/build_lugares.py

Fuente: OpenStreetMap vía la API Overpass. Licencia ODbL: la página debe
citar "© colaboradores de OpenStreetMap". Es un inventario colaborativo, no
oficial: los inventarios de la ANA (lagunas, presas) y del INAIGEM
(glaciares) son la referencia y deben reemplazarlo cuando el equipo los tenga.

Qué se incluye:
  presa     waterway=dam o man_made=dam
  embalse   water=reservoir (o landuse=reservoir)
  laguna    natural=water + water=lake, con nombre
  glaciar   natural=glacier (centro del polígono)
  cumbre    natural=peak o volcano, con nombre y sobre 4000 m o con artículo enciclopédico
  estacion  red de estaciones del SENAMHI (su mapa público), no OpenStreetMap
Cada lugar se ubica en su distrito (código INEI de 6 dígitos; los 4 y 2
primeros son provincia y región). Los embalses sin nombre se omiten.

Escribe sitio/datos/geo/lugares.geojson (puntos).
"""
from __future__ import annotations

import collections
import json
import re
import sys
import time
from pathlib import Path

import numpy as np
import requests
from matplotlib.path import Path as Trazo

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from comun import CACHE, DATOS, escribir_json, leer_json  # noqa: E402

# Servidores Overpass públicos; si uno está saturado se prueba el siguiente
ESPEJOS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]
CONSULTA = """[out:json][timeout:180];
area["ISO3166-1"="PE"][admin_level=2]->.pe;
(
  nwr["natural"="glacier"](area.pe);
  nwr["waterway"="dam"](area.pe);
  nwr["man_made"="dam"](area.pe);
  nwr["water"="reservoir"](area.pe);
  nwr["landuse"="reservoir"](area.pe);
  nwr["natural"="water"]["water"="lake"]["name"](area.pe);
  nwr["natural"="peak"]["name"](area.pe);
  nwr["natural"="volcano"]["name"](area.pe);
);
out tags center qt;"""
CACHE_OSM = CACHE / "osm_lugares.json"
URL_ESTACIONES = "https://www.senamhi.gob.pe/mapas/mapa-estaciones-2/"
ALTURA_MIN_CUMBRE = 4000


def tipo(t: dict) -> str | None:
    if t.get("natural") == "glacier":
        return "glaciar"
    if t.get("natural") in ("peak", "volcano"):
        return "cumbre"
    if t.get("waterway") == "dam" or t.get("man_made") == "dam":
        return "presa"
    if t.get("water") == "reservoir" or t.get("landuse") == "reservoir":
        return "embalse"
    if t.get("natural") == "water" and t.get("water") == "lake":
        return "laguna"
    return None


def bajar() -> dict:
    if CACHE_OSM.exists() and time.time() - CACHE_OSM.stat().st_mtime < 7 * 86400:
        return json.loads(CACHE_OSM.read_text(encoding="utf-8"))
    ultimo = None
    for url in ESPEJOS:
        for intento in range(2):
            try:
                r = requests.post(url, data={"data": CONSULTA}, timeout=300,
                                  headers={"User-Agent": "ensoperu (github.com/andresffigueroaa-blip/ensoperu)"})
                r.raise_for_status()
                d = r.json()
                CACHE.mkdir(parents=True, exist_ok=True)
                CACHE_OSM.write_bytes(r.content)
                print(f"Overpass: {url} ({len(d['elements'])} elementos)")
                return d
            except (requests.RequestException, ValueError) as e:
                ultimo = e
                print(f"  {url} intento {intento + 1}: {e}")
                time.sleep(15)
    raise SystemExit(f"Ningún servidor Overpass respondió: {ultimo}")


def _metros(texto) -> float | None:
    m = re.match(r"\s*(\d+(?:[.,]\d+)?)", str(texto or ""))
    return float(m.group(1).replace(",", ".")) if m else None


def estaciones() -> list[dict]:
    """Lista de estaciones del mapa público del SENAMHI (solo responde desde el Perú)."""
    r = requests.get(URL_ESTACIONES, timeout=90, headers={"User-Agent": "Mozilla/5.0 (ensoperu)"})
    r.raise_for_status()
    m = re.search(r"var\s+PruebaTest\s*=\s*(\[.*?\])\s*;", r.text, flags=re.S)
    if not m:
        raise SystemExit("SENAMHI: no encontré la lista de estaciones; ¿cambió la página?")
    # Se lee estación por estación: algunas vienen sin coordenadas y rompen el JSON
    salida, malas = [], []
    for texto in re.findall(r"\{[^{}]*\}", m.group(1)):
        try:
            e = json.loads(re.sub(r":\s*(-?)\.(\d)", r": \g<1>0.\2", texto))    # "-.1172" no es JSON válido
            if abs(e["lat"]) > 0 and abs(e["lon"]) > 0:
                salida.append(e)
        except (ValueError, KeyError, TypeError):
            malas.append(re.sub(r"\s+", " ", texto)[:90])
    print(f"Estaciones SENAMHI: {len(salida)} leídas, {len(malas)} sin coordenadas válidas {malas[:3]}")
    return salida


def ubicador():
    """Devuelve una función (lon, lat) -> (id_distrito, id_provincia, id_region)."""
    dist = leer_json(DATOS / "geo" / "distritos.geojson")
    trazos = []
    for f in dist["features"]:
        g = f["geometry"]
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        for p in polys:
            a = np.asarray(p[0])
            trazos.append((f["id"], Trazo(a), a.min(axis=0), a.max(axis=0)))

    def donde(lon, lat):
        for i, t, lo, hi in trazos:
            if lo[0] <= lon <= hi[0] and lo[1] <= lat <= hi[1] and t.contains_point((lon, lat)):
                return i, i[:4], i[:2]
        return None, None, None
    return donde


def main():
    datos = bajar()
    donde = ubicador()
    feats, conteo, fuera = [], collections.Counter(), 0
    vistos = set()
    for e in datos["elements"]:
        t = e.get("tags", {})
        k = tipo(t)
        if not k:
            continue
        c = e.get("center") or ({"lon": e["lon"], "lat": e["lat"]} if "lon" in e else None)
        if not c:
            continue
        lon, lat = round(c["lon"], 4), round(c["lat"], 4)
        if (k, lon, lat) in vistos:            # presa y embalse a veces se repiten
            continue
        vistos.add((k, lon, lat))
        dist, prov, reg = donde(lon, lat)
        if not dist:
            fuera += 1                          # en el mar o fuera del Perú simplificado
            continue
        nombre = t.get("name") or t.get("name:es") or ""
        # Los embalses sin nombre son casi todos reservorios agrícolas pequeños:
        # llenan el mapa sin aportar. Presas y glaciares se quedan aunque no tengan nombre.
        if k == "embalse" and not nombre:
            continue
        # Cumbres: solo las altas o las que tienen artículo; el resto llena el mapa
        if k == "cumbre" and (_metros(t.get("ele")) or 0) < ALTURA_MIN_CUMBRE and not (t.get("wikidata") or t.get("wikipedia")):
            continue
        # región y provincia se deducen del código de distrito (2 y 4 primeros dígitos)
        props = {"tipo": k, "nombre": nombre, "distrito": dist, "osm": f"{e['type']}/{e['id']}"}
        if t.get("ele"):
            props["altitud"] = t["ele"]
        if t.get("wikidata"):
            props["wikidata"] = t["wikidata"]
        # Datos técnicos, cuando la comunidad los cargó
        for clave, tag in (("wikipedia", "wikipedia"), ("operador", "operator"), ("altura", "height"),
                           ("capacidad", "volume"), ("rio", "river"), ("uso", "usage"), ("alias", "alt_name")):
            if t.get(tag):
                props[clave] = t[tag]
        if t.get("natural") == "volcano":
            props["volcan"] = 1
        feats.append({"type": "Feature", "properties": props,
                      "geometry": {"type": "Point", "coordinates": [lon, lat]}})
        conteo[k] += 1

    for e in estaciones():
        lon, lat = round(e["lon"], 4), round(e["lat"], 4)
        dist, _, _ = donde(lon, lat)
        if not dist:
            fuera += 1
            continue
        feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [lon, lat]},
                      "properties": {"tipo": "estacion", "nombre": re.sub(r"\s+", " ", e["nom"]).strip().title(), "distrito": dist,
                                     "cate": e.get("cate"), "clase": e.get("ico"), "cod": e.get("cod"),
                                     "cod_old": e.get("cod_old"), "estado": e.get("estado")}})
        conteo["estacion"] += 1

    escribir_json(DATOS / "geo" / "lugares.geojson", {
        "type": "FeatureCollection",
        "_": "Generado por pipeline/herramientas/build_lugares.py desde OpenStreetMap (ODbL). No editar a mano.",
        "fuente": "© colaboradores de OpenStreetMap",
        "features": feats}, compacto=True)
    kb = (DATOS / "geo" / "lugares.geojson").stat().st_size / 1024
    print(f"lugares.geojson: {len(feats)} lugares · {kb:.0f} KB · {dict(conteo)} · {fuera} fuera del territorio")


if __name__ == "__main__":
    main()
