#!/usr/bin/env python3
"""
Qué sectores climáticos del SENAMHI tocan a cada región.

El pronóstico estacional del SENAMHI se publica por 13 sectores fijos (costa
norte, sierra sur occidental...). Para el boletín de cada región hace falta saber
cuáles le corresponden. Se ubica el centro de cada distrito dentro de los
polígonos oficiales y se cuenta qué parte de los distritos de la región cae en
cada sector.

Los polígonos pesan unos 68 MB: por eso se corre a mano, una vez o cuando el
SENAMHI cambie sus sectores, y no en cada corrida del robot:
    python pipeline/herramientas/build_sectores.py

Escribe sitio/datos/peru/sectores_region.json.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import requests
from matplotlib.path import Path as Trazo

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from comun import DATOS, escribir_json, leer_json  # noqa: E402

URL = ("https://idesep.senamhi.gob.pe/geoserver/ows?service=WFS&version=1.0.0&request=GetFeature"
       "&outputFormat=application/json&typeName=spc:prono_trim_poligono_pp1&srsName=EPSG:4326")


def main():
    r = requests.get(URL, timeout=300)
    r.raise_for_status()
    feats = json.loads(r.content.decode("utf-8", errors="replace"))["features"]
    distritos = [x for x in leer_json(DATOS / "geo" / "unidades.json")["unidades"] if x["nivel"] == "distrito" and x.get("centro")]
    puntos = np.array([d["centro"] for d in distritos])
    sector = np.full(len(distritos), "", dtype=object)
    for f in feats:
        nombre = str(f["properties"].get("sectores") or "").strip().title()
        g = f["geometry"]
        for poly in (g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]):
            dentro = Trazo(np.asarray(poly[0])).contains_points(puntos)
            sector[dentro & (sector == "")] = nombre
    cuenta = {}
    for d, s in zip(distritos, sector):
        if s:
            cuenta.setdefault(d["region"], {}).setdefault(s, 0)
            cuenta[d["region"]][s] += 1
    salida = {r: sorted(([s, round(n / sum(c.values()), 2)] for s, n in c.items()), key=lambda x: -x[1]) for r, c in cuenta.items()}
    escribir_json(DATOS / "peru" / "sectores_region.json",
                  {"_": "Generado por pipeline/herramientas/build_sectores.py. Región -> [sector SENAMHI, fracción de sus distritos].",
                   "regiones": salida})
    sin = int((sector == "").sum())
    print(f"{len(salida)} regiones; {sin} distritos sin sector (fuera de los polígonos). Piura: {salida.get('20')}; Puno: {salida.get('21')}")


if __name__ == "__main__":
    main()
