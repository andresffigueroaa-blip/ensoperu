"""
Fuente: focos de calor (incendios activos) de NASA FIRMS, sensor VIIRS, últimos
7 días, Sudamérica. Archivos públicos, sin clave, uno por satélite (SATELITES).
Se usa el primero que esté al día. No se suman: dos satélites ven el mismo fuego
y contarlo doble inflaría los niveles. S-NPP dejó de entregar el 2 de noviembre
de 2026; por eso hay respaldo y queda dicho en cada corrida qué satélite se usó.

Qué hace:
  1. Baja el CSV (~5 MB), se queda con los focos dentro del Perú y descarta
     los de confianza baja.
  2. Ubica cada foco en su distrito, provincia y región (códigos INEI).
  3. Escribe:
     sitio/datos/campos/incendios.geojson          focos de los últimos 7 días (puntos)
     sitio/datos/unidades/incendios.json           conteo por región, provincia y distrito
     sitio/datos/indices/incendios_diarios.csv     focos por día y región (se acumula en el tiempo)

Un foco de calor no es siempre un incendio forestal (también quemas
agrícolas, industrias); la página lo dice así.
"""
from __future__ import annotations

import io

import pandas as pd
import requests

from comun import DATOS, ErrorFuente, ErrorValidacion, escribir_json, hoy, log
from territorio import ubicar_muchos

BASE = "https://firms.modaps.eosdis.nasa.gov/data/active_fire/"
SATELITES = [("NOAA-20", BASE + "noaa-20-viirs-c2/csv/J1_VIIRS_C2_South_America_7d.csv"),
             ("NOAA-21", BASE + "noaa-21-viirs-c2/csv/J2_VIIRS_C2_South_America_7d.csv"),
             ("S-NPP", BASE + "suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_South_America_7d.csv")]
CAJA_PERU = (-81.5, -18.5, -68.5, 0.2)          # lon0, lat0, lon1, lat1
GEOJSON = DATOS / "campos" / "incendios.geojson"
POR_UNIDAD = DATOS / "unidades" / "incendios.json"
CSV_DIARIO = DATOS / "indices" / "incendios_diarios.csv"
DIAS_MAX_RETRASO = 3


def _bajar() -> tuple[pd.DataFrame, str]:
    """Primer satélite con datos recientes en toda Sudamérica."""
    problemas = []
    for nombre, url in SATELITES:
        try:
            r = requests.get(url, timeout=120)
            r.raise_for_status()
            df = pd.read_csv(io.StringIO(r.text))
            ultimo = pd.to_datetime(df.acq_date).max().date()
        except (requests.RequestException, ValueError, AttributeError, KeyError) as e:
            problemas.append(f"{nombre}: {type(e).__name__}")
            continue
        if (hoy() - ultimo).days <= DIAS_MAX_RETRASO:
            return df, nombre
        problemas.append(f"{nombre}: último dato {ultimo}")
    raise ErrorFuente("ningún satélite de FIRMS está al día (" + "; ".join(problemas) + ")")


def ejecutar(estado: dict) -> dict:
    df, satelite = _bajar()
    faltan = {"latitude", "longitude", "acq_date", "acq_time", "confidence", "frp", "daynight"} - set(df.columns)
    if faltan:
        raise ErrorValidacion(f"FIRMS cambió de formato: faltan columnas {sorted(faltan)}")

    lon0, lat0, lon1, lat1 = CAJA_PERU
    df = df[df.longitude.between(lon0, lon1) & df.latitude.between(lat0, lat1)]
    df = df[~df.confidence.astype(str).str.lower().isin(["l", "low"])]
    df = df.assign(distrito=ubicar_muchos(df.longitude.to_numpy(), df.latitude.to_numpy()))
    df = df[df.distrito != ""].copy()
    df["provincia"] = df.distrito.str[:4]
    df["region"] = df.distrito.str[:2]

    # Sin focos en el Perú ayer no es una falla: la vigencia se mide en todo el continente
    ultimo = pd.to_datetime(df.acq_date).max().date() if len(df) else None

    feats = [{"type": "Feature",
              "geometry": {"type": "Point", "coordinates": [round(x.longitude, 3), round(x.latitude, 3)]},
              "properties": {"fecha": x.acq_date, "hora": f"{int(x.acq_time):04d}", "frp": round(float(x.frp), 1),
                             "noche": x.daynight == "N", "distrito": x.distrito}}
             for x in df.itertuples()]
    escribir_json(GEOJSON, {"type": "FeatureCollection",
                            "_": "Generado por pipeline/fuentes/firms.py. Focos VIIRS de los últimos 7 días en el Perú.",
                            "fuente": f"NASA FIRMS, VIIRS {satelite} (375 m)",
                            "hasta": str(ultimo) if ultimo else None,
                            "features": feats}, compacto=True)

    conteo = {}
    for nivel in ("region", "provincia", "distrito"):
        g = df.groupby(nivel).agg(focos=("frp", "size"), frp=("frp", "sum"))
        for k, v in g.iterrows():
            conteo[k] = {"focos": int(v.focos), "frp": round(float(v.frp), 1)}
    escribir_json(POR_UNIDAD, {"_": "Focos de calor de los últimos 7 días por unidad (código INEI).",
                               "fuente": f"NASA FIRMS, VIIRS {satelite}", "hasta": str(ultimo) if ultimo else None,
                               "dias": 7, "valores": conteo}, compacto=True)

    # Serie diaria por región: se reemplazan los días que trae este archivo
    diario = df.groupby(["acq_date", "region"]).size().unstack(fill_value=0)
    diario.index = pd.to_datetime(diario.index)
    diario.index.name = "fecha"
    if CSV_DIARIO.exists():
        previo = pd.read_csv(CSV_DIARIO, index_col="fecha", parse_dates=["fecha"])
        previo = previo[~previo.index.isin(diario.index)]
        diario = pd.concat([previo, diario]).fillna(0)
    diario = diario.sort_index().astype(int)
    diario = diario[sorted(diario.columns)]
    CSV_DIARIO.parent.mkdir(parents=True, exist_ok=True)
    diario.to_csv(CSV_DIARIO, date_format="%Y-%m-%d", lineterminator="\n")

    top = df.groupby("region").size().sort_values(ascending=False).head(3)
    log(f"  {satelite}: {len(df)} focos en 7 días; más: " + ", ".join(f"{k} {v}" for k, v in top.items()))
    return {"estado": "ok", "ultimo_dato": str(ultimo) if ultimo else None, "focos_7d": int(len(df)),
            "fuente": f"NASA FIRMS, VIIRS {satelite}"}
