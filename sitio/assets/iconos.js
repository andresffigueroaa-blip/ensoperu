/* ════════════════════════════════════════════════════════════════════════
   ENSO PERÚ · iconos.js
   Íconos de lugares para el mapa, dibujados en SVG (sin imágenes externas).

   Reglas (skill ensoperu-diseno): 24 px, relleno sólido, anillo de 2 px del
   color del fondo del mapa para leerse sobre el relieve, y nunca el rojo ni
   el azul de la escala de anomalías.
   ════════════════════════════════════════════════════════════════════════ */

const FONDO_MAPA = "#16222A";

const ICONOS = {
  // Presa: el muro, un trapecio, con el agua retenida a un lado
  presa: {
    nombre: "Presa",
    svg: `<path d="M3 8.5h4.2v9H3z" fill="#5FA8D3"/>
          <path d="M7 6h10l-2.2 12.5H9.2z" fill="#B9C4C9"/>
          <path d="M8.2 9h7.6M8.6 12h6.8M9 15h6" stroke="#7C8A90" stroke-width="1"/>`,
  },
  // Embalse: una gota con una ola
  embalse: {
    nombre: "Embalse",
    svg: `<path d="M12 3.2c3.3 4.2 6.2 7.6 6.2 11a6.2 6.2 0 0 1-12.4 0c0-3.4 2.9-6.8 6.2-11z" fill="#5FA8D3"/>
          <path d="M8.2 14.6c1.2-1 2.5-1 3.8 0s2.6 1 3.8 0" stroke="#E7F3FA" stroke-width="1.4" fill="none" stroke-linecap="round"/>`,
  },
  // Laguna: un óvalo de agua clara con una ola
  laguna: {
    nombre: "Laguna",
    svg: `<ellipse cx="12" cy="13" rx="8.6" ry="5.6" fill="#79C2D0"/>
          <path d="M7.4 13c1.5-1.1 3-1.1 4.6 0s3.1 1.1 4.6 0" stroke="#F1FAFC" stroke-width="1.4" fill="none" stroke-linecap="round"/>`,
  },
  // Glaciar o nevado: una montaña con la cumbre de hielo
  glaciar: {
    nombre: "Glaciar",
    svg: `<path d="M2.5 19.5 10 5.5l3.4 6 2.2-3.2 5.9 11.2z" fill="#8FB3C4"/>
          <path d="M10 5.5 7.4 10.4l1.8-.9 1.1 1.3 1.3-1.2 1.8 1.6z" fill="#F4FAFC"/>
          <path d="m15.6 8.3-1.5 2.2.9-.3.7.8.9-.6z" fill="#F4FAFC"/>`,
  },
};

// Convierte un ícono en imagen para MapLibre (pixelRatio 2 para pantallas nítidas)
function imagenIcono(clave, tam = 24, escala = 2){
  return new Promise((resolver, rechazar) => {
    const def = ICONOS[clave];
    const anillo = def.svg.replace(/fill="[^"]*"/g, `fill="${FONDO_MAPA}"`)
      .replace(/stroke="[^"]*"/g, `stroke="${FONDO_MAPA}"`);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${tam * escala}" height="${tam * escala}" viewBox="-1 -1 26 26">
      <g stroke="${FONDO_MAPA}" stroke-width="3.2" stroke-linejoin="round">${anillo}</g>${def.svg}</svg>`;
    const img = new Image(tam * escala, tam * escala);
    img.onload = () => resolver(img);
    img.onerror = rechazar;
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  });
}

// Ícono como SVG en línea, para leyendas y fichas
function iconoHTML(clave, tam = 18){
  return `<svg width="${tam}" height="${tam}" viewBox="-1 -1 26 26" aria-hidden="true">${ICONOS[clave].svg}</svg>`;
}
