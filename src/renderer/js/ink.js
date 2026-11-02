// Lápiz sobre cualquier página de documento (como en OpenKneeboard).
// El lápiz de una tableta dibuja siempre; el ratón solo con la herramienta activada.
// Los trazos se guardan normalizados (0..1) para que no dependan del tamaño de la ventana.
import { icon } from './icons.js';
import { h } from './util.js';

const COLORS = ['#e11d48', '#1d4ed8', '#16a34a', '#111827', '#f59e0b'];

export class Ink {
  constructor(content, ctx) {
    this.content = content;
    this.ctx = ctx;
    this.key = null;
    this.data = {};
    this.color = COLORS[0];
    this.width = 3;
    this.eraser = false;
    this.cur = null;
    this.canvas = h('canvas.ink');
    this.bar = h('div.inkbar',
      COLORS.map((c) => h('button.swatch', { style: { background: c }, title: 'Color', onclick: (e) => this.pick(c, e.currentTarget) })),
      h('button.btn.small', { title: 'Goma', onclick: (e) => { this.eraser = !this.eraser; e.currentTarget.classList.toggle('primary', this.eraser); } }, icon('eraser')),
      h('button.btn.small', { title: 'Deshacer', onclick: () => this.undo() }, icon('undo')),
      h('button.btn.small', { title: 'Borrar la página', onclick: () => this.clearPage() }, icon('trash')),
    );
    this.bar.querySelector('.swatch').classList.add('sel');
    content.append(this.canvas, this.bar);
    new ResizeObserver(() => this.redraw()).observe(content);
    content.addEventListener('pointerdown', (e) => this.down(e), true);
    window.addEventListener('pointermove', (e) => this.move(e), true);
    window.addEventListener('pointerup', (e) => this.up(e), true);
    ctx.kb.storeGet('ink').then((d) => {
      this.data = d || {};
      this.redraw();
    });
    ctx.kb.on('store-changed', (name, data) => {
      if (name === 'ink' && !this.cur) {
        this.data = data || {};
        this.redraw();
      }
    });
  }

  pick(c, el) {
    this.color = c;
    this.eraser = false;
    this.bar.querySelectorAll('.swatch').forEach((s) => s.classList.toggle('sel', s === el));
  }

  attach(key) {
    this.key = key;
    this.canvas.style.display = key ? '' : 'none';
    if (!key) this.content.classList.remove('inking');
    this.redraw();
  }

  get strokes() {
    if (!this.key) return [];
    return (this.data[this.key] = this.data[this.key] || []);
  }

  pos(e) {
    const r = this.canvas.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, e.pressure || 0.5];
  }

  down(e) {
    if (!this.key) return;
    const pen = e.pointerType === 'pen';
    if (!pen && !this.content.classList.contains('inking')) return;
    if (e.target.closest('.inkbar')) return;
    e.preventDefault();
    e.stopPropagation();
    const erase = this.eraser || (pen && (e.buttons & 32));
    if (erase) {
      this.eraseAt(this.pos(e));
      this.cur = { erase: true, id: e.pointerId };
      return;
    }
    this.cur = { id: e.pointerId, s: { c: this.color, w: this.width, p: [this.pos(e)] } };
    this.strokes.push(this.cur.s);
  }

  move(e) {
    if (!this.cur || e.pointerId !== this.cur.id) return;
    e.preventDefault();
    if (this.cur.erase) {
      this.eraseAt(this.pos(e));
      return;
    }
    // Los eventos de la tableta (OTD-IPC) llegan sin puntos intermedios: entonces vale el propio evento.
    const co = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    const pts = co.length ? co : [e];
    for (const p of pts) this.cur.s.p.push(this.pos(p));
    this.redraw();
  }

  up(e) {
    if (!this.cur || e.pointerId !== this.cur.id) return;
    this.cur = null;
    this.save();
  }

  eraseAt([x, y]) {
    const r = 0.02;
    const before = this.strokes.length;
    this.data[this.key] = this.strokes.filter((s) => !s.p.some(([px, py]) => Math.hypot(px - x, py - y) < r));
    if (this.data[this.key].length !== before) this.redraw();
  }

  undo() {
    this.strokes.pop();
    this.redraw();
    this.save();
  }

  clearPage() {
    if (this.key) this.data[this.key] = [];
    this.redraw();
    this.save();
  }

  save() {
    this.ctx.kb.storeSet('ink', this.data);
  }

  redraw() {
    const c = this.canvas;
    const r = this.content.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(r.width * dpr) || c.height !== Math.round(r.height * dpr)) {
      c.width = Math.round(r.width * dpr);
      c.height = Math.round(r.height * dpr);
    }
    const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    drawStrokes(g, this.strokes, c.width, c.height, dpr);
  }
}

export function drawStrokes(g, strokes, W, H, dpr = 1) {
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const s of strokes || []) {
    if (!s.p || !s.p.length) continue;
    g.strokeStyle = s.c;
    if (s.p.length === 1) {
      g.fillStyle = s.c;
      g.beginPath();
      g.arc(s.p[0][0] * W, s.p[0][1] * H, s.w * dpr * 0.6, 0, Math.PI * 2);
      g.fill();
      continue;
    }
    for (let i = 1; i < s.p.length; i++) {
      const [x0, y0] = s.p[i - 1];
      const [x1, y1, pr] = s.p[i];
      g.lineWidth = s.w * dpr * (0.5 + (pr || 0.5));
      g.beginPath();
      g.moveTo(x0 * W, y0 * H);
      g.lineTo(x1 * W, y1 * H);
      g.stroke();
    }
  }
}
