"""
Utilidades compartidas por todo el pipeline: rutas, lectura del catálogo,
escritura segura de JSON y registro del estado de cada fuente.

Ninguna ruta se escribe a mano en los demás módulos: todas salen de aquí.
"""
from __future__ import annotations

import datetime as dt
import json
import math
import os
import sys
from pathlib import Path

import yaml

# ── Rutas del proyecto ────────────────────────────────────────────────────
RAIZ     = Path(__file__).resolve().parent.parent
CATALOGO = RAIZ / "catalogo"                 # lo editan personas
SITIO    = RAIZ / "sitio"                    # lo único que se publica
DATOS    = SITIO / "datos"                   # lo escribe solo el pipeline
CACHE    = RAIZ / "pipeline" / "cache"       # descargas; no va a git
META     = DATOS / "_meta.json"


class ErrorFuente(Exception):
    """Falla esperable de una fuente (sin red, formato cambiado, dato viejo).
    El orquestador la registra y sigue con las demás fuentes."""


class ErrorValidacion(ErrorFuente):
    """El dato se obtuvo pero no pasa los controles: no se publica."""


# ── Tiempo ────────────────────────────────────────────────────────────────
def ahora_utc() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def hoy() -> dt.date:
    return dt.datetime.now(dt.timezone.utc).date()


# ── Registro en pantalla ──────────────────────────────────────────────────
def log(msg: str) -> None:
    hora = dt.datetime.now().strftime("%H:%M:%S")
    print(f"[{hora}] {msg}", flush=True)


# ── Catálogo ──────────────────────────────────────────────────────────────
def leer_catalogo(nombre: str):
    """Lee catalogo/<nombre>.yaml."""
    ruta = CATALOGO / f"{nombre}.yaml"
    try:
        with open(ruta, encoding="utf-8") as f:
            return yaml.safe_load(f)
    except yaml.YAMLError as e:
        # El mensaje de PyYAML trae línea y columna: es lo que necesita
        # quien editó el archivo a mano.
        raise ErrorValidacion(f"{ruta.name} tiene un error de formato: {e}") from e


# ── JSON ──────────────────────────────────────────────────────────────────
def _limpiar(x):
    """NaN e infinito no son JSON válido: pasan a null."""
    if isinstance(x, float) and not math.isfinite(x):
        return None
    if isinstance(x, dict):
        return {k: _limpiar(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_limpiar(v) for v in x]
    if isinstance(x, (dt.date, dt.datetime)):
        return x.isoformat()
    return x


def escribir_json(ruta: Path, obj, compacto: bool = False) -> None:
    """Escribe de forma atómica: primero a un temporal y luego lo renombra.
    Si el proceso se corta a mitad, el archivo anterior queda intacto."""
    ruta.parent.mkdir(parents=True, exist_ok=True)
    tmp = ruta.with_suffix(ruta.suffix + ".tmp")
    texto = json.dumps(_limpiar(obj), ensure_ascii=False,
                       indent=None if compacto else 2,
                       separators=(",", ":") if compacto else None,
                       allow_nan=False)
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write(texto + "\n")
    os.replace(tmp, ruta)


def leer_json(ruta: Path, defecto=None):
    if not ruta.exists():
        return defecto
    with open(ruta, encoding="utf-8") as f:
        return json.load(f)


# ── Estado de cada fuente (sitio/datos/_meta.json) ────────────────────────
# La página lee este archivo para mostrar cuándo se actualizó cada dato y
# si la última corrida falló. Así un dato viejo nunca pasa por nuevo.
def leer_meta() -> dict:
    return leer_json(META, {"fuentes": {}})


def registrar(meta: dict, paso: str, estado: str, **campos) -> None:
    """estado: 'ok' | 'fallo' | 'sin_cambios'.
    En un fallo se conservan 'actualizado' y 'ultimo_dato' de la corrida
    buena anterior: eso es lo que la página sigue mostrando."""
    previo = meta["fuentes"].get(paso, {})
    nuevo = dict(previo)
    nuevo["estado"] = estado
    nuevo["corrida"] = ahora_utc()
    if estado in ("ok", "sin_cambios"):
        nuevo["actualizado"] = campos.pop("actualizado", ahora_utc())
        nuevo.pop("error", None)
    nuevo.update(campos)
    meta["fuentes"][paso] = nuevo


def guardar_meta(meta: dict) -> None:
    meta["generado"] = ahora_utc()
    escribir_json(META, meta)


def en_actions() -> bool:
    return os.environ.get("GITHUB_ACTIONS") == "true"


def resumen_actions(texto: str) -> None:
    """Agrega texto al resumen visible de la corrida en GitHub Actions."""
    ruta = os.environ.get("GITHUB_STEP_SUMMARY")
    if ruta:
        with open(ruta, "a", encoding="utf-8") as f:
            f.write(texto + "\n")


# En Windows la consola a veces no es UTF-8 y los print con tildes fallan.
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
