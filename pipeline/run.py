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
import sys
import time
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from comun import (ErrorFuente, guardar_meta, leer_meta, log, registrar,  # noqa: E402
                   resumen_actions)
from fuentes import oisst  # noqa: E402
from productos import catalogo, estado, serie_tsm  # noqa: E402

# Orden de ejecución. Para agregar una fuente: escribir su módulo con una
# función ejecutar(estado_previo) -> dict y sumarla aquí.
PASOS = {
    "catalogo":  catalogo.ejecutar,     # catalogo/*.yaml -> config, regiones, plantillas
    "oisst":     oisst.ejecutar,        # NOAA OISST -> indices/oisst_diario.csv
    "serie_tsm": serie_tsm.ejecutar,    # csv -> series/tsm.json (curva de portada)
    "estado":    estado.ejecutar,       # ENFEN + OISST -> estado.json
}


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
