// Lectura de archivos .miz: tablas Lua serializadas por DCS, diccionario e imágenes de kneeboard.
const fs = require('fs');
const path = require('path');
const os = require('os');
const AdmZip = require('adm-zip');

// Parser de las tablas Lua que escribe DCS (literal de tabla, sin código).
function parseLuaTable(src) {
  let i = 0;
  const n = src.length;

  function skip() {
    for (;;) {
      while (i < n && /\s/.test(src[i])) i++;
      if (src.startsWith('--', i)) {
        if (src.startsWith('--[[', i)) {
          const end = src.indexOf(']]', i + 4);
          i = end < 0 ? n : end + 2;
        } else {
          while (i < n && src[i] !== '\n') i++;
        }
        continue;
      }
      return;
    }
  }

  function str() {
    const q = src[i++];
    let out = '';
    while (i < n) {
      const c = src[i++];
      if (c === q) return out;
      if (c === '\\') {
        const e = src[i++];
        if (e === 'n') out += '\n';
        else if (e === 't') out += '\t';
        else if (e === 'r') out += '\r';
        else if (e === '\n') out += '\n';
        else if (e === '\r') { out += '\n'; if (src[i] === '\n') i++; }
        else if (/[0-9]/.test(e)) {
          let d = e;
          while (d.length < 3 && /[0-9]/.test(src[i])) d += src[i++];
          out += String.fromCharCode(parseInt(d, 10));
        } else out += e;
      } else out += c;
    }
    throw new Error('Cadena sin cerrar');
  }

  function longStr() {
    const m = /^\[(=*)\[/.exec(src.slice(i, i + 20));
    const close = `]${m[1]}]`;
    const start = i + m[0].length;
    const end = src.indexOf(close, start);
    i = end + close.length;
    return src.slice(start, end).replace(/^\r?\n/, '');
  }

  function num() {
    const m = /^-?(0[xX][0-9a-fA-F]+|(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?)/.exec(src.slice(i, i + 64));
    if (!m) throw new Error(`Número no válido en ${i}`);
    i += m[0].length;
    return Number(m[0]);
  }

  function value() {
    skip();
    const c = src[i];
    if (c === '{') return table();
    if (c === '"' || c === "'") return str();
    if (c === '[' && /^\[=*\[/.test(src.slice(i, i + 10))) return longStr();
    if (src.startsWith('true', i)) { i += 4; return true; }
    if (src.startsWith('false', i)) { i += 5; return false; }
    if (src.startsWith('nil', i)) { i += 3; return null; }
    return num();
  }

  function table() {
    i++; // {
    const obj = {};
    let arrIdx = 1;
    for (;;) {
      skip();
      if (src[i] === '}') { i++; break; }
      let key;
      if (src[i] === '[' && !/^\[=*\[/.test(src.slice(i, i + 10))) {
        i++;
        key = value();
        skip();
        i++; // ]
        skip();
        i++; // =
        obj[key] = value();
      } else {
        const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i, i + 128));
        const save = i;
        if (m) {
          i += m[0].length;
          skip();
          if (src[i] === '=' && src[i + 1] !== '=') {
            i++;
            obj[m[0]] = value();
          } else {
            i = save;
            obj[arrIdx++] = value();
          }
        } else {
          obj[arrIdx++] = value();
        }
      }
      skip();
      if (src[i] === ',' || src[i] === ';') i++;
    }
    return obj;
  }

  // El archivo es "nombre = { ... }"
  skip();
  const m = /^[A-Za-z_][A-Za-z0-9_]*\s*=/.exec(src.slice(i, i + 128));
  if (m) i += m[0].length;
  return value();
}

// Convierte una tabla Lua (objeto con claves 1..n, o array de JSON) en array ordenado.
function list(t) {
  if (!t) return [];
  if (Array.isArray(t)) return t.filter((v) => v != null);
  return Object.keys(t)
    .filter((k) => /^\d+$/.test(k))
    .sort((a, b) => a - b)
    .map((k) => t[k]);
}

function resolveDict(obj, dict) {
  if (!dict) return obj;
  const walk = (v) => {
    if (typeof v === 'string' && v.startsWith('DictKey_')) return dict[v] != null ? dict[v] : v;
    if (v && typeof v === 'object') {
      for (const k of Object.keys(v)) v[k] = walk(v[k]);
    }
    return v;
  };
  return walk(obj);
}

const IMG_RE = /\.(png|jpe?g|bmp|gif|webp)$/i;

// Lee un .miz. extractImages copia las páginas de kneeboard de la misión a una carpeta temporal.
function readMiz(file, { extractImages = true, aircraft = null } = {}) {
  const zip = new AdmZip(file);
  const entry = (name) => zip.getEntry(name);
  const text = (name) => {
    const e = entry(name);
    return e ? zip.readAsText(e, 'utf8') : null;
  };
  const missionSrc = text('mission');
  if (!missionSrc) throw new Error('El .miz no contiene el archivo "mission"');
  const mission = parseLuaTable(missionSrc);
  const dictSrc = text('l10n/DEFAULT/dictionary');
  const dict = dictSrc ? parseLuaTable(dictSrc) : null;
  // El bando de cada aeródromo está en «warehouses» (BLUE / RED / NEUTRAL).
  let warehouses = null;
  try { const w = text('warehouses'); warehouses = w ? parseLuaTable(w) : null; } catch { warehouses = null; }
  resolveDict(mission, dict);

  const kneeboard = { general: [], byAircraft: {} };
  for (const e of zip.getEntries()) {
    const name = e.entryName.replace(/\\/g, '/');
    if (!IMG_RE.test(name)) continue;
    let m = /^KNEEBOARD\/IMAGES\/([^/]+)$/i.exec(name);
    if (m) { kneeboard.general.push(name); continue; }
    m = /^KNEEBOARD\/([^/]+)\/IMAGES\/([^/]+)$/i.exec(name);
    if (m) (kneeboard.byAircraft[m[1]] = kneeboard.byAircraft[m[1]] || []).push(name);
  }

  let imageFiles = [];
  if (extractImages) {
    const dir = path.join(os.tmpdir(), 'lf-kneeboard', 'miz-' + Buffer.from(path.basename(file)).toString('hex').slice(0, 24));
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const wanted = [...kneeboard.general];
    for (const [ac, files] of Object.entries(kneeboard.byAircraft)) {
      if (!aircraft || ac.toLowerCase() === String(aircraft).toLowerCase()) wanted.push(...files);
    }
    wanted.sort((a, b) => path.basename(a).localeCompare(path.basename(b), undefined, { numeric: true }));
    wanted.forEach((name, idx) => {
      const out = path.join(dir, `${String(idx).padStart(3, '0')}_${path.basename(name)}`);
      fs.writeFileSync(out, zip.readFile(entry(name)));
      imageFiles.push(out);
    });
  }
  // DTC que el editor de misiones guarda dentro del .miz (carpeta DTC/); cada avión dice cuáles lleva.
  const dtcFiles = [];
  const entryPath = (e) => e.entryName.replace(/\\/g, '/');
  const dtcEntries = zip.getEntries().filter((e) => /^DTC\/[^/]+\.dtc$/i.test(entryPath(e)));
  if (dtcEntries.length) {
    const dir = path.join(os.tmpdir(), 'lf-kneeboard', 'dtc-' + Buffer.from(path.basename(file)).toString('hex').slice(0, 24));
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    for (const e of dtcEntries) {
      const out = path.join(dir, path.basename(entryPath(e)));
      fs.writeFileSync(out, zip.readFile(e));
      dtcFiles.push(out);
    }
  }
  return { mission, dict, warehouses, kneeboard, imageFiles, dtcFiles, file };
}

module.exports = { parseLuaTable, list, readMiz, resolveDict };
