// Prueba de extremo a extremo del hook de DCS con Lua 5.1 y un entorno DCS simulado:
// el hook manda la misión y el estado por UDP a DcsLink y responde a la captura de coordenadas.
// Uso: node tools/hook-test.js ruta.miz [ruta/lua.exe]
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const AdmZip = require('adm-zip');
const { DcsLink } = require('../src/main/dcs');

const miz = process.argv[2];
const luaExe = process.argv[3] || 'C:\\Program Files (x86)\\Lua\\5.1\\lua.exe';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lfkb-hook-'));
fs.writeFileSync(path.join(tmp, 'mission.lua'), new AdmZip(miz).readAsText('mission', 'utf8'));

let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'OK  ' : 'FAIL'} ${m}`); if (!c) fails++; };

// Puertos propios para no chocar con un DCS o un LF Kneeboard abiertos de verdad.
const cfg = { get: () => ({ dcs: { appPort: 17788, hookPort: 17789 }, auto: { approachNm: 15, targetNm: 8 } }) };
const hookCopy = path.join(tmp, 'LFKneeboard-hook.lua');
fs.writeFileSync(hookCopy, fs.readFileSync(path.join(__dirname, '..', 'dcs-scripts', 'Hooks', 'LFKneeboard-hook.lua'), 'utf8')
  .replace('appPort = 7788', 'appPort = 17788').replace('hookPort = 7789', 'hookPort = 17789'));
const bridgeCopy = path.join(tmp, 'LFKneeboard-bridge.lua');
fs.writeFileSync(bridgeCopy, fs.readFileSync(path.join(__dirname, '..', 'dcs-scripts', 'Mods', 'Services', 'LFKneeboard', 'Scripts', 'LFKneeboard-bridge.lua'), 'utf8')
  .replace('appPort = 7788', 'appPort = 17788'));
const link = new DcsLink(cfg);
const got = { mission: null, live: null, msg: null };
link.on('mission', (m) => { got.mission = m; });
link.on('live', (l) => { got.live = l; });
link.on('message', (m) => { got.msg = m; });
link.on('log', (m) => console.log('log:', m));
link.start();

// DTC que «tiene» el editor del juego (sin type ni name, como lo da getDataJson).
const editorDtc = path.join(tmp, 'editor.json');
fs.writeFileSync(editorDtc, JSON.stringify({ name: '', type: '', data: {
  WYPT: { NAV_PTS: [
    { wypt_num: 1, x: -310000, y: 630000, alt: 1000, R1: true, R1_order: 1, text_note: 'ED1' },
    { wypt_num: 2, x: -305000, y: 635000, alt: 2000, R1: true, R1_order: 2, text_note: 'ED2' },
  ] },
} }));

const lua = spawn(luaExe, [path.join(__dirname, 'hook_mock.lua'), hookCopy, path.join(tmp, 'mission.lua'), tmp, '7', editorDtc, bridgeCopy], { stdio: ['ignore', 'inherit', 'pipe'] });
let stderr = '';
lua.stderr.on('data', (d) => { stderr += d; });

setTimeout(async () => {
  ok(link.connected(), 'El hook envía datos por UDP');
  ok(got.mission && got.mission.unit && got.mission.unit.name === 'Dagger-1-1', `Misión recibida (mission.json): ${got.mission && got.mission.unit && got.mission.unit.name}, ${got.mission && got.mission.route.length} WPs`);
  ok(got.live && Math.abs(got.live.lat - 42.25) < 1e-6 && got.live.type === 'FA-18C_hornet', `Estado en vuelo: ${got.live && `${got.live.lat}, ${got.live.lon}, IAS ${Math.round(got.live.iasKt)} kt, ${got.live.type}`}`);
  ok(got.live && got.live.mapView === true, 'Detecta el mapa F10 (cámara mirando hacia abajo)');
  ok(got.live && got.live.missionTime > 50400, `Hora de misión ${got.live && got.live.missionTime}`);
  ok(got.msg && /prueba/.test(got.msg.text), `Mensaje de la misión: ${got.msg && got.msg.text}`);
  const p = await link.capture();
  ok(p && Math.abs(p.lat - 42.123456) < 1e-6 && p.alt === 321 && p.mgrs === '38T KM 12345 67890' && p.src === 'F10', `Captura del F10: ${JSON.stringify(p)}`);
}, 2500);

// Puente del mod: herramienta de ruta (al momento) y, al cerrar el editor de DTC (segundo 4,5), su ruta.
setTimeout(() => {
  const m = got.mission;
  ok(m && m.routeSource === 'herramienta de ruta del F10' && m.route.length === 3 && m.route[0].name === 'RT1',
    `Ruta de la herramienta de ruta del F10: ${m && m.routeSource}, ${m && m.route.map((w) => w.name).join(' ')}`);
  ok(m && m.route[0].tos === m.startTime + 900 && m.route[2].altM == null, `Horas y altitudes de la herramienta: ${m && m.route.map((w) => w.tos).join(' ')} (inicio ${m && m.startTime})`);
}, 3200);
setTimeout(() => {
  const m = got.mission;
  ok(link.dtcEditor && link.dtcEditor.type === 'FA-18C_hornet', `DTC del editor del juego leído (${link.dtcEditor && link.dtcEditor.type})`);
  ok(m && m.routeSource === 'DTC del editor del juego' && m.route.length === 2, `Al cerrar el editor manda su ruta: ${m && m.routeSource}, ${m && m.route.length} puntos`);
  ok(link.sources && link.sources.bridge && link.sources.routeTool && link.sources.dtcEditor && /^ok/.test(link.sources.dtcProbe), `Diagnóstico de fuentes: ${JSON.stringify(link.sources)}`);
  const at = link.dtcEditor && link.dtcEditor.at;
  setTimeout(() => ok(link.dtcEditor && link.dtcEditor.at === at, 'El DTC repetido por el puente no cuenta como nuevo'), 600);
}, 6200);

lua.on('exit', (code) => {
  if (stderr.trim()) console.log(`[lua] ${stderr.trim()}`);
  ok(code === 0, `Lua terminó (código ${code})`);
  ok(!/error/i.test(stderr), 'Sin errores en el log del hook');
  link.sock.close();
  clearInterval(link.watchdog);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(fails ? `\n${fails} fallos` : '\nTodo correcto');
  process.exit(fails ? 1 : 0);
});
