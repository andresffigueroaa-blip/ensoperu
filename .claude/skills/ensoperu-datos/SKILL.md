---
name: ensoperu-datos
description: Cómo agregar o cambiar una fuente de datos, un producto o una capa en el pipeline de ENSO Perú (pipeline/fuentes, pipeline/productos, catalogo/, sitio/datos/). Incluye el patrón de módulo, la validación, el registro en _meta.json, dónde guardar (GitHub o Cloudflare R2) y las fuentes gratuitas ya verificadas.
---

# Datos de ENSO Perú

## Patrón de una fuente o producto

```python
# pipeline/fuentes/<fuente>.py
"""Docstring: qué baja, de dónde (URL), qué escribe, cada cuánto."""
from comun import DATOS, ErrorFuente, ErrorValidacion, log

def ejecutar(estado: dict) -> dict:
    # 1. bajar (requests con timeout; red caída -> ErrorFuente)
    # 2. leer y VALIDAR (rango físico, cantidad, retraso -> ErrorValidacion)
    # 3. escribir solo si cambió (escribir_json / CSV con archivo temporal)
    return {"estado": "ok" | "sin_cambios", "ultimo_dato": "...", "fuente": "..."}
```

Y una línea en `PASOS` de `pipeline/run.py`: primero fuentes, después productos.

Reglas:
- Un fallo nunca escribe: el archivo anterior queda y `_meta.json` marca
  `fallo` con el error. La página lo muestra en "Estado de los datos".
- Un dato viejo es un fallo (cada fuente define su retraso máximo).
- Todo producto lleva `"_"` con quién lo genera y "No editar a mano".
- Parámetros que el equipo puede tocar van en `catalogo/*.yaml`, no en el código.
- Probar dos veces: la segunda corrida debe decir `sin_cambios`.

## Dónde se guarda

| Tamaño | Dónde |
|---|---|
| < 5 MB, cambia poco o es texto (CSV, JSON, GeoJSON simplificado, PNG diario) | `sitio/datos/` en GitHub |
| Pesado (NetCDF, COG, PMTiles, CHIRPS, histórico completo) | Cloudflare R2, bucket `ensoperu-datos` (secretos `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`) |
| Documentos del equipo | Google Drive |

## Fuentes gratuitas verificadas (oct 2026)

| Dato | URL | Notas |
|---|---|---|
| TSM diaria | downloads.psl.noaa.gov/Datasets/noaa.oisst.v2.highres/sst.day.anom.AAAA.nc | 1991-2020; OPeNDAP de PSL no responde, bajar el anual |
| ONI | cpc.ncep.noaa.gov/data/indices/oni.ascii.txt | texto |
| RONI | cpc.ncep.noaa.gov/products/analysis_monitoring/enso/roni/ | solo tabla HTML |
| ICEN | met.igp.gob.pe/datos/ICEN.txt | versión oficial ENFEN 2024 |
| Incendios | firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_South_America_7d.csv | sin clave, 7 días |
| Lluvia pronosticada 16 días | api.open-meteo.com/v1/forecast | sin clave, uso no comercial, varias coordenadas por llamada |
| Caudal GloFAS | flood-api.open-meteo.com/v1/flood | sin clave |
| Estacional | seasonal-api.open-meteo.com/v1/seasonal | sin clave |
| Límites | github.com/juaneladio/peru-geojson | departamentos, 197 provincias, 1834 distritos (no es la versión INEI vigente) |
| Presas, embalses, lagunas, glaciares | overpass-api.de (OpenStreetMap) | ODbL: citar "© colaboradores de OpenStreetMap" |
| Mapa base | tiles.openfreemap.org/styles/dark | sin clave |
| Relieve | s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png | sin clave |

**No usar:** GitHub Models (retirado el 30 jul 2026); OPeNDAP de PSL.

## Unidades e identificadores

- Región: nombre del departamento en título (`Madre De Dios`), slug `madre-de-dios`.
- Provincia: `IDPROV` de 4 dígitos (INEI). Distrito: `IDDIST` de 6 dígitos.
- Todo dato por unidad se publica con ese identificador, nunca solo por nombre.
