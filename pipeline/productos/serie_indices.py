"""
Producto: series mensuales de los índices oficiales para la gráfica histórica.

Lee indices/icen.csv (IGP) e indices/cpc_mensual.csv (CPC) y escribe
sitio/datos/series/indices.json: una fila por mes desde 1950, con ICEN, ONI
y RONI (null donde no hay dato). Es lo que dibuja la sección "Historia" de
la portada y, más adelante, la vista Monitoreo.
"""
from __future__ import annotations

import pandas as pd

from comun import DATOS, ErrorFuente, escribir_json
from fuentes import cpc, igp

SALIDA = DATOS / "series" / "indices.json"
DESDE = 1950

# Umbrales oficiales, de la Figura 2 del Comunicado ENFEN N° 19-2026
# (que aplica la Nota Técnica ENFEN 01-2024). RONI y ONI: mismos cortes del CPC.
UMBRALES = {
    "icen": {"fuente": "ENFEN, Nota Técnica 01-2024",
             "nino": [["Débil", 0.5], ["Moderada", 1.3], ["Fuerte", 2.1], ["Extraordinaria", 3.5]],
             "nina": [["Débil", -0.7], ["Moderada", -1.1], ["Fuerte", -1.3]]},
    "oni":  {"fuente": "NOAA CPC", "nino": [["Débil", 0.5], ["Moderada", 1.0], ["Fuerte", 1.5], ["Muy fuerte", 2.0]],
             "nina": [["Débil", -0.5], ["Moderada", -1.0], ["Fuerte", -1.5]]},
}


def ejecutar(estado: dict) -> dict:
    icen = igp.leer_csv()
    mensual = cpc.leer_csv()
    if icen.empty and mensual.empty:
        raise ErrorFuente("no hay índices mensuales todavía; correr primero igp y cpc")
    df = pd.concat([icen.rename("icen"), mensual], axis=1).sort_index()
    df = df[df.index.year >= DESDE]
    df = df.dropna(how="all")
    fechas = [d.strftime("%Y-%m") for d in df.index]
    cols = {k: [None if pd.isna(v) else round(float(v), 2) for v in df[k]] if k in df else []
            for k in ("icen", "oni", "roni")}
    escribir_json(SALIDA, {
        "_": "Generado por pipeline/productos/serie_indices.py. No editar a mano.",
        "desde": fechas[0], "hasta": fechas[-1],
        "fuentes": {"icen": "IGP / ENFEN (Nota Técnica 2024)", "oni": "NOAA CPC", "roni": "NOAA CPC"},
        "umbrales": UMBRALES,
        "fechas": fechas, **cols,
    }, compacto=True)
    return {"estado": "ok", "ultimo_dato": fechas[-1], "meses": len(fechas)}
