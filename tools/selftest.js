// Pruebas rápidas sin DCS: proyección, MGRS, lector de .miz y modelo de misión.
// Uso: node tools/selftest.js [ruta.miz ...]
const path = require('path');
const fs = require('fs');
const Geo = require('../src/shared/geo');

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'OK  ' : 'FAIL'} ${msg}`); if (!cond) fails++; };

// 1) Proyección frente a pyproj (vectores generados por export_airports.py)
const vecPath = path.join(__dirname, 'geo_vectors.json');
if (fs.existsSync(vecPath)) {
  const vecs = JSON.parse(fs.readFileSync(vecPath, 'utf8'));
  let worst = 0, worstBack = 0;
  for (const v of vecs) {
    const r = Geo.dcsToLL(v.t, v.x, v.y);
    if (!r) { ok(false, `mapa sin proyección: ${v.t}`); continue; }
    const err = Geo.distanceM(r, { lat: v.lat, lon: v.lon });
    worst = Math.max(worst, err);
    const back = Geo.llToDcs(v.t, v.lat, v.lon);
    worstBack = Math.max(worstBack, Math.hypot(back.x - v.x, back.y - v.y));
  }
  ok(worst < 2, `inversa TM: ${vecs.length} puntos, error máximo ${worst.toFixed(3)} m`);
  ok(worstBack < 2, `directa TM: error máximo ${worstBack.toFixed(3)} m`);
}

// 2) MGRS con puntos conocidos
ok(Geo.toMGRS(38.897676, -77.036530).startsWith('18S UJ 2337 0647'.slice(0, 9)), `MGRS Casa Blanca → ${Geo.toMGRS(38.897676, -77.036530)}`);
ok(Geo.toMGRS(-51.6940, -57.8550).startsWith('21F'), `MGRS Malvinas → ${Geo.toMGRS(-51.6940, -57.8550)}`);
ok(Geo.fmtDDM(35.5, true, 3) === "N 35°30.000'", `DDM → ${Geo.fmtDDM(35.5, true, 3)}`);
ok(Geo.fmtDMS(-115.03458, false, 1) === `W 115°02'04.5"`, `DMS → ${Geo.fmtDMS(-115.03458, false, 1)}`);

// 3) Lector de .miz y modelo de misión
const { readMiz } = require('../src/main/miz');
const { buildMissionModel, listPlayerUnits } = require('../src/main/mission-model');
for (const miz of process.argv.slice(2)) {
  try {
    const data = readMiz(miz, { extractImages: false });
    const units = listPlayerUnits(data.mission);
    ok(units.length > 0, `${path.basename(miz)}: ${data.mission.theatre}, ${units.length} plazas de jugador`);
    const m = buildMissionModel(data.mission, { unitName: units[0] && units[0].unitName });
    console.log(JSON.stringify({
      unidad: m.unit && m.unit.name, avion: m.unit && m.unit.type,
      wps: m.route.length, radios: m.radios.map((r) => `${r.name}:${r.channels.length}`),
      apoyo: m.support.map((s) => `${s.kind} ${s.callsign} ${s.freq || ''}`).slice(0, 6),
      bulls: m.bullseye && Geo.fmtDDM(m.bullseye.lat, true) + ' ' + Geo.fmtDDM(m.bullseye.lon, false),
      hora: m.startTimeText,
    }, null, 1));
  } catch (e) {
    ok(false, `${miz}: ${e.stack}`);
  }
}

console.log(fails ? `\n${fails} fallos` : '\nTodo correcto');
process.exit(fails ? 1 : 0);
