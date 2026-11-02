// LF Kneeboard: proceso principal.
const { app, BrowserWindow, ipcMain, protocol, net, screen, Tray, Menu, dialog, shell, nativeImage, desktopCapturer, session } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const { Config, ACTIONS, PHASES, TEMPLATES, defaultTabs, templateTabs, presetTabs } = require('./config');
const { DcsLink } = require('./dcs');
const { Input } = require('./input');
const { VrBridge } = require('./vr');
const { Share, lanAddresses } = require('./share');
const integ = require('./integration');
const focus = require('./focus');
const { radiosFromDtc } = require('./mission-model');
const DTC = require('./dtc');
const { Library } = require('./library');
const { Voice } = require('./voice');
const { Updater } = require('./updater');
const profile = require('./profile');

const ROOT = path.join(__dirname, '..', '..');
const NATIVE = app.isPackaged ? path.join(process.resourcesPath, 'native') : path.join(ROOT, 'native', 'bin');
const HOOK_SRC = path.join(ROOT, 'dcs-scripts', 'Hooks', integ.HOOK_NAME);
const LAYER_MANIFEST = path.join(NATIVE, 'lfkb_openxr_layer.json');
const VOICE_SCRIPT = app.isPackaged ? path.join(process.resourcesPath, 'voice', 'lfkb-voice.ps1') : path.join(ROOT, 'native', 'voice', 'lfkb-voice.ps1');
const ASPECT = 0.72;

app.setAppUserModelId('es.lafundacion.kneeboard');
if (process.env.LFKB_USERDATA) app.setPath('userData', process.env.LFKB_USERDATA);
const TEST_OFFSCREEN = !!process.env.LFKB_SNAPSHOT;

// Un fallo inesperado no debe sacar una ventana de error encima de DCS: se apunta y se sigue.
process.on('uncaughtException', (err) => {
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'errores.log'), `[${new Date().toISOString()}] ${err.stack || err}\n`);
  } catch { /* sin disco */ }
  console.error(err);
});
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  { scheme: 'kbfile', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true, corsEnabled: true } },
]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => openSettings());
}

let cfg, dcs, input, vr, share, tray, library, voice;
let course = null;
const views = [];          // ventanas de kneeboard
let settingsWin = null;
let crosshairWin = null;
let activeView = 0;
let quitting = false;
const inbox = [];
const timers = { running: false, startedAt: 0, acc: 0, push: null };
let forcedZoom = false;
let updater = null;
let dcsState = 'off'; // on = datos del script · open = DCS abierto sin datos · off = DCS cerrado
const store = {};

// ------------------------------------------------------------------ utilidades
const fileUrl = (p) => {
  const abs = path.resolve(p).replace(/\\/g, '/');
  const m = /^([A-Za-z]):\/(.*)$/.exec(abs);
  return m ? `kbfile://${m[1].toLowerCase()}/${m[2].split('/').map(encodeURIComponent).join('/')}` : pathToFileURL(abs).toString();
};

function broadcast(channel, ...args) {
  for (const w of [...views, settingsWin]) {
    if (w && !w.isDestroyed()) w.webContents.send(channel, ...args);
  }
}

function toast(text, kind = 'info') {
  for (const w of views) if (w && !w.isDestroyed()) w.webContents.send('toast', { text, kind });
}

// Nombre de archivo seguro para cada almacén: las claves llevan rutas y «:», que Windows no admite.
function storeFile(name) {
  const safe = String(name).replace(/[<>:"/\\|?*\x00-\x1f]+/g, '_').slice(0, 80);
  const hash = require('crypto').createHash('sha1').update(String(name)).digest('hex').slice(0, 10);
  const dir = path.join(app.getPath('userData'), 'datos');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${safe}-${hash}.json`);
}

function loadStore(name) {
  if (!(name in store)) {
    try {
      store[name] = JSON.parse(fs.readFileSync(storeFile(name), 'utf8'));
    } catch {
      store[name] = null;
    }
  }
  return store[name];
}

const storeTimers = {};
function saveStore(name, data) {
  store[name] = data;
  clearTimeout(storeTimers[name]);
  storeTimers[name] = setTimeout(() => {
    fs.writeFileSync(storeFile(name), JSON.stringify(data));
  }, 500);
}

// ------------------------------------------------------------------ protocolos
function registerProtocols() {
  const allowed = ['src', 'node_modules', 'data'].map((d) => path.join(ROOT, d));
  protocol.handle('app', (req) => {
    const u = new URL(req.url);
    const p = path.normalize(path.join(ROOT, decodeURIComponent(u.pathname)));
    if (!allowed.some((a) => p.startsWith(a))) return new Response('No permitido', { status: 403 });
    return net.fetch(pathToFileURL(p).toString());
  });
  protocol.handle('kbfile', async (req) => {
    const u = new URL(req.url);
    const p = `${u.hostname.toUpperCase()}:${decodeURIComponent(u.pathname)}`;
    const res = await net.fetch(pathToFileURL(p).toString(), { headers: req.headers });
    // Solo la propia app (pdf.js) puede leer archivos locales con fetch/XHR.
    const headers = new Headers(res.headers);
    if (req.headers.get('origin') === 'app://kb') headers.set('Access-Control-Allow-Origin', 'app://kb');
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  });
  // Permite incrustar webs que prohíben iframes (pestañas web del kneeboard).
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    if (details.resourceType !== 'subFrame' && details.resourceType !== 'mainFrame') return cb({});
    const h = { ...details.responseHeaders };
    for (const k of Object.keys(h)) {
      if (k.toLowerCase() === 'x-frame-options') delete h[k];
      if (k.toLowerCase() === 'content-security-policy') h[k] = h[k].map((v) => v.replace(/frame-ancestors[^;]*;?/gi, ''));
    }
    cb({ responseHeaders: h });
  });
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(['media', 'display-capture', 'clipboard-sanitized-write', 'fullscreen'].includes(perm)));
}

// ------------------------------------------------------------------ ventanas
function defaultBounds(i) {
  const wa = screen.getPrimaryDisplay().workArea;
  const height = Math.round(wa.height * 0.78);
  const width = Math.round(height * ASPECT);
  const x = i === 0 ? wa.x + wa.width - width - 24 : wa.x + 24;
  return { x, y: wa.y + Math.round((wa.height - height) / 2), width, height };
}

function boundsVisible(b) {
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return b.x + 40 < a.x + a.width && b.x + b.width - 40 > a.x && b.y + 20 < a.y + a.height && b.y + 40 > a.y;
  });
}

function createView(i) {
  const c = cfg.get();
  let b = c.views[i].bounds;
  if (!b || !boundsVisible(b)) b = defaultBounds(i);
  if (TEST_OFFSCREEN) b = { ...b, x: -6000, y: 0 };
  const win = new BrowserWindow({
    ...b,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: true,
    alwaysOnTop: c.alwaysOnTop,
    skipTaskbar: true,
    show: false,
    title: `LF Kneeboard ${i + 1}`,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: false,
      webviewTag: true,
      backgroundThrottling: false,
      additionalArguments: [`--kb-view=${i}`],
    },
  });
  win.setAspectRatio(ASPECT);
  if (c.alwaysOnTop) win.setAlwaysOnTop(true, 'screen-saver');
  win.loadURL(`app://kb/src/renderer/kneeboard.html?view=${i}`);
  win.once('ready-to-show', () => {
    applyWindowState(i);
    startFrames(i);
  });
  const saveBounds = () => {
    if (win.isDestroyed() || win.__offscreen) return;
    const vs = cfg.get().views.map((v) => ({ ...v }));
    vs[i].bounds = win.getBounds();
    cfg.patch({ views: vs });
  };
  win.on('moved', saveBounds);
  win.on('resized', saveBounds);
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      setHidden(true);
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  views[i] = win;
  return win;
}

function applyWindowState(i) {
  const win = views[i];
  if (!win || win.isDestroyed()) return;
  const c = cfg.get();
  const wantVisible = !c.hidden && (i === 0 || c.dual);
  const offscreen = c.vr.enabled && c.vr.hideWindow;
  if (!wantVisible) {
    win.hide();
  } else {
    if (offscreen && !win.__offscreen) {
      const all = screen.getAllDisplays().map((d) => d.bounds);
      const minX = Math.min(...all.map((d) => d.x));
      win.__offscreen = true;
      win.setPosition(minX - win.getBounds().width - 200, 0);
    } else if (!offscreen && win.__offscreen) {
      win.__offscreen = false;
      const b = cfg.get().views[i].bounds || defaultBounds(i);
      win.setBounds(boundsVisible(b) ? b : defaultBounds(i));
    }
    if (!win.isVisible()) win.showInactive();
    win.setOpacity(offscreen ? 1 : c.overlayOpacity);
    win.setIgnoreMouseEvents(!!c.clickThrough && !offscreen, { forward: true });
  }
  updatePlacement(i);
}

function updatePlacement(i) {
  if (!vr || !vr.ok) return;
  const c = cfg.get();
  const v = c.views[i].vr;
  const visible = c.vr.enabled && !c.hidden && (i === 0 || c.dual);
  vr.setPlacement(i, {
    visible,
    pos: v.pos,
    rot: v.rot,
    width: forcedZoom ? v.width * c.vr.zoomScale : v.width,
    zoomScale: c.vr.zoomScale,
    gazeZoom: c.vr.gazeZoom && !forcedZoom,
  });
}

const frameState = [{}, {}];
function startFrames(i) {
  const win = views[i];
  if (!win || !vr || !vr.ok) return;
  const st = frameState[i];
  if (st.subscribed) return;
  st.subscribed = true;
  win.webContents.beginFrameSubscription(false, (image) => {
    st.latest = image;
    if (st.timer) return;
    const wait = Math.max(0, 33 - (Date.now() - (st.last || 0)));
    st.timer = setTimeout(() => {
      st.timer = null;
      st.last = Date.now();
      if (cfg.get().vr.enabled && st.latest) vr.pushFrame(i, st.latest);
      st.latest = null;
    }, wait);
  });
  // Al suscribirse no siempre llega un fotograma: fuerza uno.
  win.webContents.invalidate();
}

// Ocultar: primero se desvanece la página (así el último fotograma que guardan la ventana y la capa VR
// es transparente) y después se ocultan. Al volver a sacarlo, la página entra de nuevo con su animación,
// igual que la primera vez, sin que aparezca un instante la imagen de cuando se guardó.
let hideTimer = null;
function setHidden(h) {
  clearTimeout(hideTimer);
  cfg.patch({ hidden: h });
  broadcast('visibility', !h);
  if (h) hideTimer = setTimeout(() => views.forEach((_, i) => applyWindowState(i)), 170);
  else views.forEach((_, i) => applyWindowState(i));
  broadcast('config', cfg.get());
  updateTray();
}

function openSettings(section) {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    if (section) settingsWin.webContents.send('goto', section);
    return;
  }
  settingsWin = new BrowserWindow({
    ...(TEST_OFFSCREEN ? { x: -6000, y: 0 } : {}),
    width: 1180,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'LF Kneeboard — Ajustes',
    backgroundColor: '#11161c',
    autoHideMenuBar: true,
    icon: path.join(ROOT, 'src', 'renderer', 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false, additionalArguments: ['--kb-view=-1'] },
  });
  settingsWin.loadURL(`app://kb/src/renderer/settings.html${section ? `#${section}` : ''}`);
  settingsWin.on('closed', () => { settingsWin = null; });
}

// Cruz que marca el centro de la vista (el punto que se captura del F10).
// Modo «auto»: con el F10 abierto o mientras se ve la página de Coordenadas. «always» / «never». La acción la fuerza.
const coordsViews = new Set();
let forcedCrosshair = false;
function crosshairMode() {
  const v = cfg.get().crosshair;
  return v === false || v === 'never' ? 'never' : v === 'always' ? 'always' : 'auto';
}

function updateCrosshair(live = dcs && dcs.live) {
  const mode = crosshairMode();
  // En automático manda la página Coordenadas; la detección del F10 es opcional (experimental).
  const f10 = !!(cfg.get().crosshairF10 && live && live.mapView);
  const want = forcedCrosshair || mode === 'always' || (mode === 'auto' && (coordsViews.size > 0 || f10));
  if (vr) vr.setReticle(want);
  if (!want) {
    if (crosshairWin && !crosshairWin.isDestroyed()) crosshairWin.hide();
    return;
  }
  // Centro de la ventana de DCS (o de la pantalla principal si DCS no está abierto).
  const r = TEST_OFFSCREEN ? null : focus.dcsRect();
  let area = screen.getPrimaryDisplay().bounds;
  if (r) {
    try {
      area = screen.screenToDipRect(null, { x: r.x | 0, y: r.y | 0, width: r.width | 0, height: r.height | 0 });
    } catch {
      const k = screen.getPrimaryDisplay().scaleFactor || 1;
      area = { x: r.x / k, y: r.y / k, width: r.width / k, height: r.height / k };
    }
  }
  if (TEST_OFFSCREEN) area = { x: -6000, y: 0, width: 400, height: 400 };
  const x = Math.round(area.x + area.width / 2) - 40;
  const y = Math.round(area.y + area.height / 2) - 40;
  if (!crosshairWin || crosshairWin.isDestroyed()) {
    crosshairWin = new BrowserWindow({
      x, y, width: 80, height: 80,
      frame: false, transparent: true, backgroundColor: '#00000000', resizable: false, focusable: false,
      skipTaskbar: true, alwaysOnTop: true, show: false, hasShadow: false,
    });
    crosshairWin.setIgnoreMouseEvents(true);
    crosshairWin.setAlwaysOnTop(true, 'screen-saver');
    crosshairWin.loadURL('app://kb/src/renderer/crosshair.html');
    crosshairWin.once('ready-to-show', () => crosshairWin.showInactive());
  } else {
    const b = crosshairWin.getBounds();
    if (b.x !== x || b.y !== y) crosshairWin.setBounds({ x, y, width: 80, height: 80 });
    if (!crosshairWin.isVisible()) crosshairWin.showInactive();
  }
}

// ------------------------------------------------------------------ bandeja
function updateTray() {
  if (!tray) return;
  const c = cfg.get();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: c.hidden ? 'Mostrar kneeboard' : 'Ocultar kneeboard', click: () => setHidden(!c.hidden) },
    { label: 'Ajustes…', click: () => openSettings() },
    { type: 'separator' },
    { label: 'Modo automático', type: 'checkbox', checked: c.auto.enabled, click: () => doAction('toggle_auto') },
    { label: 'Modo noche', type: 'checkbox', checked: c.night, click: () => doAction('toggle_night') },
    { label: 'Recentrar VR', click: () => doAction('recenter_vr') },
    { type: 'separator' },
    { label: 'Salir', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.setToolTip(`LF Kneeboard${dcs && dcs.connected() ? ' — DCS conectado' : ''}`);
}

// ------------------------------------------------------------------ acciones
function sendToView(i, channel, payload) {
  const w = views[i];
  if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
}

// Presets de pestañas: los guarda el piloto (Ajustes > Pestañas o la cuadrícula del kneeboard).
function applyPreset(id) {
  const p = (cfg.get().tabPresets || []).find((x) => x.id === id);
  if (!p) return null;
  cfg.patch({ tabs: presetTabs(p), activePreset: p.id });
  voice.apply();
  broadcast('config', cfg.get());
  toast(`Pestañas: ${p.name}`);
  return cfg.get();
}

async function doAction(action) {
  const c = cfg.get();
  switch (action) {
    case 'next_preset': {
      const list = c.tabPresets || [];
      if (!list.length) { toast('No tienes presets de pestañas (Ajustes > Pestañas)', 'warn'); break; }
      const i = list.findIndex((p) => p.id === c.activePreset);
      applyPreset(list[(i + 1) % list.length].id);
      break;
    }
    case 'toggle_visible':
      setHidden(!c.hidden);
      break;
    case 'toggle_auto':
      cfg.patch({ auto: { enabled: !c.auto.enabled } });
      broadcast('config', cfg.get());
      toast(cfg.get().auto.enabled ? 'Modo automático activado' : 'Modo automático desactivado');
      updateTray();
      break;
    case 'toggle_night':
      cfg.patch({ night: !c.night });
      broadcast('config', cfg.get());
      updateTray();
      break;
    case 'switch_view':
      if (c.dual) {
        activeView = activeView ? 0 : 1;
        broadcast('active-view', activeView);
      }
      break;
    case 'recenter_vr':
      if (vr) vr.recenter();
      toast('VR recentrado');
      break;
    case 'toggle_zoom':
      forcedZoom = !forcedZoom;
      views.forEach((_, i) => updatePlacement(i));
      break;
    case 'capture_coords':
      await captureCoords();
      break;
    case 'toggle_write': {
      const w = views[activeView];
      if (w && w.isFocused()) {
        focus.focusDcs();
        broadcast('write-mode', false);
      } else if (w) {
        if (c.hidden) setHidden(false);
        focus.focusWindow(w);
        broadcast('write-mode', true);
      }
      break;
    }
    case 'toggle_dual':
      cfg.patch({ dual: !c.dual });
      if (cfg.get().dual && !views[1]) createView(1);
      views.forEach((_, i) => applyWindowState(i));
      broadcast('config', cfg.get());
      break;
    case 'toggle_crosshair':
      forcedCrosshair = !forcedCrosshair;
      updateCrosshair();
      toast(forcedCrosshair ? 'Cruz del centro: visible' : 'Cruz del centro: automática');
      break;
    case 'toggle_clickthrough':
      cfg.patch({ clickThrough: !c.clickThrough });
      views.forEach((_, i) => applyWindowState(i));
      toast(cfg.get().clickThrough ? 'Clic a través activado' : 'Clic a través desactivado');
      break;
    case 'timer':
      timerCmd({ cmd: timers.running ? 'stop' : 'start' });
      break;
    case 'voice_ptt':
      if (voice) voice.listen(true);
      break;
    case 'show':
      if (c.hidden) setHidden(false);
      break;
    case 'hide':
      if (!c.hidden) setHidden(true);
      break;
    default:
      // Navegación y resto: las resuelve la página del kneeboard activo.
      // Acciones del segundo kneeboard (terminan en _2): van siempre a él.
      if (/_2$/.test(action)) {
        if (!views[1] || !c.dual) toast('El segundo kneeboard está cerrado (botón «Dos kneeboards»)', 'warn');
        else sendToView(1, 'action', action.replace(/_2$/, ''));
        break;
      }
      sendToView(activeView, 'action', action);
  }
}

async function captureCoords() {
  if (!dcs.connected()) {
    toast('DCS no está conectado: abre la misión con el hook instalado', 'warn');
    return null;
  }
  const p = await dcs.capture();
  if (!p) {
    toast('DCS no ha devuelto coordenadas', 'warn');
    return null;
  }
  p.type = (dcs.live && dcs.live.type) || (dcs.mission && dcs.mission.unit && dcs.mission.unit.type) || '';
  broadcast('coords', p);
  return p;
}

function onVoiceCommand(action, text) {
  toast(`«${text}»`, 'info');
  if (action.startsWith('bm:')) {
    if (cfg.get().hidden) setHidden(false);
    sendToView(activeView, 'goto-bookmark', action.slice(3));
    return;
  }
  const m = /^(page|tab):(\d+)$/.exec(action);
  if (m) {
    if (cfg.get().hidden) setHidden(false);
    sendToView(activeView, m[1] === 'page' ? 'goto-page' : 'goto-tab', Number(m[2]));
    return;
  }
  doAction(action);
}

function readCourse(file) {
  if (!file) return null;
  try {
    let raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    if (raw.proposed) raw = raw.proposed; // borrador de DKS (get_draft)
    if (!raw.phases) throw new Error('No parece un curso de DKS (falta "phases")');
    return raw;
  } catch (e) {
    return { error: e.message };
  }
}

// DTC más adecuado para un avión: primero los de DKS (*_OB.dtc), después el más reciente.
function autoDtc(type) {
  if (!type) return null;
  let best = null;
  for (const d of integ.dtcDirs()) {
    for (const ac of safeReaddir(d)) {
      for (const f of safeReaddir(path.join(d, ac))) {
        if (!/\.dtc$/i.test(f)) continue;
        const file = path.join(d, ac, f);
        try {
          const j = JSON.parse(fs.readFileSync(file, 'utf8'));
          if (j.type !== type) continue;
          const score = (/_OB\.dtc$/i.test(f) ? 1e13 : 0) + fs.statSync(file).mtimeMs;
          if (!best || score > best.score) best = { file, score, name: f.replace(/\.dtc$/i, '') };
        } catch { /* no es JSON */ }
      }
    }
  }
  return best ? { file: best.file, name: best.name } : null;
}

// El DTC guardado más reciente de ese avión en Saved Games\DCS\DTC (el tipo de cada archivo se recuerda
// mientras no cambie: algunos pesan varios MB).
const dtcTypeCache = new Map();
function latestDtc(type) {
  let best = null;
  for (const d of integ.dtcDirs()) {
    for (const ac of safeReaddir(d)) {
      for (const f of safeReaddir(path.join(d, ac))) {
        if (!/\.dtc$/i.test(f)) continue;
        const file = path.join(d, ac, f);
        try {
          const mtime = fs.statSync(file).mtimeMs;
          const c = dtcTypeCache.get(file);
          const t = c && c.mtime === mtime ? c.type : DTC.typeOf(file);
          dtcTypeCache.set(file, { mtime, type: t });
          if (t === type && (!best || mtime > best.mtime)) best = { file, mtime, name: f.replace(/\.dtc$/i, '') };
        } catch { /* no se puede leer */ }
      }
    }
  }
  return best;
}

// DTC del avión. Normalmente, por este orden: el elegido o importado en el kneeboard, el que la misión mete
// en el .miz para esa plaza, el de la carpeta «DTC» junto al .miz, el de DKS (*_OB.dtc) y, solo para las
// radios, el más reciente de ese avión. Pero si en DCS guardas o cargas un DTC durante la misión (editor de DTC
// del juego, DCS-DTC…), ese pasa delante: es lo último que has hecho. «at» dice cuándo, para compararlo con
// la herramienta de ruta del F10.
function resolveDtc(type, miz, { mizFiles = [], cartridges = [], since = 0, pickedAt = 0 } = {}) {
  if (!type) return null;
  const chosen = (cfg.get().dtc || {})[type];
  if (chosen === 'mision') return null;
  const name = (f) => path.basename(f, '.dtc');
  let base = null;
  if (chosen && fs.existsSync(chosen)) base = { file: chosen, name: name(chosen), origin: 'elegido', useRoute: true, at: pickedAt };
  if (!base) {
    const inMiz = DTC.pickMissionDtc(mizFiles, type, cartridges);
    if (inMiz) base = { file: inMiz, name: name(inMiz), origin: 'misión', useRoute: true, at: 0 };
  }
  if (!base) {
    const f = DTC.missionDtcs(miz).find((x) => DTC.typeOf(x) === type);
    if (f) base = { file: f, name: name(f), origin: 'misión', useRoute: true, at: 0 };
  }
  const recent = since ? latestDtc(type) : null;
  if (recent && recent.mtime > since && recent.mtime > (base ? base.at : 0)) {
    return { file: recent.file, name: recent.name, origin: 'guardado en DCS', useRoute: true, at: recent.mtime };
  }
  if (base) return base;
  const a = autoDtc(type);
  if (!a) return null;
  const ob = /_OB\.dtc$/i.test(a.file);
  return { ...a, origin: ob ? 'DKS' : 'reciente', useRoute: ob, at: 0 };
}

// Usa un DTC para su avión: lo copia a Saved Games\DCS\DTC\<avión> (para cargarlo en cabina) y lo deja elegido.
function useDtcFile(src, opts = {}) {
  const r = DTC.installDtc(integ.dtcDirs(), src, opts);
  cfg.patch({ dtc: { ...(cfg.get().dtc || {}), [r.type]: r.file } });
  dcs.dropEditorDtc(r.type);
  broadcast('config', cfg.get());
  dcs.rebuild();
  broadcast('dtc-changed');
  return r;
}

function timerCmd({ cmd, value }) {
  const now = Date.now();
  if (cmd === 'start' && !timers.running) { timers.running = true; timers.startedAt = now; }
  if (cmd === 'stop' && timers.running) { timers.running = false; timers.acc += now - timers.startedAt; }
  if (cmd === 'reset') { timers.running = false; timers.acc = 0; }
  if (cmd === 'push') timers.push = value;
  broadcast('timers', timers);
}

// Lápiz de la tableta gráfica, como en OpenKneeboard: toda la tableta es el kneeboard (el activo, o el elegido en
// Ajustes), girada según la orientación elegida y ajustada para que la página quepa entera. La página recibe
// la posición en 0..1, dibuja el cursor y convierte el lápiz en eventos de lápiz normales.
function onTablet(pen) {
  const t = cfg.get().tablet || {};
  if (t.enabled === false) return;
  const i = t.view === 0 || t.view === 1 ? t.view : activeView;
  const win = views[i] || views[0];
  if (!win || win.isDestroyed()) return;
  if (!pen.active || cfg.get().hidden) {
    win.webContents.send('tablet', { active: false });
    return;
  }
  let { x, y, mx, my } = pen;
  const rot = Number(t.orientation != null ? t.orientation : 90);
  if (rot === 90) [x, y, mx, my] = [my - y, x, my, mx];
  else if (rot === 180) [x, y] = [mx - x, my - y];
  else if (rot === 270) [x, y, mx, my] = [y, mx - x, my, mx];
  const { width: W, height: H } = win.getContentBounds();
  const scale = Math.max(W / mx, H / my);
  const clamp = (v) => Math.max(0, Math.min(1, v));
  win.webContents.send('tablet', {
    active: true, x: clamp((x * scale) / W), y: clamp((y * scale) / H), p: pen.p,
    touch: !!(pen.pb & 1), erase: !!(pen.pb & ~1 >>> 0),
  });
}

function pushInbox(item) {
  inbox.unshift(item);
  if (inbox.length > 60) inbox.length = 60;
  broadcast('inbox', inbox);
}

// ------------------------------------------------------------------ IPC
function registerIpc() {
  ipcMain.handle('init', (e) => ({
    config: cfg.get(),
    actions: ACTIONS,
    phases: PHASES,
    mission: dcs.mission,
    live: dcs.live,
    phase: dcs.phase,
    connected: dcs.connected(),
    dcsState,
    messages: dcs.messages,
    inbox,
    timers,
    activeView,
    vrActive: vr ? vr.active : false,
    share: { status: share.status, members: share.members },
    devices: input.listDevices(),
    tablet: input.tabletInfo(),
    course,
    blocks: dcs.blocks,
    voice: voice ? voice.status : 'apagado',
    version: app.getVersion(),
    userData: app.getPath('userData'),
  }));

  ipcMain.handle('config:patch', (e, p) => {
    const before = cfg.get();
    const share0 = JSON.stringify(before.share);
    // La pestaña y página de cada kneeboard las guarda el propio kneeboard: no se pisan desde Ajustes.
    if (Array.isArray(p.views)) p.views = p.views.map((v, i) => ({ ...v, state: (before.views[i] || {}).state || v.state }));
    if (p.startWithWindows !== undefined && app.isPackaged) app.setLoginItemSettings({ openAtLogin: !!p.startWithWindows });
    if (p.tabs && !('activePreset' in p)) p.activePreset = null; // pestañas cambiadas a mano: ya no es el preset
    cfg.patch(p);
    const c = cfg.get();
    if (p.dual !== undefined || p.hidden !== undefined || p.vr || p.overlayOpacity !== undefined || p.clickThrough !== undefined || p.views) {
      if (c.dual && !views[1]) createView(1);
      views.forEach((_, i) => applyWindowState(i));
    }
    if (p.alwaysOnTop !== undefined) views.forEach((w) => w && w.setAlwaysOnTop(c.alwaysOnTop, 'screen-saver'));
    if (p.share && JSON.stringify(c.share) !== share0) share.apply();
    if (p.dtc) dcs.rebuild();
    if (p.updates && updater) updater.start();
    if (p.voice || p.tabs) voice.apply();
    if (p.crosshair !== undefined) updateCrosshair();
    broadcast('config', c);
    updateTray();
    return c;
  });

  ipcMain.on('view:state', (e, i, state) => {
    const vs = cfg.get().views.map((v) => ({ ...v }));
    if (!vs[i]) return;
    vs[i].state = state;
    cfg.patch({ views: vs });
  });

  ipcMain.on('view:resize', (e, w) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win && !win.__offscreen) win.setSize(Math.round(w), Math.round(w / ASPECT));
  });
  ipcMain.on('view:resizeDone', (e) => {
    const i = views.findIndex((w) => w && w.webContents === e.sender);
    if (i < 0) return;
    const vs = cfg.get().views.map((v) => ({ ...v }));
    vs[i].bounds = views[i].getBounds();
    cfg.patch({ views: vs });
  });

  ipcMain.handle('action', (e, a) => doAction(a));
  ipcMain.on('crosshair:coords', (e, view, on) => {
    if (on) coordsViews.add(view); else coordsViews.delete(view);
    updateCrosshair();
  });
  ipcMain.on('view:setSize', (e, i, fraction) => {
    const win = views[i];
    if (!win || win.__offscreen) return;
    const wa = screen.getDisplayMatching(win.getBounds()).workArea;
    const height = Math.round(wa.height * Math.max(0.3, Math.min(1, fraction)));
    const width = Math.round(height * ASPECT);
    const b = win.getBounds();
    win.setBounds({ x: Math.min(b.x, wa.x + wa.width - width), y: Math.max(wa.y, Math.min(b.y, wa.y + wa.height - height)), width, height });
    const vs = cfg.get().views.map((v) => ({ ...v }));
    vs[i].bounds = win.getBounds();
    cfg.patch({ views: vs });
  });
  ipcMain.handle('view:activate', (e, i) => {
    if (activeView !== i) {
      activeView = i;
      broadcast('active-view', i);
    }
  });

  ipcMain.handle('fs:list', (e, dir, kind) => listFiles(dir, kind));
  ipcMain.handle('fs:url', (e, p) => fileUrl(p));
  ipcMain.handle('fs:thumb', (e, p) => thumbnail(p));
  ipcMain.handle('fs:dcsKneeboard', (e, aircraft) => {
    const out = [];
    for (const f of (dcs.mission && dcs.mission.kneeboardImages) || []) out.push({ name: path.basename(f).replace(/^\d{3}_/, ''), url: fileUrl(f), group: 'Misión' });
    for (const d of integ.dcsKneeboardDirs(aircraft)) for (const f of listFiles(d, 'images')) out.push({ ...f, group: 'Avión' });
    return out;
  });
  // Piernógrafo completo del avión: páginas de la misión, tus juegos de la biblioteca y la carpeta Kneeboard de DCS.
  // Las copias que hacen la app («LFK …») o KneeboardManager (mismo nombre que en la biblioteca) no se repiten.
  ipcMain.handle('kneeboard:all', (e, aircraft) => {
    const out = [];
    for (const f of (dcs.mission && dcs.mission.kneeboardImages) || []) {
      out.push({ name: path.basename(f).replace(/^\d{3}_/, ''), url: fileUrl(f), path: f, group: 'Misión', src: 'mis' });
    }
    const lib = library.pagesFor(aircraft);
    const libNames = new Set(lib.map((p) => p.name.toLowerCase()));
    for (const p of lib) out.push({ ...p, url: fileUrl(p.path), group: p.set, src: 'lib' });
    for (const d of integ.dcsKneeboardDirs(aircraft)) {
      for (const f of listFiles(d, 'images')) {
        if (/^LFK \d{2}\.\d{3} /.test(f.name) || libNames.has(f.name.toLowerCase())) continue;
        out.push({ ...f, group: 'DCS', src: 'ac' });
      }
    }
    return out;
  });
  ipcMain.handle('dialog:open', async (e, opts) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const r = await dialog.showOpenDialog(win, opts);
    return r.canceled ? [] : r.filePaths;
  });

  ipcMain.handle('coords:capture', () => captureCoords());
  ipcMain.handle('share:send', (e, item) => {
    const ok = share.send(item);
    if (!ok) toast('No estás conectado a una sala (Ajustes > Vuelo compartido)', 'warn');
    return ok;
  });
  // Se envía la imagen de la página y, si la pestaña lo permite, sus datos (para copiarlos en la del compañero).
  ipcMain.handle('share:page', async (e, i, title, data) => {
    const w = views[i];
    if (!w) return false;
    const img = await w.webContents.capturePage();
    const { width } = img.getSize();
    const small = width > 900 ? img.resize({ width: 900, quality: 'good' }) : img;
    const item = { type: 'page', title, image: `data:image/jpeg;base64,${small.toJPEG(82).toString('base64')}`, data: data || null };
    const ok = share.send(item);
    toast(ok ? `Página «${title}» enviada al vuelo` : 'No estás conectado a una sala (Ajustes > Vuelo compartido)', ok ? 'info' : 'warn');
    return ok;
  });
  ipcMain.handle('share:addresses', () => ({ lan: lanAddresses(), port: cfg.get().share.hostPort }));
  ipcMain.handle('inbox:clear', () => {
    inbox.length = 0;
    broadcast('inbox', inbox);
  });

  ipcMain.handle('mission:loadMiz', async (e, file, unit) => {
    await dcs.loadMizFile(file, unit);
    return dcs.mission;
  });
  ipcMain.handle('mission:selectUnit', async (e, unit) => {
    await dcs.selectUnit(unit);
    return dcs.mission;
  });
  ipcMain.handle('dtc:list', () => {
    const out = [];
    for (const d of integ.dtcDirs()) {
      for (const ac of safeReaddir(d)) {
        const dir = path.join(d, ac);
        for (const f of safeReaddir(dir)) if (/\.dtc$/i.test(f)) out.push({ aircraft: ac, name: f.replace(/\.dtc$/i, ''), file: path.join(dir, f) });
      }
    }
    return out;
  });
  ipcMain.handle('dtc:import', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const r = await dialog.showOpenDialog(win, { title: 'Importar un DTC', properties: ['openFile'], filters: [{ name: 'DTC de DCS', extensions: ['dtc'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    try {
      const res = useDtcFile(r.filePaths[0]);
      toast(`DTC «${path.basename(res.file, '.dtc')}» en uso para ${res.type}. Está en ${path.dirname(res.file)} para cargarlo en cabina.`);
      return res;
    } catch (err) {
      toast(`No se pudo importar: ${err.message}`, 'warn');
      return { error: err.message };
    }
  });
  // Elegir el DTC de un avión: un archivo, 'mision' (sin DTC) o null (automático).
  ipcMain.handle('dtc:use', (e, type, file) => {
    cfg.patch({ dtc: { ...(cfg.get().dtc || {}), [type]: file || null } });
    dcs.dropEditorDtc(type);
    broadcast('config', cfg.get());
    dcs.rebuild();
    broadcast('dtc-changed');
  });
  ipcMain.handle('dtc:share', () => {
    const d = dcs.mission && dcs.mission.dtc;
    if (!d || !d.file) { toast('No hay ningún DTC en uso para enviar', 'warn'); return false; }
    let ok = false;
    try { ok = share.send({ type: 'dtc', ...DTC.pack(d.file) }); } catch (err) { toast(`No se pudo enviar: ${err.message}`, 'warn'); return false; }
    toast(ok ? `DTC «${d.name}» enviado al vuelo` : 'No estás conectado a una sala (Ajustes > Vuelo compartido)', ok ? 'info' : 'warn');
    return ok;
  });
  ipcMain.handle('dtc:installShared', (e, id) => {
    const it = inbox.find((x) => x.id === id && x.type === 'dtc');
    if (!it || !it.file || !fs.existsSync(it.file)) return { error: 'Ya no está disponible' };
    try {
      const res = useDtcFile(it.file, { name: it.name });
      toast(`DTC «${it.name}» de ${it.from || 'el vuelo'} en uso. Cárgalo en cabina desde la página DTC de tu avión.`);
      return res;
    } catch (err) {
      return { error: err.message };
    }
  });
  ipcMain.handle('dtc:radios', (e, file) => {
    try {
      return radiosFromDtc(JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch {
      return [];
    }
  });

  ipcMain.handle('bind:capture', (e, action) => input.beginCapture(action));
  ipcMain.handle('bind:cancel', () => input.cancelCapture());
  ipcMain.handle('bind:describe', (e, combo) => combo.map((c) => input.describe(c)));

  ipcMain.handle('integration:status', () => ({
    hooks: integ.hookStatus(HOOK_SRC),
    layer: integ.layerStatus(LAYER_MANIFEST),
    savedGames: integ.savedGamesDirs(),
    dcsConnected: dcs.connected(),
    routeSources: dcs.sources || null,
    vrActive: vr ? vr.active : false,
  }));
  ipcMain.handle('integration:install', (e, what) => {
    const res = {};
    try {
      if (what.hook) { res.hook = integ.installHook(HOOK_SRC); cfg.patch({ integration: { hook: true } }); }
      if (what.layer) { integ.registerLayer(LAYER_MANIFEST); res.layer = true; cfg.patch({ integration: { layer: true } }); }
    } catch (err) {
      res.error = err.message;
    }
    return res;
  });
  ipcMain.handle('integration:uninstall', (e, what) => {
    if (what.hook) cfg.patch({ integration: { hook: false } });
    if (what.layer) cfg.patch({ integration: { layer: false } });
    if (what.hook) integ.uninstallHook();
    if (what.layer) integ.unregisterLayer(LAYER_MANIFEST);
    return true;
  });

  ipcMain.handle('vr:recenter', () => vr && vr.recenter());

  // Biblioteca (compatible con KneeboardManager)
  const libStatus = () => ({
    root: library.root(),
    defaultRoot: library.defaultRoot(),
    sets: library.listSets().map((s) => ({ ...s, pages: s.pages.map((p) => ({ ...p, url: fileUrl(p.path) })) })),
    aircraft: library.knownAircraft(),
  });
  const libChanged = () => { broadcast('library-changed'); return libStatus(); };
  ipcMain.handle('library:status', () => libStatus());
  ipcMain.handle('library:detect', () => library.detect());
  ipcMain.handle('library:setRoot', (e, root) => { cfg.patch({ library: { root } }); return libChanged(); });
  ipcMain.handle('library:create', (e, name, aircrafts) => { library.createSet(name, aircrafts); return libChanged(); });
  ipcMain.handle('library:rename', (e, dir, name) => { library.renameSet(dir, name); return libChanged(); });
  ipcMain.handle('library:meta', (e, dir, p) => { library.writeMeta(dir, p); return libChanged(); });
  ipcMain.handle('library:import', (e, dir, files) => { library.importFiles(dir, files); return libChanged(); });
  ipcMain.handle('library:savePages', (e, setName, base, dataUrls, opts = {}) => {
    const dir = library.setDir(setName);
    const set = library.savePages(dir, base, dataUrls, opts);
    if (opts.aircraft && !set.aircrafts.includes(opts.aircraft)) library.writeMeta(dir, { aircrafts: [...set.aircrafts, opts.aircraft] });
    return libChanged();
  });
  ipcMain.handle('library:pages', (e, aircraft) => library.pagesFor(aircraft).map((p) => ({ ...p, url: fileUrl(p.path) })));
  ipcMain.handle('library:apply', () => library.applyToDcs());
  ipcMain.handle('library:remove', () => library.removeFromDcs());
  ipcMain.handle('library:inject', (e, miz, opts) => library.injectIntoMiz(miz, opts));
  ipcMain.handle('library:trash', async (e, dir) => { await shell.trashItem(dir); return libChanged(); });
  ipcMain.handle('library:trashFiles', async (e, files) => {
    for (const f of files || []) { try { await shell.trashItem(f); } catch { /* ya no está */ } }
    return libChanged();
  });
  ipcMain.handle('library:open', (e, dir) => shell.openPath(dir));

  // Captura de una zona de la ventana (para guardar páginas generadas en la biblioteca)
  ipcMain.handle('capture:rect', async (e, rect) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const img = await win.webContents.capturePage({ x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) });
    return img.toDataURL();
  });

  // Curso de DKS
  ipcMain.handle('course:get', () => course);
  ipcMain.handle('course:load', (e, file) => {
    course = readCourse(file);
    if (course && !course.error) cfg.patch({ course: { file } });
    broadcast('course', course);
    return course;
  });

  // Libro de vuelo y tiempos de bloque
  ipcMain.handle('logbook:get', () => ({ blocks: dcs.blocks, entries: loadStore('logbook') || [] }));
  ipcMain.handle('logbook:clear', () => { saveStore('logbook', []); broadcast('logbook', []); });
  ipcMain.handle('dtc:auto', (e, type) => resolveDtc(type, dcs.missionSrc && dcs.missionSrc.miz, dcs.dtcContext()));
  ipcMain.handle('voice:status', () => voice.status);
  ipcMain.handle('timer', (e, cmd) => timerCmd(cmd));
  ipcMain.handle('messages:clear', () => { dcs.messages.length = 0; broadcast('messages-cleared'); });
  ipcMain.handle('dcs:kbprobe', () => dcs.request({ cmd: 'kbprobe' }, 4000));
  ipcMain.handle('store:get', (e, name) => loadStore(name));
  ipcMain.on('store:set', (e, name, data) => {
    saveStore(name, data);
    for (const w of views) if (w && !w.isDestroyed() && w.webContents !== e.sender) w.webContents.send('store-changed', name, data);
  });
  ipcMain.handle('tabs:reset', () => {
    cfg.patch({ tabs: defaultTabs() });
    broadcast('config', cfg.get());
  });
  ipcMain.handle('tabs:applyPreset', (e, id) => applyPreset(id));
  ipcMain.handle('tabs:templates', () => TEMPLATES.map(({ id, label, desc }) => ({ id, label, desc })));
  ipcMain.handle('tabs:template', (e, id) => {
    cfg.patch({ tabs: templateTabs(id, cfg.get().tabs) });
    broadcast('config', cfg.get());
    return cfg.get();
  });
  ipcMain.handle('capture:sources', async () => {
    const src = await desktopCapturer.getSources({ types: ['window', 'screen'], thumbnailSize: { width: 0, height: 0 } });
    return src.map((s) => ({ id: s.id, name: s.name }));
  });
  ipcMain.handle('app:settings', (e, section) => openSettings(section));
  ipcMain.handle('app:external', (e, url) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
  });
  ipcMain.handle('app:focusDcs', () => focus.focusDcs());
  ipcMain.handle('app:quit', () => { quitting = true; app.quit(); });

  // Actualizaciones
  ipcMain.handle('update:status', () => updater.state);
  ipcMain.handle('update:check', () => updater.check());
  ipcMain.handle('update:install', () => { quitting = true; updater.install(); });

  // Perfil: exportar / importar configuración y datos
  ipcMain.handle('profile:export', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const r = await dialog.showSaveDialog(win, {
      title: 'Exportar perfil de LF Kneeboard',
      defaultPath: path.join(app.getPath('documents'), `LF Kneeboard - perfil ${stamp}.zip`),
      filters: [{ name: 'Perfil de LF Kneeboard', extensions: ['zip'] }],
    });
    if (r.canceled || !r.filePath) return null;
    flushStores();
    cfg.save(true);
    try {
      return profile.exportProfile(r.filePath, { config: cfg.get(), userData: app.getPath('userData'), version: app.getVersion() });
    } catch (err) { return { error: err.message }; }
  });
  ipcMain.handle('profile:import', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const r = await dialog.showOpenDialog(win, { title: 'Importar perfil de LF Kneeboard', properties: ['openFile'], filters: [{ name: 'Perfil de LF Kneeboard', extensions: ['zip'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    let p;
    try { p = profile.readProfile(r.filePaths[0]); } catch (err) { return { error: err.message }; }
    const ok = await dialog.showMessageBox(win, {
      type: 'question', buttons: ['Importar y reiniciar', 'Cancelar'], defaultId: 0, cancelId: 1, noLink: true,
      title: 'Importar perfil',
      message: `¿Importar el perfil del ${new Date(p.meta.date).toLocaleDateString('es-ES')} (versión ${p.meta.version})?`,
      detail: `Se reemplazan tus pestañas, controles, temas y ajustes, y ${p.stores.length} archivos de datos (marcadores, nombres de puntos, tarjetas, bloc…). La posición de las ventanas y lo instalado en DCS se quedan como están. LF Kneeboard se reiniciará.`,
    });
    if (ok.response !== 0) return null;
    // Lo que hay en memoria no debe pisar lo importado al cerrar.
    for (const n of Object.keys(storeTimers)) { clearTimeout(storeTimers[n]); delete storeTimers[n]; }
    for (const n of Object.keys(store)) delete store[n];
    profile.writeStores(app.getPath('userData'), p.stores);
    cfg.data = profile.mergeConfig(cfg.get(), p.config);
    cfg.save(true);
    quitting = true;
    app.relaunch();
    app.quit();
    return { ok: true };
  });
}

function safeReaddir(d) {
  try {
    return fs.readdirSync(d);
  } catch {
    return [];
  }
}

const EXT = { images: /\.(png|jpe?g|webp|gif|bmp)$/i, pdf: /\.pdf$/i, docs: /\.(png|jpe?g|webp|gif|bmp|pdf)$/i };
// Miniatura de una página (para el índice): se genera una vez y se guarda en userData\miniaturas.
// Así el índice de 150 páginas no tiene que cargar 150 imágenes a tamaño completo.
const thumbJobs = new Map();
function thumbnail(p) {
  let st;
  try { st = fs.statSync(p); } catch { return null; }
  const key = require('crypto').createHash('sha1').update(`${p}|${st.size}|${st.mtimeMs}`).digest('hex').slice(0, 16);
  const dir = path.join(app.getPath('userData'), 'miniaturas');
  const out = path.join(dir, `${key}.jpg`);
  if (fs.existsSync(out)) return fileUrl(out);
  if (!thumbJobs.has(key)) {
    thumbJobs.set(key, (async () => {
      let img;
      try { img = await nativeImage.createThumbnailFromPath(p, { width: 240, height: 320 }); } catch { img = null; }
      if (!img || img.isEmpty()) {
        const full = nativeImage.createFromPath(p);
        if (full.isEmpty()) return null;
        img = full.resize({ width: 240, quality: 'good' });
      }
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(out, img.toJPEG(80));
      return fileUrl(out);
    })().finally(() => thumbJobs.delete(key)));
  }
  return thumbJobs.get(key);
}

function listFiles(dir, kind = 'images') {
  if (!dir) return [];
  const re = EXT[kind] || EXT.images;
  return safeReaddir(dir)
    .filter((f) => re.test(f))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
    .map((f) => ({ name: f, url: fileUrl(path.join(dir, f)), path: path.join(dir, f) }));
}

// ------------------------------------------------------------------ arranque
app.whenReady().then(() => {
  cfg = new Config(app.getPath('userData'));
  registerProtocols();

  dcs = new DcsLink(cfg);
  dcs.on('live', (l) => {
    broadcast('live', l);
    updateCrosshair(l);
  });
  dcs.on('mission', (m) => broadcast('mission', m));
  dcs.on('phase', (p) => broadcast('phase', p));
  dcs.on('message', (m) => broadcast('dcs-message', m));
  dcs.on('connection', (c) => {
    broadcast('connected', c);
    updateTray();
  });
  dcs.on('error', (e) => console.error('DCS', e.message));
  dcs.on('log', (m) => console.log('DCS', m));
  if (!TEST_OFFSCREEN) {
    dcs.start(); // en las pruebas no se escucha al DCS real
    // Mantener la integración que activó el usuario: actualizar el script de DCS si es antiguo,
    // volver a ponerlo si falta (una versión anterior lo borraba al actualizar) y registrar la capa VR.
    try {
      const integ0 = cfg.get().integration || {};
      const status = integ.hookStatus(HOOK_SRC);
      const wantHook = integ0.hook !== false && (integ0.hook || status.some((h) => h.state !== 'no instalado') || !cfg.get().firstRun);
      if (wantHook && status.some((h) => h.state !== 'instalado')) {
        integ.installHook(HOOK_SRC);
        cfg.patch({ integration: { hook: true } });
        console.log('Script de DCS instalado / actualizado');
      }
      const wantLayer = integ0.layer !== false && (integ0.layer || (!cfg.get().firstRun && cfg.get().vr.enabled));
      if (wantLayer && !integ.layerStatus(LAYER_MANIFEST).registered) {
        integ.registerLayer(LAYER_MANIFEST);
        cfg.patch({ integration: { layer: true } });
      }
    } catch (e) { console.error('Integración', e.message); }
    // DCS abierto pero sin datos: el script no está cargado (DCS se abrió antes de instalarlo) o estás en el menú.
    setInterval(() => {
      const open = !!focus.dcsWindow();
      const st = dcs.connected() ? 'on' : open ? 'open' : 'off';
      if (st !== dcsState) { dcsState = st; broadcast('dcs-state', st); updateTray(); }
    }, 2000);
  }

  input = new Input(cfg, path.join(NATIVE, 'lfkb-input.exe'));
  input.on('action', doAction);
  input.on('captured', (r) => broadcast('bind:captured', r));
  input.on('capture-progress', (names) => broadcast('bind:progress', names));
  input.on('devices', (d) => broadcast('devices', d));
  input.on('log', (m) => console.log('Input', m));
  input.on('tablet', onTablet);
  input.on('tablet-status', (s) => broadcast('tablet-status', s));
  if (!TEST_OFFSCREEN) input.start();
  else if (process.env.LFKB_TABLET_GO) input.start(['--solo-tableta']); // pruebas de la tableta: sin teclado ni mandos

  vr = new VrBridge();
  vr.on('log', (m) => console.log('VR', m));
  vr.start();
  vr.on('gaze', (i, g) => sendToView(i, 'gaze', g));
  vr.on('active', (a) => broadcast('vr-active', a));

  share = new Share(cfg);
  share.on('status', (s) => broadcast('share-status', s));
  share.on('roster', (m) => broadcast('share-roster', m));
  share.on('log', (m) => console.log('Share', m));
  share.on('item', (item) => {
    if (item.type === 'ink' || item.type === 'mapink' || item.type === 'clear') {
      broadcast('share-live', item);
      return;
    }
    if (item.type === 'dtc') {
      // El DTC llega comprimido: se guarda aparte y solo se usa si el piloto lo acepta.
      try {
        const r = DTC.unpack(item, path.join(app.getPath('userData'), 'dtc-recibidos'));
        pushInbox({ type: 'dtc', from: item.from, name: r.name, aircraftType: r.type, file: r.file, at: Date.now(), id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}` });
        toast(`${item.from || 'Vuelo'}: DTC «${r.name}» (${r.type}). Ábrelo en Compartido para usarlo.`, 'share');
      } catch (err) {
        toast(`Ha llegado un DTC que no se puede leer: ${err.message}`, 'warn');
      }
      return;
    }
    pushInbox({ ...item, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}` });
    if (cfg.get().share.notify) toast(`${item.from || 'Vuelo'}: ${item.type === 'page' ? `página «${item.title}»` : item.type === 'point' ? 'punto' : 'nota'}`, 'share');
  });
  share.apply();

  library = new Library(cfg, app.getPath('userData'));
  if (!cfg.get().library.root) {
    const found = library.detect();
    if (found.length) cfg.patch({ library: { root: found[0] } });
  }
  course = readCourse(cfg.get().course.file);

  voice = new Voice(cfg, VOICE_SCRIPT);
  voice.on('status', (s) => broadcast('voice-status', s));
  voice.on('heard', (h) => broadcast('voice-heard', h));
  voice.on('listening', (on) => broadcast('voice-listening', on));
  voice.on('command', onVoiceCommand);
  input.on('action-release', (a) => { if (a === 'voice_ptt') voice.listen(false); });
  voice.apply();

  dcs.on('blocks', (b) => broadcast('blocks', b));

  dcs.dtcResolver = resolveDtc;
  // Si cargas o cambias un DTC (DKS, DCS-DTC, el editor…), la ruta y las radios se actualizan solas.
  let dtcTimer = null;
  for (const d of integ.dtcDirs()) {
    try {
      fs.watch(d, { recursive: true }, () => {
        clearTimeout(dtcTimer);
        dtcTimer = setTimeout(() => { dcs.rebuild(); broadcast('dtc-changed'); }, 800);
      });
    } catch { /* sin permisos */ }
  }
  dcs.on('logbook', (entry) => {
    const list = loadStore('logbook') || [];
    list.unshift(entry);
    saveStore('logbook', list.slice(0, 500));
    broadcast('logbook', loadStore('logbook'));
  });

  updater = new Updater(cfg, app);
  updater.on('status', (s) => broadcast('update-status', s));
  updater.on('ready', (v) => toast(`LF Kneeboard ${v} descargado: se instalará al cerrar el programa`));
  if (!TEST_OFFSCREEN) updater.start();

  registerIpc();
  createView(0);
  if (cfg.get().dual) createView(1);

  const iconPath = path.join(ROOT, 'src', 'renderer', 'assets', 'tray.png');
  tray = new Tray(fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty());
  tray.on('click', () => setHidden(!cfg.get().hidden));
  updateTray();

  if (cfg.get().firstRun) {
    openSettings('bienvenida');
  }

  screen.on('display-metrics-changed', () => views.forEach((_, i) => applyWindowState(i)));
  if (process.env.LFKB_SNAPSHOT) require('./snapshot').run({ cfg, dcs, views, vr, broadcast, updater, injectShare: (item) => share.emit('item', item), openSettings: () => { openSettings(); return settingsWin; } });
});

function flushStores() {
  for (const n of Object.keys(storeTimers)) {
    clearTimeout(storeTimers[n]);
    delete storeTimers[n];
    if (store[n] != null) fs.writeFileSync(storeFile(n), JSON.stringify(store[n]));
  }
}

app.on('before-quit', () => {
  quitting = true;
  cfg && cfg.save(true);
  input && input.stop();
  vr && vr.stop();
  share && share.stop();
  voice && voice.stop();
  if (dcs) dcs.resetBlocks();
  for (const n of Object.keys(storeTimers)) {
    clearTimeout(storeTimers[n]);
    if (store[n] != null) fs.writeFileSync(storeFile(n), JSON.stringify(store[n]));
  }
});

app.on('window-all-closed', () => {
  if (quitting) app.quit();
});
