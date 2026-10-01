# Decisiones técnicas

Registro de por qué las cosas están como están. Una entrada por decisión,
con fecha. Si cambias una de estas, agrega una entrada nueva en vez de
borrar la vieja.

---

### 2026-10-01 · Estructura en tres zonas: `sitio/`, `catalogo/`, `pipeline/`

**Qué:** `sitio/` es lo único que se publica; `sitio/datos/` lo escribe solo
el pipeline; `catalogo/` (YAML) es lo único que edita el equipo a mano.

**Por qué:** antes `data/` mezclaba archivos editados a mano con archivos
generados, y un cambio humano podía ser pisado por el pipeline. El catálogo
en YAML permite comentarios para quien no programa, y el pipeline lo valida
antes de publicar: un error de tipeo se detecta en vez de romper la página.

### 2026-10-01 · OISST: archivo anual de PSL, no OPeNDAP ni NCEI

**Qué:** se descarga `sst.day.anom.<año>.nc` de `downloads.psl.noaa.gov`
(~400 MB por año) y se guarda solo el promedio por caja en un CSV.

**Por qué:**
- Es el mismo producto que usa el notebook del equipo, así los números coinciden.
- La anomalía de PSL es respecto de **1991-2020**; la de NCEI/ERDDAP es
  respecto de 1971-2000. No se pueden mezclar.
- OPeNDAP de PSL se probó y no respondió en más de 7 minutos: no es confiable
  para una corrida diaria.
- Antes de descargar se consulta la fecha de modificación (`Last-Modified`):
  si NOAA no cambió el archivo, no se baja.
- Se revisan el año en curso y el anterior, porque NOAA reemplaza los datos
  preliminares por los definitivos unas dos semanas después.

### 2026-10-01 · Promedio por caja ponderado por coseno de la latitud

**Qué:** el índice de cada caja Niño pondera cada celda por cos(lat).

**Por qué:** es la práctica estándar (el área de una celda de 0,25° se achica
con la latitud). Dentro de ±10° la diferencia con el promedio simple del
notebook es de centésimas de °C.

### 2026-10-01 · Niño 4 desde 160°E

**Qué:** el recuadro Niño 4 del mapa iba de 160°W a 150°W (10° de ancho).
Se corrigió a 160°E a 150°W (50°), la definición del CPC. Las cajas se leen
de `catalogo/cajas_nino.yaml`, la misma fuente que usa el cálculo.

### 2026-10-01 · Orquestador en Python plano, sin Prefect

**Qué:** `pipeline/run.py` corre los pasos en orden, cada uno en su
`try/except`, y registra el resultado en `_meta.json`.

**Por qué:** con unas seis fuentes y una corrida diaria, Prefect agrega un
servidor, una base de datos y conceptos nuevos que dos personas no van a
mantener. GitHub Actions ya da programación, historial, reintentos manuales
y correo en caso de fallo.

### 2026-10-01 · Los datos generados se guardan en el repo

**Qué:** cada corrida hace commit de `sitio/datos/` si algo cambió.

**Por qué:** son pocos KB al día; el historial de git queda como archivo
auditable de qué se publicó y cuándo (útil para el campo `entradas` de los
análisis de IA), y si una fuente falla, el último dato bueno ya está en el
repo. Los rásters pesados de la Fase 2 **no** van al repo: van a Cloudflare R2.

### 2026-10-01 · Titular y colores de magnitud fuera de los datos

**Qué:** el titular de la portada se deduce de la anomalía Niño 1+2 (≥ +0,5:
"más caliente"; ≤ −0,5: "más frío"; si no, "cerca de lo normal"). Los colores
de las magnitudes del ENFEN pasaron de `estado.json` a `app.js`.

**Por qué:** el titular estaba escrito a mano y habría sido falso con La Niña.
Los colores son decisión de diseño, no dato: si los escribe el pipeline, el
equipo de datos pisa al de diseño.
