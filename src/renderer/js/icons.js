// Iconos propios: trazo fino, esquinas y extremos en ángulo recto, un solo color (el del texto del tema).
// Rejilla de 24×24. icon('mapa') devuelve un <svg> listo para insertar.
const P = {
  mission: 'M8 3h8v3H8z M6 4.5H4V21h16V4.5h-2 M8 11h8 M8 15h8 M8 19h4',
  library: 'M4 3h4v18H4z M10 3h4v18h-4z M15.6 4.4l3.9-1 4.2 16.6-3.9 1z M4 7h4 M10 7h4',
  card: 'M2 5h20v14H2z M5 9h6v6H5z M14 9h5 M14 12h5 M14 15h3',
  route: 'M3 20l5-8 5 3 7-11 M7 11h2v2H7z M12 14h2v2h-2z M19 3h2v2h-2z',
  radio: 'M3 9h18v12H3z M6 9l12-6 M6 13h6 M6 17h6 M15 13h3v4h-3z',
  support: 'M5 21l7-11 7 11 M12 10V3 M7.8 5.8a6 6 0 0 1 8.4 0 M5 3a10 10 0 0 1 14 0',
  notes: 'M4 20l1.2-5L16 4.2 19.8 8 9 18.8z M13.5 6.7l3.8 3.8 M4 20h16',
  map: 'M2 6l7-3 6 3 7-3v15l-7 3-6-3-7 3z M9 3v15 M15 6v15',
  timer: 'M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M12 10v4.5l3 2 M9 2h6 M12 2v4 M19 6l1.5-1.5',
  board: 'M2 3h20v13H2z M12 16v3 M7 22l5-3 5 3 M6 12l4-4 3 3 5-5',
  messages: 'M2 3h20v14H9l-5 4v-4H2z M6 8h12 M6 12h8',
  inbox: 'M2 13l3-9h14l3 9v8H2z M2 13h6l1 3h6l1-3h6 M12 4v7 M9 8l3 3 3-3',
  lesson: 'M1 9l11-5 11 5-11 5z M5.5 11v5.5L12 19l6.5-2.5V11 M23 9v6',
  chart: 'M4 2h16v20H4z M9 18l3-11 3 11 M10 14h4 M7 5h3',
  folder: 'M2 5h7l2 2h11v13H2z M2 10h20',
  pdf: 'M5 2h10l4 4v16H5z M15 2v4h4 M8 12h8 M8 15h8 M8 18h5',
  web: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M2 12h20 M12 2c3.2 3 3.2 17 0 20 M12 2c-3.2 3-3.2 17 0 20',
  window: 'M2 4h20v16H2z M2 8h20 M5 6h1 M8 6h1',
  settings: 'M3 6h11 M18 6h3 M14 3.5v5 M3 12h3 M10 12h11 M6 9.5v5 M3 18h13 M20 18h1 M16 15.5v5',
  send: 'M2 11L22 3l-8 18-2.5-7.5z M11.5 13.5L22 3',
  prev: 'M15 4l-8 8 8 8',
  next: 'M9 4l8 8-8 8',
  pen: 'M14 3l7 7-11 11H3v-7z M11 6l7 7',
  bookmark: 'M6 2h12v20l-6-5-6 5z',
  bookmarks: 'M8 2h12v17l-6-4.5L8 19z M4 6v16l5-3.5',
  plus: 'M12 4v16 M4 12h16',
  close: 'M5 5l14 14 M19 5L5 19',
  check: 'M4 12l5 5L20 6',
  crosshair: 'M12 1v8 M12 15v8 M1 12h8 M15 12h8 M11 11h2v2h-2z',
  plane: 'M12 2l1.7 7.3L22 13.5v2.2l-8.3-2.4-.9 5.9 2.7 2.1V23L12 22l-3.5 1v-1.7l2.7-2.1-.9-5.9L2 15.7v-2.2l8.3-4.2z',
  layers: 'M12 3l10 5-10 5L2 8z M2 13l10 5 10-5 M2 17.5l10 5 10-5',
  trash: 'M3 6h18 M9 6V3h6v3 M5.5 6l1.2 16h10.6l1.2-16 M10 10v8 M14 10v8',
  undo: 'M9 5L4 10l5 5 M4 10h11a6 6 0 0 1 0 12h-3',
  eraser: 'M3 16.5L13.5 6 20 12.5 13.5 19h-7z M8.5 11l6.5 6.5 M12 21h9',
  fit: 'M3 9V3h6 M15 3h6v6 M21 15v6h-6 M9 21H3v-6',
  follow: 'M12 2v4 M12 18v4 M2 12h4 M18 12h4 M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12z M11 11h2v2h-2z',
  live: 'M11 11h2v2h-2z M8.5 8.5a5 5 0 0 0 0 7 M15.5 8.5a5 5 0 0 1 0 7 M5.6 5.6a9 9 0 0 0 0 12.8 M18.4 5.6a9 9 0 0 1 0 12.8',
  copy: 'M8 8h13v13H8z M4 16V3h13',
  grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  bullseye: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z M11 11h2v2h-2z',
  fuel: 'M12 2l6.5 10A7 7 0 1 1 5.5 12z M9 15a3 3 0 0 0 3 3',
  ship: 'M2 16h20l-3 5H5z M5 16v-5h14v5 M9 11V6h6v5 M12 2v4',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 1v6 M12 17v6 M1 12h6 M17 12h6',
  radar: 'M3 17l9-12 9 12z M8 17v4 M16 17v4 M12 5v12',
  mic: 'M9 2h6v12H9z M5 11a7 7 0 0 0 14 0 M12 18v4 M8 22h8',
  keyboard: 'M2 5h20v14H2z M6 9h2 M10 9h2 M14 9h2 M18 9h1 M6 13h2 M10 13h2 M14 13h2 M7 16h10',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M2 21v-3l3-3h8l3 3v3 M16 3.3a4 4 0 0 1 0 7.4 M18.5 15l3 3v3',
  vr: 'M2 7h20v10h-6.5L13 14h-2l-2.5 3H2z M6 11h3 M15 11h3',
  play: 'M7 4l13 8-13 8z',
  reset: 'M4 4v6h6 M4.5 10A8 8 0 1 1 6 17',
  pin: 'M12 22s-7-7.5-7-13a7 7 0 0 1 14 0c0 5.5-7 13-7 13z M10.5 7.5h3v3h-3z',
  hash: 'M9 3L7 21 M17 3l-2 18 M3 8h18 M3 16h18',
  zoomIn: 'M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M16 16l6 6 M10 6v8 M6 10h8',
  zoomOut: 'M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M16 16l6 6 M6 10h8',
  home: 'M3 11l9-8 9 8 M5 9.5V21h14V9.5 M10 21v-6h4v6',
  refresh: 'M20 4v6h-6 M19.5 10A8 8 0 1 0 18 17',
  back: 'M20 12H5 M11 5l-7 7 7 7',
  forward: 'M4 12h15 M13 5l7 7-7 7',
  open: 'M14 3h7v7 M21 3L11 13 M18 14v7H3V6h7',
  gauge: 'M3 18a9 9 0 1 1 18 0 M12 18l5-6 M6 18h1 M17 18h1',
  scale: 'M3 21V3h18 M3 21h18V3 M7 17l10-10 M12 7h5v5',
  doc: 'M5 2h14v20H5z M8 7h8 M8 11h8 M8 15h5',
  hand: 'M7 11V4h3v7 M10 9V2h3v9 M13 9V3h3v8 M16 10V5h3v9l-2 8H9l-5-7 2-2 3 2',
  welcome: 'M4 21V3h16v18 M8 7h8 M8 11h8 M8 15h4',
  plug: 'M9 2v6 M15 2v6 M6 8h12v4a6 6 0 0 1-12 0z M12 18v4',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 10v7 M11 6h2v2h-2z',
  palette: 'M3 3h8v8H3z M13 3h8v8h-8z M3 13h8v8H3z M13 13h8v8h-8z',
  tabs: 'M2 6h7l1 3h12v12H2z M2 9h8',
  gamepad: 'M3 7h18v10H3z M7 10v4 M5 12h4 M15 11h1 M18 13h1',
  dual: 'M2 4h9v16H2z M13 4h9v16h-9z M5 8h3 M16 8h3',
  moon: 'M20 14.5A8.5 8.5 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  index: 'M3 3h6v8H3z M3 14h6v7H3z M12 4h9 M12 8h6 M12 15h9 M12 19h6',
  star: 'M12 2.5l2.9 6.2 6.6.8-4.9 4.6 1.3 6.6L12 17.4l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z',
  exportFile: 'M12 15V3 M7 8l5-5 5 5 M4 14v7h16v-7',
  importFile: 'M12 3v12 M7 10l5 5 5-5 M4 14v7h16v-7',
  cartridge: 'M5 2h11l3 3v17H5z M8 2v5h7V2 M8 12h8 M8 15.5h8 M8 19h5',
  preset: 'M3 4h18v4H3z M3 10h18v4H3z M3 16h11v4H3z M17 18h4 M19 16v4',
  update: 'M20 11a8 8 0 0 0-14.5-4.5L3 9 M3 3v6h6 M4 13a8 8 0 0 0 14.5 4.5L21 15 M21 21v-6h-6',
};

// Icono por defecto de cada tipo de pestaña.
export const TAB_ICONS = {
  'dcs-kneeboard': 'bookmarks', library: 'mission', cards: 'card', flightplan: 'route', radios: 'radio', support: 'support',
  notes: 'notes', map: 'map', timers: 'timer', draw: 'board', radiolog: 'messages', shared: 'inbox', lesson: 'lesson', dtc: 'cartridge',
  chart: 'chart', folder: 'folder', pdf: 'pdf', web: 'web', window: 'window',
};

// Iconos que se pueden elegir para una pestaña en Ajustes.
export const PICKABLE = ['mission', 'bookmarks', 'library', 'card', 'route', 'radio', 'support', 'notes', 'map', 'timer', 'board', 'messages',
  'inbox', 'lesson', 'chart', 'folder', 'pdf', 'doc', 'web', 'window', 'bullseye', 'target', 'fuel', 'ship', 'radar', 'plane',
  'crosshair', 'layers', 'bookmark', 'gauge', 'users', 'cartridge'];

const NS = 'http://www.w3.org/2000/svg';

export function icon(name, cls = '') {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', `ico${cls ? ` ${cls}` : ''}`);
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', P[name] || P.doc);
  svg.appendChild(path);
  return svg;
}

export function hasIcon(name) {
  return !!P[name];
}

// Icono de una pestaña: el elegido en Ajustes (si es uno de los nuestros) o el de su tipo.
export function tabIcon(tab) {
  return icon(tab && hasIcon(tab.icon) ? tab.icon : TAB_ICONS[tab && tab.type] || 'doc');
}

// SVG como texto (para los marcadores de Leaflet).
export function iconSvg(name, size = 22, color = 'currentColor') {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="${color}" stroke-width="1.9" stroke-linecap="square" stroke-linejoin="miter"><path d="${P[name] || P.doc}"/></svg>`;
}
