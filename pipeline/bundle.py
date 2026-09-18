#!/usr/bin/env python3
"""
Empaqueta el sitio en un único archivo HTML autocontenido.

Para qué sirve: poder mostrar la página sin levantar un servidor, mandarla por
correo, o publicarla en un sitio que no admita varios archivos. El repositorio
sigue siendo la fuente de verdad; esto es solo una salida.

    python3 pipeline/bundle.py        ->  dist/index.html

Cómo funciona: mete el CSS y el JS dentro del HTML, y reemplaza las llamadas a
fetch() por los JSON ya incrustados, de modo que la página no necesite red ni
servidor local.
"""
import json, os, re, base64

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def leer(*p):
    return open(os.path.join(RAIZ, *p), encoding="utf-8").read()

# Todos los JSON que la aplicación pide con fetch al arrancar
ARCHIVOS = [
    "data/estado.json",
    "data/config.json",
    "data/regiones.json",
    "data/geo/departamentos.json",
    "data/series/sst.json",
    "data/analisis/_plantillas.json",
]

# Los análisis por región se descubren recorriendo la carpeta
for carpeta, _, ficheros in os.walk(os.path.join(RAIZ, "data/analisis")):
    for f in ficheros:
        rel = os.path.relpath(os.path.join(carpeta, f), RAIZ).replace(os.sep, "/")
        if rel.endswith(".json") and rel not in ARCHIVOS:
            ARCHIVOS.append(rel)

incrustados = {r: json.loads(leer(r)) for r in ARCHIVOS}

html = leer("index.html")
css  = leer("assets/styles.css")
js   = leer("assets/app.js")

# fetch() pasa a leer del objeto incrustado
js = js.replace(
    'async function traer(ruta){\n  const r = await fetch(ruta);\n'
    '  if (!r.ok) throw new Error(`No se pudo leer ${ruta} (${r.status})`);\n'
    '  return r.json();\n}',
    'const INCRUSTADO = __DATOS__;\n'
    'async function traer(ruta){\n'
    '  if (ruta in INCRUSTADO) return INCRUSTADO[ruta];\n'
    '  throw new Error(`No se pudo leer ${ruta}`);\n}'
)
js = js.replace(
    '    const r = await fetch(`data/analisis/${k}.json`);\n'
    '    cacheAnalisis[k] = r.ok ? await r.json() : null;',
    '    cacheAnalisis[k] = INCRUSTADO[`data/analisis/${k}.json`] ?? null;'
)
js = js.replace("__DATOS__", json.dumps(incrustados, ensure_ascii=False, separators=(",", ":")))

html = html.replace('<link rel="stylesheet" href="assets/styles.css">',
                    "<style>\n" + css + "\n</style>")
html = html.replace('<script src="assets/app.js"></script>',
                    "<script>\n" + js + "\n</script>")

os.makedirs(os.path.join(RAIZ, "dist"), exist_ok=True)
salida = os.path.join(RAIZ, "dist", "index.html")
open(salida, "w", encoding="utf-8").write(html)
print(f"dist/index.html · {len(html)/1024:.0f} KB · {len(ARCHIVOS)} archivos de datos incrustados")
