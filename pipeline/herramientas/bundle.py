#!/usr/bin/env python3
"""
Empaqueta el sitio en un único archivo HTML autocontenido.

Para qué sirve: poder mostrar la página sin levantar un servidor, mandarla por
correo o abrirla con doble click. El repositorio sigue siendo la fuente de
verdad; esto es solo una salida.

    python pipeline/herramientas/bundle.py        ->  dist/index.html

Cómo funciona: mete el CSS y el JS dentro del HTML y deja todos los JSON de
sitio/datos/ en window.__DATOS__. app.js lee primero de ahí (función traer),
así que no hace falta reemplazar código: si app.js cambia, esto sigue
funcionando.
"""
import json
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent.parent
SITIO = RAIZ / "sitio"


def leer(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def main():
    datos = {}
    for f in sorted((SITIO / "datos").rglob("*.json")):
        datos[f.relative_to(SITIO).as_posix()] = json.loads(leer(f))

    html = leer(SITIO / "index.html")
    css = leer(SITIO / "assets" / "styles.css")
    js = leer(SITIO / "assets" / "app.js")

    enlace_css = '<link rel="stylesheet" href="assets/styles.css">'
    enlace_js = '<script src="assets/app.js"></script>'
    for marca in (enlace_css, enlace_js):
        if marca not in html:
            sys.exit(f"bundle: no encontré {marca!r} en index.html; ¿cambió la cabecera?")

    # "</" dentro de un <script> cerraría la etiqueta antes de tiempo
    incrustado = json.dumps(datos, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    html = html.replace(enlace_css, f"<style>\n{css}\n</style>")
    html = html.replace(enlace_js, f"<script>window.__DATOS__ = {incrustado};</script>\n<script>\n{js}\n</script>")

    salida = RAIZ / "dist" / "index.html"
    salida.parent.mkdir(exist_ok=True)
    salida.write_text(html, encoding="utf-8")
    print(f"dist/index.html · {len(html) / 1024:.0f} KB · {len(datos)} archivos de datos incrustados")


if __name__ == "__main__":
    main()
