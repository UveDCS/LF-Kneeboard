// Lector completo de los DTC de DCS (cartucho de datos en JSON): F-16C, F/A-18C y F-14.
// Devuelve un modelo común para el kneeboard: radios, rutas con tiempos, contramedidas, amenazas,
// líneas y puntos del mapa, RWR, HARM, JDAM, VIP/VRP y ajustes de navegación, más una revisión con avisos.
// Las coordenadas quedan en x/y de DCS; la conversión a lat/lon la hace el modelo de la misión.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const KMH_KT = 1 / 1.852;
const M_FT = 3.28084;
const M_NM = 1 / 1852;

const arr = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const isXY = (p) => p && typeof p.x === 'number' && typeof p.y === 'number';
const xy = (p) => ({ x: p.x, y: p.y });

// Avión del DTC → nombre corto para enseñar.
const AIRCRAFT = { 'F-16C_50': 'F-16C', 'FA-18C_hornet': 'F/A-18C', 'F-14B': 'F-14B', 'F-14A-135-GR': 'F-14A', 'F-14BU': 'F-14B (U)' };

function readDtcFile(file) {
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  return parseDtc(json, { file });
}

// «Do not upload tab data» del editor de DTC: la sección lleva mirror_<NOMBRE> = true y DCS no la carga en el
// avión (se queda lo que ya tenía). El kneeboard tampoco la usa.
const MIRRORS = [
  { sec: 'COMM', key: 'COMM1', label: 'COMM 1' },
  { sec: 'COMM', key: 'COMM2', label: 'COMM 2' },
  { sec: 'WYPT', key: 'NAV_PTS', label: 'waypoints' },
  { sec: 'MPD', key: 'NAV_PTS', label: 'waypoints' },
  { sec: 'MPD', key: 'DEST', label: 'destinos' },
  { sec: 'MPD', key: 'GEO_LINES', label: 'líneas geográficas' },
  { sec: 'MPD', key: 'THREAT_PTS', label: 'amenazas' },
  { sec: 'SA', key: 'MEZ_THRTS', label: 'amenazas (MEZ)' },
];
const notUploaded = (d, sec, key) => !!(d && d[sec] && d[sec][`mirror_${key}`] === true);

function parseDtc(json, { file = '' } = {}) {
  const d = obj(json && json.data);
  const type = (json && json.type) || d.type || '';
  const name = (json && json.name) || d.name || d.cartridge_name || (file ? path.basename(file, '.dtc') : '');
  const out = {
    name, type, aircraft: AIRCRAFT[type] || type, terrain: d.terrain || '', file,
    radios: radiosFromDtc(json),
    routes: routesOf(d),
    lines: linesOf(d),
    caps: capsOf(d),
    threats: threatsOf(d),
    cmds: cmdsOf(d),
    rwr: rwrOf(d),
    harm: harmOf(d),
    jdam: jdamOf(d),
    vip: vipOf(d),
    nav: navOf(d),
    tis: d.TIS ? { ownCallsign: String(d.TIS.own_callsign || '').trim(), missionCallsign: !!d.TIS.use_mission_callsign, sendTo: arr(d.TIS.send_to_callsigns) } : null,
    sections: Object.keys(d).filter((k) => d[k] && typeof d[k] === 'object'),
    notUploaded: [...new Set(MIRRORS.filter((m) => notUploaded(d, m.sec, m.key)).map((m) => m.label))],
  };
  out.route = (out.routes.find((r) => r.points.length >= 2) || { points: [] }).points;
  return out;
}

// ------------------------------------------------------------------ radios
function radiosFromDtc(dtc) {
  const comm = dtc && dtc.data && dtc.data.COMM;
  if (!comm) return [];
  const out = [];
  for (const [radioName, chans] of Object.entries(comm)) {
    if (!chans || typeof chans !== 'object' || radioName.startsWith('mirror')) continue;
    if (comm[`mirror_${radioName}`] === true) continue; // «Do not upload tab data»: esa radio se queda como en la misión
    // Canales numerados (1…20) y especiales sin número (CUE, GUARD, MAN, MAR…), que van al final con su nombre.
    const channels = Object.entries(chans)
      .filter(([, v]) => v && typeof v === 'object')
      .map(([k, v]) => {
        const digits = String(k).replace(/\D/g, '');
        const special = String(k).replace(/^Channel_?/i, '');
        return {
          ch: digits ? Number(digits) : special || k, order: digits ? Number(digits) : 1000,
          freq: Number(v.freq != null ? v.freq : v.frequency), mod: v.modulation || 0,
          name: v.name && !/^CH ?\d+$/i.test(v.name) ? v.name : '',
        };
      })
      .filter((c) => Number.isFinite(c.freq))
      .sort((a, b) => a.order - b.order);
    const dtcName = dtc.name || (dtc.data && dtc.data.name) || '';
    if (channels.length) out.push({ name: radioName.replace(/(\D)(\d)/, '$1 $2'), source: `DTC ${dtcName}`.trim(), channels });
  }
  return out;
}

// ------------------------------------------------------------------ rutas
// Punto común: num (el número del avión), x/y, altM, name, tos (hora fijada o prevista, segundos del día
// o relativa al inicio de la misión: se resuelve en el modelo), fixed (hora fija), speedKt, tgt (objetivo).
function point(p, extra = {}) {
  return {
    num: Number(p.wypt_num ?? p.number ?? p.num ?? 0), x: p.x, y: p.y,
    altM: num(p.alt ?? p.altitude), name: String(p.text_note || p.note || p.name || '').trim(),
    tos: null, fixed: false, speedKt: null, tgt: false, ...extra,
  };
}

function routesOf(d) {
  // Waypoints marcados «Do not upload tab data»: el avión se queda con la ruta de la misión.
  if (notUploaded(d, 'WYPT', 'NAV_PTS') || notUploaded(d, 'MPD', 'NAV_PTS')) return [];
  // F/A-18: WYPT.NAV_PTS + rutas 1–3 (R1/R1_order…) con sus tiempos en WYPT.NAV_ROUTE.
  if (d.WYPT && Array.isArray(d.WYPT.NAV_PTS)) {
    const pts = d.WYPT.NAV_PTS.filter(isXY);
    const timing = arr(d.WYPT.NAV_ROUTE);
    const routes = [];
    for (const r of [1, 2, 3]) {
      const t = obj(timing[r - 1]);
      const byNum = new Map(Object.values(t).filter((s) => s && typeof s === 'object').map((s) => [Number(s.wypt_num), s]));
      const sel = pts.filter((p) => p[`R${r}`]).sort((a, b) => (a[`R${r}_order`] || 0) - (b[`R${r}_order`] || 0));
      if (!sel.length) continue;
      routes.push({
        num: r, name: `Ruta ${r}`,
        points: sel.map((p) => {
          const s = byNum.get(Number(p.wypt_num)) || {};
          return point(p, {
            altM: num(s.alt ?? p.alt), tos: num(s.ETA), fixed: !!s.FIX_Time,
            speedKt: num(s.speed) != null ? Math.round(num(s.speed) * KMH_KT) : null, tgt: !!s.TGT,
          });
        }),
      });
    }
    // Puntos sueltos que no están en ninguna ruta: como lista aparte.
    const loose = pts.filter((p) => ![1, 2, 3].some((r) => p[`R${r}`])).sort((a, b) => a.wypt_num - b.wypt_num);
    if (loose.length) routes.push({ num: 0, name: 'Puntos sin ruta', points: loose.map((p) => point(p)) });
    return routes;
  }
  // F-16: MPD.NAV_PTS con TOS (hora sobre el punto), FIX_Time y velocidad.
  if (d.MPD && Array.isArray(d.MPD.NAV_PTS)) {
    const pts = d.MPD.NAV_PTS.filter(isXY).sort((a, b) => a.number - b.number);
    if (!pts.length) return [];
    return [{
      num: 1, name: 'Steerpoints',
      points: pts.map((p) => point(p, {
        tos: p.isTOSEnabled === false ? null : num(p.TOS), fixed: !!p.FIX_Time,
        speedKt: num(p.speed) != null ? Math.round(num(p.speed) * KMH_KT) : null, tgt: p.type === 'TGT' || /tgt|target|objetivo/i.test(p.note || ''),
      })),
    }];
  }
  // F-14: NAV[] con varias rutas.
  if (Array.isArray(d.NAV)) {
    return d.NAV.map((r, i) => ({ num: i + 1, name: r.name || `Ruta ${i + 1}`, points: arr(r.waypoints).filter(isXY).map((p, j) => point(p, { num: Number(p.number ?? p.num ?? j + 1) })) }))
      .filter((r) => r.points.length);
  }
  // Cualquier otro: la primera lista de puntos con x/y.
  let pts = null;
  const walk = (v, depth) => {
    if (pts || depth > 4 || !v || typeof v !== 'object') return;
    if (Array.isArray(v) && v.length >= 2 && v.every(isXY)) { pts = v; return; }
    for (const x of Object.values(v)) walk(x, depth + 1);
  };
  walk(d, 0);
  return pts ? [{ num: 1, name: 'Ruta', points: pts.map((p, i) => point(p, { num: Number(p.wypt_num ?? p.number ?? p.num ?? i + 1) })).sort((a, b) => a.num - b.num) }] : [];
}

// ------------------------------------------------------------------ mapa: líneas, CAP y amenazas
function linesOf(d) {
  const out = [];
  // F-16: líneas geográficas 1–4 (cada punto dice a qué líneas pertenece).
  const geo = notUploaded(d, 'MPD', 'GEO_LINES') ? [] : arr(d.MPD && d.MPD.GEO_LINES).filter(isXY);
  for (const L of [1, 2, 3, 4]) {
    const pts = geo.filter((p) => p[`L${L}`]).sort((a, b) => a.number - b.number);
    if (pts.length >= 2) out.push({ kind: 'geo', label: `Línea ${L}`, points: pts.map(xy) });
  }
  // F/A-18: FLOT, FAOR y corredores.
  const sa = obj(d.SA);
  const ff = obj(sa.FAOR_FLOT);
  for (const f of arr(ff.FLOT)) if (arr(f.points).filter(isXY).length >= 2) out.push({ kind: 'flot', label: f.note || `FLOT ${f.num || ''}`.trim(), points: f.points.filter(isXY).map(xy) });
  for (const f of arr(ff.FAOR)) if (arr(f.points).filter(isXY).length >= 2) out.push({ kind: 'faor', label: f.note || `FAOR ${f.num || ''}`.trim(), points: f.points.filter(isXY).map(xy), closed: true });
  for (const c of arr(sa.CORRIDORS)) {
    const pts = arr(c.points).filter(isXY);
    if (pts.length >= 2) out.push({ kind: 'corridor', label: c.note || `Corredor ${c.num || ''}`.trim(), points: pts.map(xy), widthNm: num(c.width) != null ? num(c.width) * M_NM : null });
  }
  return out;
}

function capsOf(d) {
  return arr(d.SA && d.SA.CAP_PTS).filter(isXY).map((c) => ({
    num: c.num, x: c.x, y: c.y, label: c.note || `CAP ${c.num || ''}`.trim(),
    course: num(c.course), lengthNm: num(c.length) != null ? num(c.length) * M_NM : null,
    diameterNm: num(c.diameter) != null ? num(c.diameter) * M_NM : null, turn: c.turn_direction === 'Right' ? 'derecha' : 'izquierda',
  }));
}

function threatsOf(d) {
  const out = [];
  for (const t of notUploaded(d, 'SA', 'MEZ_THRTS') ? [] : arr(d.SA && d.SA.MEZ_THRTS).filter(isXY)) {
    out.push({ num: t.num, x: t.x, y: t.y, type: t.threat_type || '', label: t.text || `MEZ ${t.num || ''}`.trim(), radiusNm: num(t.threat_ring_radius), level: num(t.threat_level), src: 'MEZ' });
  }
  for (const t of notUploaded(d, 'MPD', 'THREAT_PTS') ? [] : arr(d.MPD && d.MPD.THREAT_PTS).filter(isXY)) {
    const r = num(t.range ?? t.radius ?? t.threat_ring_radius ?? t.Range);
    out.push({ num: t.number ?? t.num, x: t.x, y: t.y, type: t.type || t.threat_type || '', label: t.note || t.text || t.type || `Amenaza ${t.number || ''}`.trim(), radiusNm: r, level: null, src: 'HSD' });
  }
  return out;
}

// ------------------------------------------------------------------ contramedidas
// Texto de un dispensador: total y cómo sale (salvas × cantidad, cada cuánto).
function burstSalvo(x) {
  const bq = num(x && x.BurstQuantity) || 0, sq = num(x && x.SalvoQuantity) || 0;
  if (!bq || !sq) return null;
  return { total: bq * sq, text: `${bq * sq}`, detail: `${sq} × ${bq}${sq > 1 ? ` cada ${num(x.SalvoInterval)} s` : ''}${bq > 1 ? ` (ráfaga ${num(x.BurstInterval)} s)` : ''}` };
}
function qtyRepeat(x) {
  const q = num(x && x.Quantity) || 0, r = num(x && x.Repeat) || 1;
  if (!q) return null;
  return { total: q * r, text: `${q * r}`, detail: r > 1 ? `${r} × ${q} cada ${num(x.Interval)} s` : `${q} de golpe` };
}

const PROG_NAME = (k) => String(k).replace(/^PROG_/, 'PROG ').replace(/^(MAN|AUTO)_?(\d)/, '$1 $2');

function cmdsOf(d) {
  const src = (d.MPD && d.MPD.CMDS) || (d.ALR67 && d.ALR67.CMDS) || d.CMDS;
  if (!src) return null;
  const progs = obj(src.CMDSProgramSettings);
  const f18 = !!(d.ALR67 && d.ALR67.CMDS);
  const programs = Object.entries(progs)
    .filter(([, v]) => v && typeof v === 'object')
    .map(([k, v]) => {
      const chaff = f18 ? qtyRepeat(v.Chaff) : burstSalvo(v.Chaff);
      const flare = f18 ? qtyRepeat(v.Flare) : burstSalvo(v.Flare);
      const other = [v.Other1, v.Other2].map((o) => (f18 ? qtyRepeat(o) : burstSalvo(o))).filter(Boolean);
      return { id: k, name: PROG_NAME(k), chaff, flare, other: other.length ? other : null, priority: num(v.Priority) };
    })
    .sort((a, b) => order(a.id) - order(b.id));
  const bingo = src.CMDSBingoSettings ? { chaff: num(src.CMDSBingoSettings.ChaffNum), flare: num(src.CMDSBingoSettings.FlaresNum) } : null;
  // Programa automático por tipo de amenaza (F-16 / F-18: tabla por amenaza; F-14: por categoría).
  const auto = [];
  const table = src.CMDSPrograms || src.CMDS_Threat_table;
  if (table) {
    const CAT = { Air: 'Aire', Ground: 'Tierra', Naval: 'Naval', Other: 'Otros' };
    for (const [cat, list] of Object.entries(table)) {
      if (!CAT[cat] || !list || typeof list !== 'object') continue;
      for (const [threat, v] of Object.entries(list)) {
        if (!v || !num(v.program)) continue;
        auto.push({ cat: CAT[cat], threat, program: num(v.program), threshold: v.default_threshold && v.default_threshold.label });
      }
    }
  }
  if (src.CMDSAutoPrograms) {
    const CAT = { AAA: 'AAA', Aircraft: 'Aviones', Naval: 'Naval', SAM: 'SAM', Unknown: 'Desconocida' };
    for (const [cat, v] of Object.entries(src.CMDSAutoPrograms)) auto.push({ cat: CAT[cat] || cat, threat: CAT[cat] || cat, program: num(v.Program), threshold: v.Threshold != null ? `umbral ${v.Threshold}` : null });
  }
  return { programs, bingo, auto, delay: num(src.delay_between_programs ?? (table && table.delayBetweenPrograms)) };
}

function order(id) {
  const m = /^(MAN|AUTO|PROG|BYP)_?(\d*)/.exec(id) || [];
  return ({ MAN: 0, PROG: 0, AUTO: 10, BYP: 20 }[m[1]] ?? 30) + (Number(m[2]) || 0);
}

// ------------------------------------------------------------------ RWR y HARM
function rwrOf(d) {
  const src = (d.ELINT && d.ELINT.RWR) || (d.ALR67 && d.ALR67.RWR);
  if (!src) return null;
  const MODE = { HIGH: 'Prioridad alta (HIGH)', LOW: 'Prioridad baja (LOW)', NORM: 'Normal (NORM)', AI: 'Aire (AI)', AAA: 'Antiaérea (AAA)', UNK: 'Desconocidas (UNK)', FRND: 'Amigos (FRND)' };
  const modes = [];
  for (const [k, list] of Object.entries(src)) {
    if (!MODE[k] || !list || typeof list !== 'object') continue;
    const all = Object.entries(list).filter(([, v]) => v && typeof v === 'object');
    const shown = all.filter(([, v]) => v.display !== false && num(v.PRI) != null).sort((a, b) => a[1].PRI - b[1].PRI);
    modes.push({ id: k, name: MODE[k], top: shown.slice(0, 12).map(([n, v]) => ({ name: n, pri: v.PRI })), hidden: all.filter(([, v]) => v.display === false).map(([n]) => n), total: all.length });
  }
  return modes.length ? { modes } : null;
}

function harmOf(d) {
  const h = d.HARM;
  if (!h || !h.TOO_CLASS) return null;
  const byClass = new Map();
  for (const [n, c] of Object.entries(h.TOO_CLASS)) {
    if (!byClass.has(c)) byClass.set(c, []);
    byClass.get(c).push(n);
  }
  const s = obj(h.SETTINGS);
  return {
    defaultClass: num(s.Threat_Class), targetCode: s.Target_Code || '', limit: !!s.LIMIT,
    classes: [...byClass.entries()].sort((a, b) => a[0] - b[0]).map(([cls, names]) => ({ cls, names: names.sort() })),
  };
}

// ------------------------------------------------------------------ JDAM y VIP/VRP
function jdamOf(d) {
  const st = arr(d.JDAM && d.JDAM.stations);
  if (!st.length) return null;
  const stations = st.map((s, i) => ({
    station: s.station ?? i + 1,
    targets: arr(s.targets).map((t, j) => ({
      n: j + 1, name: t.name || '', active: !!t.active,
      x: num(t.x), y: num(t.y), lat: num(t.lat ?? t.latitude), lon: num(t.lon ?? t.longitude),
      elevFt: num(t.elev), dropAltFt: num(t.drop_alt), dropKt: num(t.drop_spd),
      impactAngle: t.has_impact_angle ? num(t.impact_angle) : null, impactHeading: t.has_impact_heading ? num(t.impact_heading) : null,
      attackHeading: num(t.attack_heading), rminNm: num(t.lar_rmin_nmi), rmaxNm: num(t.lar_rmax_nmi),
    })).filter((t) => t.active || t.name),
  }));
  return { stations, any: stations.some((s) => s.targets.length) };
}

function vipOf(d) {
  const v = d.MPD && d.MPD.VIPVRP;
  if (!v) return null;
  const leg = (k) => ({ bearing: num(v[`${k}_Bearing`]), range: num(v[`${k}_Range`]), elev: num(v[`${k}_Elevation`]) });
  const out = [];
  if (v.VIP_Enabled) out.push({ kind: 'VIP', stpt: num(v.VIP_Number), toTgt: leg('VIPTOTGT'), toPup: v.VIPPUP_Enabled ? leg('VIPTOPUP') : null });
  if (v.VRP_Enabled) out.push({ kind: 'VRP', stpt: num(v.VRP_Number), toTgt: leg('TGTTOVRP'), toPup: v.VRPPUP_Enabled ? leg('TGTTOPUP') : null });
  return out.length ? out : null;
}

// ------------------------------------------------------------------ ajustes de navegación (F/A-18)
function navOf(d) {
  const s = d.WYPT && d.WYPT.NAV_SETTINGS;
  if (!s) return null;
  const t = obj(s.TACAN), i = obj(s.ICLS), a = obj(s.ACLS), w = obj(s.Altitude_Warning);
  return {
    tacan: t.OnOff ? `${t.Channel}${t.ChannelMode === 2 ? 'Y' : 'X'}` : null,
    icls: i.OnOff ? `ICLS ${i.Channel}` : null,
    acls: a.OnOff ? `ACLS ${a.Frequency}` : null,
    altWarnBaroFt: num(w.Warn_Alt_Baro), altWarnRdrFt: num(w.Warn_Alt_Rdr),
    home: num(obj(s.Home_Waypoint).FPAS_HOME_WP),
    aaWp: obj(s.AA_Waypoint).AA_WP_Enabled ? num(obj(s.AA_Waypoint).AA_WP_Number) : null,
  };
}

// ------------------------------------------------------------------ revisión
// Avisos útiles antes de despegar: que el DTC sea del avión y del mapa, que la ruta y las radios cuadren con la misión
// y qué secciones vienen vacías.
const THEATRE_ALIASES = { Caucasus: ['caucasus'], Nevada: ['nevada', 'nttr'], PersianGulf: ['persiangulf', 'persian gulf'], Syria: ['syria'], MarianaIslands: ['marianaislands', 'marianas'] };
function sameTheatre(a, b) {
  if (!a || !b) return true;
  const n = (s) => String(s).toLowerCase().replace(/[^a-z]/g, '');
  if (n(a) === n(b)) return true;
  const al = THEATRE_ALIASES[b] || [];
  return al.some((x) => n(x) === n(a));
}

function review(dtc, mission) {
  const items = [];
  const add = (level, text) => items.push({ level, text });
  const type = mission && mission.unit && mission.unit.type;
  if (type && dtc.type && type !== dtc.type) add('error', `Es un DTC de ${dtc.aircraft} y tu avión es ${type}.`);
  if (mission && dtc.terrain && !sameTheatre(dtc.terrain, mission.theatre)) add('error', `El DTC es del mapa ${dtc.terrain} y la misión es de ${mission.theatre}.`);
  const nu = dtc.notUploaded || [];
  if (nu.length) add('info', `Marcado «Do not upload tab data» (no se carga en el avión): ${nu.join(', ')}. El kneeboard tampoco lo usa y deja lo de la misión.`);
  const commOff = nu.some((s) => /^COMM/.test(s));
  if (!dtc.radios.length) { if (dtc.sections.includes('COMM') && !commOff) add('warn', 'Los presets de radio están vacíos.'); }
  else if (mission && mission.radios && mission.radios.length) {
    const r = dtc.radios[0];
    const m = mission.radios.find((x) => x.name === r.name);
    const a = r.channels.filter((c) => typeof c.ch === 'number');
    const b = new Map(((m && m.channels) || []).map((c) => [c.ch, c.freq > 10000 ? c.freq / 1e6 : c.freq]));
    const diff = a.filter((c) => b.has(c.ch) && Math.abs(b.get(c.ch) - c.freq) > 0.001).length;
    if (diff) add('info', `${diff} presets de ${r.name} son distintos de los de la misión (manda el DTC si lo cargas en cabina).`);
  }
  if (!dtc.route.length) add('warn', nu.includes('waypoints') ? 'Waypoints sin cargar (Do not upload): el plan de vuelo usará la ruta de la misión.' : 'No trae ruta: el plan de vuelo usará la de la misión.');
  else {
    const t0 = dtc.route.find((p) => p.tos != null);
    const start = mission && mission.startTime;
    const hhmm = (s) => `${String(Math.floor((s % 86400) / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
    if (t0 && start && (t0.tos < start - 3600 || t0.tos > start + 8 * 3600)) {
      add('warn', `Las horas del DTC (${hhmm(t0.tos)}) no cuadran con el inicio de la misión (${hhmm(start)}): revisa el TOT antes de fiarte de él.`);
    }
    const fixed = dtc.route.filter((p) => p.fixed).length;
    if (fixed) add('ok', `${fixed} punto${fixed > 1 ? 's' : ''} con hora fija: el plan de vuelo te dirá si llegas pronto o tarde.`);
    const tgts = dtc.route.filter((p) => p.tgt).length;
    if (tgts) add('ok', `${tgts} punto${tgts > 1 ? 's' : ''} marcado${tgts > 1 ? 's' : ''} como objetivo.`);
    if (mission && mission.missionRoute && mission.missionRoute.length > 1 && Math.abs(mission.missionRoute.length - dtc.route.length) > 1) {
      add('info', `La ruta del DTC tiene ${dtc.route.length} puntos y la de la misión ${mission.missionRoute.length}.`);
    }
  }
  if (dtc.cmds) {
    if (!dtc.cmds.programs.some((p) => p.chaff || p.flare)) add('warn', 'Los programas de contramedidas están vacíos.');
    if (dtc.cmds.bingo && (dtc.cmds.bingo.chaff === 0 || dtc.cmds.bingo.flare === 0)) add('info', 'El aviso de bingo de chaff o bengalas está a 0.');
  }
  const sa = dtc.sections.includes('SA');
  if (sa) {
    if (!dtc.threats.length) add('info', 'Sin amenazas (MEZ) en el SA.');
    if (!dtc.caps.length) add('info', 'Sin puntos de CAP.');
    if (!dtc.lines.some((l) => l.kind === 'flot')) add('info', 'Sin FLOT.');
  }
  if (dtc.jdam && !dtc.jdam.any) add('info', 'Sin objetivos de JDAM cargados.');
  if (dtc.nav && dtc.nav.aaWp == null) add('info', 'Sin waypoint A/A (bullseye) activado.');
  return items;
}

// ------------------------------------------------------------------ archivos
// DTC que vienen con la misión: carpeta «DTC» junto al .miz (o la del propio .miz).
function missionDtcs(mizFile) {
  if (!mizFile) return [];
  const dir = path.dirname(mizFile);
  const out = [];
  for (const d of [path.join(dir, 'DTC'), dir]) {
    let list = [];
    try { list = fs.readdirSync(d); } catch { continue; }
    for (const f of list) if (/\.dtc$/i.test(f)) out.push(path.join(d, f));
  }
  return out;
}

// DTC metido en el .miz para este avión: el que la plaza lleva por defecto (unit.DTC.Cartridges),
// si no, otro de los suyos y, si la plaza no dice nada, el primero de ese tipo.
function pickMissionDtc(files, type, cartridges) {
  const ofType = arr(files).filter((f) => typeOf(f) === type);
  if (!ofType.length) return null;
  const nameOf = (f) => {
    try { return JSON.parse(fs.readFileSync(f, 'utf8')).name || path.basename(f, '.dtc'); } catch { return path.basename(f, '.dtc'); }
  };
  const carts = [...arr(cartridges)].sort((a, b) => (b && b.default ? 1 : 0) - (a && a.default ? 1 : 0));
  for (const c of carts) {
    const hit = c && ofType.find((f) => nameOf(f) === c.name || path.basename(f, '.dtc') === c.name);
    if (hit) return hit;
  }
  return carts.length ? null : ofType[0];
}

function typeOf(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    return j.type || (j.data && j.data.type) || null;
  } catch {
    return null;
  }
}

// Carpeta de Saved Games\DCS\DTC donde DCS guarda los de ese avión (la que ya tenga alguno de ese tipo).
function folderFor(dtcDirs, type) {
  for (const root of dtcDirs) {
    let subs = [];
    try { subs = fs.readdirSync(root); } catch { continue; }
    for (const s of subs) {
      const dir = path.join(root, s);
      let files = [];
      try { files = fs.readdirSync(dir); } catch { continue; }
      if (files.some((f) => /\.dtc$/i.test(f) && typeOf(path.join(dir, f)) === type)) return dir;
    }
  }
  const DEF = { 'F-16C_50': 'F-16', 'FA-18C_hornet': 'F-18' };
  return dtcDirs[0] ? path.join(dtcDirs[0], DEF[type] || type) : null;
}

// Copia un DTC a la carpeta de DCS de su avión (sin pisar uno distinto con el mismo nombre).
function installDtc(dtcDirs, srcFile, { name } = {}) {
  const raw = fs.readFileSync(srcFile, 'utf8');
  const json = JSON.parse(raw);
  const type = json.type || (json.data && json.data.type);
  if (!type) throw new Error('El archivo no parece un DTC de DCS (no dice el avión).');
  const dir = folderFor(dtcDirs, type);
  if (!dir) throw new Error('No encuentro la carpeta Saved Games\\DCS\\DTC.');
  fs.mkdirSync(dir, { recursive: true });
  const base = (name || path.basename(srcFile, '.dtc')).replace(/[<>:"/\\|?*]/g, '_');
  let dest = path.join(dir, `${base}.dtc`);
  for (let i = 2; fs.existsSync(dest) && path.resolve(dest) !== path.resolve(srcFile) && fs.readFileSync(dest, 'utf8') !== raw; i++) dest = path.join(dir, `${base} (${i}).dtc`);
  if (path.resolve(dest) !== path.resolve(srcFile)) fs.writeFileSync(dest, raw);
  return { file: dest, type };
}

// Para enviarlo por la sala: comprimido (los DTC del F/A-18 pasan de 1 MB por las tablas del RWR).
function pack(file) {
  const raw = fs.readFileSync(file);
  const json = JSON.parse(raw.toString('utf8'));
  return { name: json.name || path.basename(file, '.dtc'), aircraftType: json.type || '', data: zlib.deflateSync(raw).toString('base64') };
}
function unpack(item, dir) {
  const raw = zlib.inflateSync(Buffer.from(String(item.data || ''), 'base64'));
  const json = JSON.parse(raw.toString('utf8'));
  if (!json || !json.data) throw new Error('No es un DTC');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${Date.now().toString(36)}-${String(item.name || 'dtc').replace(/[<>:"/\\|?*]/g, '_')}.dtc`);
  fs.writeFileSync(file, raw);
  return { file, name: json.name || item.name, type: json.type || '' };
}

module.exports = { readDtcFile, parseDtc, radiosFromDtc, review, missionDtcs, pickMissionDtc, typeOf, folderFor, installDtc, pack, unpack, M_FT };
