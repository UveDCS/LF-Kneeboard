// Tarjeta de vuelo (line-up card) y nav log, generados con la misión al estilo CombatFlite.
// Se pueden añadir pilotos y frecuencias, guardar las páginas en el Piernógrafo y compartir la tarjeta con el vuelo.
import { icon } from '../icons.js';
import { h, clear, emptyState, hms, dur, deg, nm, ft, freq } from '../util.js';
import { computeLegs } from './mission.js';

const LB = 2.20462;
const ROWS = 14;
const SAVED_SET = 'Tarjetas de vuelo';

function targetPoint(route) {
  return route.find((w) => w.tgt) || route.find((w) => (w.tasks || []).some((t) => /Bomb|Attack|Engage/.test(t)))
    || route.find((w) => /\b(tgt|target|obj|objetivo|blanco)\b/i.test(w.name || '')) || null;
}

function dateText(d) {
  return d && d.d ? `${String(d.d).padStart(2, '0')}/${String(d.m).padStart(2, '0')}/${d.y}` : '';
}

export const cards = {
  icon: 'card',
  label: 'Tarjeta de vuelo y nav log',
  create(ctx, tab) {
    const el = h('div');
    let page = 0;
    let data = {};
    let capturing = false;
    let saved = [];
    const key = () => `cards:${(ctx.S.mission && (ctx.S.mission.name || ctx.S.mission.file)) || 'sin-mision'}`;
    let loadedKey = null;

    async function load() {
      const k = key();
      if (k === loadedKey) return;
      loadedKey = k;
      data = (await ctx.kb.storeGet(k)) || {};
      // La v1 tenía las «otras frecuencias» en un solo campo de texto: pasa a la lista.
      if (data.comms && !Array.isArray(data.commsList)) data.commsList = [{ name: data.comms, freq: '', notes: '' }];
      render();
    }
    const save = () => ctx.kb.storeSet(loadedKey, data);

    function field(k, placeholder, opts = {}) {
      const tag = opts.area ? 'textarea.f' : 'input.f';
      const el2 = h(tag, { value: data[k] ?? opts.value ?? '', placeholder, rows: opts.area || undefined, style: { fontSize: '.82rem' } });
      el2.addEventListener('input', () => { data[k] = el2.value; save(); });
      return el2;
    }

    // Campo dentro de un elemento de una lista (pilotos añadidos, frecuencias…)
    function cell(obj, k, placeholder, width) {
      const el2 = h('input.f', { value: obj[k] || '', placeholder, style: { fontSize: '.8rem', padding: '.2rem .35rem', width: width || '100%' } });
      el2.addEventListener('input', () => { obj[k] = el2.value; save(); });
      return el2;
    }

    const navPages = (m) => Math.max(1, Math.ceil(m.route.length / ROWS));
    const savedPage = (m) => 1 + navPages(m);

    function lineup(m) {
      const Geo = ctx.Geo;
      const type = (m.unit && m.unit.type) || ctx.aircraft();
      const plan = ctx.S.config.plan || {};
      const reserve = Number((plan.reserveLb || {})[type]) || 0;
      const burn = Number((plan.burnPerNm || {})[type]) || 0;
      const joker = Number((plan.jokerLb || {})[type]) || 0;
      const tgt = targetPoint(m.route);
      const homeFromTgt = tgt && m.arrival && tgt.lat != null ? Geo.distanceNm(tgt, m.arrival) : null;
      const bingo = burn && homeFromTgt != null ? Math.round((reserve + homeFromTgt * burn) / 100) * 100 : null;
      data.pilots = data.pilots || [];
      data.commsList = data.commsList || [];

      const flightBody = h('tbody',
        m.flight.map((u, i) => h('tr', { className: u.me ? 'hl' : '' },
          h('td', i + 1), h('td', u.callsign || u.name), h('td', u.type), h('td', u.onboard || ''),
          h('td', u.laser || ''), h('td', u.stn || ''), h('td.txt', field(`pilot${i}`, u.player ? 'jugador' : 'IA')), h('td'))),
        data.pilots.map((p, j) => h('tr',
          h('td', m.flight.length + j + 1),
          h('td', cell(p, 'callsign', 'Indicativo')), h('td', cell(p, 'type', 'Avión')), h('td', cell(p, 'onboard', 'Cola', '3.4rem')),
          h('td', cell(p, 'laser', 'Láser', '3.6rem')), h('td', cell(p, 'stn', 'STN', '3.8rem')), h('td.txt', cell(p, 'pilot', 'Piloto')),
          h('td', h('button.btn.small', { title: 'Quitar', onclick: () => { data.pilots.splice(j, 1); save(); render(); } }, icon('close'))))));

      const commsBody = h('tbody',
        m.groupFreq ? h('tr', h('td.txt', 'Intravuelo'), h('td', m.groupFreq.text), h('td'), h('td')) : null,
        m.support.slice(0, 4).map((s) => h('tr', h('td.txt', `${s.callsign} (${s.kind})`), h('td', s.freq || ''), h('td', s.tacan || ''), h('td'))),
        [m.departure, m.arrival].filter(Boolean).filter((b, i, a) => a.indexOf(b) === i).map((b) => h('tr', h('td.txt', `${b.name} TWR`), h('td', [b.vhf && freq(b.vhf), b.uhf && freq(b.uhf)].filter(Boolean).join(' / ')), h('td', b.tacan || ''), h('td'))),
        data.commsList.map((c, j) => h('tr',
          h('td.txt', cell(c, 'name', 'Quién (p. ej. Darkstar)')), h('td', cell(c, 'freq', 'MHz', '5.2rem')), h('td', cell(c, 'notes', 'TACAN / CH', '6rem')),
          h('td', h('button.btn.small', { title: 'Quitar', onclick: () => { data.commsList.splice(j, 1); save(); render(); } }, icon('close'))))));

      el.append(
        h('div.h1', 'Tarjeta de vuelo', h('small', [m.name, dateText(m.date), m.startTimeText ? `${m.startTimeText} L` : '', m.theatre].filter(Boolean).join(' · '))),
        h('div.grid2',
          h('div.card',
            h('div.label', 'Misión'),
            h('div.field', h('label', 'Paquete / indicativo'), field('package', 'p. ej. DAGGER')),
            h('div.field', h('label', 'Tarea'), field('task', 'CAS, SEAD, CAP…', { value: m.task && m.task !== 'Nothing' ? m.task : '' })),
            h('div.grid2', h('div.field', h('label', 'Abortar'), field('abort', 'código')), h('div.field', h('label', 'Push / TOT'), field('tot', 'hh:mm', { value: totOf(m, tgt) })))),
          h('div.card',
            h('div.label', 'Combustible'),
            h('div.kv',
              h('span', 'Inicial'), h('span', m.unit && m.unit.fuelKg != null ? `${Math.round(m.unit.fuelKg * LB).toLocaleString('es-ES')} lb` : '—'),
              h('span', 'Bingo'), h('span', bingo != null ? `${bingo.toLocaleString('es-ES')} lb` : '—'),
              h('span', 'Joker'), h('span', bingo != null && joker ? `${(bingo + joker).toLocaleString('es-ES')} lb` : '—'),
              h('span', 'Casa desde blanco'), h('span', homeFromTgt != null ? `${nm(homeFromTgt)} nm` : '—')),
            h('div.field', { style: { marginTop: '.4rem' } }, h('label', 'Bingo / joker acordados'), field('fuel', 'p. ej. 4.0 / 6.0')))),
        h('div.card',
          h('div.card-row', h('div.label', 'Vuelo'), h('span.bar-spacer'),
            h('button.btn.small', { onclick: () => { data.pilots.push({}); save(); render(); } }, icon('plus'), ' Añadir piloto')),
          h('table.tbl',
            h('thead', h('tr', h('th', '#'), h('th', 'Indicativo'), h('th', 'Avión'), h('th', 'Cola'), h('th', 'Láser'), h('th', 'STN'), h('th', 'Piloto'), h('th'))),
            flightBody)),
        h('div.card',
          h('div.card-row', h('div.label', 'Comunicaciones'), h('span.bar-spacer'),
            h('button.btn.small', { onclick: () => { data.commsList.push({}); save(); render(); } }, icon('plus'), ' Añadir frecuencia')),
          h('table.tbl', h('thead', h('tr', h('th', 'Quién'), h('th', 'MHz'), h('th', 'TACAN / otros'), h('th'))), commsBody)),
        h('div.grid2',
          h('div.card',
            h('div.label', 'Cargamento'),
            m.loadout.length
              ? h('table.tbl', h('tbody', m.loadout.map((p) => h('tr', h('td', { style: { width: '2rem' } }, p.station), h('td.txt', { style: { fontSize: '.74rem' } }, p.name)))))
              : h('div.muted', 'Sin cargamento en la misión')),
          h('div',
            h('div.card', h('div.label', 'Salida'), baseKv(m.departure)),
            h('div.card', h('div.label', 'Llegada'), baseKv(m.arrival)))),
        dtcCard(m),
        h('div.card', h('div.label', 'Notas'), field('notes', 'Coordinación, amenazas, palabras clave…', { area: 3 })),
      );
    }

    // Hora sobre el objetivo si el plan la fija (DTC o misión).
    function totOf(m, tgt) {
      if (!tgt) return '';
      const t = tgt.tos != null ? tgt.tos : tgt.etaLocked && tgt.eta > 0 ? (m.startTime || 0) + tgt.eta : null;
      return t != null ? hms(t, false).slice(0, 5) : '';
    }

    // Del DTC: contramedidas (programas manuales), avisos de bingo y objetivos de JDAM.
    function dtcCard(m) {
      const d = m.dtc;
      if (!d) return ''; // va dentro de append(): con null saldría el texto «null»
      const man = d.cmds ? d.cmds.programs.filter((p) => /^(MAN|PROG)/.test(p.id) && (p.chaff || p.flare)) : [];
      const jd = d.jdam ? d.jdam.stations.flatMap((s) => s.targets.filter((t) => t.active).map((t) => ({ ...t, station: s.station }))) : [];
      return h('div.card',
        h('div.card-row', h('div.label', 'DTC'), h('b', d.name), h('span.muted', `${d.aircraft} · ${d.terrain || 'sin mapa'}`)),
        man.length ? h('table.tbl', { style: { marginTop: '.3rem' } },
          h('thead', h('tr', h('th', 'Programa'), h('th.num-r', 'Chaff'), h('th.num-r', 'Bengalas'))),
          h('tbody', man.map((p) => h('tr', h('td', p.name), h('td.num-r', p.chaff ? p.chaff.text : '—'), h('td.num-r', p.flare ? p.flare.text : '—'))))) : null,
        d.cmds && d.cmds.bingo ? h('div.muted', { style: { fontSize: '.72rem', marginTop: '.3rem' } }, `Aviso de bingo: ${d.cmds.bingo.chaff ?? '—'} chaff · ${d.cmds.bingo.flare ?? '—'} bengalas`) : null,
        jd.length ? h('div', { style: { marginTop: '.3rem' } }, h('div.label', 'JDAM'), h('table.tbl', h('tbody', jd.map((t) => h('tr',
          h('td', `Est. ${t.station} · ${t.n}`), h('td.txt', t.name || '—'),
          h('td.num-r', t.dropAltFt != null ? `${Math.round(t.dropAltFt).toLocaleString('es-ES')} ft` : ''), h('td.num-r', t.dropKt != null ? `${Math.round(t.dropKt)} kt` : '')))))) : null);
    }

    function baseKv(b) {
      if (!b) return h('div.muted', '—');
      return h('div.kv', h('span', 'Aeródromo'), h('span', b.name),
        h('span', 'Torre'), h('span', [b.vhf && freq(b.vhf), b.uhf && freq(b.uhf)].filter(Boolean).join(' / ') || '—'),
        h('span', 'TACAN'), h('span', b.tacan || '—'),
        h('span', 'Pistas'), h('span', (b.runways || []).map((r) => r.name).join(' · ') || '—'));
    }

    function navlog(m, p) {
      const legs = computeLegs(m, ctx);
      let acc = 0;
      const rows = legs.map((l) => { acc += l.dist || 0; return { ...l, acc }; });
      const slice = rows.slice((p - 1) * ROWS, p * ROWS);
      const anyFuel = rows.some((l) => l.fuelLb != null);
      el.append(
        h('div.h1', 'Nav log', h('small', `${m.unit ? m.unit.callsign || m.unit.name : ''} · ${m.unit ? m.unit.type : ''} · rumbos magnéticos (${ctx.magvar() >= 0 ? '+' : ''}${ctx.magvar()}°)`)),
        h('table.tbl',
          h('thead', h('tr', h('th', 'WP'), h('th', 'Punto'), h('th.num-r', 'Alt ft'), h('th.num-r', 'Kt'), h('th.num-r', '°M'), h('th.num-r', 'NM'), h('th.num-r', 'Acum'), h('th.num-r', 'ETE'), h('th.num-r', 'ETA'), anyFuel ? h('th.num-r', 'Comb.') : null, h('th', 'Notas'))),
          h('tbody', slice.map((l) => h('tr',
            h('td', l.idx),
            h('td.txt', l.name || h('span.muted', l.typeText)),
            h('td.num-r', l.altM != null ? `${ft(l.altM)}${l.altType === 'AGL' ? ' R' : ''}` : ''),
            h('td.num-r', l.speed ? Math.round(l.speed * 1.943844) : ''),
            h('td.num-r', l.crs != null ? deg(l.crs) : ''),
            h('td.num-r', l.dist != null ? nm(l.dist) : ''),
            h('td.num-r', l.idx ? nm(l.acc) : ''),
            h('td.num-r', l.legSec != null ? dur(l.legSec) : ''),
            h('td.num-r', hms(l.etaTod, false)),
            anyFuel ? h('td.num-r', l.fuelLb != null ? Math.round(l.fuelLb).toLocaleString('es-ES') : '') : null,
            h('td.txt', { style: { minWidth: '7rem' } }, field(`wp${l.idx}`, '')))))),
        h('div.muted', { style: { fontSize: '.75rem', marginTop: '.5rem' } }, `Total ${nm(acc)} nm${legs.length ? ` · ${hms(legs[legs.length - 1].etaTod, false)} en el último punto` : ''}`),
      );
    }

    // Tarjetas guardadas: las páginas del juego «Tarjetas de vuelo» del Piernógrafo, agrupadas por misión.
    async function loadSaved() {
      const st = await ctx.kb.library.status();
      const set = (st.sets || []).find((s) => s.name === SAVED_SET);
      const groups = new Map();
      for (const p of (set && set.pages) || []) {
        const base = p.file.replace(/-\d{3}\.\w+$/, '');
        if (!groups.has(base)) groups.set(base, []);
        groups.get(base).push(p);
      }
      saved = [...groups.entries()].map(([name, pages]) => ({ name, pages }));
    }

    function savedView() {
      el.append(h('div.h1', 'Tarjetas guardadas', h('small', 'También salen en el Piernógrafo del avión')));
      if (!saved.length) {
        el.append(h('div.card.muted', 'Todavía no has guardado ninguna. En la tarjeta, pulsa «Guardar en el Piernógrafo».'));
        return;
      }
      for (const g of saved) {
        el.append(h('div.card',
          h('div.card-row', h('b', g.name), h('span.muted', `${g.pages.length} páginas`), h('span.bar-spacer'),
            h('button.btn.small', { title: 'Mover a la papelera', onclick: async () => {
              if (!confirm(`¿Borrar la tarjeta «${g.name}»?`)) return;
              await ctx.kb.library.trashFiles(g.pages.map((p) => p.path));
              await loadSaved();
              render();
            } }, icon('trash'))),
          h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '.5rem', marginTop: '.5rem' } },
            g.pages.map((p) => h('img', { src: p.url, title: 'Ver', style: { width: '100%', borderRadius: '.35rem', cursor: 'zoom-in', boxShadow: '0 .1rem .4rem rgba(0,0,0,.35)' },
              onclick: () => showImage(p.url) })))));
      }
    }

    function showImage(url) {
      const v = h('div', { style: { position: 'absolute', inset: 0, zIndex: 7, background: 'rgba(0,0,0,.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out' }, onclick: () => v.remove() },
        h('img', { src: url, style: { maxWidth: '96%', maxHeight: '96%' } }));
      el.append(v);
    }

    function render() {
      clear(el);
      const m = ctx.S.mission;
      if (!m || !m.unit) return el.append(emptyState(icon('card'), 'Tarjeta de vuelo', 'Se genera con la misión: abre una en DCS o carga un .miz en Ajustes > Misión.'));
      if (page === 0) lineup(m);
      else if (page < savedPage(m)) navlog(m, page);
      else savedView();
      if (!capturing && page < savedPage(m)) {
        el.prepend(h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '.4rem', marginBottom: '.3rem' } },
          h('button.btn.small', { title: 'Ver las tarjetas guardadas', onclick: () => ctx.goToPage(savedPage(m)) }, icon('bookmarks'), ' Guardadas'),
          h('button.btn.small', { title: 'Guarda la tarjeta y el nav log como páginas del Piernógrafo (para DCS o el .miz)', onclick: exportPages }, icon('library'), ' Guardar en el Piernógrafo')));
      }
    }

    async function exportPages() {
      const m = ctx.S.mission;
      const total = savedPage(m);
      const keep = page;
      const urls = [];
      capturing = true;
      try {
        for (let p = 0; p < total; p++) {
          page = p;
          render();
          el.scrollTop = 0;
          await new Promise((r) => setTimeout(r, 250));
          const r = el.getBoundingClientRect();
          urls.push(await ctx.kb.captureRect({ x: r.left, y: r.top, width: r.width, height: Math.min(r.height, el.scrollHeight) }));
        }
      } finally {
        capturing = false;
        page = keep;
        render();
      }
      const base = (m.name || 'Mision').replace(/[<>:"/\\|?*]/g, '').slice(0, 40);
      await ctx.kb.library.savePages(SAVED_SET, base, urls, { aircraft: m.unit.type, replace: true });
      await loadSaved();
      ctx.toast(`${urls.length} páginas guardadas («${SAVED_SET}»)`);
    }

    load();
    loadSaved();
    return {
      el,
      pages: () => (ctx.S.mission ? savedPage(ctx.S.mission) + 1 : 1),
      show(p) {
        page = p;
        if (ctx.S.mission && p === savedPage(ctx.S.mission)) loadSaved().then(render);
        load().then(render);
        render();
      },
      title: (p) => (p === 0 ? 'Tarjeta de vuelo' : ctx.S.mission && p >= savedPage(ctx.S.mission) ? 'Tarjetas guardadas' : 'Nav log'),
      onMission: () => { load(); render(); },
      onConfig: render,
      onLibrary: () => loadSaved().then(() => { if (ctx.S.mission && page === savedPage(ctx.S.mission)) render(); }),
      // Compartir: además de la imagen, el vuelo recibe los datos para copiarlos en su tarjeta.
      shareData: () => ({ kind: 'card', label: 'Copiar a mi tarjeta', payload: { ...data } }),
      applyShared(payload) {
        const keepPilots = data.pilots || [];
        data = { ...payload, pilots: payload.pilots || keepPilots };
        save();
        render();
        ctx.toast('Tarjeta del vuelo copiada en la tuya');
      },
    };
  },
};
