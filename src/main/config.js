// Configuración persistente (userData/config.json) con valores por defecto.
const fs = require('fs');
const path = require('path');

const ACTIONS = [
  { id: 'toggle_visible', label: 'Mostrar / ocultar kneeboard' },
  { id: 'next_page', label: 'Página siguiente' },
  { id: 'prev_page', label: 'Página anterior' },
  { id: 'next_tab', label: 'Pestaña siguiente' },
  { id: 'prev_tab', label: 'Pestaña anterior' },
  { id: 'toggle_auto', label: 'Activar / desactivar modo automático' },
  { id: 'capture_coords', label: 'Capturar coordenadas (centro del F10)' },
  { id: 'toggle_write', label: 'Modo escritura (dar foco al kneeboard)' },
  { id: 'switch_view', label: 'Cambiar de kneeboard activo (doble)' },
  { id: 'recenter_vr', label: 'Recentrar en VR' },
  { id: 'toggle_zoom', label: 'Zoom fijo en VR' },
  { id: 'toggle_night', label: 'Modo noche' },
  { id: 'share_page', label: 'Enviar página actual al vuelo' },
  { id: 'open_shared', label: 'Abrir lo compartido' },
  { id: 'timer', label: 'Cronómetro: iniciar / parar' },
  { id: 'toggle_clickthrough', label: 'Clic a través (escritorio)' },
  { id: 'voice_ptt', label: 'Orden de voz (mantener pulsado y hablar)' },
  { id: 'next_bookmark', label: 'Marcador siguiente (en la pestaña)' },
  { id: 'prev_bookmark', label: 'Marcador anterior (en la pestaña)' },
  { id: 'toggle_crosshair', label: 'Mostrar la cruz del centro (F10)' },
  { id: 'next_wp', label: 'Waypoint siguiente (plan de vuelo)' },
  { id: 'prev_wp', label: 'Waypoint anterior (plan de vuelo)' },
  { id: 'toggle_dual', label: 'Abrir / cerrar el segundo kneeboard' },
  { id: 'open_index', label: 'Índice de páginas (Piernógrafo)' },
  { id: 'next_section', label: 'Juego siguiente (Piernógrafo)' },
  { id: 'prev_section', label: 'Juego anterior (Piernógrafo)' },
  { id: 'next_preset', label: 'Preset de pestañas siguiente' },
  { id: 'next_page_2', label: 'Kneeboard 2: página siguiente' },
  { id: 'prev_page_2', label: 'Kneeboard 2: página anterior' },
  { id: 'next_tab_2', label: 'Kneeboard 2: pestaña siguiente' },
  { id: 'prev_tab_2', label: 'Kneeboard 2: pestaña anterior' },
  { id: 'next_bookmark_2', label: 'Kneeboard 2: marcador siguiente' },
  { id: 'prev_bookmark_2', label: 'Kneeboard 2: marcador anterior' },
];

// Teclas por defecto: Alt derecho (AltGr) + tecla. Códigos virtuales de Windows.
const VK = { RALT: 165, K: 75, M: 77, A: 65, W: 87, R: 82, N: 78, S: 83, T: 84, Z: 90, PGUP: 33, PGDN: 34, END: 35, HOME: 36 };
const kb = (...keys) => keys.map((k) => `kbd:${k}`);
const DEFAULT_BINDINGS = {
  toggle_visible: [kb(VK.RALT, VK.K)],
  next_page: [kb(VK.RALT, VK.PGDN)],
  prev_page: [kb(VK.RALT, VK.PGUP)],
  next_tab: [kb(VK.RALT, VK.END)],
  prev_tab: [kb(VK.RALT, VK.HOME)],
  toggle_auto: [kb(VK.RALT, VK.A)],
  capture_coords: [kb(VK.RALT, VK.M)],
  toggle_write: [kb(VK.RALT, VK.W)],
  recenter_vr: [kb(VK.RALT, VK.R)],
  toggle_night: [kb(VK.RALT, VK.N)],
  share_page: [kb(VK.RALT, VK.S)],
  timer: [kb(VK.RALT, VK.T)],
  toggle_zoom: [kb(VK.RALT, VK.Z)],
};

const PHASES = [
  { id: 'ground', label: 'En tierra (parado)' },
  { id: 'taxi', label: 'Rodaje' },
  { id: 'takeoff', label: 'Despegue y ascenso' },
  { id: 'enroute', label: 'En ruta' },
  { id: 'target', label: 'Zona del objetivo' },
  { id: 'approach', label: 'Aproximación' },
];

let seq = 0;
const tid = () => `t${Date.now().toString(36)}${(seq++).toString(36)}`;

// Pestañas que trae el programa: nombre e icono de cada tipo.
const BUILTIN = {
  'dcs-kneeboard': ['Misión', 'bookmarks'],
  library: ['Piernógrafo', 'mission'],
  cards: ['Tarjeta', 'card'],
  flightplan: ['Plan de vuelo', 'route'],
  radios: ['Radios', 'radio'],
  dtc: ['DTC', 'cartridge'],
  support: ['Apoyo', 'support'],
  notes: ['Bloc', 'notes'],
  map: ['Mapa', 'map'],
  timers: ['Tiempos', 'timer'],
  draw: ['Pizarra', 'board'],
  radiolog: ['Mensajes', 'messages'],
  shared: ['Compartido', 'inbox'],
  lesson: ['Lección', 'lesson'],
};

// Plantillas según el tipo de vuelo. «*» = favorita: fija en la barra de abajo; el resto, en la cuadrícula.
const TEMPLATES = [
  { id: 'completa', label: 'Completa', desc: 'Todas las pestañas', tabs: ['dcs-kneeboard*', 'library*', 'cards*', 'flightplan*', 'radios*', 'dtc', 'support', 'notes*', 'map*', 'timers', 'draw', 'radiolog', 'shared', 'lesson'] },
  { id: 'caza', label: 'Caza', desc: 'Aire-aire: apoyo, bullseye y radios a mano', tabs: ['dcs-kneeboard*', 'library*', 'cards*', 'flightplan*', 'radios*', 'support*', 'map*', 'dtc', 'notes', 'timers', 'radiolog', 'shared'] },
  { id: 'ataque', label: 'Ataque', desc: 'Aire-suelo: coordenadas, mapa y pizarra', tabs: ['dcs-kneeboard*', 'library*', 'cards*', 'flightplan*', 'radios*', 'notes*', 'map*', 'dtc*', 'support', 'draw', 'timers', 'radiolog', 'shared'] },
  { id: 'helicoptero', label: 'Helicóptero', desc: 'Navegación a la vista: mapa, ruta y tiempos', tabs: ['map*', 'flightplan*', 'radios*', 'dcs-kneeboard*', 'notes*', 'timers*', 'library', 'cards', 'support', 'draw', 'shared'] },
  { id: 'entreno', label: 'Entrenamiento', desc: 'Lección de DKS, bloc y pizarra', tabs: ['lesson*', 'dcs-kneeboard*', 'library*', 'notes*', 'draw*', 'cards', 'flightplan', 'radios', 'dtc', 'map', 'timers', 'shared'] },
];

function makeTab(spec) {
  const type = spec.replace('*', '');
  const [title, icon] = BUILTIN[type];
  return { id: tid(), type, title, icon, phases: [], fav: spec.endsWith('*') };
}

function defaultTabs() {
  return TEMPLATES[0].tabs.map(makeTab);
}

// Aplica una plantilla sin perder lo que ya tenías: las pestañas del mismo tipo conservan su nombre,
// icono y ajustes, y tus pestañas de documentos (PDF, web, carpetas, cartas, ventanas) se quedan al final.
function templateTabs(id, current) {
  const tpl = TEMPLATES.find((t) => t.id === id) || TEMPLATES[0];
  const pool = [...(current || [])];
  const out = tpl.tabs.map((spec) => {
    const type = spec.replace('*', '');
    const i = pool.findIndex((t) => t.type === type);
    const tab = i >= 0 ? { ...pool.splice(i, 1)[0] } : makeTab(spec);
    tab.fav = spec.endsWith('*');
    return tab;
  });
  for (const t of pool) if (!BUILTIN[t.type]) out.push({ ...t, fav: !!t.fav });
  return out;
}

function defaults() {
  return {
    version: 5,
    firstRun: true,
    theme: 'tablet',
    night: false,
    dual: false,
    showOnMonitor: true,
    clickThrough: false,
    alwaysOnTop: true,
    overlayOpacity: 1,
    stowAnim: 'slide',
    hidden: false,
    views: [
      { state: { tab: 0, pages: {} }, bounds: null, vr: { pos: [0.13, -0.36, -0.42], rot: [-8, -48, 0], width: 0.24 } },
      { state: { tab: 2, pages: {} }, bounds: null, vr: { pos: [-0.13, -0.36, -0.42], rot: [8, -48, 0], width: 0.24 } },
    ],
    vr: { enabled: true, gazeZoom: true, zoomScale: 1.6, opacityIdle: 0.85, opacityGaze: 1, hideWindow: false },
    tabs: defaultTabs(),
    tabPresets: [],
    bindings: DEFAULT_BINDINGS,
    devices: {},
    auto: { enabled: false, pauseSec: 45, approachNm: 15, targetNm: 8 },
    dcs: { appPort: 7788, hookPort: 7789 },
    share: { url: 'ws://127.0.0.1:7790', room: 'LF', callsign: '', host: false, hostPort: 7790, connect: false, notify: true },
    plan: { fuelFlow: {}, reserveLb: {}, burnPerNm: {} },
    dtc: {},
    magvar: {},
    formats: {},
    library: { root: null },
    uiScale: 1,
    crosshair: 'auto',
    crosshairF10: false,
    integration: {},
    mapColor: null,
    updates: { auto: true },
    voice: { enabled: false, mode: 'ptt', wake: 'piernógrafo', minConfidence: 0.55, culture: 'es-ES' },
    course: { file: null, auto: true, lesson: null },
  };
}

class Config {
  constructor(dir) {
    this.file = path.join(dir, 'config.json');
    this.data = defaults();
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data = merge(this.data, saved);
      if (Array.isArray(saved.tabs)) this.data.tabs = saved.tabs;
      if (saved.bindings) this.data.bindings = saved.bindings;
      if ((saved.version || 1) < 2) migrateV2(this.data);
      if ((saved.version || 1) < 3) migrateV3(this.data);
      if ((saved.version || 1) < 4) migrateV4(this.data);
      if ((saved.version || 1) < 5) migrateV5(this.data);
    } catch {
      /* primera ejecución */
    }
    this.timer = null;
  }

  get() {
    return this.data;
  }

  patch(p) {
    for (const [k, v] of Object.entries(p)) {
      if (k === 'tabs' || k === 'bindings' || Array.isArray(v) || v === null || typeof v !== 'object') this.data[k] = v;
      else this.data[k] = merge(this.data[k] || {}, v);
    }
    this.save();
    return this.data;
  }

  save(now = false) {
    clearTimeout(this.timer);
    const write = () => {
      const tmp = this.file + '.tmp';
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      fs.renameSync(tmp, this.file);
    };
    if (now) write();
    else this.timer = setTimeout(write, 400);
  }
}

// v2: las fases de fábrica de la v1 las había elegido el programa; se quitan si nadie las cambió.
// Los iconos pasan a ser los propios (sin emojis) y aparecen las acciones nuevas sin asignar.
function migrateV2(data) {
  const OLD = { 'dcs-kneeboard': 'ground', flightplan: 'takeoff,enroute', radios: 'taxi,approach', notes: 'target' };
  for (const t of data.tabs || []) {
    if (OLD[t.type] && (t.phases || []).join(',') === OLD[t.type]) t.phases = [];
    if (t.icon && !/^[a-z]+$/i.test(t.icon)) delete t.icon;
  }
  // Pestañas nuevas que no existían en la v1
  const tabs = data.tabs || [];
  const has = (type) => tabs.some((t) => t.type === type);
  const add = (type, title, icon, after) => {
    if (has(type)) return;
    const i = tabs.findIndex((t) => t.type === after);
    tabs.splice(i >= 0 ? i + 1 : tabs.length, 0, { id: tid(), type, title, icon, phases: [] });
  };
  add('library', 'Biblioteca', 'library', 'dcs-kneeboard');
  add('cards', 'Tarjeta', 'card', 'library');
  add('lesson', 'Lección', 'lesson', null);
  data.tabs = tabs;
  if (data.crosshair === true || data.crosshair === undefined) data.crosshair = 'auto';
  if (data.crosshair === false) data.crosshair = 'never';
  data.version = 2;
}

// v3: la Biblioteca pasa a ser el Piernógrafo (todas las páginas del avión) y Misión muestra solo las marcadas.
function migrateV3(data) {
  for (const t of data.tabs || []) {
    if (t.type === 'library') {
      if (!t.title || t.title === 'Biblioteca') t.title = 'Piernógrafo';
      if (!t.icon || t.icon === 'library') t.icon = 'mission';
    }
    if (t.type === 'dcs-kneeboard' && (!t.icon || t.icon === 'mission')) t.icon = 'bookmarks';
  }
  data.version = 3;
}

// v4: la barra de abajo enseña solo las favoritas (el resto, en la cuadrícula). Si nadie eligió, las de siempre.
function migrateV4(data) {
  const tabs = data.tabs || [];
  if (!tabs.some((t) => t.fav)) {
    const FAV = ['dcs-kneeboard', 'library', 'cards', 'flightplan', 'radios', 'notes', 'map'];
    for (const t of tabs) t.fav = FAV.includes(t.type) || !BUILTIN[t.type];
  }
  data.version = 4;
}

// v5: pestaña DTC (en la cuadrícula, detrás de Radios).
function migrateV5(data) {
  const tabs = data.tabs || [];
  if (!tabs.some((t) => t.type === 'dtc')) {
    const i = tabs.findIndex((t) => t.type === 'radios');
    tabs.splice(i >= 0 ? i + 1 : tabs.length, 0, { ...makeTab('dtc'), fav: false });
  }
  data.tabs = tabs;
  data.version = 5;
}

// Preset de pestañas guardado por el piloto: copia de sus pestañas (con sus identificadores, para no perder datos).
function presetTabs(preset) {
  return (preset && Array.isArray(preset.tabs) ? preset.tabs : []).map((t) => ({ ...t, phases: [...(t.phases || [])] }));
}

function merge(base, extra) {
  if (Array.isArray(extra)) return extra;
  if (!extra || typeof extra !== 'object') return extra === undefined ? base : extra;
  const out = { ...(base || {}) };
  for (const [k, v] of Object.entries(extra)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base && typeof base[k] === 'object' && !Array.isArray(base[k]) ? merge(base[k], v) : v;
  }
  return out;
}

module.exports = { Config, ACTIONS, PHASES, DEFAULT_BINDINGS, TEMPLATES, defaultTabs, templateTabs, presetTabs, tid };
