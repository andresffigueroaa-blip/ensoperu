#!/usr/bin/env python3
"""
ENSO Perú · orquestador del pipeline.

Corre igual en una laptop y en GitHub Actions:

    python pipeline/run.py                         todo
    python pipeline/run.py --solo oisst,serie_tsm  algunos pasos
    python pipeline/run.py --solo oisst --historico 1981-2025
                                                   carga histórica (una vez)
    python pipeline/run.py --lista                 muestra los pasos

Reglas:
  - Cada paso es independiente. Si uno falla, los demás siguen y la página
    conserva el último dato bueno de ese paso.
  - Ningún paso escribe un dato que no pasó su validación.
  - El estado de cada paso queda en sitio/datos/_meta.json (la página lo
    muestra) y al final se imprime un resumen.
  - Si algún paso falló, el programa termina con código 1. En Actions eso
    marca la corrida en rojo y GitHub manda un correo.
"""
from __future__ import annotations

import argparse
import datetime as dt
import sys
import time
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from comun import (ErrorFuente, guardar_meta, leer_meta, log, registrar,  # noqa: E402
                   resumen_actions)
from fuentes import (cpc, enfen, estacional, firms, igp, internacional, noticias, oceano_atm, oisst,  # noqa: E402
                     oleaje, openmeteo, peru_oficial, rios, senamhi)
from herramientas import build_clima  # noqa: E402
from productos import (analisis_ia, catalogo, estado, mapa_tsm, panorama,  # noqa: E402
                       rios_monitoreo, serie_indices, serie_tsm)

# Orden de ejecución. Para agregar una fuente: escribir su módulo con una
# función ejecutar(estado_previo) -> dict y sumarla aquí.
# Primero las fuentes (descargan), después los productos (combinan).
PASOS = {
    "oisst":     oisst.ejecutar,        # NOAA OISST -> indices/oisst_diario.csv, tsm_costera_diaria.csv
    "cpc":       cpc.ejecutar,          # NOAA CPC   -> indices/cpc_mensual.csv (ONI, RONI)
    "igp":       igp.ejecutar,          # IGP        -> indices/icen.csv
    "oceano_atm": oceano_atm.ejecutar,  # SOI, OLR, vientos, calor, MEI, PDO y verificación contra el CPC
    "enfen":     enfen.ejecutar,        # ENFEN      -> enfen/comunicado.json (PDF oficial)
    "senamhi":   senamhi.ejecutar,      # SENAMHI    -> senamhi/avisos.json
    "firms":     firms.ejecutar,        # NASA FIRMS -> campos/incendios.geojson, unidades/incendios.json
    "openmeteo": openmeteo.ejecutar,    # Open-Meteo -> unidades/lluvia_16d.json
    "rios":      rios.ejecutar,         # GloFAS     -> rios/pronostico.json
    "estacional": estacional.ejecutar,  # SEAS5      -> unidades/estacional.json
    "oleaje":    oleaje.ejecutar,       # Marine     -> unidades/oleaje.json
    "clima":     build_clima.ejecutar,  # NASA POWER -> clima/<id>.json, unidades/spi.json (mensual)
    "noticias":  noticias.ejecutar,     # Google Noticias -> noticias.json
    "peru_oficial": peru_oficial.ejecutar,    # INDECI, CENEPRED, ANA, SUNASS, SERFOR, PCM -> peru/
    "internacional": internacional.ejecutar,  # CPC, JMA, IRI, C3S, NMME, MJO, CIIFEN, WMO -> pronosticos/
    "mapa_tsm":  mapa_tsm.ejecutar,     # campo OISST -> campos/tsm_anom.png
    "serie_tsm": serie_tsm.ejecutar,    # csv -> series/tsm.json (curva de portada)
    "serie_indices": serie_indices.ejecutar,  # icen + cpc -> series/indices.json (historia)
    "catalogo":  catalogo.ejecutar,     # catalogo/*.yaml + índices -> config, regiones, plantillas
    "estado":    estado.ejecutar,       # ENFEN + índices -> estado.json
    "rios_monitoreo": rios_monitoreo.ejecutar,  # ríos de la ANA + estaciones -> rios/monitoreo.json, historial
    "panorama":  panorama.ejecutar,     # todo lo anterior -> panorama.json, boletines/
    "ia":        analisis_ia.ejecutar,  # todo lo anterior -> analisis/<region>/<mes>.json
}


# El robot corre cada hora, pero no todo cambia cada hora: horas mínimas entre
# lecturas. Los modelos corren cada 6 h, y Open-Meteo limita a 10 000 consultas
# diarias (son 660 por lectura). Lo que no aparece aquí se lee en cada corrida.
HORAS_ENTRE_LECTURAS = {"cpc": 6, "igp": 6, "oceano_atm": 6, "rios": 6, "oleaje": 6, "estacional": 24, "internacional": 6}


def _toca(paso: str, previo: dict) -> bool:
    """¿Corresponde leer este paso ya? Tras una falla se reintenta siempre."""
    horas = HORAS_ENTRE_LECTURAS.get(paso)
    if not horas or previo.get("estado") == "fallo" or not previo.get("corrida"):
        return True
    ultima = dt.datetime.fromisoformat(previo["corrida"].replace("Z", "+00:00"))
    return (dt.datetime.now(dt.timezone.utc) - ultima).total_seconds() >= (horas - 0.25) * 3600


def _anios(texto: str) -> list[int]:
    if "-" in texto:
        a, b = texto.split("-")
        return list(range(int(a), int(b) + 1))
    return [int(x) for x in texto.split(",")]


def main() -> int:
    ap = argparse.ArgumentParser(description="Pipeline de datos de ENSO Perú")
    ap.add_argument("--solo", help="pasos separados por coma (por defecto, todos)")
    ap.add_argument("--historico", type=_anios,
                    help="años de OISST a (re)procesar, p. ej. 1981-2025 o 1997,1998")
    ap.add_argument("--conservar", action="store_true",
                    help="no borrar los NetCDF descargados de pipeline/cache/")
    ap.add_argument("--lista", action="store_true", help="mostrar los pasos y salir")
    args = ap.parse_args()

    if args.lista:
        for k, f in PASOS.items():
            print(f"  {k:10s} {sys.modules[f.__module__].__doc__.strip().splitlines()[0]}")
        return 0

    pasos = args.solo.split(",") if args.solo else list(PASOS)
    desconocidos = [p for p in pasos if p not in PASOS]
    if desconocidos:
        print(f"Pasos desconocidos: {desconocidos}. Disponibles: {list(PASOS)}")
        return 2

    meta = leer_meta()
    resultados = {}
    for paso in pasos:
        log(f"▶ {paso}")
        t0 = time.time()
        previo = meta["fuentes"].get(paso, {})
        if not args.solo and not _toca(paso, previo):
            log(f"  leído hace poco; toca más tarde")
            resultados[paso] = (previo.get("estado", "sin_cambios"), "")
            continue
        try:
            kwargs = {}
            if paso == "oisst":
                kwargs = {"anios": args.historico, "conservar": args.conservar}
            info = PASOS[paso](previo, **kwargs) or {}
            est = info.pop("estado", "ok")
            registrar(meta, paso, est, **info)
            resultados[paso] = (est, info.get("aviso") or "")
        except ErrorFuente as e:
            registrar(meta, paso, "fallo", error=str(e))
            resultados[paso] = ("fallo", str(e))
        except Exception as e:  # un error de programación tampoco tumba a los demás
            traceback.print_exc()
            registrar(meta, paso, "fallo", error=f"{type(e).__name__}: {e}")
            resultados[paso] = ("fallo", f"{type(e).__name__}: {e}")
        # Se guarda después de cada paso: si el proceso muere, lo hecho queda
        guardar_meta(meta)
        log(f"  {resultados[paso][0]} en {time.time() - t0:.1f} s")

    # ── Resumen ──────────────────────────────────────────────────────────
    print("\nResumen")
    filas = ["| Paso | Estado | Detalle |", "|---|---|---|"]
    for paso, (est, det) in resultados.items():
        marca = {"ok": "✔", "sin_cambios": "·", "fallo": "✘"}.get(est, "?")
        print(f"  {marca} {paso:10s} {est:12s} {det}")
        filas.append(f"| {paso} | {marca} {est} | {det.replace(chr(10), ' ')} |")
    resumen_actions("\n".join(filas))

    return 1 if any(est == "fallo" for est, _ in resultados.values()) else 0


if __name__ == "__main__":
    sys.exit(main())
