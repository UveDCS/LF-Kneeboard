// Informe de registros: solo los registros que existen, solo las líneas «LF Kneeboard» de dcs.log, y el nombre de
// usuario de Windows cambiado por «Piloto» en las rutas. Todo en una carpeta temporal.
const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');
const report = require('../src/main/report');

let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'OK  ' : 'FAIL'} ${m}`); if (!c) fails++; };
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'lfkb-informe-'));
const w = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); };

ok(report.maskUser('C:\\Users\\juan.perez\\Saved Games\\DCS') === 'C:\\Users\\Piloto\\Saved Games\\DCS', 'ruta con barras invertidas');
ok(report.maskUser('c:/users/Ana/AppData/x.log') === 'c:/users/Piloto/AppData/x.log', 'ruta con barras normales');
ok(report.maskUser('"C:\\\\Users\\\\ana\\\\x"') === '"C:\\\\Users\\\\Piloto\\\\x"', 'ruta con barras dobles (JSON)');
ok(report.maskUser('F:\\DCS World\\bin-mt\\DCS.exe') === 'F:\\DCS World\\bin-mt\\DCS.exe', 'las rutas sin usuario no cambian');

const ud = path.join(T, 'AppData', 'LF Kneeboard');
w(path.join(ud, 'errores.log'), '[2026] Error en C:\\Users\\crolm\\Documents\\x.pdf\n');
w(path.join(ud, 'vr.log'), '[x] Memoria compartida lista\n');
w(path.join(ud, 'config.json'), '{"secreto": true}');
const layer = path.join(T, 'Local', 'openxr-layer.log'); // no existe
const dcs = path.join(T, 'Saved Games', 'DCS');
w(path.join(dcs, 'Logs', 'dcs.log'), [
  '2026 INFO    EDCORE: arranque',
  '2026 INFO    LuaNET (Main): [LF Kneeboard] cargado (versión 1)',
  '2026 INFO    LF Kneeboard (Main): puente cargado desde C:\\Users\\crolm\\Saved Games\\DCS\\Mods',
  '2026 INFO    SCRIPTING: otra cosa',
].join('\r\n'));

const zipFile = path.join(T, 'registros.zip');
const r = report.writeReport(zipFile, { userData: ud, layerLog: layer, dcsDirs: [dcs] });
const zip = new AdmZip(zipFile);
const names = zip.getEntries().map((e) => e.entryName).sort();
ok(JSON.stringify(names) === JSON.stringify(['DCS - dcs.log (líneas LF Kneeboard).txt', 'errores.log', 'vr.log']), `solo los registros: ${names.join(', ')}`);
ok(r.missing.includes('openxr-layer.log') && !names.includes('config.json'), `avisa de los que no hay (${r.missing.join(', ')}) y no mete la configuración`);
const dl = zip.readAsText('DCS - dcs.log (líneas LF Kneeboard).txt');
ok(dl.split('\r\n').length === 2 && !dl.includes('EDCORE') && !dl.includes('SCRIPTING'), 'de dcs.log solo las líneas «LF Kneeboard»');
ok(!dl.includes('crolm') && dl.includes('C:\\Users\\Piloto\\Saved Games'), 'sin el usuario de Windows en dcs.log');
ok(!zip.readAsText('errores.log').includes('crolm'), 'ni en errores.log');

fs.rmSync(T, { recursive: true, force: true });
console.log(fails ? `\n${fails} fallos` : '\nTodo correcto');
process.exit(fails ? 1 : 0);
