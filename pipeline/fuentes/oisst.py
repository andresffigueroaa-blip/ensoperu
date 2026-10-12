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
     -> sitio/datos/indices/oisst_diario.csv (serie completa, una fila por día)
  4. Promedia la anomalía en la franja marina a menos de ~110 km de cada
     departamento con litoral (sitio/datos/geo/litoral.json).
     -> sitio/datos/indices/tsm_costera_diaria.csv
  5. Guarda el campo del último día (Pacífico oriental) para que
     productos/mapa_tsm.py lo dibuje sobre el mapa.
     -> pipeline/cache/oisst/campo_ultimo.nc

Uso aislado:
    python pipeline/run.py --solo oisst
    python pipeline/run.py --solo oisst --historico 1981-2025   (una sola vez)
"""
from __future__ import annotations

import time
from pathlib import Path

import numpy as np
import pandas as pd
import requests
import xarray as xr

from comun import (CACHE, DATOS, ErrorFuente, ErrorValidacion, hoy, leer_catalogo,
                   leer_json, log)

URL = "https://downloads.psl.noaa.gov/Datasets/noaa.oisst.v2.highres/sst.day.anom.{anio}.nc"
CSV = DATOS / "indices" / "oisst_diario.csv"
CSV_COSTA = DATOS / "indices" / "tsm_costera_diaria.csv"
LITORAL = DATOS / "geo" / "litoral.json"
DIR_NC = CACHE / "oisst"
CAMPO = DIR_NC / "campo_ultimo.nc"

PRIMER_ANIO = 1981
DIAS_MAX_RETRASO = 7          # si el último dato es más viejo, algo anda mal
RANGO_FISICO = (-8.0, 10.0)   # °C; una media de caja fuera de esto es un error

# Franja costera: celdas marinas a menos de esta distancia (grados, ~110 km)
# del vértice más cercano del polígono de un departamento con litoral.
FRANJA_GRADOS = 1.0
DOMINIO_COSTA = dict(lat=slice(-20, 1), lon=slice(275, 294))      # 85°W a 66°W
# Campo que se dibuja en el mapa: Pacífico oriental completo (vista Pacífico)
DOMINIO_CAMPO = dict(lat=slice(-25, 15), lon=slice(150, 295))     # 150°E a 65°W


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


def _descargar(anio: int, tamanio: int) -> Path:
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
def _a_serie(da: xr.DataArray) -> pd.Series:
    s = da.load().to_series()
    s.index = pd.to_datetime(s.index).normalize()
    return s


def _promedios_caja(anom: xr.DataArray, cajas: dict) -> pd.DataFrame:
    """Serie diaria del promedio de anomalía en cada caja Niño."""
    cols = {}
    for clave, c in cajas.items():
        sub = anom.sel(lat=slice(*c["lat"]), lon=slice(*c["lon"]))
        peso = np.cos(np.deg2rad(sub["lat"]))
        cols[clave] = _a_serie(sub.weighted(peso).mean(("lat", "lon"), skipna=True))
    df = pd.DataFrame(cols)
    df.index.name = "fecha"
    return df


def _asignar_costa(sub: xr.DataArray, litoral: dict) -> dict[str, np.ndarray]:
    """Máscara (lat, lon) de la franja costera de cada departamento: cada
    celda marina va al departamento con el vértice de polígono más cercano,
    si ese vértice está a menos de FRANJA_GRADOS."""
    mar = sub.isel(time=-1).notnull().to_numpy()
    lat2 = np.broadcast_to(sub["lat"].to_numpy()[:, None], mar.shape)
    lon2 = np.broadcast_to(sub["lon"].to_numpy()[None, :] - 360, mar.shape)   # a -180..180
    idx = np.flatnonzero(mar)
    clat, clon = lat2.ravel()[idx], lon2.ravel()[idx]

    nombres = list(litoral)
    verts = np.array([v + [i] for i, n in enumerate(nombres) for v in litoral[n]])   # lon, lat, i
    cosl = np.cos(np.deg2rad(clat))
    # distancia aproximada en grados, corrigiendo la longitud por la latitud
    d = np.hypot((clon[:, None] - verts[None, :, 0]) * cosl[:, None],
                 clat[:, None] - verts[None, :, 1])
    cercano = d.argmin(axis=1)
    dmin = d[np.arange(len(idx)), cercano]
    dueno = verts[cercano, 2].astype(int)

    mascaras = {}
    for i, n in enumerate(nombres):
        m = np.zeros(mar.shape, dtype=bool)
        m.ravel()[idx[(dueno == i) & (dmin <= FRANJA_GRADOS)]] = True
        if m.any():
            mascaras[n] = m
    return mascaras


def _tsm_costera(anom: xr.DataArray, litoral: dict) -> pd.DataFrame:
    sub = anom.sel(**DOMINIO_COSTA).load()
    peso = np.cos(np.deg2rad(sub["lat"]))
    cols = {}
    for nombre, m in _asignar_costa(sub, litoral).items():
        mask = xr.DataArray(m, dims=("lat", "lon"), coords={"lat": sub["lat"], "lon": sub["lon"]})
        cols[nombre] = _a_serie(sub.where(mask).weighted(peso).mean(("lat", "lon"), skipna=True))
    df = pd.DataFrame(cols)
    df.index.name = "fecha"
    return df


def _guardar_campo(anom: xr.DataArray) -> None:
    """Campo del último día con dato, para el mapa."""
    campo = anom.isel(time=-1).sel(**DOMINIO_CAMPO).load()
    campo.name = "anom"
    campo.attrs = {"fecha": pd.Timestamp(campo["time"].values).strftime("%Y-%m-%d"),
                   "fuente": "NOAA OISST v2.1, anomalía respecto de 1991-2020"}
    DIR_NC.mkdir(parents=True, exist_ok=True)
    tmp = CAMPO.with_suffix(".tmp.nc")
    campo.drop_vars("time").to_netcdf(tmp)
    tmp.replace(CAMPO)


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


def _leer(ruta: Path) -> pd.DataFrame:
    if not ruta.exists():
        return pd.DataFrame()
    return pd.read_csv(ruta, index_col="fecha", parse_dates=["fecha"])


def leer_csv() -> pd.DataFrame:
    return _leer(CSV)


def leer_costera() -> pd.DataFrame:
    return _leer(CSV_COSTA)


def _guardar(ruta: Path, df: pd.DataFrame) -> None:
    ruta.parent.mkdir(parents=True, exist_ok=True)
    tmp = ruta.with_suffix(".tmp")
    df.sort_index().to_csv(tmp, float_format="%.3f", date_format="%Y-%m-%d", lineterminator="\n")
    tmp.replace(ruta)


def _reemplazar_anio(serie: pd.DataFrame, nuevo: pd.DataFrame, anio: int) -> pd.DataFrame:
    if not serie.empty:
        serie = serie[serie.index.year != anio]
    return pd.concat([serie, nuevo]).sort_index()


# ── Paso del pipeline ─────────────────────────────────────────────────────
def ejecutar(estado: dict, anios: list[int] | None = None, conservar: bool = False) -> dict:
    """estado: lo que esta fuente guardó en la corrida anterior (de _meta.json).
    Devuelve los campos nuevos para _meta.json."""
    cajas = leer_catalogo("cajas_nino")
    litoral = leer_json(LITORAL)
    if not litoral:
        log("  aviso: falta geo/litoral.json (correr herramientas/build_geo.py); sin TSM costera")
    archivos = dict(estado.get("archivos", {}))      # año -> Last-Modified procesado
    serie, costa = leer_csv(), leer_costera()

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
        with xr.open_dataset(ruta) as ds:
            anom = ds["anom"]
            nuevo = _promedios_caja(anom, cajas)
            _validar(nuevo, anio)
            if litoral:
                nueva_costa = _tsm_costera(anom, litoral)
                _validar(nueva_costa, anio)
                costa = _reemplazar_anio(costa, nueva_costa, anio)
            if anio == hoy().year:
                _guardar_campo(anom)
        serie = _reemplazar_anio(serie, nuevo, anio)
        archivos[str(anio)] = modificado
        cambios += 1
        log(f"  {anio}: {len(nuevo)} días, último {nuevo.index[-1]:%Y-%m-%d}, "
            + ", ".join(f"{k} {nuevo[k].iloc[-1]:+.2f}" for k in cajas))
        # El NetCDF pesa ~400 MB; los CSV ya guardan lo que importa.
        if not conservar:
            ruta.unlink(missing_ok=True)

    if serie.empty:
        raise ErrorFuente("no hay ningún dato OISST procesado todavía")

    ultimo = serie.index[-1].date()
    retraso = (hoy() - ultimo).days
    if retraso > DIAS_MAX_RETRASO:
        raise ErrorValidacion(f"el último dato OISST es del {ultimo} ({retraso} días de retraso)")

    if cambios:
        _guardar(CSV, serie)
        if not costa.empty:
            _guardar(CSV_COSTA, costa)

    return {
        "estado": "ok" if cambios else "sin_cambios",
        "ultimo_dato": ultimo.isoformat(),
        "archivos": archivos,
        "fuente": "NOAA OISST v2.1 (PSL), anomalía 1991-2020",
    }
