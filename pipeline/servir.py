#!/usr/bin/env python3
"""
Levanta la página en http://localhost:8000 para verla en local.

    python pipeline/servir.py            puerto 8000
    python pipeline/servir.py 8080       otro puerto

Sirve solo la carpeta sitio/, igual que GitHub Pages. Desactiva la caché
del navegador para que siempre se vea el último JSON que escribió el pipeline.
"""
import functools
import http.server
import sys
from pathlib import Path

SITIO = Path(__file__).resolve().parent.parent / "sitio"


class SinCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main():
    puerto = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    manejador = functools.partial(SinCache, directory=str(SITIO))
    with http.server.ThreadingHTTPServer(("127.0.0.1", puerto), manejador) as srv:
        print(f"ENSO Perú en http://localhost:{puerto}  (Ctrl+C para detener)")
        try:
            srv.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
