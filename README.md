# ENSO Perú

Geoservidor de monitoreo de El Niño y sus impactos en el Perú.
Traduce lo que el ENFEN, el SENAMHI y los modelos globales ya publican a una
respuesta concreta por región y por actividad económica.

> **No es una fuente de pronóstico oficial.**
> El ENFEN y el SENAMHI son la autoridad en la materia. Toda decisión
> operativa debe apoyarse en sus comunicados.

---

## Estado del proyecto

Maqueta base navegable. Los datos son de demostración salvo donde se cita
explícitamente al ENFEN. La estructura de archivos y los contratos de datos ya
son los definitivos: conectar el pipeline consiste en **sobrescribir los JSON
de `data/`**, sin tocar el código.

---

## Puesta en marcha

No hay que instalar nada. No hay dependencias, ni compilación, ni `npm`.

```bash
git clone https://github.com/<usuario>/ensoperu.git
cd ensoperu
python3 -m http.server 8000
```

Abrir <http://localhost:8000>.

> **No abrir `index.html` con doble click.** El navegador bloquea la lectura de
> archivos locales y la página no cargará los datos. Si necesitas una versión
> que funcione así, genérala con `python3 pipeline/bundle.py` y usa
> `dist/index.html`.

---

## Publicación

1. Cuenta en Cloudflare (gratuita)
2. Pages → Connect to Git → elegir este repositorio
3. Build command: *vacío* · Output directory: `/`
4. Cada `git push` republica el sitio automáticamente

Costo: cero. Sin límite de tráfico.

---

## Estructura

```
ensoperu/
├─ index.html                       solo estructura
├─ assets/
│  ├─ styles.css                    sistema de diseño
│  └─ app.js                        carga de datos, mapa y panel
├─ data/                            ← todo lo que produce el pipeline
│  ├─ estado.json                   estado ENSO actual
│  ├─ config.json                   capas, meses y sectores
│  ├─ regiones.json                 zonificación y valores por región
│  ├─ series/sst.json               serie diaria de anomalía de TSM
│  ├─ geo/departamentos.json        geometrías pre-proyectadas
│  └─ analisis/
│     ├─ _plantillas.json           textos de respaldo por zona
│     └─ tumbes/2027-02.json        ejemplo del formato real
├─ pipeline/
│  ├─ build_geo.py                  GeoJSON → paths SVG proyectados
│  └─ bundle.py                     empaqueta todo en un HTML suelto
└─ README.md
```

**La regla que sostiene toda la arquitectura:
el navegador nunca calcula nada, solo lee archivos que el servidor ya preparó.**

Por eso el sitio es gratuito de operar, instantáneo, y no se cae aunque entren
miles de personas a la vez. Y por eso los dos equipos pueden avanzar en
paralelo: el de datos puede tardar lo que necesite mientras el de diseño
trabaja con los JSON de demostración.

---

## Contratos de datos

### `data/estado.json`
Estado ENSO actual. Lo alimenta el pipeline desde los comunicados del ENFEN y
los índices del CPC.

```json
{
  "actualizado": "2026-09-12",
  "estados": ["No activo", "Vigilancia", "Alerta de El Niño Costero", "Final del evento"],
  "alerta": "Alerta de El Niño Costero",
  "icen": 1.7, "roni": 1.2, "n12": 2.4, "n34": 1.1,
  "probs": [{ "m": "Fuerte", "p": 38, "c": "#D9452C" }],
  "comunicados": [{ "f": "29 ago 2026", "t": "..." }]
}
```

### `data/config.json`
Capas, meses y sectores disponibles. Agregar una capa aquí la hace aparecer
sola en el riel del mapa: no hay que tocar `app.js`.

### `data/regiones.json`
Zonificación (`z`), si tiene litoral (`c`) y valores por capa (`b`).
El `modificadorMes` es un artificio de la demo; el pipeline debe publicar el
valor real de cada mes.

### `data/series/sst.json`
Serie diaria de anomalía de TSM. Reemplazar por la salida del script de
monitoreo sobre NOAA OISST v2 High Resolution.

### `data/analisis/<region>/<mes>.json`
El archivo que produce la API de IA. **Este es el contrato más importante.**

```json
{
  "region": "Tumbes",
  "mes": "2027-02",
  "generado": "2026-09-12T06:00:00Z",
  "modelo": "claude-haiku-4-5",
  "entradas": {
    "tsm_anomalia": 3.3,
    "icen": 1.7,
    "probs_enfen": { "fuerte": 38, "extraordinario": 33 },
    "comunicado_enfen": "N° 13-2026",
    "analogos": ["1997-98", "2015-16"]
  },
  "sectores": { "pesca": ["párrafo 1", "párrafo 2"] },
  "antecedentes": "...",
  "fuentes": "..."
}
```

El campo **`entradas` es obligatorio**: guarda los valores exactos que recibió
el modelo. Sin eso el análisis no es auditable y no se publica. Si alguien
pregunta de dónde salió una afirmación, hay que poder abrir el JSON y
mostrarlo.

**Prioridad:** si existe `data/analisis/<region>/<mes>.json`, la página lo usa.
Si no existe, cae a `_plantillas.json`. Eso permite ir publicando región por
región sin romper nada.

El nombre de carpeta se obtiene del nombre de región en minúsculas, sin tildes
y con guiones: `Madre De Dios` → `madre-de-dios`.

---

## El mapa

Los 25 departamentos vienen pre-proyectados a paths SVG por
`pipeline/build_geo.py`: proyección Mercator sobre 176°W a 64°W, simplificación
Douglas-Peucker. La misma proyección sirve para la vista de Perú y para la del
Pacífico con los recuadros Niño 1+2, 3, 3.4 y 4; cambiar de vista solo cambia
el `viewBox`.

Se usa SVG plano en vez de MapLibre porque en esta fase no hay rásters que
mostrar, y así no hay dependencias ni tiempo de carga. Cuando entren los COG de
TSM y precipitación (Fase 2), la vista del mapa migra a MapLibre GL y el riel
de capas, el selector de meses y el panel lateral se reutilizan sin tocarlos.

Para regenerar las geometrías:

```bash
cd pipeline
curl -sLO https://raw.githubusercontent.com/juaneladio/peru-geojson/master/peru_departamental_simple.geojson
mv peru_departamental_simple.geojson peru_dep.geojson
python3 build_geo.py
```

Fuente: [juaneladio/peru-geojson](https://github.com/juaneladio/peru-geojson)

---

## Diseño

**Concepto: termoclina.** Toda la identidad sale de los dos polos térmicos que
definen el fenómeno.

| | |
|---|---|
| Frío `#1B6A87` | El teal de la corriente de Humboldt, el estado normal del mar peruano |
| Cálido `#D9452C` | La anomalía de El Niño. Cae en la misma familia que el rojo de la bandera: el rojo del país y el de la anomalía extrema resultan ser el mismo color |

La interfaz es clara, como la de un portal científico. **El mapa es la única
superficie oscura**, y eso separa visualmente el dato de la herramienta, además
de permitir que la escala de anomalías (que tiene blanco en el valor neutro) se
lea bien.

Azules y rojos están reservados **exclusivamente** para la escala de anomalías.
Nunca se usan como decoración.

Tipografía: IBM Plex Serif y IBM Plex Sans, una familia diseñada para producto
técnico.

Diseño mobile first: en pantallas angostas el panel de región sube desde abajo
como hoja deslizable y el riel de capas se vuelve una franja horizontal.

---

## Cómo agregar cosas

| Quiero… | Toco… |
|---|---|
| Una capa temática nueva | `data/config.json` → `capas` |
| Otro mes de pronóstico | `data/config.json` → `meses` |
| Otro sector económico | `data/config.json` → `sectores` y las plantillas |
| Cambiar textos de una región | crear `data/analisis/<region>/<mes>.json` |
| Cambiar colores o tipografía | `assets/styles.css` → `:root` |
| Cambiar la geometría | `pipeline/build_geo.py` |

---

## Pendientes

- [ ] Pipeline de ingesta (OISST, ENFEN, CHIRPS)
- [ ] Generación de análisis con API de IA
- [ ] PWA: `manifest.json` y service worker
- [ ] Capas ráster con MapLibre y COG
- [ ] Ríos, embalses y estaciones como capa de puntos
- [ ] Búsqueda de región por nombre
- [ ] Comparación entre dos meses
- [ ] Métricas de uso (Umami autohospedado)

---

## Equipo

Cuatro meteorólogos peruanos. Proyecto académico, abierto y sin fines de lucro.

## Licencia

Por definir. Propuesta: MIT para el código, CC BY 4.0 para el contenido.
