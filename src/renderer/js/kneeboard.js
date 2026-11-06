// Núcleo del kneeboard: pestañas, páginas, marcadores, barra superior, modo automático, avisos y lápiz.
import { h, clear, hms } from './util.js';
import { Ink } from './ink.js';
import { TAB_TYPES } from './tabs/index.js';
import { THEMES } from './themes.js';
import { icon, tabIcon } from './icons.js';
import { BOOKMARK_TYPES, bmType } from './bookmarks.js';

const kb = window.kb;
const Geo = window.Geo;
const $ = (id) => document.getElementById(id);


const S = {
  config: null, mission: null, live: null, phase: null, connected: false, messages: [], inbox: [],
  timers: null, activeView: 0, share: { status: 'desconectado', members: [] }, vrActive: false, phases: [], actions: [],
  bookmarks: {},
};

const instances = new Map(); // id de pestaña -> { inst, sig }
let tabIndex = 0;
let pages = {};
let lastManual = 0;
let ink;
let coordsShown = null;
let indexOpen = null; // { render } mientras el índice está abierto

const ctx = {
  kb, S, Geo, h, icon,
  view: kb.view,
  toast,
  aircraft: () => (S.live && S.live.type) || (S.mission && S.mission.unit && S.mission.unit.type) || '',
  magvar: () => {
    const th = S.mission && S.mission.theatre;
    const o = S.config.magvar && th != null ? S.config.magvar[th] : undefined;
    return o != null && o !== '' ? Number(o) : (S.mission ? S.mission.magvar || 0 : 0);
  },
  addPoint: (p, opts) => addPoint(p, opts),
  refresh: () => { renderChrome(); updateCoordsFlag(); },
  goToPage: (n) => setPage(n, { manual: true }),
  // Nombres de los puntos cambiados en esta ventana: el mapa y las demás pestañas los repintan.
  namesChanged: () => { for (const { inst } of instances.values()) if (inst.onConfig) inst.onConfig(S.config); },
  goToType: (type) => {
    const i = tabs().findIndex((t) => t.type === type);
    if (i >= 0) switchTab(i, { manual: true });
  },
  instance: (type) => {
    const t = tabs().find((x) => x.type === type);
    return t ? getInstance(t) : null;
  },
};

const tabs = () => S.config.tabs || [];
const inboxNew = () => (S.inbox || []).filter((it) => !it.mine).length; // lo que te han enviado (no lo tuyo)
const curTab = () => tabs()[tabIndex];
const curInst = () => (curTab() ? getInstance(curTab()) : null);

// ------------------------------------------------------------------ instancias de pestaña
function getInstance(tab) {
  // Fijar en la barra o asignar fases no cambia el contenido: no hace falta recrear la pestaña.
  const sig = JSON.stringify({ ...tab, fav: undefined, phases: undefined });
  const cached = instances.get(tab.id);
  if (cached && cached.sig === sig) return cached.inst;
  if (cached) destroyInstance(tab.id);
  const type = TAB_TYPES[tab.type];
  if (!type) return null;
  const inst = type.create(ctx, tab);
  inst.el.classList.add('view', 'hidden');
  $('content').insertBefore(inst.el, $('content').firstChild);
  instances.set(tab.id, { inst, sig });
  if (inst.onMission && S.mission) inst.onMission(S.mission);
  if (inst.onLive && S.live) inst.onLive(S.live);
  return inst;
}

function destroyInstance(id) {
  const c = instances.get(id);
  if (!c) return;
  if (c.inst.destroy) c.inst.destroy();
  c.inst.el.remove();
  instances.delete(id);
}

function pageCount(inst) {
  return Math.max(1, (inst && inst.pages && inst.pages()) || 1);
}

function curPage() {
  const t = curTab();
  return t ? pages[t.id] || 0 : 0;
}

// ------------------------------------------------------------------ navegación
function switchTab(i, { manual = false } = {}) {
  const list = tabs();
  if (!list.length) return;
  tabIndex = ((i % list.length) + list.length) % list.length;
  if (manual) lastManual = Date.now();
  closeOverlay();
  show();
  persist();
}

// Pestaña siguiente/anterior: si hay favoritas, solo se recorren esas (como la barra);
// desde una que no lo es se salta a la favorita más cercana en ese sentido.
function stepTab(dir) {
  const list = tabs();
  if (!list.length) return;
  if (!list.some((t) => t.fav)) return switchTab(tabIndex + dir, { manual: true });
  for (let k = 1; k <= list.length; k++) {
    const i = (((tabIndex + dir * k) % list.length) + list.length) % list.length;
    if (list[i].fav) return switchTab(i, { manual: true });
  }
}

function setPage(n, { manual = false } = {}) {
  const t = curTab();
  if (!t) return;
  const inst = getInstance(t);
  const count = pageCount(inst);
  const grow = inst && inst.endless && n >= count;
  const p = grow ? n : Math.max(0, Math.min(count - 1, n));
  pages[t.id] = p;
  if (manual) lastManual = Date.now();
  show();
  persist();
}

function show() {
  const t = curTab();
  for (const [id, c] of instances) c.inst.el.classList.toggle('hidden', !t || id !== t.id);
  if (!t) {
    renderChrome();
    return;
  }
  const inst = getInstance(t);
  if (inst) {
    inst.el.classList.remove('hidden');
    const p = Math.min(curPage(), inst.endless ? Infinity : pageCount(inst) - 1);
    pages[t.id] = p;
    inst.show(p);
    ink.attach(inst.inkKey ? inst.inkKey(p) : null);
  }
  renderChrome();
  updateCoordsFlag();
}

function persist() {
  kb.saveViewState({ tab: tabIndex, pages });
}

// La cruz del centro de la pantalla se enseña mientras miras la página de Coordenadas.
function updateCoordsFlag() {
  const inst = curInst();
  const on = !!(inst && inst.isCoordsPage && inst.isCoordsPage()) && !document.hidden && !(S.config && S.config.hidden);
  if (on !== coordsShown) {
    coordsShown = on;
    kb.coordsVisible(on);
  }
}

// ------------------------------------------------------------------ marcadores
function pageKeyOf(inst, p) {
  return inst && inst.pageKey ? inst.pageKey(p) : null;
}

// Marcadores por avión: cada módulo tiene los suyos (quitar uno en el F-16 no lo quita en el F/A-18).
// Al volar un avión por primera vez se copian los marcadores de antes (cuando eran comunes) y desde ahí van aparte.
const bmStoreOf = (ac) => `bookmarks@${ac || 'general'}`;
// Páginas añadidas a la pestaña Misión sin ser marcadores (no cuentan para el modo AUTO ni para la lista de
// marcadores). También van por avión.
const mpStoreOf = (ac) => `misionpages@${ac || 'general'}`;
const canBeInMission = (key) => /^(lib|ac|mis):/.test(key || '');
let bmLoading = null;
async function loadBookmarks() {
  const name = bmStoreOf(ctx.aircraft());
  if (name === S.bmStore) return;
  S.bmStore = name;
  const job = (async () => {
    let data = await kb.storeGet(name);
    if (!data) {
      data = { ...((await kb.storeGet('bookmarks')) || {}) };
      if (Object.keys(data).length) kb.storeSet(name, data);
    }
    return { data, pages: (await kb.storeGet(mpStoreOf(ctx.aircraft()))) || {} };
  })();
  bmLoading = job;
  const { data, pages: mp } = await job;
  if (bmLoading !== job) return;
  S.bookmarks = data;
  S.missionPages = mp;
  for (const { inst } of instances.values()) if (inst.onBookmarks) inst.onBookmarks();
  renderChrome();
}

function saveBookmarks() {
  kb.storeSet(S.bmStore || bmStoreOf(ctx.aircraft()), S.bookmarks);
  for (const { inst } of instances.values()) if (inst.onBookmarks) inst.onBookmarks();
}

// Pone o quita páginas de la pestaña Misión: [{ key, label }]. Se guarda una sola vez por llamada.
function setMissionPages(list, on) {
  const now = Date.now();
  list.forEach((p, i) => {
    if (!canBeInMission(p.key)) return;
    if (on) { if (!S.missionPages[p.key]) S.missionPages[p.key] = { label: p.label, at: now + i }; }
    else delete S.missionPages[p.key];
  });
  kb.storeSet(mpStoreOf(ctx.aircraft()), S.missionPages);
  for (const { inst: i } of instances.values()) if (i.onBookmarks) i.onBookmarks();
  renderChrome();
}

function setMissionPage(on) {
  const inst = curInst();
  const key = pageKeyOf(inst, curPage());
  if (!key) return;
  setMissionPages([{ key, label: inst.pageLabel ? inst.pageLabel(curPage()) : `Página ${curPage() + 1}` }], on);
  if (on) toast(`Página añadida a la pestaña Misión${ctx.aircraft() ? ` (solo en ${ctx.aircraft()})` : ''}`);
  closeOverlay();
}

function setBookmark(type) {
  const inst = curInst();
  const key = pageKeyOf(inst, curPage());
  if (!key) return;
  if (type) {
    S.bookmarks[key] = { type, label: inst.pageLabel ? inst.pageLabel(curPage()) : `Página ${curPage() + 1}`, tab: curTab().type, at: Date.now() };
    toast(`Marcador «${bmType(type).label}» en esta página${ctx.aircraft() ? ` (solo en ${ctx.aircraft()})` : ''}`);
  } else delete S.bookmarks[key];
  saveBookmarks();
  closeOverlay();
  renderChrome();
}

// Marcadores que se encuentran en una pestaña: [{ page, key, type, label }]
function bookmarksIn(tab) {
  const inst = getInstance(tab);
  if (!inst || !inst.findPage) return [];
  const out = [];
  for (const [key, b] of Object.entries(S.bookmarks)) {
    const page = inst.findPage(key);
    if (page != null && page >= 0) out.push({ page, key, ...b });
  }
  return out.sort((a, b) => a.page - b.page);
}

function gotoBookmark(tabIdx, page) {
  if (tabIdx !== tabIndex) switchTab(tabIdx, { manual: true });
  setPage(page, { manual: true });
  closeOverlay();
}

function cycleBookmark(dir) {
  const t = curTab();
  if (!t) return;
  const list = bookmarksIn(t);
  if (!list.length) {
    toast('Esta pestaña no tiene marcadores');
    return;
  }
  const p = curPage();
  const next = dir > 0 ? list.find((b) => b.page > p) || list[0] : [...list].reverse().find((b) => b.page < p) || list[list.length - 1];
  setPage(next.page, { manual: true });
}

// Primer marcador de un tipo, buscando primero en la pestaña actual.
function findBookmarkOfType(type) {
  const order = tabs().map((t, i) => i).sort((a, b) => (a === tabIndex ? -1 : b === tabIndex ? 1 : a - b));
  for (const i of order) {
    const t = tabs()[i];
    if (!TAB_TYPES[t.type] || !['dcs-kneeboard', 'library', 'folder', 'pdf'].includes(t.type)) continue;
    const b = bookmarksIn(t).find((x) => x.type === type);
    if (b) return { tab: i, page: b.page };
  }
  return null;
}

function openBookmarkMenu() {
  const inst = curInst();
  const key = pageKeyOf(inst, curPage());
  if (!key) return;
  const cur = S.bookmarks[key];
  openOverlay('Marcar esta página', h('div.bm-types',
    BOOKMARK_TYPES.map((t) => h('button.bm-type', { className: `bm-type${cur && cur.type === t.id ? ' sel' : ''}`, onclick: () => setBookmark(t.id) },
      h('span.tag', t.short), t.label)),
    cur ? h('button.btn', { onclick: () => setBookmark(null) }, icon('close'), ' Quitar el marcador') : null),
  canBeInMission(key) ? h('div', { style: { marginTop: '.9rem' } },
    h('div.h2', { style: { marginTop: 0 } }, 'Sin marcador'),
    S.missionPages[key]
      ? h('button.btn', { onclick: () => setMissionPage(false) }, icon('close'), ' Quitar de la pestaña Misión')
      : h('button.btn', { onclick: () => setMissionPage(true) }, icon('plus'), ' Añadir a la pestaña Misión'),
    h('div.muted', { style: { fontSize: '.75rem', marginTop: '.35rem' } }, cur
      ? 'Ya sale en Misión por su marcador. Así saldría también aunque le quites el marcador.'
      : 'La página sale en la pestaña Misión, pero no es un marcador: el modo AUTO no la abre y no está en la lista de marcadores.')) : null,
  h('div.muted', { style: { fontSize: '.78rem', marginTop: '.8rem', lineHeight: 1.45 } },
    'Cada avión tiene sus propios marcadores: lo que marques o quites aquí no cambia los de otros módulos. Se guardan aunque cierres el programa o DCS. Con el modo AUTO activado, al empezar cada fase del vuelo el kneeboard abre el marcador de ese tipo.'));
}

function openBookmarkList() {
  const groups = [];
  const seen = new Set();
  tabs().forEach((t, i) => {
    const list = bookmarksIn(t).filter((b) => !seen.has(b.key));
    list.forEach((b) => seen.add(b.key));
    if (list.length) groups.push({ t, i, list });
  });
  let filter = null;
  const body = h('div');
  const draw = () => {
    clear(body);
    body.append(h('div.chips', h('button.chip', { className: `chip${!filter ? ' sel' : ''}`, onclick: () => { filter = null; draw(); } }, 'Todos'),
      BOOKMARK_TYPES.map((bt) => h('button.chip', { className: `chip${filter === bt.id ? ' sel' : ''}`, onclick: () => { filter = bt.id; draw(); } }, bt.label))));
    let any = false;
    for (const g of groups) {
      const rows = g.list.filter((b) => !filter || b.type === filter);
      if (!rows.length) continue;
      any = true;
      body.append(h('div.h2', tabIcon(g.t), ' ', g.t.title));
      for (const b of rows) {
        body.append(h('div.bm-row',
          h('button.bm-go', { onclick: () => gotoBookmark(g.i, b.page) },
            h('span.tag', bmType(b.type).short), h('b', `p. ${b.page + 1}`), h('span', b.label || '')),
          h('button.btn.small', { title: 'Quitar', onclick: () => { delete S.bookmarks[b.key]; saveBookmarks(); g.list.splice(g.list.indexOf(b), 1); draw(); renderChrome(); } }, icon('close'))));
      }
    }
    if (!any) body.append(h('div.card.muted', 'No hay marcadores. Abre una página del Piernógrafo y pulsa el icono de marcador de arriba.'));
  };
  draw();
  openOverlay(`Marcadores${ctx.aircraft() ? ` · ${ctx.aircraft()}` : ''}`, body);
}

// ------------------------------------------------------------------ índice de páginas (miniaturas por juego)
function indexOf(inst) {
  return inst && inst.indexItems ? inst.indexItems() : [];
}

// Juegos de la pestaña: [{ group, page (primera), count }]
function sectionsOf(items) {
  const out = [];
  for (const it of items) {
    const last = out[out.length - 1];
    if (last && last.group === it.group) last.count++;
    else out.push({ group: it.group, page: it.page, count: 1 });
  }
  return out;
}

function currentSection(secs, p) {
  let i = 0;
  secs.forEach((s, k) => { if (s.page <= p) i = k; });
  return i;
}

// Saltar al juego siguiente / anterior (también con el HOTAS mientras el índice está abierto).
function stepSection(dir) {
  const secs = sectionsOf(indexOf(curInst()));
  if (secs.length < 2) return;
  const p = curPage();
  const i = currentSection(secs, p);
  // Hacia atrás: si estás a mitad de un juego, primero vuelve a su primera página.
  const target = dir > 0 ? secs[(i + 1) % secs.length] : p > secs[i].page ? secs[i] : secs[(i - 1 + secs.length) % secs.length];
  setPage(target.page, { manual: true });
  if (indexOpen) indexOpen.render();
  else toast(`${target.group} · ${target.count} págs.`, 'info', 1500);
}

function openIndex() {
  const t = curTab();
  const inst = curInst();
  const items = indexOf(inst);
  if (!items.length) return;
  const secs = sectionsOf(items);
  const body = h('div.idx');
  const chips = h('div.chips.idx-chips');
  // Las miniaturas se piden al verse (se generan una vez y quedan guardadas).
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const img = e.target;
      io.unobserve(img);
      kb.thumb(img.dataset.path).then((u) => { if (u) img.src = u; else img.classList.add('none'); });
    }
  }, { root: null, rootMargin: '300px' });
  const tiles = new Map();
  const groups = new Map();
  // Añadir a Misión desde el índice: un clic por página (o todo el juego de una vez), sin cerrar el índice.
  // En el índice de la propia pestaña Misión es al revés: cada página se quita (su marcador o su «sin marcador»)
  // y se puede volver a poner tal como estaba tocando otra vez.
  const inMision = t.type === 'dcs-kneeboard';
  const removed = new Map(); // key → { bm, mp } para deshacer
  const isOn = (it) => (inMision ? !removed.has(it.key) : !!S.missionPages[it.key]);
  const removeFromMision = (list) => {
    for (const it of list) {
      if (removed.has(it.key)) continue;
      removed.set(it.key, { bm: S.bookmarks[it.key], mp: S.missionPages[it.key] });
      delete S.bookmarks[it.key];
    }
    saveBookmarks();
    setMissionPages(list.map((it) => ({ key: it.key, label: it.label })), false);
  };
  const restoreToMision = (list) => {
    for (const it of list) {
      const r = removed.get(it.key);
      if (!r) continue;
      removed.delete(it.key);
      if (r.bm) S.bookmarks[it.key] = r.bm;
      if (r.mp) S.missionPages[it.key] = r.mp;
    }
    saveBookmarks();
    kb.storeSet(mpStoreOf(ctx.aircraft()), S.missionPages);
    renderChrome();
  };
  const toggleOne = (it) => {
    if (inMision) (removed.has(it.key) ? restoreToMision : removeFromMision)([it]);
    else setMissionPages([{ key: it.key, label: it.label }], !S.missionPages[it.key]);
    paintMis();
  };
  const misToggles = [];
  const misLabel = (on) => (inMision
    ? (on ? 'Quitar de la pestaña Misión' : 'Quitada: toca para volver a ponerla')
    : (on ? 'En Misión: toca para quitarla' : 'Añadir a la pestaña Misión'));
  const paintMis = () => {
    for (const m of misToggles) {
      const on = isOn(m.it);
      m.el.classList.toggle('on', inMision ? false : on);
      m.el.classList.toggle('rm', inMision && on);
      m.el.title = misLabel(on);
      m.el.replaceChildren(icon(inMision ? (on ? 'close' : 'undo') : (on ? 'check' : 'plus')));
      m.tile.classList.toggle('in-mis', !inMision && on);
      m.tile.classList.toggle('removed', inMision && !on);
    }
    for (const g of groupMis) {
      const all = g.list.length && g.list.every(isOn);
      if (inMision) g.btn.replaceChildren(icon(all ? 'close' : 'undo'), all ? ' Quitar el grupo de Misión' : ' Volver a ponerlo');
      else g.btn.replaceChildren(icon(all ? 'close' : 'plus'), all ? ' Quitar el juego de Misión' : ' Añadir todo el juego a Misión');
      g.all = all;
    }
  };
  const groupMis = [];
  for (const s of secs) {
    const grid = h('div.idx-grid');
    const inMis = items.slice(s.page, s.page + s.count).filter((it) => canBeInMission(it.key));
    const g = { list: inMis, all: false, btn: null };
    if (inMis.length) {
      g.btn = h('button.btn.small.idx-mis-all', {
        onclick: () => {
          if (inMision) (g.all ? removeFromMision : restoreToMision)(inMis);
          else setMissionPages(inMis.map((it) => ({ key: it.key, label: it.label })), !g.all);
          paintMis();
        },
      });
      groupMis.push(g);
    }
    const head = h('div.idx-head', h('b', s.group), h('span.muted', `${s.count} págs.`), g.btn ? h('span.grow') : null, g.btn);
    groups.set(s.page, head);
    body.append(head, grid);
    for (const it of items.slice(s.page, s.page + s.count)) {
      const bm = it.key ? S.bookmarks[it.key] : null;
      const img = h('img', { alt: '', draggable: false, 'data-path': it.path || '' });
      const mis = canBeInMission(it.key) ? h('span.idx-mis', {
        role: 'button',
        onclick: (e) => {
          e.stopPropagation();
          toggleOne(it);
        },
      }) : null;
      const tile = h('button.idx-tile', { title: it.label, onclick: () => {
        if (inMision && removed.has(it.key)) return;
        const now = it.key ? indexOf(curInst()).find((x) => x.key === it.key) : null;
        setPage(now ? now.page : it.page, { manual: true });
        closeOverlay();
      } },
        h('div.idx-img', img, bm ? h('span.tag.idx-bm', bmType(bm.type).short) : null, mis),
        h('span.idx-n', String(it.page + 1)), h('span.idx-l', it.label));
      if (mis) misToggles.push({ el: mis, it, tile });
      tiles.set(it.page, tile);
      grid.append(tile);
      if (it.path) io.observe(img);
    }
  }
  paintMis();
  const render = () => {
    const p = curPage();
    const si = currentSection(secs, p);
    clear(chips).append(...secs.map((s, k) => h('button.chip', {
      className: `chip${k === si ? ' sel' : ''}`,
      onclick: () => { groups.get(s.page).scrollIntoView({ block: 'start', behavior: 'smooth' }); },
    }, s.group, h('small', ` ${s.count}`))));
    for (const [pg, tile] of tiles) tile.classList.toggle('sel', pg === p);
    const sel = tiles.get(p);
    if (sel) sel.scrollIntoView({ block: 'center' });
  };
  openOverlay(`Índice · ${t.title}`, chips, body,
    h('div.muted.idx-help', inMision && misToggles.length
      ? 'Toca una página para abrirla, o su «×» para quitarla de Misión (quita su marcador). Si te equivocas, tócala otra vez y vuelve como estaba. Con el HOTAS: «Página siguiente / anterior» salta de grupo mientras el índice está abierto.'
      : misToggles.length
      ? `Toca una página para abrirla, o su «+» para añadirla a la pestaña Misión (sin marcador; solo en ${ctx.aircraft() || 'este avión'}). Con el HOTAS: «Página siguiente / anterior» salta de juego mientras el índice está abierto, y la acción «Índice de páginas» lo cierra.`
      : 'Toca una página para abrirla. Con el HOTAS: «Página siguiente / anterior» salta de juego mientras el índice está abierto, y la acción «Índice de páginas» lo cierra.'));
  $('overlay').classList.add('wide');
  indexOpen = { render, io };
  requestAnimationFrame(render);
}

// ------------------------------------------------------------------ ventana superpuesta (menús)
function openOverlay(title, ...content) {
  const ov = $('overlay');
  clear(ov).append(h('div.ov-panel',
    h('div.ov-head', h('b', title), h('span.bar-spacer'), h('button.btn.small', { onclick: closeOverlay, title: 'Cerrar' }, icon('close'))),
    h('div.ov-body', ...content)));
  ov.hidden = false;
}

function closeOverlay() {
  $('overlay').hidden = true;
  $('overlay').classList.remove('wide');
  if (indexOpen) { indexOpen.io.disconnect(); indexOpen = null; }
}

function openAllTabs() {
  const grid = h('div.tabgrid');
  const draw = () => clear(grid).append(...tabs().map((t, i) => h('div.tabtile-wrap',
    h('button.tabtile', { className: `tabtile${i === tabIndex ? ' sel' : ''}${t.fav ? ' fav' : ''}`, onclick: () => switchTab(i, { manual: true }) },
      tabIcon(t), h('span', t.title), t.type === 'shared' && inboxNew() ? h('span.badge', inboxNew()) : null),
    h('button.favbtn', {
      className: `favbtn${t.fav ? ' on' : ''}`,
      title: t.fav ? 'Quitar de la barra' : 'Fijar en la barra',
      onclick: () => {
        const list = tabs().map((x, k) => (k === i ? { ...x, fav: !x.fav } : x));
        kb.patchConfig({ tabs: list });
        t.fav = !t.fav;
        draw();
      },
    }, icon('star', t.fav ? 'filled' : '')))));
  draw();
  const presets = S.config.tabPresets || [];
  openOverlay('Pestañas', grid,
    presets.length ? h('div.preset-chips',
      h('span.label', 'Presets'),
      ...presets.map((p) => h('button.chip', { className: `chip${S.config.activePreset === p.id ? ' sel' : ''}`, onclick: () => { kb.applyPreset(p.id); closeOverlay(); } }, p.name))) : null,
    h('div.muted', { style: { fontSize: '.75rem', marginTop: '.7rem', lineHeight: 1.4 } },
      'La estrella fija la pestaña en la barra de abajo; el resto se abre desde aquí. Guarda tus juegos de pestañas como presets en Ajustes > Pestañas.'));
}

// Ir a una página escribiendo su número.
function openGoto(initial = '') {
  const inst = curInst();
  const count = pageCount(inst);
  if (count < 2 && !(inst && inst.endless)) return;
  const ind = $('pageInd');
  const input = h('input.goto', { type: 'number', min: 1, max: count, value: initial, placeholder: `1–${count}` });
  ind.replaceChildren(input);
  input.focus();
  if (initial) input.setSelectionRange && input.select();
  const done = (go) => {
    const n = parseInt(input.value, 10);
    input.remove();
    if (go && n >= 1) setPage(n - 1, { manual: true });
    else renderChrome();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') done(true);
    if (e.key === 'Escape') done(false);
    e.stopPropagation();
  });
  input.addEventListener('blur', () => done(true));
}

// ------------------------------------------------------------------ cromo (barra y pestañas)
function renderChrome() {
  const t = curTab();
  const inst = t && instances.get(t.id) && instances.get(t.id).inst;
  $('tabIcon').replaceChildren(t ? tabIcon(t) : '');
  $('tabTitle').textContent = t ? t.title : 'Sin pestañas';
  const count = pageCount(inst);
  const ind = $('pageInd');
  if (!ind.querySelector('input')) {
    ind.textContent = inst && (count > 1 || inst.endless) ? `${curPage() + 1}/${inst.endless ? Math.max(count, curPage() + 1) : count}` : '';
  }
  ind.style.display = ind.textContent || ind.querySelector('input') ? '' : 'none';

  const key = pageKeyOf(inst, curPage());
  const bm = key ? S.bookmarks[key] : null;
  const bmBtn = $('bmBtn');
  bmBtn.style.display = key ? '' : 'none';
  bmBtn.replaceChildren(icon(bm ? 'bookmark' : 'bookmark', bm ? 'filled' : ''), bm ? h('span.bm-short', bmType(bm.type).short) : '');
  bmBtn.classList.toggle('on', !!bm);
  $('bmListBtn').style.display = inst && inst.findPage ? '' : 'none';
  $('idxBtn').style.display = inst && inst.indexItems && count > 1 ? '' : 'none';

  const auto = S.config.auto.enabled;
  const pill = $('autoPill');
  pill.classList.toggle('on', auto);
  const ph = S.phases.find((p) => p.id === S.phase);
  pill.textContent = auto ? `AUTO${ph ? ` · ${ph.label.replace(/ \(.*\)/, '')}` : ''}` : 'AUTO';

  const st = $('status');
  clear(st);
  const ds = S.connected ? 'on' : S.dcsState === 'open' ? 'open' : 'off';
  const dsTitle = { on: 'DCS conectado', open: 'DCS está abierto pero no llegan datos: entra en una misión. Si ya estás en una, reinicia DCS (el script se carga al arrancar).', off: 'DCS cerrado' }[ds];
  st.append(h('span.dot', { className: `dot${ds === 'on' ? ' on' : ds === 'open' ? ' warn' : ''}`, title: dsTitle }), h('span', { title: dsTitle }, ds === 'open' ? 'DCS · sin datos' : 'DCS'));
  if (S.vrActive) st.append(h('span.tag', { title: 'Mostrándose en el visor' }, icon('vr')));
  if (S.share.status === 'conectado') st.append(h('span.tag', { title: `Sala: ${S.share.members.join(', ')}` }, icon('users'), ` ${S.share.members.length}`));
  if (document.hasFocus()) st.append(h('span.tag', { title: 'Modo escritura: el teclado escribe en el kneeboard' }, icon('keyboard')));

  const bar = $('tabs');
  const scroll = bar.scrollLeft;
  clear(bar);
  // Si hay favoritas, la barra enseña solo esas (y la que estés viendo); las demás están en la cuadrícula.
  const anyFav = tabs().some((x) => x.fav);
  let hiddenInbox = false;
  tabs().forEach((tab, i) => {
    const badge = tab.type === 'shared' && inboxNew() ? h('span.badge', inboxNew()) : null;
    if (anyFav && !tab.fav && i !== tabIndex) {
      if (badge) hiddenInbox = true;
      return;
    }
    bar.append(h('button.tab', {
      className: `tab${i === tabIndex ? ' sel' : ''}${anyFav && !tab.fav ? ' temp' : ''}`,
      title: tab.title,
      onclick: () => switchTab(i, { manual: true }),
    }, h('span.ti', tabIcon(tab)), h('span.tl', tab.title), badge));
  });
  // Algo nuevo en «Compartido» sin estar en la barra: aviso en el botón de la cuadrícula.
  $('allTabs').classList.toggle('has-badge', hiddenInbox);
  $('allTabs').dataset.badge = hiddenInbox ? String(inboxNew()) : '';
  bar.scrollLeft = scroll;
  const sel = bar.querySelector('.tab.sel');
  if (sel) sel.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  updateTabArrows();
  $('inkBtn').style.display = inst && inst.inkKey ? '' : 'none';
  $('inkBtn').classList.toggle('on', $('content').classList.contains('inking'));
  $('dualBtn').classList.toggle('on', !!S.config.dual);
  $('nightBtn').classList.toggle('on', !!S.config.night);
}

function updateTabArrows() {
  const bar = $('tabs');
  bar.classList.toggle('fade-l', bar.scrollLeft > 4);
  bar.classList.toggle('fade-r', bar.scrollLeft + bar.clientWidth < bar.scrollWidth - 4);
}

function tickClock() {
  const l = S.live;
  if (l && l.missionTime != null) {
    $('clock').textContent = hms(l.missionTime);
    $('clock').title = 'Hora de la misión';
  } else {
    const d = new Date();
    $('clock').textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    $('clock').title = 'Hora local';
  }
}

// ------------------------------------------------------------------ avisos
function toast(text, kind = 'info', ms = 3200) {
  const el = h('div.toast', { className: `toast ${kind}` }, text);
  $('toasts').append(el);
  setTimeout(() => el.classList.add('out'), ms);
  setTimeout(() => el.remove(), ms + 400);
}

// ------------------------------------------------------------------ modo automático
function onPhase(p) {
  S.phase = p;
  renderChrome();
  if (!S.config.auto.enabled || !p) return;
  if (S.config.dual && S.activeView !== kb.view) return;
  if (Date.now() - lastManual < S.config.auto.pauseSec * 1000) return;
  const ph = S.phases.find((x) => x.id === p);
  // 1) Tus marcadores de esa fase
  const bm = findBookmarkOfType(p);
  if (bm) {
    if (bm.tab !== tabIndex) switchTab(bm.tab);
    setPage(bm.page);
    toast(`${ph ? ph.label : p} → marcador de ${tabs()[bm.tab].title}, p. ${bm.page + 1}`, 'info', 2500);
    return;
  }
  // 2) La pestaña que hayas asignado a esa fase en Ajustes > Pestañas
  const i = tabs().findIndex((t) => (t.phases || []).includes(p));
  if (i < 0 || i === tabIndex) return;
  switchTab(i);
  toast(`${ph ? ph.label : p} → ${tabs()[i].title}`, 'info', 2500);
}

// ------------------------------------------------------------------ coordenadas
function addPoint(p, { quiet = false } = {}) {
  const t = tabs().find((x) => x.type === 'notes');
  if (!t) {
    toast('Añade una pestaña «Bloc» para guardar coordenadas', 'warn');
    return;
  }
  const inst = getInstance(t);
  inst.addPoint(p);
  if (!quiet) {
    const f = Geo.formatPoint(p, p.type || ctx.aircraft())[0];
    toast(h('span', icon('pin'), ` ${f ? f.v : 'Punto'} añadido al bloc`), 'info', 4000);
  }
}

// ------------------------------------------------------------------ acciones del HOTAS
function onAction(a) {
  const inst = curInst();
  // Con el índice abierto, pasar página salta de juego.
  if (indexOpen && (a === 'next_page' || a === 'prev_page')) { stepSection(a === 'next_page' ? 1 : -1); return; }
  if (inst && inst.onAction && inst.onAction(a)) return;
  switch (a) {
    case 'open_index': if (indexOpen) closeOverlay(); else openIndex(); break;
    case 'next_section': stepSection(1); break;
    case 'prev_section': stepSection(-1); break;
    case 'next_page': setPage(curPage() + 1, { manual: true }); break;
    case 'prev_page': setPage(curPage() - 1, { manual: true }); break;
    case 'next_tab': stepTab(1); break;
    case 'prev_tab': stepTab(-1); break;
    case 'next_bookmark': cycleBookmark(1); break;
    case 'next_wp':
    case 'prev_wp': {
      const fp = ctx.instance('flightplan');
      if (fp && fp.stepWp) fp.stepWp(a === 'next_wp' ? 1 : -1);
      break;
    }
    case 'prev_bookmark': cycleBookmark(-1); break;
    case 'share_page': sharePage(); break;
    case 'open_shared': ctx.goToType('shared'); break;
    default: break;
  }
}

function sharePage() {
  const t = curTab();
  if (!t) return;
  const inst = getInstance(t);
  const title = inst && inst.title ? inst.title(curPage()) : t.title;
  // Si la pestaña tiene datos que copiar (tarjeta, nombres de puntos, presets, plantillas), van con la imagen.
  const data = inst && inst.shareData ? inst.shareData(curPage()) : null;
  kb.sharePage(title, data ? { ...data, tabType: t.type } : null);
}

// ------------------------------------------------------------------ tema y apariencia
function applyLook() {
  const c = S.config;
  const theme = THEMES.find((t) => t.id === c.theme) ? c.theme : 'tablet';
  document.body.dataset.theme = theme;
  document.body.classList.toggle('night', !!c.night);
  document.body.classList.toggle('active-view', !!c.dual && S.activeView === kb.view);
  document.body.classList.toggle('vr-only', !!(c.vr.enabled && c.vr.hideWindow));
  document.body.classList.toggle('anim-fade', c.stowAnim === 'fade');
  document.body.classList.toggle('anim-none', c.stowAnim === 'none');
  document.documentElement.style.setProperty('--ui-scale', String(c.uiScale || 1));
}

function setGaze(g) {
  const c = S.config.vr;
  document.documentElement.style.setProperty('--gaze-opacity', S.vrActive ? String(g ? c.opacityGaze : c.opacityIdle) : '1');
}

// ------------------------------------------------------------------ redimensionar (ventana transparente)
function setupGrip() {
  const grip = h('div.grip', { title: 'Arrastra para cambiar el tamaño del kneeboard' });
  document.getElementById('kb').append(grip);
  let start = null;
  grip.addEventListener('pointerdown', (e) => {
    start = { x: e.screenX, w: window.innerWidth };
    grip.setPointerCapture(e.pointerId);
  });
  grip.addEventListener('pointermove', (e) => {
    if (!start) return;
    kb.resize(Math.max(320, Math.round(start.w + (e.screenX - start.x))));
  });
  grip.addEventListener('pointerup', () => { start = null; kb.resizeDone(); });
}

// ------------------------------------------------------------------ tableta gráfica
// El lápiz llega de main.js (OTD-IPC) ya en coordenadas de la ventana (0..1). Se dibuja un cursor, que también
// sale en el visor porque es parte de la página, y el lápiz se convierte en eventos de lápiz (pointerType «pen»)
// sobre lo que haya debajo: el lápiz de las páginas, la pizarra, el Bloc a mano, botones y pestañas.
const pen = { el: null, down: null };
function onTabletPen(m) {
  if (!pen.el) {
    pen.el = h('div.tablet-cursor', { hidden: true });
    document.body.append(pen.el);
  }
  const W = window.innerWidth, H = window.innerHeight;
  const x = (m.x || 0) * W, y = (m.y || 0) * H;
  const fire = (target, type, extra = {}) => target && target.dispatchEvent(new PointerEvent(type, {
    pointerId: 9001, pointerType: 'pen', isPrimary: true, bubbles: true, cancelable: true, composed: true,
    clientX: x, clientY: y, pressure: m.p || 0.5, button: 0, buttons: 0, ...extra,
  }));
  if (!m.active) {
    pen.el.hidden = true;
    if (pen.down) { fire(pen.down.target, 'pointerup'); pen.down = null; }
    return;
  }
  pen.el.hidden = false;
  pen.el.style.transform = `translate(${x}px, ${y}px)`;
  pen.el.classList.toggle('touch', !!m.touch);
  pen.el.classList.toggle('erase', !!m.erase);
  const buttons = m.erase ? 32 : 1;
  if (m.touch && !pen.down) {
    const target = document.elementFromPoint(x, y);
    if (!target) return;
    pen.down = { target, x, y, moved: false };
    fire(target, 'pointerdown', { buttons, button: m.erase ? 5 : 0 });
  } else if (m.touch && pen.down) {
    if (Math.hypot(x - pen.down.x, y - pen.down.y) > 6) pen.down.moved = true;
    fire(pen.down.target, 'pointermove', { buttons });
  } else if (!m.touch && pen.down) {
    const d = pen.down;
    pen.down = null;
    fire(d.target, 'pointerup');
    // Un toque sin arrastrar es un clic (botones, pestañas, enlaces); en un campo de texto, además, lo enfoca.
    if (!d.moved && document.contains(d.target)) {
      d.target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
      if (d.target.matches('input, textarea, select')) d.target.focus();
    }
  } else {
    const target = document.elementFromPoint(x, y);
    if (target) fire(target, 'pointermove');
  }
}

// ------------------------------------------------------------------ arranque
async function main() {
  const init = await kb.init();
  Object.assign(S, {
    config: init.config, mission: init.mission, live: init.live, phase: init.phase, connected: init.connected,
    messages: init.messages || [], inbox: init.inbox || [], timers: init.timers, activeView: init.activeView,
    share: init.share, vrActive: init.vrActive, phases: init.phases, actions: init.actions, blocks: init.blocks, dcsState: init.dcsState,
  });
  if (S.config.hidden) document.body.classList.add('kb-out');
  S.bookmarks = {};
  S.missionPages = {};
  await loadBookmarks();
  S.wpNames = (await kb.storeGet('wpnames')) || {};
  const vs = (S.config.views[kb.view] || {}).state || {};
  tabIndex = Math.min(vs.tab || 0, Math.max(0, tabs().length - 1));
  pages = vs.pages || {};

  ink = new Ink($('content'), ctx);
  applyLook();
  setupGrip();

  $('allTabs').append(icon('grid'));
  $('prevPage').append(icon('prev'));
  $('nextPage').append(icon('next'));
  $('inkBtn').append(icon('pen'));
  $('shareBtn').append(icon('send'));
  $('settingsBtn').append(icon('settings'));
  $('dualBtn').append(icon('dual'));
  $('dualBtn').onclick = () => kb.action('toggle_dual');
  $('nightBtn').append(icon('moon'));
  $('nightBtn').onclick = () => kb.action('toggle_night');
  $('bmListBtn').append(icon('bookmarks'));
  $('idxBtn').append(icon('index'));
  $('idxBtn').onclick = openIndex;

  $('allTabs').onclick = openAllTabs;
  $('prevPage').onclick = () => setPage(curPage() - 1, { manual: true });
  $('nextPage').onclick = () => setPage(curPage() + 1, { manual: true });
  $('pageInd').onclick = () => { if (!$('pageInd').querySelector('input')) openGoto(); };
  $('bmBtn').onclick = openBookmarkMenu;
  $('bmListBtn').onclick = openBookmarkList;
  $('autoPill').onclick = () => kb.action('toggle_auto');
  $('settingsBtn').onclick = () => kb.openSettings();
  $('shareBtn').onclick = sharePage;
  $('inkBtn').onclick = () => {
    $('content').classList.toggle('inking');
    renderChrome();
  };

  // Pestañas: la rueda del ratón las desplaza en horizontal; también se pueden arrastrar.
  const bar = $('tabs');
  bar.addEventListener('wheel', (e) => {
    e.preventDefault();
    bar.scrollLeft += (Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX);
    updateTabArrows();
  }, { passive: false });
  let drag = null;
  bar.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, s: bar.scrollLeft, moved: false }; });
  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (Math.abs(dx) > 6) drag.moved = true;
    if (drag.moved) { bar.scrollLeft = drag.s - dx; updateTabArrows(); }
  });
  window.addEventListener('pointerup', () => { if (drag && drag.moved) bar.addEventListener('click', (e) => e.stopPropagation(), { capture: true, once: true }); drag = null; });
  bar.addEventListener('scroll', updateTabArrows);

  // Solo un clic de verdad activa la ventana: el lápiz de la tableta (eventos sintéticos) no le quita el foco a DCS.
  document.addEventListener('pointerdown', (e) => { if (e.isTrusted) kb.activate(); }, true);
  kb.on('tablet', onTabletPen);
  window.addEventListener('focus', renderChrome);
  window.addEventListener('blur', renderChrome);
  document.addEventListener('visibilitychange', updateCoordsFlag);
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, webview, [contenteditable]')) return;
    if (e.key === 'PageDown' || e.key === 'ArrowRight') setPage(curPage() + 1, { manual: true });
    if (e.key === 'PageUp' || e.key === 'ArrowLeft') setPage(curPage() - 1, { manual: true });
    if (/^[0-9]$/.test(e.key)) openGoto(e.key);
    if (e.key === 'Escape') { if (!$('overlay').hidden) closeOverlay(); else kb.focusDcs(); }
  });
  $('content').addEventListener('wheel', (e) => {
    if (e.ctrlKey) {
      // Ctrl + rueda: tamaño de textos y botones
      const v = Math.max(0.7, Math.min(1.6, Math.round(((S.config.uiScale || 1) + (e.deltaY < 0 ? 0.05 : -0.05)) * 100) / 100));
      kb.patchConfig({ uiScale: v });
      return;
    }
    const inst = curInst();
    if (!inst || !inst.wheelPages) return;
    if (Math.abs(e.deltaY) < 30) return;
    setPage(curPage() + (e.deltaY > 0 ? 1 : -1), { manual: true });
  }, { passive: true });

  const each = (fn) => { for (const { inst } of instances.values()) fn(inst); };

  kb.on('config', (c) => {
    const tabsChanged = JSON.stringify(c.tabs) !== JSON.stringify(S.config.tabs);
    S.config = c;
    applyLook();
    if (tabsChanged) {
      const ids = new Set(c.tabs.map((t) => t.id));
      for (const id of [...instances.keys()]) if (!ids.has(id)) destroyInstance(id);
      tabIndex = Math.min(tabIndex, Math.max(0, c.tabs.length - 1));
      show();
    } else renderChrome();
    each((i) => i.onConfig && i.onConfig(c));
  });
  kb.on('store-changed', (name, data) => {
    if (name === 'wpnames') { S.wpNames = data || {}; each((i) => i.onConfig && i.onConfig(S.config)); return; }
    if (name === mpStoreOf(ctx.aircraft())) { S.missionPages = data || {}; each((i) => i.onBookmarks && i.onBookmarks()); renderChrome(); return; }
    if (name !== S.bmStore) return;
    S.bookmarks = data || {};
    each((i) => i.onBookmarks && i.onBookmarks());
    renderChrome();
  });
  // Guardar / sacar el kneeboard (ver setHidden en main.js).
  kb.on('visibility', (visible) => {
    // Guardado ya no oculta la ventana (se aparca fuera de la pantalla): el aviso de la página Coordenadas va por aquí.
    if (S.config) S.config = { ...S.config, hidden: !visible };
    updateCoordsFlag();
    const b = document.body;
    clearInterval(S.warmTimer);
    if (!visible) {
      b.classList.remove('kb-in'); b.classList.add('kb-out');
      // Guardado, la página no cambia y la tarjeta gráfica deja de usar sus texturas: al rato, con DCS pidiendo
      // memoria de vídeo, Windows las saca de ella y al volver a sacarlo la animación da tirones. Cambiar cada
      // segundo una opacidad que no se ve (.001 / .0011) hace que se vuelvan a componer sin pintar nada nuevo.
      S.warmTimer = setInterval(() => { b.classList.add('kb-parked'); b.classList.toggle('kb-warm'); }, 1000);
      return;
    }
    b.classList.remove('kb-out', 'kb-in', 'kb-warm', 'kb-parked');
    void b.offsetWidth; // reinicia la animación de entrada
    b.classList.add('kb-in');
    if (S.config && S.config.stowAnim === 'none') b.classList.remove('kb-in');
  });
  document.getElementById('kb').addEventListener('animationend', (e) => { if (e.animationName === 'kbIn') document.body.classList.remove('kb-in'); });
  kb.on('mission', (m) => { S.mission = m; loadBookmarks(); each((i) => i.onMission && i.onMission(m)); show(); });
  kb.on('live', (l) => {
    S.live = l;
    if (bmStoreOf(ctx.aircraft()) !== S.bmStore) loadBookmarks();
    each((i) => i.onLive && i.onLive(l));
  });
  kb.on('phase', onPhase);
  kb.on('connected', (c) => { S.connected = c; renderChrome(); });
  kb.on('dcs-state', (s) => { S.dcsState = s; renderChrome(); });
  kb.on('dcs-message', (m) => { S.messages.push(m); each((i) => i.onMessage && i.onMessage(m)); });
  kb.on('messages-cleared', () => { S.messages.length = 0; each((i) => i.onMessage && i.onMessage(null)); });
  kb.on('inbox', (list) => { S.inbox = list; each((i) => i.onInbox && i.onInbox(list)); renderChrome(); });
  kb.on('timers', (t) => { S.timers = t; each((i) => i.onTimers && i.onTimers(t)); });
  kb.on('action', onAction);
  kb.on('goto-tab', (i) => switchTab(i, { manual: true }));
  kb.on('goto-page', (n) => setPage(n, { manual: true }));
  kb.on('goto-bookmark', (type) => {
    const bm = findBookmarkOfType(type);
    if (bm) gotoBookmark(bm.tab, bm.page);
    else toast(`No tienes marcadores de «${bmType(type).label}»`, 'warn');
  });
  kb.on('library-changed', () => each((i) => i.onLibrary && i.onLibrary()));
  kb.on('blocks', (b) => { S.blocks = b; each((i) => i.onBlocks && i.onBlocks(b)); });
  kb.on('logbook', (l) => each((i) => i.onLogbook && i.onLogbook(l)));
  kb.on('voice-listening', (on) => { if (on && (!S.config.dual || kb.view === S.activeView)) toast(h('span', icon('mic'), ' Escuchando…'), 'info', 1500); });
  kb.on('active-view', (v) => { S.activeView = v; applyLook(); });
  kb.on('coords', (p) => { if (!S.config.dual || kb.view === 0) addPoint(p); });
  kb.on('toast', ({ text, kind }) => { if (!S.config.dual || kb.view === S.activeView) toast(text, kind); });
  kb.on('share-status', (s) => { S.share = s; renderChrome(); each((i) => i.onShareStatus && i.onShareStatus(s)); });
  kb.on('share-roster', (m) => { S.share.members = m; renderChrome(); });
  kb.on('share-live', (item) => each((i) => i.onShareLive && i.onShareLive(item)));
  kb.on('vr-active', (a) => { S.vrActive = a; setGaze(false); renderChrome(); });
  kb.on('gaze', setGaze);
  kb.on('write-mode', () => setTimeout(renderChrome, 50));

  show();
  // Las pestañas con marcadores se cargan ya, para que el modo automático y la lista los encuentren.
  for (const t of tabs()) if (['dcs-kneeboard', 'library'].includes(t.type)) getInstance(t);
  tickClock();
  setInterval(tickClock, 1000);
  window.addEventListener('resize', () => { updateTabArrows(); each((i) => i.onResize && i.onResize()); });
}

main();
