---
name: ensoperu-diseno
description: Sistema de diseño de ENSO Perú (concepto termoclina). Usar en cualquier cambio de sitio/ - mapa MapLibre, capas, íconos de lugares (presas, lagunas, glaciares, incendios), gráficos y dashboards, modo claro/oscuro, textos de interfaz. Define colores, escalas, simbología y reglas de visualización.
---

# Diseño de ENSO Perú

Concepto **termoclina**: toda la identidad sale de los dos polos térmicos del
fenómeno. Frío `#1B6A87` (Humboldt) y cálido `#D9452C` (la anomalía, de la
misma familia que el rojo de la bandera).

## Reglas de color

| Trabajo del color | Escala | Dónde se usa |
|---|---|---|
| **Polaridad** (anomalía) | Divergente: `#163D66 #1B6A87 #79A8B4 #DEE2DC #F0C178 #E18C3E #D9452C #8E0F16`, neutro gris claro al centro | TSM, ICEN, ONI, SPI (invertida), anomalía de lluvia. **Único** lugar de azules y rojos juntos |
| **Magnitud** | Secuencial de un solo tono, claro a oscuro | Lluvia acumulada (azules `#cde2fb` a `#104281`), incendios (naranjas `#FCE3CF` a `#8A2A04`), población |
| **Identidad** (series) | Categórica en orden fijo, máx. 8; en mapas y dispersión máx. 3 | Series del Monitoreo. Más de 8: una destacada y el resto gris |
| **Estado** | Bajo / medio / alto / muy alto, siempre con ícono y palabra | Nivel de atención de la ficha de lugar |

- Nunca arcoíris. Nunca un tono en el centro de una divergente.
- El texto nunca lleva el color de la serie: valores y etiquetas en tinta
  (`--ink`, `--fog`); la identidad la da la marca de color al lado.
- La paleta categórica se valida con el skill `dataviz`
  (`scripts/validate_palette.*`), en claro y en oscuro.

## Superficies

- La interfaz es clara (`--paper`), como un portal científico.
- **El mapa es la superficie oscura** (mapa base OpenFreeMap `dark` + relieve
  sombreado AWS Terrain). Separa el dato de la herramienta y deja leer la
  escala divergente, que tiene el blanco en el neutro.
- Modo oscuro: tokens propios bajo `:root[data-theme="dark"]` y
  `prefers-color-scheme`, no una inversión automática.

## Simbología del mapa (`sitio/assets/iconos.js`)

Íconos dibujados en SVG, 24 px, trazo 1,5 px, relleno sólido con anillo de
2 px del color del fondo para leerse sobre el relieve:

| Lugar | Forma | Color |
|---|---|---|
| Presa | trapecio (muro) | `#B9C4C9` gris acero |
| Embalse | gota con ola | `#5FA8D3` agua |
| Laguna | óvalo con ola | `#79C2D0` agua clara |
| Glaciar / nevado | triángulo con cumbre blanca | `#E8F1F5` hielo con borde `#8FB3C4` |
| Incendio activo | punto con halo | naranja `#F28C28`, tamaño por potencia radiativa (FRP) |
| Ciudad | cuadrado pequeño | `#E7EDEC` |

Los íconos no usan el rojo ni el azul de la escala de anomalías.

## Gráficos (reglas del skill dataviz, aplicadas)

- Líneas de 2 px; marcador final de 8 px con anillo de 2 px.
- Grillas y ejes: línea fina sólida, un tono sobre el fondo. Líneas
  punteadas **solo** para umbrales con significado (±0,5 °C, El Niño / La Niña).
- Leyenda siempre con 2 o más series; etiqueta directa solo al final de la
  serie que importa.
- Cursor vertical con lectura de todas las series en ese punto; el valor
  primero, el nombre después.
- Toda vista con gráficos tiene su tabla de datos o archivo descargable.
- Cifras grandes en IBM Plex Sans, no en serif; `tabular-nums` solo en tablas.
- Un solo eje Y por gráfico. Nunca dos escalas.

## Tipografía y textos

- IBM Plex Serif para titulares, IBM Plex Sans para interfaz y cifras.
- Español del Perú, frases cortas, sin jerga. Coma decimal (`+5,2 °C`) y
  signo menos tipográfico (`−0,4`).
- Sin guion largo. Usar coma, punto y coma o paréntesis.
- Toda capa muestra su fuente y su fecha en la leyenda.

## Comprobar antes de terminar

1. Captura en escritorio (1300 px) y en celular: usar un **iframe de 390 px**,
   no `--window-size=390`, que recorta.
2. Sin errores de consola.
3. Mismo dato, mismo número en portada, mapa y Monitoreo.
