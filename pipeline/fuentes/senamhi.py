"""
Fuente: avisos meteorológicos del SENAMHI (oficiales).
    https://www.senamhi.gob.pe/?p=aviso-meteorologico

Lee la tabla de avisos y el detalle de cada uno, y publica los vigentes o por
empezar en sitio/datos/senamhi/avisos.json. Con el texto de cada aviso se
deducen las zonas que menciona (costa norte, sierra sur...), para que la ficha
de cada región muestre los suyos. Es una lectura del texto: el mapa y el
detalle oficial están en el enlace de cada aviso.

Puede no responder fuera del Perú: si falla la red se conserva lo último, salvo
que tenga más de DIAS_MAX días.
"""
from __future__ import annotations

import datetime as dt
import html
import re

import requests

from comun import DATOS, ErrorFuente, ErrorValidacion, ahora_utc, escribir_json, hoy, leer_catalogo, leer_json, log

URL = "https://www.senamhi.gob.pe/?p=aviso-meteorologico"
BASE = "https://www.senamhi.gob.pe/"
SALIDA = DATOS / "senamhi" / "avisos.json"
UA = {"User-Agent": "Mozilla/5.0 (ensoperu; datos publicos)"}
DIAS_MAX = 3
NIVELES = {"AMARILLO": 2, "NARANJA": 3, "ROJO": 4}


def _texto(s: str) -> str:
    s = re.sub(r"<!--.*?-->", " ", s, flags=re.S)
    s = re.sub(r"<script.*?</script>|<style.*?</style>", " ", s, flags=re.S)
    s = re.sub(r"<[^>]+>", " ", s)
    return re.sub(r"\s+", " ", html.unescape(s)).strip()


def leer_tabla(h: str) -> list[dict]:
    filas = []
    for tr in re.findall(r"<tr>(.*?)</tr>", h, flags=re.S):
        tds = re.findall(r"<td[^>]*>(.*?)</td>", tr, flags=re.S)
        if len(tds) < 7:
            continue
        num = re.search(r"(\d+)\s*\((\w+)\)", _texto(tds[1]))
        fechas = [_texto(tds[i]) for i in (2, 3, 4)]
        nivel = _texto(tds[6]).upper()
        if not num or nivel not in NIVELES or not all(re.fullmatch(r"\d{4}-\d\d-\d\d", f) for f in fechas):
            continue
        enlace = re.search(r'href="([^"]+)"', tds[0])
        filas.append({"numero": int(num.group(1)), "situacion": num.group(2).lower(),
                      "titulo": _texto(tds[0]), "emitido": fechas[0], "inicio": fechas[1], "fin": fechas[2],
                      "nivel": nivel, "enlace": BASE + html.unescape(enlace.group(1)).lstrip("./") if enlace else URL})
    return filas


ZONAS = {  # palabra en el texto -> zonas de catalogo/regiones.yaml
    "costa norte": ["Costa norte"], "costa centro": ["Costa centro"], "costa sur": ["Costa sur"],
    "sierra norte": ["Sierra norte"], "sierra centro": ["Sierra centro"], "sierra sur": ["Sierra sur"],
    "selva norte": ["Selva norte"], "selva centro": [], "selva sur": ["Selva sur"],
    "costa": ["Costa norte", "Costa centro", "Costa sur"],
    "sierra": ["Sierra norte", "Sierra centro", "Sierra sur"],
    "selva": ["Selva norte", "Selva sur"],
}


def zonas_de(titulo: str, cuerpo: str) -> tuple[list[str], list[str]]:
    """Zonas nombradas y regiones nombradas en el título y el texto del aviso."""
    t = (titulo + " " + cuerpo).lower()
    # "costa centro y sur" -> "costa centro y costa sur", para que se reconozcan las dos
    t = re.sub(r"\b(costa|sierra|selva) (norte|centro|sur) y (norte|centro|sur)\b", r"\1 \2 y \1 \3", t)
    zonas = set()
    for clave, valor in ZONAS.items():
        if re.search(rf"\b{clave}\b", t):
            zonas.update(valor)
    # si nombra una parte (costa norte) no cuenta la genérica "costa" del título
    for gen in ("costa", "sierra", "selva"):
        partes = [z for z in ZONAS if z.startswith(gen + " ") and re.search(rf"\b{z}\b", t)]
        if partes:
            zonas -= set(ZONAS[gen]) - {v for z in partes for v in ZONAS[z]}
    regiones = [n for n in leer_catalogo("regiones") if re.search(rf"\b{re.escape(n.lower())}\b", t)]
    # La selva central no es una zona del catálogo: son Ucayali y la vertiente oriental de Huánuco, Pasco y Junín
    if re.search(r"\bselva centr", t):
        regiones = sorted(set(regiones) | {"Ucayali", "Huanuco", "Pasco", "Junin"})
    return sorted(zonas), regiones


def ejecutar(estado: dict) -> dict:
    previo = leer_json(SALIDA)
    try:
        r = requests.get(URL, headers=UA, timeout=60)
        r.raise_for_status()
        filas = leer_tabla(r.text)
    except requests.RequestException as e:
        if previo:
            dias = (dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(previo["leido"].replace("Z", "+00:00"))).days
            if dias > DIAS_MAX:
                raise ErrorFuente(f"SENAMHI no responde desde este equipo y los avisos guardados tienen {dias} días") from e
            log("  SENAMHI no responde; se conservan los avisos guardados")
            return {"estado": "sin_cambios", "aviso": "SENAMHI sin respuesta desde este equipo"}
        raise ErrorFuente(f"SENAMHI no responde: {e}") from e
    if not filas:
        raise ErrorValidacion("SENAMHI: no pude leer la tabla de avisos; ¿cambió el formato?")

    activos = [f for f in filas if f["fin"] >= hoy().isoformat()]
    activos.sort(key=lambda f: (-NIVELES[f["nivel"]], f["inicio"]))
    # Detalle: una sola página trae el texto de todos los avisos vigentes
    detalle = ""
    if activos:
        try:
            d = requests.get(activos[0]["enlace"], headers=UA, timeout=60)
            detalle = _texto(d.text) if d.ok else ""
        except requests.RequestException:
            detalle = ""
    for a in activos:
        m = re.search(rf"{re.escape(a['titulo'])}.{{0,300}}?(El SENAMHI informa.*?)(?=Aviso N|\d\d de [A-Z][a-z]+ \d\d de|$)", detalle)
        cuerpo = m.group(1).strip()[:900] if m else ""
        a["texto"] = cuerpo
        a["zonas"], a["regiones"] = zonas_de(a["titulo"], cuerpo)

    escribir_json(SALIDA, {"_": "Generado por pipeline/fuentes/senamhi.py. Avisos oficiales vigentes o por empezar.",
                           "fuente": "SENAMHI, avisos meteorológicos", "url": URL, "leido": ahora_utc(), "avisos": activos})
    rojos = sum(a["nivel"] == "ROJO" for a in activos)
    log(f"  {len(activos)} avisos activos, {rojos} en rojo")
    return {"estado": "ok", "ultimo_dato": hoy().isoformat(), "avisos": len(activos), "rojos": rojos,
            "fuente": "SENAMHI, avisos meteorológicos"}
