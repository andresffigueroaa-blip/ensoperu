---
name: ensoperu-decision
description: Contenido para toma de decisiones en ENSO Perú - la ficha de lugar (región, provincia, distrito), los niveles de atención, los temas por zona (mar y pesca, lluvias e inundaciones, sequía e incendios, agua y glaciares), los antecedentes de Niños pasados, los estudios relacionados y los textos de IA. Usar al diseñar o redactar cualquier cosa que una persona vaya a usar para decidir.
---

# Toma de decisiones en ENSO Perú

La pregunta que la página debe responder en 30 segundos:
**"¿Cuánto me puede afectar El Niño aquí, y qué conviene mirar?"**

## Ficha de lugar (región, provincia o distrito)

Siempre en este orden, cada bloque con fuente y fecha:

1. **Ahora**: lo observado (TSM costera, lluvia reciente, sequía, incendios activos).
2. **Lo que viene**: probabilidades del ENFEN (nacional), pronóstico de lluvia
   a 16 días (Open-Meteo), caudal pronosticado (GloFAS), estacional (región).
3. **Lo que pasó antes aquí**: impactos en 1982-83, 1997-98, 2017 y 2023,
   **con cita**. Sin cita, no se muestra.
4. **Qué hay expuesto**: presas, embalses, lagunas, glaciares, población, cultivos.
5. **Estudios relacionados**: de `catalogo/estudios.yaml`, filtrados por lugar y tema.

## Nivel de atención

Por amenaza, nunca uno solo mezclado. Cada nivel muestra la regla que lo dio:

| Amenaza | Regla (editable en `catalogo/atencion.yaml`) |
|---|---|
| Mar cálido (litoral) | anomalía costera: < +1 bajo · +1 a +2 medio · +2 a +3 alto · > +3 muy alto |
| Lluvia próxima | lluvia de 16 días frente a la normal del lugar (cuando exista la normal); mientras tanto solo se muestra el valor, sin nivel |
| Incendios | focos en 7 días: 0 bajo · 1-9 medio · 10-49 alto · 50+ muy alto |

Nunca un nivel sin dato: si falta, "sin dato". Nunca mezclar amenazas en un índice opaco.

## Temas por zona

| Tema | Dónde mira primero | Capas que activa |
|---|---|---|
| Mar y pesca | Costa, Tumbes a Tacna | campo de TSM, TSM costera, puertos |
| Lluvias e inundaciones | Costa norte y sierra norte | lluvia 16 días, caudal, presas y embalses |
| Sequía e incendios | Sierra sur y altiplano | incendios 7 días, sequía (SPI) |
| Agua y glaciares | Cordilleras | glaciares, lagunas, embalses |

## Escala

- Pronóstico estacional y probabilidades ENFEN: válidos para región o nacional.
- Lluvia 16 días: promedio de puntos dentro de la provincia; decirlo.
- Incendios, lugares, impactos históricos: válidos por distrito.
- Si un dato no vale a esa escala, se muestra el de la escala mayor y se dice.

## Antecedentes y estudios

Formato en `catalogo/estudios.yaml`:
```yaml
- id: corto-unico
  titulo: "..."
  autores: "..."
  anio: 2018
  url: "https://..."         # DOI o enlace oficial
  temas: [inundaciones, glaciares, pesca, sequia, incendios, agua, agro]
  lugares: [Piura, "0601"]   # región por nombre o provincia/distrito por código INEI
  hallazgo: "una frase con lo que el estudio dice, sin exagerar"
```
Nunca inventar referencias. Si no se puede verificar el enlace, no se agrega.

## Textos de IA

`catalogo/ia.yaml` tiene las instrucciones. Reglas: la IA traduce, no
pronostica; todo número debe estar en las `entradas`; cita las probabilidades
del ENFEN como probabilidades; nada de alarmismo; nace en borrador.
