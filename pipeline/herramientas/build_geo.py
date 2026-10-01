#!/usr/bin/env python3
"""
Geometrías del mapa: GeoJSON de departamentos -> paths SVG pre-proyectados.

Se corre a mano, solo cuando cambian los límites o las cajas Niño:

    python pipeline/herramientas/build_geo.py            todo (necesita el GeoJSON)
    python pipeline/herramientas/build_geo.py --cajas    solo recuadros Niño y vistas

El GeoJSON se descarga una vez (no va a git):
    curl -sL -o pipeline/cache/peru_dep.geojson \
      https://raw.githubusercontent.com/juaneladio/peru-geojson/master/peru_departamental_simple.geojson

Proyección: Mercator con origen en 176°W, 14°N y 22 unidades SVG por grado.
Las longitudes son continuas (160°E = -200) para que el Pacífico no se
corte en la línea de cambio de fecha. assets/app.js usa la misma fórmula.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from comun import CACHE, DATOS, escribir_json, leer_catalogo, leer_json  # noqa: E402

SCALE = 22.0
LON0, LAT0 = -176.0, 14.0   # esquina superior izquierda del sistema
EPS = 0.32                  # tolerancia de simplificación, en unidades SVG
GEOJSON = CACHE / "peru_dep.geojson"
SALIDA = DATOS / "geo" / "departamentos.json"


def merc_y(lat):
    lat = max(min(lat, 84.0), -84.0)
    return math.degrees(math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)))


Y0 = merc_y(LAT0)


def proj(lon, lat):
    return ((lon - LON0) * SCALE, (Y0 - merc_y(lat)) * SCALE)


def dp(pts, eps):
    """Simplificación Douglas-Peucker."""
    if len(pts) < 3:
        return pts

    def d(p, a, b):
        (x, y), (x1, y1), (x2, y2) = p, a, b
        dx, dy = x2 - x1, y2 - y1
        if dx == 0 and dy == 0:
            return math.hypot(x - x1, y - y1)
        t = max(0, min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)))
        return math.hypot(x - (x1 + t * dx), y - (y1 + t * dy))

    dmax, idx = 0.0, 0
    for i in range(1, len(pts) - 1):
        dd = d(pts[i], pts[0], pts[-1])
        if dd > dmax:
            dmax, idx = dd, i
    if dmax > eps:
        return dp(pts[:idx + 1], eps)[:-1] + dp(pts[idx:], eps)
    return [pts[0], pts[-1]]


def ring_to_path(ring, eps):
    pts = dp([proj(c[0], c[1]) for c in ring], eps)
    if len(pts) < 4:
        return None, 0.0
    a = sum(pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1] for i in range(len(pts) - 1))
    seg = ["M%.1f %.1f" % pts[0]] + ["L%.1f %.1f" % p for p in pts[1:-1]] + ["Z"]
    return "".join(seg), abs(a) / 2


def centroid(ring):
    pts = [proj(c[0], c[1]) for c in ring]
    a = cx = cy = 0.0
    for i in range(len(pts) - 1):
        (x1, y1), (x2, y2) = pts[i], pts[i + 1]
        f = x1 * y2 - x2 * y1
        a += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f
    if a == 0:
        return pts[0]
    a *= 0.5
    return (cx / (6 * a), cy / (6 * a))


def caja(lon1, lon2, lat1, lat2, margen=0.0):
    """[x, y, ancho, alto] en unidades SVG, con un margen opcional."""
    (x1, y1), (x2, y2) = proj(lon1, lat1), proj(lon2, lat2)
    return [round(min(x1, x2) - margen, 1), round(min(y1, y2) - margen, 1),
            round(abs(x2 - x1) + 2 * margen, 1), round(abs(y2 - y1) + 2 * margen, 1)]


def vistas_y_cajas() -> dict:
    """Vistas Perú y Pacífico, y recuadros Niño desde catalogo/cajas_nino.yaml."""
    out = {
        "viewPeru": caja(-81.4, -68.6, 0.1, -18.4, margen=25),
        # Desde 155°E (= -205) para que entre Niño 4 completo
        "viewPac": caja(-205, -66, 10, -20),
    }
    for clave, c in leer_catalogo("cajas_nino").items():
        lon1, lon2 = (v - 360 for v in c["lon"])      # 0-360 °E -> longitud continua
        out["nino" + clave[1:]] = caja(lon1, lon2, c["lat"][1], c["lat"][0])
    return out


def departamentos() -> list:
    if not GEOJSON.exists():
        sys.exit(f"Falta {GEOJSON}. Ver la cabecera de este archivo para descargarlo.")
    with open(GEOJSON, encoding="utf-8") as f:
        src = json.load(f)
    out = []
    for feat in src["features"]:
        geom = feat["geometry"]
        rings = geom["coordinates"] if geom["type"] == "Polygon" else [p[0] for p in geom["coordinates"]]
        parts, best_area, best_ring = [], 0.0, None
        for r in rings:
            pth, area = ring_to_path(r, EPS)
            if pth and area > 4:
                parts.append(pth)
                if area > best_area:
                    best_area, best_ring = area, r
        if parts:
            cx, cy = centroid(best_ring)
            out.append({"n": feat["properties"]["NOMBDEP"].title(), "d": "".join(parts),
                        "c": [round(cx, 1), round(cy, 1)]})
    return sorted(out, key=lambda x: x["n"])


def main():
    ap = argparse.ArgumentParser(description="Geometrías del mapa")
    ap.add_argument("--cajas", action="store_true", help="solo recalcular recuadros Niño y vistas")
    args = ap.parse_args()

    if args.cajas:
        data = leer_json(SALIDA)
        data.update(vistas_y_cajas())
    else:
        data = {"deps": departamentos(), **vistas_y_cajas()}
    escribir_json(SALIDA, data, compacto=True)
    print(f"{SALIDA.name}: {len(data['deps'])} departamentos")
    for k in ("viewPeru", "viewPac", "nino12", "nino3", "nino34", "nino4"):
        print(f"  {k:9s}{data[k]}")


if __name__ == "__main__":
    main()
