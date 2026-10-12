"""
Proveedores de IA, intercambiables desde catalogo/ia.yaml.

Todos exponen lo mismo:
    proveedor = crear(cfg)            # cfg = catalogo/ia.yaml
    proveedor.disponible()            # hay clave y se puede llamar
    proveedor.generar(sistema, usuario) -> str   # texto JSON crudo
    proveedor.nombre                  # "github:openai/gpt-4o-mini"

Para agregar uno nuevo: una clase con esos tres miembros y una línea en
PROVEEDORES. El resto del pipeline no cambia.

Ninguno pronostica nada: reciben un prompt con datos ya calculados y
devuelven texto. La validación de ese texto está en productos/analisis_ia.py.
"""
from __future__ import annotations

import json
import os

import requests

from comun import ErrorFuente


class _Base:
    clave_env = ""

    def __init__(self, cfg: dict):
        self.modelo = cfg["modelo"]
        self.temperatura = float(cfg.get("temperatura", 0.3))
        self.clave = os.environ.get(self.clave_env, "")

    @property
    def nombre(self) -> str:
        return f"{self.id}:{self.modelo}"

    def disponible(self) -> bool:
        return bool(self.clave)

    def _post(self, url: str, cabeceras: dict, cuerpo: dict) -> dict:
        try:
            r = requests.post(url, headers=cabeceras, json=cuerpo, timeout=120)
        except requests.RequestException as e:
            raise ErrorFuente(f"{self.nombre}: sin respuesta ({e})") from e
        if r.status_code == 429:
            raise ErrorFuente(f"{self.nombre}: límite de uso alcanzado (429); se sigue mañana")
        if r.status_code >= 400:
            raise ErrorFuente(f"{self.nombre}: error {r.status_code}: {r.text[:300]}")
        try:
            return r.json()
        except ValueError as e:
            # Respuesta 2xx que no es JSON (página HTML, cuerpo vacío): se
            # reporta el inicio del cuerpo para poder diagnosticar
            raise ErrorFuente(f"{self.nombre}: respuesta {r.status_code} no es JSON "
                              f"({r.headers.get('content-type', '?')}): {r.text[:200]!r}") from e


class GithubModels(_Base):
    """GitHub Models: gratis en repos públicos. En Actions el token es
    GITHUB_TOKEN con permiso `models: read`; en una laptop, un token
    personal (fine-grained) con ese mismo permiso."""
    id = "github"
    clave_env = "GITHUB_TOKEN"
    URL = "https://models.github.ai/inference/chat/completions"

    def generar(self, sistema: str, usuario: str) -> str:
        datos = self._post(self.URL, {
            "Authorization": f"Bearer {self.clave}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }, {
            "model": self.modelo,
            "temperature": self.temperatura,
            "response_format": {"type": "json_object"},
            "messages": [{"role": "system", "content": sistema},
                         {"role": "user", "content": usuario}],
        })
        try:
            return datos["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as e:
            raise ErrorFuente(f"{self.nombre}: respuesta con forma inesperada") from e


class Gemini(_Base):
    """Google Gemini, nivel gratuito con clave de Google AI Studio."""
    id = "gemini"
    clave_env = "GEMINI_API_KEY"
    URL = "https://generativelanguage.googleapis.com/v1beta/models/{modelo}:generateContent"

    def generar(self, sistema: str, usuario: str) -> str:
        datos = self._post(self.URL.format(modelo=self.modelo), {
            "x-goog-api-key": self.clave,
        }, {
            "system_instruction": {"parts": [{"text": sistema}]},
            "contents": [{"parts": [{"text": usuario}]}],
            "generationConfig": {"temperature": self.temperatura,
                                 "responseMimeType": "application/json"},
        })
        try:
            return datos["candidates"][0]["content"]["parts"][0]["text"]
        except (KeyError, IndexError, TypeError) as e:
            raise ErrorFuente(f"{self.nombre}: respuesta con forma inesperada") from e


class Claude(_Base):
    """Anthropic Claude, de pago. Usa el SDK oficial (pip install anthropic)."""
    id = "claude"
    clave_env = "ANTHROPIC_API_KEY"

    def generar(self, sistema: str, usuario: str) -> str:
        try:
            import anthropic
        except ImportError as e:
            raise ErrorFuente("falta el paquete 'anthropic' (pip install anthropic)") from e
        cliente = anthropic.Anthropic(api_key=self.clave)
        try:
            resp = cliente.messages.create(
                model=self.modelo, max_tokens=4096, temperature=self.temperatura,
                system=sistema, messages=[{"role": "user", "content": usuario}])
        except anthropic.RateLimitError as e:
            raise ErrorFuente(f"{self.nombre}: límite de uso alcanzado; se sigue mañana") from e
        except anthropic.APIError as e:
            raise ErrorFuente(f"{self.nombre}: {e}") from e
        return "".join(b.text for b in resp.content if b.type == "text")


class Simulado(_Base):
    """Sin red ni clave: devuelve párrafos armados con las propias entradas.
    Sirve para probar el flujo completo (archivos, huellas, validación)."""
    id = "simulado"

    def disponible(self) -> bool:
        return True

    def generar(self, sistema: str, usuario: str) -> str:
        e = json.loads(usuario.split("ENTRADAS:", 1)[1].split("SECTORES", 1)[0])
        sectores = usuario.rsplit("SECTORES A REDACTAR:", 1)[1].split()[0].split(",")
        probs = ", ".join(f"{k} {v} %" for k, v in e.get("probabilidades", {}).get("valores", {}).items())
        n12 = e.get("indices", {}).get("n12", {}).get("valor")
        p1 = (f"Texto simulado para {e['region']} ({e['periodo']}). La anomalía Niño 1+2 es de "
              f"{n12} °C y el ENFEN mantiene el estado {e['alerta']['estado']}.")
        p2 = f"Probabilidades del ENFEN para el {e['probabilidades']['periodo']}: {probs}. Son probabilidades, no certezas."
        return json.dumps({"resumen": f"Simulación para {e['region']}.",
                           "sectores": {s: [p1, p2] for s in sectores}}, ensure_ascii=False)


PROVEEDORES = {c.id: c for c in (GithubModels, Gemini, Claude, Simulado)}


def crear(cfg: dict) -> _Base:
    nombre = cfg.get("proveedor", "github")
    if nombre not in PROVEEDORES:
        raise ErrorFuente(f"ia.yaml: proveedor '{nombre}' no existe; válidos: {sorted(PROVEEDORES)}")
    return PROVEEDORES[nombre](cfg)
