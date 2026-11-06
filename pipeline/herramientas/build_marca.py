#!/usr/bin/env python3
"""
Marca de ENSO Perú: el punto térmico.

Un núcleo cálido rodeado por un anillo que recorre la escala de anomalías de
temperatura del mar del propio sitio (de azul frío a rojo cálido, en el sentido
de las agujas del reloj desde arriba): el calentamiento que es El Niño. En 16 px
el degradado se vuelve barro, así que ahí va la versión simple: anillo frío y
núcleo cálido, como el punto original de la cabecera.

Se corre a mano cuando cambie el diseño:
    python pipeline/herramientas/build_marca.py

Escribe en sitio/assets/marca/: marca.svg (cabecera y pestaña en navegadores
modernos), favicon-16.png, favicon-32.png, favicon.ico, apple-touch-icon.png,
icono-192.png, icono-512.png e icono-mascara-512.png (zona segura para Android).
"""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw

DESTINO = Path(__file__).resolve().parents[2] / "sitio" / "assets" / "marca"
ESCALA = ["#163D66", "#1B6A87", "#79A8B4", "#DEE2DC", "#F0C178", "#E18C3E", "#D9452C", "#8E0F16"]
NUCLEO, HUECO, FRIO, FONDO = "#D9452C", "#F4F1EC", "#1B6A87", "#16222A"


def rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def color_en(t: float):
    """Color de la escala en t (0 a 1), interpolado."""
    x = t * (len(ESCALA) - 1)
    i = min(int(x), len(ESCALA) - 2)
    a, b, f = rgb(ESCALA[i]), rgb(ESCALA[i + 1]), x - i
    return tuple(round(a[k] + (b[k] - a[k]) * f) for k in range(3))


def dibujar(tam: int, simple: bool = False, fondo: str | None = None, margen: float = 0.0) -> Image.Image:
    """Marca a tam px, dibujada a 8x y reducida: bordes suaves."""
    S = tam * 8
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0) if fondo is None else rgb(fondo) + (255,))
    d = ImageDraw.Draw(im)
    c = S / 2
    r = S / 2 * (1 - margen) - S * 0.01
    caja = lambda radio: [c - radio, c - radio, c + radio, c + radio]
    if simple:
        d.ellipse(caja(r), fill=rgb(FRIO))
    else:
        # Anillo: 360 cuñas de la escala, desde arriba en sentido horario
        for g in range(360):
            d.pieslice(caja(r), g - 90, g - 89 + 1.2, fill=color_en(g / 359))
    d.ellipse(caja(r * (0.62 if simple else 0.66)), fill=rgb(HUECO))
    d.ellipse(caja(r * (0.40 if simple else 0.42)), fill=rgb(NUCLEO))
    return im.resize((tam, tam), Image.LANCZOS)


def svg() -> str:
    """El mismo dibujo en SVG: 48 arcos de la escala, hueco y núcleo."""
    n, r_ext, r_int = 48, 31.5, 21
    arcos = []
    for i in range(n):
        a0, a1 = (i / n) * 2 * math.pi - math.pi / 2, ((i + 1.05) / n) * 2 * math.pi - math.pi / 2
        p = lambda rad, a: f"{32 + rad * math.cos(a):.2f} {32 + rad * math.sin(a):.2f}"
        col = "#%02X%02X%02X" % color_en(i / (n - 1))
        arcos.append(f'<path d="M{p(r_ext, a0)}A{r_ext} {r_ext} 0 0 1 {p(r_ext, a1)}L{p(r_int, a1)}A{r_int} {r_int} 0 0 0 {p(r_int, a0)}Z" fill="{col}"/>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="ENSO Perú">'
            f'<title>ENSO Perú</title>{"".join(arcos)}'
            f'<circle cx="32" cy="32" r="21" fill="{HUECO}"/><circle cx="32" cy="32" r="13.4" fill="{NUCLEO}"/></svg>')


def main():
    DESTINO.mkdir(parents=True, exist_ok=True)
    (DESTINO / "marca.svg").write_text(svg(), encoding="utf-8")
    dibujar(16, simple=True).save(DESTINO / "favicon-16.png")
    dibujar(32).save(DESTINO / "favicon-32.png")
    dibujar(48).save(DESTINO / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    dibujar(180, fondo=FONDO, margen=0.16).save(DESTINO / "apple-touch-icon.png")
    dibujar(192, fondo=FONDO, margen=0.10).save(DESTINO / "icono-192.png")
    dibujar(512, fondo=FONDO, margen=0.10).save(DESTINO / "icono-512.png")
    dibujar(512, fondo=FONDO, margen=0.24).save(DESTINO / "icono-mascara-512.png")
    print("marca en", DESTINO, sorted(p.name for p in DESTINO.iterdir()))


if __name__ == "__main__":
    main()
