"""
Producto: lectura por región y sector redactada con IA.

Para cada región genera dos análisis:
  - "ahora": la condición observada (archivo analisis/<region>/now.json)
  - "temporada": el escenario del periodo que cubre el ENFEN con sus
    probabilidades (se escribe en cada mes del selector: <region>/<AAAA-MM>.json)

Cómo se decide si hay que generar:
  1. Se arman las `entradas` con datos ya calculados: índices, TSM costera,
     alerta y probabilidades del ENFEN, comunicados, análogos y los
     antecedentes escritos por el equipo. Nada de valores demo.
  2. Se calcula una `huella` (resumen SHA-256) de esas entradas.
  3. Si el archivo existente tiene la misma huella, no se toca.
  4. Si no, se llama al proveedor (catalogo/ia.yaml), se valida la respuesta
     y recién entonces se escribe el archivo. Un texto que no pasa la
     validación no se publica: la página sigue con la plantilla.

Validación de la respuesta:
  - JSON con la forma pedida y solo los sectores pedidos
  - de 1 a 4 párrafos por sector, sin HTML ni guion largo
  - todo número del texto debe estar en las entradas (años, índices,
    probabilidades); se toleran enteros de 0 a 12 (meses, conteos)
"""
from __future__ import annotations

import hashlib
import json
import re
import time

from comun import (DATOS, ErrorFuente, ahora_utc, escribir_json, leer_catalogo,
                   leer_json, log)
from ia import proveedores

DIR = DATOS / "analisis"
ENTEROS_LIBRES = set(range(0, 13))      # "3 meses", "2 párrafos", etc.


# ── Utilidades ────────────────────────────────────────────────────────────
def slug(nombre: str) -> str:
    import unicodedata
    s = unicodedata.normalize("NFD", nombre.lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", "-", s.strip())


def huella_de(entradas: dict) -> str:
    texto = json.dumps(entradas, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(texto.encode("utf-8")).hexdigest()[:16]


def _numeros(obj, acc: set) -> set:
    """Todos los números que aparecen en las entradas, como cadenas
    normalizadas (punto decimal), con 0, 1 y 2 decimales."""
    if isinstance(obj, bool):
        return acc
    if isinstance(obj, (int, float)):
        for f in ("%.0f", "%.1f", "%.2f"):
            acc.add(f % obj)
        acc.add(str(obj))
    elif isinstance(obj, str):
        for t in re.findall(r"\d+(?:[.,]\d+)?", obj):
            acc.add(t.replace(",", "."))
    elif isinstance(obj, dict):
        for v in obj.values():
            _numeros(v, acc)
    elif isinstance(obj, (list, tuple)):
        for v in obj:
            _numeros(v, acc)
    return acc


def numeros_no_permitidos(texto: str, entradas: dict) -> list[str]:
    permitidos = _numeros(entradas, set())
    malos = []
    for t in re.findall(r"\d+(?:[.,]\d+)?", texto):
        n = t.replace(",", ".")
        if n in permitidos:
            continue
        if "." not in n and int(n) in ENTEROS_LIBRES:
            continue
        # tolerancia de redondeo: 6,5 vale por 6.52
        try:
            v = float(n)
            if any(abs(v - float(p)) <= 0.051 for p in permitidos if re.fullmatch(r"-?\d+(\.\d+)?", p)):
                continue
        except ValueError:
            pass
        malos.append(t)
    return malos


# ── Entradas ──────────────────────────────────────────────────────────────
def armar_entradas(nombre: str, region: dict, periodo: str, estado: dict,
                   serie: dict, plantillas: dict, config: dict) -> dict:
    ind = estado["indices"]
    sectores = [s["id"] for s in config["sectores"] if s["id"] in plantillas["guiones"].get(region["z"], {})]
    e = {
        "region": region.get("nombre", nombre),
        "zona": region["z"],
        "litoral": bool(region["c"]),
        "periodo": "condición observada ahora" if periodo == "ahora"
                   else f"escenario para el {estado['probabilidades'].get('periodo') or 'próximo verano'}",
        "alerta": {"estado": estado["alerta"]["estado"], "fuente": estado["alerta"]["fuente"],
                   "fecha": estado["alerta"]["fecha"]},
        "indices": {k: ind[k] for k in ("n12", "n34", "icen", "oni", "roni") if ind.get(k, {}).get("valor") is not None},
        "probabilidades": {
            "periodo": estado["probabilidades"].get("periodo"),
            "region": estado["probabilidades"].get("region"),
            "fuente": estado["probabilidades"].get("fuente"),
            "valores": {p["magnitud"]: p["p"] for p in estado["probabilidades"]["valores"]},
        },
        "comunicados_enfen": [c["texto"] for c in estado.get("comunicados", [])[:3]],
        "analogos": [ev["id"] for ev in (serie or {}).get("eventos", []) if not ev.get("actual")],
        "antecedentes": plantillas.get("antecedentes", {}).get(region["z"], ""),
        "sectores": sectores,
    }
    tsm = region.get("v", {}).get("tsm", {}).get("now")
    if region["c"] and tsm is not None:
        e["tsm_costera"] = {"valor": tsm, "unidad": "°C",
                            "fuente": config["capas"]["tsm"].get("fuente", "NOAA OISST")}
    return e


def armar_prompt(e: dict) -> str:
    return ("Redacta la lectura para la región indicada. Usa solo estos datos.\n\n"
            "ENTRADAS:\n" + json.dumps(e, ensure_ascii=False, indent=1) + "\n\n"
            "SECTORES A REDACTAR: " + ",".join(e["sectores"]) + "\n"
            "Devuelve únicamente el JSON pedido.")


# ── Validación ────────────────────────────────────────────────────────────
def validar(respuesta: str, e: dict) -> dict:
    try:
        d = json.loads(respuesta.strip().strip("`").removeprefix("json").strip())
    except json.JSONDecodeError as x:
        raise ErrorFuente(f"respuesta no es JSON: {x}") from x
    sec = d.get("sectores")
    if not isinstance(sec, dict) or not sec:
        raise ErrorFuente("falta 'sectores'")
    sobran = set(sec) - set(e["sectores"])
    if sobran:
        raise ErrorFuente(f"sectores no pedidos: {sorted(sobran)}")
    limpio = {}
    for s in e["sectores"]:
        parr = sec.get(s)
        if not isinstance(parr, list) or not 1 <= len(parr) <= 4:
            raise ErrorFuente(f"sector '{s}': se esperaban de 1 a 4 párrafos")
        parr = [str(p).replace("—", ",").replace("–", "-").strip() for p in parr]
        for p in parr:
            if not 40 <= len(p) <= 900:
                raise ErrorFuente(f"sector '{s}': párrafo de largo fuera de rango ({len(p)})")
            if re.search(r"<[^>]+>", p):
                raise ErrorFuente(f"sector '{s}': contiene HTML")
            malos = numeros_no_permitidos(p, e)
            if malos:
                raise ErrorFuente(f"sector '{s}': números que no están en las entradas: {malos}")
        limpio[s] = parr
    resumen = str(d.get("resumen", "")).replace("—", ",").strip()[:300]
    return {"sectores": limpio, "resumen": resumen}


# ── Paso del pipeline ─────────────────────────────────────────────────────
def ejecutar(estado_previo: dict) -> dict:
    cfg = leer_catalogo("ia")
    # Para probar en una laptop sin tocar el catálogo del equipo:
    #   ENSOPERU_IA_PROVEEDOR=simulado python pipeline/run.py --solo ia
    import os
    if os.environ.get("ENSOPERU_IA_PROVEEDOR"):
        cfg["proveedor"] = os.environ["ENSOPERU_IA_PROVEEDOR"]
    prov = proveedores.crear(cfg)
    if not prov.disponible():
        log(f"  sin clave {prov.clave_env}; se conservan los análisis existentes")
        return {"estado": "sin_cambios", "aviso": f"IA sin clave ({prov.clave_env}); no se generó nada"}

    modo = cfg.get("modo", "borrador")
    if modo not in ("borrador", "publicar"):
        raise ErrorFuente(f"ia.yaml: modo '{modo}' no existe; usar borrador o publicar")
    # En borrador los textos van a una carpeta que la página no lee
    destino_base = DIR / "_borrador" if modo == "borrador" else DIR

    estado = leer_json(DATOS / "estado.json")
    config = leer_json(DATOS / "config.json")
    regiones = leer_json(DATOS / "regiones.json")["regiones"]
    plantillas = leer_json(DIR / "_plantillas.json")
    serie = leer_json(DATOS / "series" / "tsm.json")
    meses_futuros = [m["id"] for m in config["meses"] if m["id"] != "now"]
    instrucciones = cfg["instrucciones"].strip()
    # Las instrucciones forman parte de la huella: cambiarlas regenera todo
    sello = {"instrucciones": hashlib.sha256(instrucciones.encode()).hexdigest()[:8], "modelo": prov.nombre}

    maximo = int(cfg.get("max_por_corrida", 60))
    pausa = float(cfg.get("pausa_segundos", 5))
    generados = rechazados = pendientes = 0
    errores = []

    for nombre, region in regiones.items():
        for periodo in ("ahora", "temporada"):
            e = armar_entradas(nombre, region, periodo, estado, serie, plantillas, config)
            if not e["sectores"]:
                continue
            huella = huella_de({**e, **sello})
            destinos = [destino_base / slug(nombre) / "now.json"] if periodo == "ahora" \
                else [destino_base / slug(nombre) / f"{m}.json" for m in meses_futuros]
            if all((leer_json(d) or {}).get("huella") == huella for d in destinos):
                continue
            if generados + rechazados >= maximo:
                pendientes += 1
                continue

            try:
                crudo = prov.generar(instrucciones, armar_prompt(e))
                salida = validar(crudo, e)
            except ErrorFuente as x:
                rechazados += 1
                errores.append(f"{nombre}/{periodo}: {x}")
                log(f"  ✘ {nombre} ({periodo}): {x}")
                if "límite de uso" in str(x) or "sin respuesta" in str(x):
                    break
                continue

            fuentes = [f"ENFEN, {estado['alerta']['fuente'].split(', ', 1)[-1]}"]
            if "tsm_costera" in e:
                fuentes.append("NOAA OISST (TSM costera)")
            fuentes += [v["fuente"].split(",")[0] for v in e["indices"].values()]
            texto_fuentes = ("Fuentes: " + "; ".join(dict.fromkeys(fuentes)) +
                             ". Interpretación generada con IA a partir de datos oficiales; "
                             "los valores usados están en el campo entradas de este archivo. "
                             "Para decisiones operativas consulte al ENFEN y al SENAMHI.")
            for d in destinos:
                escribir_json(d, {
                    "region": e["region"], "mes": d.stem, "periodo": periodo,
                    "generado": ahora_utc(), "modelo": prov.nombre, "huella": huella,
                    "entradas": e, "resumen": salida["resumen"], "sectores": salida["sectores"],
                    "antecedentes": e["antecedentes"] or None, "fuentes": texto_fuentes,
                })
            generados += 1
            log(f"  ✔ {nombre} ({periodo}): {len(salida['sectores'])} sectores")
            time.sleep(pausa)
        else:
            continue
        break   # se salió por límite de uso: no insistir hoy

    resumen = f"{generados} generados, {rechazados} rechazados, {pendientes} pendientes para mañana ({modo})"
    log(f"  {resumen}")
    info = {"estado": "ok" if generados else "sin_cambios", "modelo": prov.nombre, "modo": modo,
            "generados": generados, "rechazados": rechazados, "pendientes": pendientes}
    if errores:
        info["aviso"] = "; ".join(errores[:5])
    if rechazados and not generados:
        raise ErrorFuente(f"ningún análisis pasó la validación: {errores[0]}")
    return info
