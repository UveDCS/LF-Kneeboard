// Biblioteca de páginas, compatible con KneeboardManager:
// una carpeta raíz con un subdirectorio por "juego" y un kneeboard.json en cada uno
//   { "aircrafts": [...], "disabled_pages": [...], "prefix": "" }
// Añadimos "order" (orden manual de páginas); KneeboardManager lo ignora.
const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');
const integ = require('./integration');

const IMG = /\.(png|jpe?g|webp|bmp|gif)$/i;
const OWN = /^LFK \d{2}\.\d{3} /; // nombre de los archivos que copia la app (para poder quitarlos después)
const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

const COMMON_AIRCRAFT = [
  'A-10A', 'A-10C', 'A-10C_2', 'A-4E-C', 'AH-64D_BLK_II', 'AJS37', 'AV8BNA', 'C-101CC', 'C-130J-30', 'F-100D', 'F-14A-135-GR',
  'F-14A-135-GR-Early', 'F-14A-95-GR', 'F-14B', 'F-14BU', 'F-15C', 'F-15ESE', 'F-16C_50', 'F-4E-45MC', 'F-5E-3', 'F-86F Sabre',
  'FA-18C_hornet', 'JF-17', 'Ka-50_3', 'L-39C', 'M-2000C', 'Mi-24P', 'Mi-8MT', 'MiG-21Bis', 'MiG-29A', 'Mirage-F1EE',
  'SA342M', 'Su-25T', 'Su-27', 'Su-33', 'UH-1H', 'CH-47Fbl1', 'OH58D', 'P-51D-30-NA', 'SpitfireLFMkIXCW',
];

function safeReaddir(d) {
  try {
    return fs.readdirSync(d, { withFileTypes: true });
  } catch {
    return [];
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch {
    return null;
  }
}

// Quita prefijos de orden manuales tipo "9. ", "Z. ", "m. " para no duplicarlos al numerar.
const stripPrefix = (name) => name.replace(/^[0-9A-Za-z]{1,3}\.\s+/, '');

class Library {
  constructor(cfg, userData, { savedGames = integ.savedGamesDirs } = {}) {
    this.cfg = cfg;
    this.savedGames = savedGames;
    this.manifestFile = path.join(userData, 'library-applied.json');
  }

  root() {
    const r = (this.cfg.get().library || {}).root;
    return r && fs.existsSync(r) ? r : null;
  }

  // Busca una biblioteca existente de KneeboardManager en Escritorio y Documentos.
  detect() {
    const home = os.homedir();
    const bases = [path.join(home, 'Desktop'), path.join(home, 'Documents'), path.join(home, 'OneDrive', 'Desktop'), path.join(home, 'OneDrive', 'Documents')];
    const found = [];
    const isLibrary = (dir) => safeReaddir(dir).filter((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, 'kneeboard.json'))).length >= 1;
    const walk = (dir, depth) => {
      if (depth < 0 || found.length > 5) return;
      for (const d of safeReaddir(dir)) {
        if (!d.isDirectory() || /^(node_modules|\.|AppData|\$)/i.test(d.name)) continue;
        const p = path.join(dir, d.name);
        if (isLibrary(p)) found.push(p);
        else walk(p, depth - 1);
      }
    };
    for (const b of bases) if (fs.existsSync(b)) walk(b, 3);
    return found;
  }

  defaultRoot() {
    return path.join(os.homedir(), 'Documents', 'LF Kneeboard', 'Biblioteca');
  }

  ensureRoot() {
    let r = this.root();
    if (!r) {
      r = this.defaultRoot();
      fs.mkdirSync(r, { recursive: true });
    }
    return r;
  }

  readSet(dir) {
    const metaFile = path.join(dir, 'kneeboard.json');
    const meta = readJson(metaFile) || {};
    const files = safeReaddir(dir).filter((d) => d.isFile() && IMG.test(d.name)).map((d) => d.name).sort(natural);
    const order = Array.isArray(meta.order) ? meta.order.filter((f) => files.includes(f)) : [];
    const ordered = [...order, ...files.filter((f) => !order.includes(f))];
    const disabled = new Set(meta.disabled_pages || []);
    return {
      name: path.basename(dir),
      dir,
      configured: fs.existsSync(metaFile),
      aircrafts: meta.aircrafts || [],
      prefix: meta.prefix || '',
      pages: ordered.map((f) => ({ file: f, path: path.join(dir, f), disabled: disabled.has(f) })),
    };
  }

  listSets() {
    const r = this.root();
    if (!r) return [];
    return safeReaddir(r)
      .filter((d) => d.isDirectory())
      .map((d) => this.readSet(path.join(r, d.name)))
      .filter((s) => s.configured || s.pages.length)
      .sort((a, b) => natural(a.name, b.name));
  }

  writeMeta(dir, patch) {
    const file = path.join(dir, 'kneeboard.json');
    const meta = { aircrafts: [], prefix: '', ...(readJson(file) || {}), ...patch };
    fs.writeFileSync(file, JSON.stringify(meta, null, 4));
    return this.readSet(dir);
  }

  setDir(name) {
    const r = this.ensureRoot();
    const dir = path.join(r, name);
    if (path.dirname(path.resolve(dir)) !== path.resolve(r)) throw new Error('Nombre de juego no válido');
    return dir;
  }

  createSet(name, aircrafts = []) {
    const clean = String(name).replace(/[<>:"/\\|?*]/g, '').trim() || 'Nuevo juego';
    const dir = this.setDir(clean);
    fs.mkdirSync(dir, { recursive: true });
    return this.writeMeta(dir, { aircrafts });
  }

  renameSet(dir, newName) {
    const clean = String(newName).replace(/[<>:"/\\|?*]/g, '').trim();
    if (!clean) return this.readSet(dir);
    const dst = path.join(path.dirname(dir), clean);
    fs.renameSync(dir, dst);
    return this.readSet(dst);
  }

  importFiles(dir, files) {
    for (const f of files) {
      if (!IMG.test(f)) continue;
      let dst = path.join(dir, path.basename(f));
      let n = 2;
      while (fs.existsSync(dst)) dst = path.join(dir, path.basename(f).replace(/(\.\w+)$/, ` (${n++})$1`));
      fs.copyFileSync(f, dst);
    }
    return this.readSet(dir);
  }

  // Páginas en PNG (data URL) generadas en la interfaz (PDF importado, tarjetas de vuelo).
  savePages(dir, base, dataUrls, { replace = false } = {}) {
    fs.mkdirSync(dir, { recursive: true });
    if (replace) {
      for (const d of safeReaddir(dir)) if (d.isFile() && d.name.startsWith(`${base}-`) && IMG.test(d.name)) fs.rmSync(path.join(dir, d.name));
    }
    dataUrls.forEach((u, i) => {
      const b64 = String(u).replace(/^data:image\/\w+;base64,/, '');
      fs.writeFileSync(path.join(dir, `${base}-${String(i + 1).padStart(3, '0')}.png`), Buffer.from(b64, 'base64'));
    });
    if (!fs.existsSync(path.join(dir, 'kneeboard.json'))) this.writeMeta(dir, {});
    return this.readSet(dir);
  }

  // Páginas activas para un avión, en el orden de los juegos (como las vería DCS).
  pagesFor(aircraft) {
    if (!aircraft) return [];
    const out = [];
    for (const s of this.listSets()) {
      if (!s.aircrafts.some((a) => a.toLowerCase() === String(aircraft).toLowerCase())) continue;
      for (const p of s.pages) if (!p.disabled) out.push({ name: p.file, path: p.path, set: s.name });
    }
    return out;
  }

  knownAircraft() {
    const set = new Set(COMMON_AIRCRAFT);
    for (const s of this.listSets()) for (const a of s.aircrafts) set.add(a);
    for (const sg of this.savedGames()) {
      for (const d of safeReaddir(path.join(sg, 'Kneeboard'))) if (d.isDirectory()) set.add(d.name);
    }
    return [...set].sort(natural);
  }

  // Plan de copia: [{ aircraft, src, name }] con nombres numerados para respetar el orden en DCS.
  plan(filterAircraft) {
    const items = [];
    this.listSets().forEach((s, si) => {
      const enabled = s.pages.filter((p) => !p.disabled);
      enabled.forEach((p, pi) => {
        const name = `LFK ${String(si + 1).padStart(2, '0')}.${String(pi + 1).padStart(3, '0')} ${stripPrefix(p.file)}`;
        for (const a of s.aircrafts) if (!filterAircraft || filterAircraft.includes(a)) items.push({ aircraft: a, src: p.path, name, set: s.name });
      });
    });
    return items;
  }

  readManifest() {
    return readJson(this.manifestFile) || {};
  }

  removeFromDcs() {
    const man = this.readManifest();
    let removed = 0;
    for (const files of Object.values(man)) {
      for (const f of files) {
        if (OWN.test(path.basename(f)) && fs.existsSync(f)) {
          fs.rmSync(f);
          removed++;
        }
      }
    }
    fs.writeFileSync(this.manifestFile, '{}');
    return removed;
  }

  // Copia las páginas activas a Saved Games\DCS*\Kneeboard\<avión>. Solo borra lo que copió antes.
  applyToDcs() {
    this.removeFromDcs();
    const man = {};
    let copied = 0;
    const items = this.plan();
    for (const sg of this.savedGames()) {
      for (const it of items) {
        const dir = path.join(sg, 'Kneeboard', it.aircraft);
        fs.mkdirSync(dir, { recursive: true });
        const dst = path.join(dir, it.name);
        fs.copyFileSync(it.src, dst);
        (man[dir] = man[dir] || []).push(dst);
        copied++;
      }
    }
    fs.writeFileSync(this.manifestFile, JSON.stringify(man, null, 1));
    return { copied, aircraft: [...new Set(items.map((i) => i.aircraft))], folders: Object.keys(man).length };
  }

  // Mete las páginas en un .miz: por avión (KNEEBOARD/<avión>/IMAGES) o para todos (KNEEBOARD/IMAGES).
  injectIntoMiz(mizPath, { aircraft = null, forAll = false } = {}) {
    const zip = new AdmZip(mizPath);
    fs.copyFileSync(mizPath, `${mizPath}.bak`);
    for (const e of zip.getEntries()) {
      if (/^KNEEBOARD\//i.test(e.entryName) && OWN.test(path.basename(e.entryName))) zip.deleteFile(e.entryName);
    }
    const items = this.plan(aircraft ? [aircraft] : null);
    const seen = new Set();
    let added = 0;
    for (const it of items) {
      const entry = forAll ? `KNEEBOARD/IMAGES/${it.name}` : `KNEEBOARD/${it.aircraft}/IMAGES/${it.name}`;
      if (seen.has(entry)) continue;
      seen.add(entry);
      zip.addFile(entry, fs.readFileSync(it.src));
      added++;
    }
    zip.writeZip(mizPath);
    return { added, backup: `${mizPath}.bak` };
  }
}

module.exports = { Library, COMMON_AIRCRAFT, stripPrefix };
