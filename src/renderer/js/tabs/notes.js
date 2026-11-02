// Bloc: plantillas para rellenar (autorización, 9-line, check-in, repostaje, BDA), notas libres y coordenadas.
// Las coordenadas llegan del centro del mapa F10 (como DCS Scratchpad), de un clic en el Mapa o del vuelo.
import { icon } from '../icons.js';
import { h, clear, copyText } from '../util.js';

export const TEMPLATES = [
  { id: 'libre', title: 'Notas', fields: [{ k: 'text', label: '', area: 18 }] },
  { id: 'coords', title: 'Coordenadas', coords: true },
  {
    id: 'nineline', title: '9-line CAS', fields: [
      { k: '1', n: '1', label: 'IP / BP' },
      { k: '2', n: '2', label: 'Rumbo IP→blanco (°M) y desvío' },
      { k: '3', n: '3', label: 'Distancia (nm)' },
      { k: '4', n: '4', label: 'Elevación del blanco (ft MSL)' },
      { k: '5', n: '5', label: 'Descripción del blanco' },
      { k: '6', n: '6', label: 'Ubicación del blanco', loc: true },
      { k: '7', n: '7', label: 'Marcado (tipo / código láser)' },
      { k: '8', n: '8', label: 'Amigos (dirección / distancia)' },
      { k: '9', n: '9', label: 'Salida' },
      { k: 'r', label: 'Observaciones: restricciones, TOT, ataque final', area: 3 },
    ],
  },
  {
    id: 'checkin', title: 'Check-in JTAC', fields: [
      { k: 'cs', label: 'Indicativo / misión' },
      { k: 'n', label: 'Número y tipo de aviones' },
      { k: 'pos', label: 'Posición y altitud', loc: true },
      { k: 'ord', label: 'Armamento' },
      { k: 'play', label: 'Tiempo en zona (playtime)' },
      { k: 'cap', label: 'Capacidades (TGP, láser, coordenadas)' },
      { k: 'abort', label: 'Código de abortar' },
    ],
  },
  {
    id: 'craft', title: 'Autorización ATC', fields: [
      { k: 'c', n: 'C', label: 'Límite de la autorización' },
      { k: 'r', n: 'R', label: 'Ruta / salida' },
      { k: 'a', n: 'A', label: 'Altitud' },
      { k: 'f', n: 'F', label: 'Frecuencia de salida' },
      { k: 't', n: 'T', label: 'Transpondedor' },
      { k: 'x', label: 'Notas', area: 3 },
    ],
  },
  {
    id: 'aar', title: 'Repostaje', fields: [
      { k: 'tk', label: 'Tanquero (indicativo)' },
      { k: 'fr', label: 'Frecuencia' },
      { k: 'tc', label: 'TACAN / A-A' },
      { k: 'trk', label: 'Órbita / ruta', loc: true },
      { k: 'alt', label: 'Altitud y velocidad' },
      { k: 'arct', label: 'Hora de control (ARCT)' },
      { k: 'off', label: 'Transferencia (lb)' },
    ],
  },
  {
    id: 'bda', title: 'BDA', fields: [
      { k: 'res', label: 'Resultado' },
      { k: 'tgt', label: 'Blancos destruidos / dañados' },
      { k: 'ord', label: 'Munición empleada' },
      { k: 'loc', label: 'Ubicación', loc: true },
      { k: 'fuel', label: 'Combustible / tiempo restante' },
      { k: 'x', label: 'Observaciones', area: 4 },
    ],
  },
];

export const notes = {
  icon: 'notes',
  label: 'Bloc: plantillas y coordenadas',
  create(ctx, tab) {
    const el = h('div');
    const Geo = ctx.Geo;
    let page = 0;
    let data = { values: {}, points: [] };
    let lastLoc = null; // { tpl, k, at }
    const key = `notes:${tab.id}`;

    ctx.kb.storeGet(key).then((d) => {
      if (d) data = { values: d.values || {}, points: d.points || [] };
      render();
    });
    ctx.kb.on('store-changed', (name, d) => {
      if (name !== key || el.contains(document.activeElement)) return;
      data = { values: d.values || {}, points: d.points || [] };
      render();
    });
    const save = () => ctx.kb.storeSet(key, data);

    function pointCard(p, i) {
      const fmts = Geo.formatPoint(p, p.type || ctx.aircraft());
      return h('div.card.pt',
        h('div.card-row',
          h('b', p.name || `Punto ${data.points.length - i}`),
          h('span.tag', p.src || 'punto'),
          p.from ? h('span.muted', `de ${p.from}`) : null,
          h('span.bar-spacer'),
          h('button.btn.small', { title: 'Copiar', onclick: async () => { if (await copyText(fmts.map((f) => `${f.k} ${f.v}`).join('\n'))) ctx.toast('Copiado'); } }, icon('copy')),
          h('button.btn.small', { title: 'Enviar al vuelo', onclick: () => ctx.kb.shareSend({ type: 'point', point: strip(p) }).then((ok) => ok && ctx.toast('Punto enviado al vuelo')) }, icon('send')),
          h('button.btn.small', { title: 'Borrar', onclick: () => { data.points.splice(i, 1); save(); render(); } }, icon('close'))),
        h('div.fmt', fmts.map((f) => [h('span', f.k), h('span', f.v)]).flat()),
        h('input.f', { value: p.note || '', placeholder: 'Nota (p. ej. SA-6, blanco 2…)', style: { marginTop: '.35rem', fontSize: '.8rem' },
          oninput: (e) => { p.note = e.target.value; save(); } }));
    }

    function render() {
      clear(el);
      const tpl = TEMPLATES[page] || TEMPLATES[0];
      el.append(h('div.chips', TEMPLATES.map((t, i) => h('button.chip', { className: `chip${i === page ? ' sel' : ''}`, onclick: () => { page = i; render(); ctx.refresh(); } },
        t.title, t.coords && data.points.length ? h('span.badge', { style: { marginLeft: '.3rem' } }, data.points.length) : null))));
      if (tpl.coords) {
        el.append(h('div.h1', 'Coordenadas', h('small', 'Captura: tecla/botón «Capturar coordenadas» con el F10 abierto, o clic en el Mapa')));
        el.append(h('div.card-row', { style: { marginBottom: '.6rem' } },
          h('button.btn.primary', { onclick: () => ctx.kb.capture() }, icon('crosshair'), ' Capturar centro del F10'),
          data.points.length ? h('button.btn', { onclick: () => { data.points = []; save(); render(); } }, 'Vaciar') : null));
        if (!data.points.length) el.append(h('div.card.muted', 'Todavía no hay puntos. Abre el mapa F10, centra el punto en la cruz y pulsa la acción «Capturar coordenadas».'));
        el.append(h('div.pts', data.points.map(pointCard)));
        return;
      }
      el.append(h('div.h1', tpl.title));
      const vals = (data.values[tpl.id] = data.values[tpl.id] || {});
      for (const f of tpl.fields) {
        const input = f.area
          ? h('textarea.f', { rows: f.area, value: vals[f.k] || '' })
          : h('input.f', { value: vals[f.k] || '' });
        input.addEventListener('input', () => { vals[f.k] = input.value; save(); });
        if (f.loc) input.addEventListener('focus', () => { lastLoc = { tpl: tpl.id, k: f.k, at: Date.now() }; });
        el.append(h('div.field', f.label || f.n ? h('label', f.n ? h('b', f.n) : null, f.label, f.loc ? h('span.muted', icon('crosshair')) : null) : null, input));
      }
      el.append(h('div.card-row', h('button.btn.small', { onclick: () => { data.values[tpl.id] = {}; save(); render(); } }, 'Borrar plantilla'),
        h('button.btn.small', { onclick: () => {
          const txt = tpl.fields.map((f) => `${f.n ? `${f.n}. ` : ''}${f.label}: ${vals[f.k] || ''}`).join('\n');
          ctx.kb.shareSend({ type: 'note', title: tpl.title, text: txt }).then((ok) => ok && ctx.toast(`${tpl.title} enviado al vuelo`));
        } }, icon('send'), ' Enviar al vuelo')));
    }

    function strip(p) {
      const { lat, lon, alt, mgrs, src, name, note, type } = p;
      return { lat, lon, alt, mgrs, src, name, note, type };
    }

    return {
      el,
      pages: () => TEMPLATES.length,
      show(p) { page = p; render(); },
      title: (p) => (TEMPLATES[p] || {}).title || 'Bloc',
      isCoordsPage: () => !el.classList.contains('hidden') && !!(TEMPLATES[page] || {}).coords,
      // Compartir: la plantilla que estás viendo, para copiarla en el bloc del compañero.
      shareData: () => {
        const tpl = TEMPLATES[page];
        if (!tpl || tpl.coords) return null;
        return { kind: 'notes', label: `Copiar «${tpl.title}» a mi bloc`, payload: { tpl: tpl.id, values: { ...(data.values[tpl.id] || {}) } } };
      },
      applyShared(payload) {
        data.values[payload.tpl] = { ...(data.values[payload.tpl] || {}), ...payload.values };
        save();
        render();
        ctx.toast('Plantilla copiada en tu bloc');
      },
      addPoint(p) {
        const pt = { ...p, id: p.id || `${Date.now()}`, at: p.at || Date.now() };
        if (data.points.some((x) => x.id === pt.id)) return;
        data.points.unshift(pt);
        // Si se estaba rellenando un campo de ubicación, se completa con el formato principal del avión.
        if (lastLoc && Date.now() - lastLoc.at < 120000) {
          const f = Geo.formatPoint(pt, pt.type || ctx.aircraft())[0];
          const vals = (data.values[lastLoc.tpl] = data.values[lastLoc.tpl] || {});
          vals[lastLoc.k] = `${f.v}${pt.alt != null ? `  ·  ${Math.round(pt.alt * 3.28084)} ft` : ''}`;
          lastLoc = null;
        }
        save();
        if (!el.classList.contains('hidden')) render();
      },
    };
  },
};
