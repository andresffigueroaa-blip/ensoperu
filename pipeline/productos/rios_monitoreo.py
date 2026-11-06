"""
Producto: seguimiento de los ríos de la ANA, en cada corrida.

Para cada río (geo/rios_ana.json, sus tramos agrupados) junta lo que ya leyeron
las fuentes y decide un estado, con la regla a la vista:

  emergencia   una estación de la ANA sobre su umbral de emergencia
  alerta       una estación de la ANA sobre su umbral de alerta, o una del SENAMHI en naranja o rojo
  vigilancia   una estación del SENAMHI en amarillo, o crecida inusual pronosticada por GloFAS
  normal       tiene estaciones y ninguna pasa sus umbrales
  sin_datos    el río no tiene estaciones cerca: se ve en el mapa, pero no se puede seguir
  Aparte, "nivel bajo": la ANA marca umbrales de estiaje (nivel o caudal bajo).

Suma además, por cercanía al cauce: obras en puntos críticos de la ANA (a menos de
2 km) y emergencias del COEN de los últimos 7 días (a menos de 3 km).

Guarda la historia para ver cómo avanza cada río:
  rios/historial_estaciones.csv  fecha_hora, estación, valor, alerta, emergencia (ANA, una fila por reporte)
  rios/historial.csv             fecha, río, estado (una fila por río con estaciones y por día)

Escribe rios/monitoreo.json.
"""
from __future__ import annotations

import csv
import datetime as dt

import numpy as np

from comun import DATOS, ahora_utc, escribir_json, hoy, leer_json, log

SALIDA = DATOS / "rios" / "monitoreo.json"
HIST_EST = DATOS / "rios" / "historial_estaciones.csv"
HIST_RIO = DATOS / "rios" / "historial.csv"
ORDEN = {"emergencia": 4, "alerta": 3, "vigilancia": 2, "normal": 1, "sin_datos": 0}
KM_PC, KM_COEN = 2.0, 3.0


def norm_est(s) -> str:
    return str(s or "").strip().lower()


def _vertices(rios_geo: dict) -> dict:
    """Vértices de cada río (todos sus tramos), en km aproximados para medir cercanías."""
    v = {}
    for f in rios_geo.get("features", []):
        g = f["geometry"]
        partes = [g["coordinates"]] if g["type"] == "LineString" else g["coordinates"]
        v.setdefault(f["properties"]["rio"], []).extend(c for p in partes for c in p)
    return {k: np.array(c) for k, c in v.items()}


def _cerca(vert: np.ndarray, lon: float, lat: float, km: float) -> bool:
    dx = (vert[:, 0] - lon) * 111.32 * np.cos(np.radians(lat))
    dy = (vert[:, 1] - lat) * 110.57
    return bool(((dx * dx + dy * dy).min()) <= km * km)


def ejecutar(estado: dict) -> dict:
    fichas = (leer_json(DATOS / "geo" / "rios_ana.json") or {}).get("rios", {})
    if not fichas:
        log("  sin geo/rios_ana.json (correr herramientas/build_hidro.py)")
        return {"estado": "sin_cambios"}
    of = leer_json(DATOS / "peru" / "oficial.json") or {}
    ana = {f"ANA|{e['estacion']}|{e['rio']}": e for e in (of.get("ana_rios") or {}).get("estaciones", [])}
    sen = {f"SENAMHI|{e['estacion']}": e for e in (of.get("phisis") or {}).get("estaciones", [])}
    # Estaciones del SENAMHI cuyo aviso es por descenso del nivel: no es crecida
    descenso = {norm_est(a["estacion"]) for a in (of.get("hidro") or {}).get("avisos", []) if "descenso" in str(a.get("titulo", "")).lower()}
    glo = {f"GloFAS|{r['id']}": r for r in (leer_json(DATOS / "rios" / "pronostico.json") or {}).get("rios", [])}
    pcs = (leer_json(DATOS / "peru" / "puntos_criticos.geojson") or {}).get("features", [])
    ems = (leer_json(DATOS / "peru" / "emergencias.geojson") or {}).get("features", [])
    vert = _vertices(leer_json(DATOS / "geo" / "rios_ana.geojson") or {})

    salida, conteo = {}, {k: 0 for k in ORDEN}
    for rid, f in fichas.items():
        estado_r, motivos, est = "sin_datos" if not f["estaciones"] else "normal", [], []
        nivel_bajo = False
        # Si la ANA tiene en este río una estación con umbrales de estiaje fuera de lo normal,
        # el aviso del SENAMHI en el mismo río también es por nivel bajo, no por crecida
        estiaje_rio = any(ana[k]["estiaje"] and ana[k]["estado"] != "normal" for k in f["estaciones"] if k in ana)
        def subir(nuevo, motivo):
            nonlocal estado_r
            motivos.append(motivo)
            if ORDEN[nuevo] > ORDEN[estado_r]:
                estado_r = nuevo
        for clave in f["estaciones"]:
            if clave in ana:
                e = ana[clave]
                est.append({"fuente": "ANA", "nombre": e["estacion"], "valor": e["valor"], "unidad": e["unidad"], "alerta": e["alerta"],
                            "emergencia": e["emergencia"], "tendencia": e["tendencia"], "estado": e["estado"], "estiaje": e["estiaje"], "hora": e.get("hora")})
                if e["estiaje"] and e["estado"] != "normal":
                    nivel_bajo = True
                elif e["estado"] == "emergencia":
                    subir("emergencia", f"{e['estacion']} sobre su umbral de emergencia (ANA)")
                elif e["estado"] == "alerta":
                    subir("alerta", f"{e['estacion']} sobre su umbral de alerta (ANA)")
            elif clave in sen:
                e = sen[clave]
                est.append({"fuente": "SENAMHI", "nombre": e["estacion"], "nivel": e["nivel"], "variable": e["variable"], "fecha": e["fecha"]})
                if e["nivel"] != "normal" and (norm_est(e["estacion"]) in descenso or estiaje_rio):
                    nivel_bajo = True
                    motivos.append(f"{e['estacion']} en {e['nivel']} por descenso del nivel (SENAMHI)")
                elif e["nivel"] in ("naranja", "rojo"):
                    subir("alerta", f"{e['estacion']} en {e['nivel']} (SENAMHI)")
                elif e["nivel"] == "amarillo":
                    subir("vigilancia", f"{e['estacion']} en amarillo (SENAMHI)")
            elif clave in glo:
                g = glo[clave]
                est.append({"fuente": "GloFAS", "nombre": g["lugar"], "id": g["id"], "hoy": g["hoy"], "pico": g["pico"],
                            "fecha_pico": g["fecha_pico"], "nivel": g["nivel"]})
                if g["nivel"] != "normal":
                    subir("vigilancia", f"crecida {g['nivel']} pronosticada en {g['lugar']} (GloFAS)")
        v = vert.get(rid)
        pc = [p["properties"] for p in pcs if v is not None and _cerca(v, *p["geometry"]["coordinates"], KM_PC)]
        em = [e["properties"] for e in ems if v is not None and _cerca(v, *e["geometry"]["coordinates"], KM_COEN)]
        conteo[estado_r] += 1
        if estado_r == "sin_datos" and not pc and not em and not nivel_bajo:
            continue                       # sin nada que seguir: el mapa lo dibuja gris sin entrada aquí
        avance = [p["avance"] for p in pc if isinstance(p.get("avance"), (int, float))]
        salida[rid] = {"estado": estado_r, "nivel_bajo": nivel_bajo, "motivos": motivos, "estaciones": est,
                       "obras": {"total": len(pc), "ejecutadas": sum(p.get("estado") == "Ejecutado" for p in pc),
                                 "en_ejecucion": sum(p.get("estado") == "En Ejecución" for p in pc),
                                 "avance_medio": round(sum(avance) / len(avance), 1) if avance else None,
                                 "personas": sum(int(p.get("pob") or 0) for p in pc)},
                       "emergencias": [{k: e.get(k) for k in ("fecha", "peligro", "lugar", "pdf")} for e in em][:8]}

    _historial(ana, salida)
    escribir_json(SALIDA, {"_": "Generado por productos/rios_monitoreo.py. Regla del estado en el encabezado del módulo.",
                           "actualizado": ahora_utc(), "conteo": conteo, "rios": salida}, compacto=True)
    log(f"  {len(fichas)} ríos: {conteo}; {sum(1 for r in salida.values() if r['obras']['total'])} con obras cerca")
    return {"estado": "ok", "ultimo_dato": hoy().isoformat()}


def _historial(ana: dict, salida: dict) -> None:
    """Agrega lo nuevo a los historiales, sin repetir lecturas."""
    HIST_EST.parent.mkdir(parents=True, exist_ok=True)
    vistas = set()
    if HIST_EST.exists():
        with HIST_EST.open(encoding="utf-8") as f:
            vistas = {(r["fecha_hora"], r["estacion"]) for r in csv.DictReader(f)}
    nuevas = []
    for clave, e in ana.items():
        if e.get("valor") is None:
            continue
        fh = f"{hoy().isoformat()} {e.get('hora') or '00:00'}"
        if (fh, clave) not in vistas:
            nuevas.append({"fecha_hora": fh, "estacion": clave, "valor": e["valor"], "alerta": e["alerta"], "emergencia": e["emergencia"]})
    if nuevas:
        nuevo = not HIST_EST.exists()
        with HIST_EST.open("a", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=["fecha_hora", "estacion", "valor", "alerta", "emergencia"], lineterminator="\n")
            if nuevo:
                w.writeheader()
            w.writerows(nuevas)
    # Estado del día por río: se reemplaza el de hoy en cada corrida
    filas = []
    if HIST_RIO.exists():
        with HIST_RIO.open(encoding="utf-8") as f:
            filas = [r for r in csv.DictReader(f) if r["fecha"] != hoy().isoformat()]
    filas += [{"fecha": hoy().isoformat(), "rio": k, "estado": v["estado"]} for k, v in salida.items() if v["estado"] != "sin_datos"]
    with HIST_RIO.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["fecha", "rio", "estado"], lineterminator="\n")
        w.writeheader()
        w.writerows(filas)
