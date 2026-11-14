// Pestaña Combustible: ida por tramos (distancia y altitud editables), ventana de combate entre dos puntos de la ruta,
// vuelta por tramos, reserva y, si quieres, un tanquero (de la misión o a mano en un punto de la ruta).
// Los consumos salen solos del avión en el que estás (fuel-data.js) y los que cambies se guardan para ese avión.
// Lo de cada salida (puntos de combate, tramos, tanquero) se guarda por misión en config.plan.sorties.
import { icon } from '../icons.js';
import { h, clear, emptyState } from '../util.js';
import { FIELDS, UNITS, valuesFor, planSortie, unitFor, defaultUnit, toUnit, fromUnit } from '../fuel-data.js';

const LB = 2.20462;
const r10 = (x) => Math.round(x / 10) * 10;
// Cantidades: por dentro en lb; se enseñan en la unidad de cabina del avión (UNIT, la fija render()).
let UNIT = 'lb';
const lb = (x) => `${r10(toUnit(x, UNIT)).toLocaleString('es-ES')} ${UNITS[UNIT].label}`;
// La misma cantidad en la otra unidad (kg si vas en lb o en litros; lb si vas en kg).
const kg = (x) => (UNIT === 'kg' ? `${r10(x).toLocaleString('es-ES')} lb` : `${r10(toUnit(x, 'kg')).toLocaleString('es-ES')} kg`);
const REFUEL_STEP = { lb: 100, kg: 50, l: 50 };
const mins = (x) => `${Math.round(x)} min`;
const altText = (ft) => (ft >= 10000 ? `FL${String(Math.round(ft / 100)).padStart(3, '0')}` : `${Math.round(ft).toLocaleString('es-ES')} ft`);
const SVG = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}, text) => {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  return e;
};

// Copia profunda con «p» encima (los null se quedan: así se borra un valor propio al guardarse).
function mergeLocal(a, p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return p;
  const out = { ...(a && typeof a === 'object' ? a : {}) };
  for (const [k, v] of Object.entries(p)) out[k] = v && typeof v === 'object' && !Array.isArray(v) ? mergeLocal(out[k], v) : v;
  return out;
}

// Perfil de la salida: ida (tramos a su altitud), caja de combate y vuelta.
function profile(r) {
  const W = 700, H = 250, L = 52, R = 672, G = 205, T = 40, BOX = 116, SL = 14;
  const flown = r.legs.filter((l) => l.section !== 'zona');
  const altMax = Math.max(30000, ...flown.map((l) => l.alt)) * 1.05;
  const y = (alt) => G - (Math.max(0, alt) / altMax) * (G - T);
  const dist = flown.reduce((a, l) => a + l.dist, 0);
  const free = R - L - BOX - SL * (flown.length + 2);
  const k = dist > 0 ? free / dist : 0;
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'fuel-svg' });
  for (const [alt, label] of [[30000, 'FL300'], [15000, 'FL150']]) {
    svg.append(s('line', { class: 'grid', x1: L, y1: y(alt), x2: R, y2: y(alt) }), s('text', { x: 4, y: y(alt) + 4 }, label));
  }
  svg.append(s('line', { class: 'axis', x1: L, y1: G, x2: R, y2: G }), s('text', { x: 4, y: G + 4 }, '0'));
  let x = L;
  let pts = [[x, G]];
  let tankX = null, tankY = null;
  const lows = [];
  const drawLeg = (l) => {
    const yy = y(l.alt);
    x += SL;
    pts.push([x, yy]);
    const x0 = x;
    x += l.dist * k;
    pts.push([x, yy]);
    const low = l.alt < 5000;
    if (low) lows.push([x0, x, yy]);
    if (x - x0 >= 70) {
      svg.append(s('text', { class: `v${low ? ' low' : ''}`, x: (x0 + x) / 2, y: yy - 9, 'text-anchor': 'middle' }, `${altText(l.alt)} · ${Math.round(l.baseDist)} nm`));
      svg.append(s('text', { class: low ? 'low' : '', x: (x0 + x) / 2, y: yy + 17, 'text-anchor': 'middle' }, lb(l.fuel)));
    }
    if (r.tanker && r.legs.indexOf(l) === r.tanker.leg) {
      tankX = l.tankerSplit && l.dist ? x0 + (x - x0) * (l.tankerSplit.before / l.dist) : x;
      tankY = yy;
    }
  };
  const line = (cls) => { svg.append(s('polyline', { class: cls, points: pts.map((p) => p.join(',')).join(' ') })); };
  for (const l of flown.filter((f) => f.section === 'ida')) drawLeg(l);
  x += SL;
  pts.push([x, G]);
  line('path');
  // Combate
  svg.append(s('rect', { class: 'zone', x, y: T + 18, width: BOX, height: G - T - 18, rx: 6 }));
  svg.append(s('text', { class: 'z', x: x + BOX / 2, y: T + 44, 'text-anchor': 'middle' }, 'COMBATE'));
  svg.append(s('text', { class: 'v', x: x + BOX / 2, y: T + 62, 'text-anchor': 'middle' }, mins(r.windowMin)));
  svg.append(s('text', { x: x + BOX / 2, y: T + 78, 'text-anchor': 'middle' }, lb(r.parts.combate)));
  x += BOX;
  const back = flown.filter((f) => f.section === 'vuelta');
  pts = [[x, G]];
  for (const l of back) drawLeg(l);
  x = Math.max(x + SL, R);
  pts.push([R, G]);
  line('path');
  // Tramos a baja cota, encima, en otro color
  for (const [x1, x2, yy] of lows) svg.append(s('line', { class: 'low', x1, y1: yy, x2, y2: yy }));
  if (tankX != null) {
    // Etiqueta debajo de la marca si el tramo va alto; encima si va bajo (para no pisar sus cifras).
    const up = tankY > (T + G) / 2;
    const ly = up ? tankY - 62 : Math.min(G - 8, tankY + 70);
    svg.append(s('line', { class: 'tkline', x1: tankX, y1: tankY, x2: tankX, y2: up ? ly + 6 : ly }));
    svg.append(s('circle', { class: 'tk', cx: tankX, cy: tankY, r: 9 }));
    svg.append(s('path', { class: 'tkT', d: `M${tankX - 5} ${tankY - 4} h10 M${tankX} ${tankY - 4} v9` }));
    svg.append(s('text', { class: 't', x: tankX, y: up ? ly : ly + 14, 'text-anchor': 'middle' }, r.tanker.src === 'map' ? r.tanker.callsign : 'TANQUERO'));
  }
  svg.append(s('text', { x: L, y: G + 26 }, 'SALIDA'), s('text', { x: R, y: G + 26, 'text-anchor': 'end' }, 'LLEGADA'));
  return svg;
}

export const fuel = {
  icon: 'fuel',
  label: 'Combustible: tramos, ventana de combate, tanquero y reserva',
  create(ctx) {
    const el = h('div.fuelplan');
    let shownType = null;
    let openFields = false;

    const plan = () => ctx.S.config.plan || {};
    const type = () => ctx.aircraft() || '';
    const mission = () => ctx.S.mission;
    const mkey = () => { const m = mission(); return m ? String(m.file || m.name || 'mision') : 'sin-mision'; };
    const sortie = () => {
      const own = (plan().sorties || {})[mkey()];
      return own || { windowMin: (plan().sortie || {}).windowMin, zoneNm: (plan().sortie || {}).zoneNm };
    };
    const savePlan = (p) => {
      ctx.S.config.plan = mergeLocal(plan(), p);
      ctx.kb.patchConfig({ plan: p });
      render();
    };
    const saveSortie = (p) => savePlan({ sorties: { [mkey()]: p } });
    const setValue = (key, v) => savePlan({ fuel: { [type()]: { [key]: v == null ? null : v } } });

    // Campo numérico con − y + (en VR no hace falta teclado).
    function stepper(value, step, onset, { placeholder = '', edited = false, min = 0 } = {}) {
      const input = h('input.f.num', { type: 'number', min, step, value: value != null ? value : '', placeholder,
        className: `f num${edited ? ' edited' : ''}`,
        onchange: () => onset(input.value === '' ? null : Math.max(min, Number(input.value) || 0)) });
      const bump = (d) => {
        const cur = input.value === '' ? Number(placeholder) || 0 : Number(input.value) || 0;
        const next = Math.max(min, Math.round((cur + d * step) / step) * step);
        input.value = next;
        onset(next);
      };
      return h('div.stepper',
        h('button.btn.small', { title: `−${step}`, onclick: () => bump(-1) }, '−'),
        input,
        h('button.btn.small', { title: `+${step}`, onclick: () => bump(1) }, '+'));
    }
    // Elegir un punto de la ruta con − y + (los desplegables de Windows no salen en el visor).
    function wpStepper(options, current, onset, label) {
      const i = Math.max(0, options.indexOf(current));
      return h('div.stepper.wp',
        h('button.btn.small', { disabled: i <= 0, onclick: () => onset(options[i - 1]) }, '−'),
        h('span.wp-name', label(current)),
        h('button.btn.small', { disabled: i >= options.length - 1, onclick: () => onset(options[i + 1]) }, '+'));
    }

    function render() {
      clear(el);
      const t = type();
      shownType = t;
      if (!t) {
        el.append(emptyState(icon('fuel'), 'Combustible', 'Entra en un avión en DCS (o carga un .miz en Ajustes › Misión) y aquí saldrán sus consumos.'));
        return;
      }
      const m = mission();
      const { values, edited, known } = valuesFor(t, plan().fuel);
      UNIT = unitFor(t, plan().fuel);
      const U = UNITS[UNIT];
      const so = sortie();
      const tankers = ((m && m.support) || []).filter((x) => x.kind === 'Tanquero' && x.lat != null);
      const load = m && m.unit && m.unit.fuelKg != null ? m.unit.fuelKg * LB : null;
      // Tanquero: de dónde sale su posición (src) y si vas a pasar por él (use, por defecto no).
      const tkCfg = so.tanker || {};
      const use = tkCfg.use === true;
      const src = ['map', 'manual', 'coords'].includes(tkCfg.src) && !(tkCfg.src === 'map' && !tankers.length) ? tkCfg.src : tankers.length ? 'map' : 'coords';
      const curCall = tankers.some((x) => x.callsign === tkCfg.callsign) ? tkCfg.callsign : (tankers[0] || {}).callsign;
      const r = planSortie({ values, route: m && m.route, distanceNm: ctx.Geo.distanceNm, loadLb: load, tankers,
        sortie: { ...so, tanker: use ? { ...tkCfg, src, callsign: curCall } : null } });
      const pts = r.points;
      const wpLabel = (i) => { const p = pts[i]; return p ? `WP${p.idx != null ? p.idx : i}${p.name ? ` ${p.name}` : ''}` : '—'; };
      const tk = r.tanker;

      el.append(h('div.h1', 'Combustible', h('small', t)));
      const cabin = defaultUnit(t);
      el.append(h('div.card-row.fuel-units',
        h('span.label', 'Unidad'),
        ['lb', 'kg', 'l'].map((u) => h('button.chip', { className: `chip${UNIT === u ? ' sel' : ''}`, title: UNITS[u].name,
          onclick: () => savePlan({ fuel: { [t]: { unit: u === cabin ? null : u } } }) }, UNITS[u].name)),
        h('span.small.muted', UNIT === cabin ? 'la de la cabina de este avión' : `la cabina marca ${UNITS[cabin].name.toLowerCase()}`)));

      // ---- ventana y resultado
      el.append(h('div.card',
        h('div.fuel-head',
          h('div', h('div.label', 'Ventana de combate'),
            h('div.fuel-input', stepper(r.windowMin, 5, (v) => saveSortie({ windowMin: v == null ? 20 : v })), h('span.muted.small', 'min'))),
          h('span.bar-spacer'),
          h('div', { style: { textAlign: 'right' } },
            h('div.label', tk ? 'Necesitas al despegar' : 'Necesitas'),
            h('div.big.fuel-big', lb(tk ? tk.needTakeoff : r.total)),
            h('div.mono.muted', tk ? `hasta el tanquero y la reserva · ${kg(tk.needTakeoff)}` : kg(r.total)))),
        load != null
          ? h('div.fuel-load', { className: `fuel-load ${(tk ? tk.arriveWith >= r.parts.reserva : r.margin >= 0) ? 'ok' : 'short'}` },
            h('div', h('div.label', 'Llevas (misión)'), h('div.mono', lb(load))),
            tk
              ? h('div', h('div.label', 'Llegas al tanquero con'), h('div.mono.strong', lb(tk.arriveWith)))
              : h('div', h('div.label', r.margin >= 0 ? 'Te sobran' : 'Te faltan'), h('div.mono.strong', lb(Math.abs(r.margin)))),
            h('div', h('div.label', 'Combate posible'), h('div.mono.strong', tk && tk.maxWindow != null ? mins(tk.maxWindow) : r.maxWindow != null ? mins(r.maxWindow) : '—')))
          : h('div.small.muted', { style: { marginTop: '.5rem' } }, 'Con una misión cargada se compara con el combustible que llevas.')));

      // ---- dónde empieza y termina el combate
      if (r.hasRoute) {
        const last = pts.length - 1;
        const entries = Array.from({ length: last }, (_, i) => i + 1);
        const exits = entries.filter((i) => i >= r.entry);
        el.append(h('div.card',
          h('div.grid2',
            h('div', h('div.label', 'El combate empieza en'), wpStepper(entries, r.entry, (v) => saveSortie({ entry: v, exit: Math.max(v, r.exit) }), wpLabel)),
            h('div', h('div.label', 'Y termina en'), wpStepper(exits, r.exit, (v) => saveSortie({ exit: v }), wpLabel))),
          h('div.small.muted', { style: { marginTop: '.4rem' } }, 'Entre esos dos puntos manda la ventana de combate; antes es la ida y después la vuelta.')));
      }

      // ---- perfil
      el.append(h('div.card.fuel-prof',
        h('div.card-row', h('div.label', 'Perfil de la salida'), h('span.bar-spacer'),
          h('span.fuel-pill', `ida ${Math.round(r.legs.filter((l) => l.section === 'ida').reduce((a, l) => a + l.dist, 0))} nm · vuelta ${Math.round(r.legs.filter((l) => l.section === 'vuelta').reduce((a, l) => a + l.dist, 0))} nm`)),
        profile(r)));

      // ---- tramos
      const legsCard = h('div.card');
      const anyLegEdit = r.legs.some((l) => l.distEdited || l.altEdited);
      legsCard.append(h('div.card-row', { style: { marginBottom: '.6rem' } }, h('b', 'Tramos'), h('span.bar-spacer'),
        anyLegEdit ? h('button.btn.small', { onclick: () => {
          const reset = {};
          for (const l of r.legs) reset[l.key] = { dist: null, alt: null };
          saveSortie({ legs: reset });
        } }, icon('reset'), r.hasRoute ? ' Volver a la ruta' : ' Borrar') : h('span.muted.small', r.hasRoute ? 'Distancias y altitudes de la ruta' : 'Sin ruta: escribe la distancia')));
      const grid = h('div.fuel-legs',
        h('span.hd'), h('span.hd', 'Tramo'), h('span.hd', 'Distancia (nm)'), h('span.hd', 'Altitud (ft)'), h('span.hd.num-r', 'Gasta'));
      const legRow = (l) => {
        const low = l.alt < 5000;
        const extra = tk && tk.src !== 'manual' && r.legs.indexOf(l) === tk.leg ? (tk.detour < 1 ? `pasa por ${tk.callsign}` : `+${Math.round(tk.detour)} nm al tanquero`) : null;
        grid.append(
          h('span.tag', l.section === 'ida' ? 'Ida' : 'Vuelta'),
          h('span', { className: low ? 'warnc' : '' }, `${l.from} → ${l.to}`, extra ? h('div.small.muted', extra) : null),
          stepper(Math.round(l.baseDist), 5, (v) => saveSortie({ legs: { [l.key]: { dist: v } } }), { edited: l.distEdited }),
          stepper(Math.round(l.alt), l.alt <= 5000 ? 500 : 1000, (v) => saveSortie({ legs: { [l.key]: { alt: v } } }), { edited: l.altEdited }),
          h('span.fuel-amt', { className: `fuel-amt${low ? ' warnc' : ''}` }, lb(l.fuel)));
      };
      for (const l of r.legs.filter((x) => x.section === 'ida')) legRow(l);
      grid.append(h('div.fuel-zone',
        h('span.tag.z', 'Combate'),
        h('span', r.hasRoute ? `${wpLabel(r.entry)}${r.exit !== r.entry ? ` → ${wpLabel(r.exit)}` : ''}` : 'En la zona'),
        h('span.bar-spacer'),
        h('span.mono', `${mins(r.windowMin)} · ${lb(r.parts.combate)}`)));
      for (const l of r.legs.filter((x) => x.section === 'vuelta')) legRow(l);
      legsCard.append(grid);
      legsCard.append(h('div.kv', { style: { marginTop: '.7rem' } },
        h('span', 'Arranque, rodaje y despegue'), h('span', lb(r.parts.arranque)),
        h('span', 'Reserva al aterrizar'), h('span', lb(r.parts.reserva))));
      el.append(legsCard);

      // ---- tanquero
      const chip = (label, on, onclick) => h('button.chip', { className: `chip${on ? ' sel' : ''}`, onclick }, label);
      const setTk = (p) => saveSortie({ tanker: { src, callsign: curCall, ...p } });
      const fmtLL = (c) => `${ctx.Geo.fmtDDM(c.lat, true, 1)}  ${ctx.Geo.fmtDDM(c.lon, false, 1)}`;
      const setCoords = (c, text) => setTk({ src: 'coords', coords: { lat: c.lat, lon: c.lon, text: text || fmtLL(c) } });
      const tkCard = h('div.card',
        h('div.card-row', h('b', 'Tanquero'), h('span.bar-spacer'),
          h('button.fuel-sw', { className: `fuel-sw${use ? ' on' : ''}`, onclick: () => setTk({ use: !use }) }, 'Pasar por el tanquero', h('i'))),
        h('div.chips', { style: { margin: '.5rem 0 .2rem' } },
          tankers.map((x) => chip(x.callsign, src === 'map' && curCall === x.callsign, () => setTk({ src: 'map', callsign: x.callsign }))),
          chip('Punto de la ruta', src === 'manual', () => setTk({ src: 'manual' })),
          chip('Coordenadas', src === 'coords', () => setTk({ src: 'coords' }))));
      // Dónde está.
      if (src === 'map') {
        const x = tankers.find((y) => y.callsign === curCall);
        tkCard.append(h('div.small.muted', `${curCall}${x && x.type ? ` · ${x.type}` : ''}${x && x.altFt ? ` · ${altText(x.altFt)}` : ''}: posición de la misión. Si al despegar aún no está en su estación, usa «Coordenadas».`));
      } else if (src === 'manual' && r.hasRoute) {
        const validWp = Array.from({ length: pts.length - 1 }, (_, i) => i + 1).filter((i) => i <= r.entry || i >= r.exit);
        const curWp = validWp.includes(Number(tkCfg.wp)) ? Number(tkCfg.wp) : (tk && tk.wp) || validWp[0];
        tkCard.append(h('div', h('div.label', 'Punto de la ruta'), wpStepper(validWp, curWp, (v) => setTk({ src: 'manual', wp: v }), wpLabel)));
      } else if (src === 'coords') {
        const c = tkCfg.coords && tkCfg.coords.lat != null ? tkCfg.coords : null;
        const input = h('input.f', { value: c ? (c.text || fmtLL(c)) : '', placeholder: 'N42 27.0 E043 00.0',
          onchange: () => {
            const v = input.value.trim();
            if (!v) return setTk({ src: 'coords', coords: null });
            const ll = ctx.Geo.parseLatLon(v);
            if (!ll) { ctx.toast('No entiendo esas coordenadas: escribe grados y minutos (N42 27.0 E043 00.0) o grados decimales', 'warn'); return; }
            setCoords(ll, v);
          } });
        const bloc = h('div.chips', { style: { marginTop: '.4rem' } });
        tkCard.append(h('div',
          h('div.label', 'Coordenadas del tanquero'),
          h('div.card-row', input,
            h('button.btn.small', { onclick: async () => {
              const pnt = await ctx.kb.capture();
              if (pnt && pnt.lat != null) setCoords(pnt);
            } }, icon('pin'), ' Capturar del F10')),
          c ? h('div.small.mono.muted', { style: { marginTop: '.3rem' } }, fmtLL(c)) : h('div.small.muted', { style: { marginTop: '.3rem' } }, 'Escríbelas, captúralas del F10 (centra el tanquero en la cruz) o elige un punto del Bloc.'),
          bloc));
        // Últimos puntos del Bloc (lo que ha ido capturando la herramienta de coordenadas).
        const notesTab = (ctx.S.config.tabs || []).find((x) => x.type === 'notes');
        if (notesTab) {
          ctx.kb.storeGet(`notes:${notesTab.id}`).then((d) => {
            const list = ((d && d.points) || []).filter((q) => q.lat != null).slice(0, 4);
            if (!list.length) return;
            bloc.append(h('span.small.muted', 'Del Bloc:'), ...list.map((q, i) => chip(`${q.name || `Punto ${list.length - i}`} · ${ctx.Geo.fmtDDM(q.lat, true, 0)} ${ctx.Geo.fmtDDM(q.lon, false, 0)}`, false, () => setCoords(q))));
          });
        }
      }
      // Resultado.
      if (!use) {
        tkCard.append(h('div.small.muted', { style: { marginTop: '.6rem' } }, 'No repostas: el cálculo va sin tanquero. Activa «Pasar por el tanquero» si vas a hacer repostaje.'));
      } else if (!r.hasRoute) {
        tkCard.append(h('div.small.warnc', { style: { marginTop: '.6rem' } }, 'Para situar el tanquero hace falta una ruta en la misión.'));
      } else if (!tk) {
        tkCard.append(h('div.small.warnc', { style: { marginTop: '.6rem' } }, src === 'coords' ? 'Faltan las coordenadas del tanquero.' : 'No encuentro ese tanquero en la misión.'));
      } else {
        tkCard.append(
          h('div.small.muted', { style: { margin: '.6rem 0 .2rem' } }, tk.src === 'manual'
            ? `Repostas ${tk.where}, ${tk.section === 'ida' ? 'antes' : 'después'} del combate.`
            : `Se mete en tu ruta ${tk.where}, ${tk.detour < 1 ? 'casi sin desvío' : `con un desvío de ${Math.round(tk.detour)} nm`}; repostas ${tk.section === 'ida' ? 'antes' : 'después'} del combate.`),
          h('div', h('div.label', `Repostas hasta (${U.label})`),
            stepper(tk.refuelTo != null ? r10(toUnit(tk.refuelTo, UNIT)) : null, REFUEL_STEP[UNIT], (v) => setTk({ refuelTo: v == null ? null : fromUnit(v, UNIT) }), { edited: tkCfg.refuelTo != null })),
          h('div.fuel-tk',
            h('div', h('div.label', 'Hasta el tanquero'), h('div.strong', lb(tk.before)),
              tk.arriveWith != null ? h('div.small.muted', 'Llegas con ', h('span', { className: tk.arriveWith >= r.parts.reserva ? 'okc' : 'badc' }, lb(tk.arriveWith))) : null),
            h('div', h('div.label', 'Tras repostar'), h('div.strong', lb(tk.needAfter)),
              tk.marginAfter != null ? h('div.small.muted', tk.marginAfter >= 0 ? 'Te sobran ' : 'Te faltan ', h('span', { className: tk.marginAfter >= 0 ? 'okc' : 'badc' }, lb(Math.abs(tk.marginAfter)))) : null),
            h('div', h('div.label', 'Combate posible'), h('div.strong', tk.maxWindow != null ? mins(tk.maxWindow) : '—'),
              r.maxWindow != null ? h('div.small.muted', `Sin tanquero: ${mins(r.maxWindow)}`) : null)),
          h('div.small.muted', { style: { marginTop: '.5rem' } }, 'Se cuenta llegar al tanquero con la reserva, por si no puedes repostar.'));
      }
      el.append(tkCard);

      // ---- consumos del avión (plegados)
      const anyMine = Object.keys(edited).length > 0;
      const det = h('details.card.fuel-cons', { open: openFields || !known, ontoggle: () => { openFields = det.open; } },
        h('summary',
          h('b', `Consumos del ${t}`),
          h('div.small.mono.muted', known || anyMine
            ? ['crucero alto', 'crucero', 'baja cota', 'bajo', 'combate', 'combate'].reduce((a, x, i, arr) => (i % 2 ? a : [...a, `${x} ${values[arr[i + 1]] != null ? Math.round(toUnit(values[arr[i + 1]], UNIT)) : '—'} ${U.label}/min`]), []).join(' · ')
            : 'Sin consumos de fábrica: escríbelos')),
        h('div.card-row', { style: { margin: '.5rem 0' } },
          h('span.small.muted', known
            ? 'Puestos solos según el avión en el que estás. Son orientativos: cámbialos a tu forma de volar y se guardan para este avión.'
            : `No tengo consumos de fábrica para el ${t}. Escribe los tuyos y se guardan para este avión.`),
          h('span.bar-spacer'),
          anyMine ? h('button.btn.small', { onclick: () => savePlan({ fuel: { [t]: Object.fromEntries(FIELDS.map((f) => [f.key, null])) } }) },
            icon('reset'), known ? ' Valores de fábrica' : ' Borrar los míos') : null),
        h('div.fuel-fields', FIELDS.map((f) => h('div.fuel-field',
          h('div.label', f.label, edited[f.key] ? h('span.tag.mine', 'tuyo') : null),
          f.fuel != null
            ? h('div.fuel-input', stepper(values[f.key] != null ? Math.round(toUnit(values[f.key], UNIT)) : null, f.step[UNIT], (v) => setValue(f.key, v == null ? null : fromUnit(v, UNIT))), h('span.muted.small', `${U.label}${f.fuel}`))
            : h('div.fuel-input', stepper(values[f.key], f.step, (v) => setValue(f.key, v)), h('span.muted.small', f.unit)),
          h('div.small.muted', f.help)))));
      el.append(det);
    }

    render();
    let lastMission = null;
    const refresh = () => { if (!el.contains(document.activeElement)) render(); };
    return {
      el,
      pages: () => 1,
      show: refresh,
      title: () => 'Combustible',
      onMission: (m) => { if (m !== lastMission) { lastMission = m; refresh(); } },
      onLive: () => { if (type() !== shownType) render(); },
      onConfig: refresh,
    };
  },
};
