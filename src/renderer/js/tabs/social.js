// Mensajes de DCS (radio, disparadores, chat) y bandeja de lo compartido por el vuelo.
import { icon } from '../icons.js';
import { h, clear, emptyState, hms } from '../util.js';

const KINDS = [
  { id: 'all', label: 'Todo' },
  { id: 'radio', label: 'Radio' },
  { id: 'trigger', label: 'Misión' },
  { id: 'chat', label: 'Chat' },
];

export const radiolog = {
  icon: 'messages',
  label: 'Mensajes de DCS (radio, misión, chat)',
  create(ctx, tab) {
    const el = h('div');
    let filter = 'all';
    function render() {
      clear(el);
      el.append(h('div.h1', 'Mensajes'));
      el.append(h('div.chips', KINDS.map((k) => h('button.chip', { className: `chip${k.id === filter ? ' sel' : ''}`, onclick: () => { filter = k.id; render(); } }, k.label))));
      const list = ctx.S.messages.filter((m) => filter === 'all' || m.kind === filter).slice(-150).reverse();
      if (!list.length) return el.append(emptyState(icon('messages'), 'Sin mensajes', 'Aquí aparecen los mensajes de radio, los avisos de la misión y el chat mientras vuelas.'));
      for (const m of list) {
        el.append(h('div.card', { style: { padding: '.45rem .65rem' } },
          h('div.card-row', h('span.tag', m.kind), h('span.mono.muted', m.mt != null ? hms(m.mt) : '')),
          h('div', { style: { whiteSpace: 'pre-wrap', marginTop: '.25rem', userSelect: 'text' } }, m.text)));
      }
    }
    return {
      el,
      pages: () => 1,
      show: render,
      title: () => 'Mensajes',
      onMessage: () => { if (!el.classList.contains('hidden')) render(); },
    };
  },
};

export const shared = {
  icon: 'inbox',
  label: 'Compartido por el vuelo',
  create(ctx, tab) {
    const el = h('div');
    let page = 0;
    const noteIn = h('textarea.f', { rows: 3, placeholder: 'Nota rápida para el vuelo…' });

    function header() {
      const s = ctx.S.share || {};
      return h('div',
        h('div.h1', 'Vuelo compartido', h('small', s.status === 'conectado' ? `Sala con ${(s.members || []).join(', ')}` : `Sala: ${s.status || 'desconectado'}`)),
        s.status !== 'conectado'
          ? h('div.card', h('div', 'Conéctate a una sala para compartir páginas, notas, puntos y dibujos con tu vuelo.'),
            h('button.btn.primary', { style: { marginTop: '.4rem' }, onclick: () => ctx.kb.openSettings('compartir') }, 'Configurar sala'))
          : h('div.card',
            noteIn,
            h('div.card-row', { style: { marginTop: '.4rem' } },
              h('button.btn.primary', { onclick: () => {
                if (!noteIn.value.trim()) return;
                ctx.kb.shareSend({ type: 'note', title: 'Nota', text: noteIn.value.trim() }).then((ok) => { if (ok) { noteIn.value = ''; ctx.toast('Nota enviada'); } });
              } }, icon('send'), ' Enviar nota'),
              h('span.muted', { style: { fontSize: '.75rem' } }, 'Para enviar una página, pulsa el botón de enviar de la barra de abajo.'))));
    }

    function itemView(it) {
      const meta = h('div.card-row', h('b', it.from || 'Vuelo'), h('span.tag', it.type === 'page' ? 'página' : it.type === 'point' ? 'punto' : it.type === 'dtc' ? 'DTC' : 'nota'),
        h('span.muted', new Date(it.at || Date.now()).toLocaleTimeString('es-ES')));
      if (it.type === 'page') {
        // Si viene con datos (tarjeta, nombres de puntos, presets, plantilla), se pueden copiar en tu pestaña.
        const KIND_TAB = { card: 'cards', wpnames: 'flightplan', radioedits: 'radios', notes: 'notes' };
        const d = it.data;
        const target = d && KIND_TAB[d.kind];
        return h('div', meta, h('div.muted', it.title || ''),
          target ? h('button.btn.small.primary', { style: { marginTop: '.4rem' }, onclick: () => {
            const inst = ctx.instance(target);
            if (inst && inst.applyShared) inst.applyShared(d.payload);
            else ctx.toast('Añade esa pestaña para poder copiarlo', 'warn');
          } }, icon('copy'), ` ${d.label || 'Copiar en mi kneeboard'}`) : null,
          h('img', { src: it.image, style: { width: '100%', marginTop: '.4rem', borderRadius: '.4rem', boxShadow: '0 .2rem .6rem rgba(0,0,0,.3)' } }));
      }
      if (it.type === 'dtc') {
        const mine = ctx.aircraft();
        const out = h('div.muted', { style: { fontSize: '.75rem', marginTop: '.3rem' } });
        return h('div.card', meta, h('div', h('b', it.name), h('span.muted', ` · ${it.aircraftType}`)),
          mine && it.aircraftType && mine !== it.aircraftType ? h('div.muted', `Es de otro avión (tú vuelas ${mine}).`) : null,
          h('div.card-row', { style: { marginTop: '.4rem' } },
            h('button.btn.small.primary', { onclick: async () => {
              const r = await ctx.kb.dtcInstallShared(it.id);
              out.textContent = r && r.error ? `No se pudo: ${r.error}` : `Guardado en ${r.file}. Ya lo usan las radios, el plan de vuelo y el mapa; cárgalo en cabina desde la página DTC.`;
            } }, icon('cartridge'), ' Usar este DTC')),
          out);
      }
      if (it.type === 'point' && it.point) {
        const fmts = ctx.Geo.formatPoint(it.point, ctx.aircraft());
        return h('div.card', meta, it.point.name ? h('div', it.point.name) : null, it.point.note ? h('div.muted', it.point.note) : null,
          h('div.pt', h('div.fmt', fmts.map((f) => [h('span', f.k), h('span', f.v)]).flat())),
          h('div.card-row', { style: { marginTop: '.4rem' } },
            h('button.btn.small.primary', { onclick: () => ctx.addPoint({ ...it.point, from: it.from, src: 'vuelo' }) }, icon('notes'), ' Al bloc'),
            h('button.btn.small', { onclick: () => { const m = ctx.instance('map'); if (m && m.showPoint) m.showPoint(it.point); } }, icon('map'), ' Ver en el mapa')));
      }
      return h('div.card', meta, it.title ? h('b', it.title) : null, h('div', { style: { whiteSpace: 'pre-wrap', marginTop: '.3rem', userSelect: 'text' } }, it.text || ''));
    }

    function render() {
      clear(el);
      el.append(header());
      const list = ctx.S.inbox;
      if (!list.length) {
        el.append(h('div.card.muted', 'Todavía no te han enviado nada.'));
        return;
      }
      const it = list[Math.min(page, list.length - 1)];
      el.append(h('div.card-row', { style: { margin: '.4rem 0' } },
        h('span.label', `${Math.min(page, list.length - 1) + 1} de ${list.length}`), h('span.bar-spacer'),
        h('button.btn.small', { onclick: () => ctx.kb.clearInbox() }, 'Vaciar')));
      el.append(itemView(it));
    }

    return {
      el,
      pages: () => Math.max(1, ctx.S.inbox.length),
      show(p) { page = p; render(); },
      title: () => 'Compartido',
      onInbox: () => { page = 0; if (!el.classList.contains('hidden')) render(); },
      onShareStatus: () => { if (!el.classList.contains('hidden')) render(); },
    };
  },
};
