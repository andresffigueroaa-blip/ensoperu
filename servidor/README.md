# servidor/ · Fase 2 (diseñada, sin implementar)

Lo que **no cabe** en un runner de GitHub Actions (14 GB de disco, 6 h
máximo, sin GPU) y corre en el laboratorio propio (Proxmox, 3 nodos):

- GFS y ensambles de ECMWF (cientos de MB a GB por corrida)
- ERA5 y archivo histórico
- Campos de TSM y precipitación como COG (Cloud Optimized GeoTIFF)
- Más adelante, inferencia con GPU (GraphCast, FourCastNet)

## Regla principal

**El sitio nunca depende de esta máquina.** Si el servidor se apaga, la
página sigue funcionando con lo que produce Actions y con los últimos
rásters publicados. Las salidas pesadas van a **Cloudflare R2** (sin costo
de egreso), no al repo.

El detalle (estructura de carpetas, cómo se publica a R2, cómo el frontend
lee los COG con MapLibre) se escribe en el bloque 6.
