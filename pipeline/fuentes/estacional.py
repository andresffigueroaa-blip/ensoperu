"""
Fuente: pronóstico estacional ECMWF SEAS5 por región, 6 meses, media del
ensamble, vía Open-Meteo. Anomalía respecto de los pronósticos históricos del
propio modelo. Se promedian 3 puntos dentro de cada región.

Escribe sitio/datos/unidades/estacional.json:
  {meses: [...], valores: {id_region: {lluvia, anom, pct, t_anom: [por mes]}}}

Un modelo estacional dice si un mes tiende a ser más lluvioso o más seco, no
cuánto lloverá un día: vale a escala de región y la página lo dice. Cambia una
vez al mes; se consulta como máximo cada 5 días.
"""
from __future__ import annotations

import datetime as dt

import numpy as np
import requests

from comun import DATOS, ErrorFuente, ErrorValidacion, ahora_utc, escribir_json, log
from territorio import muestreo, unidades

URL = "https://seasonal-api.open-meteo.com/v1/seasonal"
SALIDA = DATOS / "unidades" / "estacional.json"
DIAS_MIN = 5


def ejecutar(estado: dict) -> dict:
    previo = estado.get("emitido")
    if previo and SALIDA.exists():
        edad = dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(previo.replace("Z", "+00:00"))
        if edad < dt.timedelta(days=DIAS_MIN):
            return {"estado": "sin_cambios", "emitido": previo}
    u, m = unidades(), muestreo()
    regiones = [i for i, x in u.items() if x["nivel"] == "region"]
    todos = [(i, p) for i in regiones for p in m[i][:3]]
    try:
        r = requests.get(URL, params={
            "latitude": ",".join(f"{p[1]:.3f}" for _, p in todos),
            "longitude": ",".join(f"{p[0]:.3f}" for _, p in todos),
            "monthly": "precipitation_mean,precipitation_anomaly,temperature_2m_anomaly",
            "models": "ecmwf_seas5_ensemble_mean"}, timeout=180)
        r.raise_for_status()
    except requests.RequestException as e:
        raise ErrorFuente(f"SEAS5 (Open-Meteo) no responde: {e}") from e
    datos = r.json()
    if len(datos) != len(todos):
        raise ErrorValidacion(f"SEAS5: {len(datos)} respuestas para {len(todos)} puntos")
    meses = [t[:7] for t in datos[0]["monthly"]["time"]]
    acum = {}
    for (i, _), d in zip(todos, datos):
        mo = d["monthly"]
        a = acum.setdefault(i, {"l": [], "a": [], "t": []})
        f = lambda k: [np.nan if v is None else v for v in mo[k]]
        a["l"].append(f("precipitation_mean")); a["a"].append(f("precipitation_anomaly")); a["t"].append(f("temperature_2m_anomaly"))
    valores = {}
    for i, a in acum.items():
        ll, an, t = (np.nanmean(np.array(a[k]), axis=0) for k in "lat")
        normal = ll - an
        # porcentaje solo donde la lluvia normal es apreciable (costa árida: sin %)
        pct = [None if n < 15 else round(float(x / n * 100)) for x, n in zip(an, normal)]
        valores[i] = {"lluvia": [round(float(x)) for x in ll], "anom": [round(float(x)) for x in an], "pct": pct,
                      "t_anom": [round(float(x), 1) for x in t]}
    if abs(np.nanmax([v for x in valores.values() for v in x["t_anom"]])) > 15:
        raise ErrorValidacion("SEAS5: anomalía de temperatura fuera de rango")
    emitido = ahora_utc()
    escribir_json(SALIDA, {"_": "Generado por pipeline/fuentes/estacional.py. ECMWF SEAS5, media del ensamble, por región.",
                           "fuente": "ECMWF SEAS5, vía Open-Meteo", "emitido": emitido, "meses": meses, "valores": valores}, compacto=True)
    log(f"  {len(valores)} regiones, {meses[0]} a {meses[-1]}")
    return {"estado": "ok", "ultimo_dato": meses[0], "emitido": emitido, "fuente": "ECMWF SEAS5 vía Open-Meteo"}
