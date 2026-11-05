// Comprueba la app YA EMPAQUETADA (no el código fuente): que koffi carga dentro del app.asar y que el
// puente con la capa VR crea su memoria compartida. Un filtro de archivos del instalador demasiado agresivo
// dejó la VR y el «Modo escritura» sin funcionar en las versiones publicadas hasta la 0.3.11.
// Uso: node tools/package-check.js [carpeta con «LF Kneeboard.exe»]   (por defecto dist-build/win-unpacked)
const { execFileSync } = require('child_process');
const path = require('path');

const dir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'dist-build', 'win-unpacked'));
const exe = path.join(dir, 'LF Kneeboard.exe');
const probe = `
const res = process.resourcesPath + '/app.asar';
const out = [];
try { const k = require(res + '/node_modules/koffi'); out.push('koffi ' + (k.version || 'ok')); } catch (e) { out.push('FALLO koffi: ' + e.message.split('\\n')[0]); }
try {
  const { VrBridge } = require(res + '/src/main/vr.js');
  const vr = new VrBridge({ name: 'Local\\\\LFKneeboard.PackageCheck.' + process.pid });
  const logs = []; vr.on('log', (m) => logs.push(m));
  out.push(vr.start() ? 'VR ok: ' + logs.join(' | ') : 'FALLO VR: ' + (vr.error || logs.join(' | ')));
  vr.stop();
} catch (e) { out.push('FALLO VR: ' + e.message.split('\\n')[0]); }
console.log(out.join('\\n'));
process.exit(0);
`;
const txt = execFileSync(exe, ['-e', probe], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8' });
console.log(txt.trim());
const bad = /FALLO/.test(txt);
console.log(bad ? '\nEl paquete NO está bien' : '\nPaquete correcto');
process.exit(bad ? 1 : 0);
