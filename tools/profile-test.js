// Pruebas de las plantillas de pestañas, la migración a favoritas y la copia del perfil (exportar → importar).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Config, TEMPLATES, defaultTabs, templateTabs, presetTabs } = require('../src/main/config');
const profile = require('../src/main/profile');

let fails = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'OK  ' : 'FALLO'} ${msg}`);
  if (!cond) fails++;
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lfkb-perfil-'));

// ------------------------------------------------------------------ plantillas
const def = defaultTabs();
ok(def.filter((t) => t.fav).length === 7, `Pestañas de fábrica: 7 favoritas de ${def.length}`);
const mine = [...def, { id: 'pdf1', type: 'pdf', title: 'NATOPS', icon: 'pdf', path: 'C:\\x.pdf', phases: [] }];
mine.find((t) => t.type === 'radios').title = 'Mis radios';
const heli = templateTabs('helicoptero', mine);
ok(heli[0].type === 'map' && heli[0].fav, 'Helicóptero: el mapa va primero y fijo');
ok(heli.find((t) => t.type === 'radios').title === 'Mis radios', 'La plantilla conserva el nombre que le pusiste a una pestaña');
ok(heli.find((t) => t.type === 'radios').id === mine.find((t) => t.type === 'radios').id, 'y su identificador (no se pierden sus datos)');
ok(heli[heli.length - 1].type === 'pdf' && heli[heli.length - 1].path === 'C:\\x.pdf', 'Tus PDF se quedan al final');
ok(!heli.some((t) => t.type === 'lesson'), 'Helicóptero no trae la lección');
ok(TEMPLATES.every((tp) => templateTabs(tp.id, []).every((t) => t.title && t.icon)), 'Todas las plantillas generan pestañas con nombre e icono');

// ------------------------------------------------------------------ migración v4 (favoritas)
const dir3 = path.join(tmp, 'v3');
fs.mkdirSync(dir3);
const old = { version: 3, tabs: def.map(({ fav, ...t }) => t).concat([{ id: 'w', type: 'web', title: 'Web', icon: 'web', phases: [] }]) };
fs.writeFileSync(path.join(dir3, 'config.json'), JSON.stringify(old));
const c3 = new Config(dir3).get();
ok(c3.version === 5, 'La configuración v3 se migra a v5');
ok(c3.tabs.filter((t) => t.fav).map((t) => t.type).join(',') === 'dcs-kneeboard,library,cards,flightplan,radios,notes,map,web',
  'Migración: favoritas las de siempre y tus pestañas propias');
const dtcTab = c3.tabs.find((t) => t.type === 'dtc');
ok(dtcTab && !dtcTab.fav && c3.tabs[c3.tabs.indexOf(dtcTab) - 1].type === 'radios', 'Migración v5: pestaña DTC en la cuadrícula, detrás de Radios');

// ------------------------------------------------------------------ presets de pestañas
const preset = { id: 'p1', name: 'CAS', tabs: mine.map((t) => ({ ...t })) };
const applied = presetTabs(preset);
ok(applied.length === mine.length && applied.every((t, i) => t.id === mine[i].id), 'Preset: vuelven las mismas pestañas con su identificador (y sus datos)');
applied[0].phases.push('taxi');
ok(!preset.tabs[0].phases.includes('taxi'), 'Preset: aplicarlo no cambia el preset guardado');
ok(presetTabs(null).length === 0, 'Preset inexistente: sin pestañas');

// ------------------------------------------------------------------ perfil
const ud = path.join(tmp, 'pc1');
fs.mkdirSync(path.join(ud, 'datos'), { recursive: true });
fs.writeFileSync(path.join(ud, 'datos', 'bookmarks-abc.json'), JSON.stringify({ 'lib:LF|p1.png': { type: 'approach' } }));
fs.writeFileSync(path.join(ud, 'datos', 'wpnames-def.json'), JSON.stringify({ Prueba: { 3: 'IP' } }));
const cfg1 = { ...new Config(path.join(tmp, 'nada')).get(), theme: 'libreta', firstRun: false, library: { root: 'Z:\\no-existe' },
  views: [{ state: {}, bounds: { x: 1, y: 2, width: 3, height: 4 }, vr: { pos: [1, 2, 3] } }] };
const zip = path.join(tmp, 'perfil.zip');
const ex = profile.exportProfile(zip, { config: cfg1, userData: ud, version: '9.9.9' });
ok(fs.existsSync(zip) && ex.stores === 2, 'Exporta la configuración y 2 archivos de datos');

const p = profile.readProfile(zip);
ok(p.meta.version === '9.9.9' && p.config.theme === 'libreta', 'Lee el perfil y su configuración');
const cur = { integration: { hook: true }, views: [{ bounds: { x: 50, y: 60, width: 70, height: 80 } }], library: { root: 'C:\\Biblio' } };
const merged = profile.mergeConfig(cur, p.config);
ok(merged.theme === 'libreta' && merged.integration.hook === true, 'Importa el tema y conserva lo instalado en este PC');
ok(merged.views[0].bounds.x === 50 && merged.views[0].vr.pos[2] === 3, 'Conserva la posición de las ventanas pero trae la de VR');
ok(merged.library.root === 'C:\\Biblio', 'Si la carpeta de la biblioteca no existe aquí, se queda la tuya');
const ud2 = path.join(tmp, 'pc2');
profile.writeStores(ud2, p.stores);
ok(JSON.parse(fs.readFileSync(path.join(ud2, 'datos', 'wpnames-def.json'), 'utf8')).Prueba[3] === 'IP', 'Los nombres de los puntos llegan al otro PC');

const bad = path.join(tmp, 'malo.zip');
const AdmZip = require('adm-zip');
const z = new AdmZip();
z.addFile('hola.txt', Buffer.from('x'));
z.writeZip(bad);
let err = null;
try { profile.readProfile(bad); } catch (e) { err = e.message; }
ok(/no es un perfil/.test(err || ''), 'Rechaza un .zip que no es un perfil');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `\n${fails} fallos` : '\nTodo correcto');
process.exit(fails ? 1 : 0);
