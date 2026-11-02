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

function savedGamesDirs() {
  const base = path.join(os.homedir(), 'Saved Games');
  let dirs = [];
  try {
    dirs = fs.readdirSync(base, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^DCS(\.openbeta|\.release|\.server)?$/i.test(d.name))
      .map((d) => path.join(base, d.name));
  } catch {
    /* sin Saved Games */
  }
  return dirs;
}

function hookStatus(srcHook) {
  const src = fs.readFileSync(srcHook, 'utf8');
  return savedGamesDirs().map((dir) => {
    const dst = path.join(dir, 'Scripts', 'Hooks', HOOK_NAME);
    let state = 'no instalado';
    if (fs.existsSync(dst)) {
      const modOk = modFiles(srcHook).every((f) => same(f.src, path.join(dir, MOD_REL, f.rel)));
      state = fs.readFileSync(dst, 'utf8') === src && modOk ? 'instalado' : 'desactualizado';
    }
    return { dir, file: dst, state };
  });
}

function installHook(srcHook) {
  const done = [];
  for (const dir of savedGamesDirs()) {
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

function uninstallHook() {
  for (const dir of savedGamesDirs()) {
    fs.rmSync(path.join(dir, 'Scripts', 'Hooks', HOOK_NAME), { force: true });
    fs.rmSync(path.join(dir, MOD_REL), { recursive: true, force: true });
  }
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
  layerStatus, registerLayer, unregisterLayer, dcsKneeboardDirs, dtcDirs,
};
