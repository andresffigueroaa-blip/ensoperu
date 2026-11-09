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


RANGO_AVISO = {"AMARILLO": 1, "NARANJA": 2, "ROJO": 3}
ORDEN_N = {"bajo": 0, "medio": 1, "alto": 2, "muy alto": 3}


def tipo_peligro(titulo: str) -> str:
    """El peligro de un aviso del SENAMHI, por su título."""
    t = titulo.lower()
    # El orden importa: "descenso de temperatura diurna" es frío y "viento ... friaje" es viento
    for clave, pat in (("lluvia", r"precipitac|lluvia|nevada|granizo|tormenta"), ("viento", r"viento"), ("oleaje", r"oleaje"),
                       ("frío", r"descenso de temperatura|temperatura nocturna|heladas|friaje"),
                       ("calor", r"incremento de temperatura|temperatura diurna|calor")):
        if re.search(pat, t):
            return clave
    return "otro"


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
        suyos = [a for a in avisos if rj.get("z") in a.get("zonas", []) or x.get("clave") in a.get("regiones", [])]
        # El aviso que se muestra es el de mayor nivel entre los ya vigentes; si no hay, el próximo
        vig = [a for a in suyos if a["inicio"] <= hoy().isoformat()] or suyos
        top = max(vig, key=lambda a: RANGO_AVISO[a["nivel"]], default=None)
        aviso = top["nivel"] if top else None
        aviso_tipo = tipo_peligro(top["titulo"]) if top else None
        aviso_desde = top["inicio"] if top and top["inicio"] > hoy().isoformat() else None
        de_lluvia = [a for a in suyos if tipo_peligro(a["titulo"]) == "lluvia"]
        vig_ll = [a for a in de_lluvia if a["inicio"] <= hoy().isoformat()] or de_lluvia
        top_ll = max(vig_ll, key=lambda a: RANGO_AVISO[a["nivel"]], default=None)
        # El nivel de lluvia es solo del modelo (criterio ENSO Perú); el aviso oficial va en su propia columna, sin mezclarse
        n_ll = _nivel(at["lluvia"], df)
        regiones[i] = {"nombre": rj.get("nombre", x["nombre"]), "zona": rj.get("z"), "aviso": aviso, "aviso_tipo": aviso_tipo, "aviso_desde": aviso_desde,
                       "aviso_numero": top["numero"] if top else None, "aviso_url": top["enlace"] if top else None,
                       "aviso_lluvia": top_ll["nivel"] if top_ll else None,
                       "aviso_lluvia_desde": top_ll["inicio"] if top_ll and top_ll["inicio"] > hoy().isoformat() else None,
                       "mar": tsm, "n_mar": _nivel(at["mar"], tsm) if tsm is not None else None,
                       "focos": focos, "n_focos": _nivel(at["incendios"], focos),
                       "dias_fuertes": df, "n_lluvia": n_ll,
                       "lluvia16": ll.get(i, {}).get("total"), "spi3": spi.get("valores", {}).get(i, {}).get("spi3"),
                       "estacional": e.get("anom", [None])[1] if len(e.get("anom", [])) > 1 else None,
                       "rios_altos": [r["nombre"] for r in rios if r["region"] == i and r["nivel"] != "normal"]}

    rios_altos = sorted((r for r in rios if r["nivel"] != "normal"), key=lambda r: (r["nivel"] != "muy alto", -r["pico"] / max(r["p90"], 1)))
    rojos = [a for a in avisos if a["nivel"] == "ROJO"]

    # La lectura del día: frases con datos, sin IA
    ind = estado_j.get("indices", {})
    def n(x, dec=1):
        return ("+" if x > 0 else "−" if x < 0 else "") + f"{abs(x):.{dec}f}".replace(".", ",")
    # Cada frase lleva su fuente, la fecha del dato y el enlace: el boletín se imprime y se reenvía sin la web
    lectura = []
    def frase(t, fuente, fecha, url):
        lectura.append({"t": t, "fuente": fuente, "fecha": fecha or "", "url": url})
    def dia(f, anio=False):
        a, m_, d = f[:10].split("-")
        return f"{int(d)} de {MESES[int(m_) - 1]}" + (f" de {a}" if anio else "")
    if enfen:
        tit = re.sub(r"\bel niño", "El Niño", enfen.get("titular", "").capitalize(), flags=re.I)
        frase(f"Estado vigente según el ENFEN: {enfen['alerta']} (comunicado oficial {enfen['id']}, {dia(enfen['fecha'], True)}). {tit}.",
              f"ENFEN, comunicado oficial {enfen['id']}", enfen["fecha"], enfen.get("url"))
    if ind.get("n12", {}).get("valor") is not None:
        frase(f"Mar: anomalía de {n(ind['n12']['valor'])} °C en Niño 1+2 y {n(ind['n34']['valor'])} °C en Niño 3.4 "
              f"(media de 7 días al {dia(ind['n12']['fecha'])}, frente a la normal 1991-2020).",
              "Cálculo ENSO Perú con NOAA OISST v2.1", ind["n12"].get("fecha"), "https://psl.noaa.gov/data/gridded/data.noaa.oisst.v2.highres.html")
    if avisos:
        av = leer_json(DATOS / "senamhi" / "avisos.json") or {}
        frase(f"El SENAMHI tiene {len(avisos)} avisos meteorológicos vigentes o por empezar, {len(rojos)} en nivel rojo "
              f"(de todo tipo: lluvia, temperatura, viento).", "SENAMHI, avisos meteorológicos", av.get("leido"), av.get("url"))
    if top_lluvia:
        p = prov(top_lluvia[0])
        frase(f"Lluvia pronosticada por modelos para los próximos 16 días: el mayor acumulado es {p['nombre']} ({p['region']}), "
              f"con {ll[top_lluvia[0]]['total']:.0f} mm. Es un modelo, no un aviso del SENAMHI.",
              lluvia.get("fuente", "Open-Meteo"), lluvia.get("emitido"), "https://open-meteo.com/en/docs")
    mon = leer_json(DATOS / "rios" / "monitoreo.json") or {}
    if rios_altos:
        medidas = mon.get("conteo", {}).get("alerta", 0) + mon.get("conteo", {}).get("emergencia", 0)
        pron = leer_json(DATOS / "rios" / "pronostico.json") or {}
        frase(f"Ríos: el modelo global GloFAS pronostica caudales por encima de su percentil 90 anual (1984-2023) en {len(rios_altos)}, entre ellos "
              f"{', '.join(r['nombre'] for r in rios_altos[:4])}; es orientativo. "
              + (f"En la última lectura, {medidas} estaciones de la ANA y el SENAMHI están sobre su umbral de crecida."
                 if medidas else "En la última lectura, ninguna estación de la ANA ni del SENAMHI está sobre su umbral de crecida."),
              "GloFAS (Copernicus) vía Open-Meteo; lecturas de la ANA y el SENAMHI", mon.get("actualizado") or pron.get("emitido"),
              "https://www.globalfloods.eu/")
    # Lo que reporta el Estado (peru_oficial)
    of = leer_json(DATOS / "peru" / "oficial.json") or {}
    esc_ = of.get("escenario") or {}
    vigentes = [e for e in esc_.get("escenarios", []) if e["fin_vigencia"][:10] >= hoy().isoformat()]
    if esc_.get("vigente") and vigentes:
        ma = (esc_.get("resumen") or {}).get("MA") or {}
        fines = sorted({e["fin_vigencia"][:10] for e in vigentes})
        hasta = f"hasta el {dia(fines[0])}" if len(fines) == 1 else f"con vigencias hasta el {dia(fines[0])} y el {dia(fines[-1])}"
        if ma.get("distritos"):
            pob = f"{ma.get('poblacion', 0):,}".replace(",", " ")
            n_esc = "del escenario" if len(vigentes) == 1 else f"de los {len(vigentes)} escenarios vigentes"
            frase(f"CENEPRED: {ma['distritos']} distritos en riesgo muy alto por lluvia, {hasta}; en ellos viven {pob} personas "
                  f"(suma ENSO Perú {n_esc}, sin repetir distritos).", "CENEPRED, escenarios de riesgo ante el aviso de lluvias",
                  esc_.get("leido"), esc_.get("url"))
    if (of.get("coen") or {}).get("total"):
        c = of["coen"]
        principal = next(iter(c.get("por_peligro", {})), "")
        frase(f"El INDECI registró {c['total']} emergencias en 7 días; la más frecuente: {principal.lower()}. No todas se deben a El Niño.",
              "INDECI, COEN, registro de emergencias", c.get("leido"), c.get("url"))
    if top_focos:
        p = prov(top_focos[0])
        total = sum(fo[i]["focos"] for i in provincias if i in fo)
        frase(f"Focos de calor detectados por satélite: {total} en 7 días; el mayor número en {p['nombre']} ({p['region']}), {fo[top_focos[0]]['focos']}.",
              inc.get("fuente", "NASA FIRMS"), inc.get("hasta"), "https://firms.modaps.eosdis.nasa.gov/")

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
