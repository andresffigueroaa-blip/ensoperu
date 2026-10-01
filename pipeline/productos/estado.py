"""
Producto: estado ENSO actual para la portada (sitio/datos/estado.json).

Junta dos cosas:
  - lo que publica el ENFEN (hoy ingresado a mano en catalogo/enfen.yaml;
    el bloque 4 lo leerá solo de los comunicados)
  - las anomalías Niño 1+2 y 3.4 calculadas de OISST (media de los
    últimos 7 días, para que un día ruidoso no mueva la cifra principal)

Cada índice lleva su propia fecha y fuente: la página nunca muestra un
número sin decir de cuándo es.
"""
from __future__ import annotations

import datetime as dt

from comun import DATOS, ErrorValidacion, escribir_json, leer_catalogo
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
    icen = e.get("icen")
    if icen is not None and not -4 <= icen <= 6:
        raise ErrorValidacion(f"enfen.yaml: ICEN {icen} fuera de rango plausible")


def _indice_oisst(df, clave: str, nombre_caja: str) -> dict:
    ult = df[clave].dropna()
    if ult.empty:
        return {"valor": None, "fecha": None, "fuente": None}
    tramo = ult.iloc[-DIAS_MEDIA:]
    return {
        "valor": round(float(tramo.mean()), 2),
        "fecha": ult.index[-1].strftime("%Y-%m-%d"),
        "fuente": f"NOAA OISST, media de {DIAS_MEDIA} días en la región {nombre_caja}",
    }


def ejecutar(estado: dict) -> dict:
    e = leer_catalogo("enfen")
    _validar_enfen(e)
    cajas = leer_catalogo("cajas_nino")
    df = leer_csv()
    fecha_com = str(e.get("fecha") or "")

    salida = {
        "_": "Generado por pipeline/productos/estado.py desde catalogo/enfen.yaml y OISST. No editar a mano.",
        "alerta": {
            "estado": e["alerta"],
            "estados": ESTADOS_ALERTA,
            "fuente": f"ENFEN, Comunicado Oficial {e.get('comunicado', '')}".strip(),
            "fecha": fecha_com,
        },
        "indices": {
            "icen": {"valor": e.get("icen"), "fecha": e.get("icen_mes"),
                     "fuente": "ENFEN (Índice Costero El Niño)"},
            # RONI y ONI se conectan en el bloque 3 (archivos de texto del CPC)
            "roni": {"valor": None, "fecha": None, "fuente": "NOAA CPC (pendiente de conectar)"},
            "n12": _indice_oisst(df, "n12", cajas["n12"]["nombre"]) if not df.empty else {"valor": None},
            "n34": _indice_oisst(df, "n34", cajas["n34"]["nombre"]) if not df.empty else {"valor": None},
        },
        "probabilidades": {
            "periodo": e.get("probabilidades", {}).get("periodo"),
            "region": e.get("probabilidades", {}).get("region"),
            "fuente": f"ENFEN, Comunicado Oficial {e.get('comunicado', '')}".strip(),
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
