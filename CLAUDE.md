# CLAUDE.md · ENSO Perú

Plataforma pública de monitoreo de El Niño y La Niña para la toma de
decisiones en el Perú. Usuario final: **cualquier persona del país que pueda
verse afectada**. Equipo: Andrés Figueroa, Durand, Quintana, Mariano.

Antes de trabajar, leer `docs/HOJA_DE_RUTA.md` (qué se hizo y qué sigue) y
`docs/decisiones.md` (por qué las cosas están como están).

## Skills del proyecto (`.claude/skills/`)

| Skill | Cuándo |
|---|---|
| `ensoperu-diseno` | Cualquier cambio en `sitio/`: mapa, gráficos, colores, íconos, textos de interfaz |
| `ensoperu-datos` | Agregar o cambiar una fuente, un producto o una capa del pipeline |
| `ensoperu-decision` | Contenido para toma de decisiones: fichas de lugar, niveles de atención, antecedentes, estudios, textos de IA |

## Reglas que no se negocian

1. **No pronosticamos.** Mostramos lo que publican ENFEN, SENAMHI, IGP, NOAA,
   ECMWF y otros. La IA traduce, nunca estima.
2. **Cada número con su fecha y su fuente.** Si falta un dato, se dice "sin
   dato" o "pendiente"; nunca se inventa ni se rellena con demo sin marcarlo.
3. **Escala correcta.** Pronóstico estacional: región. Lluvia observada,
   impactos históricos, exposición: provincia o distrito. Lo dice la interfaz.
4. **El navegador no calcula.** Todo se prepara en `pipeline/` y se publica
   como archivos estáticos.
5. **Todo en español**, interfaz y comentarios. **Sin guion largo**.
6. **Sin paso de compilación** en el sitio: HTML, CSS y JS planos; librerías
   solo por CDN (MapLibre desde unpkg).
7. **Costo cero** por ahora: GitHub, Cloudflare R2 gratis, Open-Meteo, NASA
   FIRMS, OpenStreetMap, Gemini nivel gratuito.
8. **Citas obligatorias** en antecedentes y estudios. Si no hay referencia,
   no se publica.

## Comandos

```
python pipeline/run.py                 # todo
python pipeline/run.py --solo <pasos>  # algunos pasos
python pipeline/servir.py              # http://localhost:8000
python pipeline/herramientas/build_unidades.py   # regiones, provincias, distritos (manual)
python pipeline/herramientas/build_lugares.py    # presas, lagunas, glaciares (manual)
```

Entorno: conda `ensoperu` (Python 3.12, `requirements.txt`).

## Git

El bot `ensoperu-bot` comitea datos todos los días: antes de editar,
`git pull --rebase`. Commit y push solo cuando Andrés lo autoriza.
