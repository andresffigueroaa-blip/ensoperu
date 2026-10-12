"""
Fuente: índices mensuales ONI y RONI del Climate Prediction Center (NOAA).

  ONI   Oceanic Niño Index: media móvil de 3 meses de la anomalía de TSM en
        Niño 3.4 (ERSST). El CPC lo publica como texto plano.
        https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt
  RONI  Relative ONI: igual, pero restando la anomalía tropical global, para
        que el calentamiento de fondo no infle el índice. El CPC solo lo
        publica como tabla HTML; se lee esa tabla.
        https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso/roni/

Ambos se refieren a trimestres (DJF, JFM, ...); aquí cada valor se asigna al
mes central del trimestre (DJF -> enero, JFM -> febrero, ..., NDJ -> diciembre).

Escribe sitio/datos/indices/cpc_mensual.csv con columnas fecha, oni, roni.
"""
from __future__ import annotations

import re

import pandas as pd
import requests

from comun import DATOS, ErrorFuente, ErrorValidacion, hoy, log

URL_ONI = "https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt"
URL_RONI = "https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso/roni/"
CSV = DATOS / "indices" / "cpc_mensual.csv"

TRIMESTRES = ["DJF", "JFM", "FMA", "MAM", "AMJ", "MJJ", "JJA", "JAS", "ASO", "SON", "OND", "NDJ"]
RANGO = (-4.0, 4.0)        # °C; ONI histórico máximo ~2.6
MESES_MAX_RETRASO = 3      # el CPC publica el trimestre con ~1 mes de rezago


def _bajar(url: str) -> str:
    try:
        r = requests.get(url, timeout=60, headers={"User-Agent": "ensoperu-pipeline"})
        r.raise_for_status()
        return r.text
    except requests.RequestException as e:
        raise ErrorFuente(f"CPC no responde ({url}): {e}") from e


def leer_oni(texto: str) -> pd.Series:
    """Texto ' SEAS YR TOTAL ANOM' -> serie mensual indexada por fecha."""
    filas = {}
    for linea in texto.splitlines():
        p = linea.split()
        if len(p) == 4 and p[0] in TRIMESTRES and p[1].isdigit():
            fecha = pd.Timestamp(int(p[1]), TRIMESTRES.index(p[0]) + 1, 1)
            filas[fecha] = float(p[3])
    if len(filas) < 100:
        raise ErrorValidacion(f"ONI: solo se leyeron {len(filas)} valores; ¿cambió el formato?")
    return pd.Series(filas, name="oni").sort_index()


def leer_roni(html: str) -> pd.Series:
    """Tabla HTML del CPC -> serie mensual. Se quitan las etiquetas y se busca
    cada año seguido de hasta 12 números."""
    bloque = re.search(r'id="roni-v5-table2".*?</table>', html, re.S)
    if not bloque:
        raise ErrorValidacion("RONI: no encontré la tabla 'roni-v5-table2' en la página del CPC")
    texto = re.sub(r"<[^>]+>", " ", bloque.group(0))
    texto = re.sub(r"&[a-z]+;", " ", texto)
    tokens = texto.split()
    filas = {}
    i = 0
    while i < len(tokens):
        t = tokens[i]
        if re.fullmatch(r"(19|20)\d\d", t):
            anio, j = int(t), i + 1
            while j < len(tokens) and j - i <= 12 and re.fullmatch(r"-?\d+(\.\d+)?", tokens[j]):
                filas[pd.Timestamp(anio, j - i, 1)] = float(tokens[j])
                j += 1
            i = j
        else:
            i += 1
    if len(filas) < 100:
        raise ErrorValidacion(f"RONI: solo se leyeron {len(filas)} valores; ¿cambió la tabla?")
    return pd.Series(filas, name="roni").sort_index()


def _validar(df: pd.DataFrame) -> None:
    lo, hi = RANGO
    fuera = ((df < lo) | (df > hi)).to_numpy()
    if fuera.any():
        raise ErrorValidacion(f"CPC: {int(fuera.sum())} valores fuera de {RANGO}")
    ultimo = df.dropna(how="all").index.max()
    meses = (hoy().year - ultimo.year) * 12 + hoy().month - ultimo.month
    if meses > MESES_MAX_RETRASO:
        raise ErrorValidacion(f"CPC: el último trimestre es {ultimo:%Y-%m}, {meses} meses de retraso")


def leer_csv() -> pd.DataFrame:
    if not CSV.exists():
        return pd.DataFrame()
    return pd.read_csv(CSV, index_col="fecha", parse_dates=["fecha"])


def ejecutar(estado: dict) -> dict:
    oni = leer_oni(_bajar(URL_ONI))
    roni = leer_roni(_bajar(URL_RONI))
    df = pd.concat([oni, roni], axis=1).sort_index()
    df.index.name = "fecha"
    _validar(df)

    previo = leer_csv()
    cambio = previo.empty or not previo.round(2).equals(df.round(2))
    if cambio:
        CSV.parent.mkdir(parents=True, exist_ok=True)
        df.to_csv(CSV, float_format="%.2f", date_format="%Y-%m-%d", lineterminator="\n")
    uo, ur = oni.index.max(), roni.index.max()
    log(f"  ONI {uo:%Y-%m} {oni.iloc[-1]:+.2f} · RONI {ur:%Y-%m} {roni.iloc[-1]:+.2f}")
    return {"estado": "ok" if cambio else "sin_cambios",
            "ultimo_dato": max(uo, ur).strftime("%Y-%m"),
            "fuente": "NOAA CPC (ONI y RONI, trimestres móviles)"}
