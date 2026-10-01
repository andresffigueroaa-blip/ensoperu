# Atajos. En Windows sin make, usar directamente los comandos de la derecha.
PY ?= python

update:            ## Actualizar todos los datos
	$(PY) pipeline/run.py

serve:             ## Ver la página en http://localhost:8000
	$(PY) pipeline/servir.py

historico:         ## Cargar toda la serie OISST desde 1981 (una sola vez, ~20 GB de descarga)
	$(PY) pipeline/run.py --solo oisst --historico 1981-2025

bundle:            ## Página en un solo archivo: dist/index.html
	$(PY) pipeline/herramientas/bundle.py

.PHONY: update serve historico bundle
