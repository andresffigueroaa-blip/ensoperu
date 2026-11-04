"""
Fuente: caudal pronosticado a 30 días en los ríos de catalogo/rios.yaml
(GloFAS, Copernicus, vía Open-Meteo, sin clave). Compara con su historia
1984-2023 (sitio/datos/rios/referencia.json) y publica un nivel:

  normal      el máximo pronosticado en 15 días no pasa el percentil 90 histórico
  elevado     pasa el percentil 90
  muy alto    pasa el percentil 99

Escribe sitio/datos/rios/pronostico.json. Es un modelo global: orienta, no mide.
Los caudales oficiales son del SENAMHI y de la ANA.
"""
from __future__ import annotations

import requests

from comun import DATOS, ErrorFuente, ErrorValidacion, ahora_utc, escribir_json, leer_catalogo, leer_json, log

URL = "https://flood-api.open-meteo.com/v1/flood"
SALIDA = DATOS / "rios" / "pronostico.json"
REF = DATOS / "rios" / "referencia.json"


def ejecutar(estado: dict) -> dict:
    ref = (leer_json(REF) or {}).get("rios")
    if not ref:
        raise ErrorFuente("falta rios/referencia.json; correr herramientas/build_rios.py")
    rios = [r for r in leer_catalogo("rios") if r["id"] in ref]
    try:
        r = requests.get(URL, params={
            "latitude": ",".join(str(ref[x["id"]]["lat"]) for x in rios),
            "longitude": ",".join(str(ref[x["id"]]["lon"]) for x in rios),
            "daily": "river_discharge,river_discharge_max", "past_days": 15, "forecast_days": 30}, timeout=120)
        r.raise_for_status()
    except requests.RequestException as e:
        raise ErrorFuente(f"GloFAS (Open-Meteo) no responde: {e}") from e
    datos = r.json()
    if len(datos) != len(rios):
        raise ErrorValidacion(f"GloFAS: {len(datos)} respuestas para {len(rios)} ríos")

    salida, conteo = [], {"normal": 0, "elevado": 0, "muy alto": 0}
    for rio, d in zip(rios, datos):
        q = d["daily"]["river_discharge"]
        fechas = d["daily"]["time"]
        hoy_i = 15                 # los primeros 15 días son pasado
        futuro = [v for v in q[hoy_i:hoy_i + 15] if v is not None]
        if not futuro:
            continue
        rf = ref[rio["id"]]
        pico = max(futuro)
        fecha_pico = fechas[hoy_i + q[hoy_i:hoy_i + 15].index(pico)]
        nivel = "muy alto" if pico >= rf["p99"] else "elevado" if pico >= rf["p90"] else "normal"
        conteo[nivel] += 1
        mes = int(fechas[hoy_i][5:7]) - 1
        salida.append({"id": rio["id"], "nombre": rio["nombre"], "lugar": rio["lugar"], "region": rio["region"],
                       "lat": rf["lat"], "lon": rf["lon"], "hoy": q[hoy_i], "pico": pico, "fecha_pico": fecha_pico,
                       "normal_mes": rf["normal_mes"][mes], "p90": rf["p90"], "p99": rf["p99"], "maximo": rf["maximo"],
                       "nivel": nivel, "serie": q, "maxens": d["daily"]["river_discharge_max"]})
    if len(salida) < 0.7 * len(rios):
        raise ErrorValidacion(f"GloFAS: solo {len(salida)} de {len(rios)} ríos con dato")
    escribir_json(SALIDA, {"_": "Generado por pipeline/fuentes/rios.py. Caudal pronosticado frente a su historia 1984-2023.",
                           "fuente": "GloFAS (Copernicus), vía Open-Meteo", "emitido": ahora_utc(),
                           "fechas": datos[0]["daily"]["time"], "dias_pasado": 15, "rios": salida}, compacto=True)
    altos = [x["nombre"] for x in salida if x["nivel"] != "normal"]
    log(f"  {len(salida)} ríos; {conteo}; {', '.join(altos[:8])}")
    return {"estado": "ok", "ultimo_dato": datos[0]["daily"]["time"][15], "niveles": conteo, "fuente": "GloFAS vía Open-Meteo"}
