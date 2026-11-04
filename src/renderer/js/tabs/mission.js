// Páginas dinámicas generadas con la misión: plan de vuelo, radios, apoyo y tiempos.
import { icon } from '../icons.js';
import { h, clear, emptyState, hms, dur, deg, nm, ft, freq } from '../util.js';

const KT = 1.943844;
const LB = 2.20462;

function noMission(icon, title) {
  return emptyState(icon, title, 'Abre una misión en DCS (con el hook instalado) o carga un .miz en Ajustes > Misión.');
}

// Origen elegido a mano (ruta o radios): botones pequeños, que también se ven y se pulsan en VR (un desplegable
// de Windows no saldría en el visor). Se guarda en sources.<clave> y main.js recalcula la misión.
function sourcePicker(ctx, key, label, options, current, note) {
  const set = (v) => {
    ctx.S.config.sources = { ...(ctx.S.config.sources || {}), [key]: v };
    ctx.kb.patchConfig({ sources: { [key]: v } });
  };
  return h('div.src-pick', { title: note || '' },
    h('span.src-label', label),
    options.map(([v, text, ok = true]) => h('button.chip', {
      className: `chip${v === current ? ' sel' : ''}${ok ? '' : ' off'}`,
      title: ok ? '' : 'Ahora no hay de esta fuente: se usaría la de la misión',
      onclick: () => set(v),
    }, text)),
    note ? h('span.src-note', note) : null);
}

function throttle(fn, ms) {
  let last = 0, t = null;
  return (...a) => {
    const now = Date.now();
    if (now - last >= ms) { last = now; fn(...a); }
    else if (!t) t = setTimeout(() => { t = null; last = Date.now(); fn(...a); }, ms - (now - last));
  };
}

function baseLine(b) {
  if (!b) return null;
  const rw = (b.runways || []).map((r) => r.name).join(' · ');
  return h('div.kv',
    h('span', 'Aeródromo'), h('span', b.name),
    h('span', 'Torre'), h('span', [b.vhf ? `${freq(b.vhf)} VHF` : null, b.uhf ? `${freq(b.uhf)} UHF` : null].filter(Boolean).join('  ·  ') || '—'),
    b.tacan ? h('span', 'TACAN') : null, b.tacan ? h('span', b.tacan) : null,
    rw ? h('span', 'Pistas') : null, rw ? h('span', rw) : null,
  );
}

// Calcula tramos, tiempos y combustible a partir de la ruta.
export function computeLegs(m, ctx) {
  const Geo = ctx.Geo;
  const mv = ctx.magvar();
  const type = (m.unit && m.unit.type) || '';
  const plan = ctx.S.config.plan || {};
  const flow = Number((plan.fuelFlow || {})[type]) || 0; // lb/min
  let fuel = m.unit && m.unit.fuelKg != null ? m.unit.fuelKg * LB : null;
  let t = m.startTime || 0;
  return m.route.map((w, i) => {
    const prev = m.route[i - 1];
    let dist = null, crs = null, legSec = null;
    if (prev && prev.lat != null && w.lat != null) {
      dist = Geo.distanceNm(prev, w);
      crs = Geo.norm360(Geo.bearingDeg(prev, w) - mv);
      const spd = (w.speed || prev.speed || 0) * KT;
      if (spd > 30) legSec = dist / spd * 3600;
    }
    // Hora del punto: la del DTC (hora sobre el punto), la de la misión o la calculada con la velocidad.
    if (w.tos != null) t = w.tos;
    else if (w.eta > 0) t = (m.startTime || 0) + w.eta;
    else if (legSec != null) t += legSec;
    if (fuel != null && flow && legSec != null) fuel -= flow * legSec / 60;
    const names = (ctx.S.wpNames || {})[m.name || m.file || ''] || {};
    return { ...w, name: names[w.idx] || w.name, dist, crs, legSec, etaTod: i === 0 && w.tos == null ? m.startTime : t, fuelLb: flow ? fuel : null };
  });
}

// Nombre de un waypoint: el que le hayas puesto tú (se guarda por misión) o el de la ruta.
export function wpName(ctx, m, w) {
  const names = (ctx.S.wpNames || {})[m.name || m.file || ''] || {};
  return names[w.idx] || w.name || '';
}

// Secuencia por número: el objetivo es un WP concreto y solo avanza al llegar a él (menos de 1 nm)
// o al rebasarlo. Si el avión informa de su steerpoint activo (gotoIdx), manda ese.
export function advanceSeq(route, seq, live, Geo) {
  if (!live || live.lat == null || !route.length) return seq;
  if (live.gotoIdx != null && route[live.gotoIdx]) return live.gotoIdx;
  let i = seq == null || !route[seq] ? Math.min(1, route.length - 1) : seq;
  for (let guard = 0; guard < route.length; guard++) {
    const w = route[i], prev = route[i - 1];
    if (!w || w.lat == null || i >= route.length - 1) break;
    const d = Geo.distanceNm(live, w);
    let passed = d < 1.0;
    const kx = Math.cos(live.lat * Math.PI / 180);
    const P = { x: live.lon * kx, y: live.lat };
    // Proyección sobre un tramo: u (0 = inicio, 1 = final) y distancia a su línea en nm.
    const onLeg = (a, b) => {
      const A = { x: a.lon * kx, y: a.lat }, B = { x: b.lon * kx, y: b.lat };
      const dx = B.x - A.x, dy = B.y - A.y;
      const L = dx * dx + dy * dy || 1e-12;
      const u = ((P.x - A.x) * dx + (P.y - A.y) * dy) / L;
      const cross = Math.hypot(P.x - (A.x + u * dx), P.y - (A.y + u * dy)) * 60;
      return { u, cross };
    };
    // Rebasado: ya pasado el WP en su tramo (cerca de él) …
    if (!passed && prev && prev.lat != null) passed = onLeg(prev, w).u > 1 && d < 5;
    // … o ya volando el tramo siguiente (también si has cortado la esquina).
    const nx = route[i + 1];
    if (!passed && nx && nx.lat != null) {
      const q = onLeg(w, nx);
      passed = q.u > 0.05 && q.u <= 1 && q.cross < 3;
    }
    if (!passed) break;
    i++;
  }
  return i;
}

// Llegar a la hora: con hora fijada en el punto (DTC o misión), cuánto vas de pronto o de tarde
// y a qué velocidad sobre el suelo tienes que ir para llegar justo.
export function timing(w, live, d, Geo) {
  if (!w || !w.etaLocked || w.etaTod == null || !live || live.missionTime == null) return null;
  const left = w.etaTod - live.missionTime;
  const eta = live.gsKt > 40 ? live.missionTime + d / live.gsKt * 3600 : null;
  return { tot: w.etaTod, left, delta: eta != null ? eta - w.etaTod : null, needKt: left > 20 ? d / left * 3600 : null };
}

// ------------------------------------------------------------------ plan de vuelo
const ROWS = 12;
export const flightplan = {
  icon: 'route',
  label: 'Plan de vuelo',
  create(ctx, tab) {
    const el = h('div');
    let page = 0;
    let legs = [];
    let pinned = null; // elegido a mano (tocando una fila o con las acciones Waypoint siguiente/anterior)
    let seq = null;    // secuencia automática por número
    let routeKey = null;
    let editing = null;

    function syncRoute(m) {
      const k = `${m.name}|${m.routeSource}|${m.route.length}`;
      if (k !== routeKey) { routeKey = k; pinned = null; seq = null; }
    }

    function sequence() {
      const m = ctx.S.mission;
      const live = ctx.S.live;
      if (!m || !m.route.length) return;
      syncRoute(m);
      // En tierra, antes de salir, el objetivo es el primer punto tras la salida.
      if (live && live.lat != null && (live.aglM || 0) < 4 && (live.gsKt || 0) < 50 && seq == null) seq = Math.min(1, m.route.length - 1);
      seq = advanceSeq(m.route, seq, live, ctx.Geo);
    }

    function stepWp(d) {
      const m = ctx.S.mission;
      if (!m || !m.route.length) return;
      const cur = pinned != null ? pinned : seq != null ? seq : 1;
      pinned = Math.max(0, Math.min(m.route.length - 1, cur + d));
      render();
      ctx.toast(`Siguiente punto: WP${pinned}`);
    }

    function saveName(m, w, name) {
      const all = ctx.S.wpNames || (ctx.S.wpNames = {});
      const k = m.name || m.file || '';
      all[k] = all[k] || {};
      if (name.trim()) all[k][w.idx] = name.trim(); else delete all[k][w.idx];
      ctx.kb.storeSet('wpnames', all);
      ctx.namesChanged();
    }

    const render = () => {
      clear(el);
      const m = ctx.S.mission;
      if (!m || !m.route.length) return el.append(noMission(icon('route'), 'Plan de vuelo'));
      syncRoute(m);
      legs = computeLegs(m, ctx);
      const live = ctx.S.live;
      const next = pinned != null && legs[pinned] ? pinned : seq;
      const mv = ctx.magvar();

      el.append(h('div.h1', m.unit ? m.unit.callsign || m.unit.name : 'Ruta',
        h('small', `${m.unit ? m.unit.type : ''} · ${m.theatre} · inicio ${m.startTimeText}`)),
        sourcePicker(ctx, 'route', 'Ruta', [
          ['auto', 'Auto'], ['mision', 'Misión'],
          ['dtc', 'DTC', !!(m.routeOptions && m.routeOptions.dtc)],
          ['herramienta', 'F10', !!(m.routeOptions && m.routeOptions.herramienta)],
        ], m.routePref || 'auto', `Ahora: ${m.routeSource || 'misión'}`));
      if (page === 0) {
        el.append(h('div.grid2',
          h('div.card', h('div.label', 'Salida'), baseLine(m.departure) || h('div.muted', 'Sin aeródromo')),
          h('div.card', h('div.label', 'Llegada'), baseLine(m.arrival) || h('div.muted', 'Sin aeródromo'))));
      }

      const flying = live && live.lat != null;
      const w = next != null ? legs[next] : null;
      const mode = pinned != null ? 'elegido' : live && live.gotoIdx != null ? 'del avión' : 'por número';
      const card = h('div.card', { style: { borderColor: 'var(--accent)' } });
      card.append(h('div.card-row',
        h('span.label', 'Siguiente punto'),
        w ? h('span.tag', `WP${w.idx}`) : null, w ? h('b', wpName(ctx, m, w) || w.typeText) : null,
        w && w.tgt ? h('span.tag.tgt', 'objetivo') : null,
        h('span.bar-spacer'),
        h('button.btn.small', { title: 'Waypoint anterior', onclick: () => stepWp(-1) }, icon('prev')),
        h('button.btn.small', { title: 'Waypoint siguiente', onclick: () => stepWp(1) }, icon('next')),
        pinned != null ? h('button.btn.small', { onclick: () => { pinned = null; render(); } }, 'Automático') : h('span.tag', mode)));
      if (flying && w) {
        const d = ctx.Geo.distanceNm(live, w);
        const brg = ctx.Geo.norm360(ctx.Geo.bearingDeg(live, w) - mv);
        const ete = live.gsKt > 40 ? d / live.gsKt * 3600 : null;
        const eta = ete != null && live.missionTime != null ? live.missionTime + ete : null;
        const big = { fontSize: '1.7rem' };
        card.append(h('div.grid2', { style: { marginTop: '.4rem', gridTemplateColumns: 'repeat(4, 1fr)' } },
          h('div', h('div.label', 'Rumbo a volar'), h('div.big', { style: big }, deg(brg)), h('div.muted', { style: { fontSize: '.68rem' } }, 'magnético')),
          h('div', h('div.label', 'Distancia'), h('div.big', { style: big }, nm(d), h('small', ' nm'))),
          h('div', h('div.label', 'Tiempo'), h('div.big', { style: big }, ete != null ? dur(ete) : '—'), h('div.muted', { style: { fontSize: '.68rem' } }, 'a tu velocidad')),
          h('div', h('div.label', 'Llegas a las'), h('div.big', { style: big }, eta != null ? hms(eta, false) : '—'), h('div.muted', { style: { fontSize: '.68rem' } }, w.etaTod != null ? `plan ${hms(w.etaTod, false)}` : ''))));
        const tm = timing(w, live, d, ctx.Geo);
        if (tm) {
          const late = tm.delta != null && tm.delta > 5, early = tm.delta != null && tm.delta < -5;
          card.append(h('div.tot', { className: `tot${late ? ' late' : early ? ' early' : ' ontime'}` },
            h('span.label', 'Hora fijada'), h('b', hms(tm.tot, false)),
            h('span', tm.delta == null ? '' : late ? `llegas ${dur(tm.delta)} tarde` : early ? `llegas ${dur(-tm.delta)} pronto` : 'llegas a tiempo'),
            tm.needKt != null ? h('span', 'para llegar justo: ', h('b', `${Math.round(tm.needKt)} kt`), ' sobre el suelo') : h('span', tm.left <= 0 ? 'la hora ya ha pasado' : '')));
        }
      } else {
        card.append(h('div.muted', { style: { fontSize: '.85rem', marginTop: '.3rem' } },
          'En vuelo aquí verás el rumbo, la distancia, el tiempo y la hora de llegada desde tu avión hasta el siguiente punto.'));
      }
      card.append(h('div.muted', { style: { fontSize: '.72rem', marginTop: '.45rem', lineHeight: 1.4 } },
        pinned != null
          ? 'Lo has elegido tú. Las flechas cambian de punto (o las acciones «Waypoint siguiente / anterior» del HOTAS). «Automático» vuelve a la secuencia.'
          : 'Sigue los waypoints por número: cuando pasas a menos de 1 nm del punto, o lo rebasas, salta al siguiente. Si DCS informa del steerpoint activo de tu avión, se usa ese. Las flechas o tocar una fila eligen otro.'));
      el.append(card);

      const slice = legs.slice(page * ROWS, page * ROWS + ROWS);
      const anyFuel = legs.some((l) => l.fuelLb != null);
      el.append(h('table.tbl',
        h('thead', h('tr', h('th', 'WP'), h('th', 'Nombre'), h('th.num-r', 'Alt ft'), h('th.num-r', '°M'), h('th.num-r', 'NM'), h('th.num-r', 'Tramo'), h('th.num-r', 'ETA'), anyFuel ? h('th.num-r', 'Comb.') : null)),
        h('tbody', slice.map((l) => {
          const nameCell = h('td.txt');
          if (editing === l.idx) {
            const inp = h('input.f', { value: wpName(ctx, m, l), placeholder: l.typeText, style: { fontSize: '.8rem', padding: '.15rem .3rem' } });
            const done = () => { saveName(m, l, inp.value); editing = null; render(); };
            inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(); if (e.key === 'Escape') { editing = null; render(); } e.stopPropagation(); });
            inp.addEventListener('blur', done);
            inp.addEventListener('click', (e) => e.stopPropagation());
            nameCell.append(inp);
            setTimeout(() => inp.focus(), 0);
          } else {
            nameCell.append(wpName(ctx, m, l) || h('span.muted', l.typeText), ...(l.tgt ? [h('span.tag.tgt', 'obj')] : []), ' ',
              h('button.btn.small', { title: 'Cambiar el nombre', style: { padding: '0 .25rem', opacity: '.6' }, onclick: (e) => { e.stopPropagation(); editing = l.idx; render(); } }, icon('pen')));
          }
          return h('tr', {
            className: `wp-pick ${l.idx === next ? 'hl' : next != null && l.idx < next ? 'done' : ''} ${l.idx === pinned ? 'pinned' : ''}`,
            title: 'Tocar para usar este punto como siguiente',
            onclick: () => { pinned = pinned === l.idx ? null : l.idx; render(); },
          },
          h('td', l.idx),
          nameCell,
          h('td.num-r', l.altM != null ? `${ft(l.altM)}${l.altType === 'AGL' ? ' R' : ''}` : ''),
          h('td.num-r', l.crs != null ? deg(l.crs) : ''),
          h('td.num-r', l.dist != null ? nm(l.dist) : ''),
          h('td.num-r', l.legSec != null ? dur(l.legSec) : ''),
          h('td.num-r', l.etaLocked ? h('span.tag.fix', { title: 'Hora fijada' }, 'fija') : null, ' ', hms(l.etaTod, false)),
          anyFuel ? h('td.num-r', l.fuelLb != null ? Math.round(l.fuelLb).toLocaleString('es-ES') : '') : null);
        }))));
      const total = legs.reduce((s, l) => s + (l.dist || 0), 0);
      el.append(h('div.muted', { style: { fontSize: '.75rem', marginTop: '.5rem' } },
        `Total ${nm(total)} nm · rumbos magnéticos (declinación ${mv >= 0 ? '+' : ''}${mv}°)`,
        anyFuel ? '' : ' · indica el consumo en Ajustes > Misión para estimar el combustible'));
    };
    const liveRender = throttle(() => { if (editing == null) render(); }, 1000);
    return {
      el,
      pages: () => Math.max(1, Math.ceil(((ctx.S.mission && ctx.S.mission.route.length) || 0) / ROWS)),
      show(p) { page = p; render(); },
      title: () => 'Plan de vuelo',
      onMission: () => { sequence(); render(); },
      onConfig: render,
      onLive: () => {
        sequence();
        if (!el.classList.contains('hidden')) liveRender();
      },
      stepWp,
      // Punto al que vas ahora (lo usa el mapa para la línea hasta el siguiente punto).
      nextIdx: () => {
        const m = ctx.S.mission;
        if (!m || !m.route.length) return null;
        return pinned != null && m.route[pinned] ? pinned : seq;
      },
      shareData: () => {
        const m = ctx.S.mission;
        return m ? { kind: 'wpnames', label: 'Copiar los nombres de los puntos', payload: { mission: m.name || m.file || '', names: (ctx.S.wpNames || {})[m.name || m.file || ''] || {} } } : null;
      },
      applyShared(payload) {
        const all = ctx.S.wpNames || (ctx.S.wpNames = {});
        all[payload.mission] = { ...(all[payload.mission] || {}), ...payload.names };
        ctx.kb.storeSet('wpnames', all);
        ctx.namesChanged();
        render();
        ctx.toast('Nombres de los puntos copiados');
      },
    };
  },
};

// ------------------------------------------------------------------ radios
function freqKey(f) {
  const v = Number(f) > 10000 ? Number(f) / 1e6 : Number(f);
  return Number.isFinite(v) ? v.toFixed(3) : '';
}

function labelsFor(m) {
  const map = new Map();
  const add = (f, label) => { const k = freqKey(f); if (k && !map.has(k)) map.set(k, label); };
  if (m.groupFreq) add(m.groupFreq.freq, 'Intravuelo');
  for (const s of m.support) if (s.freq) add(parseFloat(s.freq), `${s.callsign} (${s.kind})`);
  for (const b of [m.departure, m.arrival]) if (b) { add(b.vhf, `${b.name} TWR`); add(b.uhf, `${b.name} TWR`); }
  return map;
}

export const radios = {
  icon: 'radio',
  label: 'Radios y frecuencias',
  create(ctx, tab) {
    const el = h('div');
    let page = 0;
    let editing = false;
    let edits = null; // { [avión]: { [radio]: { [canal]: { freq, name } } } }

    // Presets del DTC en uso (ver la pestaña DTC: el importado, el de la misión o el de DKS); si no hay, los de la misión.
    // Sin DTC, o con «Presets de la misión» elegido, los del .miz.
    // Origen de los presets: automático (los del DTC en uso y, de las radios que el DTC no trae o no carga,
    // los de la misión), solo la misión o solo el DTC. Se elige arriba y se guarda en sources.radios.
    async function presets(m) {
      const pref = (ctx.S.config.sources || {}).radios || 'auto';
      const mis = m.radios || [];
      const dtc = (m.dtc && m.dtc.radios) || [];
      if (pref === 'mision' || !dtc.length) return mis;
      if (pref === 'dtc') return dtc;
      const have = new Set(dtc.map((r) => r.name));
      return [...dtc, ...mis.filter((r) => !have.has(r.name))].sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }));
    }

    // Aplica tus cambios (hechos aquí, p. ej. si cambias un preset en cabina) sobre la lista de presets.
    function applyEdits(type, list) {
      const e = (edits || {})[type] || {};
      return list.map((r) => ({
        ...r,
        channels: r.channels.map((c) => {
          const x = (e[r.name] || {})[c.ch];
          return x ? { ...c, freq: x.freq != null && x.freq !== '' ? Number(x.freq) : c.freq, name: x.name != null ? x.name : c.name, edited: true } : c;
        }),
      }));
    }

    function setEdit(type, radio, ch, k, v) {
      edits = edits || {};
      const e = ((edits[type] = edits[type] || {})[radio] = edits[type][radio] || {});
      e[ch] = { ...(e[ch] || {}), [k]: v };
      ctx.kb.storeSet('radioedits', edits);
    }

    async function render() {
      const m = ctx.S.mission;
      if (!m) {
        clear(el).append(noMission(icon('radio'), 'Radios'));
        return;
      }
      if (!edits) edits = (await ctx.kb.storeGet('radioedits')) || {};
      const type = (m.unit && m.unit.type) || ctx.aircraft();
      const list = applyEdits(type, await presets(m));
      const labels = labelsFor(m);
      clear(el);
      if (page === 0) {
        el.append(sourcePicker(ctx, 'radios', 'Origen', [
          ['auto', 'Auto'], ['mision', 'Misión'], ['dtc', 'DTC', !!(m.dtc && m.dtc.radios && m.dtc.radios.length)],
        ], (ctx.S.config.sources || {}).radios || 'auto',
        (ctx.S.config.sources || {}).radios === 'dtc' && !(m.dtc && m.dtc.radios && m.dtc.radios.length) ? 'No hay radios de DTC en uso: salen las de la misión' : ''));
        el.append(h('div.card-row', { style: { marginBottom: '.5rem' } },
          h('div.h1', { style: { margin: 0 } }, 'Presets de radio', h('small', [...new Set(list.map((r) => r.source))].join(' · '))),
          h('span.bar-spacer'),
          h('button.btn.small', { className: `btn small${editing ? ' primary' : ''}`, onclick: () => { editing = !editing; render(); } }, icon('pen'), editing ? ' Listo' : ' Editar'),
          (edits[type] && Object.keys(edits[type]).length) ? h('button.btn.small', { title: 'Quitar tus cambios', onclick: () => { if (confirm('¿Quitar los cambios hechos a mano en estos presets?')) { delete edits[type]; ctx.kb.storeSet('radioedits', edits); render(); } } }, icon('reset')) : null));
        if (editing) el.append(h('div.muted', { style: { fontSize: '.75rem', marginBottom: '.5rem' } }, 'Si cambias un preset en cabina, cámbialo aquí también. Los nombres son tuyos: se guardan para este avión.'));
        if (!list.length) el.append(h('div.card.muted', 'La misión no define presets para este avión.'));
        el.append(h('div', { className: list.length > 1 ? 'grid2' : '' }, list.slice(0, 2).map((r) => h('div',
          h('div.h2', { style: { marginTop: 0 } }, r.name),
          h('table.tbl', h('tbody', r.channels.map((c) => {
            if (!editing) {
              return h('tr',
                h('td', { style: { width: '2.2rem' } }, c.ch),
                h('td', freq(c.freq, c.mod), c.edited ? h('span.muted', ' *') : null),
                h('td.txt', { style: { fontSize: '.72rem' } }, c.name || labels.get(freqKey(c.freq)) || ''));
            }
            const fIn = h('input.f', { value: freq(c.freq).replace(/ FM$/, ''), style: { fontSize: '.78rem', padding: '.12rem .3rem', width: '5.4rem' } });
            const nIn = h('input.f', { value: c.name || '', placeholder: labels.get(freqKey(c.freq)) || 'Nombre', style: { fontSize: '.78rem', padding: '.12rem .3rem' } });
            fIn.addEventListener('change', () => setEdit(type, r.name, c.ch, 'freq', fIn.value.replace(',', '.')));
            nIn.addEventListener('input', () => setEdit(type, r.name, c.ch, 'name', nIn.value));
            return h('tr', h('td', { style: { width: '2.2rem' } }, c.ch), h('td', fIn), h('td.txt', nIn));
          })))))));
        if (list.length > 2) el.append(h('div.muted', `Hay ${list.length - 2} radio(s) más en la página 2.`));
      } else {
        el.append(h('div.h1', 'Frecuencias útiles'));
        const rows = [];
        if (m.groupFreq) rows.push(['Intravuelo', m.groupFreq.text, '']);
        for (const [lbl, b] of [['Salida', m.departure], ['Llegada', m.arrival]]) {
          if (b) rows.push([`${lbl}: ${b.name}`, [b.vhf && freq(b.vhf), b.uhf && freq(b.uhf)].filter(Boolean).join(' / '), b.tacan || '']);
        }
        for (const s of m.support) rows.push([`${s.kind}: ${s.callsign}`, s.freq || '—', [s.tacan, s.icls, s.link4].filter(Boolean).join(' · ')]);
        el.append(h('table.tbl', h('thead', h('tr', h('th', 'Quién'), h('th', 'MHz'), h('th', 'TACAN / otros'))),
          h('tbody', rows.map((r) => h('tr', h('td.txt', r[0]), h('td', r[1]), h('td', r[2]))))));
        for (const r of list.slice(2)) {
          el.append(h('div.h2', r.name), h('table.tbl', h('tbody', r.channels.map((c) => h('tr', h('td', c.ch), h('td', freq(c.freq, c.mod)), h('td.txt', c.name || ''))))));
        }
      }
    }
    return {
      el,
      pages: () => 2,
      show(p) { page = p; render(); },
      title: (p) => (p ? 'Frecuencias' : 'Presets de radio'),
      onMission: render,
      onConfig: () => render(),
      shareData: () => {
        const type = ctx.aircraft();
        return { kind: 'radioedits', label: 'Copiar estos nombres y cambios de presets', payload: { type, edits: (edits || {})[type] || {} } };
      },
      async applyShared(payload) {
        edits = edits || (await ctx.kb.storeGet('radioedits')) || {};
        edits[payload.type] = payload.edits;
        ctx.kb.storeSet('radioedits', edits);
        render();
        ctx.toast('Presets copiados del vuelo');
      },
    };
  },
};

// ------------------------------------------------------------------ apoyo
const KIND_ICON = { AWACS: 'radar', Tanquero: 'fuel', Barco: 'ship', JTAC: 'target' };
export const support = {
  icon: 'support',
  label: 'Apoyo: AWACS, tanqueros, barcos, JTAC',
  create(ctx, tab) {
    const el = h('div');
    const render = () => {
      clear(el);
      const m = ctx.S.mission;
      if (!m) return el.append(noMission(icon('support'), 'Apoyo'));
      const Geo = ctx.Geo;
      const live = ctx.S.live;
      const mv = ctx.magvar();
      const me = live && live.lat != null ? live : null;
      el.append(h('div.h1', 'Apoyo', h('small', `${m.coalition === 'red' ? 'Coalición roja' : 'Coalición azul'}`)));
      if (m.bullseye && m.bullseye.lat != null) {
        const b = m.bullseye;
        const fromBulls = me ? `${deg(Geo.norm360(Geo.bearingDeg(b, me) - mv))} / ${nm(Geo.distanceNm(b, me), 0)} nm` : '—';
        el.append(h('div.card',
          h('div.card-row', h('span', { style: { fontSize: '1.4rem', color: 'var(--accent-text, var(--accent))' } }, icon('bullseye')), h('b', 'Bullseye'), h('span.bar-spacer'), h('span.label', 'Tú desde el bullseye')),
          h('div.card-row', h('span.mono', `${Geo.fmtDDM(b.lat, true)}  ${Geo.fmtDDM(b.lon, false)}`), h('span.bar-spacer'), h('span.big', { style: { fontSize: '1.6rem' } }, fromBulls))));
      }
      if (!m.support.length) el.append(h('div.card.muted', 'La misión no tiene AWACS, tanqueros, barcos con TACAN ni JTAC de tu coalición.'));
      for (const s of m.support) {
        const rel = me && s.lat != null ? `${deg(Geo.norm360(Geo.bearingDeg(me, s) - mv))} · ${nm(Geo.distanceNm(me, s), 0)} nm` : null;
        el.append(h('div.card',
          h('div.card-row', h('span', { style: { fontSize: '1.3rem', color: 'var(--accent-text, var(--accent))' } }, icon(KIND_ICON[s.kind] || 'target')), h('b', s.callsign), h('span.tag', s.kind), h('span.muted', s.type || ''), h('span.bar-spacer'), rel ? h('span.mono', rel) : null),
          h('div.kv', { style: { marginTop: '.35rem' } },
            h('span', 'Frecuencia'), h('span', s.freq || '—'),
            s.tacan ? h('span', 'TACAN') : null, s.tacan ? h('span', s.tacan) : null,
            s.icls ? h('span', 'ICLS') : null, s.icls ? h('span', s.icls) : null,
            s.link4 ? h('span', 'Link 4') : null, s.link4 ? h('span', s.link4) : null,
            s.altFt ? h('span', 'Altitud') : null, s.altFt ? h('span', `${s.altFt.toLocaleString('es-ES')} ft${s.speedKt ? ` · ${s.speedKt} kt` : ''}`) : null,
            s.lat != null ? h('span', 'Posición') : null, s.lat != null ? h('span', `${Geo.fmtDDM(s.lat, true, 1)}  ${Geo.fmtDDM(s.lon, false, 1)}`) : null,
          )));
      }
    };
    const live = throttle(render, 1500);
    return {
      el,
      pages: () => 1,
      show: render,
      title: () => 'Apoyo',
      onMission: render,
      onLive: () => { if (!el.classList.contains('hidden')) live(); },
    };
  },
};

// ------------------------------------------------------------------ tiempos
export const timers = {
  icon: 'timer',
  label: 'Tiempos: reloj, cronómetro, push y bingo',
  create(ctx, tab) {
    const el = h('div');
    const missionClock = h('div.big.xl');
    const localClock = h('div.mono.muted');
    const stopwatch = h('div.big');
    const pushBig = h('div.big');
    const pushInfo = h('div.muted');
    const pushInput = h('input.f', { placeholder: 'HH:MM:SS', style: { width: '7.5rem' }, onchange: () => setPush(parseTime(pushInput.value)) });
    const wpSelect = h('select.f', { style: { width: 'auto' }, onchange: () => { if (wpSelect.value) setPush(Number(wpSelect.value)); } });
    const bingoOut = h('div.big');
    const jokerOut = h('div.mono');
    const homeOut = h('div.mono.muted');
    const fuelOut = h('div.mono');
    const reserveIn = h('input.f', { type: 'number', min: 0, step: 100, style: { width: '6rem' }, onchange: savePlan });
    const burnIn = h('input.f', { type: 'number', min: 0, step: 1, style: { width: '6rem' }, onchange: savePlan });
    const jokerIn = h('input.f', { type: 'number', min: 0, step: 100, style: { width: '6rem' }, onchange: savePlan });

    function parseTime(v) {
      const m = /^(\d{1,2})[:.]?(\d{2})(?:[:.]?(\d{2}))?$/.exec(String(v).trim());
      return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] || 0) : null;
    }
    function setPush(t) { ctx.kb.timer({ cmd: 'push', value: t }); }
    function type() { return ctx.aircraft() || 'default'; }
    function plan() { return ctx.S.config.plan || {}; }
    function savePlan() {
      const p = plan();
      const t = type();
      ctx.kb.patchConfig({ plan: {
        reserveLb: { ...(p.reserveLb || {}), [t]: Number(reserveIn.value) || 0 },
        burnPerNm: { ...(p.burnPerNm || {}), [t]: Number(burnIn.value) || 0 },
        jokerLb: { ...(p.jokerLb || {}), [t]: Number(jokerIn.value) || 0 },
      } });
    }

    const mainEl = h('div');
    const logEl = h('div');
    const blocksEl = h('div.kv');
    let page = 0;
    const T = (b) => (b && b.mt != null ? hms(b.mt, false) : b ? new Date(b.at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '—');
    const span = (a, b) => {
      if (!a || !b) return '—';
      const min = Math.max(0, Math.round(((b.mt != null && a.mt != null) ? b.mt - a.mt : (b.at - a.at) / 1000) / 60));
      return min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min` : `${min} min`;
    };
    function renderBlocks() {
      const b = ctx.S.blocks;
      clear(blocksEl).append(
        h('span', 'Calzos fuera'), h('span', T(b && b.out)),
        h('span', 'Despegue'), h('span', T(b && b.takeoff)),
        h('span', 'Aterrizaje'), h('span', T(b && b.landing)),
        h('span', 'Calzos dentro'), h('span', T(b && b.in)),
        h('span', 'Vuelo'), h('span', b && b.takeoff ? span(b.takeoff, b.landing || { mt: ctx.S.live && ctx.S.live.missionTime, at: Date.now() }) : '—'),
        h('span', 'Bloque'), h('span', b && b.out ? span(b.out, b.in || { mt: ctx.S.live && ctx.S.live.missionTime, at: Date.now() }) : '—'));
    }
    async function renderLog(list) {
      if (!list) list = (await ctx.kb.logbook()).entries;
      clear(logEl).append(h('div.h1', 'Libro de vuelo', h('small', `${list.length} vuelos`)));
      if (!list.length) { logEl.append(h('div.card.muted', 'Los vuelos se apuntan solos: calzos fuera, despegue, aterrizaje y calzos dentro.')); return; }
      const totals = {};
      for (const e of list) {
        const t = e.takeoff && e.landing ? ((e.landing.mt != null && e.takeoff.mt != null) ? e.landing.mt - e.takeoff.mt : (e.landing.at - e.takeoff.at) / 1000) : 0;
        totals[e.aircraft] = (totals[e.aircraft] || 0) + Math.max(0, t);
      }
      logEl.append(h('div.card', h('div.label', 'Horas de vuelo por avión'), h('div.kv', Object.entries(totals).map(([a, t]) => [h('span', a || '—'), h('span', `${(t / 3600).toFixed(1)} h`)]).flat())));
      logEl.append(h('table.tbl', h('thead', h('tr', h('th', 'Fecha'), h('th', 'Avión'), h('th', 'Misión'), h('th.num-r', 'Vuelo'), h('th.num-r', 'Bloque'), h('th.num-r', 'Aterr.'))),
        h('tbody', list.slice(0, 40).map((e) => h('tr',
          h('td', new Date(e.out.at).toLocaleDateString('es-ES')), h('td', e.aircraft), h('td.txt', { style: { fontSize: '.72rem' } }, e.mission || ''),
          h('td.num-r', span(e.takeoff, e.landing)), h('td.num-r', span(e.out, e.in)), h('td.num-r', e.landings || 0))))));
      logEl.append(h('div.card-row', { style: { marginTop: '.6rem' } },
        h('button.btn.small', { onclick: () => {
          const rows = [['fecha', 'avion', 'mision', 'calzos_fuera', 'despegue', 'aterrizaje', 'calzos_dentro', 'vuelo_min', 'bloque_min', 'aterrizajes']];
          for (const e of list) {
            const m = (a, b) => (a && b ? (((b.mt != null && a.mt != null) ? b.mt - a.mt : (b.at - a.at) / 1000) / 60).toFixed(1) : '');
            rows.push([new Date(e.out.at).toISOString().slice(0, 10), e.aircraft, e.mission, T(e.out), T(e.takeoff), T(e.landing), T(e.in), m(e.takeoff, e.landing), m(e.out, e.in), e.landings || 0]);
          }
          navigator.clipboard.writeText(rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\n')).then(() => ctx.toast('Libro de vuelo copiado (CSV) al portapapeles'));
        } }, icon('copy'), ' Copiar CSV'),
        h('button.btn.small', { onclick: () => { if (confirm('¿Borrar el libro de vuelo?')) ctx.kb.logbookClear(); } }, 'Vaciar')));
    }

    el.append(mainEl, logEl);
    mainEl.append(
      h('div.h1', 'Tiempos'),
      h('div.card', h('div.label', 'Hora de la misión'), missionClock, localClock),
      h('div.grid2',
        h('div.card', h('div.label', 'Cronómetro'), stopwatch,
          h('div.card-row', { style: { marginTop: '.4rem' } },
            h('button.btn.primary', { onclick: () => ctx.kb.timer({ cmd: ctx.S.timers && ctx.S.timers.running ? 'stop' : 'start' }) }, icon('play'), ' Iniciar / parar'),
            h('button.btn', { onclick: () => ctx.kb.timer({ cmd: 'reset' }) }, icon('reset')))),
        h('div.card', h('div.label', 'Push / TOT'), pushBig, pushInfo,
          h('div.card-row', { style: { marginTop: '.4rem' } }, pushInput, wpSelect))),
      h('div.card',
        h('div.label', { style: { marginBottom: '.5rem', color: 'var(--accent-text, var(--accent))' } }, 'Bingo y joker'),
        h('div.grid3', { style: { alignItems: 'end' } },
          h('div', h('div.label', 'Reserva lb'), reserveIn),
          h('div', h('div.label', 'Consumo lb/nm'), burnIn),
          h('div', h('div.label', 'Joker +lb'), jokerIn)),
        h('div.grid2', { style: { marginTop: '.6rem' } },
          h('div', h('div.label', 'BINGO'), bingoOut, h('div', { style: { fontSize: '.8rem' } }, jokerOut)),
          h('div', h('div.label', 'Distancia a casa'), homeOut, h('div.label', { style: { marginTop: '.4rem' } }, 'Combustible (DCS)'), fuelOut))),
      h('div.card', h('div.label', { style: { marginBottom: '.4rem' } }, 'Tiempos de bloque (automáticos)'), blocksEl),
    );

    function fillPlan() {
      const p = plan(), t = type();
      reserveIn.value = (p.reserveLb || {})[t] || '';
      burnIn.value = (p.burnPerNm || {})[t] || '';
      jokerIn.value = (p.jokerLb || {})[t] || '';
    }
    function fillWps() {
      const m = ctx.S.mission;
      clear(wpSelect).append(h('option', { value: '' }, 'ETA de un WP…'));
      if (!m) return;
      for (const l of computeLegs(m, ctx)) {
        if (l.etaTod != null) wpSelect.append(h('option', { value: String(l.etaTod) }, `WP${l.idx} ${l.name || ''} · ${hms(l.etaTod, false)}`));
      }
    }

    function tick() {
      if (el.classList.contains('hidden') || page) return;
      renderBlocks();
      const live = ctx.S.live;
      const now = live && live.missionTime != null ? live.missionTime : null;
      missionClock.textContent = now != null ? hms(now) : '--:--:--';
      const d = new Date();
      localClock.textContent = `Local ${d.toLocaleTimeString('es-ES')}`;
      const t = ctx.S.timers || {};
      const ms = (t.acc || 0) + (t.running ? Date.now() - t.startedAt : 0);
      stopwatch.textContent = dur(ms / 1000);
      stopwatch.style.color = t.running ? 'var(--accent-text, var(--accent))' : '';
      if (t.push != null) {
        pushInput.placeholder = hms(t.push);
        if (now != null) {
          const left = t.push - now;
          pushBig.textContent = left >= 0 ? `T−${dur(left)}` : `+${dur(-left)}`;
          pushBig.style.color = left < 0 ? 'var(--warn)' : left < 60 ? 'var(--accent-text, var(--accent))' : '';
          pushInfo.textContent = `Push ${hms(t.push)}`;
        } else {
          pushBig.textContent = hms(t.push);
          pushInfo.textContent = 'Cuenta atrás al entrar en la misión';
        }
      } else {
        pushBig.textContent = '--:--';
        pushInfo.textContent = 'Escribe la hora o elige la ETA de un punto';
      }
      const m = ctx.S.mission;
      const p = plan(), ty = type();
      const home = live && live.lat != null && m && m.arrival ? ctx.Geo.distanceNm(live, m.arrival) : null;
      homeOut.textContent = home != null ? `${nm(home)} nm a ${m.arrival.name}` : '—';
      const burn = Number((p.burnPerNm || {})[ty]) || 0;
      const reserve = Number((p.reserveLb || {})[ty]) || 0;
      if (home != null && burn) {
        const bingo = reserve + home * burn;
        bingoOut.textContent = `${Math.round(bingo / 10) * 10} lb`;
        jokerOut.textContent = `Joker ${Math.round((bingo + (Number((p.jokerLb || {})[ty]) || 0)) / 10) * 10} lb`;
      } else {
        bingoOut.textContent = '—';
        jokerOut.textContent = home == null ? 'Necesita posición en vuelo y aeródromo de llegada' : 'Indica el consumo por milla';
      }
      if (live && live.fuelInt != null) {
        const f = live.fuelInt + (live.fuelExt || 0);
        fuelOut.textContent = f <= 1.5 ? `${Math.round(f * 100)} % (fracción del interno)` : `${Math.round(f * LB).toLocaleString('es-ES')} lb (${Math.round(f)} kg)`;
      } else fuelOut.textContent = '—';
    }

    fillPlan();
    fillWps();
    const iv = setInterval(tick, 250);
    return {
      el,
      pages: () => 2,
      show(p) {
        page = p;
        mainEl.style.display = p ? 'none' : '';
        logEl.style.display = p ? '' : 'none';
        if (p) renderLog();
        else { fillPlan(); tick(); }
      },
      title: (p) => (p ? 'Libro de vuelo' : 'Tiempos'),
      onBlocks: () => tick(),
      onLogbook: (l) => { if (page) renderLog(l); },
      onMission: () => { fillWps(); fillPlan(); },
      onConfig: fillPlan,
      destroy: () => clearInterval(iv),
    };
  },
};
