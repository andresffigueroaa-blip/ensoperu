/* ════════════════════════════════════════════════════════════════════════
   ENSO PERÚ · iconos.js
   Íconos de lugares para el mapa, dibujados en SVG (sin imágenes externas).

   Reglas (skill ensoperu-diseno): 24 px, relleno sólido, anillo de 2 px del
   color del fondo del mapa para leerse sobre el relieve, y nunca el rojo ni
   el azul de la escala de anomalías.
   ════════════════════════════════════════════════════════════════════════ */

const FONDO_MAPA = "#16222A";

const ICONOS = {
  // Estación de medición: un mástil con sus brazos
  estacion: {
    nombre: "Estación", plural: "Estaciones",
    svg: `<circle cx="12" cy="6" r="3" fill="#F2D06B"/>
          <path d="M12 8.500V20.500M6 20.500h12M7.500 12.500h9" stroke="#F4FAFC" stroke-width="2" stroke-linecap="round" fill="none"/>`,
  },
  // Cumbre: un triángulo de roca
  cumbre: {
    nombre: "Cumbre", plural: "Cumbres",
    svg: `<path d="M12 4.500 21 19.500H3z" fill="#B59E7E"/><path d="M12 4.500 9.300 9 12 8l2.700 1z" fill="#F4FAFC"/>`,
  },
  // Presa: el muro, un trapecio, con el agua retenida a un lado
  presa: {
    nombre: "Presa", plural: "Presas",
    svg: `<path d="M3 8.5h4.2v9H3z" fill="#5FA8D3"/>
          <path d="M7 6h10l-2.2 12.5H9.2z" fill="#B9C4C9"/>
          <path d="M8.2 9h7.6M8.6 12h6.8M9 15h6" stroke="#7C8A90" stroke-width="1"/>`,
  },
  // Embalse: una gota con una ola
  embalse: {
    nombre: "Embalse", plural: "Embalses",
    svg: `<path d="M12 3.2c3.3 4.2 6.2 7.6 6.2 11a6.2 6.2 0 0 1-12.4 0c0-3.4 2.9-6.8 6.2-11z" fill="#5FA8D3"/>
          <path d="M8.2 14.6c1.2-1 2.5-1 3.8 0s2.6 1 3.8 0" stroke="#E7F3FA" stroke-width="1.4" fill="none" stroke-linecap="round"/>`,
  },
  // Laguna: un óvalo de agua clara con una ola
  laguna: {
    nombre: "Laguna", plural: "Lagunas",
    svg: `<ellipse cx="12" cy="13" rx="8.6" ry="5.6" fill="#79C2D0"/>
          <path d="M7.4 13c1.5-1.1 3-1.1 4.6 0s3.1 1.1 4.6 0" stroke="#F1FAFC" stroke-width="1.4" fill="none" stroke-linecap="round"/>`,
  },
  // Laguna glaciar: agua turquesa al pie de un nevado
  laguna_glaciar: {
    nombre: "Laguna glaciar", plural: "Lagunas glaciares",
    svg: `<path d="M5 13 10 5l3 4.5 2-2.5 4 6z" fill="#C9DCE4"/><ellipse cx="12" cy="16.5" rx="8.5" ry="4.2" fill="#3FB8C4"/>
          <path d="M7.8 16.5c1.4-.9 2.8-.9 4.2 0s2.8.9 4.2 0" stroke="#EFFAFB" stroke-width="1.3" fill="none" stroke-linecap="round"/>`,
  },
  // Glaciar o nevado: una montaña con la cumbre de hielo
  glaciar: {
    nombre: "Glaciar", plural: "Glaciares",
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

/* Dibujos para los títulos de la ficha y de los temas: trazo simple, color de
   tinta, para que acompañen el texto sin competir con los datos. */
const DIBUJOS = {
  lluvia: '<path d="M7 15a4 4 0 0 1 .6-8A5.5 5.5 0 0 1 18 8.5a3.3 3.3 0 0 1-.5 6.5z"/><path d="M9 18l-1 3M13 18l-1 3M17 18l-1 3"/>',
  rio: '<path d="M3 8c3-2 5-2 8 0s5 2 10 0M3 13c3-2 5-2 8 0s5 2 10 0M3 18c3-2 5-2 8 0s5 2 10 0"/>',
  embalse: '<path d="M12 3c3.3 4.2 6.2 7.6 6.2 11a6.2 6.2 0 0 1-12.4 0c0-3.4 2.9-6.8 6.2-11z"/>',
  calor: '<circle cx="12" cy="12" r="4.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
  pez: '<path d="M3 12c3-5 9-6 14-2l4-3v10l-4-3c-5 4-11 3-14-2z"/><circle cx="8" cy="11" r="1"/>',
  ola: '<path d="M2 16c3 0 3-7 7-7 3 0 3 3 1.500 4 3 0 3-2 5-2 3 0 3 5 6.500 5M2 20h20"/>',
  casa: '<path d="M4 11l8-6 8 6M6 10v9h12v-9M10 19v-5h4v5"/>',
  mano: '<path d="M4 20h16M6 20V9l6-5 6 5v11M10 12h4M10 16h4"/>',
  aviso: '<path d="M12 4l9 16H3zM12 10v5M12 17.500v.5"/>',
  ojo: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="2.500"/>',
  historia: '<path d="M4 12a8 8 0 1 0 2.500-5.800L4 8.500V4M12 8v4l3 2"/>',
  libro: '<path d="M4 5c3-1 6-1 8 1 2-2 5-2 8-1v14c-3-1-6-1-8 1-2-2-5-2-8-1zM12 6v14"/>',
};
function dibujo(k, tam = 16){
  return `<svg class="dib" width="${tam}" height="${tam}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${DIBUJOS[k] || ""}</svg>`;
}
