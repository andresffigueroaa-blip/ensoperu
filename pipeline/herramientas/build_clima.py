#!/usr/bin/env python3
"""
Clima histórico por región y provincia (NASA POWER, sin clave): normal mensual
1991-2020 de lluvia, temperatura, humedad, viento y humedad del suelo; lo que
pasó en años El Niño; y SPI-3 y SPI-6 (sequía).

    python pipeline/herramientas/build_clima.py           todo (~10 min)

También lo corre pipeline/run.py una vez al mes (paso clima). Escribe:
  sitio/datos/clima/<id>.json      una ficha por unidad (la página la pide al abrir)
  sitio/datos/unidades/spi.json    SPI más reciente y lluvia normal por unidad

POWER usa reanálisis MERRA-2 de ~50 km: sirve para comparar años y meses en un
mismo lugar, no como medición local; los datos de estaciones son del SENAMHI.
"""
from __future__ import annotations

import datetime as dt
import sys
import time
from pathlib import Path

import numpy as np
import requests
from scipy import stats

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from comun import DATOS, escribir_json, log  # noqa: E402
from territorio import muestreo, unidades  # noqa: E402

URL = "https://power.larc.nasa.gov/api/temporal/monthly/point"
PARAM = {"p": "PRECTOTCORR_SUM", "t": "T2M", "h": "RH2M", "v": "WS2M", "s": "GWETROOT"}
# Eventos: temporada de lluvias diciembre-abril del año indicado
EVENTOS = [("1982-83", 1983), ("1997-98", 1998), ("2015-16", 2016), ("2016-17", 2017), ("2023-24", 2024)]
DIR = DATOS / "clima"


def pedir(lon: float, lat: float, fin: int) -> dict:
    for intento in range(4):
        try:
            r = requests.get(URL, params={"parameters": ",".join(PARAM.values()), "community": "AG", "longitude": lon,
                                          "latitude": lat, "start": 1981, "end": fin, "format": "JSON"}, timeout=120)
            if r.status_code == 429:
                time.sleep(60)
                continue
            r.raise_for_status()
            return r.json()["properties"]["parameter"]
        except (requests.RequestException, KeyError, ValueError):
            time.sleep(15)
    raise RuntimeError(f"POWER no responde en {lon},{lat}")


def serie(par: dict) -> tuple[list[str], np.ndarray]:
    llaves = sorted(k for k in par if k[-2:] != "13")
    return llaves, np.array([np.nan if par[k] in (None, -999) or par[k] < -900 else float(par[k]) for k in llaves])


def spi(p: np.ndarray, meses: np.ndarray, k: int) -> np.ndarray:
    """SPI-k: lluvia acumulada k meses, ajustada a una gamma por mes calendario."""
    acum = np.convolve(np.nan_to_num(p, nan=np.nan), np.ones(k), "full")[:len(p)]
    acum[:k - 1] = np.nan
    acum[np.isnan(p)] = np.nan
    z = np.full(len(p), np.nan)
    for m in range(1, 13):
        idx = np.flatnonzero((meses == m) & np.isfinite(acum))
        x = acum[idx]
        if len(x) < 20:
            continue
        ceros = (x <= 0).mean()
        pos = x[x > 0]
        if len(pos) < 10 or pos.std() == 0:
            continue
        a, _, b = stats.gamma.fit(pos, floc=0)
        cdf = ceros + (1 - ceros) * stats.gamma.cdf(np.maximum(x, 0), a, 0, b)
        z[idx] = stats.norm.ppf(np.clip(cdf, 0.002, 0.998))
    return z


def ficha(u: dict, punto: list[float], fin: int) -> dict:
    par = pedir(punto[0], punto[1], fin)
    llaves, p = serie(par[PARAM["p"]])
    anios = np.array([int(k[:4]) for k in llaves])
    meses = np.array([int(k[4:6]) for k in llaves])
    base = (anios >= 1991) & (anios <= 2020)
    normal = {}
    for corto, nombre in PARAM.items():
        _, x = serie(par[nombre])
        normal[corto] = [round(float(np.nanmean(x[base & (meses == m)])), 2 if corto == "s" else 1) for m in range(1, 13)]
    # Temporada dic-abr: lluvia de cada evento y lo normal
    nmes = np.array(normal["p"])
    normal_temporada = float(nmes[[11, 0, 1, 2, 3]].sum())
    eventos = []
    for nom, a in EVENTOS:
        mask = ((anios == a - 1) & (meses == 12)) | ((anios == a) & (meses <= 4))
        tot = float(np.nansum(p[mask])) if mask.sum() == 5 and np.isfinite(p[mask]).all() else None
        eventos.append({"id": nom, "lluvia": None if tot is None else round(tot),
                        "pct": None if tot is None or normal_temporada < 15 else round(tot / normal_temporada * 100)})
    s3, s6 = spi(p, meses, 3), spi(p, meses, 6)
    u3 = np.flatnonzero(np.isfinite(s3))
    u_i = int(u3.max()) if len(u3) else None
    _, tt = serie(par[PARAM["t"]])
    n = 36
    return {
        "_": "NASA POWER (MERRA-2, ~50 km). Normal 1991-2020.",
        "id": u["id"], "nombre": u["nombre"], "punto": punto,
        "normal": normal, "normal_temporada": round(normal_temporada), "eventos": eventos,
        "reciente": {"meses": [k[:4] + "-" + k[4:6] for k in llaves[-n:]],
                     "lluvia": [None if np.isnan(v) else round(float(v)) for v in p[-n:]],
                     "t": [None if np.isnan(v) else round(float(v), 1) for v in tt[-n:]],
                     "spi3": [None if np.isnan(v) else round(float(v), 2) for v in s3[-n:]],
                     "spi6": [None if np.isnan(v) else round(float(v), 2) for v in s6[-n:]]},
        "_spi": None if u_i is None else {"mes": llaves[u_i][:4] + "-" + llaves[u_i][4:6], "spi3": round(float(s3[u_i]), 2),
                                          "spi6": None if np.isnan(s6[u_i]) else round(float(s6[u_i]), 2)},
    }


def ejecutar(estado: dict) -> dict:
    """Paso del pipeline: una vez al mes."""
    mes = dt.date.today().strftime("%Y-%m")
    if estado.get("mes") == mes and (DATOS / "unidades" / "spi.json").exists():
        return {"estado": "sin_cambios", "mes": mes}
    return construir() | {"mes": mes}


def construir() -> dict:
    u, m = unidades(), muestreo()
    fin = dt.date.today().year
    DIR.mkdir(parents=True, exist_ok=True)
    resumen, normales, fallas, ultimo = {}, {}, 0, None
    for i, puntos in m.items():
        try:
            f = ficha(u[i] | {"id": i}, puntos[0], fin)
        except RuntimeError as e:
            fallas += 1
            log(f"  {i}: {e}")
            continue
        s = f.pop("_spi")
        if s:
            resumen[i] = s
            ultimo = max(ultimo or "", s["mes"])
        normales[i] = f["normal"]["p"]
        escribir_json(DIR / f"{i}.json", f, compacto=True)
        time.sleep(0.2)
    if fallas > 0.2 * len(m):
        from comun import ErrorFuente
        raise ErrorFuente(f"NASA POWER falló en {fallas} de {len(m)} unidades")
    escribir_json(DATOS / "unidades" / "spi.json", {
        "_": "Generado por pipeline/herramientas/build_clima.py. SPI más reciente y lluvia normal mensual, por unidad.",
        "fuente": "Calculado de NASA POWER (MERRA-2)", "hasta": ultimo, "valores": resumen, "normal_lluvia": normales}, compacto=True)
    log(f"  {len(resumen)} unidades; SPI hasta {ultimo}; {fallas} fallas")
    return {"estado": "ok", "ultimo_dato": ultimo, "fuente": "NASA POWER"}


if __name__ == "__main__":
    print(construir())
