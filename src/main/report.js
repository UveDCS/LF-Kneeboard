// Informe para pedir ayuda: un .zip SOLO con los registros que ya existen (nada de configuración ni datos del PC).
//   errores.log y vr.log (datos de la app), openxr-layer.log (capa de VR) y, de cada carpeta de DCS, solo las líneas
//   «LF Kneeboard» de dcs.log y dcs.log.old.
// En las rutas, el nombre de usuario de Windows se cambia por «Piloto».
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

// C:\Users\<usuario>\… → C:\Users\Piloto\… (también con barras normales o dobles).
function maskUser(text) {
  return String(text).replace(/([A-Za-z]:(?:\\\\|\\|\/)+Users(?:\\\\|\\|\/)+)([^\\/\s"'<>|:*?]+)/gi, '$1Piloto');
}

function read(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
}

// Lista de registros: [{ name, text }] y los que no hay.
function collect({ userData, layerLog, dcsDirs = [] }) {
  const files = [];
  const missing = [];
  const add = (name, text) => { if (text != null && text.trim()) files.push({ name, text: maskUser(text) }); else missing.push(name); };
  add('errores.log', read(path.join(userData, 'errores.log')));
  add('vr.log', read(path.join(userData, 'vr.log')));
  add('openxr-layer.log', layerLog ? read(layerLog) : null);
  for (const dir of dcsDirs) {
    for (const log of ['dcs.log', 'dcs.log.old']) {
      const text = read(path.join(dir, 'Logs', log));
      const name = `${path.basename(dir)} - ${log} (líneas LF Kneeboard).txt`;
      if (text == null) { if (log === 'dcs.log') missing.push(name); continue; }
      add(name, text.split(/\r?\n/).filter((l) => l.includes('LF Kneeboard')).join('\r\n'));
    }
  }
  return { files, missing };
}

function writeReport(zipFile, opts) {
  const { files, missing } = collect(opts);
  const zip = new AdmZip();
  for (const f of files) zip.addFile(f.name, Buffer.from(f.text, 'utf8'));
  zip.writeZip(zipFile);
  return { file: zipFile, files: files.map((f) => f.name), missing };
}

module.exports = { maskUser, collect, writeReport };
