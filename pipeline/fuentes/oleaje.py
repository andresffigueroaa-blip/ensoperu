"""
Fuente: altura de ola pronosticada a 7 días frente al litoral, Open-Meteo Marine
(sin clave). Modelos globales de oleaje. Los Avisos Especiales de Oleaje
oficiales son de la Marina (DHN): https://www.dhn.mil.pe/portal/

Escribe sitio/datos/unidades/oleaje.json por región con litoral.
"""
from __future__ import annotations

import requests

from comun import DATOS, ErrorFuente, ahora_utc, escribir_json, log

URL = "https://marine-api.open-meteo.com/v1/marine"
SALIDA = DATOS / "unidades" / "oleaje.json"
# Puntos frente a la costa de cada región (código INEI): mar abierto, no bahía
PUNTOS = {"24": (-3.55, -80.75), "20": (-5.10, -81.45), "14": (-6.85, -80.15), "13": (-8.15, -79.25),
          "02": (-9.15, -78.80), "15": (-11.40, -77.85), "07": (-12.05, -77.35), "11": (-14.10, -76.45),
          "04": (-16.55, -72.95), "18": (-17.75, -71.50), "23": (-18.15, -70.95)}


def ejecutar(estado: dict) -> dict:
    ids = list(PUNTOS)
    try:
        r = requests.get(URL, params={"latitude": ",".join(str(PUNTOS[i][0]) for i in ids),
                                      "longitude": ",".join(str(PUNTOS[i][1]) for i in ids),
                                      "daily": "wave_height_max,wave_period_max", "forecast_days": 7, "timezone": "America/Lima"}, timeout=90)
        r.raise_for_status()
    except requests.RequestException as e:
        raise ErrorFuente(f"Open-Meteo Marine no responde: {e}") from e
    datos = r.json()
    valores = {}
    for i, d in zip(ids, datos):
        h = [x for x in d["daily"]["wave_height_max"] if x is not None]
        if h:
            valores[i] = {"max": max(h), "serie": d["daily"]["wave_height_max"], "periodo": max(x for x in d["daily"]["wave_period_max"] if x is not None)}
    if not valores:
        raise ErrorFuente("Open-Meteo Marine sin datos")
    escribir_json(SALIDA, {"_": "Generado por pipeline/fuentes/oleaje.py. Avisos oficiales: Marina de Guerra (DHN).",
                           "fuente": "Open-Meteo Marine (modelos globales)", "emitido": ahora_utc(),
                           "fechas": datos[0]["daily"]["time"], "valores": valores}, compacto=True)
    log(f"  {len(valores)} regiones; ola máxima {max(v['max'] for v in valores.values())} m")
    return {"estado": "ok", "ultimo_dato": datos[0]["daily"]["time"][0], "fuente": "Open-Meteo Marine"}
