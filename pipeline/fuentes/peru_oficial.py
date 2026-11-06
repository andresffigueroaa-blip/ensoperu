"""
Fuente: lo que el Estado peruano publica en vivo sobre la emergencia, en un solo lugar.

  fenomeno     SENAMHI: estado oficial del Fenómeno El Niño (API pública)
  coen         INDECI COEN: emergencias registradas en los últimos 7 días (puntos)
  indeci_rss   INDECI: últimos reportes complementarios
  escenario    CENEPRED: escenario de riesgo del aviso de lluvia vigente, por distrito
  quebradas    SENAMHI vía INDECI: activación de quebradas por distrito
  hidro        SENAMHI vía INDECI: avisos hidrológicos por estación
  ana_rios     ANA: caudal o nivel de los ríos frente a sus umbrales de alerta y emergencia
  ana_embalses ANA: volumen de los embalses
  ana_pc       ANA: puntos críticos de ríos y avance de sus obras de prevención
  emergencia   PCM vía ANA: distritos en estado de emergencia vigente
  preparacion  Geoperú: preparación de los distritos priorizados (DS 124-2026-PCM)
  agua         SUNASS: cortes de agua vigentes
  incendios    SERFOR: incendios forestales reportados
  phisis       SENAMHI: estado de umbral de 141 estaciones hidrológicas, hora a hora
  prono        SENAMHI: pronóstico estacional oficial de lluvia por sector (terciles)
  igp          IGP: índices E y C, y probabilidad de El Niño fuerte del modelo IGP-UHM
  dhn          Marina (DHN): temperatura del mar diaria en Niño 1+2 y 3.4 (OSTIA)
  inaigem      INAIGEM: semáforo de lagunas glaciares vigiladas
  enfen_docs   ENFEN: últimos comunicados e informes publicados

Cada bloque se lee aparte: si uno falla, los demás siguen y se conserva su último
dato marcado como atrasado. Nada se recalcula: se copia lo publicado, con su
fecha y su enlace. Los servicios que identifican el lugar por nombre se cruzan
con los códigos INEI por nombre normalizado; lo que no cruza se cuenta.

Escribe sitio/datos/peru/oficial.json (resumen y listas), peru/distritos.json
(por código de distrito, para el mapa y la ficha) y peru/*.geojson (puntos).
"""
from __future__ import annotations

import datetime as dt
import html
import re
import unicodedata
import xml.etree.ElementTree as ET

import requests

from comun import DATOS, ErrorFuente, ahora_utc, escribir_json, hoy, leer_json, log

DIR = DATOS / "peru"
SALIDA = DIR / "oficial.json"
UA = {"User-Agent": "ensoperu (https://github.com/andresffigueroaa-blip/ensoperu)"}
ORDEN_NIVEL = {"MA": 3, "A": 2, "M": 1}


def _get(url: str, **k) -> requests.Response:
    r = requests.get(url, headers=UA, timeout=90, **k)
    r.raise_for_status()
    return r


def _arcgis(base: str, where: str = "1=1", campos: str = "*", geometria: bool = False, maximo: int = 20000, orden: str | None = None) -> list[dict]:
    """Todas las filas de una capa ArcGIS REST, paginando. Con geometría, en grados."""
    filas, desde = [], 0
    while desde < maximo:
        p = {"where": where, "outFields": campos, "returnGeometry": str(geometria).lower(), "f": "json",
             "resultOffset": desde, "resultRecordCount": 2000}
        if geometria:
            p["outSR"] = 4326
        if orden:
            p["orderByFields"] = orden
        j = _get(base.rstrip("/") + "/query", params=p).json()
        if "error" in j:
            raise ValueError(f"ArcGIS: {j['error'].get('message')}")
        lote = j.get("features", [])
        filas += lote
        if len(lote) < 2000 or not j.get("exceededTransferLimit", len(lote) == 2000):
            break
        desde += len(lote)
    return filas


def _json(r: requests.Response):
    """JSON que algunos servidores mandan en latin-1 sin declararlo."""
    import json
    texto = r.content.decode("utf-8", errors="replace")
    if "\ufffd" in texto:
        texto = r.content.decode("cp1252", errors="replace")
    return json.loads(texto)


def _texto(s) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", str(s or "")))).strip()


def _ms(v) -> str | None:
    """Fecha ArcGIS (milisegundos) a AAAA-MM-DD."""
    try:
        return dt.datetime.fromtimestamp(int(v) / 1000, dt.timezone.utc).date().isoformat()
    except (TypeError, ValueError, OSError):
        return None


def _num(s):
    try:
        return float(str(s).strip().replace(",", ""))
    except ValueError:
        return None


# ── Cruce por nombre con los códigos INEI ───────────────────────────────
def _norm(s: str) -> str:
    s = unicodedata.normalize("NFD", str(s or "").upper())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"[^A-Z0-9]", "", s.replace("Ñ", "N"))


def _indice_nombres() -> dict:
    u = (leer_json(DATOS / "geo" / "unidades.json") or {}).get("unidades", [])
    idx = {}
    for x in u:
        if x["nivel"] == "distrito":
            idx[(_norm(x["region_nombre"]), _norm(x["provincia_nombre"]), _norm(x["nombre"]))] = x["id"]
            idx.setdefault(("*", _norm(x["provincia_nombre"]), _norm(x["nombre"])), x["id"])
    return idx


def _ubigeo(idx: dict, dep, prov, dist) -> str | None:
    return idx.get((_norm(dep), _norm(prov), _norm(dist))) or idx.get(("*", _norm(prov), _norm(dist)))


# ── Bloques ─────────────────────────────────────────────────────────────
def fenomeno(_) -> dict:
    d = _json(_get("https://servicios.senamhi.gob.pe/api/risks/el-nino/phenomenon"))["data"]
    return {"fecha": d.get("date"), "estado": d.get("conditionDescription"), "color": d.get("conditionColor"),
            "titular": d.get("headerDescription"), "url": "https://www.senamhi.gob.pe/?p=fenomeno-el-nino"}


def coen(idx) -> dict:
    j = _json(_get("https://coen.indeci.gob.pe/api/v2/mer/emergencies/geojson-last-emergencies?daysAgo=7"))
    feats, por_peligro, por_region, sin_cruce = [], {}, {}, 0
    for f in j.get("features", []):
        p = f.get("properties", {})
        g = lambda *ks: next((p[k] for k in p if any(_norm(k) == _norm(x) for x in ks)), None)
        peligro = re.sub(r"^\d+\s*", "", str(g("Tipo de peligro") or "")).capitalize()
        dep, prov, dist = g("Departamento"), g("Provincia"), g("Distrito")
        ub = _ubigeo(idx, dep, prov, dist)
        sin_cruce += ub is None
        fecha = str(g("Fecha de ocurrencia") or "")[:16].replace("T", " ")
        por_peligro[peligro] = por_peligro.get(peligro, 0) + 1
        if ub:
            por_region[ub[:2]] = por_region.get(ub[:2], 0) + 1
        if f.get("geometry"):
            feats.append({"type": "Feature", "geometry": f["geometry"],
                          "properties": {"fecha": fecha, "peligro": peligro, "distrito": ub, "lugar": f"{str(dist).title()}, {str(prov).title()}, {str(dep).title()}",
                                         "hechos": _texto(g("Hechos"))[:400], "pdf": g("document"), "sinpad": g("Código SINPAD", "Codigo SINPAD")}})
    feats.sort(key=lambda f: f["properties"]["fecha"], reverse=True)
    escribir_json(DIR / "emergencias.geojson", {"type": "FeatureCollection", "features": feats}, compacto=True)
    return {"dias": 7, "total": len(feats), "por_peligro": dict(sorted(por_peligro.items(), key=lambda x: -x[1])),
            "por_region": por_region, "ultimas": [f["properties"] for f in feats[:40]], "sin_cruce": sin_cruce,
            "url": "https://coen.indeci.gob.pe/mer/"}


def indeci_rss(_) -> dict:
    raiz = ET.fromstring(_get("https://portal.indeci.gob.pe/emergencias/feed/").content)
    items = []
    for it in raiz.iter("item"):
        try:
            f = dt.datetime.strptime(it.findtext("pubDate")[:25], "%a, %d %b %Y %H:%M:%S").isoformat()[:16]
        except (TypeError, ValueError):
            f = None
        items.append({"titulo": _texto(it.findtext("title")), "enlace": it.findtext("link"), "fecha": f})
    return {"reportes": items[:20], "url": "https://portal.indeci.gob.pe/emergencias/"}


def escenario(_) -> dict:
    base = "https://sigrid.cenepred.gob.pe/sigridv3/escenario-aviso"
    lista = _get(f"{base}/data-lluvia").json()
    lista = lista.get("data", lista) if isinstance(lista, dict) else lista
    ahora = dt.datetime.now(dt.timezone(dt.timedelta(hours=-5))).strftime("%Y-%m-%d %H:%M:%S")
    bien = lambda s: bool(re.fullmatch(r"20\d\d-\d\d-\d\d \d\d:\d\d:\d\d", str(s or "")))
    lista = [x for x in lista if bien(x.get("fin_vigencia")) and bien(x.get("inicio_vigencia"))]
    vigentes = [x for x in lista if x["inicio_vigencia"] <= ahora <= x["fin_vigencia"]]
    if not vigentes:      # sin aviso vigente: se dice así, con el último para referencia
        ult = max(lista, key=lambda x: int(x["id"]))
        return {"vigente": False, "ultimo": {k: ult.get(k) for k in ("id", "inicio_vigencia", "fin_vigencia", "ambito")}, "distritos": {}}
    distritos, resumen, escenarios = {}, {"MA": {}, "A": {}, "M": {}}, []
    for e in sorted(vigentes, key=lambda x: int(x["id"])):
        d = _get(f"{base}/{e['id']}/traer-distritos").json()
        escenarios.append({k: e.get(k) for k in ("id", "inicio_vigencia", "fin_vigencia", "ambito")})
        for g in d.get("g", []):
            n = str(g.get("nivel", "")).upper()
            if ORDEN_NIVEL.get(n, 0) > ORDEN_NIVEL.get(distritos.get(g["ubigeo"], {}).get("nivel"), 0):
                distritos[g["ubigeo"]] = {"nivel": n, "poblacion": g.get("poblacion"), "vivienda": g.get("vivienda"), "escenario": e["id"]}
    for ub, v in distritos.items():
        r = resumen[v["nivel"]]
        r["distritos"] = r.get("distritos", 0) + 1
        r["poblacion"] = r.get("poblacion", 0) + (v["poblacion"] or 0)
        r["vivienda"] = r.get("vivienda", 0) + (v["vivienda"] or 0)
    return {"vigente": True, "escenarios": escenarios, "resumen": resumen, "distritos": distritos,
            "url": "https://sigrid.cenepred.gob.pe/sigridv3/escenario-aviso"}


def quebradas(idx) -> dict:
    filas = _arcgis("https://geosinpad.indeci.gob.pe/indeci/rest/services/Ent_Tecnico_Cientificas/SENAMHI/MapServer/2", geometria=False)
    distritos, sin_cruce, fecha = {}, 0, None
    for f in filas:
        a = f["attributes"]
        ub = _ubigeo(idx, a.get("NOMBDEP"), a.get("NOMBPROV"), a.get("NOMBDIST"))
        fecha = max(filter(None, [fecha, _ms(a.get("FECHA"))]), default=None)
        if not ub:
            sin_cruce += 1
            continue
        n = int(re.sub(r"\D", "", str(a.get("NIVEL"))) or 0)
        if n > distritos.get(ub, {}).get("nivel", 0):
            distritos[ub] = {"nivel": n, "texto": _texto(a.get("DESCRIPCIO"))[:300]}
    return {"fecha": fecha, "distritos": distritos, "sin_cruce": sin_cruce,
            "url": "https://www.senamhi.gob.pe/?p=aviso-meteorologico"}


def hidro(_) -> dict:
    filas = _arcgis("https://geosinpad.indeci.gob.pe/indeci/rest/services/Ent_Tecnico_Cientificas/SENAMHI/MapServer/4")
    avisos = []
    for f in filas:
        a = f["attributes"]
        avisos.append({"estacion": str(a.get("NOM_ESTACI") or "").title(), "titulo": _texto(a.get("TITULO")).capitalize(),
                       "nivel": a.get("COLOR_TEXT"), "fecha": a.get("FECHA_HORA"), "cuenca": a.get("NOM_CUENCA"),
                       "lugar": f"{str(a.get('NOMBDIST') or '').title()}, {str(a.get('NOMBDEP') or '').title()}",
                       "lat": a.get("LATITUD"), "lon": a.get("LONGITUD"), "recomendacion": _texto(a.get("RECOMENDAC"))[:300], "numero": a.get("NUM_AVISO")})
    return {"avisos": avisos, "url": "https://www.senamhi.gob.pe/?p=aviso-hidrologico"}


def _ana(metodo: str) -> list[dict]:
    """El servicio de reportes de la ANA. Si el día aún no tiene reporte, se usa el anterior."""
    mejor = []
    for atras in (0, 1):
        f = (hoy() - dt.timedelta(days=atras)).strftime("%d/%m/%Y")
        r = requests.post(f"https://snirh.ana.gob.pe/onrh/ServicioReportes.asmx/{metodo}", headers=UA, timeout=90,
                          json={"pTipoRPT": 1, "pFecha": f, "pCodAAA": "00", "pCodALA": "00", "pCodUbigeo": "00"})
        r.raise_for_status()
        d = _json(r).get("d") or []
        if len(d) > len(mejor) * 1.5:      # el de hoy, salvo que esté muy incompleto
            mejor = d
    return mejor


def ana_rios(_) -> dict:
    est = []
    for x in _ana("ReporteNacionalCaudal"):
        v, al, em = _num(x.get("VALOR")), _num(x.get("UALERTA")), _num(x.get("UEMERGENCIA"))
        estado = "normal"
        # Umbrales de crecida: emergencia sobre alerta. Si la emergencia está por debajo, el aviso es de estiaje.
        if v is not None and al is not None and em is not None:
            if em >= al:
                estado = "emergencia" if v >= em else "alerta" if v >= al else "normal"
            else:
                estado = "emergencia" if v <= em else "alerta" if v <= al else "normal"
        est.append({"rio": str(x.get("RIO") or "").strip(), "estacion": str(x.get("ESTACION") or "").strip(),
                    "lugar": f"{x.get('DISTRITO')}, {x.get('DEPARTAMENTO')}", "valor": v, "unidad": x.get("UNIDADMEDIDA"),
                    "alerta": al, "emergencia": em, "tendencia": x.get("TENDENCIA"), "hora": x.get("HORA"), "estado": estado,
                    "estiaje": em is not None and al is not None and em < al,
                    "lat": _num(x.get("LATITUD")), "lon": _num(x.get("LONGITUD")), "reporte": x.get("RPT_NUMERO")})
    if not est:
        raise ValueError("ANA: reporte de caudales vacío")
    return {"estaciones": est, "en_alerta": sum(e["estado"] == "alerta" for e in est), "en_emergencia": sum(e["estado"] == "emergencia" for e in est),
            "url": "https://snirh.ana.gob.pe/onrh/"}


def ana_embalses(_) -> dict:
    emb = [{"nombre": str(x.get("RESERVORIO") or "").strip(), "lugar": f"{x.get('DISTRITO')}, {x.get('DEPARTAMENTO')}",
            "fecha": x.get("FECHA"), "util": _num(x.get("VOLUTIL")), "almacenado": _num(x.get("VOLALMACENADO")),
            "porcentaje": _num(x.get("PORCENTAJE")), "lat": _num(x.get("LATITUD")), "lon": _num(x.get("LONGITUD")),
            "influencia": x.get("DEP_INFLUENCIA")} for x in _ana("RptNacionalVolEmbalse")]
    if not emb:
        raise ValueError("ANA: reporte de embalses vacío")
    return {"embalses": emb, "url": "https://snirh.ana.gob.pe/onrh/"}


def ana_pc(_) -> dict:
    filas = _arcgis("https://snirhgeo.ana.gob.pe/server/rest/services/PC_Priorizados_2026/Puntos_Criticos_Final_Priorizados_2026_Automatizado/FeatureServer/0", geometria=True)
    feats, estados = [], {}
    for f in filas:
        a, g = f["attributes"], f.get("geometry") or {}
        estados[a.get("ESTADO")] = estados.get(a.get("ESTADO"), 0) + 1
        if "x" in g:
            feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(g["x"], 4), round(g["y"], 4)]},
                          "properties": {"rio": a.get("NOMBRE"), "sector": a.get("SECTOR"), "lugar": f"{a.get('nombdistri')}, {a.get('nombdep')}",
                                         "actividad": a.get("NOMBRE_DE_ACTIVIDAD"), "estado": a.get("ESTADO"), "avance": a.get("AVANCEKMPOR"),
                                         "costo": a.get("COSTO_DE_LA_ACTIVIDAD"), "pob": a.get("POB"), "viv": a.get("VIVIENDAS"),
                                         "peligro": a.get("PELIGRO"), "ficha": a.get("RUTA"), "galeria": a.get("GALERIA")}})
    escribir_json(DIR / "puntos_criticos.geojson", {"type": "FeatureCollection", "features": feats}, compacto=True)
    avance = [f["properties"]["avance"] for f in feats if isinstance(f["properties"]["avance"], (int, float))]
    return {"total": len(filas), "por_estado": estados, "avance_medio": round(sum(avance) / len(avance), 1) if avance else None,
            "url": "https://snirh.ana.gob.pe/"}


def emergencia(_) -> dict:
    """Distritos en estado de emergencia: todas las capas DEE_* que publica la ANA, vigentes."""
    base = "https://snirhgeo.ana.gob.pe/server/rest/services/ONRH"
    servicios = [s["name"] for s in _get(f"{base}?f=json").json().get("services", []) if "DEE_" in s["name"]]
    distritos, decretos = {}, {}
    for s in servicios:
        for f in _arcgis(f"https://snirhgeo.ana.gob.pe/server/rest/services/{s}/MapServer/0"):
            a = f["attributes"]
            if str(a.get("FEC_FIN") or "9999") < hoy().isoformat():
                continue
            ds = a.get("DS")
            decretos.setdefault(ds, {"peligro": a.get("PELIGRO"), "inicio": a.get("FEC_INI"), "fin": a.get("FEC_FIN"), "distritos": 0})
            decretos[ds]["distritos"] += 1
            distritos.setdefault(a.get("UBIGEO"), []).append({"ds": ds, "peligro": a.get("PELIGRO"), "fin": a.get("FEC_FIN")})
    return {"decretos": decretos, "distritos": distritos, "servicios": servicios, "url": "https://www.gob.pe/busquedas?contenido[]=normas&term=estado+de+emergencia"}


def preparacion(_) -> dict:
    j = _get("https://reportes.geoperu.gob.pe/geoperu-static/data/distritos_priorizados_riesgo_ds124.geojson").json()
    distritos, conteo = {}, {}
    for f in j.get("features", []):
        p = f["properties"]
        nivel = (p.get("preparacion") or {}).get("nivel") or p.get("estado")
        conteo[nivel] = conteo.get(nivel, 0) + 1
        coel = p.get("coel") or {}
        distritos[p["UBIGEO"]] = {"nivel": nivel, "brigadas": (p.get("brigadas") or {}).get("numero"),
                                  "almacen": (p.get("almacen") or {}).get("tiene"), "coel": coel.get("conformado"), "coel24": coel.get("24h"),
                                  "viv_vulnerables": (p.get("vulnerabilidad") or {}).get("viviendas_vulnerables")}
    return {"conteo": conteo, "distritos": distritos, "url": "https://visor.geoperu.gob.pe/"}


def agua(idx) -> dict:
    # Hay cortes viejos que nunca se cerraron en el sistema: solo los iniciados en los últimos 30 días
    corte = (hoy() - dt.timedelta(days=30)).isoformat()
    filas = _arcgis("https://geosunass.sunass.gob.pe/gisserver/rest/services/Hosted/WFS_SUNASS_Semaforo_interrupciones/MapServer/0",
                    where=f"situacion='SERVICIO INTERRUMPIDO' AND fecha_de_inicio > DATE '{corte}'",
                    campos="eps,departamento,provincia,distrito,n_de_conexiones_afectadas,tipo_de_interrupci_n,motivo_de_interrupci_n,fecha_de_inicio,fecha_estimada_de_restablecimie")
    distritos, cortes, vistos = {}, [], set()
    for f in filas:
        a = f["attributes"]
        ub = _ubigeo(idx, a.get("departamento"), a.get("provincia"), a.get("distrito"))
        c = {"eps": str(a.get("eps") or "").strip(), "lugar": f"{str(a.get('distrito') or '').title()}, {str(a.get('departamento') or '').title()}",
             "conexiones": int(a.get("n_de_conexiones_afectadas") or 0), "tipo": str(a.get("tipo_de_interrupci_n") or "").capitalize(),
             "motivo": str(a.get("motivo_de_interrupci_n") or "").capitalize(), "inicio": _ms(a.get("fecha_de_inicio")),
             "restablece": _ms(a.get("fecha_estimada_de_restablecimie")), "distrito": ub}
        # Cortes sin cerrar en el sistema cuya reposición prevista ya pasó hace más de 2 días: no se cuentan
        if c["restablece"] and c["restablece"] < (hoy() - dt.timedelta(days=2)).isoformat():
            continue
        # El mismo corte viene repetido en varias filas: se cuenta una vez
        llave = (c["eps"], c["lugar"], c["inicio"], c["motivo"], c["conexiones"])
        if llave in vistos:
            continue
        vistos.add(llave)
        cortes.append(c)
        if ub:
            d = distritos.setdefault(ub, {"cortes": 0, "conexiones": 0})
            d["cortes"] += 1; d["conexiones"] += c["conexiones"]
    cortes.sort(key=lambda c: -c["conexiones"])
    return {"total": len(cortes), "conexiones": sum(c["conexiones"] for c in cortes), "cortes": cortes[:60], "distritos": distritos,
            "url": "https://www.sunass.gob.pe/"}


def incendios(_) -> dict:
    corte = (hoy() - dt.timedelta(days=7)).isoformat()
    filas = _arcgis("https://geo.serfor.gob.pe/geoservicios/rest/services/Visor/Incendios_Forestales/MapServer/1")
    lista = [{"fecha": _ms(a.get("FECHA")), "hora": a.get("HORA"), "lugar": f"{str(a.get('NOMDIS') or '').title()}, {str(a.get('NOMDEP') or '').title()}",
              "distrito": a.get("CATDIS"), "cobertura": a.get("TIPCOB"), "lat": a.get("LATITUD"), "lon": a.get("LONGITUD")}
             for a in (f["attributes"] for f in filas) if (_ms(a.get("FECHA")) or "") >= corte]
    lista.sort(key=lambda x: (x["fecha"] or "", x["hora"] or ""), reverse=True)
    return {"total": len(lista), "lista": lista[:80], "url": "https://geo.serfor.gob.pe/visor/"}


IDESEP = "https://idesep.senamhi.gob.pe/geoserver/ows?service=WFS&version=1.0.0&request=GetFeature&outputFormat=application/json&typeName="
NIVEL_PHISIS = {0: "normal", 1: "amarillo", 2: "naranja", 3: "rojo"}


def phisis(_) -> dict:
    j = _json(_get(IDESEP + "g_dbphisis:estaciones_monitoreo"))
    est = [{"estacion": str(p.get("nom_estacion") or "").title(), "cuenca": p.get("nom_cuenca"), "fecha": p.get("fecha_hora"),
            "nivel": NIVEL_PHISIS.get(p.get("nivel"), str(p.get("nivel"))), "variable": {"C": "caudal", "N": "nivel"}.get(p.get("variable"), p.get("variable")),
            "lugar": f"{str(p.get('nom_distrito') or '').title()}, {str(p.get('nom_departamento') or '').title()}",
            "lat": p.get("latitud"), "lon": p.get("longitud")} for p in (f["properties"] for f in j.get("features", []))]
    if not est:
        raise ValueError("PHISIS vacío")
    return {"estaciones": est, "sobre_umbral": sum(e["nivel"] != "normal" for e in est),
            "url": "https://www.senamhi.gob.pe/mapas/mapa-monitoreohidro/"}


def prono(_) -> dict:
    salida = {"url": "https://www.senamhi.gob.pe/?p=pronostico-climatico"}
    for clave, capa in (("trimestral", "spc:prono_trim_poligono_pp1"), ("verano", "spc:prono_verano_poligono")):
        sec = [{"sector": str(p.get("sectores") or "").title(), "bajo": p.get("inferior"), "normal": p.get("normal"), "sobre": p.get("superior"),
                "escenario": p.get("escenario"), "umbral_bajo": p.get("umb_inferior"), "umbral_sobre": p.get("umb_superior"),
                "periodo": str(p.get("trimestre") or "").replace("_", " a ").capitalize(), "emision": str(p.get("emision") or "")[:10]}
               for p in (f["properties"] for f in _json(_get(IDESEP + capa)).get("features", []))]
        salida[clave] = sec
    if not salida["trimestral"]:
        raise ValueError("pronóstico estacional vacío")
    return salida


def igp(_) -> dict:
    base = "http://met.igp.gob.pe"
    ec = [l.split() for l in _get(f"{base}/datos/ecindex_ersstv5.txt").text.splitlines() if re.match(r"\s*\d{4}\s+\d{2}\s", l)]
    prob = [l.split(",") for l in _get(f"{base}/variabclim/probability_2_1.csv").text.splitlines()[1:] if l.strip()]
    ultimo = prob[-1]
    return {"e": [{"mes": f"{a}-{m}", "valor": round(float(e), 2)} for a, m, e, c in ec[-24:]],
            "c": [{"mes": f"{a}-{m}", "valor": round(float(c), 2)} for a, m, e, c in ec[-24:]],
            "prob_fuerte": {"anio": int(ultimo[0]), "regresion": float(ultimo[1]), "clasificacion": float(ultimo[2])},
            "url": "http://met.igp.gob.pe/variabclim/"}


def dhn(_) -> dict:
    j = _json(_get("https://www.naylamp.dhn.mil.pe/newoceano2023/Oceano/dashboard/data/kpis_oceano.json"))
    salida = {"generado": j.get("generado"), "fuente": j.get("fuente"), "url": "https://www.dhn.mil.pe/"}
    for k, v in (j.get("regiones") or {}).items():
        a = {x: v.get(x) for x in v if not isinstance(v.get(x), list)}
        salida[k] = {**a, "atsm": (v.get("atsm") or [])[-60:]}
    return salida


def inaigem(_) -> dict:
    j = _json(_get("https://monitoreo-api.inaigem.gob.pe/api/public/stations"))
    return {"estaciones": [{"nombre": str(e.get("nombre") or "").replace("Estación ", ""), "semaforo": e.get("semaforo"), "altitud": e.get("altitud"),
                            "lat": e.get("latitud"), "lon": e.get("longitud"), "descripcion": e.get("descripcion")} for e in j.get("estaciones", [])],
            "url": "https://www.inaigem.gob.pe/"}


def enfen_docs(_) -> dict:
    posts = _json(_get("https://enfen.imarpe.gob.pe/wp-json/wp/v2/posts?per_page=12&_fields=id,date,link,title"))
    return {"docs": [{"titulo": _texto(p["title"]["rendered"]), "fecha": p["date"][:10], "url": p["link"]} for p in posts],
            "url": "https://enfen.imarpe.gob.pe/"}


BLOQUES = {"fenomeno": fenomeno, "coen": coen, "indeci_rss": indeci_rss, "escenario": escenario, "quebradas": quebradas,
           "hidro": hidro, "ana_rios": ana_rios, "ana_embalses": ana_embalses, "ana_pc": ana_pc, "emergencia": emergencia,
           "preparacion": preparacion, "agua": agua, "incendios": incendios, "phisis": phisis, "prono": prono, "igp": igp,
           "dhn": dhn, "inaigem": inaigem, "enfen_docs": enfen_docs}


def ejecutar(estado: dict) -> dict:
    DIR.mkdir(parents=True, exist_ok=True)
    previo = leer_json(SALIDA) or {}
    idx = _indice_nombres()
    salida = {"_": "Generado por pipeline/fuentes/peru_oficial.py. Datos oficiales tal como se publican.",
              "actualizado": ahora_utc(), "fallas": []}
    for clave, f in BLOQUES.items():
        try:
            salida[clave] = {**f(idx), "leido": ahora_utc()}
        except Exception as e:      # un servicio caído no tumba a los demás
            log(f"  {clave}: {type(e).__name__} {str(e)[:120]}")
            salida["fallas"].append(clave)
            if clave in previo:
                salida[clave] = {**previo[clave], "atrasado": True}
    if len(salida["fallas"]) > len(BLOQUES) // 2:
        raise ErrorFuente(f"más de la mitad de los servicios fallaron: {salida['fallas']}")

    # Por distrito: lo que necesitan el mapa y la ficha, en un archivo liviano
    por = {}
    def poner(ub, k, v):
        if ub:
            por.setdefault(ub, {})[k] = v
    for ub, v in salida.get("escenario", {}).get("distritos", {}).items(): poner(ub, "esc", v["nivel"])
    for ub, v in salida.get("quebradas", {}).get("distritos", {}).items(): poner(ub, "queb", v["nivel"])
    for ub, v in salida.get("emergencia", {}).get("distritos", {}).items(): poner(ub, "dee", v)
    for ub, v in salida.get("preparacion", {}).get("distritos", {}).items(): poner(ub, "prep", v)
    for ub, v in salida.get("agua", {}).get("distritos", {}).items(): poner(ub, "agua", v)
    for p in salida.get("coen", {}).get("ultimas", []):
        if p.get("distrito"):
            por.setdefault(p["distrito"], {}).setdefault("coen", 0)
    for f in (leer_json(DIR / "emergencias.geojson") or {}).get("features", []):
        ub = f["properties"].get("distrito")
        if ub:
            por.setdefault(ub, {})["coen"] = por.get(ub, {}).get("coen", 0) + 1
    escribir_json(DIR / "distritos.json", {"_": "Por código de distrito. esc: escenario CENEPRED (MA, A, M); queb: nivel de quebradas; "
                                           "dee: estado de emergencia; prep: preparación (Geoperú); agua: cortes SUNASS; coen: emergencias en 7 días.",
                                           "actualizado": salida["actualizado"], "valores": por}, compacto=True)
    escribir_json(SALIDA, salida)
    r = salida
    log(f"  COEN {r.get('coen', {}).get('total')} emergencias; escenario {'vigente' if r.get('escenario', {}).get('vigente') else 'no vigente'} "
        f"({len(r.get('escenario', {}).get('distritos', {}))} distritos); ríos ANA en alerta {r.get('ana_rios', {}).get('en_alerta')}, "
        f"emergencia {r.get('ana_rios', {}).get('en_emergencia')}; {len(r.get('emergencia', {}).get('distritos', {}))} distritos en emergencia; "
        f"cortes de agua {r.get('agua', {}).get('total')}; fallas {r['fallas']}")
    return {"estado": "ok", "ultimo_dato": hoy().isoformat(), "aviso": f"fallaron: {', '.join(r['fallas'])}" if r["fallas"] else None}
