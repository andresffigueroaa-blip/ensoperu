#!/usr/bin/env python3
"""
Escenario de riesgo oficial ante El Niño (CENEPRED) por distrito, con los
límites vigentes (1891 distritos).
Servicio: sigrid.cenepred.gob.pe/arcgis/rest/services/FEN/ER_NINO2027_BD/MapServer

Se corre a mano (el CENEPRED lo actualiza por campaña):
    python pipeline/herramientas/build_riesgo.py

Escribe:
  sitio/datos/unidades/riesgo.json    riesgo y exposición por distrito, y sumado
                                      por provincia y región
  sitio/datos/geo/distritos.geojson   reemplaza los límites anteriores
  sitio/datos/geo/unidades.json       actualiza los distritos del buscador
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

import numpy as np
import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from comun import DATOS, escribir_json, leer_json  # noqa: E402
from herramientas.build_unidades import area_y_centro, exteriores, titulo  # noqa: E402

S = "https://sigrid.cenepred.gob.pe/arcgis/rest/services/FEN/ER_NINO2027_BD/MapServer"
ORDEN = ["Muy bajo", "Bajo", "Medio", "Alto", "Muy alto"]
CAMPOS_I = "ubigeo,nombdep,nombprov,nombdist,viv_2017,pob_2017,pobrmo,t_eess,t_iiee,sagr_tot,vias_tot,niv_sinu,viv_sinu,iiee_sinu,eess_sinu,vias_sinu,sagr_inu,nvuln_in,nriesgo_in"
CAMPOS_M = "ubigeo,npel_mm,vivsm_ma_a,iiee_smm,eess_smm,vias_smm,sagr_smm,vuln_mm,nriesgo_mm"


def consulta(capa: int, campos: str, geometria: bool) -> list[dict]:
    salida, inicio = [], 0
    while True:
        for intento in range(4):
            try:
                p = {"where": "1=1", "outFields": campos, "returnGeometry": str(geometria).lower(), "f": "geojson",
                     "orderByFields": "objectid", "resultOffset": inicio, "resultRecordCount": 200, "outSR": 4326}
                if geometria:
                    p.update(maxAllowableOffset=0.004, geometryPrecision=3)
                r = requests.get(f"{S}/{capa}/query", params=p, timeout=180)
                r.raise_for_status()
                f = r.json()["features"]
                break
            except (requests.RequestException, KeyError, ValueError) as e:
                print(f"  reintento {intento + 1}: {e}")
                time.sleep(10)
        else:
            raise SystemExit("CENEPRED no responde")
        salida += f
        print(f"  capa {capa}: {len(salida)}", flush=True)
        if len(f) < 200:
            return salida
        inicio += 200


def num(x):
    return 0 if x is None else float(x)


def main():
    inu = consulta(4, CAMPOS_I, True)
    mas = {f["properties"]["ubigeo"]: f["properties"] for f in consulta(5, CAMPOS_M, False)}

    feats, indice, valores = [], [], {}
    acum = {}
    for f in inu:
        p = f["properties"]
        i = p["ubigeo"]
        m = mas.get(i, {})
        g = f.get("geometry")
        if not g:
            continue
        feats.append({"type": "Feature", "id": i, "properties": {"id": i, "nombre": titulo(p["nombdist"])}, "geometry": g})
        a = np.vstack(exteriores(g))
        anillo = max(exteriores(g), key=lambda r: area_y_centro(r)[0])
        indice.append({"id": i, "nombre": titulo(p["nombdist"]), "provincia": i[:4], "provincia_nombre": titulo(p["nombprov"]),
                       "region": i[:2], "region_nombre": titulo(p["nombdep"]), "nivel": "distrito",
                       "caja": [round(float(v), 3) for v in (*a.min(axis=0), *a.max(axis=0))],
                       "centro": [round(v, 3) for v in area_y_centro(anillo)[1]]})
        fila = {"pob": int(num(p["pob_2017"])), "viv": int(num(p["viv_2017"])), "pobreza": p["pobrmo"],
                "eess": int(num(p["t_eess"])), "iiee": int(num(p["t_iiee"])), "agri": round(num(p["sagr_tot"])), "vias": round(num(p["vias_tot"]), 1),
                "inu": {"riesgo": p["nriesgo_in"], "suscep": p["niv_sinu"], "vuln": p["nvuln_in"], "viv": int(num(p["viv_sinu"])),
                        "iiee": int(num(p["iiee_sinu"])), "eess": int(num(p["eess_sinu"])), "vias": round(num(p["vias_sinu"]), 1), "agri": round(num(p["sagr_inu"]))},
                "mm": {"riesgo": m.get("nriesgo_mm"), "suscep": m.get("npel_mm"), "vuln": m.get("vuln_mm"), "viv": int(num(m.get("vivsm_ma_a"))),
                       "iiee": int(num(m.get("iiee_smm"))), "eess": int(num(m.get("eess_smm"))), "vias": round(num(m.get("vias_smm")), 1), "agri": round(num(m.get("sagr_smm")))}}
        valores[i] = fila
        for padre in (i[:4], i[:2]):
            b = acum.setdefault(padre, {"pob": 0, "viv": 0, "eess": 0, "iiee": 0, "agri": 0, "vias": 0, "distritos": 0,
                                        "inu": {"viv": 0, "iiee": 0, "eess": 0, "vias": 0, "agri": 0, "niveles": {}},
                                        "mm": {"viv": 0, "iiee": 0, "eess": 0, "vias": 0, "agri": 0, "niveles": {}}})
            b["distritos"] += 1
            for k in ("pob", "viv", "eess", "iiee", "agri", "vias"):
                b[k] += fila[k]
            for t in ("inu", "mm"):
                for k in ("viv", "iiee", "eess", "vias", "agri"):
                    b[t][k] += fila[t][k]
                n = fila[t]["riesgo"]
                if n:
                    b[t]["niveles"][n] = b[t]["niveles"].get(n, 0) + 1
    for b in acum.values():
        b["agri"], b["vias"] = round(b["agri"]), round(b["vias"], 1)
        for t in ("inu", "mm"):
            b[t]["agri"], b[t]["vias"] = round(b[t]["agri"]), round(b[t]["vias"], 1)
            # El nivel de la unidad es el mayor que afecta a más de un distrito
            niv = b[t]["niveles"]
            b[t]["riesgo"] = next((o for o in reversed(ORDEN) if niv.get(o)), None)
    valores.update(acum)

    escribir_json(DATOS / "unidades" / "riesgo.json", {
        "_": "Generado por pipeline/herramientas/build_riesgo.py desde el servicio oficial del CENEPRED.",
        "fuente": "CENEPRED, Escenario de riesgo ante El Niño 2027 (SIGRID)", "url": S, "censo": 2017, "valores": valores}, compacto=True)
    escribir_json(DATOS / "geo" / "distritos.geojson", {"type": "FeatureCollection", "features": feats}, compacto=True)

    u = leer_json(DATOS / "geo" / "unidades.json")
    u["unidades"] = [x for x in u["unidades"] if x["nivel"] != "distrito"] + indice
    u["fuente"] = "Regiones y provincias: INEI simplificado (juaneladio/peru-geojson). Distritos: CENEPRED (SIGRID)."
    escribir_json(DATOS / "geo" / "unidades.json", u, compacto=True)
    kb = (DATOS / "geo" / "distritos.geojson").stat().st_size / 1024
    n = {o: sum(1 for v in valores.values() if v.get("inu", {}).get("riesgo") == o and "suscep" in v["inu"]) for o in ORDEN}
    print(f"{len(feats)} distritos · distritos.geojson {kb:.0f} KB · riesgo de inundación: {n}")


if __name__ == "__main__":
    main()
