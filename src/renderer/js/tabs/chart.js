// Carta georreferenciada (como en ForeFlight): una imagen o un PDF (carta de aproximación, mapa de la zona…)
// calibrada con 2 o más puntos conocidos; encima se dibujan tu avión, la ruta y el bullseye.
import { icon } from '../icons.js';
import { h, clear, emptyState } from '../util.js';
import { loadPdfJs } from './docs.js';

const M_LAT = 110574;
const M_LON = 111320;

// Ajuste de píxeles <-> metros locales: semejanza con 2 puntos, afín por mínimos cuadrados con 3 o más.
export function solveTransform(pts) {
  if (!pts || pts.length < 2) return null;
  const lat0 = pts[0].lat, lon0 = pts[0].lon;
  const k = Math.cos(lat0 * Math.PI / 180);
  const toXY = (p) => ({ x: (p.lon - lon0) * M_LON * k, y: -(p.lat - lat0) * M_LAT }); // y hacia abajo, como la imagen
  const fromXY = (x, y) => ({ lat: lat0 - y / M_LAT, lon: lon0 + x / (M_LON * k) });
  let A;
  if (pts.length === 2) {
    const [p1, p2] = pts.map(toXY);
    const [w1, w2] = pts.map((p) => ({ x: p.u, y: p.v }));
    const dz = { x: p2.x - p1.x, y: p2.y - p1.y }, dw = { x: w2.x - w1.x, y: w2.y - w1.y };
    const den = dz.x * dz.x + dz.y * dz.y;
    if (!den) return null;
    const a = { x: (dw.x * dz.x + dw.y * dz.y) / den, y: (dw.y * dz.x - dw.x * dz.y) / den };
    const b = { x: w1.x - (a.x * p1.x - a.y * p1.y), y: w1.y - (a.x * p1.y + a.y * p1.x) };
    A = [a.x, -a.y, b.x, a.y, a.x, b.y];
  } else {
    // u = a x + b y + c ; v = d x + e y + f
    const rows = pts.map((p) => ({ ...toXY(p), u: p.u, v: p.v }));
    const solve3 = (key) => {
      let sxx = 0, sxy = 0, sx = 0, syy = 0, sy = 0, n = 0, sxt = 0, syt = 0, st = 0;
      for (const r of rows) {
        sxx += r.x * r.x; sxy += r.x * r.y; sx += r.x; syy += r.y * r.y; sy += r.y; n++;
        sxt += r.x * r[key]; syt += r.y * r[key]; st += r[key];
      }
      const M = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]];
      const B = [sxt, syt, st];
      const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
      const D = det(M);
      if (Math.abs(D) < 1e-9) return null;
      return [0, 1, 2].map((c) => det(M.map((row, i) => row.map((v, j) => (j === c ? B[i] : v)))) / D);
    };
    const U = solve3('u'), V = solve3('v');
    if (!U || !V) return null;
    A = [...U, ...V];
  }
  const [a, b, c, d, e, f] = A;
  const det = a * e - b * d;
  return {
    toPx(lat, lon) {
      const { x, y } = toXY({ lat, lon });
      return { u: a * x + b * y + c, v: d * x + e * y + f };
    },
    toLL(u, v) {
      const x = (e * (u - c) - b * (v - f)) / det;
      const y = (-d * (u - c) + a * (v - f)) / det;
      return fromXY(x, y);
    },
    // Ángulo del norte en la imagen (para girar el icono del avión).
    northDeg() {
      return Math.atan2(b, e) * 180 / Math.PI * -1;
    },
  };
}

export const chart = {
  icon: 'chart',
  label: 'Carta georreferenciada (imagen o PDF)',
  create(ctx, tab) {
    const el = h('div.flush');
    const key = `chart:${tab.path || ''}:${tab.page || 1}`;
    let cal = { pts: [] };
    let T = null;
    let src = null;
    let nat = { w: 1, h: 1 };
    let calibrating = false;
    let zoom = 1;
    let follow = false;
    const img = h('img', { draggable: false, style: { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' } });
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    Object.assign(svg.style, { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', overflow: 'visible' });
    const inner = h('div', { style: { position: 'absolute', transformOrigin: '0 0' } }, img, svg);
    const stage = h('div', { style: { position: 'absolute', inset: '2.9rem 0 0 0', overflow: 'hidden', background: 'var(--doc-bg, #000)' } }, inner);
    const status = h('div.url');
    const calBtn = h('button.btn.small', { onclick: () => { calibrating = !calibrating; calBtn.classList.toggle('primary', calibrating); draw(); } }, icon('pin'), ' Calibrar');
    const followBtn = h('button.btn.small', { onclick: () => { follow = !follow; followBtn.classList.toggle('primary', follow); if (follow && zoom < 2) zoom = 2; layout(); } }, icon('follow'), ' Seguir');
    const bar = h('div.webnav', calBtn, h('button.btn.small', { title: 'Borrar la calibración', onclick: () => { cal.pts = []; saveCal(); } }, icon('trash')), status,
      followBtn, h('button.btn.small', { onclick: () => { zoom = Math.max(1, zoom / 1.5); layout(); } }, icon('zoomOut')), h('button.btn.small', { onclick: () => { zoom = Math.min(8, zoom * 1.5); layout(); } }, icon('zoomIn')));
    el.append(bar, stage);

    let box = { x: 0, y: 0, w: 1, h: 1 }; // rectángulo de la imagen dentro del escenario (zoom 1)
    let pan = { x: 0, y: 0 };

    async function load() {
      if (!tab.path) {
        clear(el).append(emptyState(icon('chart'), 'Carta georreferenciada', 'Elige una imagen o un PDF en Ajustes > Pestañas. Después pulsa «Calibrar» y marca dos o tres puntos conocidos (un aeródromo, un waypoint…).'));
        return;
      }
      cal = (await ctx.kb.storeGet(key)) || { pts: [] };
      if (/\.pdf$/i.test(tab.path)) {
        const lib = await loadPdfJs();
        const doc = await lib.getDocument({ url: await ctx.kb.fileUrl(tab.path), isEvalSupported: false }).promise;
        const pg = await doc.getPage(Math.min(Number(tab.page) || 1, doc.numPages));
        const vp = pg.getViewport({ scale: 2.5 });
        const c = document.createElement('canvas');
        c.width = vp.width; c.height = vp.height;
        await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
        src = c.toDataURL('image/png');
      } else src = await ctx.kb.fileUrl(tab.path);
      img.onload = () => { nat = { w: img.naturalWidth, h: img.naturalHeight }; svg.setAttribute('viewBox', `0 0 ${nat.w} ${nat.h}`); layout(); };
      img.src = src;
      T = solveTransform(cal.pts);
    }

    function saveCal() {
      T = solveTransform(cal.pts);
      ctx.kb.storeSet(key, cal);
      draw();
    }

    function layout() {
      const r = stage.getBoundingClientRect();
      if (!r.width) return;
      const k = Math.min(r.width / nat.w, r.height / nat.h);
      box = { w: nat.w * k, h: nat.h * k, x: (r.width - nat.w * k) / 2, y: (r.height - nat.h * k) / 2 };
      const live = ctx.S.live;
      if (follow && T && live && live.lat != null) {
        const p = T.toPx(live.lat, live.lon);
        pan = { x: r.width / 2 - (p.u / nat.w) * box.w * zoom, y: r.height / 2 - (p.v / nat.h) * box.h * zoom };
      } else if (zoom === 1) pan = { x: box.x, y: box.y };
      inner.style.width = `${box.w}px`;
      inner.style.height = `${box.h}px`;
      inner.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
      draw();
    }

    // Arrastrar para mover cuando hay zoom
    let drag = null;
    stage.addEventListener('pointerdown', (e) => {
      if (calibrating) return;
      drag = { x: e.clientX, y: e.clientY, pan: { ...pan } };
      stage.setPointerCapture(e.pointerId);
    });
    stage.addEventListener('pointermove', (e) => {
      if (!drag || zoom === 1) return;
      follow = false;
      followBtn.classList.remove('primary');
      pan = { x: drag.pan.x + e.clientX - drag.x, y: drag.pan.y + e.clientY - drag.y };
      inner.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
    });
    stage.addEventListener('pointerup', () => { drag = null; });
    stage.addEventListener('wheel', (e) => { zoom = Math.max(1, Math.min(8, zoom * (e.deltaY < 0 ? 1.25 : 0.8))); layout(); e.stopPropagation(); }, { passive: true });

    // Calibración: clic en la imagen y se dice qué punto es
    inner.addEventListener('click', (e) => {
      if (!calibrating) return;
      const r = inner.getBoundingClientRect();
      const u = ((e.clientX - r.left) / r.width) * nat.w;
      const v = ((e.clientY - r.top) / r.height) * nat.h;
      askPoint(u, v);
    });

    function askPoint(u, v) {
      const m = ctx.S.mission;
      const opts = [];
      if (m) {
        for (const w of m.route) if (w.lat != null) opts.push({ label: `WP${w.idx} ${w.name || w.typeText}`, lat: w.lat, lon: w.lon });
        if (m.bullseye && m.bullseye.lat != null) opts.push({ label: 'Bullseye', ...m.bullseye });
        for (const b of m.airfields || []) opts.push({ label: b.name, lat: b.lat, lon: b.lon });
      }
      const sel = h('select.f', h('option', { value: '' }, 'Elegir un punto conocido…'), opts.map((o, i) => h('option', { value: String(i) }, o.label)));
      const txt = h('input.f', { placeholder: 'o escribe: N36°14.23\' W115°02.10\'' });
      const dlg = h('div.card', { style: { position: 'absolute', left: '1rem', right: '1rem', top: '3.6rem', zIndex: 5, boxShadow: '0 .5rem 1.5rem rgba(0,0,0,.4)', background: 'var(--screen-bg)' } },
        h('div.label', `Punto ${cal.pts.length + 1} de la calibración`), sel, h('div', { style: { height: '.4rem' } }), txt,
        h('div.card-row', { style: { marginTop: '.5rem' } },
          h('button.btn.primary', { onclick: () => {
            const o = sel.value !== '' ? opts[Number(sel.value)] : ctx.Geo.parseLatLon(txt.value);
            if (!o) { ctx.toast('No entiendo esas coordenadas', 'warn'); return; }
            cal.pts.push({ u, v, lat: o.lat, lon: o.lon, label: o.label || txt.value });
            dlg.remove();
            saveCal();
            if (cal.pts.length >= 3) { calibrating = false; calBtn.classList.remove('primary'); }
          } }, 'Añadir'),
          h('button.btn', { onclick: () => dlg.remove() }, 'Cancelar')));
      el.append(dlg);
    }

    function add(tag, attrs, parent = svg) {
      const n = document.createElementNS(svgNS, tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
      parent.appendChild(n);
      return n;
    }

    function draw() {
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      const s = Math.max(nat.w, nat.h) / 900; // tamaño de los símbolos en píxeles de la imagen
      status.textContent = T ? `Calibrada con ${cal.pts.length} puntos${calibrating ? ' · clic para añadir más' : ''}` : calibrating ? 'Haz clic en un punto conocido de la carta' : 'Sin calibrar';
      if (calibrating || !T) {
        cal.pts.forEach((p, i) => {
          add('circle', { cx: p.u, cy: p.v, r: 9 * s, fill: 'none', stroke: '#ff2d55', 'stroke-width': 3 * s });
          const t = add('text', { x: p.u + 12 * s, y: p.v - 10 * s, fill: '#ff2d55', 'font-size': 22 * s, 'font-weight': 700, stroke: '#000', 'stroke-width': 0.6 * s });
          t.textContent = `${i + 1} ${p.label || ''}`;
        });
      }
      if (!T) return;
      const m = ctx.S.mission;
      if (m) {
        const pts = m.route.filter((w) => w.lat != null).map((w) => T.toPx(w.lat, w.lon));
        if (pts.length > 1) add('polyline', { points: pts.map((p) => `${p.u},${p.v}`).join(' '), fill: 'none', stroke: '#f59e0b', 'stroke-width': 4 * s, 'stroke-dasharray': `${12 * s} ${8 * s}` });
        for (const p of pts) add('circle', { cx: p.u, cy: p.v, r: 7 * s, fill: '#38bdf8', stroke: '#fff', 'stroke-width': 2 * s });
      }
      const live = ctx.S.live;
      if (live && live.lat != null) {
        const p = T.toPx(live.lat, live.lon);
        const rot = (live.hdg || 0) + T.northDeg();
        const g = add('g', { transform: `translate(${p.u},${p.v}) rotate(${rot}) scale(${1.4 * s})` });
        add('path', { d: 'M0 -18 L5 0 L16 6 L16 9 L4 6 L3 13 L8 16 L8 18 L0 16 L-8 18 L-8 16 L-3 13 L-4 6 L-16 9 L-16 6 L-5 0 Z', fill: '#ff2d55', stroke: '#fff', 'stroke-width': 1.5 }, g);
      }
    }

    load();
    new ResizeObserver(() => layout()).observe(stage);
    let last = 0;
    return {
      el,
      pages: () => 1,
      show() { requestAnimationFrame(layout); },
      title: () => tab.title,
      onMission: draw,
      onLive: () => {
        if (el.classList.contains('hidden') || Date.now() - last < 250) return;
        last = Date.now();
        if (follow) layout();
        else draw();
      },
    };
  },
};
