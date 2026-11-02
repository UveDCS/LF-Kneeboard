// Pizarra: hojas infinitas para dibujar con lápiz o ratón; se puede compartir en directo con el vuelo.
import { icon } from '../icons.js';
import { h } from '../util.js';
import { drawStrokes } from '../ink.js';

const COLORS = ['#111827', '#e11d48', '#1d4ed8', '#16a34a', '#f59e0b', '#ffffff'];
const BGS = [{ id: 'blank', label: 'Liso' }, { id: 'grid', label: 'Cuadrícula' }, { id: 'lines', label: 'Rayas' }];

export const draw = {
  icon: 'board',
  label: 'Pizarra (dibujo libre, compartible)',
  create(ctx, tab) {
    const key = `board:${tab.id}`;
    let data = { pages: [[]], bg: 'grid' };
    let page = 0;
    let color = COLORS[0];
    let width = 3;
    let eraser = false;
    let live = false;
    let cur = null;
    const canvas = h('canvas');
    const liveBtn = h('button.btn.small', { title: 'Lo que dibujes lo verá el vuelo al momento', onclick: () => {
      live = !live;
      liveBtn.classList.toggle('primary', live);
      ctx.toast(live ? 'Pizarra compartida con el vuelo' : 'Pizarra privada');
    } }, icon('live'), ' En directo');
    const bar = h('div.boardbar',
      COLORS.map((c, i) => h('button.swatch', { className: `swatch${i === 0 ? ' sel' : ''}`, style: { background: c, boxShadow: c === '#ffffff' ? 'inset 0 0 0 1px #999' : '' },
        onclick: (e) => { color = c; eraser = false; bar.querySelectorAll('.swatch').forEach((s) => s.classList.toggle('sel', s === e.currentTarget)); } })),
      h('button.btn.small', { title: 'Grosor', onclick: (e) => { width = width === 3 ? 6 : width === 6 ? 1.5 : 3; e.currentTarget.textContent = `Grosor ${width}`; } }, 'Grosor 3'),
      h('button.btn.small', { title: 'Goma', onclick: (e) => { eraser = !eraser; e.currentTarget.classList.toggle('primary', eraser); } }, icon('eraser')),
      h('button.btn.small', { title: 'Deshacer', onclick: () => { strokes().pop(); redraw(); save(); } }, icon('undo')),
      h('button.btn.small', { title: 'Fondo', onclick: () => { const i = BGS.findIndex((b) => b.id === data.bg); data.bg = BGS[(i + 1) % BGS.length].id; redraw(); save(); } }, icon('grid')),
      h('button.btn.small', { title: 'Borrar hoja', onclick: () => {
        data.pages[page] = [];
        redraw();
        save();
        if (live) ctx.kb.shareSend({ type: 'clear', board: true, page });
      } }, icon('trash')),
      liveBtn);
    const el = h('div.flush', h('div.board', canvas), bar);

    ctx.kb.storeGet(key).then((d) => {
      if (d && Array.isArray(d.pages)) data = d;
      redraw();
      ctx.refresh();
    });
    const save = () => ctx.kb.storeSet(key, data);
    const strokes = () => (data.pages[page] = data.pages[page] || []);

    function pos(e) {
      const r = canvas.getBoundingClientRect();
      return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, e.pressure || 0.5];
    }

    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      if (eraser || (e.buttons & 32)) {
        cur = { erase: true, id: e.pointerId };
        eraseAt(pos(e));
        return;
      }
      cur = { id: e.pointerId, s: { c: color, w: width, p: [pos(e)] } };
      strokes().push(cur.s);
      redraw();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!cur || e.pointerId !== cur.id) return;
      if (cur.erase) return eraseAt(pos(e));
      for (const p of e.getCoalescedEvents ? e.getCoalescedEvents() : [e]) cur.s.p.push(pos(p));
      redraw();
    });
    const end = (e) => {
      if (!cur || e.pointerId !== cur.id) return;
      if (!cur.erase && live) ctx.kb.shareSend({ type: 'ink', board: true, page, stroke: cur.s });
      cur = null;
      save();
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);

    function eraseAt([x, y]) {
      const list = strokes();
      const keep = list.filter((s) => !s.p.some(([px, py]) => Math.hypot(px - x, py - y) < 0.02));
      if (keep.length !== list.length) {
        data.pages[page] = keep;
        redraw();
      }
    }

    function redraw() {
      const r = canvas.getBoundingClientRect();
      if (!r.width) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      const g = canvas.getContext('2d');
      const css = getComputedStyle(document.body);
      g.fillStyle = css.getPropertyValue('--card').trim() && document.body.dataset.theme === 'mfd' ? '#000' : 'rgba(255,255,255,0.0)';
      g.clearRect(0, 0, canvas.width, canvas.height);
      g.strokeStyle = css.getPropertyValue('--line').trim() || 'rgba(0,0,0,.15)';
      g.lineWidth = 1;
      const step = 28 * dpr;
      if (data.bg === 'grid' || data.bg === 'lines') {
        g.beginPath();
        for (let y = step; y < canvas.height; y += step) { g.moveTo(0, y); g.lineTo(canvas.width, y); }
        if (data.bg === 'grid') for (let x = step; x < canvas.width; x += step) { g.moveTo(x, 0); g.lineTo(x, canvas.height); }
        g.stroke();
      }
      drawStrokes(g, strokes(), canvas.width, canvas.height, dpr);
    }

    return {
      el,
      endless: true,
      pages: () => data.pages.length,
      show(p) {
        page = p;
        while (data.pages.length <= page) data.pages.push([]);
        requestAnimationFrame(redraw);
      },
      title: (p) => `Pizarra ${p + 1}`,
      onResize: redraw,
      onConfig: () => requestAnimationFrame(redraw),
      onShareLive(item) {
        if (!item.board) return;
        while (data.pages.length <= item.page) data.pages.push([]);
        if (item.type === 'ink' && item.stroke) data.pages[item.page].push(item.stroke);
        if (item.type === 'clear') data.pages[item.page] = [];
        save();
        if (item.page === page) redraw();
        ctx.refresh();
      },
    };
  },
};
