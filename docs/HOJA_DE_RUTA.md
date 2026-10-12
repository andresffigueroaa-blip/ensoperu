# Hoja de ruta · ENSO Perú

Documento vivo. Se actualiza al cerrar cada tarea. Si algo no está aquí, no
está planificado.

**Última actualización:** 12 oct 2026 · **Bloques cerrados:** 1 y 2 · **En curso:** 3

Leyenda: ✅ hecho · 🔄 en curso · ⬜ pendiente · ⏸️ bloqueado (ver "Necesita")

---

## Para quién es

**Toda persona en el Perú que pueda verse afectada por El Niño o La Niña.**
Eso fija cinco requisitos que valen para todos los bloques:

1. **Lenguaje simple.** Un pescador de Paita o una agricultora de Puno
   deben entender la lectura sin saber qué es una anomalía.
2. **Mi lugar primero.** Cualquiera debe encontrar su provincia, su río o su
   puerto en menos de 30 segundos (buscador y geolocalización).
3. **Celular y mala señal.** Liviana, que funcione con 3G y sin conexión
   (PWA con caché).
4. **Honestidad.** Cada número con su fecha y su fuente. Nunca un pronóstico
   propio: mostramos lo que dicen el ENFEN, el SENAMHI y los modelos.
5. **Escala correcta.** Un dato solo se muestra a la escala que aguanta (un
   modelo de 100 km no se pinta por distrito; la escala fina es la provincia).

---

## Estado por bloque

### ✅ Bloque 1 · Estructura del repositorio
- ✅ Carpetas `sitio/`, `catalogo/`, `pipeline/`, `servidor/`
- ✅ Catálogo editable en YAML con validación
- ✅ Errores previos corregidos: mapa sin colores, desborde en celular, Niño 4, signo
- ✅ README y `docs/decisiones.md`

### ✅ Bloque 2 · Serie de TSM de punta a punta
- ✅ OISST diario (NOAA PSL, climatología 1991-2020) para Niño 1+2, 3, 3.4 y 4
- ✅ Histórico de años análogos (1982-83, 1997-98, 2015-16, 2023-24)
- ✅ Curva de portada con análogos y selector 1+2 / 3.4
- ✅ GitHub Actions: diario 06:00 Lima, botón manual, correo si falla
- ✅ Publicado en `andresffigueroaa-blip.github.io/ensoperu`; corre solo desde el 1 oct 2026
- ⬜ Histórico completo 1981-2025 (opcional; botón *Run workflow*, campo `historico: 1981-2025`)

### 🔄 Bloque 3 · Índices oficiales y primer mapa real
- ✅ ONI y RONI (NOAA CPC) en `indices/cpc_mensual.csv`
- ✅ ICEN (IGP, versión oficial Nota Técnica ENFEN 2024) en `indices/icen.csv`
- ✅ TSM costera por región litoral desde OISST (franja a menos de 110 km del litoral); reemplaza el valor demo de la capa "Temperatura del mar"
- ✅ Campo diario de anomalía de TSM dibujado bajo el mapa (vista Perú y Pacífico)
- ✅ Meses del selector generados por el pipeline (siempre los próximos 6)
- 🔄 Pruebas, capturas y publicación
- ⬜ Pronóstico de TSM a 10 días (Copernicus Marine, ya usado en el notebook)
- **Necesita:** cuenta de Copernicus Marine para el último punto

### ⬜ Bloque 4 · Inteligencia artificial (Claude Haiku 4.5)
- ⬜ Lectura automática de los comunicados PDF del ENFEN (alerta, probabilidades, texto)
- ⬜ Análisis por región y sector, con `entradas` obligatorio y validación de números
- ⬜ Regenerar solo cuando cambian las entradas (costo estimado: 4 a 7 soles/mes)
- ⬜ Boletín automático "qué cambió" (estilo ENSO Outlook de IWMI) y tarjeta para redes
- ⬜ Ilustraciones en los textos al hacer clic en una unidad o capa
- ⬜ Asistente de consultas sobre capas y unidades: solo con respuestas pregeneradas o con límite diario; se evalúa después de lo anterior
- **Necesita:** clave `ANTHROPIC_API_KEY` en GitHub (USD 5 de carga inicial); enlace a los comunicados del ENFEN

### ⬜ Bloque 5 · Pronóstico estacional
- ⬜ Copernicus C3S multimodelo: lluvia y temperatura por tercios, 1 a 6 meses, grillado tipo ENSO Outlook
- ⬜ Plumas de Niño 3.4 y 1+2 (IRI, NMME, C3S)
- ⬜ Vista **Pronóstico** en la página
- ⬜ Revisar WeatherNext 2 (Google): qué entrega y si es de acceso libre
- **Necesita:** cuenta de Copernicus CDS (gratuita)

### ⬜ Bloque 6 · Mapa por unidades
- ⬜ Migración a MapLibre + PMTiles (sigue sin servidor y sin compilación)
- ⬜ Capas: región, **provincia** y cuenca (ANA)
- ⬜ Puntos: lagos, glaciares, embalses, ciudades y centros poblados
- ⬜ Datos grillados (mapas continuos) además de valores por unidad
- ⬜ Buscador por nombre y botón "mi ubicación"
- **Necesita:** bases de datos de límites y unidades (Durand y Quintana)

### ⬜ Bloque 7 · Variables observadas y normal climática
- ⬜ Monitoreo de lluvia (CHIRPS, PISCO), SPI 1-3-6 y temperatura, por provincia y cuenca
- ⬜ Humedad del suelo, escorrentía, humedad del aire y vientos (ERA5-Land, GLDAS; por evaluar)
- ⬜ Normal climática de lluvia, temperatura, humedad del suelo y caudal, comparada con Niños anteriores
- ⬜ Carga de datos históricos propios

### ⬜ Bloque 8 · Caudales
- ⬜ Pronóstico de inundaciones GloFAS (Copernicus) por tramo de río
- ⬜ Modelo estadístico simple lluvia a caudal (regresión), con metodología publicada
- **Necesita:** metodología (Mariano); estaciones con caudal confiable (SENAMHI, ANA)

### ⬜ Bloque 9 · Riesgo, exposición e impactos
- ⬜ Riesgo: inundaciones, deslizamientos y olas de calor (CENEPRED, INDECI)
- ⬜ Índices de estrés hídrico y riesgo hídrico por cuenca (Aqueduct, WRI)
- ⬜ Agricultura y ganadería: cultivos y zonas más afectadas, con fuente
- ⬜ Población por provincia (INEI)

### ⬜ Bloque 10 · Antecedentes por lugar
- ⬜ Para cada unidad: qué pasó aquí en 1982-83, 1997-98, 2017 y 2023
- ⬜ `catalogo/antecedentes/` con **cita bibliográfica obligatoria**
- ⬜ Lugares sensibles a ENSO (embalses, quebradas, puertos, ciudades) con su fuente
- **Necesita:** recopilación del equipo (10 a 15 lugares citados para empezar)

### ⬜ Bloque 11 · Portada, boletines y experiencia
- ⬜ Portada al estilo ENSO Outlook (IWMI)
- ⬜ Dashboard simple comparativo (dos meses, dos eventos, dos lugares)
- ⬜ Modo claro y oscuro
- ⬜ PWA: instalable y sin conexión
- ⬜ Vista **Monitoreo** con series 1950-hoy (ONI, ICEN) y 1981-hoy (OISST)
- ⬜ Accesibilidad y revisión de lenguaje con usuarios reales
- ⬜ Dominio `ensoperu.pe`

### ⬜ Bloque 12 · Noticias y biblioteca
- ⬜ Noticias nacionales e internacionales sobre El Niño y clima (fuentes por definir)
- ⬜ Zona de guardados por tema
- **Necesita:** lista de fuentes de monitoreo y noticias (Andrés)

### ⬜ Bloque 13 · Servidor propio (Fase 2)
- ⬜ Subestacional semanas 1 a 4 (IRI, ECMWF S2S, GEFS)
- ⬜ Rásters COG publicados en Cloudflare R2
- ⬜ ERA5 y archivo histórico
- ⬜ Más adelante: modelos de IA con GPU

**Para después:** proyecciones climáticas, sección breve.

---

## Tareas del equipo

| Tarea | Responsable | Bloque |
|---|---|---|
| Actualizar la página con capas y variables nuevas | Andrés Figueroa | 3 en adelante |
| Buscar fuentes de monitoreo nacionales e internacionales (SENAMHI, ENFEN, CIIFEN, NOAA…) y fuentes de noticias | Andrés Figueroa | 12 |
| Revisar bases de datos para las capas (límites, cuencas, embalses, centros poblados…) | Durand y Quintana | 6 |
| Metodología del modelo estadístico lluvia a caudal (partir de regresión lineal, con respaldo publicado) | Mariano | 8 |
| Confirmar si los 3 comunicados de la portada son reales | Andrés | ya |
| Clave de Anthropic en GitHub Secrets | Andrés | 4 |
| Cuenta de Copernicus (CDS y Marine) | Andrés | 3 y 5 |

**Tareas disponibles (sin responsable):**
- Antecedentes de 1997-98 y 2017 por región, con referencia bibliográfica (bloque 10)
- Lista de lugares sensibles a El Niño, cada uno con su fuente (bloque 10)
- Cultivos y zonas ganaderas más afectados, con fuente (bloque 9)
- Revisar GloFAS, ENSO Outlook (IWMI), IRI y ECMWF S2S: qué ofrecen y en qué formato (bloques 5, 8, 13)
- Revisar WeatherNext 2 (bloque 5)
- Revisar los índices de Aqueduct (WRI) para el Perú (bloque 9)

---

## Inventario de datos

Columna **Escala** = la más fina a la que el dato es válido.

### Océano y ENSO
| Dato | Fuente | Escala | Frecuencia | Estado |
|---|---|---|---|---|
| TSM y anomalía | NOAA OISST v2.1 (PSL) | 25 km | Diaria | ✅ |
| Índices Niño 1+2, 3, 3.4, 4 | Calculados de OISST | Caja Niño | Diaria | ✅ |
| TSM costera por región | Calculada de OISST | Región litoral | Diaria | ✅ |
| ONI, RONI | NOAA CPC | Niño 3.4 | Mensual | ✅ |
| ICEN | IGP / ENFEN | Niño 1+2 | Mensual | ✅ |
| Alerta y probabilidades | ENFEN (comunicados PDF) | Nacional | ~Quincenal | 🔄 manual, ⬜ B4 automático |
| TSM costera, pronóstico 10 días | Copernicus Marine | 8 km | Diaria | ⬜ B3 |
| TSM litoral, ITCP | IMARPE SIOFEN | Costa | Diaria | ⬜ por evaluar |

### Lluvia, sequía y superficie
| Dato | Fuente | Escala | Frecuencia | Estado |
|---|---|---|---|---|
| Lluvia observada | CHIRPS | 5 km | Diaria / pentadal | ⬜ B7 |
| Lluvia observada (Perú) | PISCO (SENAMHI) | 10 km | Mensual | ⬜ B7 |
| SPI 1, 3, 6 | Calculado | Provincia, cuenca | Mensual | ⬜ B7 |
| Temperatura del aire | ERA5-Land, PISCO | 10 km | Diaria | ⬜ B7 |
| Humedad del suelo, escorrentía, vientos | ERA5-Land, GLDAS | 10 km | Diaria | ⬜ B7 |

### Pronóstico
| Dato | Fuente | Escala | Frecuencia | Estado |
|---|---|---|---|---|
| Estacional lluvia y temperatura | Copernicus C3S multimodelo | Región (1°) | Mensual | ⬜ B5 |
| Plumas ENSO | IRI, NMME, C3S | Caja Niño | Mensual | ⬜ B5 |
| Subestacional semanas 1-4 | IRI, ECMWF S2S, GEFS | Región | Semanal | ⬜ B13 |
| Inundaciones | GloFAS | Tramo de río | Diaria | ⬜ B8 |
| IA meteorológica | WeatherNext 2 | Por revisar | Por revisar | ⬜ B5 |

### Territorio y exposición
| Dato | Fuente | Escala | Estado |
|---|---|---|---|
| Departamentos | juaneladio/peru-geojson | Región | ✅ |
| Provincias | INEI / IGN | Provincia | ⬜ B6 |
| Unidades hidrográficas | ANA | Cuenca | ⬜ B6 |
| Lagos, glaciares, embalses, centros poblados | ANA, INAIGEM, INEI | Punto | ⬜ B6 |
| Población | INEI | Provincia | ⬜ B9 |
| Riesgo por lluvias, deslizamientos, calor | CENEPRED, INDECI | Provincia | ⬜ B9 |
| Estrés y riesgo hídrico | Aqueduct (WRI) | Cuenca | ⬜ B9 |

### Agua, pesca y agro
| Dato | Fuente | Escala | Estado |
|---|---|---|---|
| Caudales | SENAMHI, ANA (estaciones) | Estación | ⬜ B8, evaluar calidad |
| Embalses (volumen) | ANA, proyectos especiales | Embalse | ⬜ por evaluar acceso |
| Desembarques | PRODUCE, IMARPE | Puerto | ⬜ por evaluar |
| Campañas agrícolas y cultivos | MIDAGRI | Región / provincia | ⬜ B9 |
| Lugares sensibles a ENSO | Bibliografía (equipo) | Punto | ⬜ B10 |

---

## Decisiones tomadas

| Fecha | Decisión |
|---|---|
| 1 oct 2026 | Usuario final: toda la población del Perú potencialmente afectada |
| 1 oct 2026 | IA: Claude Haiku 4.5, textos pregenerados; chat en vivo solo con límites, y después |
| 1 oct 2026 | Mapa futuro: MapLibre + PMTiles, sin servidor |
| 12 oct 2026 | Escala fina: **provincia**, no distrito (es la que aguantan lluvia y pronóstico) |
| 12 oct 2026 | TSM costera por región: franja marina a menos de 110 km del litoral, desde OISST |
| 12 oct 2026 | Los meses del selector los genera el pipeline (siempre los próximos 6) |

Detalle técnico de cada decisión: [`decisiones.md`](decisiones.md).

## Cómo trabajamos

1. Un bloque a la vez. Al cerrar cada tarea se marca aquí y se hace commit.
2. Antes de editar: **Pull origin** en GitHub Desktop (el robot sube datos a diario).
3. Después de editar: **Commit** y **Push origin**. La página se publica sola en ~2 minutos.
4. Cada decisión técnica va a `docs/decisiones.md` con fecha y motivo.
