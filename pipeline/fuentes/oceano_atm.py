"""
Fuente: indicadores océano-atmósfera de NOAA (texto plano), los que cualquier
centro mira para seguir a El Niño más allá de la temperatura superficial:

  soi        Índice de Oscilación del Sur, estandarizado (CPC)
  olr        Radiación de onda larga en 160°E-160°W, estandarizada (CPC): negativo = más nubes
  viento_o   Viento 850 hPa, Pacífico oeste, 135°E-180°, anomalía (CPC)
  viento_c   Viento 850 hPa, Pacífico central, 175°W-140°W, anomalía (CPC)
  viento_e   Viento 850 hPa, Pacífico este, 135°W-120°W, anomalía (CPC)
  calor      Contenido de calor 0-300 m, 180°-100°W, anomalía en °C (CPC/GODAS)
  mei        Índice Multivariado de ENSO v2 (PSL)
  pdo        Oscilación Decadal del Pacífico (NCEI)

Escribe sitio/datos/indices/oceano_atm.csv (mensual).

Además compara nuestra serie OISST con el archivo semanal oficial del CPC
(wksst9120.for) y publica sitio/datos/indices/verificacion.json: si difieren
más de lo normal, el paso falla y nos enteramos.

Y lee el estado oficial de NOAA (ENSO Diagnostic Discussion) para la portada:
sitio/datos/indices/noaa_estado.json.
"""
from __future__ import annotations

import html
import re

import pandas as pd
import requests

from comun import DATOS, ErrorFuente, ErrorValidacion, ahora_utc, escribir_json, log
from fuentes.oisst import leer_csv as leer_oisst

CPC = "https://www.cpc.ncep.noaa.gov/data/indices/"
CSV = DATOS / "indices" / "oceano_atm.csv"
VERIF = DATOS / "indices" / "verificacion.json"
ESTADO = DATOS / "indices" / "noaa_estado.json"
DISC = "https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso_advisory/ensodisc.shtml"
UA = {"User-Agent": "ensoperu-pipeline"}
MAX_DIF = 0.5       # °C; diferencia media admisible con el CPC


def _bajar(url: str) -> str:
    try:
        r = requests.get(url, headers=UA, timeout=60)
        r.raise_for_status()
        return r.text
    except requests.RequestException as e:
        raise ErrorFuente(f"sin respuesta de {url}: {e}") from e


def _bloque_cpc(texto: str, marca: str) -> pd.Series:
    """Formato CPC: varios bloques YEAR JAN..DEC bajo un rótulo (ANOMALY, STANDARDIZED...)."""
    i = texto.find(marca)
    if i < 0:
        raise ErrorValidacion(f"formato CPC: no encontré el bloque '{marca}'")
    filas, empezo = {}, False
    for l in texto[i:].splitlines()[1:]:
        p = re.findall(r"-?\d+\.\d+|-999\.9|\b\d{4}\b", l)
        if re.match(r"\s*\d{4}\b", l) and len(p) >= 2:
            empezo = True
            anio = int(p[0])
            for m, v in enumerate(p[1:13], 1):
                v = float(v)
                if v > -99:
                    filas[pd.Timestamp(anio, m, 1)] = v
        elif empezo and not l.strip().startswith("YEAR") and l.strip():
            break
    return pd.Series(filas).sort_index()


def _calor(texto: str) -> pd.Series:
    filas = {}
    for l in texto.splitlines():
        p = l.split()
        if len(p) == 5 and p[0].isdigit() and p[1].isdigit():
            filas[pd.Timestamp(int(p[0]), int(p[1]), 1)] = float(p[4])
    return pd.Series(filas).sort_index()


def _anual_mensual(texto: str, nulo: float) -> pd.Series:
    """Filas 'AÑO v1..v12' (MEI, PDO)."""
    filas = {}
    for l in texto.splitlines():
        p = l.split()
        if len(p) == 13 and re.fullmatch(r"\d{4}", p[0]):
            for m, v in enumerate(p[1:], 1):
                v = float(v)
                if abs(v - nulo) > 0.01 and abs(v) < 90:
                    filas[pd.Timestamp(int(p[0]), m, 1)] = v
    return pd.Series(filas).sort_index()


def _verificar() -> dict:
    t = _bajar(CPC + "wksst9120.for")
    filas = []
    for l in t.splitlines():
        m = re.match(r"\s*(\d{2})([A-Z]{3})(\d{4})", l)
        if m:
            n = re.findall(r"-?\d+\.\d", l[10:])
            if len(n) >= 8:
                filas.append((pd.Timestamp(f"{m[1]}{m[2]}{m[3]}"), float(n[1]), float(n[5])))
    w = pd.DataFrame(filas, columns=["f", "n12", "n34"]).set_index("f").tail(8)
    d = leer_oisst()
    difs, tabla = {"n12": [], "n34": []}, []
    for f, r in w.iterrows():
        t7 = d.loc[f - pd.Timedelta(days=3):f + pd.Timedelta(days=3)]
        if len(t7) < 4:
            continue
        for k in difs:
            difs[k].append(abs(float(t7[k].mean()) - r[k]))
        tabla.append({"semana": f.strftime("%Y-%m-%d"), "cpc_n12": r.n12, "nuestro_n12": round(float(t7.n12.mean()), 2),
                      "cpc_n34": r.n34, "nuestro_n34": round(float(t7.n34.mean()), 2)})
    if not tabla:
        raise ErrorValidacion("verificación: no hay semanas en común con el CPC")
    dif = {k: round(sum(v) / len(v), 2) for k, v in difs.items()}
    escribir_json(VERIF, {"_": "Comparación semanal de nuestra serie OISST con el archivo oficial del CPC.",
                          "fuente": "NOAA CPC, wksst9120.for", "revisado": ahora_utc(), "diferencia_media": dif, "semanas": tabla})
    if max(dif.values()) > MAX_DIF:
        raise ErrorValidacion(f"nuestra serie OISST difiere del CPC: {dif}")
    return dif


def _estado_noaa() -> None:
    h = _bajar(DISC)
    t = re.sub(r"<script.*?</script>|<style.*?</style>", " ", h, flags=re.S)
    t = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", t)))
    alerta = re.search(r"ENSO Alert System Status:\s*([^\n.]*?)(?:\s+Synopsis|$)", t)
    sinopsis = re.search(r"Synopsis:\s*(.{20,400}?\.)(?:\s|$)", t)
    fecha = re.search(r"issued by.*?(\d{1,2} [A-Z][a-z]+ 20\d\d)", t)
    prox = re.search(r"next ENSO Diagnostics Discussion is scheduled for (\d{1,2} [A-Z][a-z]+ 20\d\d)", t)
    if not sinopsis:
        raise ErrorValidacion("NOAA: no pude leer la sinopsis de la discusión ENSO")
    escribir_json(ESTADO, {"_": "Estado oficial de NOAA, en su idioma original.", "fuente": "NOAA CPC, ENSO Diagnostic Discussion",
                           "url": DISC, "alerta": alerta.group(1).strip() if alerta else None,
                           "sinopsis": sinopsis.group(1).strip(), "fecha": fecha.group(1) if fecha else None,
                           "proxima": prox.group(1) if prox else None})


def ejecutar(estado: dict) -> dict:
    cols = {
        "soi": _bloque_cpc(_bajar(CPC + "soi"), "STANDARDIZED"),
        "olr": _bloque_cpc(_bajar(CPC + "olr"), "STANDARDIZED"),
        "viento_o": _bloque_cpc(_bajar(CPC + "wpac850"), "ANOMALY"),
        "viento_c": _bloque_cpc(_bajar(CPC + "cpac850"), "ANOMALY"),
        "viento_e": _bloque_cpc(_bajar(CPC + "epac850"), "ANOMALY"),
        "calor": _calor(_bajar("https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/ocean/index/heat_content_index.txt")),
        "mei": _anual_mensual(_bajar("https://psl.noaa.gov/enso/mei/data/meiv2.data"), -999.0),
        "pdo": _anual_mensual(_bajar("https://www.ncei.noaa.gov/pub/data/cmb/ersst/v5/index/ersst.v5.pdo.dat"), 99.99),
    }
    for k, s in cols.items():
        if len(s) < 100:
            raise ErrorValidacion(f"{k}: solo {len(s)} valores; ¿cambió el formato?")
        if s.abs().max() > 15:
            raise ErrorValidacion(f"{k}: valor fuera de rango ({s.abs().max()})")
    df = pd.DataFrame(cols).sort_index()
    df = df[df.index.year >= 1950]
    df.index.name = "fecha"
    CSV.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(CSV, float_format="%.2f", date_format="%Y-%m", lineterminator="\n")
    dif = _verificar()
    try:
        _estado_noaa()
    except ErrorFuente as e:
        log(f"  aviso: {e}")
    u = df.dropna(how="all").index.max()
    log(f"  hasta {u:%Y-%m}; SOI {df.soi.dropna().iloc[-1]:+.1f}, calor {df.calor.dropna().iloc[-1]:+.2f}; "
        f"diferencia con el CPC {dif}")
    return {"estado": "ok", "ultimo_dato": u.strftime("%Y-%m"), "dif_cpc": dif, "fuente": "NOAA CPC, PSL, NCEI"}
