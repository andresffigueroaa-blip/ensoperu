"""
Producto: traduce catalogo/*.yaml (lo que edita el equipo) a los JSON que
lee la página, y verifica que sea coherente antes de publicarlo.

Este paso no usa red y no puede fallar por culpa de un tercero: si falla,
es porque alguien escribió algo mal en el catálogo, y el mensaje dice qué.

Escribe:
  sitio/datos/config.json              capas, meses y sectores
  sitio/datos/regiones.json            zona, litoral y valor por capa y mes
  sitio/datos/analisis/_plantillas.json
"""
from __future__ import annotations

import re

from comun import DATOS, ErrorValidacion, escribir_json, leer_catalogo, leer_json

# Artificio de la DEMO: los valores demo de cada región se escalan por mes
# para que el selector de meses muestre algún cambio. Desaparece capa por
# capa a medida que cada una tenga su fuente real.
MODIFICADOR_DEMO = {"now": 0.85, "01": 1.0, "02": 1.15, "03": 1.05, "04": 0.8}

ESTADOS_ALERTA = ["No activo", "Vigilancia", "Alerta de El Niño Costero", "Final del evento"]


def _validar(capas, meses, sectores, regiones, plantillas, geo) -> list[str]:
    err = []
    for k, c in capas.items():
        if c["min"] >= c["max"]:
            err.append(f"capas.yaml: '{k}' tiene min >= max")
    ids = [m["id"] for m in meses]
    for i in ids:
        if i != "now" and not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", i):
            err.append(f"meses.yaml: id '{i}' debe ser 'now' o AAAA-MM")
    if len(set(ids)) != len(ids):
        err.append("meses.yaml: hay meses repetidos")
    if len({s["id"] for s in sectores}) != len(sectores):
        err.append("sectores.yaml: hay sectores repetidos")

    nombres_geo = {d["n"] for d in geo["deps"]}
    for n in sorted(nombres_geo - set(regiones)):
        err.append(f"regiones.yaml: falta '{n}', que está en el mapa")
    for n in sorted(set(regiones) - nombres_geo):
        err.append(f"regiones.yaml: '{n}' no existe en el mapa (¿error de tipeo?)")
    zonas = set(plantillas["guiones"])
    for n, r in regiones.items():
        if r.get("zona") not in zonas:
            err.append(f"regiones.yaml: '{n}' usa la zona '{r.get('zona')}', que no tiene plantillas")
        for capa in r.get("demo", {}):
            if capa not in capas:
                err.append(f"regiones.yaml: '{n}' tiene valor demo para la capa '{capa}', que no existe")
    return err


def _valores(region: dict, capas: dict, meses: list) -> dict:
    """Valor por capa y mes. Hoy todas las capas son demo; cuando una capa
    tenga fuente real, su producto escribirá el valor y aquí se omitirá."""
    out = {}
    for capa, c in capas.items():
        if c.get("fuente") != "demo":
            continue
        base = region.get("demo", {}).get(capa)
        out[capa] = {
            m["id"]: None if base is None
            else round(base * MODIFICADOR_DEMO.get(m["id"] if m["id"] == "now" else m["id"][-2:], 1.0), 2)
            for m in meses
        }
    return out


def ejecutar(estado: dict) -> dict:
    capas = leer_catalogo("capas")
    meses = leer_catalogo("meses")
    sectores = leer_catalogo("sectores")
    regiones = leer_catalogo("regiones")
    plantillas = leer_catalogo("plantillas")
    geo = leer_json(DATOS / "geo" / "departamentos.json")

    # YAML convierte 2027-01 en texto pero una fecha completa en date: se normaliza.
    for m in meses:
        m["id"] = str(m["id"])

    errores = _validar(capas, meses, sectores, regiones, plantillas, geo)
    if errores:
        raise ErrorValidacion("catálogo con errores:\n    " + "\n    ".join(errores))

    escribir_json(DATOS / "config.json", {
        "_": "Generado desde catalogo/ por el pipeline. Para cambiarlo, editar catalogo/*.yaml.",
        "capas": {k: {
            "n": c["nombre"], "u": c.get("unidad", ""), "lo": c["min"], "hi": c["max"],
            "loTx": f"{c['min']:+g} {c.get('unidad', '')}".strip().replace("+-", "-"),
            "hiTx": f"{c['max']:+g} {c.get('unidad', '')}".strip(),
            "invertida": bool(c.get("invertida", False)),
            "demo": c.get("fuente") == "demo",
        } for k, c in capas.items()},
        "meses": [{"id": m["id"], "n": m["nombre"], "s": str(m.get("detalle", ""))} for m in meses],
        "sectores": [{"id": s["id"], "n": s["nombre"]} for s in sectores],
    })

    escribir_json(DATOS / "regiones.json", {
        "_": "Generado desde catalogo/regiones.yaml y los productos del pipeline. No editar a mano.",
        "regiones": {n: {
            "nombre": r.get("nombre", n), "z": r["zona"], "c": int(bool(r.get("litoral"))),
            "v": _valores(r, capas, meses),
        } for n, r in regiones.items()},
    })

    escribir_json(DATOS / "analisis" / "_plantillas.json", {
        "_": "Generado desde catalogo/plantillas.yaml. No editar a mano.",
        **plantillas,
    })

    return {"estado": "ok", "regiones": len(regiones), "capas_demo":
            [k for k, c in capas.items() if c.get("fuente") == "demo"]}
