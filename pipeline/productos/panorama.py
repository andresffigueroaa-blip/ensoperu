"""
Producto: panorama nacional del día (sitio/datos/panorama.json). Junta lo que
ya calcularon las fuentes y arma lo que la portada y el boletín muestran:

  - niveles de atención por región
  - provincias con más lluvia próxima, frente a su normal
  - provincias con más focos de calor
  - ríos con crecida pronosticada
  - distritos más expuestos según el CENEPRED
  - regiones con mayor desviación estacional (SEAS5)
  - la "lectura del día": frases armadas con esos datos, sin IA

El navegador no calcula nada de esto: solo lo lee. El boletín imprimible sale de
este mismo archivo, y se archiva uno por día en sitio/datos/boletines/ (nada se
borra, para poder ver cómo evolucionó el evento).
"""
from __future__ import annotations

import re

from comun import DATOS, escribir_json, ahora_utc, hoy, leer_catalogo, leer_json, log
from territorio import unidades


MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
         "setiembre", "octubre", "noviembre", "diciembre"]


def _nivel(a: dict, v) -> str | None:
    if v is None:
        return None
    return ["bajo", "medio", "alto", "muy alto"][sum(v >= c for c in a["cortes"])]


def ejecutar(estado: dict) -> dict:
    u = unidades()
    at = leer_catalogo("atencion")
    lluvia = (leer_json(DATOS / "unidades" / "lluvia_16d.json") or {})
    inc = (leer_json(DATOS / "unidades" / "incendios.json") or {})
    riesgo = (leer_json(DATOS / "unidades" / "riesgo.json") or {}).get("valores", {})
    spi = leer_json(DATOS / "unidades" / "spi.json") or {}
    est = leer_json(DATOS / "unidades" / "estacional.json") or {}
    rios = (leer_json(DATOS / "rios" / "pronostico.json") or {}).get("rios", [])
    # Si el SENAMHI no respondió, el archivo es viejo: un aviso vencido no cuenta
    avisos = [a for a in (leer_json(DATOS / "senamhi" / "avisos.json") or {}).get("avisos", [])
              if a["fin"] >= hoy().isoformat()]
    enfen = leer_json(DATOS / "enfen" / "comunicado.json") or {}
    estado_j = leer_json(DATOS / "estado.json") or {}
    regiones_j = (leer_json(DATOS / "regiones.json") or {}).get("regiones", {})
    ll = lluvia.get("valores", {})
    fo = inc.get("valores", {})
    normal = spi.get("normal_lluvia", {})
    mes = hoy().month - 1

    def prov(i):
        x = u.get(i, {})
        return {"id": i, "nombre": x.get("nombre", i), "region": x.get("region_nombre", "")}

    # Lluvia próxima frente a lo normal del mes (16/30 de la normal mensual). Con
    # menos de 15 mm normales (meses secos) el porcentaje infla y no dice nada.
    lluvia_vs = {}
    for i, v in ll.items():
        if i in normal:
            n = normal[i][mes] * 16 / 30
            lluvia_vs[i] = {"total": v["total"], "normal": round(n), "pct": round(v["total"] / n * 100) if n >= 15 else None}

    provincias = [i for i, x in u.items() if x["nivel"] == "provincia"]
    top_lluvia = sorted((i for i in provincias if i in ll), key=lambda i: -ll[i]["total"])[:10]
    top_focos = sorted((i for i in provincias if fo.get(i, {}).get("focos")), key=lambda i: -fo[i]["focos"])[:10]
    dist = [i for i, v in riesgo.items() if len(i) == 6]
    orden = {"Muy alto": 4, "Alto": 3, "Medio": 2, "Bajo": 1}
    exp_inu = sorted(dist, key=lambda i: (-orden.get(riesgo[i]["inu"]["riesgo"], 0), -riesgo[i]["inu"]["viv"]))[:10]

    regiones = {}
    for i, x in u.items():
        if x["nivel"] != "region":
            continue
        rj = regiones_j.get(x.get("clave"), {})
        tsm = rj.get("v", {}).get("tsm", {}).get("now") if rj.get("c") else None
        focos = fo.get(i, {}).get("focos", 0)
        df = ll.get(i, {}).get("dias_fuertes")
        e = est.get("valores", {}).get(i, {})
        # Aviso más alto de los que nombran su zona o a la región
        niv = [a["nivel"] for a in avisos if rj.get("z") in a.get("zonas", []) or x.get("clave") in a.get("regiones", [])]
        aviso = next((n for n in ("ROJO", "NARANJA", "AMARILLO") if n in niv), None)
        regiones[i] = {"nombre": rj.get("nombre", x["nombre"]), "zona": rj.get("z"), "aviso": aviso,
                       "mar": tsm, "n_mar": _nivel(at["mar"], tsm) if tsm is not None else None,
                       "focos": focos, "n_focos": _nivel(at["incendios"], focos),
                       "dias_fuertes": df, "n_lluvia": _nivel(at["lluvia"], df),
                       "lluvia16": ll.get(i, {}).get("total"), "spi3": spi.get("valores", {}).get(i, {}).get("spi3"),
                       "estacional": e.get("anom", [None])[1] if len(e.get("anom", [])) > 1 else None,
                       "rios_altos": [r["nombre"] for r in rios if r["region"] == i and r["nivel"] != "normal"]}

    rios_altos = sorted((r for r in rios if r["nivel"] != "normal"), key=lambda r: (r["nivel"] != "muy alto", -r["pico"] / max(r["p90"], 1)))
    rojos = [a for a in avisos if a["nivel"] == "ROJO"]

    # La lectura del día: frases con datos, sin IA
    ind = estado_j.get("indices", {})
    def n(x, dec=1):
        return ("+" if x > 0 else "−" if x < 0 else "") + f"{abs(x):.{dec}f}".replace(".", ",")
    lectura = []
    if enfen:
        tit = re.sub(r"\bel niño", "El Niño", enfen.get("titular", "").capitalize(), flags=re.I)
        a, m_, d = enfen["fecha"].split("-")
        cuando = f"{int(d)} de {MESES[int(m_) - 1]} de {a}"
        lectura.append(f"El ENFEN mantiene la {enfen['alerta']} ({enfen['id']}, {cuando}). {tit}.")
    if ind.get("n12", {}).get("valor") is not None:
        lectura.append(f"Mar: {n(ind['n12']['valor'])} °C en Niño 1+2 y {n(ind['n34']['valor'])} °C en Niño 3.4 (media de 7 días).")
    if avisos:
        lectura.append(f"SENAMHI tiene {len(avisos)} avisos vigentes o por empezar, {len(rojos)} en nivel rojo.")
    if top_lluvia:
        p = prov(top_lluvia[0])
        lectura.append(f"Lluvia próxima: la mayor en 16 días es {p['nombre']} ({p['region']}), con {ll[top_lluvia[0]]['total']:.0f} mm.")
    if rios_altos:
        lectura.append(f"Ríos: {len(rios_altos)} con crecida inusual pronosticada en 15 días, entre ellos {', '.join(r['nombre'] for r in rios_altos[:4])}.")
    # Lo que reporta el Estado (peru_oficial)
    of = leer_json(DATOS / "peru" / "oficial.json") or {}
    esc_ = of.get("escenario") or {}
    if esc_.get("vigente"):
        ma = (esc_.get("resumen") or {}).get("MA") or {}
        fin = max(e["fin_vigencia"][:10] for e in esc_["escenarios"])
        a, m_, d = fin.split("-")
        if ma.get("distritos"):
            pob = f"{ma.get('poblacion', 0):,}".replace(",", " ")
            lectura.append(f"CENEPRED: {ma['distritos']} distritos en riesgo muy alto por la lluvia hasta el {int(d)} de {MESES[int(m_) - 1]}, con {pob} personas.")
    if (of.get("coen") or {}).get("total"):
        c = of["coen"]
        principal = next(iter(c.get("por_peligro", {})), "")
        lectura.append(f"INDECI registró {c['total']} emergencias en 7 días; la más frecuente: {principal.lower()}.")
    if top_focos:
        p = prov(top_focos[0])
        total = sum(fo[i]["focos"] for i in provincias if i in fo)
        lectura.append(f"Focos de calor: {total} en 7 días; el mayor número en {p['nombre']} ({p['region']}), {fo[top_focos[0]]['focos']}.")

    salida = {
        "_": "Generado por pipeline/productos/panorama.py. No editar a mano.",
        "generado": ahora_utc(), "fecha": hoy().isoformat(), "lectura": lectura,
        "regiones": regiones, "lluvia_vs_normal": lluvia_vs,
        "top_lluvia": [{**prov(i), "total": ll[i]["total"], "dias_fuertes": ll[i]["dias_fuertes"], "max_dia": ll[i]["max_dia"],
                        "pct": lluvia_vs.get(i, {}).get("pct")} for i in top_lluvia],
        "top_focos": [{**prov(i), "focos": fo[i]["focos"], "frp": fo[i]["frp"]} for i in top_focos],
        "rios_altos": [{k: r[k] for k in ("id", "nombre", "lugar", "region", "hoy", "pico", "fecha_pico", "p90", "p99", "nivel")} for r in rios_altos],
        "expuestos_inundacion": [{"id": i, "nombre": u[i]["nombre"] if i in u else i, "provincia": u.get(i, {}).get("provincia_nombre"),
                                  "region": u.get(i, {}).get("region_nombre"), "riesgo": riesgo[i]["inu"]["riesgo"], "viv": riesgo[i]["inu"]["viv"],
                                  "pob": riesgo[i]["pob"], "iiee": riesgo[i]["inu"]["iiee"], "eess": riesgo[i]["inu"]["eess"]} for i in exp_inu],
        "totales": {"avisos": len(avisos), "rojos": len(rojos), "rios_altos": len(rios_altos),
                    "focos": sum(fo[i]["focos"] for i in provincias if i in fo),
                    "distritos_riesgo_alto": sum(1 for i in dist if riesgo[i]["inu"]["riesgo"] in ("Alto", "Muy alto"))},
    }
    escribir_json(DATOS / "panorama.json", salida)
    # Archivo: el boletín de cada día queda guardado
    bol = DATOS / "boletines"
    escribir_json(bol / f"{hoy().isoformat()}.json", {k: salida[k] for k in ("fecha", "lectura", "totales", "top_lluvia", "top_focos", "rios_altos")}, compacto=True)
    fechas = sorted(p.stem for p in bol.glob("20*.json"))
    escribir_json(bol / "indice.json", {"fechas": fechas}, compacto=True)
    log(f"  {len(lectura)} frases; {salida['totales']}")
    return {"estado": "ok", "ultimo_dato": hoy().isoformat()}
