// Paquete naval (.lfcvw): barco, eventos, escuadrones, airplan, Carrier Card, stacks y ladders, y los cálculos que
// usan el editor (Ajustes › Portaaviones) y la pestaña Portaaviones. Sin DOM, para poder probarlo.
//
// Nada viene fijado: el paquete nuevo está vacío y todo lo pone quien prepara la operación. Las horas son locales
// del barco (las de la misión de DCS); los combustibles del ladder van en miles de libras.

export const FORMAT = 'lf-cvw';
export const VERSION = 1;

let seq = 0;
export const newId = (p = 'x') => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;

const num = (x) => (x != null && x !== '' && Number.isFinite(Number(x)) ? Number(x) : null);
const str = (x) => (x == null ? '' : String(x));
const arr = (x) => (Array.isArray(x) ? x : []);

// ---------------------------------------------------------------- horas
// «HH:MM» → minutos del día (o null); y al revés (da la vuelta a la medianoche).
export function toMin(t) {
  const m = /^\s*(\d{1,2})[:.h](\d{2})\s*$/.exec(str(t));
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  return h < 48 && mi < 60 ? h * 60 + mi : null;
}
export function hhmm(min) {
  if (min == null || !Number.isFinite(min)) return '--:--';
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
export const durText = (min) => (min == null ? '—' : `${Math.floor(min / 60)}:${String(Math.round(min % 60)).padStart(2, '0')}`);

// ---------------------------------------------------------------- paquete
export function emptyPackage() {
  return {
    format: FORMAT, version: VERSION, name: '', rev: 1, updated: null,
    ship: { name: '', tacan: '', icls: '', link4: '', date: '', tz: '', variation: '', sun: '' },
    cycle: { first: '', duration: '', launchMin: 15, recoveryMin: 15 },
    events: [],
    squadrons: [],
    airplan: {},
    notes: '',
    card: { radios: [], drr: [], deps: '', hawkDay: '', hawkNight: '', holding: [] },
    stack: { perLevel: 8, full: 'subes al siguiente' },
    marshal: { alt0: 6000, dme0: 21, altStep: 1000, dmeStep: 1, radialOffset: 180, push: 1 },
    ladders: [],
  };
}

// Paquete leído de un archivo o del almacén: completa lo que falte y descarta lo que no encaja (nunca lanza).
export function normalize(raw) {
  const base = emptyPackage();
  const p = raw && typeof raw === 'object' ? raw : {};
  const out = {
    ...base,
    name: str(p.name), rev: num(p.rev) || 1, updated: p.updated || null,
    ship: { ...base.ship, ...(p.ship || {}) },
    cycle: { ...base.cycle, ...(p.cycle || {}) },
    notes: str(p.notes),
    card: { ...base.card, ...(p.card || {}) },
    stack: { ...base.stack, ...(p.stack || {}) },
    marshal: { ...base.marshal, ...(p.marshal || {}) },
  };
  out.events = arr(p.events).map((e) => ({ id: str(e.id) || newId('e'), name: str(e.name), time: str(e.time) }));
  out.squadrons = arr(p.squadrons).map((s) => ({
    id: str(s.id) || newId('s'), name: str(s.name), unit: str(s.unit), aircraft: str(s.aircraft), modex: str(s.modex), drr: num(s.drr),
  }));
  out.airplan = {};
  for (const [sq, evs] of Object.entries(p.airplan && typeof p.airplan === 'object' ? p.airplan : {})) {
    out.airplan[sq] = {};
    for (const [ev, list] of Object.entries(evs || {})) {
      out.airplan[sq][ev] = arr(list).map((f) => ({
        code: str(f.code), msn: str(f.msn), n: num(f.n), call: str(f.call), ch: num(f.ch), notes: str(f.notes), air: !!f.air,
      }));
    }
  }
  out.card.radios = arr(out.card.radios).map((r, i) => ({ ch: num(r.ch) != null ? num(r.ch) : i + 1, name: str(r.name) }));
  out.card.drr = arr(out.card.drr).map((d) => ({ offset: num(d.offset), who: str(d.who) }));
  out.card.holding = arr(out.card.holding).map((x) => ({ alt: num(x.alt), sq: x.sq ? str(x.sq) : null, text: str(x.text) }));
  out.ladders = arr(p.ladders).map((l) => {
    const columns = arr(l.columns).map(str);
    const fit = (vals) => columns.map((_, i) => num(arr(vals)[i]));
    return {
      id: str(l.id) || newId('l'), aircraft: str(l.aircraft), label: str(l.label), min: str(l.min), ff: num(l.ff), aoa: str(l.aoa),
      tt: { day: num((l.tt || {}).day), night: num((l.tt || {}).night) },
      pattern: { c1: num((l.pattern || {}).c1), c3: num((l.pattern || {}).c3) },
      columns,
      rows: arr(l.rows).map((r) => ({ label: str(r.label), offset: r.offset == null || r.offset === '' ? null : num(r.offset), values: fit(r.values) })),
      fuel: arr(l.fuel).map((f) => ({ label: str(f.label), qty: num(f.qty) })),
    };
  });
  return out;
}

// Archivo que se exporta (y que se reconoce al importar).
export function toFile(pkg) {
  return JSON.stringify({ ...normalize(pkg), format: FORMAT, version: VERSION, updated: new Date().toISOString() }, null, 1);
}
export function fromFile(text) {
  let raw;
  try { raw = JSON.parse(text); } catch { throw new Error('No es un paquete naval: el archivo no se puede leer.'); }
  if (!raw || raw.format !== FORMAT) throw new Error('No es un paquete naval de LF Kneeboard (.lfcvw).');
  if ((num(raw.version) || 1) > VERSION) throw new Error('El paquete es de una versión más nueva del kneeboard: actualízalo.');
  return normalize(raw);
}

// ---------------------------------------------------------------- eventos y ciclo
// Rellena las horas de todos los eventos a partir del primero y una duración de ciclo (luego se retocan una a una).
export function fillTimes(pkg, first, durationMin) {
  const t0 = toMin(first);
  const d = num(durationMin);
  if (t0 == null || !d) return pkg;
  pkg.events.forEach((e, i) => { e.time = hhmm(t0 + i * d); });
  return pkg;
}

// Hora del evento i en minutos crecientes (cuenta las medianoches: una hora menor que la anterior es del día siguiente).
export function eventMinutes(pkg) {
  const out = [];
  let prev = null, day = 0;
  for (const e of pkg.events) {
    const m = toMin(e.time);
    if (m == null) { out.push(null); continue; }
    if (prev != null && m + day < prev) day += 1440;
    out.push(m + day);
    prev = m + day;
  }
  return out;
}

// Ventanas del evento i: launch antes de su hora; recovery después (con los aviones del evento anterior).
// cycle: lo que dura hasta el siguiente evento (cada ciclo puede durar distinto).
export function eventInfo(pkg, i) {
  const mins = eventMinutes(pkg);
  const t = mins[i];
  const e = pkg.events[i];
  if (!e) return null;
  const L = num(pkg.cycle.launchMin) || 0, R = num(pkg.cycle.recoveryMin) || 0;
  return {
    id: e.id, name: e.name, time: t,
    launch: t != null ? [t - L, t] : null,
    recovery: t != null && i > 0 ? [t, t + R] : null,
    recovers: i > 0 ? pkg.events[i - 1].name : null,
    cycle: t != null && mins[i + 1] != null ? mins[i + 1] - t : null,
  };
}

// Tu recovery si despegas en el evento i: el del evento siguiente.
export function recoveryFor(pkg, i) {
  const next = eventInfo(pkg, i + 1);
  return next && next.recovery ? { event: next.name, index: i + 1, window: next.recovery } : null;
}

// ---------------------------------------------------------------- airplan
export const flightsOf = (pkg, sqId, evId) => arr(((pkg.airplan || {})[sqId] || {})[evId]);

// Eventos en los que despega el escuadrón (con algún vuelo que no sea «en el aire»); si no tiene ninguno, todos.
export function squadronEvents(pkg, sqId) {
  const idx = pkg.events.map((e, i) => (flightsOf(pkg, sqId, e.id).some((f) => !f.air) ? i : -1)).filter((i) => i >= 0);
  return idx.length ? idx : pkg.events.map((_, i) => i);
}

// ---------------------------------------------------------------- Carrier Card
export const channel = (pkg, ch) => arr(pkg.card.radios).find((r) => r.ch === num(ch)) || null;

// Alturas de espera (miles de ft) del escuadrón, de menor a mayor: la primera es su nivel; las demás, si está lleno.
export function stackLevels(pkg, sqId) {
  return arr(pkg.card.holding).filter((x) => x.sq === sqId && x.alt != null).map((x) => x.alt).sort((a, b) => a - b);
}

// Radial de salida: BRC + offset del escuadrón (null si falta alguno).
export function drrRadial(brc, offset) {
  const b = num(brc), o = num(offset);
  if (b == null || o == null) return null;
  return ((Math.round(b + o) % 360) + 360) % 360 || 360;
}

// Marshal de Case III para tu puesto (1, 2, 3...): altitud, distancia, radial y hora de Push.
export function marshal(pkg, slot, recoveryStart = null, brc = null) {
  const M = pkg.marshal || {};
  const n = Math.max(1, Math.round(num(slot) || 1)) - 1;
  const r = num(brc);
  return {
    altFt: (num(M.alt0) || 0) + n * (num(M.altStep) || 0),
    dme: (num(M.dme0) || 0) + n * (num(M.dmeStep) || 0),
    radial: r != null ? ((Math.round(r + (num(M.radialOffset) || 0)) % 360) + 360) % 360 || 360 : null,
    push: recoveryStart != null ? recoveryStart + n * (num(M.push) || 0) : null,
  };
}

// ---------------------------------------------------------------- ladders
export const ladderFor = (pkg, aircraft) => arr(pkg.ladders).find((l) => l.aircraft && l.aircraft === aircraft) || null;

// Rellena las filas desde «On the Ball» sumando el FF de cada tramo hacia atrás (recovery, −15′, −30′...).
export function fillLadder(ladder, steps = 7, everyMin = 15) {
  const ball = ladder.rows.find((r) => r.offset == null) || { label: 'On the Ball', offset: null, values: ladder.columns.map(() => null) };
  const ff = num(ladder.ff);
  const rows = [ball];
  for (let k = 0; k < steps; k++) {
    const off = k * everyMin;
    rows.push({
      label: off ? `Recovery −${off}′` : 'Recovery', offset: off,
      values: ball.values.map((v) => (num(v) != null && ff != null ? Math.round((num(v) + (k + 1) * ff) * 10) / 10 : null)),
    });
  }
  ladder.rows = rows;
  return ladder;
}

// Ladder con horas reales para tu recovery: [{ label, time, value, ball }] (time = null en On the Ball).
export function ladderTimes(ladder, col, recoveryStart) {
  return arr(ladder && ladder.rows).map((r) => ({
    label: r.label, ball: r.offset == null, value: num(r.values[col]),
    time: r.offset != null && recoveryStart != null ? recoveryStart - r.offset : null,
  }));
}

// Fila que toca ahora (la de hora más tardía que ya ha llegado, contando hacia el recovery), o -1.
export function nowRow(rows, nowMin) {
  if (nowMin == null) return -1;
  // La fila cuya hora es la más reciente de las que ya han pasado (mirando hasta 12 h atrás, por la medianoche).
  // Antes de la más temprana no toca ninguna; después del recovery, la de recovery.
  let best = -1, bestD = Infinity;
  rows.forEach((r, i) => {
    if (r.time == null) return;
    const d = (((nowMin - r.time) % 1440) + 1440) % 1440;
    if (d < 720 && d < bestD) { best = i; bestD = d; }
  });
  return best;
}

export function fuelTotals(ladder) {
  let acc = 0;
  return arr(ladder && ladder.fuel).map((f) => { acc += num(f.qty) || 0; return { ...f, total: Math.round(acc * 10) / 10 }; });
}
