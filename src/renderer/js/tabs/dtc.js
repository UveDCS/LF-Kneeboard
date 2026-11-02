// DTC: lo que lleva el cartucho de datos de tu avión (F-16C, F/A-18C, F-14), página a página:
// resumen y revisión antes de despegar, contramedidas, amenazas (MEZ, RWR, HARM) y armamento (JDAM, VIP/VRP).
// Desde aquí se importa un DTC, se elige otro o se envía al vuelo.
import { icon } from '../icons.js';
import { h, clear, emptyState, hms, nm, ft } from '../util.js';

const ORIGIN = {
  elegido: 'elegido por ti',
  misión: 'el que trae la misión',
  DKS: 'el de DKS (*_OB)',
  reciente: 'el más reciente de este avión (solo radios)',
  'guardado en DCS': 'el que acabas de guardar o cargar en DCS',
  'editor del juego': 'el del editor de DTC del juego (sin guardar)',
};
const LEVEL = { error: 'Revisa', warn: 'Ojo', info: 'Nota', ok: 'Bien' };

export const dtc = {
  icon: 'cartridge',
  label: 'DTC: contramedidas, amenazas, rutas y revisión',
  create(ctx, tab) {
    const el = h('div');
    let page = 0;
    let files = null;

    const d = () => ctx.S.mission && ctx.S.mission.dtc;
    const type = () => (ctx.S.mission && ctx.S.mission.unit && ctx.S.mission.unit.type) || ctx.aircraft();

    // Páginas que tienen algo que enseñar.
    function pageList() {
      const x = d();
      if (!x) return ['resumen'];
      const out = ['resumen'];
      if (x.cmds && x.cmds.programs.length) out.push('cmds');
      if (x.threats.length || x.rwr || x.harm) out.push('amenazas');
      if ((x.jdam && x.jdam.any) || x.vip) out.push('armamento');
      return out;
    }

    async function chooser() {
      if (!files) files = await ctx.kb.dtcList();
      const t = type();
      const cur = (ctx.S.config.dtc || {})[t] || '';
      return h('select.f', { style: { maxWidth: '100%', fontSize: '.78rem' }, onchange: (e) => ctx.kb.dtcUse(t, e.target.value || null) },
        h('option', { value: '' }, 'Automático (misión, DKS o el más reciente)'),
        h('option', { value: 'mision', selected: cur === 'mision' }, 'Ninguno: presets y ruta de la misión'),
        files.map((f) => h('option', { value: f.file, selected: cur === f.file }, `${f.aircraft} / ${f.name}`)));
    }

    function actions() {
      return h('div.card-row', { style: { gap: '.4rem', flexWrap: 'wrap' } },
        h('button.btn.small.primary', { onclick: async () => { const r = await ctx.kb.dtcImport(); if (r && !r.error) { files = null; } } }, icon('importFile'), ' Importar DTC…'),
        d() ? h('button.btn.small', { onclick: () => ctx.kb.dtcShare() }, icon('send'), ' Enviar al vuelo') : null);
    }

    async function resumen(x) {
      el.append(h('div.h1', `DTC ${x.name}`, h('small', [x.aircraft, x.terrain].filter(Boolean).join(' · ')), h('span.tag', ORIGIN[x.origin] || x.origin || '')));
      el.append(actions(), h('div.card-row', { style: { margin: '.4rem 0' } }, h('span.muted', { style: { fontSize: '.75rem' } }, 'Usar:'), await chooser()));
      if (x.review && x.review.length) {
        el.append(h('div.card', h('div.label', 'Revisión antes de despegar'),
          x.review.map((r) => h('div.review', { className: `review ${r.level}` }, h('span.tag', LEVEL[r.level] || r.level), h('span', r.text)))));
      }
      for (const r of x.routes) {
        el.append(h('div.h2', r.name, h('small', ` · ${r.points.length} punto${r.points.length === 1 ? '' : 's'}${r === x.routes[0] && x.useRoute ? ' · la usa el plan de vuelo' : ''}`)),
          h('table.tbl',
            h('thead', h('tr', h('th', 'WP'), h('th', 'Nombre'), h('th.num-r', 'Alt ft'), h('th.num-r', 'Kt'), h('th.num-r', 'Hora'))),
            h('tbody', r.points.slice(0, 14).map((p) => h('tr',
              h('td', p.num), h('td.txt', p.name || h('span.muted', '—'), p.tgt ? h('span.tag.tgt', 'obj') : null),
              h('td.num-r', p.altM != null ? ft(p.altM) : ''), h('td.num-r', p.speedKt || ''),
              h('td.num-r', p.fixed ? h('span.tag.fix', 'fija') : null, ' ', p.tos != null ? hms(p.tos, false) : ''))))));
      }
      const n = x.nav;
      if (n) {
        el.append(h('div.card', h('div.label', 'Navegación'), h('div.kv',
          h('span', 'TACAN'), h('span', n.tacan || 'apagado'),
          h('span', 'ICLS / ACLS'), h('span', [n.icls, n.acls].filter(Boolean).join(' · ') || 'apagados'),
          h('span', 'WP de casa'), h('span', n.home != null ? `WP${n.home}` : '—'),
          h('span', 'WP A/A (bullseye)'), h('span', n.aaWp != null ? `WP${n.aaWp}` : 'sin activar'),
          h('span', 'Aviso de altura'), h('span', `${n.altWarnBaroFt ?? '—'} ft baro · ${n.altWarnRdrFt ?? '—'} ft radar`))));
      }
      if (x.tis) el.append(h('div.card', h('div.label', 'TIS (enlace de datos)'), h('div.kv', h('span', 'Indicativo'), h('span', x.tis.missionCallsign ? 'el de la misión' : x.tis.ownCallsign || '—'))));
      el.append(h('div.muted', { style: { fontSize: '.72rem', marginTop: '.5rem', lineHeight: 1.4 } },
        'Las radios, la ruta y las líneas del mapa salen de este DTC. Para tenerlo en el avión, cárgalo en cabina desde la página DTC (los importados se copian a Saved Games\\DCS\\DTC).'));
    }

    function cmds(x) {
      const c = x.cmds;
      el.append(h('div.h1', 'Contramedidas', h('small', x.aircraft)));
      el.append(h('table.tbl',
        h('thead', h('tr', h('th', 'Programa'), h('th.num-r', 'Chaff'), h('th', ''), h('th.num-r', 'Bengalas'), h('th', ''))),
        h('tbody', c.programs.map((p) => h('tr', { className: p.chaff || p.flare ? '' : 'done' },
          h('td', h('b', p.name)),
          h('td.num-r', p.chaff ? p.chaff.text : '—'), h('td.txt.muted', { style: { fontSize: '.7rem' } }, p.chaff ? p.chaff.detail : ''),
          h('td.num-r', p.flare ? p.flare.text : '—'), h('td.txt.muted', { style: { fontSize: '.7rem' } }, p.flare ? p.flare.detail : ''))))));
      const extra = [];
      if (c.bingo) extra.push(`Aviso de bingo: ${c.bingo.chaff ?? '—'} chaff y ${c.bingo.flare ?? '—'} bengalas`);
      if (c.delay) extra.push(`${c.delay} s entre programas`);
      if (extra.length) el.append(h('div.muted', { style: { fontSize: '.75rem', margin: '.4rem 0' } }, extra.join(' · ')));
      if (c.auto.length) {
        const by = new Map();
        for (const a of c.auto) {
          const k = a.program;
          if (!by.has(k)) by.set(k, []);
          by.get(k).push(a);
        }
        el.append(h('div.h2', 'Programa automático según la amenaza'),
          h('div.muted', { style: { fontSize: '.72rem', marginBottom: '.4rem' } }, 'Número de programa tal como lo guarda el DTC para cada amenaza (las que no tienen programa no salen).'));
        for (const [prog, list] of [...by.entries()].sort((a, b) => a[0] - b[0])) {
          const names = list.map((a) => a.threat);
          el.append(h('div.card', { style: { padding: '.4rem .6rem' } },
            h('div.card-row', h('b', `Programa ${prog}`), h('span.muted', `${list.length} amenaza${list.length > 1 ? 's' : ''}`)),
            h('div', { style: { fontSize: '.72rem', lineHeight: 1.4 } }, names.slice(0, 14).join(' · '), names.length > 14 ? h('span.muted', ` y ${names.length - 14} más`) : null)));
        }
      }
    }

    function amenazas(x) {
      el.append(h('div.h1', 'Amenazas', h('small', x.aircraft)));
      if (x.threats.length) {
        el.append(h('table.tbl',
          h('thead', h('tr', h('th', '#'), h('th', 'Amenaza'), h('th.num-r', 'Radio'), h('th', 'Posición'))),
          h('tbody', x.threats.map((t) => {
            const f = t.lat != null ? ctx.Geo.formatPoint({ lat: t.lat, lon: t.lon }, ctx.aircraft())[0] : null;
            return h('tr', h('td', t.num ?? ''), h('td.txt', t.label, t.type && t.type !== 'Custom' ? h('span.muted', ` · ${t.type}`) : null),
              h('td.num-r', t.radiusNm ? `${nm(t.radiusNm)} nm` : ''), h('td.txt.mono', { style: { fontSize: '.7rem' } }, f ? f.v : ''));
          }))),
          h('div.muted', { style: { fontSize: '.72rem', margin: '.3rem 0 .6rem' } }, 'Salen también en el Mapa, con su burbuja.'));
      }
      if (x.rwr) {
        el.append(h('div.h2', 'Prioridades del RWR'));
        el.append(h('div', { className: x.rwr.modes.length > 1 ? 'grid2' : '' }, x.rwr.modes.slice(0, 4).map((m) => h('div.card', { style: { padding: '.4rem .6rem' } },
          h('div.label', m.name),
          h('ol.rwr', m.top.slice(0, 8).map((t) => h('li', t.name))),
          m.hidden.length ? h('div.muted', { style: { fontSize: '.7rem' } }, `Ocultas: ${m.hidden.slice(0, 6).join(', ')}${m.hidden.length > 6 ? '…' : ''}`) : null))));
      }
      if (x.harm) {
        el.append(h('div.h2', 'HARM: clases de amenaza', h('small', x.harm.defaultClass != null ? ` · clase por defecto ${x.harm.defaultClass}` : '')));
        el.append(h('table.tbl', h('tbody', x.harm.classes.map((c) => h('tr', h('td', { style: { width: '3rem' } }, h('b', c.cls)),
          h('td.txt', { style: { fontSize: '.72rem' } }, c.names.slice(0, 10).join(' · '), c.names.length > 10 ? h('span.muted', ` y ${c.names.length - 10} más`) : null))))));
      }
    }

    function armamento(x) {
      el.append(h('div.h1', 'Armamento', h('small', x.aircraft)));
      if (x.jdam && x.jdam.any) {
        el.append(h('div.h2', 'JDAM: objetivos por estación'));
        el.append(h('table.tbl',
          h('thead', h('tr', h('th', 'Est.'), h('th', 'Objetivo'), h('th.num-r', 'Lanz. ft'), h('th.num-r', 'Kt'), h('th.num-r', 'Impacto'), h('th.num-r', 'Alcance'))),
          h('tbody', x.jdam.stations.flatMap((s) => s.targets.map((t) => h('tr', { className: t.active ? '' : 'done' },
            h('td', `${s.station}·${t.n}`), h('td.txt', t.name || '—', t.active ? null : h('span.muted', ' (inactivo)')),
            h('td.num-r', t.dropAltFt != null ? Math.round(t.dropAltFt).toLocaleString('es-ES') : ''), h('td.num-r', t.dropKt ?? ''),
            h('td.num-r', [t.impactAngle != null ? `${t.impactAngle}°` : '', t.impactHeading != null ? `rumbo ${t.impactHeading}°` : ''].filter(Boolean).join(' · ') || '—'),
            h('td.num-r', t.rminNm != null ? `${nm(t.rminNm)}–${nm(t.rmaxNm)} nm` : '')))))));
      }
      if (x.vip) {
        el.append(h('div.h2', 'VIP / VRP'));
        for (const v of x.vip) {
          const leg = (l) => (l ? `${l.bearing ?? '—'}° · ${l.range ?? '—'} · elev. ${l.elev ?? '—'}` : '—');
          el.append(h('div.card', h('div.label', `${v.kind} en el STPT ${v.stpt ?? '—'}`),
            h('div.kv', h('span', v.kind === 'VIP' ? 'VIP → objetivo' : 'Objetivo → VRP'), h('span.mono', leg(v.toTgt)),
              v.toPup ? h('span', 'Hasta el pop-up') : null, v.toPup ? h('span.mono', leg(v.toPup)) : null)));
        }
      }
    }

    async function render() {
      clear(el);
      const x = d();
      if (!x) {
        el.append(emptyState(icon('cartridge'), 'Sin DTC',
          type() ? `No hay DTC para ${type()}. Impórtalo aquí, ponlo en la carpeta «DTC» junto al .miz de la misión o elígelo en la lista.` : 'Abre una misión en DCS o carga un .miz para ver el DTC de tu avión.'));
        if (type()) el.append(h('div', { style: { textAlign: 'center', marginTop: '.6rem' } }, actions(), h('div', { style: { marginTop: '.5rem' } }, await chooser())));
        return;
      }
      const list = pageList();
      const p = list[Math.min(page, list.length - 1)];
      if (p === 'resumen') await resumen(x);
      if (p === 'cmds') cmds(x);
      if (p === 'amenazas') amenazas(x);
      if (p === 'armamento') armamento(x);
    }

    ctx.kb.on('dtc-changed', () => { files = null; if (!el.classList.contains('hidden')) render(); });
    const NAMES = { resumen: 'Resumen', cmds: 'Contramedidas', amenazas: 'Amenazas', armamento: 'Armamento' };
    return {
      el,
      pages: () => pageList().length,
      show(p) { page = p; render(); },
      title: (p) => `DTC — ${NAMES[pageList()[Math.min(p || 0, pageList().length - 1)]]}`,
      onMission: () => { if (!el.classList.contains('hidden')) render(); },
      onConfig: () => { if (!el.classList.contains('hidden')) render(); },
    };
  },
};
