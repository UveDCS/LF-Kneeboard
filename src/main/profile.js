// Copia del perfil en un .zip: la configuración (pestañas, controles, temas, VR…) y los datos
// (marcadores, nombres de los puntos, presets de radio, tarjetas, bloc, libro de vuelo…).
// Sirve para cambiar de PC o para pasar tu configuración a otro piloto.
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const FORMAT = 1;

function exportProfile(file, { config, userData, version }) {
  const zip = new AdmZip();
  zip.addFile('perfil.json', Buffer.from(JSON.stringify({ app: 'LF Kneeboard', format: FORMAT, version, date: new Date().toISOString() }, null, 2)));
  zip.addFile('config.json', Buffer.from(JSON.stringify(config, null, 2)));
  const dir = path.join(userData, 'datos');
  let n = 0;
  for (const f of safeList(dir)) {
    if (!/\.json$/i.test(f)) continue;
    zip.addFile(`datos/${f}`, fs.readFileSync(path.join(dir, f)));
    n++;
  }
  zip.writeZip(file);
  return { file, stores: n };
}

// Lee y comprueba un perfil sin tocar nada todavía.
function readProfile(file) {
  const zip = new AdmZip(file);
  const man = zip.getEntry('perfil.json');
  const cfgEntry = zip.getEntry('config.json');
  if (!man || !cfgEntry) throw new Error('El archivo no es un perfil de LF Kneeboard.');
  const meta = JSON.parse(man.getData().toString('utf8'));
  if (meta.app !== 'LF Kneeboard') throw new Error('El archivo no es un perfil de LF Kneeboard.');
  if (meta.format > FORMAT) throw new Error(`El perfil es de una versión más nueva (${meta.version}). Actualiza LF Kneeboard antes de importarlo.`);
  const config = JSON.parse(cfgEntry.getData().toString('utf8'));
  const stores = zip.getEntries()
    .filter((e) => !e.isDirectory && /^datos\/[^/\\]+\.json$/i.test(e.entryName))
    .map((e) => ({ name: path.basename(e.entryName), data: e.getData() }));
  return { meta, config, stores };
}

// Mezcla la configuración importada con lo que depende de este PC (posición de las ventanas,
// lo instalado en DCS, la carpeta de la biblioteca si allí no existe).
function mergeConfig(current, imported) {
  const out = { ...imported };
  out.firstRun = false;
  out.integration = current.integration;
  out.views = (imported.views || current.views).map((v, i) => ({ ...v, bounds: (current.views[i] || {}).bounds || null }));
  const root = imported.library && imported.library.root;
  if (root && !fs.existsSync(root)) out.library = { ...imported.library, root: current.library && current.library.root };
  return out;
}

function writeStores(userData, stores) {
  const dir = path.join(userData, 'datos');
  fs.mkdirSync(dir, { recursive: true });
  for (const s of stores) fs.writeFileSync(path.join(dir, s.name), s.data);
}

function safeList(dir) {
  try { return fs.readdirSync(dir); } catch { return []; }
}

module.exports = { exportProfile, readProfile, mergeConfig, writeStores };
