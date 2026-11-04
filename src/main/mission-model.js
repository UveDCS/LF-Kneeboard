// Convierte la tabla "mission" de DCS en los datos que usan las páginas dinámicas:
// ruta del jugador, presets de radio, apoyo (tanqueros, AWACS, JTAC, portaaviones), bullseye y aeródromos.
const path = require('path');
const fs = require('fs');
const Geo = require('../shared/geo');
const { list } = require('./miz');
const DTC = require('./dtc');

const CATEGORIES = ['plane', 'helicopter', 'ship', 'vehicle'];

let AIRPORTS = null;
function airports(theatre) {
  if (!AIRPORTS) {
    try {
      AIRPORTS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'airports.json'), 'utf8'));
    } catch {
      AIRPORTS = {};
    }
  }
  return AIRPORTS[theatre] || AIRPORTS[String(theatre).replace(/WWII$/, '')] || [];
}

let WEAPONS = null;
function weaponName(clsid) {
  if (!WEAPONS) {
    try {
      WEAPONS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'weapons.json'), 'utf8'));
    } catch {
      WEAPONS = {};
    }
  }
  return WEAPONS[clsid] || clsid;
}

function loadoutOf(unit) {
  const pylons = unit && unit.payload && unit.payload.pylons;
  if (!pylons) return [];
  return Object.keys(pylons)
    .filter((k) => /^\d+$/.test(k) && pylons[k] && pylons[k].CLSID)
    .sort((a, b) => a - b)
    .map((k) => ({ station: Number(k), clsid: pylons[k].CLSID, name: weaponName(pylons[k].CLSID) }));
}

function* eachGroup(mission, coalitionFilter) {
  const coalitions = (mission && mission.coalition) || {};
  for (const [coalName, coal] of Object.entries(coalitions)) {
    if (coalitionFilter && coalName !== coalitionFilter) continue;
    for (const country of list(coal && coal.country)) {
      for (const cat of CATEGORIES) {
        for (const group of list(country[cat] && country[cat].group)) {
          yield { coalition: coalName, country: country.name, category: cat, group };
        }
      }
    }
  }
}

function callsignOf(unit, group) {
  const cs = unit && unit.callsign;
  if (cs && typeof cs === 'object' && cs.name) return cs.name;
  if (typeof cs === 'string') return cs;
  return (group && group.name) || '';
}

function listPlayerUnits(mission) {
  const out = [];
  for (const { coalition, category, group } of eachGroup(mission)) {
    if (category !== 'plane' && category !== 'helicopter') continue;
    for (const unit of list(group.units)) {
      if (unit.skill === 'Client' || unit.skill === 'Player') {
        out.push({
          unitName: unit.name, groupName: group.name, type: unit.type, coalition,
          callsign: callsignOf(unit, group), skill: unit.skill,
        });
      }
    }
  }
  return out;
}

// Busca tareas por id en cualquier nivel (ComboTask, WrappedAction, etc.).
function findTasks(node, ids, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (node.id && ids.includes(node.id)) out.push(node);
  if (node.params && node.params.action && ids.includes(node.params.action.id)) out.push(node.params.action);
  for (const v of Object.values(node)) if (v && typeof v === 'object') findTasks(v, ids, out);
  return out;
}

function tacanText(p) {
  if (!p) return null;
  const ch = p.channel != null ? `${p.channel}${p.modeChannel || 'X'}` : null;
  return [ch, p.callsign].filter(Boolean).join(' ');
}

const mhz = (f) => (f == null ? null : f > 10000 ? f / 1e6 : f);
const fmtFreq = (f, mod) => (f == null ? null : `${Number(mhz(f)).toFixed(mhz(f) % 1 ? 3 : 1).replace(/0+$/, '').replace(/\.$/, '.0')}${mod === 1 ? ' FM' : ''}`);

function pointLL(theatre, x, y) {
  const ll = Geo.dcsToLL(theatre, x, y);
  return ll ? { lat: ll.lat, lon: ll.lon } : { lat: null, lon: null };
}

function timeText(sec) {
  if (sec == null || !Number.isFinite(sec)) return '';
  const s = ((Math.round(sec) % 86400) + 86400) % 86400;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

const POINT_TYPE = {
  TakeOffParking: 'Salida (frío)', TakeOffParkingHot: 'Salida (caliente)', TakeOff: 'Despegue en pista',
  TakeOffGround: 'Despegue', TakeOffGroundHot: 'Despegue', 'Turning Point': 'Punto', 'Fly Over Point': 'Sobrevuelo',
  Land: 'Aterrizaje', LandingReFuAr: 'Aterrizaje y repostaje',
};

function radiosFromUnit(unit, group) {
  const radios = [];
  const r = unit && unit.Radio;
  list(r).forEach((radio, idx) => {
    const mods = radio.modulations || {};
    const channels = list(radio.channels).map((f, i) => ({
      ch: i + 1, freq: Number(f), mod: list(mods)[i] != null ? list(mods)[i] : 0, name: '',
    }));
    if (channels.length) radios.push({ name: `COMM ${idx + 1}`, source: 'misión', channels });
  });
  return {
    radios,
    groupFreq: group && group.frequency != null ? { freq: Number(group.frequency), mod: group.modulation || 0 } : null,
  };
}

function supportAssets(mission, coalition, theatre) {
  const out = [];
  for (const { category, group } of eachGroup(mission, coalition)) {
    const units = list(group.units);
    const first = units[0] || {};
    const beacons = findTasks(group.route, ['ActivateBeacon']);
    const icls = findTasks(group.route, ['ActivateICLS']);
    const link4 = findTasks(group.route, ['ActivateLink4']);
    const orbit = findTasks(group.route, ['Orbit'])[0];
    const setFreq = findTasks(group.route, ['SetFrequency'])[0];
    const fac = findTasks(group.route, ['FAC', 'FAC_AttackGroup', 'FAC_EngageGroup', 'FAC_EngageType']).length > 0;
    let kind = null;
    if (category === 'plane' && group.task === 'Refueling') kind = 'Tanquero';
    else if (category === 'plane' && group.task === 'AWACS') kind = 'AWACS';
    else if ((category === 'vehicle' || category === 'plane' || category === 'helicopter') && (group.task === 'AFAC' || fac)) kind = 'JTAC';
    else if (category === 'ship' && (beacons.length || icls.length)) kind = 'Barco';
    if (!kind) continue;
    const pts = list(group.route && group.route.points);
    const p0 = pts[0] || { x: first.x, y: first.y };
    const freq = setFreq ? mhz(setFreq.params.frequency) : mhz(group.frequency);
    const mod = setFreq ? setFreq.params.modulation : group.modulation;
    out.push({
      kind,
      callsign: callsignOf(first, group),
      group: group.name,
      type: first.type,
      freq: freq != null ? fmtFreq(freq, mod) : null,
      tacan: tacanText(beacons[0] && beacons[0].params),
      icls: icls[0] && icls[0].params ? `ICLS ${icls[0].params.channel}` : null,
      link4: link4[0] && link4[0].params ? `Link 4 ${fmtFreq(link4[0].params.frequency)}` : null,
      altFt: orbit && orbit.params && orbit.params.altitude ? Math.round(orbit.params.altitude * 3.28084 / 100) * 100 : (p0.alt ? Math.round(p0.alt * 3.28084 / 100) * 100 : null),
      speedKt: orbit && orbit.params && orbit.params.speed ? Math.round(orbit.params.speed * 1.943844) : null,
      x: p0.x, y: p0.y, ...pointLL(theatre, p0.x, p0.y),
      points: pts.slice(0, 6).map((p) => ({ x: p.x, y: p.y, ...pointLL(theatre, p.x, p.y) })),
    });
  }
  const order = { AWACS: 0, Tanquero: 1, Barco: 2, JTAC: 3 };
  return out.sort((a, b) => order[a.kind] - order[b.kind] || a.callsign.localeCompare(b.callsign));
}

// coal: bando conocido del piloto (red / blue). Si se sabe, nunca se elige una unidad del otro bando.
function findUnit(mission, { unitName, groupName, type, coal } = {}) {
  let fallback = null, byType = null;
  for (const { coalition, category, group } of eachGroup(mission)) {
    if (category !== 'plane' && category !== 'helicopter') continue;
    if (coal && coalition !== coal && !unitName) continue;
    for (const unit of list(group.units)) {
      if (unitName && unit.name === unitName) return { unit, group, coalition };
      if (groupName && group.name === groupName && !fallback) fallback = { unit, group, coalition };
      const isPlayer = unit.skill === 'Client' || unit.skill === 'Player';
      if (isPlayer && type && unit.type === type && !byType) byType = { unit, group, coalition };
      if (isPlayer && !fallback && !groupName && !type) fallback = { unit, group, coalition };
    }
  }
  return fallback || byType;
}

function buildMissionModel(mission, sel = {}) {
  const theatre = mission.theatre;
  const found = findUnit(mission, sel) || {};
  const { unit, group, coalition } = found;
  const date = mission.date || {};
  const start = Number(mission.start_time || 0);

  const missionRoute = list(group && group.route && group.route.points).map((p, i) => {
    const ll = pointLL(theatre, p.x, p.y);
    return {
      idx: i, name: p.name || '', x: p.x, y: p.y, ...ll,
      altM: p.alt, altType: p.alt_type === 'RADIO' ? 'AGL' : 'MSL',
      speed: p.speed, eta: p.ETA, etaLocked: !!p.ETA_locked,
      type: p.type, typeText: POINT_TYPE[p.type] || p.type || '',
      airdromeId: p.airdromeId || null,
      tasks: findTasks(p.task, ['Bombing', 'AttackGroup', 'AttackUnit', 'CarpetBombing', 'Orbit', 'EngageTargets', 'EngageTargetsInZone', 'Refueling'])
        .map((t) => t.id),
    };
  });

  // Ruta que se usa: la que lleva el avión (en directo), la del DTC cargado o la de la misión.
  const toRoute = (pts, src) => pts.map((p, i) => ({
    idx: p.idx != null ? p.idx : i, name: p.name || '', x: p.x, y: p.y, ...pointLL(theatre, p.x, p.y),
    altM: p.alt, altType: 'MSL', speed: p.speed || (missionRoute[p.idx != null ? p.idx : i] || {}).speed || null, eta: null, etaLocked: !!p.fixed,
    tos: p.tos != null ? p.tos : null, tgt: !!p.tgt,
    type: 'Turning Point', typeText: p.tgt ? 'Objetivo' : 'Punto', airdromeId: null, tasks: [], source: src,
  }));
  // Hora sobre el punto del DTC: normalmente segundos del día. Algunos DTC guardan las horas fijas como tiempo
  // desde el inicio de la misión (valores pequeños, de menos de 4 h y anteriores a la hora de inicio).
  const tosOf = (v) => (v == null ? null : start && v < 4 * 3600 && v < start - 3600 ? start + v : v);
  const same = (a, b) => a.length === b.length && a.every((p, i) => Math.hypot(p.x - b[i].x, p.y - b[i].y) < 100);
  // Candidatas por orden: la que lleva el avión (si DCS la da y es otra), la más reciente entre la herramienta de
  // ruta del F10 y el editor de DTC del juego, el DTC guardado y, si no hay nada, la de la misión.
  const fromDtc = () => toRoute(sel.dtc.route.map((p) => ({
    ...p, idx: p.num, alt: p.altM, tos: tosOf(p.tos), speed: p.speedKt ? p.speedKt / 1.943844 : null,
  })), 'dtc');
  const fromTool = () => toRoute(sel.routeTool.pts.map((p, i) => ({
    x: p.x, y: p.y, idx: i, name: p.name || '', alt: p.altType === 'RADIO' ? null : p.alt, tos: tosOf(p.eta),
  })), 'herramienta');
  const dtcRoute = sel.dtc && sel.dtc.useRoute && sel.dtc.route.length >= 2;
  const toolRoute = sel.routeTool && sel.routeTool.pts && sel.routeTool.pts.length >= 2;
  const toolFirst = toolRoute && (!dtcRoute || !sel.dtc.at || sel.routeTool.at >= sel.dtc.at);
  const known = [toolRoute ? sel.routeTool.pts : null, dtcRoute ? sel.dtc.route : null].filter(Boolean);
  let route = missionRoute;
  let routeSource = 'misión';
  // Origen elegido a mano en el plan de vuelo (Ajustes guardado en sources.route); si no hay de esa fuente,
  // se queda la de la misión y se dice por qué.
  const pref = sel.routePref || 'auto';
  if (pref === 'mision') {
    routeSource = 'misión (elegida)';
  } else if (pref === 'dtc') {
    if (dtcRoute) { route = fromDtc(); routeSource = sel.dtc.origin === 'editor del juego' ? 'DTC del editor del juego (elegido)' : `DTC ${sel.dtc.name || ''} (elegido)`.replace('  ', ' '); }
    else routeSource = 'misión (no hay ruta de DTC en uso)';
  } else if (pref === 'herramienta') {
    if (toolRoute) { route = fromTool(); routeSource = 'herramienta de ruta del F10 (elegida)'; }
    else routeSource = 'misión (no hay ruta de la herramienta del F10 activada)';
  } else if (sel.liveRoute && sel.liveRoute.length >= 2 && !same(sel.liveRoute, missionRoute) && !known.some((k) => same(sel.liveRoute, k))) {
    route = toRoute(sel.liveRoute.map((p, i) => ({ ...p, idx: i, name: (missionRoute[i] || {}).name })), 'avión');
    routeSource = 'avión (en directo)';
  } else if (toolFirst) {
    route = fromTool();
    routeSource = 'herramienta de ruta del F10';
  } else if (dtcRoute) {
    route = fromDtc();
    routeSource = sel.dtc.origin === 'editor del juego' ? 'DTC del editor del juego' : `DTC ${sel.dtc.name || ''}`.trim();
  }

  const bases = airports(theatre);
  const baseById = (id) => bases.find((b) => b.id === id) || null;
  const nearestBase = (ll) => {
    if (!ll || ll.lat == null) return null;
    let best = null, bd = Infinity;
    for (const b of bases) {
      const d = Geo.distanceNm(ll, b);
      if (d < bd) { bd = d; best = b; }
    }
    return best && bd < 15 ? best : null;
  };
  const dep = missionRoute[0] ? (baseById(missionRoute[0].airdromeId) || nearestBase(missionRoute[0])) : null;
  const landWp = [...missionRoute].reverse().find((p) => p.type === 'Land' || p.type === 'LandingReFuAr');
  const arr = landWp ? (baseById(landWp.airdromeId) || nearestBase(landWp)) : dep;

  const { radios, groupFreq } = radiosFromUnit(unit, group);
  const bulls = mission.coalition && coalition && mission.coalition[coalition] && mission.coalition[coalition].bullseye;

  const model = {
    name: sel.missionName || '',
    theatre,
    projection: !!Geo.THEATRES[theatre],
    magvar: (Geo.THEATRES[theatre] || {}).magvar || 0,
    date: { y: date.Year, m: date.Month, d: date.Day },
    startTime: start,
    startTimeText: timeText(start),
    coalition: coalition || null,
    unit: unit ? {
      name: unit.name, type: unit.type, callsign: callsignOf(unit, group), onboard: unit.onboard_num, group: group.name,
      fuelKg: unit.payload && unit.payload.fuel != null ? Number(unit.payload.fuel) : null,
    } : null,
    groupSize: group ? list(group.units).length : 0,
    flight: group ? list(group.units).map((u) => {
      const p = u.AddPropAircraft || {};
      return {
        name: u.name, callsign: callsignOf(u, group), type: u.type, onboard: u.onboard_num,
        laser: p.LaserCode != null ? String(p.LaserCode) : null, stn: p.STN_L16 || null,
        player: u.skill === 'Client' || u.skill === 'Player', me: unit && u.name === unit.name,
      };
    }) : [],
    loadout: loadoutOf(unit),
    task: group ? group.task : null,
    route,
    radios,
    groupFreq: groupFreq ? { ...groupFreq, text: fmtFreq(groupFreq.freq, groupFreq.mod) } : null,
    support: coalition ? supportAssets(mission, coalition, theatre) : [],
    bullseye: bulls ? { x: bulls.x, y: bulls.y, ...pointLL(theatre, bulls.x, bulls.y) } : null,
    departure: dep,
    arrival: arr,
    // side: 'own' (de tu bando) o 'neutral'; las del enemigo no se envían.
    airfields: bases.map((b) => {
      const w = sel.warehouses && sel.warehouses.airports && sel.warehouses.airports[b.id];
      const c = w && w.coalition ? String(w.coalition).toLowerCase() : 'neutral';
      return { ...b, side: c === 'neutral' || !coalition ? 'neutral' : c === coalition ? 'own' : 'enemy' };
    }).filter((b) => !coalition || b.side !== 'enemy'),
    routeSource,
    routePref: pref,
    routeOptions: { dtc: !!dtcRoute, herramienta: !!toolRoute },
    missionRoute,
    players: listPlayerUnits(mission),
    dtc: null,
  };
  if (sel.dtc) {
    const d = geoDtc(sel.dtc, theatre, tosOf);
    d.review = DTC.review(d, model);
    model.dtc = d;
  }
  return model;
}

// Coordenadas del DTC para el mapa (y horas resueltas). Se envía todo menos el JSON original.
function geoDtc(dtc, theatre, tosOf) {
  const ll = (p) => ({ ...p, ...pointLL(theatre, p.x, p.y) });
  return {
    ...dtc,
    routes: dtc.routes.map((r) => ({ ...r, points: r.points.map((p) => ({ ...ll(p), tos: tosOf(p.tos) })) })),
    route: dtc.route.map((p) => ({ ...ll(p), tos: tosOf(p.tos) })),
    lines: dtc.lines.map((l) => ({ ...l, points: l.points.map(ll) })),
    caps: dtc.caps.map(ll),
    threats: dtc.threats.map(ll),
    jdam: dtc.jdam ? { ...dtc.jdam, stations: dtc.jdam.stations.map((s) => ({ ...s, targets: s.targets.map((t) => (t.x != null && t.y != null ? ll(t) : t)) })) } : null,
  };
}

// Puntos del DTC que hay que convertir con DCS en mapas sin proyección conocida.
function dtcGeoItems(d) {
  if (!d) return [];
  return [...d.route, ...d.routes.flatMap((r) => r.points), ...d.lines.flatMap((l) => l.points), ...d.caps, ...d.threats];
}

const { radiosFromDtc } = DTC;

module.exports = { buildMissionModel, listPlayerUnits, radiosFromDtc, dtcGeoItems, timeText, fmtFreq, eachGroup };
