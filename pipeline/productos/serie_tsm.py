"""
Producto: serie de anomalía de TSM del evento actual contra sus análogos.

Lee sitio/datos/indices/oisst_diario.csv (lo produce fuentes/oisst.py) y
escribe sitio/datos/series/tsm.json, que dibuja la curva de la portada.

Es la versión automática del gráfico del notebook: cada evento va de julio
del año anterior a diciembre del año siguiente a su año de desarrollo, con
media móvil centrada, sin el 29 de febrero, y todos alineados en un eje
común para poder superponerlos.
"""
from __future__ import annotations

import pandas as pd

from comun import DATOS, ErrorFuente, ErrorValidacion, escribir_json, leer_catalogo
from fuentes.oisst import leer_csv

SALIDA = DATOS / "series" / "tsm.json"
INDICES = ("n12", "n34")       # los que muestra la portada


def ventana(anio: int) -> tuple[pd.Timestamp, pd.Timestamp]:
    return pd.Timestamp(anio - 1, 7, 1), pd.Timestamp(anio + 1, 12, 31)


def serie_evento(df: pd.DataFrame, anio: int, suavizado: int) -> dict[str, list]:
    ini, fin = ventana(anio)
    # Se suaviza con un margen para que los bordes de la ventana no pierdan datos
    margen = pd.Timedelta(days=suavizado)
    trozo = df.loc[ini - margen: fin + margen, list(INDICES)]
    if suavizado > 1:
        trozo = trozo.rolling(suavizado, center=True, min_periods=1).mean()
    trozo = trozo.loc[ini:fin]
    trozo = trozo[~((trozo.index.month == 2) & (trozo.index.day == 29))]
    # Eje común: posición del día dentro de la ventana, con 365 días por año
    dias = pd.date_range(ini, fin, freq="D")
    dias = dias[~((dias.month == 2) & (dias.day == 29))]
    trozo = trozo.reindex(dias)
    # Se recortan los días sin dato al final (el evento actual llega hasta hoy)
    ult = trozo.dropna(how="all").index.max()
    if pd.isna(ult):
        return {}
    trozo = trozo.loc[:ult]
    return {k: [None if pd.isna(v) else round(float(v), 2) for v in trozo[k]] for k in INDICES}


def ejecutar(estado: dict) -> dict:
    cfg = leer_catalogo("analogos")
    cajas = leer_catalogo("cajas_nino")
    df = leer_csv()
    if df.empty:
        raise ErrorFuente("no existe oisst_diario.csv; correr primero el paso oisst")

    suav = int(cfg.get("suavizado_dias", 7))
    eventos, faltan = [], []
    for anio in [cfg["actual"], *cfg["analogos"]]:
        s = serie_evento(df, anio, suav)
        if not s:
            faltan.append(anio)
            continue
        eventos.append({
            "id": f"{anio}-{str(anio + 1)[-2:]}",
            "anio": anio,
            "actual": anio == cfg["actual"],
            "inicio": ventana(anio)[0].strftime("%Y-%m-%d"),
            **s,
        })

    if not eventos or not eventos[0]["actual"]:
        raise ErrorValidacion(f"no hay datos del evento actual ({cfg['actual']})")
    if faltan:
        # No es fatal: la portada dibuja los que haya. Se avisa para correr
        # el histórico (python pipeline/run.py --solo oisst --historico ...).
        print(f"  aviso: sin datos para los análogos {faltan}; falta descargar su histórico")

    ultimo = df.index[-1]
    escribir_json(SALIDA, {
        "_": "Generado por pipeline/productos/serie_tsm.py. No editar a mano.",
        "fuente": "NOAA OISST v2.1 High Resolution (PSL). Anomalía diaria respecto de 1991-2020.",
        "ultimo_dato": ultimo.strftime("%Y-%m-%d"),
        "suavizado_dias": suav,
        "indices": {k: cajas[k]["nombre"] for k in INDICES},
        "eventos": eventos,
    }, compacto=True)

    return {"estado": "ok", "ultimo_dato": ultimo.strftime("%Y-%m-%d"),
            "analogos_sin_datos": faltan}
