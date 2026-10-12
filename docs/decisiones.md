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

### 2026-10-12 · RONI se lee de la tabla HTML del CPC

**Qué:** el CPC publica el ONI como texto plano, pero el RONI solo como
tabla HTML (`/products/analysis_monitoring/enso/roni/`). `fuentes/cpc.py`
quita las etiquetas y lee cada año seguido de sus 12 valores.

**Por qué:** no existe archivo de texto para el RONI. Si el CPC cambia la
tabla, la lectura falla de forma visible (menos de 100 valores) y la página
conserva el último CSV bueno.

### 2026-10-12 · ICEN desde el IGP, versión oficial

**Qué:** `http://met.igp.gob.pe/datos/ICEN.txt`, la versión que sigue la
Nota Técnica ENFEN 2024 (trimestre móvil de la anomalía ERSST en Niño 1+2).
Los otros archivos del IGP (ICEN_81_10, ICEN_91_20, ICENr) usan otras
climatologías y no se mezclan.

### 2026-10-12 · TSM costera por región: franja de 110 km

**Qué:** para cada departamento con litoral, la anomalía OISST se promedia
sobre las celdas marinas cuyo vértice de polígono más cercano pertenece a
ese departamento y está a menos de 1° (~110 km). Los vértices salen de
`sitio/datos/geo/litoral.json` (lo genera `herramientas/build_geo.py`).

**Por qué:** es simple, no necesita librerías geoespaciales y se puede
explicar en una frase. La anchura de 110 km cubre la plataforma y la zona de
pesca artesanal. Para los meses de pronóstico la capa queda sin dato hasta
que entre el pronóstico estacional: mejor "sin dato" que un valor inventado.

### 2026-10-12 · Campo de TSM como imagen en la misma proyección

**Qué:** `productos/mapa_tsm.py` dibuja el campo del último día (150°E a
65°W, 25°S a 15°N) con matplotlib, en la misma proyección Mercator de
`build_geo.py` y con la misma escala de colores de `app.js`. El navegador
solo coloca la imagen (`<image>`) en las coordenadas que indica
`campos/tsm_anom.json`.

**Por qué:** da un mapa real hoy, sin MapLibre ni servidor. Cuando llegue el
bloque 6 la misma imagen se puede servir como ráster georreferenciado.

### 2026-10-12 · Meses del selector generados, no escritos a mano

**Qué:** `catalogo/meses.yaml` solo indica el horizonte (6). El pipeline
genera "Ahora" más los próximos seis meses a partir del mes actual.

**Por qué:** la lista a mano quedaba vieja (en octubre todavía decía enero a
abril). El pronóstico estacional llega a 6 meses; no tiene sentido más.

**Peso en el repo:** la imagen pesa ~150 KB y cambia a diario, unos 50 MB
al año en el historial de git. Aceptable por ahora; si estorba, en el
bloque 13 los campos pasan a Cloudflare R2 y el repo guarda solo el JSON.

### 2026-10-12 · IA: piloto con GitHub Models, proveedor intercambiable

**Qué:** el generador de análisis (`productos/analisis_ia.py`) habla con el
modelo a través de `ia/proveedores.py`, donde cada proveedor es una clase
con `disponible()` y `generar()`. El piloto es GitHub Models
(`openai/gpt-4o-mini`), gratis en repos públicos con el propio
`GITHUB_TOKEN` del workflow (`permissions: models: read`). Gemini y Claude
ya están implementados; cambiar es editar `catalogo/ia.yaml` y poner la
clave en *Secrets*.

**Por qué:** el equipo decidió no gastar nada por ahora. GitHub Models no
exige cuenta ni tarjeta nueva y corre donde ya corre el pipeline. El
proveedor como pieza intercambiable evita atarse a uno.

### 2026-10-12 · Los textos de IA nacen en borrador

**Qué:** `ia.yaml: modo: borrador` escribe los análisis en
`sitio/datos/analisis/_borrador/`, carpeta que la página no lee. Cuando el
equipo revise los textos en GitHub, cambia a `modo: publicar`.

**Por qué:** es un servicio público; el primer lote de textos redactados por
un modelo lo tienen que leer meteorólogos antes de que lo vea la gente. La
validación automática (números presentes en las entradas, forma del JSON)
atrapa invenciones de cifras, no errores de criterio.

### 2026-10-12 · Un análisis por región y periodo, no por mes

**Qué:** se generan dos textos por región: "ahora" (observado) y
"temporada" (el periodo que cubre el ENFEN con sus probabilidades). El de
temporada se escribe en cada mes del selector.

**Por qué:** las entradas son las mismas para todos los meses futuros
(no hay pronóstico mensual todavía); generar 6 textos distintos con los
mismos datos sería inventar diferencias. Cuando entre el pronóstico
estacional por mes (bloque 5), cada mes tendrá sus propias entradas.
