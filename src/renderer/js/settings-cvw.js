// Ajustes › Portaaviones: editor del paquete naval (.lfcvw). Todo editable y vacío al empezar; se guarda solo en el
// almacén «cvw» (el mismo que lee la pestaña Portaaviones) y se exporta a un archivo para los compañeros.
import { h } from './util.js';
import {
  emptyPackage, normalize, toFile, fromFile, fillTimes, eventInfo, hhmm, durText, newId, fillLadder, fuelTotals,
} from './cvw-data.js';

const STORE = 'cvw';
const TABS = [['barco', 'Barco y ciclo'], ['escuadrones', 'Escuadrones y stacks'], ['airplan', 'Airplan'], ['card', 'Carrier Card'], ['ladders', 'Ladders']];
let pkg = null;
let sub = 'barco';
let cell = null;        // casilla del airplan que se está editando { sq, ev }
let ladderId = null;    // ladder que se está editando
let saveTimer = null;

const num = (v) => (v === '' || v == null ? null : Number.isFinite(Number(String(v).replace(',', '.').replace('−', '-'))) ? Number(String(v).replace(',', '.').replace('−', '-')) : null);

let listening = false;
let rerender = null;

export async function cvwSection({ main, kb, render, askText }) {
  if (!pkg) pkg = normalize(await kb.storeGet(STORE));
  rerender = render;
  if (!listening) {
    listening = true;
    // Importado desde la pestaña del kneeboard con Ajustes abierto: se coge el nuevo.
    kb.on('store-changed', (name, d) => { if (name === STORE) { pkg = normalize(d); cell = null; ladderId = null; if (location.hash === '#portaaviones' && rerender) rerender(); } });
  }
  const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => kb.storeSet(STORE, pkg), 250); };
  const redo = () => { save(); render(); };
  const lib = await kb.library.status().catch(() => ({ aircraft: [] }));

  // Campo con etiqueta encima (los del editor).
  const field = (label, value, set, { type = 'text', ph = '', width = null, list = null } = {}) => h('label.cv-f',
    h('span', label),
    h('input.f', { type, value: value == null ? '' : String(value), placeholder: ph, list, style: width ? { width } : null, onchange: (e) => { set(e.target.value); save(); } }));
  const inp = (value, set, { ph = '', cls = '', redraw = false, type = 'text', list = null } = {}) => h('input.f', {
    className: `f ${cls}`, type, value: value == null ? '' : String(value), placeholder: ph, list,
    onchange: (e) => { set(e.target.value); if (redraw) redo(); else save(); },
  });
  const del = (fn, title = 'Quitar') => h('button.cv-x', { title, onclick: () => { fn(); redo(); } }, '✕');

  main.append(
    h('h1', 'Portaaviones'),
    h('p.lead', 'Paquete naval de tu ala: barco, eventos, escuadrones, airplan, Carrier Card y ladders. Se edita aquí y se exporta a un archivo; tus compañeros lo importan en su pestaña Portaaviones y les sale todo ajustado a su escuadrón.'),
    h('div.card', h('div.cv-head',
      h('input.f', { value: pkg.name, placeholder: 'Nombre del paquete (por ejemplo, el ala y el barco)', style: { width: '320px', fontWeight: '600' }, onchange: (e) => { pkg.name = e.target.value; save(); } }),
      h('span.cv-ver', `rev. ${pkg.rev}${pkg.updated ? ` · ${new Date(pkg.updated).toLocaleDateString('es-ES')}` : ''}`),
      h('span.grow'),
      h('button.btn', { onclick: () => { if (confirm('¿Empezar un paquete nuevo? Se borra el que hay aquí (exporta antes si lo quieres guardar).')) { pkg = emptyPackage(); cell = null; ladderId = null; redo(); } } }, 'Nuevo'),
      h('button.btn', { onclick: async () => {
        const r = await kb.cvwImport();
        if (!r) return;
        if (r.error) { alert(r.error); return; }
        try { pkg = fromFile(r.text); cell = null; ladderId = null; redo(); } catch (err) { alert(err.message); }
      } }, 'Importar…'),
      h('button.btn.primary', { onclick: async () => {
        pkg.rev = (pkg.rev || 0) + 1;
        pkg.updated = new Date().toISOString();
        const r = await kb.cvwExport(toFile(pkg), pkg.name || 'Paquete naval');
        if (r && r.error) alert(r.error);
        redo();
      } }, 'Exportar paquete…'))),
    h('div.libtabs', TABS.map(([id, label]) => h('button', { className: sub === id ? 'sel' : '', onclick: () => { sub = id; render(); } }, label))));

  // ---------------------------------------------------------------- Barco y ciclo
  if (sub === 'barco') {
    const S = pkg.ship;
    main.append(h('div.card', h('div.cv-title', 'Barco'), h('div.cv-grid',
      field('Nombre', S.name, (v) => { S.name = v; }),
      field('TACAN', S.tacan, (v) => { S.tacan = v; }),
      field('ICLS', S.icls, (v) => { S.icls = v; }),
      field('Link 4 / ACLS', S.link4, (v) => { S.link4 = v; }),
      field('Fecha', S.date, (v) => { S.date = v; }),
      field('Zona horaria', S.tz, (v) => { S.tz = v; }),
      field('Variación', S.variation, (v) => { S.variation = v; }),
      field('Salida / puesta de sol', S.sun, (v) => { S.sun = v; }))));
    const Cy = pkg.cycle;
    const rows = pkg.events.map((e, i) => {
      const inf = eventInfo(pkg, i);
      return h('tr',
        h('td', inp(e.name, (v) => { e.name = v; }, { ph: `${i + 1}`, cls: 'narrow' })),
        h('td', inp(e.time, (v) => { e.time = v; }, { ph: 'HH:MM', cls: 'num narrow', redraw: true })),
        h('td.calc', inf.cycle != null ? durText(inf.cycle) : '—'),
        h('td.calc', inf.launch ? `${hhmm(inf.launch[0])}–${hhmm(inf.launch[1])}` : '—'),
        h('td.calc', inf.recovery ? `${hhmm(inf.recovery[0])}–${hhmm(inf.recovery[1])}` : '—'),
        h('td.small.muted', inf.recovers ? `← ${inf.recovers}` : ''),
        h('td.x', del(() => { pkg.events.splice(i, 1); })));
    });
    main.append(h('div.cv-2.ev',
      h('div.card', h('div.cv-title', 'Ciclo'),
        h('div.cv-grid.c2',
          field('Hora del primer evento', Cy.first, (v) => { Cy.first = v; }, { ph: 'HH:MM' }),
          field('Duración del ciclo', Cy.duration, (v) => { Cy.duration = v; }, { ph: 'H:MM' }),
          field('Launch (min antes)', Cy.launchMin, (v) => { Cy.launchMin = num(v); }, { type: 'number' }),
          field('Recovery (min después)', Cy.recoveryMin, (v) => { Cy.recoveryMin = num(v); }, { type: 'number' })),
        h('div.row', { style: { marginTop: '10px' } },
          h('button.btn.small', { onclick: () => {
            const d = /^(\d+):(\d{2})$/.exec(String(Cy.duration).trim());
            const dur = d ? Number(d[1]) * 60 + Number(d[2]) : num(Cy.duration);
            if (!pkg.events.length || !dur || !/^\d{1,2}:\d{2}$/.test(String(Cy.first).trim())) { alert('Pon la hora del primer evento (HH:MM), la duración del ciclo (H:MM) y al menos un evento.'); return; }
            fillTimes(pkg, Cy.first, dur);
            redo();
          } }, 'Calcular las horas de los eventos'),
          h('span.cv-mini', 'Luego puedes cambiar la hora de cualquiera: cada ciclo puede durar distinto.'))),
      h('div.card',
        h('div.row', { style: { marginBottom: '6px' } }, h('div.cv-title', { style: { margin: 0 } }, 'Eventos'), h('span.grow'),
          h('button.btn.small', { onclick: () => { pkg.events.push({ id: newId('e'), name: String(pkg.events.length + 1), time: '' }); redo(); } }, '+ evento')),
        pkg.events.length
          ? h('div.cv-scroll', h('table.t.cv', h('thead', h('tr', h('th', 'Evento'), h('th', 'Hora'), h('th', 'Ciclo'), h('th', 'Launch'), h('th', 'Recovery'), h('th'), h('th'))), h('tbody', rows)))
          : h('div.cv-mini', 'Todavía no hay eventos. Añádelos con «+ evento»: el nombre es libre (1, 2, 3, FF…).'),
        h('div.cv-mini', { style: { marginTop: '6px' } }, 'Los que despegan en un evento vuelven en el recovery del siguiente.'))));
  }

  // ---------------------------------------------------------------- Escuadrones y stacks
  if (sub === 'escuadrones') {
    const dl = h('datalist#cvAircraft', (lib.aircraft || []).map((a) => h('option', { value: a })));
    const rows = pkg.squadrons.map((s, i) => h('tr',
      h('td', inp(s.name, (v) => { s.name = v; }, { ph: 'Nombre' })),
      h('td', inp(s.unit, (v) => { s.unit = v; }, { ph: 'Unidad' })),
      h('td', inp(s.aircraft, (v) => { s.aircraft = v.trim(); }, { ph: 'Módulo de DCS', list: 'cvAircraft' })),
      h('td', inp(s.modex, (v) => { s.modex = v; }, { ph: '—', cls: 'num' })),
      h('td', inp(s.drr, (v) => { s.drr = num(v); }, { ph: '—', cls: 'num', type: 'number' })),
      h('td.x', del(() => { pkg.squadrons.splice(i, 1); delete pkg.airplan[s.id]; }))));
    const M = pkg.marshal, St = pkg.stack;
    main.append(dl,
      h('div.card',
        h('div.row', { style: { marginBottom: '8px' } }, h('div.cv-title', { style: { margin: 0 } }, 'Escuadrones'), h('span.grow'),
          h('button.btn.small', { onclick: () => { pkg.squadrons.push({ id: newId('s'), name: '', unit: '', aircraft: '', modex: '', drr: null }); redo(); } }, '+ Añadir escuadrón')),
        pkg.squadrons.length
          ? h('table.t.cv', h('thead', h('tr', h('th', 'Nombre'), h('th', 'Unidad'), h('th', 'Avión (módulo)'), h('th', 'Modex base'), h('th', 'DRR (offset sobre el BRC, °)'), h('th'))), h('tbody', rows))
          : h('div.cv-mini', 'Todavía no hay escuadrones.'),
        h('div.cv-mini', { style: { marginTop: '8px' } }, 'El avión decide qué ladder usa el escuadrón (el que tenga ese mismo módulo en Ladders). Cada piloto pone su modex en la pestaña Portaaviones; si no, sale del .miz.')),
      h('div.cv-2',
        h('div.card', h('div.cv-title', 'Stack Case I'), h('div.cv-grid.c2',
          field('Aviones por nivel', St.perLevel, (v) => { St.perLevel = num(v); }, { type: 'number' }),
          field('Si tu nivel está lleno', St.full, (v) => { St.full = v; })),
        h('div.cv-mini', { style: { marginTop: '8px' } }, 'El nivel de cada escuadrón se elige en Carrier Card › Alturas de espera.')),
        h('div.card', h('div.cv-title', 'Marshal Case III'), h('div.cv-grid.c3',
          field('Primer punto (ft)', M.alt0, (v) => { M.alt0 = num(v); }, { type: 'number' }),
          field('Primer punto (nm)', M.dme0, (v) => { M.dme0 = num(v); }, { type: 'number' }),
          field('Radial (BRC + °)', M.radialOffset, (v) => { M.radialOffset = num(v); }, { type: 'number' }),
          field('Cada avión suma (ft)', M.altStep, (v) => { M.altStep = num(v); }, { type: 'number' }),
          field('Cada avión suma (nm)', M.dmeStep, (v) => { M.dmeStep = num(v); }, { type: 'number' }),
          field('Entre Push (min)', M.push, (v) => { M.push = num(v); }, { type: 'number' })))));
  }

  // ---------------------------------------------------------------- Airplan
  if (sub === 'airplan') {
    if (!pkg.squadrons.length || !pkg.events.length) {
      main.append(h('div.card.cv-mini', 'Para el airplan hacen falta escuadrones (Escuadrones y stacks) y eventos (Barco y ciclo).'));
    } else {
      const head = h('tr', h('th', 'Escuadrón'), pkg.events.map((e, i) => { const inf = eventInfo(pkg, i); return h('th', h('b', e.name || `${i + 1}`), inf.time != null ? hhmm(inf.time) : ''); }));
      const body = pkg.squadrons.map((s) => h('tr',
        h('td.cv-sq', s.unit || s.name || '—'),
        pkg.events.map((e) => {
          const list = ((pkg.airplan[s.id] || {})[e.id]) || [];
          const sel = cell && cell.sq === s.id && cell.ev === e.id;
          return h('td', h('div.cv-cell', { className: `cv-cell${sel ? ' sel' : ''}`, onclick: () => { cell = { sq: s.id, ev: e.id }; render(); } },
            list.length ? list.map((f) => h('div.cv-fl', { className: `cv-fl${f.air ? ' air' : ''}` },
              f.air ? ['↗ ', h('b', f.call || '?'), f.ch != null ? ` · c.${f.ch}` : '']
                : [h('b', f.code || '?'), ' ', h('span.m', f.msn || ''), f.n ? ` ×${f.n}` : ''])) : h('span.cv-empty', '+')));
        })));
      main.append(h('div.card', h('div.row', { style: { marginBottom: '8px' } }, h('div.cv-title', { style: { margin: 0 } }, 'Airplan'),
        h('span.small.muted', 'Pulsa una casilla para poner sus vuelos.')),
      h('div.cv-scroll', h('table.t.cv.cv-air', h('thead', head), h('tbody', body)))));
      if (cell) {
        const s = pkg.squadrons.find((x) => x.id === cell.sq), e = pkg.events.find((x) => x.id === cell.ev);
        if (s && e) {
          pkg.airplan[s.id] = pkg.airplan[s.id] || {};
          const list = pkg.airplan[s.id][e.id] = pkg.airplan[s.id][e.id] || [];
          const chOpts = (cur) => [h('option', { value: '' }, '—'), ...pkg.card.radios.map((r) => h('option', { value: String(r.ch), selected: r.ch === cur }, `${r.ch} · ${r.name}`))];
          main.append(h('div.card',
            h('div.row', { style: { marginBottom: '8px' } }, h('div.cv-title', { style: { margin: 0 } }, `${s.unit || s.name} · evento ${e.name}`), h('span.grow'),
              h('button.btn.small', { onclick: () => { list.push({ code: '', msn: '', n: null, call: '', ch: null, notes: '', air: false }); redo(); } }, '+ vuelo'),
              h('button.btn.small', { onclick: () => { list.push({ code: '', msn: '', n: null, call: '', ch: null, notes: '', air: true }); redo(); } }, '+ en el aire'),
              h('button.btn.small', { onclick: () => { cell = null; render(); } }, 'Cerrar')),
            list.length ? h('table.t.cv', h('thead', h('tr', h('th', 'Tipo'), h('th', 'Código'), h('th', 'Misión'), h('th', 'Aviones'), h('th', 'Indicativo'), h('th', 'Canal'), h('th', 'Notas'), h('th'))),
              h('tbody', list.map((f, i) => h('tr',
                h('td.small', f.air ? 'en el aire' : 'despega'),
                h('td', f.air ? '' : inp(f.code, (v) => { f.code = v; }, { ph: '3D1', redraw: true })),
                h('td', f.air ? '' : inp(f.msn, (v) => { f.msn = v; }, { ph: 'CAP', redraw: true })),
                h('td', f.air ? '' : inp(f.n, (v) => { f.n = num(v); }, { ph: '2', cls: 'num', type: 'number', redraw: true })),
                h('td', inp(f.call, (v) => { f.call = v; }, { ph: 'Indicativo', redraw: true })),
                h('td', h('select.f', { onchange: (ev) => { f.ch = num(ev.target.value); redo(); } }, chOpts(f.ch))),
                h('td', inp(f.notes, (v) => { f.notes = v; }, { ph: '—' })),
                h('td.x', del(() => { list.splice(i, 1); })))))) : h('div.cv-mini', 'Sin vuelos. «+ vuelo» para uno que despega en este evento; «+ en el aire» para uno de otro evento que sigue volando con su indicativo y su canal.')));
        }
      }
    }
    main.append(h('div.card', h('div.cv-title', 'Notas del airplan'),
      h('textarea.f', { rows: 3, value: pkg.notes, style: { width: '100%' }, onchange: (e) => { pkg.notes = e.target.value; save(); } })));
  }

  // ---------------------------------------------------------------- Carrier Card
  if (sub === 'card') {
    const K = pkg.card;
    const radios = K.radios.map((r, i) => h('div.cv-radio',
      inp(r.ch, (v) => { r.ch = num(v); }, { cls: 'num ch', type: 'number' }),
      inp(r.name, (v) => { r.name = v; }, { ph: 'Nombre del canal' }),
      del(() => { K.radios.splice(i, 1); })));
    const drr = K.drr.map((d, i) => h('div.cv-drr1',
      inp(d.offset, (v) => { d.offset = num(v); }, { cls: 'num', type: 'number', ph: '±°' }),
      inp(d.who, (v) => { d.who = v; }, { ph: 'Quién' }),
      del(() => { K.drr.splice(i, 1); })));
    const hold = [...K.holding].map((x, i) => h('tr',
      h('td', { style: { width: '80px' } }, inp(x.alt, (v) => { x.alt = num(v); }, { cls: 'num', type: 'number', ph: 'k ft' })),
      h('td', { style: { width: '42%' } }, h('select.f', { style: { width: '100%' }, onchange: (e) => { x.sq = e.target.value || null; redo(); } },
        h('option', { value: '' }, 'Texto libre'),
        pkg.squadrons.map((s) => h('option', { value: s.id, selected: x.sq === s.id }, `${s.unit || ''}${s.unit && s.name ? ' · ' : ''}${s.name || ''}` || 'Escuadrón')))),
      h('td', x.sq ? h('span.small.muted', 'su stack de Case I') : inp(x.text, (v) => { x.text = v; }, { ph: 'Tanquero, Yo-Yo…' })),
      h('td.x', del(() => { K.holding.splice(i, 1); }))));
    main.append(h('div.cv-2',
      h('div',
        h('div.card', h('div.row', { style: { marginBottom: '8px' } }, h('div.cv-title', { style: { margin: 0 } }, 'Canales de radio'), h('span.grow'),
          h('button.btn.small', { onclick: () => { K.radios.push({ ch: (K.radios.reduce((m, r) => Math.max(m, r.ch || 0), 0) + 1), name: '' }); redo(); } }, '+ canal')),
        K.radios.length ? h('div.cv-radios', radios) : h('div.cv-mini', 'Sin canales.')),
        h('div.card', h('div.row', { style: { marginBottom: '8px' } }, h('div.cv-title', { style: { margin: 0 } }, 'DRR (offset sobre el BRC → quién)'), h('span.grow'),
          h('button.btn.small', { onclick: () => { K.drr.push({ offset: null, who: '' }); redo(); } }, '+')),
        K.drr.length ? h('div.cv-drrs', drr) : h('div.cv-mini', 'Sin radiales.')),
        h('div.card', h('div.cv-title', 'Salidas y Marshal'),
          h('textarea.f', { rows: 5, value: K.deps, style: { width: '100%' }, placeholder: 'Salidas Case I / II / III, Marshal, pérdida de comunicaciones…', onchange: (e) => { K.deps = e.target.value; save(); } }),
          h('div.cv-grid.c2', { style: { marginTop: '10px' } },
            field('Tanker Hawk · día', K.hawkDay, (v) => { K.hawkDay = v; }),
            field('Tanker Hawk · noche', K.hawkNight, (v) => { K.hawkNight = v; })))),
      h('div.card', h('div.row', { style: { marginBottom: '6px' } }, h('div.cv-title', { style: { margin: 0 } }, 'Alturas de espera (stack Case I)'), h('span.grow'),
        h('button.btn.small', { onclick: () => { K.holding.push({ alt: null, sq: null, text: '' }); redo(); } }, '+ fila')),
      h('div.cv-mini', { style: { marginBottom: '8px' } }, 'Miles de ft. En cada fila eliges un escuadrón (de ahí sale su stack) o escribes un texto.'),
      K.holding.length ? h('table.t.cv', h('tbody', hold)) : h('div.cv-mini', 'Sin alturas.'))));
  }

  // ---------------------------------------------------------------- Ladders
  if (sub === 'ladders') {
    const dl = h('datalist#cvAircraft', (lib.aircraft || []).map((a) => h('option', { value: a })));
    if (!pkg.ladders.find((l) => l.id === ladderId)) ladderId = (pkg.ladders[0] || {}).id || null;
    const L = pkg.ladders.find((l) => l.id === ladderId);
    main.append(dl, h('div.card', h('div.cv-chips',
      h('span.small.muted', 'Ladder de'),
      pkg.ladders.map((l) => h('button.cv-chip', { className: `cv-chip${l.id === ladderId ? ' sel' : ''}`, onclick: () => { ladderId = l.id; render(); } }, l.label || l.aircraft || 'Sin nombre')),
      h('button.cv-chip.add', { onclick: () => {
        const l = { id: newId('l'), aircraft: '', label: '', min: '', ff: null, aoa: '', tt: { day: null, night: null }, pattern: { c1: null, c3: null }, columns: ['Case I', 'Case II / III'], rows: [{ label: 'On the Ball', offset: null, values: [null, null] }], fuel: [] };
        pkg.ladders.push(l); ladderId = l.id; redo();
      } }, '+ Añadir avión'))));
    if (L) {
      const cols = L.columns;
      const rows = L.rows.map((r, i) => h('tr',
        h('td', inp(r.label, (v) => { r.label = v; }, { ph: 'Fila' })),
        h('td', { style: { width: '90px' } }, inp(r.offset, (v) => { r.offset = v === '' ? null : num(v); }, { cls: 'num', type: 'number', ph: '—' })),
        cols.map((_, c) => h('td', inp(r.values[c], (v) => { r.values[c] = num(v); }, { cls: 'num', ph: '—' }))),
        h('td.x', del(() => { L.rows.splice(i, 1); }))));
      const fuel = fuelTotals(L).map((f, i) => h('tr',
        h('td', inp(L.fuel[i].label, (v) => { L.fuel[i].label = v; }, { ph: 'Interno, 1 EXT…' })),
        h('td', inp(L.fuel[i].qty, (v) => { L.fuel[i].qty = num(v); }, { cls: 'num', ph: '—', redraw: true })),
        h('td.calc', f.total.toFixed(1)),
        h('td.x', del(() => { L.fuel.splice(i, 1); }))));
      main.append(h('div.cv-2.wide',
        h('div.card',
          h('div.row', { style: { marginBottom: '8px' } }, h('div.cv-title', { style: { margin: 0 } }, L.min || 'Ladder'), h('span.small.muted', 'miles de lb'), h('span.grow'),
            h('button.btn.small', { onclick: async () => { const n = await askText({ title: 'Columna nueva del ladder', placeholder: 'Por ejemplo, Case II / III', action: 'Añadir', check: () => null }); if (n && n.trim()) { L.columns.push(n.trim()); L.rows.forEach((r) => r.values.push(null)); redo(); } } }, '+ columna'),
            h('button.btn.small', { onclick: () => { L.rows.push({ label: '', offset: null, values: cols.map(() => null) }); redo(); } }, '+ fila')),
          h('table.t.cv', h('thead', h('tr', h('th', 'Fila'), h('th', 'Min antes del recovery'),
            cols.map((c, ci) => h('th', h('input.f.colname', { value: c, onchange: (e) => { L.columns[ci] = e.target.value; save(); } }),
              cols.length > 1 ? h('button.cv-x', { title: 'Quitar la columna', onclick: () => { L.columns.splice(ci, 1); L.rows.forEach((r) => r.values.splice(ci, 1)); redo(); } }, '✕') : null)), h('th'))),
          h('tbody', rows)),
          h('div.row', { style: { marginTop: '10px' } },
            h('button.btn.small', { onclick: () => {
              if (L.ff == null) { alert('Pon antes el FF de cada 15′.'); return; }
              if (L.rows.length > 1 && !confirm('Se rehacen las filas a partir de «On the Ball» sumando el FF cada 15′. ¿Seguir?')) return;
              fillLadder(L); redo();
            } }, 'Rellenar desde On the Ball con el FF'),
            h('span.cv-mini', '«Min antes del recovery» vacío = On the Ball (sin hora).'))),
        h('div',
          h('div.card', h('div.cv-title', 'Datos del avión'), h('div.cv-grid.c2',
            field('Avión (módulo de DCS)', L.aircraft, (v) => { L.aircraft = v.trim(); }, { list: 'cvAircraft' }),
            field('Nombre en pantalla', L.label, (v) => { L.label = v; }, { ph: 'F/A-18C' }),
            field('Nombre del mínimo', L.min, (v) => { L.min = v; }, { ph: 'TANK + 2' }),
            field('FF cada 15′ (k lb)', L.ff, (v) => { L.ff = num(v); }),
            field('AoA max endurance', L.aoa, (v) => { L.aoa = v; }),
            field('Trick or Treat · día', L.tt.day, (v) => { L.tt.day = num(v); }),
            field('Trick or Treat · noche', L.tt.night, (v) => { L.tt.night = num(v); }),
            field('Circuito Case I (k lb)', L.pattern.c1, (v) => { L.pattern.c1 = num(v); }),
            field('Circuito Case III (k lb)', L.pattern.c3, (v) => { L.pattern.c3 = num(v); })),
          h('div.row', { style: { marginTop: '10px' } }, h('span.grow'), h('button.btn.small.danger', { onclick: () => { if (confirm('¿Borrar este ladder?')) { pkg.ladders = pkg.ladders.filter((x) => x !== L); ladderId = null; redo(); } } }, 'Borrar ladder'))),
          h('div.card', h('div.row', { style: { marginBottom: '6px' } }, h('div.cv-title', { style: { margin: 0 } }, 'Combustible (k lb)'), h('span.grow'),
            h('button.btn.small', { onclick: () => { L.fuel.push({ label: '', qty: null }); redo(); } }, '+ fila')),
          L.fuel.length ? h('table.t.cv', h('thead', h('tr', h('th'), h('th', 'Cantidad'), h('th', 'Total'), h('th'))), h('tbody', fuel)) : h('div.cv-mini', 'Sin datos de combustible.')))));
    } else {
      main.append(h('div.card.cv-mini', 'Todavía no hay ladders. «+ Añadir avión» crea uno; el escuadrón que vuele ese módulo lo usará.'));
    }
  }
}
