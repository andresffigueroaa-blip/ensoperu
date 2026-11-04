#!/usr/bin/env python3
"""
Referencia histórica de los ríos vigilados (catalogo/rios.yaml), con GloFAS vía
Open-Meteo: ubica cada punto sobre el cauce principal (celda vecina de mayor
caudal) y calcula percentiles de caudal diario 1984-2023.

Se corre a mano al agregar un río:  python pipeline/herramientas/build_rios.py
Escribe sitio/datos/rios/referencia.json.
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

import numpy as np
import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from comun import DATOS, escribir_json, leer_catalogo  # noqa: E402

URL = "https://flood-api.open-meteo.com/v1/flood"
PASO = 0.05     # grados; la grilla de GloFAS es de 0,05°


def pedir(lat, lon, ini, fin):
    for intento in range(4):
        r = requests.get(URL, params={"latitude": lat, "longitude": lon, "daily": "river_discharge",
                                      "start_date": ini, "end_date": fin}, timeout=120)
        if r.status_code == 429:
            time.sleep(70)
            continue
        r.raise_for_status()
        d = r.json()["daily"]
        return d["time"], np.array([np.nan if v is None else v for v in d["river_discharge"]], float)
    raise SystemExit("Open-Meteo: límite de uso")


def main():
    salida = {}
    for rio in leer_catalogo("rios"):
        mejor, q_mejor = (rio["lat"], rio["lon"]), -1.0
        for dla in (-2, -1, 0, 1, 2):
            for dlo in (-2, -1, 0, 1, 2):
                la, lo = round(rio["lat"] + dla * PASO, 3), round(rio["lon"] + dlo * PASO, 3)
                _, q = pedir(la, lo, "2021-01-01", "2021-12-31")
                m = float(np.nanmean(q)) if np.isfinite(q).any() else -1
                if m > q_mejor:
                    mejor, q_mejor = (la, lo), m
                time.sleep(0.15)
        t, q = pedir(mejor[0], mejor[1], "1984-01-01", "2023-12-31")
        q = q[np.isfinite(q)]
        meses = np.array([int(x[5:7]) for x in t])[:len(q)] if False else None
        t2, q2 = pedir(mejor[0], mejor[1], "1984-01-01", "2023-12-31")
        mes = np.array([int(x[5:7]) for x in t2])
        normal = [round(float(np.nanmean(q2[mes == m])), 1) for m in range(1, 13)]
        salida[rio["id"]] = {"lat": mejor[0], "lon": mejor[1], "media": round(float(np.nanmean(q2)), 1),
                             "p90": round(float(np.nanpercentile(q2, 90)), 1), "p99": round(float(np.nanpercentile(q2, 99)), 1),
                             "maximo": round(float(np.nanmax(q2)), 1),
                             "fecha_maximo": t2[int(np.nanargmax(q2))], "normal_mes": normal}
        print(f"{rio['nombre']:20s} ({mejor[0]}, {mejor[1]}) media {salida[rio['id']]['media']:8.1f}  p99 {salida[rio['id']]['p99']:9.1f}  "
              f"máx {salida[rio['id']]['maximo']:9.1f} el {salida[rio['id']]['fecha_maximo']}", flush=True)
    escribir_json(DATOS / "rios" / "referencia.json", {
        "_": "Generado por pipeline/herramientas/build_rios.py. Percentiles diarios de caudal GloFAS 1984-2023.",
        "fuente": "GloFAS (Copernicus) vía Open-Meteo", "periodo": "1984-2023", "rios": salida})


if __name__ == "__main__":
    main()
