// Planificador de combustible: consumos de fábrica por avión, los del piloto guardados (y vuelta a los de fábrica),
// tramos de la ruta con su altitud, combate entre dos puntos elegidos, tanquero (de la misión o a mano) y la pestaña
// nueva en configuraciones antiguas.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { Config } = require('../src/main/config');

let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'OK  ' : 'FAIL'} ${m}`); if (!c) fails++; };
const near = (a, b, e = 0.05) => a != null && Math.abs(a - b) < e;

(async () => {
  const F = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'js', 'fuel-data.js')).href);

  // ---- módulo detectado → consumos de fábrica; los del piloto mandan
  let v = F.valuesFor('F-16C_50', {});
  ok(v.known && v.values.crucero === 60 && v.values.bajo === 110 && v.values.altCrucero === 25000 && !Object.keys(v.edited).length, 'F-16C: consumos de fábrica (alto, bajo y altitud)');
  ok(F.valuesFor('A-10C', {}).values.combate === F.DEFAULTS['A-10C_2'].combate, 'A-10C usa los del A-10C II');
  v = F.valuesFor('F-86F Sabre', {});
  ok(!v.known && v.values.crucero === null, 'avión sin datos: campos vacíos');
  const saved = { 'F-16C_50': { combate: 420, crucero: null } };
  v = F.valuesFor('F-16C_50', saved);
  ok(v.values.combate === 420 && v.edited.combate && v.values.crucero === 60 && !v.edited.crucero, 'combate editado, crucero de fábrica (null = de fábrica)');
  ok(F.valuesFor('FA-18C_hornet', saved).values.combate === 400, 'lo editado en un avión no toca a otro');

  // ---- unidades: lb, kg y litros según la cabina del avión (por dentro, todo en lb)
  ok(F.unitFor('F-16C_50', {}) === 'lb' && F.unitFor('MiG-29A', {}) === 'kg' && F.unitFor('Su-33', {}) === 'kg' && F.unitFor('MiG-21Bis', {}) === 'l' && F.unitFor('M-2000C', {}) === 'kg', 'unidad de cabina: F-16 en lb, MiG-29/Su-33/M-2000 en kg, MiG-21 en litros');
  ok(F.unitFor('MiG-29A', { 'MiG-29A': { unit: 'lb' } }) === 'lb' && F.unitFor('MiG-29A', { 'MiG-29A': { unit: null } }) === 'kg', 'la unidad elegida por el piloto manda; null vuelve a la de cabina');
  ok(near(F.toUnit(2204.62, 'kg'), 1000) && near(F.toUnit(2204.62, 'l'), 1250) && near(F.fromUnit(1000, 'kg'), 2204.62), '1.000 kg = 2.204,62 lb = 1.250 l (0,8 kg/l)');
  v = F.valuesFor('MiG-29A', {});
  ok(v.known && near(F.toUnit(v.values.combate, 'kg'), 180) && near(F.toUnit(v.values.reserva, 'kg'), 600) && v.values.velocidad === 470, 'MiG-29A: de fábrica en kg (combate 180 kg/min, reserva 600 kg), velocidades en kt');
  ok(near(F.toUnit(F.valuesFor('MiG-21Bis', {}).values.crucero, 'l'), 42), 'MiG-21: crucero 42 l/min');
  ok(F.valuesFor('Su-33', {}).known && F.valuesFor('Mirage-F1CE', {}).known, 'Su-33 y Mirage F1CE comparten datos con Su-27 y F1EE');
  const vm = F.valuesFor('MiG-29A', {}).values;
  ok(near(F.fuelPlan({ values: vm, zoneNm: 100, windowMin: 15 }).total, F.fromUnit(300 + 2 * 100 / 470 * 60 * 35 + 15 * 180 + 600, 'kg'), 0.5), 'cálculo del MiG-29 hecho en kg cuadra con el de dentro (en lb)');

  // ---- consumo según la altitud
  const V = F.valuesFor('F-16C_50', {}).values;
  ok(near(F.cruiseAt(V, 25000).ff, 60) && near(F.cruiseAt(V, 40000).ff, 60), 'a FL250 o más: crucero alto');
  ok(near(F.cruiseAt(V, 0).ff, 110) && near(F.cruiseAt(V, 0).tas, 420), 'en el suelo: baja cota');
  ok(near(F.cruiseAt(V, 12500).ff, 85) && near(F.cruiseAt(V, 12500).tas, 435), 'a FL125: a medio camino');
  ok(near(F.legFuel(V, 90, 25000).fuel, 720) && near(F.legFuel(V, 30, 500).fuel, 30 / 420.6 * 60 * 109), '90 nm a FL250 = 720 lb; 30 nm a 500 ft, mucho más por milla');

  // ---- ruta en un plano (lat/lon en millas): salida, dos puntos de ida, zona, salida de zona y vuelta a casa
  const flat = (a, b) => Math.hypot(a.lat - b.lat, a.lon - b.lon);
  const route = [
    { idx: 0, name: 'BASE', lat: 0, lon: 0 }, { idx: 1, name: 'CP', lat: 0, lon: 60 }, { idx: 2, name: 'IP', lat: 0, lon: 90 },
    { idx: 3, name: 'ZONA', lat: 0, lon: 100 }, { idx: 4, name: 'SALIDA', lat: 30, lon: 50 }, { idx: 5, name: 'BASE', lat: 0, lon: 0 },
  ];
  let r = F.planSortie({ values: V, route, distanceNm: flat, sortie: {} });
  ok(r.hasRoute && r.entry === 3 && r.exit === 3, `combate por defecto en el punto más lejano: WP${r.entry}`);
  r = F.planSortie({ values: V, route, distanceNm: flat, sortie: { entry: 2, exit: 4, windowMin: 20 } });
  ok(r.legs.map((l) => l.section).join(',') === 'ida,ida,zona,zona,vuelta', `combate de WP2 a WP4: ${r.legs.map((l) => l.section).join(',')}`);
  ok(near(r.parts.ida, 720) && r.legs[2].fuel === 0 && r.legs[3].fuel === 0, `ida 90 nm a FL250 = ${r.parts.ida.toFixed(0)} lb; dentro de la zona manda la ventana`);
  ok(near(r.parts.vuelta, Math.hypot(30, 50) / 450 * 60 * 60), `vuelta ${Math.hypot(30, 50).toFixed(1)} nm = ${r.parts.vuelta.toFixed(0)} lb`);
  ok(near(r.total, 700 + 720 + 6000 + r.parts.vuelta + 1500), `necesario ${r.total.toFixed(0)} lb`);
  r = F.planSortie({ values: V, route, distanceNm: flat, sortie: { entry: 3, exit: 1 } });
  ok(r.exit === 3, 'el fin del combate no puede ir antes del inicio');

  // ---- tramos editados: altitud y distancia
  r = F.planSortie({ values: V, route, distanceNm: flat, sortie: { entry: 2, exit: 4, legs: { 1: { alt: 500 }, 0: { dist: 80 } } } });
  ok(r.legs[1].altEdited && r.legs[1].alt === 500 && near(r.legs[1].fuel, F.legFuel(V, 30, 500).fuel), `tramo CP→IP a 500 ft: ${r.legs[1].fuel.toFixed(0)} lb`);
  ok(r.legs[0].distEdited && r.legs[0].dist === 80 && near(r.legs[0].fuel, 640), 'distancia del primer tramo a mano: 80 nm = 640 lb');
  r = F.planSortie({ values: V, route: route.map((p, i) => (i === 1 ? { ...p, alt: 3048 } : p)), distanceNm: flat, sortie: {} });
  ok(r.legs[0].alt === 10000 && !r.legs[0].altEdited, 'la altitud del punto de la misión (3.048 m) se usa por defecto: 10.000 ft');

  r = F.planSortie({ values: V, route: route.map((p, i) => (i === 4 ? { ...p, alt: 9144 } : i === 5 ? { ...p, alt: 45 } : p)), distanceNm: flat, sortie: {} });
  ok(r.legs[4].alt === 30000, `el tramo al aterrizaje va a la altitud del punto anterior (FL300), no a la del aeródromo: ${r.legs[4].alt} ft`);

  // ---- tanquero a mano en WP1 (en la ida)
  const load = 7160;
  r = F.planSortie({ values: V, route, distanceNm: flat, loadLb: load, sortie: { entry: 2, exit: 4, tanker: { src: 'manual', wp: 1 } } });
  const vuelta = Math.hypot(30, 50) / 450 * 60 * 60;
  let t = r.tanker;
  ok(t && t.section === 'ida' && near(t.before, 700 + 480), `hasta el tanquero (WP1): ${t && t.before.toFixed(0)} lb`);
  ok(near(t.after, 240 + 6000 + vuelta), `después: ${t.after.toFixed(0)} lb (resto de ida, combate y vuelta)`);
  ok(near(t.needTakeoff, 1180 + 1500) && near(t.arriveWith, load - 1180), 'necesitas al despegar = hasta el tanquero + reserva; llegas con lo demás');
  ok(near(t.refuelTo, load) && near(t.marginAfter, load - (t.after + 1500)), 'repostas hasta lo que llevabas (por defecto) y se compara');
  ok(near(t.maxWindow, (load - (t.after - 6000) - 1500) / 300) && t.maxWindow > r.maxWindow, `combate posible ${t.maxWindow.toFixed(1)} min (sin tanquero ${r.maxWindow.toFixed(1)})`);
  r = F.planSortie({ values: V, route, distanceNm: flat, loadLb: load, sortie: { entry: 2, exit: 4, tanker: { src: 'manual', wp: 4, refuelTo: 5000 } } });
  t = r.tanker;
  ok(t && t.section === 'vuelta' && near(t.before, 700 + 720 + 6000) && near(t.after, vuelta), 'tanquero a la vuelta (WP4): el combate va antes');
  ok(near(t.maxWindow, (load - 1420 - 1500) / 300), `y la ventana la limita lo que llevas al despegar: ${t.maxWindow.toFixed(1)} min`);
  r = F.planSortie({ values: V, route, distanceNm: flat, loadLb: load, sortie: { entry: 2, exit: 4, tanker: { src: 'manual', wp: 3 } } });
  ok(r.tanker && r.tanker.wp === 1, 'un punto dentro de la zona no vale para el tanquero: se usa uno de la ida');

  // ---- tanquero de la misión: se mete en el tramo donde menos te desvías
  const tankers = [{ callsign: 'TEXACO 1-1', type: 'KC-135MPRS', lat: -5, lon: 30 }];
  r = F.planSortie({ values: V, route, distanceNm: flat, loadLb: load, tankers, sortie: { entry: 2, exit: 4, tanker: { src: 'map', callsign: 'TEXACO 1-1' } } });
  t = r.tanker;
  const d1 = Math.hypot(5, 30);
  ok(t && t.leg === 0 && t.section === 'ida' && near(t.detour, 2 * d1 - 60), `TEXACO en el tramo BASE→CP, desvío ${t && t.detour.toFixed(2)} nm`);
  ok(near(t.before, 700 + d1 / 450 * 3600) && near(r.legs[0].fuel, 2 * d1 / 450 * 3600), 'hasta el tanquero y el tramo con el desvío sumado');
  r = F.planSortie({ values: V, route, distanceNm: flat, loadLb: load, tankers, sortie: { tanker: { src: 'map', callsign: 'SHELL 1-1' } } });
  ok(r.tanker === null, 'un tanquero que no está en la misión no cuenta');

  // ---- pasar o no por el tanquero, y tanquero en unas coordenadas
  r = F.planSortie({ values: V, route, distanceNm: flat, loadLb: load, tankers, sortie: { entry: 2, exit: 4, tanker: { src: 'map', callsign: 'TEXACO 1-1', use: false } } });
  ok(r.tanker === null && near(r.total, 700 + 720 + 6000 + vuelta + 1500), 'con «Pasar por el tanquero» apagado, el cálculo va sin él');
  r = F.planSortie({ values: V, route, distanceNm: flat, loadLb: load, sortie: { entry: 2, exit: 4, tanker: { src: 'coords', use: true, coords: { lat: 25, lon: 45 } } } });
  t = r.tanker;
  ok(t && t.src === 'coords' && t.leg === 4 && t.section === 'vuelta', `tanquero en unas coordenadas: se mete en la vuelta (${t && t.where})`);
  ok(near(t.detour, Math.hypot(5, 5) + Math.hypot(25, 45) - Math.hypot(30, 50)) && near(t.before, 700 + 720 + 6000 + Math.hypot(5, 5) / 450 * 3600), `desvío ${t.detour.toFixed(1)} nm y lo que gastas hasta él`);
  r = F.planSortie({ values: V, route, distanceNm: flat, sortie: { tanker: { src: 'coords', use: true } } });
  ok(r.tanker === null, 'sin coordenadas no hay tanquero');

  // ---- sin ruta: ida y vuelta a mano
  r = F.planSortie({ values: V, route: null, distanceNm: flat, sortie: { zoneNm: 120, windowMin: 20 } });
  ok(!r.hasRoute && r.legs.length === 2 && near(r.total, 700 + 960 + 960 + 6000 + 1500), `sin ruta: ${r.total.toFixed(0)} lb`);
  r = F.planSortie({ values: V, route: null, distanceNm: flat, sortie: { zoneNm: 120, legs: { vuelta: { alt: 0, dist: 100 } } } });
  ok(near(r.parts.vuelta, F.legFuel(V, 100, 0).fuel), 'sin ruta: la vuelta a baja cota y 100 nm');
  ok(near(F.fuelPlan({ values: V, zoneNm: 120, windowMin: 20 }).total, 10120), 'compatibilidad con el cálculo anterior');

  // ---- configuración: pestaña nueva en configuraciones de antes y salidas guardadas por misión
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lfkb-fuel-'));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ version: 6, tabs: [{ id: 'a', type: 'notes', title: 'Bloc', fav: true }] }));
  let cfg = new Config(dir);
  const tab = cfg.get().tabs.find((x) => x.type === 'fuel');
  ok(cfg.get().version === 7 && tab && tab.title === 'Combustible' && !tab.fav, 'configuración v6: aparece la pestaña Combustible, sin fijar');
  cfg.patch({ plan: { fuel: { 'F-16C_50': { combate: 420 } }, sorties: { 'a.miz': { entry: 2, legs: { 1: { alt: 500 } }, tanker: { src: 'manual', wp: 1 } } } } });
  cfg.patch({ plan: { fuel: { 'F-16C_50': { combate: null } }, sorties: { 'a.miz': { legs: { 1: { alt: null } } } } } });
  cfg.save(true);
  cfg = new Config(dir);
  const so = cfg.get().plan.sorties['a.miz'];
  ok(F.valuesFor('F-16C_50', cfg.get().plan.fuel).values.combate === 300, 'quitar el valor propio vuelve al de fábrica (también tras reabrir)');
  ok(so.entry === 2 && so.tanker.src === 'manual' && so.legs[1].alt == null, 'la salida se guarda por misión y la altitud vuelve a la de la ruta');
  fs.rmSync(dir, { recursive: true, force: true });

  console.log(fails ? `\n${fails} fallos` : '\nTodo correcto');
  process.exit(fails ? 1 : 0);
})();
