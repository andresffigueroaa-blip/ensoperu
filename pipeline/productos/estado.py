"""
Producto: estado ENSO actual para la portada (sitio/datos/estado.json).

Junta:
  - el comunicado del ENFEN leído del PDF (fuentes/enfen.py) y, para las
    probabilidades que vienen como imagen, la tabla de catalogo/enfen.yaml
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

from comun import DATOS, ErrorValidacion, escribir_json, leer_catalogo, leer_json
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


def _magnitud_icen(v):
    if v is None:
        return None
    for corte, n in ((3.5, "Extraordinaria"), (2.1, "Fuerte"), (1.3, "Moderada"), (0.5, "Débil")):
        if v > corte or (corte == 0.5 and v >= corte):
            return "Cálida " + n.lower()
    for corte, n in ((-1.3, "Fuerte"), (-1.1, "Moderada"), (-0.7, "Débil")):
        if v < corte:
            return "Fría " + n.lower()
    return "Neutra"


def ejecutar(estado: dict) -> dict:
    e = leer_catalogo("enfen")
    com = leer_json(DATOS / "enfen" / "comunicado.json")      # lo leído del PDF manda
    hist = leer_json(DATOS / "enfen" / "historial.json") or {"comunicados": []}
    cajas = leer_catalogo("cajas_nino")
    df = leer_csv()
    mensual = cpc.leer_csv()
    icen = igp.leer_csv()
    alerta_est = com["alerta"] if com else e["alerta"]
    fecha_com = com["fecha"] if com else str(e.get("fecha") or "")
    id_com = com["id"] if com else e.get("comunicado", "")
    fuente_enfen = f"ENFEN, Comunicado Oficial {id_com}"
    ind_icen = _indice_mensual(icen, "IGP / ENFEN, trimestre móvil (ERSST, Niño 1+2)")
    ind_icen["magnitud"] = _magnitud_icen(ind_icen["valor"])

    # Probabilidades: la tabla que el equipo transcribe de la figura del PDF. Si
    # el comunicado leído es más nuevo, la página avisa y muestra las figuras.
    tabla = e.get("probabilidades_mensuales") or {}
    salida = {
        "_": "Generado por pipeline/productos/estado.py desde el comunicado del ENFEN y los índices. No editar a mano.",
        "alerta": {"estado": alerta_est, "estados": ESTADOS_ALERTA, "fuente": fuente_enfen, "fecha": fecha_com,
                   "titular": (com or {}).get("titular"), "resumen": (com or {}).get("resumen"),
                   "proximo": (com or {}).get("proximo"), "url": (com or {}).get("url")},
        "temas": (com or {}).get("temas", {}),
        "figuras": (com or {}).get("figuras", []),
        "indices": {
            "icen": ind_icen,
            "oni":  _indice_mensual(mensual["oni"] if "oni" in mensual else pd.Series(dtype=float),
                                    "NOAA CPC, trimestre móvil (ERSST, Niño 3.4)"),
            "roni": _indice_mensual(mensual["roni"] if "roni" in mensual else pd.Series(dtype=float),
                                    "NOAA CPC, trimestre móvil, relativo al trópico"),
            "n12": _indice_oisst(df, "n12", cajas["n12"]["nombre"]),
            "n34": _indice_oisst(df, "n34", cajas["n34"]["nombre"]),
        },
        "probabilidades": {**tabla, "meses": [str(m) for m in tabla.get("meses", [])], "vigente": tabla.get("comunicado") == id_com},
        "comunicados": [{"fecha": c["fecha"], "id": c["id"], "texto": (c.get("titular") or c["alerta"]).capitalize(), "url": c.get("url")}
                        for c in hist["comunicados"][:6]],
    }
    escribir_json(DATOS / "estado.json", salida)

    aviso = None
    try:
        dias = (dt.date.today() - dt.date.fromisoformat(fecha_com)).days
        if dias > 21:
            aviso = f"el comunicado ENFEN cargado tiene {dias} días"
    except ValueError:
        aviso = "no hay fecha de comunicado válida"
    return {"estado": "ok", "ultimo_dato": fecha_com, "comunicado": id_com, "aviso": aviso}
