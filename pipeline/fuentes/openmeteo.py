"""
Fuente: lluvia pronosticada a 16 días, Open-Meteo (gratis, sin clave, uso no
comercial). https://api.open-meteo.com/v1/forecast

Para cada región y provincia se piden hasta 3 puntos dentro de su territorio
(geo/muestreo.json) y se promedian. También temperatura de los próximos 7 días
y la lluvia estimada de los últimos 7 y 30 días (modelo, no estaciones). Open-Meteo combina los mejores modelos
disponibles para cada lugar (ECMWF, GFS, ICON y otros).

Escribe sitio/datos/unidades/lluvia_16d.json:
  {id: {total, max_dia, dias_fuertes, serie:[16 valores diarios en mm]}}
con la fecha de emisión. "dias_fuertes" = días con más de 20 mm (el máximo entre los puntos; antes, promedio de
los puntos).

Es pronóstico de modelos, no del SENAMHI: la página lo dice, y para avisos
oficiales remite al SENAMHI.
"""
from __future__ import annotations

import time

import numpy as np
import requests

from comun import DATOS, ErrorFuente, ErrorValidacion, ahora_utc, escribir_json, log
from territorio import muestreo

URL = "https://api.open-meteo.com/v1/forecast"
SALIDA = DATOS / "unidades" / "lluvia_16d.json"
LOTE = 100                  # coordenadas por llamada
UMBRAL_FUERTE = 20.0        # mm/día
MAX_MM_DIA = 600.0          # control físico


def _pedir(puntos: list[list[float]], variables: str, **extra) -> list[dict]:
    params = {
        "latitude": ",".join(f"{p[1]:.3f}" for p in puntos),
        "longitude": ",".join(f"{p[0]:.3f}" for p in puntos),
        "daily": variables, "timezone": "America/Lima", **extra,
    }
    for intento in range(3):
        try:
            r = requests.get(URL, params=params, timeout=120)
            if r.status_code == 429:
                time.sleep(30 * (intento + 1))
                continue
            r.raise_for_status()
            d = r.json()
            return d if isinstance(d, list) else [d]
        except requests.RequestException as e:
            if intento == 2:
                raise ErrorFuente(f"Open-Meteo no responde: {e}") from e
            time.sleep(10)
    raise ErrorFuente("Open-Meteo: límite de uso alcanzado")


HORAS_MIN = 6               # no volver a pedir antes (cuida el límite gratuito)


def ejecutar(estado: dict) -> dict:
    import datetime as dt
    previo = estado.get("emitido")
    if previo and SALIDA.exists():
        edad = dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(previo.replace("Z", "+00:00"))
        if edad < dt.timedelta(hours=HORAS_MIN):
            log(f"  pronóstico de hace {edad.seconds // 3600} h; se conserva")
            return {"estado": "sin_cambios", "emitido": previo}
    m = muestreo()
    # Tres puntos por unidad para el pronóstico y uno para los últimos 30 días:
    # alcanza para el promedio y respeta el límite gratuito (10 000 usos al día)
    todos = [(uid, p) for uid, pts in m.items() for p in pts[:3]]
    respuestas = []
    for i in range(0, len(todos), LOTE):
        respuestas += _pedir([p for _, p in todos[i:i + LOTE]], "precipitation_sum,temperature_2m_max,temperature_2m_min", forecast_days=16)
        time.sleep(1)
    primeros = [(uid, pts[0]) for uid, pts in m.items()]
    pasado = []
    for i in range(0, len(primeros), LOTE):
        pasado += _pedir([p for _, p in primeros[i:i + LOTE]], "precipitation_sum", past_days=30, forecast_days=1)
        time.sleep(1)
    if len(respuestas) != len(todos):
        raise ErrorValidacion(f"Open-Meteo devolvió {len(respuestas)} puntos de {len(todos)}")

    series, tmax, tmin, fechas = {}, {}, {}, None
    for (uid, _), resp in zip(todos, respuestas):
        d = resp.get("daily", {})
        v = [np.nan if x is None else float(x) for x in d.get("precipitation_sum", [])]
        if fechas is None:
            fechas = d.get("time")
        if len(v) == 16:
            series.setdefault(uid, []).append(v)
            tmax.setdefault(uid, []).append([np.nan if x is None else float(x) for x in d["temperature_2m_max"][:7]])
            tmin.setdefault(uid, []).append([np.nan if x is None else float(x) for x in d["temperature_2m_min"][:7]])
    previa = {}
    for (uid, _), resp in zip(primeros, pasado):
        v = [0.0 if x is None else float(x) for x in resp.get("daily", {}).get("precipitation_sum", [])]
        if len(v) >= 30:
            previa[uid] = {"ult7": round(sum(v[-8:-1]), 1), "ult30": round(sum(v[-31:-1]), 1)}

    valores = {}
    for uid, lista in series.items():
        arr = np.array(lista)
        if np.isnan(arr).all():
            continue
        a = np.nanmean(arr, axis=0)
        if np.nanmax(a) > MAX_MM_DIA or np.nanmin(a) < 0:
            raise ErrorValidacion(f"Open-Meteo: lluvia fuera de rango en {uid}")
        # El punto con más días fuertes: promediar daba fracciones (0,3 días) y escondía el punto más lluvioso
        fuertes = np.nanmax([(np.array(s) > UMBRAL_FUERTE).sum() for s in lista])
        valores[uid] = {"total": round(float(np.nansum(a)), 1), "max_dia": round(float(np.nanmax(a)), 1),
                        "dias_fuertes": int(fuertes), "serie": [round(float(x), 1) for x in a],
                        "puntos": len(lista), "tmax7": round(float(np.nanmean(tmax[uid])), 1),
                        "tmin7": round(float(np.nanmean(tmin[uid])), 1), **previa.get(uid, {})}
    if len(valores) < 0.9 * len(m):
        raise ErrorValidacion(f"Open-Meteo: solo {len(valores)} de {len(m)} unidades con dato")

    escribir_json(SALIDA, {
        "_": "Generado por pipeline/fuentes/openmeteo.py. Lluvia pronosticada a 16 días por región y provincia.",
        "fuente": "Open-Meteo (combinación de modelos ECMWF, GFS, ICON y otros)",
        "emitido": ahora_utc(), "desde": fechas[0], "hasta": fechas[-1], "fechas": fechas,
        "umbral_fuerte_mm": UMBRAL_FUERTE, "valores": valores}, compacto=True)
    mayor = sorted(valores.items(), key=lambda kv: -kv[1]["total"])[:3]
    log(f"  {len(valores)} unidades; más lluvia: " + ", ".join(f"{k} {v['total']:.0f} mm" for k, v in mayor))
    return {"estado": "ok", "ultimo_dato": fechas[0], "unidades": len(valores), "emitido": ahora_utc(),
            "fuente": "Open-Meteo (modelos globales)"}
