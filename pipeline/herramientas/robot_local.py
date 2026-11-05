#!/usr/bin/env python3
"""
Robot local: lee cada hora, desde el Perú, lo que GitHub no alcanza.

El SENAMHI y el ENFEN no responden a los servidores de GitHub Actions. Este
programa corre en una PC del equipo con una tarea programada de Windows (ver
instalar_robot_local.ps1): lee esas dos fuentes y sube el resultado; ese envío
hace que GitHub publique la página.

Trabaja en un clon propio (%LOCALAPPDATA%\\ensoperu-robot\\repo) y nunca toca la
carpeta donde se edita el código. Sube solo sitio/datos, y solo si algo cambió
o si pasaron 6 horas: así la portada sabe que la lectura sigue viva.

Si la PC está apagada no corre; al prender se pone al día. La portada avisa si
la lectura de avisos tiene más de 36 horas.

Uso:  pythonw pipeline/herramientas/robot_local.py
"""
from __future__ import annotations

import datetime as dt
import json
import os
import subprocess
import sys
from pathlib import Path

REPO_URL = "https://github.com/andresffigueroaa-blip/ensoperu.git"
BASE = Path(os.environ["LOCALAPPDATA"]) / "ensoperu-robot"
CLON = BASE / "repo"
LOG = BASE / "robot.log"
FUENTES = ["sitio/datos/senamhi/avisos.json", "sitio/datos/enfen/comunicado.json"]
HORAS_LATIDO = 6
SIN_VENTANA = 0x08000000 if os.name == "nt" else 0   # sin consola que parpadee cada hora


def log(texto: str) -> None:
    BASE.mkdir(parents=True, exist_ok=True)
    linea = f"{dt.datetime.now():%Y-%m-%d %H:%M} {texto}\n"
    with LOG.open("a", encoding="utf-8") as f:
        f.write(linea)
    # El registro no crece sin límite: se quedan las últimas 2000 líneas
    lineas = LOG.read_text(encoding="utf-8").splitlines(True)
    if len(lineas) > 2500:
        LOG.write_text("".join(lineas[-2000:]), encoding="utf-8")


def correr(*cmd, cwd=CLON, chequear=True, entorno=None) -> subprocess.CompletedProcess:
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace",
                       creationflags=SIN_VENTANA, env=entorno, timeout=1200)
    if chequear and r.returncode:
        raise RuntimeError(f"{' '.join(map(str, cmd[:4]))}: {(r.stderr or r.stdout)[-400:]}")
    return r


def huella() -> dict:
    """Contenido de las fuentes sin la hora de lectura: lo que de verdad cambió."""
    salida = {}
    for f in FUENTES:
        p = CLON / f
        if p.exists():
            d = json.loads(p.read_text(encoding="utf-8"))
            d.pop("leido", None)
            salida[f] = d
    return salida


def horas_desde_lectura() -> float:
    p = CLON / FUENTES[0]
    if not p.exists():
        return 1e9
    leido = json.loads(p.read_text(encoding="utf-8")).get("leido", "2000-01-01T00:00:00Z")
    return (dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(leido.replace("Z", "+00:00"))).total_seconds() / 3600


def main() -> int:
    BASE.mkdir(parents=True, exist_ok=True)
    if not (CLON / ".git").exists():
        correr("git", "clone", "--depth", "50", REPO_URL, str(CLON), cwd=BASE)
        correr("git", "config", "user.name", "ensoperu-robot-local")
        correr("git", "config", "user.email", "ensoperu-bot@users.noreply.github.com")
    # El clon es solo del robot: se alinea siempre con lo publicado
    correr("git", "fetch", "origin", "main")
    correr("git", "reset", "--hard", "origin/main")

    antes, horas = huella(), horas_desde_lectura()
    python = sys.executable.replace("pythonw.exe", "python.exe")
    entorno = {**os.environ, "PYTHONIOENCODING": "utf-8"}
    r = correr(python, "pipeline/run.py", "--solo", "senamhi,enfen", chequear=False, entorno=entorno)
    if huella() == antes and horas < HORAS_LATIDO:
        log(f"sin cambios (lectura de hace {horas:.1f} h)")
        return 0

    correr(python, "pipeline/run.py", "--solo", "estado,panorama", chequear=False, entorno=entorno)
    correr("git", "add", "sitio/datos")
    if not correr("git", "status", "--porcelain").stdout.strip():
        log("sin diferencias que subir")
        return 0
    correr("git", "commit", "-m", f"datos: avisos y comunicados desde el Perú {dt.date.today()}")
    for intento in range(3):      # el robot de GitHub puede haber subido algo en el intermedio
        correr("git", "pull", "--rebase", "-X", "theirs", "origin", "main")
        if not correr("git", "push", "origin", "HEAD:main", chequear=False).returncode:
            log(f"subido (código {r.returncode} de las fuentes)")
            return 0
    log("no se pudo subir tras 3 intentos")
    return 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        log(f"ERROR {type(e).__name__}: {e}")
        sys.exit(1)
