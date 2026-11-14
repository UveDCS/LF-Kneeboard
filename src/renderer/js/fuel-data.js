// Planificador de combustible: consumos de fábrica por avión y el cálculo (sin DOM, para poder probarlo).
// Un simulador de combate no sigue una ruta cerrada: hay una ida por tramos (cada uno con su distancia y su altitud),
// una ventana de combate a consumo alto entre dos puntos de la ruta, una vuelta por tramos y la reserva. Con tanquero,
// el cálculo se parte en dos: hasta el tanquero y después de repostar.
//
// Consumos ORIENTATIVOS (configuración limpia): sirven de punto de partida y cada piloto los ajusta a su forma de volar
// desde la pestaña. Lo que edita se guarda por avión en config.plan.fuel[tipo].
//
// Unidades: por dentro todo va en LIBRAS. Cada avión se muestra en su unidad de cabina (lb, kg o litros); la conversión
// se hace solo al enseñar y al guardar. Litros con 0,8 kg/l (combustible de reactor).

export const KG_PER_LB = 1 / 2.20462;
export const KG_PER_L = 0.8;
export const UNITS = {
  lb: { key: 'lb', label: 'lb', name: 'Libras', perLb: 1 },
  kg: { key: 'kg', label: 'kg', name: 'Kilos', perLb: KG_PER_LB },
  l: { key: 'l', label: 'l', name: 'Litros', perLb: KG_PER_LB / KG_PER_L },
};
// Cantidad en libras → en la unidad, y al revés.
export const toUnit = (lbs, unit) => lbs * (UNITS[unit] || UNITS.lb).perLb;
export const fromUnit = (x, unit) => x / (UNITS[unit] || UNITS.lb).perLb;

// fuel: el campo es combustible (cambia con la unidad); step: paso de los botones − y + en lb / kg / l.
export const FIELDS = [
  { key: 'arranque', label: 'Arranque, rodaje y despegue', fuel: '', step: { lb: 50, kg: 20, l: 25 }, help: 'Hasta llegar a la altitud de crucero.' },
  { key: 'crucero', label: 'Crucero alto', fuel: '/min', step: { lb: 5, kg: 2, l: 2 }, help: 'Consumo a la altitud de crucero.' },
  { key: 'velocidad', label: 'Velocidad en crucero alto', unit: 'kt', step: 10, help: 'Velocidad verdadera.' },
  { key: 'altCrucero', label: 'Altitud de crucero alto', unit: 'ft', step: 1000, help: 'A esta altitud o más se usa el crucero alto.' },
  { key: 'bajo', label: 'Crucero a baja cota', fuel: '/min', step: { lb: 5, kg: 2, l: 2 }, help: 'Cerca del suelo. Entre medias se interpola.' },
  { key: 'velBajo', label: 'Velocidad a baja cota', unit: 'kt', step: 10, help: 'Velocidad verdadera cerca del suelo.' },
  { key: 'combate', label: 'Combate', fuel: '/min', step: { lb: 10, kg: 5, l: 5 }, help: 'Media en la zona: MIL y postquemador.' },
  { key: 'reserva', label: 'Reserva al aterrizar', fuel: '', step: { lb: 100, kg: 50, l: 50 }, help: 'Lo que quieres tener en tierra.' },
];

// arranque, crucero alto (por min, kt, ft), baja cota (por min, kt), combate, reserva — en lb.
const D = (arranque, crucero, velocidad, altCrucero, bajo, velBajo, combate, reserva) =>
  ({ arranque, crucero, velocidad, altCrucero, bajo, velBajo, combate, reserva });
// Lo mismo escrito en kg o en litros (se guarda en lb).
const DU = (unit) => (arranque, crucero, velocidad, altCrucero, bajo, velBajo, combate, reserva) => {
  const f = (x) => fromUnit(x, unit);
  return D(f(arranque), f(crucero), velocidad, altCrucero, f(bajo), velBajo, f(combate), f(reserva));
};
const KG = DU('kg');
const L = DU('l');

export const DEFAULTS = {
  'F-16C_50': D(700, 60, 450, 25000, 110, 420, 300, 1500),
  'FA-18C_hornet': D(1000, 90, 420, 25000, 160, 400, 400, 2000),
  'F-14B': D(1500, 110, 450, 25000, 200, 420, 550, 2500),
  'F-14A-135-GR': D(1500, 130, 450, 25000, 230, 420, 600, 2500),
  'F-15ESE': D(1200, 110, 450, 25000, 200, 420, 550, 2500),
  'F-4E-45MC': D(1200, 120, 450, 25000, 220, 420, 600, 2000),
  'F-5E-3': D(400, 35, 420, 25000, 65, 400, 180, 800),
  'F-100D': D(600, 90, 450, 30000, 160, 420, 350, 1200),
  'A-10C_2': D(400, 40, 300, 15000, 55, 280, 70, 1200),
  'AV8BNA': D(600, 60, 420, 20000, 110, 400, 180, 1000),
  'C-130J-30': D(1000, 85, 320, 22000, 110, 260, 110, 4000),
  // En kilos (cabina en kg)
  'M-2000C': KG(270, 32, 450, 30000, 60, 420, 160, 600),
  'Mirage-F1EE': KG(250, 40, 450, 30000, 70, 420, 200, 500),
  'JF-17': KG(200, 30, 450, 30000, 55, 420, 150, 400),
  'MiG-29A': KG(300, 35, 470, 26000, 60, 430, 180, 600),
  'Su-27': KG(400, 45, 470, 30000, 80, 430, 250, 1000),
  'Su-25T': KG(200, 30, 380, 16000, 40, 350, 60, 500),
  // En litros (cabina en litros)
  'MiG-21Bis': L(250, 42, 460, 30000, 70, 430, 200, 500),
};

// Unidad de cabina por avión (los que no salen aquí, en libras).
const UNIT_OF = {
  'M-2000C': 'kg', 'Mirage-F1EE': 'kg', 'Mirage-F1CE': 'kg', 'Mirage-F1BE': 'kg', 'Mirage-F1M-EE': 'kg', 'Mirage-F1M-CE': 'kg',
  'JF-17': 'kg', 'MiG-29A': 'kg', 'MiG-29S': 'kg', 'MiG-29G': 'kg', 'Su-27': 'kg', 'Su-33': 'kg', 'J-11A': 'kg',
  'Su-25': 'kg', 'Su-25T': 'kg', 'Su-25TM': 'kg', 'Ka-50': 'kg', 'Ka-50_3': 'kg', 'Mi-8MT': 'kg', 'Mi-24P': 'kg',
  'MiG-21Bis': 'l',
};

// Variantes que comparten datos.
const ALIAS = {
  'A-10C': 'A-10C_2',
  'A-10A': 'A-10C_2',
  'F-14BU': 'F-14B',
  'F-14A-135-GR-Early': 'F-14A-135-GR',
  'F-14A-95-GR': 'F-14A-135-GR',
  'Mirage-F1CE': 'Mirage-F1EE',
  'Mirage-F1BE': 'Mirage-F1EE',
  'Mirage-F1M-EE': 'Mirage-F1EE',
  'Mirage-F1M-CE': 'Mirage-F1EE',
  'MiG-29S': 'MiG-29A',
  'MiG-29G': 'MiG-29A',
  'Su-33': 'Su-27',
  'J-11A': 'Su-27',
  'Su-25': 'Su-25T',
  'Su-25TM': 'Su-25T',
};

export function defaultsFor(type) {
  const t = String(type || '');
  return DEFAULTS[t] || DEFAULTS[ALIAS[t]] || null;
}

const num = (x) => (x != null && x !== '' && Number.isFinite(Number(x)) ? Number(x) : null);
const pos = (x) => (num(x) != null && num(x) > 0 ? num(x) : 0);

// Unidad de un avión: la que haya elegido el piloto o la de su cabina.
export function defaultUnit(type) {
  return UNIT_OF[String(type || '')] || 'lb';
}
export function unitFor(type, saved = {}) {
  const u = saved && saved[type] && saved[type].unit;
  return UNITS[u] ? u : defaultUnit(type);
}

// Valores en uso (en lb): los del piloto (si los ha cambiado) o los de fábrica. edited: qué campos son suyos.
export function valuesFor(type, saved = {}) {
  const def = defaultsFor(type) || {};
  const mine = (saved && saved[type]) || {};
  const values = {};
  const edited = {};
  for (const { key } of FIELDS) {
    if (num(mine[key]) != null) { values[key] = num(mine[key]); edited[key] = true; } else values[key] = def[key] != null ? def[key] : null;
  }
  return { values, edited, known: !!defaultsFor(type) };
}

// Consumo y velocidad a una altitud: baja cota en el suelo, crucero alto a su altitud o más; entre medias, en línea.
export function cruiseAt(v, altFt) {
  const hiF = pos(v.crucero), hiV = pos(v.velocidad);
  const loF = pos(v.bajo) || hiF, loV = pos(v.velBajo) || hiV;
  const top = pos(v.altCrucero);
  const k = top ? Math.min(1, Math.max(0, pos(altFt) / top)) : 1;
  return { ff: loF + (hiF - loF) * k, tas: loV + (hiV - loV) * k };
}

export function legFuel(v, distNm, altFt) {
  const { ff, tas } = cruiseAt(v, altFt);
  const min = pos(distNm) && tas ? pos(distNm) / tas * 60 : 0;
  return { min, fuel: min * ff };
}

const M2FT = 3.28084;
const ptName = (p, i) => `WP${p && p.idx != null ? p.idx : i}${p && p.name ? ` ${p.name}` : ''}`;

// Punto más lejano desde la salida (por defecto, donde empieza el combate).
export function farthestIndex(points, distanceNm) {
  let best = -1, max = -1;
  for (let i = 1; i < points.length; i++) {
    const d = distanceNm(points[0], points[i]);
    if (d > max) { max = d; best = i; }
  }
  return best;
}
// Compatibilidad: distancia al punto más lejano.
export function zoneFromRoute(route, distanceNm) {
  const pts = (route || []).filter((w) => w && w.lat != null && w.lon != null);
  if (pts.length < 2) return null;
  const i = farthestIndex(pts, distanceNm);
  return i > 0 ? distanceNm(pts[0], pts[i]) : null;
}

// Plan completo.
//   values: consumos del avión; route: puntos de la misión; distanceNm(a, b); loadLb: lo que llevas (o null)
//   sortie: { windowMin, entry, exit, legs: { [clave]: { dist, alt } }, zoneNm, tanker: { src, callsign, wp, refuelTo } }
//   tankers: tanqueros de la misión ({ callsign, type, lat, lon })
export function planSortie({ values: v, route, distanceNm, loadLb = null, sortie = {}, tankers = [] }) {
  const pts = (route || []).filter((w) => w && w.lat != null && w.lon != null);
  const hasRoute = pts.length >= 2;
  const windowMin = num(sortie.windowMin) != null ? pos(sortie.windowMin) : 20;
  const legsCfg = sortie.legs || {};
  const defAlt = pos(v.altCrucero) || 20000;
  const load = num(loadLb);

  let entry = null, exit = null;
  let legs = [];
  if (hasRoute) {
    const last = pts.length - 1;
    const far = farthestIndex(pts, distanceNm);
    entry = Math.min(last, Math.max(1, num(sortie.entry) != null ? num(sortie.entry) : far));
    exit = Math.min(last, Math.max(entry, num(sortie.exit) != null ? num(sortie.exit) : entry));
    for (let i = 0; i < last; i++) {
      const a = pts[i], b = pts[i + 1];
      const section = i + 1 <= entry ? 'ida' : i >= exit ? 'vuelta' : 'zona';
      const routeDist = distanceNm(a, b);
      // Altitud del tramo: la del punto al que vas. El último es el aterrizaje (altitud del aeródromo): ahí se vuelve
      // en crucero a la del punto anterior y se baja al final.
      const ref = i + 1 === last ? a : b;
      const routeAlt = ref.alt != null ? Math.round(ref.alt * M2FT / 100) * 100 : null;
      const c = legsCfg[i] || {};
      legs.push({
        key: String(i), section, from: ptName(a, i), to: ptName(b, i + 1), toIndex: i + 1,
        routeDist, dist: num(c.dist) != null ? pos(c.dist) : routeDist, distEdited: num(c.dist) != null,
        routeAlt, alt: num(c.alt) != null ? pos(c.alt) : routeAlt != null && routeAlt > 0 ? routeAlt : defAlt, altEdited: num(c.alt) != null,
        a, b,
      });
    }
  } else {
    // Sin ruta: un tramo de ida y otro de vuelta, a mano.
    const zone = pos(sortie.zoneNm);
    for (const [key, section, from, to] of [['ida', 'ida', 'Base', 'Zona'], ['vuelta', 'vuelta', 'Zona', 'Base']]) {
      const c = legsCfg[key] || {};
      legs.push({
        key, section, from, to, routeDist: zone, dist: num(c.dist) != null ? pos(c.dist) : zone, distEdited: num(c.dist) != null,
        routeAlt: null, alt: num(c.alt) != null ? pos(c.alt) : defAlt, altEdited: num(c.alt) != null,
      });
    }
  }

  for (const l of legs) l.baseDist = l.dist; // la del tramo, sin el desvío al tanquero

  // Tanquero (solo si vas a pasar por él: use !== false): de la misión o en unas coordenadas (se mete en el tramo donde
  // menos te desvías), o en un punto de la ruta.
  const tk = sortie.tanker && sortie.tanker.use !== false ? sortie.tanker : {};
  let tanker = null;
  if (hasRoute && (tk.src === 'map' || tk.src === 'coords')) {
    const c = tk.coords || {};
    const t = tk.src === 'map'
      ? tankers.find((x) => x.callsign === tk.callsign && x.lat != null)
      : (num(c.lat) != null && num(c.lon) != null ? { callsign: 'Coordenadas', lat: num(c.lat), lon: num(c.lon) } : null);
    if (t) {
      let best = null;
      legs.forEach((l, i) => {
        if (l.section === 'zona') return;
        const d1 = distanceNm(l.a, t), d2 = distanceNm(t, l.b);
        const extra = d1 + d2 - l.routeDist;
        if (!best || extra < best.extra) best = { i, d1, d2, extra };
      });
      if (best) {
        const l = legs[best.i];
        // El tramo pasa por el tanquero: lo que hay hasta él y lo que queda, a la altitud del tramo.
        const k = l.routeDist ? l.dist / l.routeDist : 1;
        l.tankerSplit = { before: best.d1 * k, after: best.d2 * k };
        l.dist = (best.d1 + best.d2) * k;
        tanker = { src: tk.src, callsign: t.callsign, type: t.type, leg: best.i, detour: best.extra * k, section: l.section, where: `entre ${l.from} y ${l.to}` };
      }
    }
  } else if (tk.src === 'manual') {
    const valid = (k) => (hasRoute ? k >= 1 && k <= pts.length - 1 && (k <= entry || k >= exit) : false);
    let wp = num(tk.wp);
    if (wp == null || !valid(wp)) wp = hasRoute ? Math.max(1, entry - 1) : null;
    if (wp != null && valid(wp)) {
      const leg = legs.findIndex((l) => l.toIndex === wp);
      tanker = { src: 'manual', wp, leg, section: wp <= entry ? 'ida' : 'vuelta', where: `en ${ptName(pts[wp], wp)}` };
    }
  }

  // Combustible de cada tramo.
  for (const l of legs) {
    const r = legFuel(v, l.dist, l.alt);
    l.min = r.min;
    l.fuel = l.section === 'zona' ? 0 : r.fuel; // dentro de la zona manda la ventana de combate
  }
  const arranque = pos(v.arranque);
  const reserva = pos(v.reserva);
  const combate = windowMin * pos(v.combate);
  const ida = legs.filter((l) => l.section === 'ida').reduce((s, l) => s + l.fuel, 0);
  const vuelta = legs.filter((l) => l.section === 'vuelta').reduce((s, l) => s + l.fuel, 0);
  const total = arranque + ida + combate + vuelta + reserva;
  const maxWin = (fuelForWindow) => (pos(v.combate) ? Math.max(0, fuelForWindow / pos(v.combate)) : null);
  const out = {
    hasRoute, entry, exit, windowMin, legs, points: pts,
    parts: { arranque, ida, combate, vuelta, reserva },
    total,
    margin: load != null ? load - total : null,
    maxWindow: load != null ? maxWin(load - (total - combate)) : null,
    tanker: null,
  };

  if (tanker) {
    // Lo que se gasta hasta el tanquero (A) y desde él (B).
    let A = arranque, B = 0, seenTanker = false;
    legs.forEach((l, i) => {
      if (l.section === 'zona') {
        if (i === tanker.leg) seenTanker = true; // tanquero en el punto donde acaba el combate
        return;
      }
      if (i === tanker.leg && l.tankerSplit) {
        const r1 = legFuel(v, l.tankerSplit.before, l.alt).fuel;
        A += r1;
        B += l.fuel - r1;
        seenTanker = true;
        return;
      }
      if (seenTanker) B += l.fuel; else A += l.fuel;
      if (i === tanker.leg && !l.tankerSplit) seenTanker = true; // a mano: el tanquero está al final de este tramo
    });
    const combatAfter = tanker.section === 'ida';
    if (combatAfter) B += combate; else A += combate;
    const refuelTo = num(tk.refuelTo) != null ? pos(tk.refuelTo) : load;
    const atTankerMin = reserva; // llegar al tanquero con la reserva, por si no se puede repostar
    out.tanker = {
      ...tanker,
      before: A,
      after: B,
      needTakeoff: A + atTankerMin,
      arriveWith: load != null ? load - A : null,
      refuelTo,
      needAfter: B + reserva,
      marginAfter: refuelTo != null ? refuelTo - (B + reserva) : null,
      maxWindow: combatAfter
        ? (refuelTo != null ? maxWin(refuelTo - (B - combate) - reserva) : null)
        : (load != null ? maxWin(load - (A - combate) - atTankerMin) : null),
    };
  }
  return out;
}

// Compatibilidad con la versión sin tramos (un tránsito de ida y vuelta a la misma distancia).
export function fuelPlan({ values, zoneNm, windowMin, loadLb = null }) {
  const r = planSortie({ values, route: null, loadLb, sortie: { windowMin, zoneNm } });
  const transitMin = r.legs.reduce((s, l) => s + l.min, 0);
  return { transitMin, parts: { arranque: r.parts.arranque, transito: r.parts.ida + r.parts.vuelta, combate: r.parts.combate, reserva: r.parts.reserva }, total: r.total, margin: r.margin, maxWindow: r.maxWindow };
}
