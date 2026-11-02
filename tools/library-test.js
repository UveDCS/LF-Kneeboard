// Pruebas de la biblioteca (formato KneeboardManager), los tiempos de bloque, el lector de coordenadas
// y el modelo de la tarjeta de vuelo. Todo en carpetas temporales: no toca DCS ni la biblioteca real.
// Uso: node tools/library-test.js [biblioteca_real_para_copiar] [mision.miz]
const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');
const { Library } = require('../src/main/library');
const { DcsLink } = require('../src/main/dcs');
const Geo = require('../src/shared/geo');

let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'OK  ' : 'FAIL'} ${m}`); if (!c) fails++; };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lfkb-lib-'));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

// ---- Biblioteca de prueba (o copia de una real, sin tocar el original)
const root = path.join(tmp, 'Kneeboard');
const realRoot = process.argv[2];
if (realRoot && fs.existsSync(realRoot)) {
  for (const d of fs.readdirSync(realRoot, { withFileTypes: true }).filter((x) => x.isDirectory()).slice(0, 4)) {
    fs.cpSync(path.join(realRoot, d.name), path.join(root, d.name), { recursive: true });
  }
} else {
  fs.mkdirSync(path.join(root, '1. Procedimientos'), { recursive: true });
  for (const n of ['9. a.png', '9. b.png', '9. c.png']) fs.writeFileSync(path.join(root, '1. Procedimientos', n), PNG);
  fs.writeFileSync(path.join(root, '1. Procedimientos', 'kneeboard.json'), JSON.stringify({ aircrafts: ['FA-18C_hornet', 'F-16C_50'], prefix: '' }));
}
const sg = path.join(tmp, 'Saved Games', 'DCS');
fs.mkdirSync(path.join(sg, 'Kneeboard', 'FA-18C_hornet'), { recursive: true });
fs.writeFileSync(path.join(sg, 'Kneeboard', 'FA-18C_hornet', 'DAGGER_OB_01.png'), PNG); // página de otro programa: no se toca

const data = { library: { root } };
const lib = new Library({ get: () => data, patch: (p) => Object.assign(data, p) }, tmp, { savedGames: () => [sg] });
const sets = lib.listSets();
ok(sets.length > 0, `Juegos leídos: ${sets.map((s) => `${s.name} (${s.pages.length} págs, ${s.aircrafts.length} aviones)`).join('; ')}`);
const s0 = sets.find((s) => s.aircrafts.length && s.pages.length >= 2) || sets[0];
const ac = s0.aircrafts[0] || 'FA-18C_hornet';
if (!s0.aircrafts.length) lib.writeMeta(s0.dir, { aircrafts: [ac] });
const before = lib.pagesFor(ac).length;
ok(before >= s0.pages.length, `Páginas para ${ac}: ${before}`);

// Desactivar y reordenar
const files = lib.readSet(s0.dir).pages.map((p) => p.file);
lib.writeMeta(s0.dir, { disabled_pages: [files[0]], order: [files[files.length - 1], ...files.slice(0, -1)] });
const s0b = lib.readSet(s0.dir);
ok(s0b.pages[0].file === files[files.length - 1], `Orden manual: primera página ${s0b.pages[0].file}`);
ok(lib.pagesFor(ac).length === before - 1, 'La página desactivada no sale');
const meta = JSON.parse(fs.readFileSync(path.join(s0.dir, 'kneeboard.json'), 'utf8'));
ok(Array.isArray(meta.aircrafts) && Array.isArray(meta.disabled_pages) && 'prefix' in meta, 'kneeboard.json sigue siendo compatible con KneeboardManager');

// Aplicar a DCS y quitar
const r = lib.applyToDcs();
const acDir = path.join(sg, 'Kneeboard', ac);
const copied = fs.readdirSync(acDir).filter((f) => f.startsWith('LFK '));
ok(r.copied > 0 && copied.length > 0, `Aplicado: ${r.copied} copias; en ${ac}: ${copied.slice(0, 2).join(', ')}…`);
ok(copied.every((f) => !/^LFK \d{2}\.\d{3} [0-9A-Za-z]{1,3}\. /.test(f)), 'Los prefijos manuales («9. ») se quitan al numerar');
const removed = lib.removeFromDcs();
ok(removed === r.copied && fs.existsSync(path.join(sg, 'Kneeboard', 'FA-18C_hornet', 'DAGGER_OB_01.png')), `Quitar de DCS borra solo lo suyo (${removed}) y respeta las páginas de DKS`);

// PDF importado / tarjetas guardadas
const set2 = lib.savePages(lib.setDir('Tarjetas de vuelo'), 'Golpe de acero', [`data:image/png;base64,${PNG.toString('base64')}`, `data:image/png;base64,${PNG.toString('base64')}`], { replace: true });
ok(set2.pages.length === 2 && fs.existsSync(path.join(set2.dir, 'kneeboard.json')), 'Páginas generadas guardadas como juego nuevo');

// Meter en un .miz
const miz = process.argv[3];
if (miz && fs.existsSync(miz)) {
  const copy = path.join(tmp, 'mision.miz');
  fs.copyFileSync(miz, copy);
  const res = lib.injectIntoMiz(copy, { aircraft: ac });
  const z = new AdmZip(copy);
  const entries = z.getEntries().map((e) => e.entryName).filter((n) => /^KNEEBOARD\//.test(n) && /LFK /.test(n));
  ok(res.added > 0 && entries.length === res.added && entries.every((n) => n.startsWith(`KNEEBOARD/${ac}/IMAGES/LFK `)), `.miz: ${res.added} páginas en KNEEBOARD/${ac}/IMAGES`);
  ok(z.readAsText('mission').startsWith('mission'), 'El .miz sigue teniendo su archivo «mission»');
  const again = lib.injectIntoMiz(copy, { aircraft: ac });
  const n2 = new AdmZip(copy).getEntries().filter((e) => /LFK /.test(e.entryName)).length;
  ok(n2 === again.added, 'Repetir no duplica páginas');
}

// ---- Tiempos de bloque
const link = new DcsLink({ get: () => ({ auto: { approachNm: 15, targetNm: 8 }, dcs: {} }) });
const events = [];
link.on('logbook', (e) => events.push(e));
link.mission = { name: 'Prueba', unit: { type: 'FA-18C_hornet' }, route: [], arrival: null };
const st = (mt, agl, gs) => link.updatePhase({ lat: 42, lon: 42, aglM: agl, gsKt: gs, gear: 1, missionTime: mt, type: 'FA-18C_hornet', vs: 0 });
st(100, 1, 0); st(200, 1, 10); st(400, 1, 150); st(420, 300, 200); st(2000, 2, 120); st(2100, 1, 5);
st(2200, 1, 0); // se para: empieza a contar
const realNow = Date.now;
Date.now = () => realNow() + 25000; // 25 s después sigue parado: calzos dentro
st(2225, 1, 0);
Date.now = realNow;
const b = events[0];
ok(b && b.out.mt === 200 && b.takeoff.mt === 420 && b.landing.mt === 2000 && b.in && b.landings === 1, `Bloque: fuera ${b && b.out.mt}, despegue ${b && b.takeoff.mt}, aterrizaje ${b && b.landing.mt}, dentro ${b && b.in && b.in.mt}`);

// ---- Lector de coordenadas
const cases = [
  ["36.2358 -115.0342", 36.2358, -115.0342],
  ["N36°14.15' W115°02.05'", 36.235833, -115.034167],
  ['N 36 14 09 W 115 02 03', 36.235833, -115.034167],
  ['S51°41.6 W057°51.3', -51.693333, -57.855],
];
for (const [t, la, lo] of cases) {
  const p = Geo.parseLatLon(t);
  ok(p && Math.abs(p.lat - la) < 1e-4 && Math.abs(p.lon - lo) < 1e-4, `«${t}» → ${p ? `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}` : 'nada'}`);
}
ok(Geo.parseLatLon('hola') === null, 'Texto no válido → null');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `\n${fails} fallos` : '\nTodo correcto');
process.exit(fails ? 1 : 0);
