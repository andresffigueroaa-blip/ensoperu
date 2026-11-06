#!/usr/bin/env python3
"""
Capas oficiales de agua y población para el mapa, a partir de los shapefiles que
entregó el equipo (carpeta DATA_INGRESO, 6 de noviembre de 2026).

Se corre a mano, en la PC del equipo (necesita geopandas), cuando llegue una
versión nueva de los datos:
    python pipeline/herramientas/build_hidro.py "<carpeta DATA_NINHO extraída>"

Entradas (todas en grados, EPSG:4326):
  Rios_quebradas_ANA...shp      ríos y quebradas de la ANA (1225 tramos con nombre)
  CUENCAS/file_uh/UH.shp        unidades hidrográficas de la ANA (231)
  INGLOG_2020.gdb               INAIGEM, Inventario Nacional de Glaciares y Lagunas 2020
  Laguna_ANA...shp              lagunas de la ANA (IGN)
  Poblacion Censo 2025...shp    población por distrito, Censo 2025 (INEI, vía GeoGPS Perú)
  Centros_Poblados_2023...shp   centros poblados con su población (INEI, vía GeoGPS Perú)
  Quija_triangle.shp            es el mismo inventario de glaciares: no se usa

Salidas en sitio/datos/geo/:
  rios_ana.geojson       ríos simplificados (líneas), con su id
  rios_ana.json          ficha fija de cada río: cuenca, regiones, estaciones y poblados cercanos
  cuencas.geojson        cuencas simplificadas, con su id
  hidro_lugares.json     glaciares y lagunas glaciares (INAIGEM) y lagunas con nombre (ANA), puntos en tablas compactas
  poblacion_2025.json    población por distrito
  poblados.json          centros poblados: [lon, lat, nombre, población, ubigeo]
Las estaciones se toman de la última lectura de sitio/datos/peru/oficial.json y
de rios/pronostico.json: correr esta herramienta después del pipeline.
"""
from __future__ import annotations

import json
import re
import sys
import unicodedata
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
from shapely.geometry import Point

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from comun import DATOS, escribir_json, leer_json  # noqa: E402

GEO = DATOS / "geo"
METROS = "EPSG:32718"          # UTM 18 S: distancias en metros para todo el Perú, con error tolerable
DIST_ESTACION_M = 3000         # estación asociada a un río si está a menos de esto
DIST_POBLADO_M = 1000          # centro poblado "junto al río"


def norm(s) -> str:
    s = unicodedata.normalize("NFD", str(s or "").lower())
    return re.sub(r"[^a-z0-9 ]", "", "".join(c for c in s if unicodedata.category(c) != "Mn")).strip()


def nombre_rio(s) -> str:
    """'Río Chira' -> 'chira'; 'Quebrada Hospicio' -> 'hospicio'."""
    return re.sub(r"^(rio|quebrada|qda)\s+", "", norm(s))


def capa(base: Path, patron: str, **k) -> gpd.GeoDataFrame:
    f = next(base.rglob(patron))
    return gpd.read_file(f, **k).to_crs(4326)


def redondear(geom, dec=4):
    """GeoJSON con coordenadas recortadas a 4 decimales (~10 m): el archivo pesa la mitad."""
    g = json.loads(gpd.GeoSeries([geom]).to_json())["features"][0]["geometry"]
    def r(c):
        return [round(c[0], dec), round(c[1], dec)] if isinstance(c[0], (int, float)) else [r(x) for x in c]
    g["coordinates"] = r(g["coordinates"])
    return g


def main(base: Path):
    regiones = gpd.read_file(GEO / "regiones.geojson").to_crs(4326)

    # ── Ríos ──────────────────────────────────────────────────────────────
    rios = capa(base, "Rios_quebradas_ANA*.shp")
    rios = rios[rios.geometry.notna() & ~rios.geometry.is_empty].copy()
    rios["id"] = rios["CODIGO_CA"].astype(str)
    rios = rios.drop_duplicates("id")
    rios["geometry"] = rios.geometry.simplify(0.0015, preserve_topology=False)
    rm = rios.to_crs(METROS)

    # Regiones que atraviesa cada río
    cruce = gpd.sjoin(rios[["id", "geometry"]], regiones[["id", "geometry"]].rename(columns={"id": "region"}), predicate="intersects")
    reg_de = cruce.groupby("id")["region"].apply(lambda s: sorted(set(s))).to_dict()

    # Estaciones: ANA (caudal con umbrales), SENAMHI (monitoreo de umbral) y puntos GloFAS
    of = leer_json(DATOS / "peru" / "oficial.json") or {}
    est = []
    for e in (of.get("ana_rios") or {}).get("estaciones", []):
        if e.get("lat") and e.get("lon"):
            est.append({"fuente": "ANA", "clave": f"ANA|{e['estacion']}|{e['rio']}", "nombre": e["estacion"], "rio": e.get("rio"), "lon": e["lon"], "lat": e["lat"]})
    for e in (of.get("phisis") or {}).get("estaciones", []):
        if e.get("lat") and e.get("lon"):
            est.append({"fuente": "SENAMHI", "clave": f"SENAMHI|{e['estacion']}", "nombre": e["estacion"], "rio": None, "lon": e["lon"], "lat": e["lat"]})
    for r in (leer_json(DATOS / "rios" / "pronostico.json") or {}).get("rios", []):
        if r.get("lat") and r.get("lon"):
            est.append({"fuente": "GloFAS", "clave": f"GloFAS|{r['id']}", "nombre": r.get("lugar") or r["nombre"], "rio": r["nombre"], "lon": r["lon"], "lat": r["lat"]})
    ge = gpd.GeoDataFrame(est, geometry=[Point(e["lon"], e["lat"]) for e in est], crs=4326).to_crs(METROS) if est else None

    asoc = {}
    if ge is not None:
        for i, e in ge.iterrows():
            d = rm.distance(e.geometry)
            if e["rio"]:       # con nombre de río: el tramo de ese nombre más cercano, hasta 3 km (GloFAS: 8 km)
                mismo = rm[rm["NOMBRE_CA"].map(nombre_rio) == nombre_rio(e["rio"])]
                if len(mismo):
                    dm = mismo.distance(e.geometry)
                    tope = 8000 if e["fuente"] == "GloFAS" else DIST_ESTACION_M
                    if dm.min() <= tope:
                        asoc.setdefault(mismo.loc[dm.idxmin(), "id"], []).append(e["clave"])
                        continue
            if d.min() <= DIST_ESTACION_M and e["fuente"] != "GloFAS":
                asoc.setdefault(rm.loc[d.idxmin(), "id"], []).append(e["clave"])

    # Centros poblados junto a cada río
    cp = capa(base, "Centros_Poblados_2023*.shp")
    cp = cp[cp.geometry.notna()].copy()
    cp["pob"] = pd.to_numeric(cp["pob_total"], errors="coerce").fillna(0).astype(int)
    cpm = cp.to_crs(METROS)
    cerca = gpd.sjoin_nearest(cpm[["nom_ccpp", "pob", "cod_dist", "geometry"]], rm[["id", "geometry"]], max_distance=DIST_POBLADO_M, distance_col="dist")
    pob_de = {}
    for rid, g in cerca.groupby("id"):
        g = g.sort_values("pob", ascending=False)
        pob_de[rid] = {"poblados": int(len(g)), "personas": int(g["pob"].sum()),
                       "mayores": [[str(n).title(), int(p)] for n, p in zip(g["nom_ccpp"].head(8), g["pob"].head(8))]}

    feats, ficha = [], {}
    for _, r in rios.iterrows():
        tipo = "río" if str(r.get("TIPO_CA") or "").lower().startswith("r") else "quebrada"
        nombre = str(r["NOMBRE_CA"]).strip()
        props = {"id": r["id"], "nombre": nombre, "tipo": tipo, "cat": str(r.get("CATEGORIA") or "")}
        feats.append({"type": "Feature", "properties": props, "geometry": redondear(r.geometry)})
        c = r.geometry.interpolate(0.5, normalized=True)
        ficha[r["id"]] = {"nombre": nombre, "tipo": tipo, "categoria": r.get("CATEGORIA"), "eca": r.get("CODIGO_ECA"),
                          "long_km": round(float(r["LONG_KM"]), 1) if r.get("LONG_KM") else None,
                          "cuenca": r.get("NOMBRE_UH"), "cod_uh": r.get("CODIGO_UH"), "aaa": r.get("NOMBRE_AAA"), "vertiente": r.get("NOMBRE_RH"),
                          "regiones": reg_de.get(r["id"], []), "centro": [round(c.x, 4), round(c.y, 4)],
                          "estaciones": asoc.get(r["id"], []), **pob_de.get(r["id"], {"poblados": 0, "personas": 0, "mayores": []})}
    # La ANA parte cada río en tramos: se agrupan por nombre y cuenca para seguir el río entero
    grupos = {}
    for tid, f in ficha.items():
        clave = re.sub(r"[^a-z0-9]+", "-", nombre_rio(f["nombre"])) + "-" + str(f["cod_uh"])
        grupos.setdefault(clave, []).append(tid)
    largo = {tid: (f["long_km"] or 0) for tid, f in ficha.items()}
    rios_out = {}
    for clave, tramos in grupos.items():
        fs = [ficha[x] for x in tramos]
        mayores = sorted({n: p for f in fs for n, p in f["mayores"]}.items(), key=lambda x: -x[1])[:10]
        principal = max(tramos, key=lambda x: largo[x])
        rios_out[clave] = {"nombre": fs[0]["nombre"], "tipo": fs[0]["tipo"], "cuenca": fs[0]["cuenca"], "aaa": fs[0]["aaa"],
                           "vertiente": fs[0]["vertiente"], "categorias": sorted({str(f["categoria"]) for f in fs if f["categoria"]}),
                           "long_km": round(sum(largo[x] for x in tramos), 1), "tramos": tramos,
                           "regiones": sorted({r for f in fs for r in f["regiones"]}), "centro": ficha[principal]["centro"],
                           "estaciones": sorted({e for f in fs for e in f["estaciones"]}),
                           "poblados": sum(f["poblados"] for f in fs), "personas": sum(f["personas"] for f in fs),
                           "mayores": [[n, p] for n, p in mayores]}
    tramo_a_rio = {tid: clave for clave, ts in grupos.items() for tid in ts}
    for f in feats:
        f["properties"]["rio"] = tramo_a_rio[f["properties"]["id"]]
    # Caja de cada río, para encuadrarlo en el mapa
    for f in feats:
        cs = np.array([c for parte in ([f["geometry"]["coordinates"]] if f["geometry"]["type"] == "LineString" else f["geometry"]["coordinates"]) for c in parte])
        r = rios_out[f["properties"]["rio"]]
        caja = [cs[:, 0].min(), cs[:, 1].min(), cs[:, 0].max(), cs[:, 1].max()]
        r["caja"] = [round(min(r.get("caja", caja)[0], caja[0]), 3), round(min(r.get("caja", caja)[1], caja[1]), 3),
                     round(max(r.get("caja", caja)[2], caja[2]), 3), round(max(r.get("caja", caja)[3], caja[3]), 3)]
    escribir_json(GEO / "rios_ana.geojson", {"type": "FeatureCollection", "_": "ANA, ríos y quebradas, por tramo. 'rio' agrupa los tramos. build_hidro.py.",
                                              "features": feats}, compacto=True)
    escribir_json(GEO / "rios_ana.json", {"_": "Ficha fija de cada río, con sus tramos agrupados por nombre y cuenca (build_hidro.py). "
                                               "estaciones: claves 'FUENTE|nombre[|río]'. personas: población de los centros poblados a menos de 1 km.",
                                          "rios": rios_out}, compacto=True)
    print(f"tramos: {len(feats)}; ríos: {len(rios_out)}; con estación {sum(1 for x in rios_out.values() if x['estaciones'])}; "
          f"con poblados a menos de 1 km {sum(1 for x in rios_out.values() if x['poblados'])}; "
          f"{(GEO / 'rios_ana.geojson').stat().st_size / 1e6:.1f} MB")

    # ── Cuencas ───────────────────────────────────────────────────────────
    cu = capa(base, "UH.shp")
    cu["geometry"] = cu.geometry.simplify(0.004, preserve_topology=True)
    escribir_json(GEO / "cuencas.geojson", {"type": "FeatureCollection", "_": "ANA, unidades hidrográficas. Generado por build_hidro.py.",
        "features": [{"type": "Feature", "id": str(r["CODIGO"]), "geometry": redondear(r.geometry, 3),
                      "properties": {"id": str(r["CODIGO"]), "nombre": str(r["NOMBRE"]).strip(), "area": round(float(r["AREA_KM2"] or 0)),
                                     "vertiente": r.get("NOMB_UH_N1")}} for _, r in cu.iterrows()]}, compacto=True)
    print(f"cuencas: {len(cu)}; {(GEO / 'cuencas.geojson').stat().st_size / 1e6:.1f} MB")

    # ── Glaciares y lagunas: puntos, en tablas compactas (el GeoJSON pesaba 5 MB) ──
    gdb = next(base.rglob("Inventario_2020.gdb"))
    cordilleras, cuencas_l = [], []
    def idx(lista, v):
        v = str(v or "").strip()
        if v not in lista:
            lista.append(v)
        return lista.index(v)
    def pto(g):
        c = g.representative_point()
        return round(c.x, 4), round(c.y, 4)
    gl = gpd.read_file(gdb, layer="Glaciares_2020").to_crs(4326)
    glaciares = [[*pto(r.geometry), str(r["Nombre"] or "").strip(), idx(cordilleras, r["Cordillera"]), round(float(r["Area_Km2"] or 0), 2),
                  int(r["Alt_min"] or 0), int(r["Alt_max"] or 0)] for _, r in gl.iterrows()]
    lg = gpd.read_file(gdb, layer="Lagunas_2020").to_crs(4326)
    lag_glac = [[*pto(r.geometry), str(r["Nombre"] or "").strip(), idx(cordilleras, r["Cordillera"]), round(float(r["Area_Km2"] or 0), 3),
                 int(r["Altitud"] or 0)] for _, r in lg.iterrows()]
    la = capa(base, "Laguna_ANA*.shp")
    la = la[la["NOMBREOFIC"].notna() & (la["NOMBREOFIC"].astype(str).str.strip() != "")]
    lagunas = [[*pto(r.geometry), str(r["NOMBREOFIC"]).strip(), idx(cuencas_l, r.get("NOMBREUH"))] for _, r in la.iterrows()]
    escribir_json(GEO / "hidro_lugares.json", {
        "_": "Generado por build_hidro.py. glaciar: [lon, lat, nombre, cordillera, área km², altitud mínima, máxima]; "
             "laguna_glaciar: [lon, lat, nombre, cordillera, área km², altitud]; laguna: [lon, lat, nombre, cuenca].",
        "fuentes": {"glaciar": "INAIGEM, Inventario Nacional de Glaciares 2020", "laguna_glaciar": "INAIGEM, Inventario Nacional de Lagunas de Origen Glaciar 2020",
                    "laguna": "ANA, lagunas con nombre oficial (cartografía del IGN)"},
        "cordilleras": cordilleras, "cuencas": cuencas_l, "glaciar": glaciares, "laguna_glaciar": lag_glac, "laguna": lagunas}, compacto=True)
    viejo = GEO / "hidro_lugares.geojson"
    if viejo.exists():
        viejo.unlink()
    print(f"glaciares {len(glaciares)}, lagunas glaciares {len(lag_glac)}, lagunas ANA con nombre {len(lagunas)}; "
          f"{(GEO / 'hidro_lugares.json').stat().st_size / 1e6:.1f} MB")

    # ── Población 2025 y centros poblados ─────────────────────────────────
    pb = capa(base, "Poblacion Censo 2025*.shp")
    escribir_json(GEO / "poblacion_2025.json", {"_": "Población total por distrito, Censo 2025 (INEI, vía GeoGPS Perú).",
                                                "valores": {str(u).zfill(6): int(t) for u, t in zip(pb["UBIGEO"], pb["Total"]) if pd.notna(t)}}, compacto=True)
    escribir_json(GEO / "poblados.json", {"_": "Centros poblados: [lon, lat, nombre, población, ubigeo]. INEI, vía GeoGPS Perú.",
        "poblados": [[round(g.x, 4), round(g.y, 4), str(n).title(), int(p), str(u)] for g, n, p, u in zip(cp.geometry, cp["nom_ccpp"], cp["pob"], cp["cod_dist"])]},
        compacto=True)
    print(f"población 2025: {len(pb)} distritos; centros poblados: {len(cp)}")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
