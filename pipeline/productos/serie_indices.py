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

# Umbrales para la gráfica. Solo se dibujan los verificados en fuente oficial:
#  ICEN: condición cálida débil >= +0,5 (Nota Técnica ENFEN 01-2024, citada en
#        el Comunicado Oficial ENFEN N° 07-2026). Los demás cortes de la nota
#        2024 están pendientes de verificar: no se dibujan.
#  ONI:  +0,5 / -0,5 (NOAA CPC).
UMBRALES = {
    "icen": {"fuente": "Nota Técnica ENFEN 01-2024", "nino": [["Cálida débil", 0.5]], "nina": []},
    "oni":  {"fuente": "NOAA CPC", "nino": [["El Niño", 0.5]], "nina": [["La Niña", -0.5]]},
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
