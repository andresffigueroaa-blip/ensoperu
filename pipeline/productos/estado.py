"""
Producto: estado ENSO actual para la portada (sitio/datos/estado.json).

Junta:
  - lo que publica el ENFEN (hoy ingresado a mano en catalogo/enfen.yaml;
    el bloque 4 lo leerá solo de los comunicados)
  - los índices mensuales: ICEN (IGP), ONI y RONI (CPC)
  - las anomalías diarias Niño 1+2 y 3.4 de OISST (media de los últimos
    7 días, para que un día ruidoso no mueva la cifra principal)

Cada índice lleva su propia fecha y fuente: la página nunca muestra un
número sin decir de cuándo es. Si una fuente no tiene CSV todavía, su valor
va como null y la página muestra "pendiente".
"""
from __future__ import annotations

import datetime as dt

import pandas as pd

from comun import DATOS, ErrorValidacion, escribir_json, leer_catalogo
from fuentes import cpc, igp
from fuentes.oisst import leer_csv
from productos.catalogo import ESTADOS_ALERTA

DIAS_MEDIA = 7


def _validar_enfen(e: dict) -> None:
    if e.get("alerta") not in ESTADOS_ALERTA:
        raise ErrorValidacion(f"enfen.yaml: alerta '{e.get('alerta')}' no es uno de {ESTADOS_ALERTA}")
    probs = e.get("probabilidades", {}).get("valores", {})
    total = sum(v for v in probs.values() if v is not None)
    if probs and abs(total - 100) > 1:
        raise ErrorValidacion(f"enfen.yaml: las probabilidades suman {total} %, deben sumar 100")
    if any(v is not None and not 0 <= v <= 100 for v in probs.values()):
        raise ErrorValidacion("enfen.yaml: hay una probabilidad fuera de 0 a 100")


def _indice_oisst(df, clave: str, nombre_caja: str) -> dict:
    ult = df[clave].dropna() if clave in df else pd.Series(dtype=float)
    if ult.empty:
        return {"valor": None, "fecha": None, "fuente": "NOAA OISST (sin datos todavía)"}
    tramo = ult.iloc[-DIAS_MEDIA:]
    return {
        "valor": round(float(tramo.mean()), 2),
        "fecha": ult.index[-1].strftime("%Y-%m-%d"),
        "fuente": f"NOAA OISST, media de {DIAS_MEDIA} días en la región {nombre_caja}",
    }


def _indice_mensual(s: pd.Series, fuente: str) -> dict:
    """Último valor de una serie mensual (índice con fecha del mes central)."""
    s = s.dropna()
    if s.empty:
        return {"valor": None, "fecha": None, "fuente": f"{fuente} (pendiente de conectar)"}
    return {"valor": round(float(s.iloc[-1]), 2), "fecha": s.index[-1].strftime("%Y-%m"),
            "fuente": fuente}


def ejecutar(estado: dict) -> dict:
    e = leer_catalogo("enfen")
    _validar_enfen(e)
    cajas = leer_catalogo("cajas_nino")
    df = leer_csv()
    mensual = cpc.leer_csv()
    icen = igp.leer_csv()
    fecha_com = str(e.get("fecha") or "")
    fuente_enfen = f"ENFEN, Comunicado Oficial {e.get('comunicado', '')}".strip()

    salida = {
        "_": "Generado por pipeline/productos/estado.py desde catalogo/enfen.yaml y los índices. No editar a mano.",
        "alerta": {
            "estado": e["alerta"],
            "estados": ESTADOS_ALERTA,
            "fuente": fuente_enfen,
            "fecha": fecha_com,
        },
        "indices": {
            "icen": _indice_mensual(icen, "IGP / ENFEN, trimestre móvil (ERSST, Niño 1+2)"),
            "oni":  _indice_mensual(mensual["oni"] if "oni" in mensual else pd.Series(dtype=float),
                                    "NOAA CPC, trimestre móvil (ERSST, Niño 3.4)"),
            "roni": _indice_mensual(mensual["roni"] if "roni" in mensual else pd.Series(dtype=float),
                                    "NOAA CPC, trimestre móvil, relativo al trópico"),
            "n12": _indice_oisst(df, "n12", cajas["n12"]["nombre"]),
            "n34": _indice_oisst(df, "n34", cajas["n34"]["nombre"]),
        },
        "probabilidades": {
            "periodo": e.get("probabilidades", {}).get("periodo"),
            "region": e.get("probabilidades", {}).get("region"),
            "fuente": fuente_enfen,
            "valores": [{"magnitud": k, "p": v}
                        for k, v in e.get("probabilidades", {}).get("valores", {}).items()],
        },
        "comunicados": [{"fecha": str(c["fecha"]), "texto": c["texto"]}
                        for c in e.get("comunicados", [])],
    }
    escribir_json(DATOS / "estado.json", salida)

    # Un comunicado de hace más de 45 días probablemente quedó sin actualizar
    aviso = None
    try:
        dias = (dt.date.today() - dt.date.fromisoformat(fecha_com)).days
        if dias > 45:
            aviso = f"el comunicado ENFEN cargado tiene {dias} días; revisar si salió uno nuevo"
    except ValueError:
        aviso = "enfen.yaml no tiene una fecha válida"
    return {"estado": "ok", "comunicado": e.get("comunicado"), "aviso": aviso}
