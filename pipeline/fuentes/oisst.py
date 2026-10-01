"""
Fuente: NOAA OISST v2.1 High Resolution, anomalía diaria de TSM.

Mismo producto que usa el notebook CODIGO_MONITOREO_ENSO_2026:
    https://downloads.psl.noaa.gov/Datasets/noaa.oisst.v2.highres/sst.day.anom.<AÑO>.nc
Grilla de 0,25°, desde septiembre de 1981, anomalía respecto de la
climatología 1991-2020 (la versión de PSL; la de NCEI usa 1971-2000, por
eso no se mezclan).

Qué hace:
  1. Pregunta a NOAA la fecha de modificación de los archivos del año en
     curso y del anterior (NOAA reemplaza los datos preliminares por los
     definitivos unas dos semanas después).
  2. Descarga solo los que cambiaron desde la última corrida.
  3. Promedia la anomalía en cada caja Niño (catalogo/cajas_nino.yaml),
     ponderando por el coseno de la latitud.
  4. Actualiza sitio/datos/indices/oisst_diario.csv, la serie histórica
     completa (una fila por día). Ese CSV es a la vez el producto publicado
     y la caché: no hace falta volver a descargar años viejos.

Uso aislado:
    python pipeline/run.py --solo oisst
    python pipeline/run.py --solo oisst --historico 1981-2025   (una sola vez)
"""
from __future__ import annotations

import time

import numpy as np
import pandas as pd
import requests
import xarray as xr

from comun import CACHE, DATOS, ErrorFuente, ErrorValidacion, hoy, leer_catalogo, log

URL = "https://downloads.psl.noaa.gov/Datasets/noaa.oisst.v2.highres/sst.day.anom.{anio}.nc"
CSV = DATOS / "indices" / "oisst_diario.csv"
DIR_NC = CACHE / "oisst"

PRIMER_ANIO = 1981
DIAS_MAX_RETRASO = 7          # si el último dato es más viejo, algo anda mal
RANGO_FISICO = (-8.0, 10.0)   # °C; una media de caja fuera de esto es un error


# ── Red ───────────────────────────────────────────────────────────────────
def _modificado(anio: int) -> tuple[str, int]:
    """Fecha de modificación y tamaño del archivo anual en NOAA."""
    try:
        r = requests.head(URL.format(anio=anio), timeout=60, allow_redirects=True)
    except requests.RequestException as e:
        raise ErrorFuente(f"NOAA PSL no responde: {e}") from e
    if r.status_code == 404:
        # Solo es normal que no exista el archivo del año en curso durante
        # los primeros días de enero. En otro caso NOAA cambió algo: es falla.
        if anio == hoy().year and hoy().timetuple().tm_yday <= 15:
            return "", 0
        raise ErrorFuente(f"NOAA PSL no tiene el archivo de {anio} (404); ¿cambió la ruta?")
    if r.status_code != 200:
        raise ErrorFuente(f"NOAA PSL respondió {r.status_code} para {anio}")
    return r.headers.get("Last-Modified", ""), int(r.headers.get("Content-Length", 0))


def _descargar(anio: int, tamanio: int) -> "Path":
    destino = DIR_NC / f"sst.day.anom.{anio}.nc"
    if destino.exists() and destino.stat().st_size == tamanio:
        log(f"  {anio}: ya estaba descargado")
        return destino
    DIR_NC.mkdir(parents=True, exist_ok=True)
    tmp = destino.with_suffix(".parcial")
    for intento in range(1, 4):
        try:
            t0 = time.time()
            with requests.get(URL.format(anio=anio), stream=True, timeout=(30, 300)) as r:
                r.raise_for_status()
                with open(tmp, "wb") as f:
                    for trozo in r.iter_content(chunk_size=1 << 20):
                        f.write(trozo)
            if tmp.stat().st_size != tamanio:
                raise ErrorFuente(f"descarga incompleta de {anio}")
            tmp.replace(destino)
            mb = tamanio / 2**20
            log(f"  {anio}: {mb:.0f} MB en {time.time() - t0:.0f} s")
            return destino
        except (requests.RequestException, ErrorFuente) as e:
            log(f"  {anio}: intento {intento} falló ({e})")
            time.sleep(10 * intento)
    raise ErrorFuente(f"no se pudo descargar OISST {anio}")


# ── Cálculo ───────────────────────────────────────────────────────────────
def _promedios_caja(ruta_nc, cajas: dict) -> pd.DataFrame:
    """Serie diaria del promedio de anomalía en cada caja Niño."""
    with xr.open_dataset(ruta_nc) as ds:
        anom = ds["anom"]
        cols = {}
        for clave, c in cajas.items():
            sub = anom.sel(lat=slice(*c["lat"]), lon=slice(*c["lon"]))
            peso = np.cos(np.deg2rad(sub["lat"]))
            cols[clave] = sub.weighted(peso).mean(("lat", "lon"), skipna=True).load().to_series()
    df = pd.DataFrame(cols)
    df.index = pd.to_datetime(df.index).normalize()
    df.index.name = "fecha"
    return df


def _validar(df: pd.DataFrame, anio: int) -> None:
    lo, hi = RANGO_FISICO
    malos = (df < lo) | (df > hi)
    if malos.to_numpy().any():
        ejemplo = df.to_numpy()[malos.to_numpy()][0]
        raise ErrorValidacion(f"OISST {anio}: {int(malos.to_numpy().sum())} valores fuera de rango físico, p. ej. {ejemplo:.2f}")
    if df.isna().all(axis=1).any():
        raise ErrorValidacion(f"OISST {anio}: hay días sin ningún dato")
    if df.index.has_duplicates or not df.index.is_monotonic_increasing:
        raise ErrorValidacion(f"OISST {anio}: fechas repetidas o desordenadas")


def leer_csv() -> pd.DataFrame:
    if not CSV.exists():
        return pd.DataFrame()
    return pd.read_csv(CSV, index_col="fecha", parse_dates=["fecha"])


def _guardar_csv(df: pd.DataFrame) -> None:
    CSV.parent.mkdir(parents=True, exist_ok=True)
    tmp = CSV.with_suffix(".tmp")
    df.sort_index().to_csv(tmp, float_format="%.3f", date_format="%Y-%m-%d", lineterminator="\n")
    tmp.replace(CSV)


# ── Paso del pipeline ─────────────────────────────────────────────────────
def ejecutar(estado: dict, anios: list[int] | None = None, conservar: bool = False) -> dict:
    """estado: lo que esta fuente guardó en la corrida anterior (de _meta.json).
    Devuelve los campos nuevos para _meta.json."""
    cajas = leer_catalogo("cajas_nino")
    archivos = dict(estado.get("archivos", {}))      # año -> Last-Modified procesado
    serie = leer_csv()

    if anios is None:
        anios = [hoy().year - 1, hoy().year]

    cambios = 0
    for anio in anios:
        modificado, tamanio = _modificado(anio)
        if not tamanio:
            log(f"  {anio}: NOAA todavía no publica ese año")
            continue
        ya_en_csv = not serie.empty and (serie.index.year == anio).any()
        if archivos.get(str(anio)) == modificado and ya_en_csv:
            log(f"  {anio}: sin cambios en NOAA ({modificado})")
            continue

        ruta = _descargar(anio, tamanio)
        nuevo = _promedios_caja(ruta, cajas)
        _validar(nuevo, anio)
        if not serie.empty:
            serie = serie[serie.index.year != anio]
        serie = pd.concat([serie, nuevo]).sort_index()
        archivos[str(anio)] = modificado
        cambios += 1
        log(f"  {anio}: {len(nuevo)} días, último {nuevo.index[-1]:%Y-%m-%d}, "
            + ", ".join(f"{k} {nuevo[k].iloc[-1]:+.2f}" for k in cajas))
        # El NetCDF pesa ~400 MB; el CSV ya guarda lo que importa.
        if not conservar:
            ruta.unlink(missing_ok=True)

    if serie.empty:
        raise ErrorFuente("no hay ningún dato OISST procesado todavía")

    ultimo = serie.index[-1].date()
    retraso = (hoy() - ultimo).days
    if retraso > DIAS_MAX_RETRASO:
        raise ErrorValidacion(f"el último dato OISST es del {ultimo} ({retraso} días de retraso)")

    if cambios:
        _guardar_csv(serie)

    return {
        "estado": "ok" if cambios else "sin_cambios",
        "ultimo_dato": ultimo.isoformat(),
        "archivos": archivos,
        "fuente": "NOAA OISST v2.1 (PSL), anomalía 1991-2020",
    }
