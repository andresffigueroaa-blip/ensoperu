# ENSO Perú

Monitoreo de El Niño y sus impactos en el Perú. Traduce lo que el ENFEN, el
SENAMHI, el IMARPE y los modelos globales ya publican a una respuesta concreta
por región y por actividad económica.

> **No es una fuente de pronóstico oficial.** El ENFEN y el SENAMHI son la
> autoridad en la materia. Toda decisión operativa debe apoyarse en sus
> comunicados.

Sitio: <https://andresffigueroaa-blip.github.io/ensoperu/>

---

## La idea en una línea

**El navegador nunca calcula nada: solo lee archivos que el pipeline ya
preparó.** Por eso el sitio es gratis de operar, instantáneo, y no se cae
aunque entren miles de personas a la vez.

## Las tres máquinas

```
  ┌────────────────────────┐     ┌────────────────────────┐     ┌──────────────────────┐
  │  GitHub Actions        │     │  Laptop                │     │  Servidor (Fase 2)   │
  │  todos los días 06:00  │     │  pruebas y corrida     │     │  lo pesado: GFS,     │
  │  + botón "Run workflow"│     │  manual                │     │  ECMWF, ERA5, COG    │
  └──────────┬─────────────┘     └──────────┬─────────────┘     └──────────┬───────────┘
             │  python pipeline/run.py      │  el mismo comando            │  servidor/
             ▼                              ▼                              ▼
     sitio/datos/*.json  ───────────────────────────────►  GitHub Pages     Cloudflare R2
     (en el repo, auditables)                               (la página)     (rásters grandes)
```

| Carpeta | Quién la toca | Qué hay |
|---|---|---|
| `sitio/` | equipo de diseño | lo único que se publica: `index.html`, `assets/` |
| `sitio/datos/` | **solo el pipeline** | JSON y CSV que lee la página; nadie los edita a mano |
| `catalogo/` | cualquiera del equipo | regiones, capas, meses, sectores, textos, ENFEN manual (YAML con comentarios) |
| `pipeline/` | equipo de datos | descarga, cálculo, validación; corre en Actions y en la laptop |
| `servidor/` | equipo de datos | Fase 2: productos pesados que no caben en Actions (aún sin implementar) |
| `.github/workflows/` | equipo de datos | la corrida diaria y la publicación |

---

## Puesta en marcha (laptop)

Una vez:

```bash
git clone https://github.com/andresffigueroaa-blip/ensoperu.git
cd ensoperu
conda create -n ensoperu python=3.12        # o: python -m venv .venv
conda activate ensoperu
pip install -r requirements.txt
```

Cada vez:

```bash
python pipeline/run.py        # actualiza todos los datos (≈ make update)
python pipeline/servir.py     # abre http://localhost:8000  (≈ make serve)
```

`make update` y `make serve` hacen lo mismo si tienes `make`. En Windows con
Git Bash normalmente no está: usa los comandos de `python` directamente.

Otros comandos útiles:

```bash
python pipeline/run.py --lista                        # qué pasos hay
python pipeline/run.py --solo oisst,serie_tsm         # solo algunos pasos
python pipeline/run.py --solo oisst --historico 1997,1998   # reprocesar años
python pipeline/herramientas/bundle.py                # página en un solo archivo: dist/index.html
```

> **No abrir `sitio/index.html` con doble click.** El navegador bloquea la
> lectura de archivos locales. Usa `servir.py` o el archivo de `bundle.py`.

---

## Publicación automática (GitHub Actions)

El workflow `.github/workflows/publicar.yml` corre:

- **solo**, todos los días a las 06:00 de Lima;
- **con un botón**: pestaña *Actions* → *Actualizar y publicar* → *Run workflow*;
- en cada `push` a `main`.

Hace lo mismo que la laptop: corre `pipeline/run.py`, guarda en el repo los
JSON que cambiaron (el historial de git queda como archivo auditable) y
publica `sitio/` en GitHub Pages.

**Si una fuente falla**, la página se publica igual con el último dato bueno, el
bloque *Estado de los datos* de la portada lo dice, y la corrida termina en rojo:
GitHub manda un correo a quien configuró el workflow.

### Configuración inicial (una sola vez, en GitHub)

1. *Settings* → *Pages* → *Source*: **GitHub Actions**.
2. *Settings* → *Notifications* (de tu cuenta) → *Actions*: activar correo para
   corridas fallidas.
3. Solo para la Fase 4 (IA): *Settings* → *Secrets and variables* → *Actions* →
   `ANTHROPIC_API_KEY`.

> GitHub desactiva los workflows programados de repos públicos tras 60 días
> sin actividad. Los commits diarios del bot lo mantienen activo; si se
> desactiva, basta con apretar *Enable workflow*.

---

## Cómo agregar cosas (sin tocar código)

| Quiero… | Edito… |
|---|---|
| Una región nueva o cambiar su zona | `catalogo/regiones.yaml` |
| Una capa temática | `catalogo/capas.yaml` |
| Otro mes de pronóstico | `catalogo/meses.yaml` |
| Otro sector económico | `catalogo/sectores.yaml` y `catalogo/plantillas.yaml` |
| Textos de respaldo o antecedentes | `catalogo/plantillas.yaml` |
| Cargar un comunicado nuevo del ENFEN | `catalogo/enfen.yaml` |
| Cambiar los años análogos | `catalogo/analogos.yaml` |
| Colores o tipografía | `sitio/assets/styles.css` → `:root` |

Después de editar, `python pipeline/run.py --solo catalogo` (o un `push`, y
Actions lo hace). Si el YAML tiene un error, el pipeline dice en qué archivo y
qué está mal, y **no publica** el cambio.

## Cómo agregar una fuente de datos (con código)

1. Crear `pipeline/fuentes/<fuente>.py` con una función
   `ejecutar(estado_previo) -> dict`. Si algo sale mal, lanzar `ErrorFuente`
   (o `ErrorValidacion` si el dato llegó pero no es creíble).
2. Sumarla a `PASOS` en `pipeline/run.py`.
3. Validar antes de escribir. Nunca escribir un JSON que no pasó la validación.

Ver `pipeline/fuentes/oisst.py` como ejemplo completo.

---

## Contratos de datos

Todos viven en `sitio/datos/` y los escribe el pipeline.

| Archivo | Lo escribe | Contenido |
|---|---|---|
| `_meta.json` | `run.py` | estado de cada paso: `ok` / `sin_cambios` / `fallo`, fecha del último dato, error |
| `estado.json` | `productos/estado.py` | alerta ENFEN, índices (cada uno con `valor`, `fecha`, `fuente`), probabilidades, comunicados |
| `indices/oisst_diario.csv` | `fuentes/oisst.py` | anomalía diaria en Niño 1+2, 3, 3.4 y 4 desde 1981 (datos abiertos) |
| `series/tsm.json` | `productos/serie_tsm.py` | evento actual y análogos alineados, Niño 1+2 y 3.4 |
| `config.json`, `regiones.json`, `analisis/_plantillas.json` | `productos/catalogo.py` | traducción del catálogo |
| `geo/departamentos.json` | `herramientas/build_geo.py` | geometrías pre-proyectadas (se corre a mano) |
| `analisis/<region>/<mes>.json` | generador de IA (Fase 4) | lectura por sector, con `entradas` obligatorio |

### `analisis/<region>/<mes>.json`: el contrato más importante

```json
{
  "region": "Tumbes",
  "mes": "2027-02",
  "generado": "2026-09-12T06:00:00Z",
  "modelo": "claude-haiku-4-5",
  "entradas": { "tsm_anomalia": 3.3, "icen": 1.7, "probs_enfen": { "fuerte": 38 } },
  "sectores": { "pesca": ["párrafo 1", "párrafo 2"] },
  "antecedentes": "...",
  "fuentes": "..."
}
```

`entradas` es **obligatorio**: guarda los valores exactos que recibió el
modelo. Sin eso el análisis no es auditable y no se publica. Si existe el
archivo, la página lo usa; si no, cae a las plantillas. Slug de carpeta:
minúsculas, sin tildes, con guiones (`Madre De Dios` → `madre-de-dios`).

---

## Diseño

**Concepto: termoclina.** Toda la identidad sale de los dos polos térmicos del
fenómeno: frío `#1B6A87` (Humboldt) y cálido `#D9452C` (la anomalía, de la
misma familia que el rojo de la bandera). La interfaz es clara; **el mapa es la
única superficie oscura**. Azules y rojos se reservan **solo** para la escala de
anomalías. Tipografía IBM Plex Serif y Sans. Mobile first.

## Decisiones técnicas

Ver [`docs/decisiones.md`](docs/decisiones.md): por qué OISST de PSL y no de
NCEI, por qué no Prefect, por qué los datos van al repo, etc.

## Equipo y licencia

Cuatro meteorólogos peruanos. Proyecto académico, abierto y sin fines de lucro.
Licencia por definir (propuesta: MIT para el código, CC BY 4.0 para contenido y datos).
