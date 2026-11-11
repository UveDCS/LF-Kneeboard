// Instalación de la integración: hook de DCS en Saved Games y registro de la capa OpenXR (solo usuario actual).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HOOK_NAME = 'LFKneeboard-hook.lua';
// Mod que DCS carga en el Lua de su interfaz (puente con la herramienta de ruta del F10 y el editor de DTC).
// Va junto al hook: se instala, actualiza y quita con él.
const MOD_REL = path.join('Mods', 'Services', 'LFKneeboard');

// Archivos del mod (rutas relativas a la carpeta del mod) que acompañan a un hook de origen.
function modFiles(srcHook) {
  const root = path.join(path.dirname(path.dirname(srcHook)), MOD_REL);
  const out = [];
  const walk = (rel) => {
    let list = [];
    try { list = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      const r = path.join(rel, e.name);
      if (e.isDirectory()) walk(r); else out.push({ src: path.join(root, r), rel: r });
    }
  };
  walk('');
  return out;
}

const same = (a, b) => {
  try { return fs.readFileSync(a).equals(fs.readFileSync(b)); } catch { return false; }
};

function installTo(dir, srcHook) {
  const hooks = path.join(dir, 'Scripts', 'Hooks');
  fs.mkdirSync(hooks, { recursive: true });
  fs.copyFileSync(srcHook, path.join(hooks, HOOK_NAME));
  for (const f of modFiles(srcHook)) {
    const dst = path.join(dir, MOD_REL, f.rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(f.src, dst);
  }
}
const LAYER_KEY = 'HKCU\\SOFTWARE\\Khronos\\OpenXR\\1\\ApiLayers\\Implicit';

// ------------------------------------------------------------------ carpetas de DCS
// DCS escribe en Saved Games\DCS (o DCS.openbeta…). Saved Games puede estar en otro disco o llamarse distinto
// («Ubicación» en sus propiedades): se pregunta a Windows dónde está. Además, el usuario puede elegir carpetas a mano.
const SAVED_GAMES_ID = '{4C5C32FF-BB9D-43B0-B5B4-2D72E54EAAA4}';
const STD_NAME = /^DCS(\.openbeta|\.release|\.server)?$/i;
const DCS_NAME = /^DCS(\..+)?$/i;
const choice = { auto: true, dirs: [] };
let windowsCache;

const isDir = (p) => {
  try { return fs.statSync(p).isDirectory(); } catch { return false; } // sigue enlaces y junctions
};
// Carpeta en la que ya ha escrito DCS.
const looksLikeDcs = (dir) => ['Config', 'Logs', 'Scripts', 'MissionEditor'].some((s) => isDir(path.join(dir, s)));
const keyOf = (p) => {
  try { return fs.realpathSync.native(p).toLowerCase(); } catch { return path.resolve(p).toLowerCase(); }
};
function uniq(list) {
  const seen = new Set();
  return list.filter((p) => { const k = keyOf(p); if (seen.has(k)) return false; seen.add(k); return true; });
}
const expandEnv = (s) => s.replace(/%([^%]+)%/g, (all, v) => (process.env[v] !== undefined ? process.env[v] : all));

// Saved Games según Windows. LFKB_SAVED_GAMES: otra carpeta, solo en las pruebas.
function windowsSavedGames() {
  if (process.env.LFKB_SAVED_GAMES !== undefined) return process.env.LFKB_SAVED_GAMES || null;
  if (windowsCache !== undefined) return windowsCache;
  windowsCache = null;
  for (const key of ['User Shell Folders', 'Shell Folders']) {
    try {
      const out = reg(['query', `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\${key}`, '/v', SAVED_GAMES_ID]);
      const m = /REG_(?:EXPAND_)?SZ\s+(.+?)\s*$/m.exec(out);
      if (m) { windowsCache = path.resolve(expandEnv(m[1])); break; }
    } catch { /* no está en el registro: la de siempre */ }
  }
  return windowsCache;
}

// Carpetas DCS* dentro de una Saved Games. Los nombres de siempre valen aunque DCS no haya escrito aún;
// los demás (DCS.mi_servidor, de la opción -w) solo si DCS ya ha escrito en ellos.
function scanBase(base) {
  let names = [];
  try { names = fs.readdirSync(base); } catch { return []; }
  return names.filter((n) => DCS_NAME.test(n)).map((n) => path.join(base, n))
    .filter((p) => isDir(p) && (STD_NAME.test(path.basename(p)) || looksLikeDcs(p)));
}

// La que dice Windows; la de tu usuario solo si Windows no dice nada (si la moviste, la vieja ya no la usa DCS).
function savedGamesBases() {
  const win = windowsSavedGames();
  return [win && isDir(win) ? win : path.join(os.homedir(), 'Saved Games')].filter(isDir);
}
const detectedDirs = () => uniq(savedGamesBases().flatMap(scanBase));

// Elección del usuario (config.integration): autoDetect (por defecto sí) y dcsDirs (carpetas elegidas a mano).
function configure(integration = {}) {
  choice.auto = integration.autoDetect !== false;
  choice.dirs = Array.isArray(integration.dcsDirs) ? integration.dcsDirs.filter((d) => typeof d === 'string' && d) : [];
}

function savedGamesDirs() {
  return uniq([...(choice.auto ? detectedDirs() : []), ...choice.dirs.filter(isDir)]);
}

// Lo que enseña Ajustes: dónde dice Windows que está Saved Games, qué se ha encontrado solo y qué se ha elegido.
function dirsInfo() {
  return {
    windows: windowsSavedGames(),
    auto: choice.auto,
    detected: detectedDirs(),
    manual: choice.dirs.map((dir) => ({ dir, exists: isDir(dir), dcs: isDir(dir) && looksLikeDcs(dir) })),
  };
}

// Carpeta elegida en el diálogo: si es la propia Saved Games, se toman las DCS* que tenga dentro.
function resolvePicked(dir) {
  if (STD_NAME.test(path.basename(dir)) || looksLikeDcs(dir)) return { dirs: [dir], dcs: looksLikeDcs(dir) };
  const inside = scanBase(dir);
  if (inside.length) return { dirs: inside, dcs: true };
  return { dirs: [dir], dcs: false };
}

function hookStatus(srcHook, dirs = savedGamesDirs()) {
  const src = fs.readFileSync(srcHook, 'utf8');
  return dirs.map((dir) => {
    const dst = path.join(dir, 'Scripts', 'Hooks', HOOK_NAME);
    let state = 'no instalado';
    if (fs.existsSync(dst)) {
      const modOk = modFiles(srcHook).every((f) => same(f.src, path.join(dir, MOD_REL, f.rel)));
      state = fs.readFileSync(dst, 'utf8') === src && modOk ? 'instalado' : 'desactualizado';
    }
    return { dir, file: dst, state };
  });
}

function installHook(srcHook, dirs = savedGamesDirs()) {
  const done = [];
  for (const dir of dirs) {
    installTo(dir, srcHook);
    done.push(dir);
  }
  return done;
}

// Al abrir la app: si el hook ya está instalado pero es de una versión anterior, se actualiza
// (solo donde ya estaba; DCS lo carga la próxima vez que arranque).
function updateInstalledHooks(srcHook) {
  const updated = [];
  for (const h of hookStatus(srcHook)) {
    if (h.state !== 'desactualizado') continue;
    try {
      installTo(h.dir, srcHook);
      updated.push(h.dir);
    } catch { /* DCS lo tiene bloqueado: se reintenta en el próximo arranque */ }
  }
  return updated;
}

function uninstallHook(dirs = savedGamesDirs()) {
  for (const dir of dirs) {
    fs.rmSync(path.join(dir, 'Scripts', 'Hooks', HOOK_NAME), { force: true });
    fs.rmSync(path.join(dir, MOD_REL), { recursive: true, force: true });
  }
}

// Lista de carpetas con el script puesto, para que el desinstalador lo quite también fuera de C:
// (UTF-16LE sin BOM, una por línea: lo lee FileReadUTF16LE de NSIS). Se suman las de la lista anterior que aún lo tengan.
function writeInstalledList(file) {
  let prev = [];
  try { prev = fs.readFileSync(file).toString('utf16le').split(/\r?\n/).filter(Boolean); } catch { /* primera vez */ }
  const dirs = uniq([...savedGamesDirs(), ...prev]).filter((d) => fs.existsSync(path.join(d, 'Scripts', 'Hooks', HOOK_NAME)));
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(dirs.map((d) => `${d}\r\n`).join(''), 'utf16le'));
  } catch { /* sin permisos: el desinstalador limpia al menos la ruta de siempre */ }
  return dirs;
}

function reg(args) {
  return execFileSync('reg', args, { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
}

function registeredLayers() {
  try {
    return reg(['query', LAYER_KEY]).split(/\r?\n/)
      .map((l) => /^\s+(.+?\.json)\s+REG_DWORD\s+0x([0-9a-f]+)/i.exec(l))
      .filter(Boolean)
      .map((m) => ({ path: m[1], disabled: parseInt(m[2], 16) !== 0 }));
  } catch {
    return [];
  }
}

function layerStatus(manifest) {
  const mine = registeredLayers().find((l) => path.resolve(l.path).toLowerCase() === path.resolve(manifest).toLowerCase());
  const others = registeredLayers().filter((l) => /kneeboard/i.test(l.path) && l !== mine);
  return { registered: !!mine && !mine.disabled, manifest, others };
}

function registerLayer(manifest) {
  // Quita registros antiguos de esta app (otra carpeta de instalación) y registra el actual.
  for (const l of registeredLayers()) {
    if (/lfkb_openxr_layer\.json$/i.test(l.path) && path.resolve(l.path) !== path.resolve(manifest)) {
      try { reg(['delete', LAYER_KEY, '/v', l.path, '/f']); } catch { /* ya no está */ }
    }
  }
  reg(['add', LAYER_KEY, '/v', manifest, '/t', 'REG_DWORD', '/d', '0', '/f']);
}

function unregisterLayer(manifest) {
  try { reg(['delete', LAYER_KEY, '/v', manifest, '/f']); } catch { /* no estaba */ }
}

// Registro que escribe la capa OpenXR dentro de DCS (se rehace cada vez que DCS la carga).
// LFKB_LAYER_LOG: otro archivo, solo en las pruebas.
const LAYER_LOG = process.env.LFKB_LAYER_LOG || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'LF Kneeboard', 'openxr-layer.log');

// Resume el último arranque de DCS en VR: si cargó la capa, si abrió sesión, si conectó y, si no, por qué.
function layerLog(file = LAYER_LOG) {
  let text;
  let at;
  try {
    text = fs.readFileSync(file, 'utf8');
    at = fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
  const lines = text.split(/\r?\n/).map((l) => l.replace(/^\[[\d:]+\]\s*/, '').trim()).filter(Boolean);
  const lastIdx = (re) => {
    for (let i = lines.length - 1; i >= 0; i--) if (re.test(lines[i])) return i;
    return -1;
  };
  const conn = lastIdx(/^Conectado con LF Kneeboard/);
  const prob = lastIdx(/^Sin conexión|^Sesión sin Direct3D|versión distinta/);
  const elev = lastIdx(/^DCS se ejecuta/);
  return {
    file,
    at,
    loaded: lastIdx(/^Instancia OpenXR creada/) >= 0,
    session: lastIdx(/^Sesión D3D11 creada/) >= 0,
    connected: conn >= 0,
    problem: prob > conn ? lines[prob] : null,
    dcsElevated: elev >= 0 ? /como administrador/.test(lines[elev]) : null,
    lines: lines.slice(-20),
  };
}

function dcsKneeboardDirs(aircraft) {
  const out = [];
  for (const dir of savedGamesDirs()) {
    const kb = path.join(dir, 'Kneeboard');
    if (!fs.existsSync(kb)) continue;
    if (aircraft) {
      try {
        for (const d of fs.readdirSync(kb, { withFileTypes: true })) {
          if (d.isDirectory() && d.name.toLowerCase() === String(aircraft).toLowerCase()) out.push(path.join(kb, d.name));
        }
      } catch { /* sin permisos */ }
    }
  }
  return out;
}

function dtcDirs() {
  // LFKB_DTC_DIR: carpeta de pruebas (para no tocar los DTC de verdad).
  if (process.env.LFKB_DTC_DIR) return [process.env.LFKB_DTC_DIR];
  const all = savedGamesDirs().map((d) => path.join(d, 'DTC'));
  const found = all.filter((d) => fs.existsSync(d));
  return found.length ? found : all.slice(0, 1);
}

module.exports = {
  HOOK_NAME, MOD_REL, savedGamesDirs, hookStatus, installHook, installTo, modFiles, uninstallHook, updateInstalledHooks,
  configure, dirsInfo, resolvePicked, windowsSavedGames, writeInstalledList,
  layerStatus, registerLayer, unregisterLayer, dcsKneeboardDirs, dtcDirs, layerLog, LAYER_LOG,
};
