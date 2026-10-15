#!/usr/bin/env python3
"""
Unidades territoriales para el mapa interactivo: regiones, provincias y distritos.

Se corre a mano, solo cuando cambian los límites:
    python pipeline/herramientas/build_unidades.py

Fuente: github.com/juaneladio/peru-geojson (límites INEI simplificados; 25
departamentos, 197 provincias, 1834 distritos). No es la versión vigente
del INEI (hoy ~1890 distritos): reemplazar cuando el equipo tenga la oficial.

Escribe en sitio/datos/geo/:
  regiones.geojson    polígonos en lon/lat, simplificados
  provincias.geojson
  distritos.geojson
  unidades.json       índice para el buscador y para el pipeline: id, nombre,
                      nivel, padres, caja (bbox), centro y puntos de muestreo
                      (hasta 5 puntos dentro del polígono, para promediar
                      pronósticos por punto como los de Open-Meteo)
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import numpy as np
import requests
from matplotlib.path import Path as Trazo

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from comun import CACHE, DATOS, escribir_json  # noqa: E402

BASE = "https://raw.githubusercontent.com/juaneladio/peru-geojson/master/peru_{}_simple.geojson"
SALIDA = DATOS / "geo"
# Tolerancia de simplificación en grados (~ 0,01° = 1 km) y decimales
EPS = {"regiones": 0.006, "provincias": 0.004, "distritos": 0.0025}
DEC = 3


def bajar(nombre: str) -> dict:
    ruta = CACHE / f"peru_{nombre}.geojson"
    if not ruta.exists():
        r = requests.get(BASE.format(nombre), timeout=120)
        r.raise_for_status()
        CACHE.mkdir(parents=True, exist_ok=True)
        ruta.write_bytes(r.content)
    with open(ruta, encoding="utf-8") as f:
        return json.load(f)


def titulo(s: str) -> str:
    """'MADRE DE DIOS' -> 'Madre de Dios'. Mantiene minúsculas en artículos."""
    menores = {"de", "del", "la", "las", "los", "y", "el"}
    p = s.strip().lower().split()
    return " ".join(w if (i and w in menores) else w.capitalize() for i, w in enumerate(p))


def dp(pts, eps):
    """Douglas-Peucker iterativo sobre una lista de (lon, lat)."""
    if len(pts) < 4:
        return pts
    a = np.asarray(pts)
    keep = np.zeros(len(a), bool)
    keep[0] = keep[-1] = True
    pila = [(0, len(a) - 1)]
    while pila:
        i, j = pila.pop()
        if j <= i + 1:
            continue
        p0, p1 = a[i], a[j]
        seg = p1 - p0
        n = np.hypot(*seg)
        sub = a[i + 1:j]
        if n == 0:
            d = np.hypot(*(sub - p0).T)
        else:
            r = sub - p0
            d = np.abs(seg[0] * r[:, 1] - seg[1] * r[:, 0]) / n
        k = int(d.argmax())
        if d[k] > eps:
            m = i + 1 + k
            keep[m] = True
            pila += [(i, m), (m, j)]
    return a[keep].tolist()


def simplificar(geom: dict, eps: float) -> dict | None:
    polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    salida = []
    for poly in polys:
        anillos = []
        for k, anillo in enumerate(poly):
            s = [[round(x, DEC), round(y, DEC)] for x, y in dp(anillo, eps)]
            if len(s) >= 4:
                anillos.append(s)
            elif k == 0:
                break               # se perdió el borde exterior: se descarta el polígono
        if anillos:
            salida.append(anillos)
    if not salida:
        return None
    return {"type": "MultiPolygon", "coordinates": salida} if len(salida) > 1 else \
           {"type": "Polygon", "coordinates": salida[0]}


def exteriores(geom: dict) -> list[np.ndarray]:
    polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    return [np.asarray(p[0]) for p in polys]


def area_y_centro(anillo: np.ndarray) -> tuple[float, tuple[float, float]]:
    x, y = anillo[:, 0], anillo[:, 1]
    f = x[:-1] * y[1:] - x[1:] * y[:-1]
    a = f.sum() / 2
    if abs(a) < 1e-12:
        return 0.0, (float(x.mean()), float(y.mean()))
    return abs(a), (float(((x[:-1] + x[1:]) * f).sum() / (6 * a)), float(((y[:-1] + y[1:]) * f).sum() / (6 * a)))


def puntos_muestreo(geom: dict, n: int = 5) -> list[list[float]]:
    """Hasta n puntos dentro del polígono principal, repartidos en una grilla."""
    anillo = max(exteriores(geom), key=lambda r: area_y_centro(r)[0])
    trazo = Trazo(anillo)
    x0, y0 = anillo.min(axis=0)
    x1, y1 = anillo.max(axis=0)
    for paso in (7, 11, 17, 25):
        gx, gy = np.meshgrid(np.linspace(x0, x1, paso), np.linspace(y0, y1, paso))
        cand = np.c_[gx.ravel(), gy.ravel()]
        dentro = cand[trazo.contains_points(cand)]
        if len(dentro) >= 1:
            break
    if not len(dentro):
        return [[round(float(v), 3) for v in area_y_centro(anillo)[1]]]
    # se eligen n puntos bien repartidos: el más cercano al centro y luego los más lejanos
    _, c = area_y_centro(anillo)
    elegidos = [int(np.argmin(np.hypot(*(dentro - c).T)))]
    while len(elegidos) < min(n, len(dentro)):
        d = np.min([np.hypot(*(dentro - dentro[e]).T) for e in elegidos], axis=0)
        elegidos.append(int(d.argmax()))
    return [[round(float(p[0]), 3), round(float(p[1]), 3)] for p in dentro[elegidos]]


def fusionar_duplicados(fuente: dict, clave) -> list[dict]:
    """La fuente trae algunas unidades partidas en dos polígonos con el mismo
    código (p. ej. 'PIURA' y 'PUIRA'): se unen en un MultiPolygon."""
    por_id: dict[str, dict] = {}
    for f in fuente["features"]:
        if not f.get("geometry"):
            continue
        i = clave(f["properties"])
        g = f["geometry"]
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        if i in por_id:
            por_id[i]["geometry"]["coordinates"] += polys
            print(f"  fusionado: {i} ({f['properties']})")
        else:
            por_id[i] = {"type": "Feature", "properties": f["properties"],
                         "geometry": {"type": "MultiPolygon", "coordinates": list(polys)}}
    return list(por_id.values())


def construir(nivel: str, fuente: dict, props, clave) -> tuple[dict, list]:
    feats, indice = [], []
    sin_geom = [f["properties"] for f in fuente["features"] if not f.get("geometry")]
    for p in sin_geom:
        print(f"  aviso: {nivel} sin geometría en la fuente: {p.get('NOMBDIST') or p.get('NOMBPROV') or p.get('NOMBDEP')}")
    for f in fusionar_duplicados(fuente, clave):
        p = props(f["properties"])
        g = simplificar(f["geometry"], EPS[nivel])
        if g is None:
            continue
        a = np.vstack(exteriores(f["geometry"]))
        bbox = [round(float(v), 3) for v in (*a.min(axis=0), *a.max(axis=0))]
        anillo = max(exteriores(f["geometry"]), key=lambda r: area_y_centro(r)[0])
        centro = [round(v, 3) for v in area_y_centro(anillo)[1]]
        feats.append({"type": "Feature", "id": p["id"], "properties": {"id": p["id"], "nombre": p["nombre"]}, "geometry": g})
        indice.append({**p, "nivel": nivel[:-1] if nivel != "regiones" else "region", "caja": bbox,
                       "centro": centro, "muestreo": puntos_muestreo(f["geometry"])})
    return {"type": "FeatureCollection", "features": feats}, indice


def main():
    dep = bajar("departamental")
    prov = bajar("provincial")
    dist = bajar("distrital")

    # La tabla de distritos es la que tiene bien los códigos y los nombres:
    # de ahí salen los nombres de provincias y regiones (la capa de
    # provincias trae errores de tipeo como 'PUIRA')
    cod_dep, nombre_dep, nombre_prov = {}, {}, {}
    for f in dist["features"]:
        p = f["properties"]
        cod_dep[p["NOMBDEP"].strip().upper()] = p["IDDPTO"]
        nombre_dep[p["IDDPTO"]] = titulo(p["NOMBDEP"])
        nombre_prov[p["IDPROV"]] = titulo(p["NOMBPROV"])

    regiones, i1 = construir("regiones", dep, lambda p: {
        "id": cod_dep[p["NOMBDEP"].strip().upper()], "nombre": titulo(p["NOMBDEP"]),
        "clave": p["NOMBDEP"].strip().title()}, lambda p: cod_dep[p["NOMBDEP"].strip().upper()])
    provincias, i2 = construir("provincias", prov, lambda p: {
        "id": p["FIRST_IDPR"], "nombre": nombre_prov.get(p["FIRST_IDPR"], titulo(p["NOMBPROV"])),
        "region": p["FIRST_IDPR"][:2], "region_nombre": nombre_dep.get(p["FIRST_IDPR"][:2], titulo(p["FIRST_NOMB"]))},
        lambda p: p["FIRST_IDPR"])
    distritos, i3 = construir("distritos", dist, lambda p: {
        "id": p["IDDIST"], "nombre": titulo(p["NOMBDIST"]),
        "provincia": p["IDPROV"], "provincia_nombre": titulo(p["NOMBPROV"]),
        "region": p["IDDPTO"], "region_nombre": titulo(p["NOMBDEP"])}, lambda p: p["IDDIST"])

    for nombre, fc in (("regiones", regiones), ("provincias", provincias), ("distritos", distritos)):
        escribir_json(SALIDA / f"{nombre}.geojson", fc, compacto=True)
        kb = (SALIDA / f"{nombre}.geojson").stat().st_size / 1024
        print(f"{nombre:11s} {len(fc['features']):5d} unidades · {kb:6.0f} KB")
    todas = i1 + i2 + i3
    # El índice que lee la página (buscador) va sin los puntos de muestreo,
    # que solo usa el pipeline
    escribir_json(SALIDA / "unidades.json", {
        "_": "Generado por pipeline/herramientas/build_unidades.py. Índice de unidades (INEI) para el buscador.",
        "fuente": "Límites INEI simplificados (github.com/juaneladio/peru-geojson)",
        "unidades": [{k: v for k, v in u.items() if k != "muestreo"} for u in todas]}, compacto=True)
    escribir_json(SALIDA / "muestreo.json", {
        "_": "Puntos dentro de cada región y provincia para promediar pronósticos por punto. Solo lo usa el pipeline.",
        "puntos": {u["id"]: u["muestreo"] for u in i1 + i2}}, compacto=True)
    for n in ("unidades.json", "muestreo.json"):
        print(f"{n:15s} {(SALIDA / n).stat().st_size / 1024:6.0f} KB")


if __name__ == "__main__":
    main()
