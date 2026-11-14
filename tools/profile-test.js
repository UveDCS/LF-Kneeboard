// Pruebas de las plantillas de pestañas, la migración a favoritas y la copia del perfil (exportar → importar).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { nightPair, Config, TEMPLATES, defaultTabs, templateTabs, presetTabs } = require('../src/main/config');
const profile = require('../src/main/profile');

let fails = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'OK  ' : 'FALLO'} ${msg}`);
  if (!cond) fails++;
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lfkb-perfil-'));

// ------------------------------------------------------------------ plantillas
const sen = defaultTabs();
ok(sen.filter((t) => t.fav).map((t) => t.type).join(',') === 'library,notes' && sen[0].type === 'library' && sen[1].type === 'notes', 'De fábrica, perfil Sencillo: Piernógrafo y Bloc, los dos fijos y primeros');
ok(sen.length === 15 && new Set(sen.map((t) => t.type)).size === 15, 'y las 15 clases de pestaña disponibles en la cuadrícula');
ok(TEMPLATES.every((tp) => new Set(templateTabs(tp.id, []).map((t) => t.type)).size === 15), 'Todas las plantillas traen todos los tipos de pestaña');
const def = templateTabs('completa', []);
ok(def.filter((t) => t.fav).length === 7, `Plantilla Completa: 7 favoritas de ${def.length}`);
const mine = [...def, { id: 'pdf1', type: 'pdf', title: 'NATOPS', icon: 'pdf', path: 'C:\\x.pdf', phases: [] }];
mine.find((t) => t.type === 'radios').title = 'Mis radios';
const heli = templateTabs('helicoptero', mine);
ok(heli[0].type === 'map' && heli[0].fav, 'Helicóptero: el mapa va primero y fijo');
ok(heli.find((t) => t.type === 'radios').title === 'Mis radios', 'La plantilla conserva el nombre que le pusiste a una pestaña');
ok(heli.find((t) => t.type === 'radios').id === mine.find((t) => t.type === 'radios').id, 'y su identificador (no se pierden sus datos)');
ok(heli[heli.length - 1].type === 'pdf' && heli[heli.length - 1].path === 'C:\\x.pdf', 'Tus PDF se quedan al final');
ok(heli.some((t) => t.type === 'lesson' && !t.fav), 'Helicóptero trae la lección en la cuadrícula, sin fijar');
ok(TEMPLATES.every((tp) => templateTabs(tp.id, []).every((t) => t.title && t.icon)), 'Todas las plantillas generan pestañas con nombre e icono');

// ------------------------------------------------------------------ variantes Noche
ok(nightPair('tactico') === 'tactico-noche' && nightPair('tactico-noche') === 'tactico', 'La luna: Kneeboard táctico ↔ Kneeboard táctico · Noche');
ok(['tablet', 'libreta', 'portapapeles', 'mfd', 'dossier'].every((t) => nightPair(nightPair(t)) === t), 'Todos los temas vuelven a sí mismos tras dos toques');
ok(nightPair('noche') === 'tablet', 'Desde «Noche (rojo)», la luna vuelve a la Tablet');
const dirN = path.join(tmp, 'noche');
fs.mkdirSync(dirN);
fs.writeFileSync(path.join(dirN, 'config.json'), JSON.stringify({ version: 5, theme: 'dossier', night: true, tabs: [{ id: 'a', type: 'library', title: 'Piernógrafo', icon: 'mission', fav: true, phases: [] }, { id: 'w', type: 'web', title: 'Web', icon: 'web', fav: false, phases: [] }] }));
const cN = new Config(dirN).get();
ok(cN.theme === 'dossier-noche' && cN.night === false, 'El modo noche antiguo (filtro rojo) pasa a la variante Noche del tema');
ok(cN.tabs.length === 16 && cN.tabs[0].id === 'a' && cN.tabs[1].type === 'web' && cN.tabs.filter((t) => t.fav).length === 1, 'v6/v7: tus pestañas se completan con los tipos que faltan, en la cuadrícula');

// ------------------------------------------------------------------ migración v4 (favoritas)
const dir3 = path.join(tmp, 'v3');
fs.mkdirSync(dir3);
const old = { version: 3, tabs: def.map(({ fav, ...t }) => t).concat([{ id: 'w', type: 'web', title: 'Web', icon: 'web', phases: [] }]) };
fs.writeFileSync(path.join(dir3, 'config.json'), JSON.stringify(old));
const c3 = new Config(dir3).get();
ok(c3.version === 7, 'La configuración v3 se migra a v7');
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
const small = { id: 'p2', name: 'Corto', tabs: mine.filter((t) => t.type === 'library' || t.type === 'pdf').map((t) => ({ ...t, fav: true })) };
const curTabs = templateTabs('completa', []);
const ap2 = presetTabs(small, curTabs);
ok(new Set(ap2.map((t) => t.type)).size === 16 && ap2.filter((t) => t.fav).length === 2, 'Preset corto: trae todos los tipos, pero fijas solo las suyas');
ok(ap2.find((t) => t.type === 'notes').id === curTabs.find((t) => t.type === 'notes').id, 'y reutiliza el Bloc que ya tenías (no se pierden tus notas)');

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
