// Pruebas de: ruta leída de un DTC, filtro por bando (unidades, apoyo y aeródromos) y secuencia de waypoints por número.
// Uso: node tools/route-test.js [archivo.dtc] [mision.miz]
const fs = require('fs');
const path = require('path');
const Geo = require('../src/shared/geo');
const { readMiz } = require('../src/main/miz');
const { buildMissionModel } = require('../src/main/mission-model');
const { parseDtc } = require('../src/main/dtc');
const routeFromDtc = (j) => { const r = parseDtc(j).route; return r.length ? r : null; };

let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'OK  ' : 'FAIL'} ${m}`); if (!c) fails++; };

(async () => {
  // 1) Ruta del DTC
  const dtcFile = process.argv[2];
  if (dtcFile && fs.existsSync(dtcFile)) {
    const pts = routeFromDtc(JSON.parse(fs.readFileSync(dtcFile, 'utf8')));
    ok(pts && pts.length >= 2 && pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)), `DTC ${path.basename(dtcFile)}: ${pts ? pts.length : 0} puntos (WP${pts && pts[0].num}…WP${pts && pts[pts.length - 1].num})`);
  }
  ok(routeFromDtc({ data: { NAV: [{ waypoints: [{ x: 1, y: 2 }, { x: 3, y: 4 }] }] } }).length === 2, 'DTC del F-14 (NAV[].waypoints)');
  ok(routeFromDtc({ data: { COMM: {} } }) === null, 'DTC sin ruta → nada');

  // 2) Bando
  const miz = process.argv[3];
  if (miz && fs.existsSync(miz)) {
    const data = readMiz(miz, { extractImages: false });
    for (const coal of ['red', 'blue']) {
      const m = buildMissionModel(data.mission, { coal, warehouses: data.warehouses });
      if (!m.unit) { console.log(`     (sin plazas ${coal})`); continue; }
      ok(m.coalition === coal, `Bando ${coal}: unidad ${m.unit.name} (${m.coalition})`);
      const groupsOther = [];
      ok(m.support.length >= 0 && !m.support.some((s) => groupsOther.includes(s.group)), `Bando ${coal}: ${m.support.length} medios de apoyo, todos propios`);
      const whs = (data.warehouses && data.warehouses.airports) || {};
      const enemy = m.airfields.filter((b) => whs[b.id] && String(whs[b.id].coalition).toLowerCase() !== 'neutral' && String(whs[b.id].coalition).toLowerCase() !== coal);
      ok(enemy.length === 0, `Bando ${coal}: ${m.airfields.length} aeródromos visibles, ninguno enemigo`);
    }
    const dtc = { ...parseDtc({ name: 'prueba', data: { NAV: [{ waypoints: [{ x: 0, y: 0 }, { x: 10000, y: 10000 }] }] } }), useRoute: true };
    const m2 = buildMissionModel(data.mission, { dtc });
    ok(m2.routeSource === 'DTC prueba' && m2.route.length === 2 && m2.missionRoute.length >= 1, `Ruta del DTC sustituye a la de la misión (${m2.routeSource})`);
  }

  // 3) Secuencia por número de waypoint
  const { advanceSeq } = await import('../src/renderer/js/tabs/mission.js');
  const route = [{ lat: 0, lon: 0 }, { lat: 0, lon: 1 }, { lat: 0, lon: 2 }, { lat: 1, lon: 2 }].map((p, i) => ({ ...p, idx: i }));
  let seq = advanceSeq(route, null, { lat: 0, lon: 0.5 }, Geo);
  ok(seq === 1, `A mitad del primer tramo el objetivo es WP1 (${seq})`);
  seq = advanceSeq(route, seq, { lat: 0, lon: 1.8 }, Geo);
  ok(seq === 2, `Rebasado WP1 → WP2 (${seq})`);
  seq = advanceSeq(route, 3, { lat: 0, lon: 0.9 }, Geo);
  ok(seq === 3, `Cerca de WP1 pero con WP3 de objetivo: no salta atrás al más cercano (${seq})`);
  seq = advanceSeq(route, 1, { lat: 0, lon: 0.5, gotoIdx: 3 }, Geo);
  ok(seq === 3, `Si el avión informa de su punto activo, manda ese (${seq})`);

  console.log(fails ? `\n${fails} fallos` : '\nTodo correcto');
  process.exit(fails ? 1 : 0);
})();
