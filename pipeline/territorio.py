"""
Utilidades territoriales compartidas: ubicar un punto en su distrito,
provincia y región (códigos INEI), y leer el índice de unidades.

Usan sitio/datos/geo/distritos.geojson y unidades.json, que genera
pipeline/herramientas/build_unidades.py.
"""
from __future__ import annotations

from functools import lru_cache

import numpy as np
from matplotlib.path import Path as Trazo

from comun import DATOS, ErrorFuente, leer_json


@lru_cache(maxsize=1)
def _trazos():
    dist = leer_json(DATOS / "geo" / "distritos.geojson")
    if not dist:
        raise ErrorFuente("falta geo/distritos.geojson; correr herramientas/build_unidades.py")
    out = []
    for f in dist["features"]:
        g = f["geometry"]
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        for p in polys:
            a = np.asarray(p[0])
            out.append((f["id"], Trazo(a), a.min(axis=0), a.max(axis=0)))
    return out


def ubicar(lon: float, lat: float) -> str | None:
    """Código de distrito (6 dígitos) que contiene el punto, o None."""
    for i, t, lo, hi in _trazos():
        if lo[0] <= lon <= hi[0] and lo[1] <= lat <= hi[1] and t.contains_point((lon, lat)):
            return i
    return None


def ubicar_muchos(lon: np.ndarray, lat: np.ndarray) -> np.ndarray:
    """Vectorizado: código de distrito para cada punto ('' si cae fuera)."""
    pts = np.c_[lon, lat]
    res = np.full(len(pts), "", dtype=object)
    for i, t, lo, hi in _trazos():
        caja = (pts[:, 0] >= lo[0]) & (pts[:, 0] <= hi[0]) & (pts[:, 1] >= lo[1]) & (pts[:, 1] <= hi[1]) & (res == "")
        if caja.any():
            idx = np.flatnonzero(caja)
            dentro = t.contains_points(pts[idx])
            res[idx[dentro]] = i
    return res


@lru_cache(maxsize=1)
def unidades() -> dict:
    """id -> entrada del índice (región, provincia o distrito)."""
    u = leer_json(DATOS / "geo" / "unidades.json")
    if not u:
        raise ErrorFuente("falta geo/unidades.json; correr herramientas/build_unidades.py")
    return {x["id"]: x for x in u["unidades"]}


def muestreo() -> dict:
    """id de región o provincia -> lista de puntos [lon, lat] dentro de ella."""
    m = leer_json(DATOS / "geo" / "muestreo.json")
    if not m:
        raise ErrorFuente("falta geo/muestreo.json; correr herramientas/build_unidades.py")
    return m["puntos"]
