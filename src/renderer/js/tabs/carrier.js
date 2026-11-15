// Pestaña Portaaviones: el paquete naval (.lfcvw) ajustado a tu escuadrón. Cuatro páginas: Mi salida, Carrier Card,
// Airplan y Ladder. El paquete se importa aquí (o se prepara en Ajustes › Portaaviones) y se guarda en el almacén «cvw».
// Lo que eliges (escuadrón, modex, evento, CASE, puesto en el Marshal, BRC a mano) va en config.carrier.
// Sin desplegables de Windows (no salen en el visor de VR): lista propia, botones y − / +.
import { icon } from '../icons.js';
import { h, clear, emptyState } from '../util.js';
import {
  normalize, fromFile, eventInfo, recoveryFor, squadronEvents, flightsOf, channel, stackLevels, drrRadial, marshal,
  ladderFor, ladderTimes, nowRow, fuelTotals, hhmm,
} from '../cvw-data.js';

const STORE = 'cvw';
const fmtK = (v) => (v == null ? '—' : Number(v).toFixed(1));
const ft = (k) => `${Math.round(k * 1000).toLocaleString('es-ES')} ft`;
const deg = (d) => (d == null ? '—' : `${String(Math.round(d)).padStart(3, '0')}°`);
const sqLabel = (s) => [s.name, s.unit].filter(Boolean).join(' · ') || 'Escuadrón';

export const carrier = {
  icon: 'ship',
  label: 'Portaaviones: tu evento, ladder, stack, Carrier Card y airplan',
  create(ctx) {
    const el = h('div.cvt');
    let pkg = normalize(null);
    let page = 0;
    let listOpen = false;
    let airStart = 0;

    const sel = () => ctx.S.config.carrier || {};
    const setSel = (p) => {
      ctx.S.config.carrier = { ...sel(), ...p };
      ctx.kb.patchConfig({ carrier: p });
      render();
    };
    const hasPkg = () => pkg.squadrons.length > 0 || pkg.events.length > 0 || pkg.ladders.length > 0;

    ctx.kb.storeGet(STORE).then((d) => { pkg = normalize(d); render(); });
    ctx.kb.on('store-changed', (name, d) => { if (name === STORE) { pkg = normalize(d); render(); } });

    async function importPkg() {
      const r = await ctx.kb.cvwImport();
      if (!r) return;
      if (r.error) { ctx.toast(r.error, 'warn'); return; }
      try {
        pkg = fromFile(r.text);
        ctx.kb.storeSet(STORE, pkg);
        ctx.toast(`Paquete «${pkg.name || 'sin nombre'}» importado`, 'info');
        render();
      } catch (err) { ctx.toast(err.message, 'warn'); }
    }

    // ---- lo elegido, con sus valores por defecto
    function state() {
      const s = sel();
      const sq = pkg.squadrons.find((x) => x.id === s.sq) || pkg.squadrons[0] || null;
      const evIdx = sq ? squadronEvents(pkg, sq.id) : pkg.events.map((_, i) => i);
      let ev = pkg.events.findIndex((e) => e.id === s.event);
      if (!evIdx.includes(ev)) ev = evIdx.length ? evIdx[0] : -1;
      const m = ctx.S.mission;
      const onboard = m && m.unit && m.unit.onboard ? String(m.unit.onboard) : '';
      const modex = s.modex != null && s.modex !== '' ? { v: String(s.modex), src: 'tuyo' } : onboard ? { v: onboard, src: 'del .miz' } : { v: (sq && sq.modex) || '', src: 'del escuadrón' };
      const lad = sq ? ladderFor(pkg, sq.aircraft) : null;
      const col = lad ? Math.min(Math.max(0, s.col || 0), Math.max(0, lad.columns.length - 1)) : 0;
      // BRC: rumbo del barco en directo (si DCS da su posición), o el que pongas.
      let brc = null, brcSrc = null;
      const live = ctx.S.live;
      if (m && Array.isArray(m.support) && live && Array.isArray(live.support)) {
        const i = m.support.findIndex((x, k) => x.kind === 'Barco' && live.support[k] && live.support[k].hdg != null);
        if (i >= 0) { brc = (((live.support[i].hdg - ctx.magvar()) % 360) + 360) % 360; brcSrc = `rumbo de ${m.support[i].callsign || 'el barco'} en directo`; }
      }
      if (s.brc != null && s.brc !== '') { brc = Number(s.brc); brcSrc = 'a mano'; }
      return { s, sq, evIdx, ev, modex, lad, col, brc, brcSrc, slot: Math.max(1, Number(s.slot) || 1) };
    }
    const nowMin = () => {
      const l = ctx.S.live;
      return l && l.missionTime != null ? Math.floor(l.missionTime / 60) % 1440 : null;
    };

    // ---- piezas
    function stepper(value, onset, { width = '4.4rem', min = null, max = null, wrap = null } = {}) {
      const input = h('input.f.num', { type: 'text', value: value == null ? '' : String(value), style: { width },
        onchange: () => onset(input.value.trim()) });
      const bump = (d) => {
        let v = Number(input.value) || 0;
        v += d;
        if (wrap) v = ((v % wrap) + wrap) % wrap;
        if (min != null) v = Math.max(min, v);
        if (max != null) v = Math.min(max, v);
        onset(String(v));
      };
      return h('div.stepper', h('button.btn.small', { onclick: () => bump(-1) }, '−'), input, h('button.btn.small', { onclick: () => bump(1) }, '+'));
    }
    const head = (title, right) => h('div.pv-head', h('div.h1', { style: { margin: 0 } }, title, h('small', [pkg.name, pkg.rev ? `rev. ${pkg.rev}` : ''].filter(Boolean).join(' · '))), h('span.bar-spacer'), right || null);

    function render() {
      clear(el);
      if (!hasPkg()) {
        el.append(emptyState(icon('ship'), 'Portaaviones', 'Importa el paquete naval de tu ala (.lfcvw) para ver tu evento, tu ladder, el stack, la Carrier Card y el airplan.'),
          h('div', { style: { textAlign: 'center', marginTop: '1rem' } }, h('button.btn.primary', { onclick: importPkg }, 'Importar paquete…')));
        return;
      }
      const st = state();
      [pageMine, pageCard, pageAirplan, pageLadder][Math.min(page, 3)](st);
    }

    // ---- 1. Mi salida
    function pageMine(st) {
      const { sq, evIdx, ev, modex, lad, col, brc } = st;
      el.append(head('Portaaviones', h('button.btn.small', { onclick: importPkg }, 'Importar paquete…')));
      const list = listOpen ? h('div.pv-list', pkg.squadrons.map((s) => h('div', {
        className: s === sq ? 'sel' : '',
        onclick: (e) => { e.stopPropagation(); listOpen = false; setSel({ sq: s.id, event: null, col: 0 }); },
      }, h('b', s.name || s.unit || '—'), h('span', [s.unit, s.aircraft].filter(Boolean).join(' · '))))) : null;
      const inf = ev >= 0 ? eventInfo(pkg, ev) : null;
      const rec = ev >= 0 ? recoveryFor(pkg, ev) : null;
      const flights = sq && ev >= 0 ? flightsOf(pkg, sq.id, pkg.events[ev].id).filter((f) => !f.air) : [];
      el.append(h('div.card', { style: { marginTop: '.7rem' } },
        h('div.pv-row', h('div.label', 'Mi salida')),
        h('div.pv-kv', { style: { gridTemplateColumns: '1.4fr 1fr 1fr' } },
          h('div', h('div.label', 'Escuadrón'),
            pkg.squadrons.length ? h('div.pv-dd', h('button.pv-ddb', { onclick: (e) => { e.stopPropagation(); listOpen = !listOpen; render(); } }, sq ? sqLabel(sq) : '—', h('span.muted', '▾')), list) : h('div.small.muted', 'El paquete no tiene escuadrones')),
          h('div', h('div.label', 'Modex'), stepper(modex.v, (v) => setSel({ modex: v === '' ? null : v }), { min: 0 }), h('div.small.muted', { style: { marginTop: '.2rem' } }, modex.src)),
          h('div', h('div.label', 'Evento'), h('div.pv-evs', evIdx.map((i) => h('button.chip', { className: `chip${i === ev ? ' sel' : ''}`, onclick: () => setSel({ event: pkg.events[i].id }) }, pkg.events[i].name || `${i + 1}`))),
            sq ? h('div.small.muted', { style: { marginTop: '.2rem' } }, flights.length || squadronEvents(pkg, sq.id).length < pkg.events.length ? `los de ${sq.unit || sq.name}` : 'todos') : null)),
        h('div.pv-kv', { style: { gridTemplateColumns: '1.4fr 1fr 1fr' } },
          h('div', h('div.label', 'Tu vuelo'), flights.length
            ? flights.map((f) => h('div.pv-fl', h('b', f.code || '—'), f.msn ? ` · ${f.msn}` : '', f.n ? ` · ×${f.n}` : '', f.ch != null ? ` · c.${f.ch}` : '', f.call ? ` · ${f.call}` : ''))
            : h('div.small.muted', 'Sin vuelo en el airplan')),
          h('div', h('div.label', 'Launch'), h('div.v', inf && inf.launch ? `${hhmm(inf.launch[0])}–${hhmm(inf.launch[1])}` : '—')),
          h('div', h('div.label', rec ? `Recovery (ev. ${rec.event})` : 'Recovery'), h('div.v', rec ? `${hhmm(rec.window[0])}–${hhmm(rec.window[1])}` : '—')))));

      // Ladder con horas reales
      if (lad) {
        const rows = ladderTimes(lad, col, rec ? rec.window[0] : null);
        const now = nowRow(rows, nowMin());
        const nr = now >= 0 ? rows[now] : null;
        el.append(h('div.card',
          h('div.pv-row', h('div.label', `Ladder · ${lad.label || lad.aircraft}${lad.min ? ` · ${lad.min}` : ''}`), h('span.bar-spacer'),
            lad.columns.map((c, i) => h('button.chip', { className: `chip${i === col ? ' sel' : ''}`, onclick: () => setSel({ col: i }) }, c))),
          h('table.pv-tbl', { style: { marginTop: '.4rem' } }, h('tbody', rows.map((r, i) => h('tr', { className: r.ball ? 'ball' : i === now ? 'now' : '' },
            h('td', r.ball ? r.label : (r.time != null ? hhmm(r.time) : r.label)),
            h('td', i === now ? h('span.pv-tag.a', 'ahora') : (r.time != null && rec && r.time === rec.window[0] ? h('span.pv-tag', 'recovery') : null)),
            h('td.f', fmtK(r.value)))))),
          h('div.pv-note', nr
            ? [`Ahora necesitas `, h('b', fmtK(nr.value)), ` (miles de lb): por encima, libre · en el ladder, max endurance${lad.aoa ? ` (AoA ${lad.aoa})` : ''} · por debajo, al tanquero.`]
            : (rec ? 'Fuera del ladder: todavía no ha empezado (o no hay hora de misión).' : 'Elige un evento con recovery para ver las horas.'))));
      } else if (sq) {
        el.append(h('div.card.small.muted', `El paquete no tiene ladder para ${sq.aircraft || 'el avión de este escuadrón'}.`));
      }

      // Stack, DRR y Marshal
      if (sq) {
        const lv = stackLevels(pkg, sq.id);
        const radial = drrRadial(brc, sq.drr);
        el.append(h('div.pv-st',
          h('div.card', h('div.label', 'Stack Case I'), h('div.pv-big', lv.length ? ft(lv[0]) : '—'),
            h('div.pv-note', lv.length > 1 ? `Si está lleno, ${lv.slice(1).map(ft).join(' · ')}.` : lv.length ? '' : 'Sin altura de espera en la Carrier Card.')),
          h('div.card', h('div.label', 'Salida · DRR'), h('div.pv-big', radial != null ? deg(radial) : sq.drr != null ? `BRC ${sq.drr >= 0 ? '+' : '−'}${Math.abs(sq.drr)}°` : '—'),
            h('div.pv-note', brc != null ? `BRC ${deg(brc)} (${st.brcSrc})${sq.drr != null ? ` ${sq.drr >= 0 ? '+' : '−'} ${Math.abs(sq.drr)}°` : ''}` : 'Sin BRC: ponlo a mano en la Carrier Card (página 2).'))));
        const mk = marshal(pkg, st.slot, rec ? rec.window[0] : null, brc);
        el.append(h('div.card', h('div.label', 'Marshal Case III'),
          h('div.pv-kv', { style: { gridTemplateColumns: '1fr 1.3fr 1fr' } },
            h('div', h('div.label', 'Tu puesto'), stepper(st.slot, (v) => setSel({ slot: Math.max(1, Number(v) || 1) }), { width: '3rem', min: 1 })),
            h('div', h('div.label', 'Altitud · DME'), h('div.v', `${mk.altFt.toLocaleString('es-ES')} ft · ${mk.dme} nm`)),
            h('div', h('div.label', mk.radial != null ? `Radial ${deg(mk.radial)} · Push` : 'Push'), h('div.v', mk.push != null ? hhmm(mk.push) : '—')))));
      }
    }

    // ---- 2. Carrier Card
    function pageCard(st) {
      const { sq, brc } = st;
      const S = pkg.ship, K = pkg.card;
      el.append(head('Carrier Card', h('span.tag', [S.tacan && `TACAN ${S.tacan}`, S.icls && `ICLS ${S.icls}`].filter(Boolean).join(' · ') || S.name || '')));
      if (K.radios.length) el.append(h('div.card', { style: { marginTop: '.7rem' } }, h('div.label', 'Canales'), h('div.pt-rad', { style: { marginTop: '.3rem' } }, K.radios.map((r) => h('div', h('b', r.ch), h('span', r.name))))));
      el.append(h('div.card', h('div.pv-row', h('div.label', 'BRC'), h('span.bar-spacer'),
        stepper(st.s.brc != null && st.s.brc !== '' ? st.s.brc : (brc != null ? Math.round(brc) : ''), (v) => setSel({ brc: v === '' ? null : ((Number(v) % 360) + 360) % 360 }), { width: '4rem', wrap: 360 }),
        st.s.brc != null && st.s.brc !== '' ? h('button.btn.small', { onclick: () => setSel({ brc: null }) }, 'Automático') : null),
        h('div.small.muted', st.brcSrc ? `Ahora: ${st.brcSrc}.` : 'DCS no da el rumbo del barco: ponlo a mano (se usa para el DRR y el Marshal).')));
      if (K.drr.length) {
        el.append(h('div.card', h('div.pv-row', h('div.label', 'DRR · offset sobre el BRC'), h('span.bar-spacer'), sq ? h('span.small.muted', 'el tuyo resaltado') : null),
          h('div.pt-drr', K.drr.map((d) => h('div', { className: sq && d.offset === sq.drr ? 'me' : '' },
            h('div.o', d.offset == null ? '—' : `${d.offset > 0 ? '+' : d.offset < 0 ? '−' : ''}${Math.abs(d.offset)}°`), h('div.w', d.who || '—'))))));
      }
      const hold = K.holding.filter((x) => x.alt != null).sort((a, b) => b.alt - a.alt);
      el.append(h('div.pt-2',
        h('div.card', h('div.label', 'Salidas'), h('div.pt-mono', { style: { marginTop: '.35rem', whiteSpace: 'pre-wrap' } }, K.deps || '—'),
          (K.hawkDay || K.hawkNight) ? [h('div.label', { style: { marginTop: '.7rem' } }, 'Tanker Hawk'), h('div.pt-mono', [K.hawkDay && `Día ${K.hawkDay}`, K.hawkNight && `Noche ${K.hawkNight}`].filter(Boolean).join(' · '))] : null),
        h('div.card', h('div.label', 'Alturas de espera · k ft'), hold.length
          ? h('table.pt-hold', { style: { marginTop: '.3rem' } }, h('tbody', hold.map((x) => {
            const s = x.sq ? pkg.squadrons.find((q) => q.id === x.sq) : null;
            return h('tr', { className: sq && x.sq === sq.id ? 'me' : '' }, h('td.a', x.alt), h('td', s ? (s.unit || s.name) : x.text || '—'));
          }))) : h('div.small.muted', '—'))));
    }

    // ---- 3. Airplan
    function pageAirplan(st) {
      const { sq } = st;
      const per = 6;
      const n = pkg.events.length;
      airStart = Math.min(airStart, Math.max(0, n - per));
      const evs = pkg.events.slice(airStart, airStart + per);
      el.append(head('Airplan', null));
      el.append(h('div.card', { style: { marginTop: '.7rem' } },
        h('div.pv-row', h('div.label', n ? `Eventos ${airStart + 1}–${airStart + evs.length} de ${n}` : 'Sin eventos'), h('span.bar-spacer'),
          h('button.chip', { disabled: airStart <= 0, onclick: () => { airStart = Math.max(0, airStart - per); render(); } }, '‹'),
          h('button.chip', { disabled: airStart + per >= n, onclick: () => { airStart += per; render(); } }, '›')),
        h('table.pt-air', { style: { marginTop: '.4rem' } },
          h('thead', h('tr', h('th', 'Escuadrón'), evs.map((e) => { const i = pkg.events.indexOf(e); const inf = eventInfo(pkg, i); return h('th', h('b', e.name || `${i + 1}`), inf.time != null ? hhmm(inf.time) : ''); }))),
          h('tbody', pkg.squadrons.map((s) => h('tr', { className: sq && s.id === sq.id ? 'mine' : '' },
            h('td.s', s.unit || s.name || '—'),
            evs.map((e) => {
              const list = flightsOf(pkg, s.id, e.id);
              if (!list.length) return h('td', h('span.no', '·'));
              return h('td', list.map((f, k) => [k ? h('br') : null, f.air
                ? h('span.air', `↗ ${f.call || '?'}${f.ch != null ? ` · c.${f.ch}` : ''}`)
                : [h('b', f.code || '?'), ' ', h('span.m', f.msn || ''), f.n ? ` ×${f.n}` : '']]));
            }))))),
        h('div.pv-note', '↗ vuelo de otro evento que sigue en el aire, con su canal (c.).')));
      if (pkg.notes) el.append(h('div.card', h('div.label', 'Notas'), h('div.pt-mono', { style: { marginTop: '.3rem', whiteSpace: 'pre-wrap' } }, pkg.notes)));
    }

    // ---- 4. Ladder
    function pageLadder(st) {
      const { sq, lad, col } = st;
      el.append(head('Ladder', lad ? h('span.tag', [lad.label || lad.aircraft, lad.min].filter(Boolean).join(' · ')) : null));
      if (!lad) { el.append(h('div.card.small.muted', { style: { marginTop: '.7rem' } }, sq ? `El paquete no tiene ladder para ${sq.aircraft || 'este escuadrón'}.` : 'Elige escuadrón en la página 1.')); return; }
      el.append(h('div.card', { style: { marginTop: '.7rem' } },
        h('div.pv-row', h('div.label', [lad.ff != null && `FF ${lad.ff} / 15′`, lad.aoa && `max endurance AoA ${lad.aoa}`, 'miles de lb'].filter(Boolean).join(' · ')), h('span.bar-spacer'),
          lad.columns.map((c, i) => h('button.chip', { className: `chip${i === col ? ' sel' : ''}`, onclick: () => setSel({ col: i }) }, c))),
        h('table.pt-lad', { style: { marginTop: '.4rem' } },
          h('thead', h('tr', h('th'), lad.columns.map((c) => h('th', c)))),
          h('tbody', lad.rows.map((r) => h('tr', { className: r.offset == null ? 'ball' : '' }, h('td', r.label), r.values.map((v, i) => h('td.n', { className: `n${i === col ? ' sel' : ''}` }, fmtK(v))))))),
        h('div.pv-note', 'Por encima: libre · en el ladder: max endurance · por debajo: al tanquero.')));
      const tt = lad.tt || {}, pt = lad.pattern || {};
      el.append(h('div.pv-st',
        h('div.card', h('div.label', 'Trick or Treat'), h('div.pv-row', { style: { gap: '1.4rem', marginTop: '.3rem' } },
          h('div', h('div.small.muted', 'Día'), h('div.pt-big', fmtK(tt.day))), h('div', h('div.small.muted', 'Noche'), h('div.pt-big', fmtK(tt.night))))),
        h('div.card', h('div.label', 'Circuito'), h('div.pv-row', { style: { gap: '1.4rem', marginTop: '.3rem' } },
          h('div', h('div.small.muted', 'Case I'), h('div.pt-big', fmtK(pt.c1))), h('div', h('div.small.muted', 'Case III'), h('div.pt-big', fmtK(pt.c3)))))));
      const fuel = fuelTotals(lad);
      if (fuel.length) {
        el.append(h('div.card', h('div.label', 'Combustible · miles de lb'),
          h('table.pt-lad', { style: { marginTop: '.3rem' } }, h('thead', h('tr', h('th'), h('th', 'Cantidad'), h('th', 'Total'))),
            h('tbody', fuel.map((f) => h('tr', h('td', f.label), h('td.n', fmtK(f.qty)), h('td.n', fmtK(f.total))))))));
      }
    }

    // Cerrar la lista de escuadrones al pulsar fuera.
    el.addEventListener('click', () => { if (listOpen) { listOpen = false; render(); } });
    render();
    let lastNow = null;
    return {
      el,
      pages: () => (hasPkg() ? 4 : 1),
      show(p) { page = p || 0; listOpen = false; render(); },
      title: () => 'Portaaviones',
      onMission: () => render(),
      onConfig: () => { if (!el.contains(document.activeElement)) render(); },
      // La fila de «ahora» del ladder cambia con el reloj de la misión.
      onLive: () => { const n = nowMin(); if (page === 0 && n !== lastNow && !el.contains(document.activeElement)) { lastNow = n; render(); } },
    };
  },
};
