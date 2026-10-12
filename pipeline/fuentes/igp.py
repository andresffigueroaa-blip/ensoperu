"""
Fuente: ICEN (Índice Costero El Niño) del Instituto Geofísico del Perú.

Media móvil de 3 meses de la anomalía de TSM en Niño 1+2 (ERSST), que el
ENFEN usa para declarar El Niño y La Niña costeros. El IGP lo publica como
texto plano, versión oficial según la Nota Técnica ENFEN 2024:
    http://met.igp.gob.pe/datos/ICEN.txt

Cada valor corresponde al mes central del trimestre.
Escribe sitio/datos/indices/icen.csv con columnas fecha, icen.
"""
from __future__ import annotations

import pandas as pd
import requests

from comun import DATOS, ErrorFuente, ErrorValidacion, hoy, log

URL = "http://met.igp.gob.pe/datos/ICEN.txt"
CSV = DATOS / "indices" / "icen.csv"
RANGO = (-4.0, 7.0)        # °C; 1997-98 llegó a ~+4.5
MESES_MAX_RETRASO = 4      # el IGP publica con 1 a 2 meses de rezago


def leer_icen(texto: str) -> pd.Series:
    filas = {}
    for linea in texto.splitlines():
        if linea.startswith("%") or not linea.strip():
            continue
        p = linea.split()
        if len(p) == 3 and p[0].isdigit() and p[1].isdigit():
            filas[pd.Timestamp(int(p[0]), int(p[1]), 1)] = float(p[2])
    if len(filas) < 100:
        raise ErrorValidacion(f"ICEN: solo se leyeron {len(filas)} valores; ¿cambió el formato?")
    return pd.Series(filas, name="icen").sort_index()


def leer_csv() -> pd.Series:
    if not CSV.exists():
        return pd.Series(dtype=float)
    return pd.read_csv(CSV, index_col="fecha", parse_dates=["fecha"])["icen"]


def ejecutar(estado: dict) -> dict:
    try:
        r = requests.get(URL, timeout=60, headers={"User-Agent": "ensoperu-pipeline"})
        r.raise_for_status()
    except requests.RequestException as e:
        raise ErrorFuente(f"IGP no responde: {e}") from e
    s = leer_icen(r.text)

    lo, hi = RANGO
    if ((s < lo) | (s > hi)).any():
        raise ErrorValidacion(f"ICEN: valores fuera de {RANGO}")
    ultimo = s.index.max()
    meses = (hoy().year - ultimo.year) * 12 + hoy().month - ultimo.month
    if meses > MESES_MAX_RETRASO:
        raise ErrorValidacion(f"ICEN: el último mes es {ultimo:%Y-%m}, {meses} meses de retraso")

    previo = leer_csv()
    cambio = previo.empty or not previo.round(2).equals(s.round(2))
    if cambio:
        CSV.parent.mkdir(parents=True, exist_ok=True)
        s.rename_axis("fecha").to_csv(CSV, float_format="%.2f", date_format="%Y-%m-%d", lineterminator="\n")
    log(f"  ICEN {ultimo:%Y-%m} {s.iloc[-1]:+.2f}")
    return {"estado": "ok" if cambio else "sin_cambios",
            "ultimo_dato": ultimo.strftime("%Y-%m"),
            "fuente": "IGP / ENFEN (ICEN, Nota Técnica 2024)"}
