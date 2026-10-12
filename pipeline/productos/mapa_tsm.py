"""
Producto: campo de anomalía de TSM del último día, como imagen para el mapa.

Lee pipeline/cache/oisst/campo_ultimo.nc (lo deja fuentes/oisst.py) y escribe
  sitio/datos/campos/tsm_anom.png    imagen en proyección Mercator, tierra transparente
  sitio/datos/campos/tsm_anom.json   dónde va la imagen (unidades SVG del mapa) y de cuándo es

La imagen se dibuja con la misma proyección que pipeline/herramientas/build_geo.py
y la misma escala de colores que assets/app.js (PARADAS), así encaja debajo de
los departamentos sin ninguna transformación en el navegador.

Si no hay campo nuevo (NOAA no cambió nada), se deja la imagen anterior.
"""
from __future__ import annotations

import math

import numpy as np
import xarray as xr

from comun import DATOS, escribir_json, leer_catalogo, log
from fuentes.oisst import CAMPO

DIR = DATOS / "campos"
PNG = DIR / "tsm_anom.png"
META = DIR / "tsm_anom.json"

# Proyección idéntica a build_geo.py y app.js
SCALE = 22.0
LON0, LAT0 = -176.0, 14.0
ANCHO_PX = 1600

# Escala de anomalías de app.js: posición (0 a 1) y color RGB
PARADAS = [
    (0.00, (22, 61, 102)), (0.18, (27, 106, 135)), (0.36, (121, 168, 180)),
    (0.50, (222, 226, 220)), (0.62, (240, 193, 120)), (0.76, (225, 140, 62)),
    (0.88, (217, 69, 44)), (1.00, (142, 15, 22)),
]


def merc_y(lat):
    lat = np.clip(lat, -84, 84)
    return np.degrees(np.log(np.tan(np.pi / 4 + np.radians(lat) / 2)))


Y0 = float(merc_y(LAT0))


def px(lon):
    return (lon - LON0) * SCALE


def py(lat):
    return (Y0 - merc_y(lat)) * SCALE


def _colormap():
    from matplotlib.colors import LinearSegmentedColormap
    cmap = LinearSegmentedColormap.from_list(
        "anomalias", [(p, tuple(c / 255 for c in rgb)) for p, rgb in PARADAS])
    cmap.set_bad(alpha=0)          # tierra y sin dato: transparente
    return cmap


def ejecutar(estado: dict) -> dict:
    if not CAMPO.exists():
        log("  sin campo nuevo en caché; se conserva la imagen anterior")
        return {"estado": "sin_cambios"}

    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    with xr.open_dataarray(CAMPO) as da:
        campo = da.load()
    fecha = campo.attrs.get("fecha", "")
    if estado.get("ultimo_dato") == fecha and PNG.exists():
        return {"estado": "sin_cambios", "ultimo_dato": fecha}

    capa = leer_catalogo("capas")["tsm"]
    lo, hi = capa["min"], capa["max"]

    # Bordes de celda (la grilla es de 0,25° centrada en la coordenada)
    lon = campo["lon"].to_numpy() - 360                       # a longitud continua (-210..-65)
    lat = campo["lat"].to_numpy()
    dl = float(np.diff(lon).mean())
    xb = px(np.concatenate([lon - dl / 2, [lon[-1] + dl / 2]]))
    yb = py(np.concatenate([lat - dl / 2, [lat[-1] + dl / 2]]))
    x0, x1, y0, y1 = xb.min(), xb.max(), yb.min(), yb.max()

    datos = np.ma.masked_invalid(campo.to_numpy())
    alto_px = int(round(ANCHO_PX * (y1 - y0) / (x1 - x0)))
    dpi = 100
    fig = plt.figure(figsize=(ANCHO_PX / dpi, alto_px / dpi), dpi=dpi)
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_axis_off()
    ax.pcolormesh(xb, yb, datos, cmap=_colormap(), vmin=lo, vmax=hi, shading="flat", rasterized=True)
    ax.set_xlim(x0, x1)
    ax.set_ylim(y1, y0)                                       # el eje y del SVG crece hacia abajo
    DIR.mkdir(parents=True, exist_ok=True)
    tmp = PNG.with_suffix(".tmp.png")
    fig.savefig(tmp, dpi=dpi, transparent=True)
    plt.close(fig)
    tmp.replace(PNG)

    escribir_json(META, {
        "_": "Generado por pipeline/productos/mapa_tsm.py. Posición en unidades SVG del mapa.",
        "archivo": "tsm_anom.png",
        "fecha": fecha,
        "fuente": campo.attrs.get("fuente", ""),
        "x": round(float(x0), 1), "y": round(float(y0), 1),
        "w": round(float(x1 - x0), 1), "h": round(float(y1 - y0), 1),
        "min": lo, "max": hi, "unidad": "°C",
    })
    kb = PNG.stat().st_size / 1024
    log(f"  campo del {fecha}: {datos.count()} celdas marinas, {kb:.0f} KB")
    return {"estado": "ok", "ultimo_dato": fecha}
