// Pestañas de documentos: carpeta de imágenes, kneeboard de DCS, PDF, página web / archivo local y captura de ventana.
import { icon } from '../icons.js';
import { bmType } from '../bookmarks.js';
import { h, clear, emptyState, debounce } from '../util.js';

// ------------------------------------------------------------------ imágenes (carpeta y kneeboard de DCS)
// Cada página se monta aparte y solo se cambia por la anterior cuando ya está lista (imagen decodificada o
// página de PDF dibujada): pasar de una imagen a un PDF, o al revés, no deja ningún hueco ni parpadeo. Las
// páginas de al lado se preparan antes de que llegues a ellas. Imágenes y PDF se ajustan igual al hueco.
const isPdfItem = (it) => !!(it && it.pdf);
const itemName = (it) => it.name.replace(/\.\w+$/, '') + (isPdfItem(it) && it.pageCount > 1 ? ` · pág. ${it.pageNo}` : '');

function fitBox(nw, nh, bw, bh) {
  const s = Math.min(bw / nw, bh / nh);
  return { w: Math.max(1, Math.floor(nw * s)), h: Math.max(1, Math.floor(nh * s)) };
}

// Documentos PDF abiertos (uno por archivo, compartido por todas sus páginas).
const pdfDocs = new Map();
async function openPdf(ctx, file) {
  if (!pdfDocs.has(file)) {
    pdfDocs.set(file, (async () => {
      const lib = await loadPdfJs();
      const url = await ctx.kb.fileUrl(file);
      return lib.getDocument({ url, isEvalSupported: false }).promise;
    })().catch((e) => { pdfDocs.delete(file); throw e; }));
  }
  return pdfDocs.get(file);
}

// Lista de una carpeta con los PDF desplegados: una entrada por página, en el orden de los archivos.
async function expandPdfs(ctx, files) {
  const out = [];
  for (const f of files) {
    if (!/\.pdf$/i.test(f.name)) { out.push(f); continue; }
    try {
      const doc = await openPdf(ctx, f.path);
      for (let n = 1; n <= doc.numPages; n++) out.push({ ...f, pdf: true, pageNo: n, pageCount: doc.numPages });
    } catch (e) {
      console.warn('PDF', f.path, e.message);
    }
  }
  return out;
}

function imagePages(ctx, tab, loader, emptyMsg, opts = {}) {
  const area = h('div.flush.doc');
  const el = opts.bar ? h('div.flush.folderwrap', opts.bar, area) : area;
  let list = [];
  let page = 0;
  let loadedFor = null;
  let seq = 0;
  const ready = new Map(); // clave de página → { node, w, h } ya montada (las de al lado)

  async function load(force) {
    const key = loader.key();
    if (!force && key === loadedFor) return;
    loadedFor = key;
    const raw = await loader.list();
    list = raw.some((f) => /\.pdf$/i.test(f.name)) ? await expandPdfs(ctx, raw) : raw;
    ready.clear();
    render();
    ctx.refresh();
  }

  const boxOf = () => {
    const r = area.getBoundingClientRect();
    return { w: r.width, h: r.height };
  };
  const readyKey = (it, box) => `${it.path || it.url}#${it.pageNo || 0}@${Math.round(box.w)}x${Math.round(box.h)}`;

  // Monta la página en un elemento nuevo, sin tocar lo que se ve.
  async function build(it, box) {
    const k = readyKey(it, box);
    if (ready.has(k)) return ready.get(k);
    const job = (async () => {
      const dpr = window.devicePixelRatio || 1;
      if (isPdfItem(it)) {
        const doc = await openPdf(ctx, it.path);
        const pg = await doc.getPage(it.pageNo);
        const vp1 = pg.getViewport({ scale: 1 });
        const fit = fitBox(vp1.width, vp1.height, box.w, box.h);
        const vp = pg.getViewport({ scale: (fit.w / vp1.width) * dpr });
        const canvas = h('canvas.page');
        canvas.width = Math.floor(vp.width);
        canvas.height = Math.floor(vp.height);
        canvas.style.width = `${fit.w}px`;
        canvas.style.height = `${fit.h}px`;
        await pg.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
        canvas.title = it.name;
        return canvas;
      }
      const img = h('img', { draggable: false, alt: '' });
      img.title = it.name;
      img.src = it.url;
      try { await img.decode(); } catch { /* imagen rota: se enseña igual */ }
      const fit = img.naturalWidth ? fitBox(img.naturalWidth, img.naturalHeight, box.w, box.h) : null;
      if (fit) { img.style.width = `${fit.w}px`; img.style.height = `${fit.h}px`; }
      return img;
    })();
    ready.set(k, job);
    job.catch(() => ready.delete(k));
    // No guardar más de unas pocas páginas preparadas (las de alrededor).
    while (ready.size > 7) ready.delete(ready.keys().next().value);
    return job;
  }

  async function render() {
    const my = ++seq;
    if (!list.length) {
      clear(area);
      area.append(emptyMsg());
      return;
    }
    const box = boxOf();
    if (!box.w || !box.h) return; // pestaña oculta: se monta al enseñarla
    const p = Math.min(page, list.length - 1);
    let node;
    try {
      node = await build(list[p], box);
    } catch (e) {
      node = emptyState(icon('pdf'), 'No se pudo abrir', `${list[p].name}: ${e.message}`);
    }
    if (my !== seq) return; // ya has pasado a otra página
    if (area.firstChild !== node) area.replaceChildren(node);
    // Prepara las de alrededor (la siguiente primero) para que pasar de página sea inmediato.
    for (const q of [p + 1, p - 1, p + 2]) if (list[q]) build(list[q], box).catch(() => {});
  }

  const rerender = debounce(() => { ready.clear(); render(); }, 150);

  load(true);
  return {
    el,
    wheelPages: true,
    pages: () => list.length,
    show(p) { page = p; load(); render(); },
    inkKey: (p) => (list[p] ? `${tab.id}:${list[p].name}${isPdfItem(list[p]) ? `#${list[p].pageNo}` : ''}` : null),
    title: (p) => (list[p] ? `${tab.title} — ${itemName(list[p])}` : tab.title),
    // Marcadores: clave estable de cada página (sobrevive a reinicios) y búsqueda por clave.
    pageKey: (p) => (list[p] ? loader.keyOf(list[p]) : null),
    pageLabel: (p) => (list[p] ? (loader.labelOf ? loader.labelOf(list[p]) : itemName(list[p])) : ''),
    findPage: (key) => list.findIndex((it) => loader.keyOf(it) === key),
    // Índice: cada página con su grupo (juego de la biblioteca, tipo de marcador…) y el archivo para la miniatura.
    // Las páginas de un PDF no tienen archivo propio: su miniatura se dibuja aquí.
    indexItems: () => list.map((it, i) => ({
      page: i, path: isPdfItem(it) ? null : it.path, key: loader.keyOf(it),
      thumb: isPdfItem(it) ? () => pdfThumb(ctx, it) : null,
      group: loader.groupOf ? loader.groupOf(it) : tab.title,
      label: isPdfItem(it) ? `pág. ${it.pageNo}` : itemName(it).replace(/^LFK \d{2}\.\d{3} /, ''),
    })),
    onResize: rerender,
    onMission: () => load(true),
    onLive: () => load(),
    onConfig: () => load(true),
    onLibrary: () => load(true),
    onBookmarks: () => { if (loader.bookmarkDriven) load(true); },
  };
}

// Miniatura de una página de PDF para el índice.
async function pdfThumb(ctx, it) {
  try {
    const doc = await openPdf(ctx, it.path);
    const pg = await doc.getPage(it.pageNo);
    const vp1 = pg.getViewport({ scale: 1 });
    const vp = pg.getViewport({ scale: 240 / vp1.width });
    const c = document.createElement('canvas');
    c.width = Math.floor(vp.width);
    c.height = Math.floor(vp.height);
    await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    return c.toDataURL('image/jpeg', 0.8);
  } catch {
    return null;
  }
}

// Carpeta de imágenes: PNG, JPG… y PDF (cada hoja, una página más). La barra de arriba cambia de carpeta sin salir
// del kneeboard: subir, elegir una subcarpeta o una reciente (también en VR) o abrir el selector de Windows.
export const folder = {
  icon: 'folder',
  label: 'Carpeta de imágenes y PDF',
  create(ctx, tab) {
    const base = String(tab.path || '').replace(/[\\/]+$/, '');
    const nameOf = (p) => (p ? p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p : '');
    function setPath(dir) {
      if (!dir) return;
      const now = (ctx.S.config.tabs || []).find((x) => x.id === tab.id) || tab;
      if (dir === now.path) return;
      const recent = [now.path, ...(now.recent || [])].filter((r, i, a) => r && r !== dir && a.indexOf(r) === i).slice(0, 6);
      const list = (ctx.S.config.tabs || []).map((x) => (x.id === tab.id ? { ...x, path: dir, recent } : x));
      ctx.kb.patchConfig({ tabs: list, activePreset: ctx.S.config.activePreset || null, activeTemplate: ctx.S.config.activeTemplate || null });
    }
    async function pickInWindows() {
      const [d] = await ctx.kb.openDialog({ title: 'Carpeta para esta pestaña', properties: ['openDirectory'], defaultPath: tab.path || undefined });
      if (d) { setPath(d); ctx.closeOverlay(); }
    }
    // Selector de carpetas dentro del kneeboard: tocar una carpeta la abre en la pestaña y enseña las suyas.
    async function chooser(dir) {
      const info = await ctx.kb.listDirs(dir || null);
      const count = (d) => [d.images ? `${d.images} ${d.images === 1 ? 'imagen' : 'imágenes'}` : '', d.pdfs ? `${d.pdfs} PDF` : ''].filter(Boolean).join(' · ') || 'sin páginas';
      const row = (label, sub, ic, onclick) => h('button.dirrow', { onclick }, icon(ic), h('span', h('b', label), sub ? h('small', sub) : null));
      const go = (p) => { setPath(p); chooser(p); };
      const now = (ctx.S.config.tabs || []).find((x) => x.id === tab.id) || tab;
      const recent = (now.recent || []).filter((r) => r !== info.dir);
      ctx.openOverlay('Carpeta de la pestaña',
        h('div.dirpath', info.dir || 'Este equipo'),
        info.dir ? h('div.small.muted', count(info)) : null,
        h('div.dirlist',
          info.parent ? row('Subir', nameOf(info.parent) || info.parent, 'up', () => chooser(info.parent))
            : info.dir ? row('Este equipo', 'Unidades del PC', 'up', () => chooser(null)) : null,
          info.dirs.map((d) => row(d.name, count(d), 'folder', () => go(d.path))),
          (info.drives || []).map((d) => row(d, 'Unidad', 'folder', () => chooser(d))),
          info.dir && !info.dirs.length ? h('div.small.muted', { style: { padding: '.4rem' } }, 'No tiene subcarpetas.') : null),
        recent.length ? h('div.dirrecent', h('div.lbl', 'Recientes'),
          h('div.chips', recent.map((r) => h('button.chip', { title: r, onclick: () => go(r) }, icon('folder'), ' ', nameOf(r))))) : null,
        h('div.card-row', { style: { marginTop: '.6rem' } },
          h('button.btn', { onclick: pickInWindows, title: 'Abre el selector de carpetas de Windows (en el monitor)' }, icon('open'), ' Elegir en Windows…'),
          h('span.bar-spacer'),
          h('button.btn.primary', { onclick: () => ctx.closeOverlay() }, 'Listo')));
    }
    const parentOf = (p) => {
      const s = String(p || '').replace(/[\\/]+$/, '');
      const i = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/'));
      if (!s || /^[A-Za-z]:$/.test(s) || i < 0) return null;
      const par = s.slice(0, i);
      return /^[A-Za-z]:$/.test(par) ? `${par}\\` : par;
    };
    const bar = h('div.webnav.foldernav',
      h('button.btn.small', { title: 'Carpeta de arriba', disabled: !parentOf(base), onclick: () => setPath(parentOf(base)) }, icon('up')),
      h('button.folderbtn', { title: tab.path ? `${tab.path}\nToca para cambiar de carpeta` : 'Elegir carpeta', onclick: () => chooser(tab.path || null) },
        icon('folder'), h('span.url', tab.path ? nameOf(tab.path) : 'Elegir carpeta…')),
      h('button.btn.small', { title: 'Elegir carpeta con el selector de Windows', onclick: pickInWindows }, icon('open')));
    return imagePages(ctx, tab, {
      key: () => tab.path,
      list: () => ctx.kb.listFiles(tab.path, 'docs'),
      keyOf: (it) => `dir:${tab.path}|${it.name}${isPdfItem(it) ? `#${it.pageNo}` : ''}`,
      groupOf: (it) => (isPdfItem(it) ? it.name.replace(/\.pdf$/i, '') : nameOf(tab.path) || tab.title),
    }, () => emptyState(icon('folder'), tab.path ? 'Sin páginas' : 'Elige una carpeta',
      tab.path ? `No hay imágenes ni PDF en ${tab.path}. Toca el nombre de la carpeta, arriba, para elegir otra.` : 'Toca «Elegir carpeta…», arriba, para buscarla aquí mismo (también en VR).'), { bar });
  },
};

// Clave estable de una página del piernógrafo (la usan los marcadores; no cambia al reiniciar).
function kneeboardKey(ctx, it) {
  if (it.src === 'mis') return `mis:${(ctx.S.mission && (ctx.S.mission.name || ctx.S.mission.file)) || ''}|${it.name}`;
  if (it.src === 'lib') return `lib:${it.set}|${it.name}`;
  return `ac:${ctx.aircraft()}|${it.name}`;
}
const pageName = (it) => it.name.replace(/\.\w+$/, '').replace(/^LFK \d{2}\.\d{3} /, '');

// Piernógrafo: todas las páginas del avión que vuelas (misión + tus juegos de la biblioteca + carpeta de DCS).
export const library = {
  icon: 'mission',
  label: 'Piernógrafo (todas las páginas del avión)',
  create(ctx, tab) {
    let version = 0;
    const inst = imagePages(ctx, tab, {
      key: () => `${ctx.aircraft()}|${version}|${ctx.S.mission ? ctx.S.mission.name + (ctx.S.mission.kneeboardImages || []).length : ''}`,
      list: () => ctx.kb.kneeboardAll(ctx.aircraft()),
      keyOf: (it) => kneeboardKey(ctx, it),
      groupOf: (it) => it.group,
      labelOf: (it) => `${it.group} · ${pageName(it)}`,
    }, () => emptyState(icon('mission'), 'Piernógrafo', ctx.aircraft()
      ? `No hay páginas para ${ctx.aircraft()}. Activa juegos para este avión en Ajustes > Piernógrafo.`
      : 'Aquí sale el piernógrafo completo del avión que vuelas: las páginas de la misión, tus juegos de la biblioteca y las de la carpeta Kneeboard de DCS.'));
    const base = inst.onLibrary;
    inst.onLibrary = () => { version++; base(); };
    inst.title = (p) => `Piernógrafo — ${inst.pageLabel(p)}`;
    return inst;
  },
};

// Misión: las páginas que has marcado en el Piernógrafo y las que has añadido sin marcador, todas juntas en el
// orden normal del Piernógrafo (y agrupadas por juego). El tipo de marcador se sigue viendo en cada página.
export const dcsKneeboard = {
  icon: 'bookmarks',
  label: 'Misión: solo las páginas marcadas',
  create(ctx, tab) {
    let version = 0;
    const inst = imagePages(ctx, tab, {
      bookmarkDriven: true,
      key: () => `${ctx.aircraft()}|${version}|${ctx.S.mission ? ctx.S.mission.name : ''}`,
      list: async () => {
        const all = await ctx.kb.kneeboardAll(ctx.aircraft());
        const bms = ctx.S.bookmarks || {};
        const mp = ctx.S.missionPages || {};
        return all
          .map((it) => { const k = kneeboardKey(ctx, it); return { ...it, bm: bms[k], mp: mp[k] }; })
          .filter((it) => it.bm || it.mp);
      },
      keyOf: (it) => kneeboardKey(ctx, it),
      groupOf: (it) => it.group,
      labelOf: (it) => `${it.bm ? `${bmType(it.bm.type).label} · ` : ''}${it.group} · ${pageName(it)}`,
    }, () => emptyState(icon('bookmarks'), 'Sin páginas marcadas',
      'Abre el Piernógrafo, busca las páginas que te interesan para esta misión y márcalas con el icono de marcador (Tierra, Salida, Aproximación…). Aparecerán aquí en el orden del Piernógrafo. En ese mismo menú puedes añadir una página a Misión sin que sea un marcador.'));
    const base = inst.onLibrary;
    inst.onLibrary = () => { version++; base(); };
    const baseBm = inst.onBookmarks;
    inst.onBookmarks = () => { version++; baseBm(); };
    inst.title = (p) => `Misión — ${inst.pageLabel(p)}`;
    return inst;
  },
};

// ------------------------------------------------------------------ PDF
let pdfjs = null;
export async function loadPdfJs() {
  if (!pdfjs) {
    pdfjs = await import('app://kb/node_modules/pdfjs-dist/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = 'app://kb/node_modules/pdfjs-dist/build/pdf.worker.mjs';
  }
  return pdfjs;
}

export const pdf = {
  icon: 'pdf',
  label: 'Documento PDF',
  create(ctx, tab) {
    const el = h('div.flush.doc');
    let doc = null;
    let page = 0;
    let renderTask = null;
    let error = null;
    const canvas = h('canvas.page');

    (async () => {
      if (!tab.path) {
        error = 'Elige un PDF en Ajustes > Pestañas.';
        draw();
        return;
      }
      try {
        const lib = await loadPdfJs();
        const url = await ctx.kb.fileUrl(tab.path);
        doc = await lib.getDocument({ url, isEvalSupported: false }).promise;
        ctx.refresh();
        draw();
      } catch (e) {
        error = `No se pudo abrir el PDF: ${e.message}`;
        draw();
      }
    })();

    async function draw() {
      clear(el);
      if (error) return el.append(emptyState(icon('pdf'), 'PDF', error));
      if (!doc) return el.append(h('div.loading', 'Cargando PDF…'));
      el.append(canvas);
      const pg = await doc.getPage(Math.min(page, doc.numPages - 1) + 1);
      const box = el.getBoundingClientRect();
      if (!box.width) return;
      const vp1 = pg.getViewport({ scale: 1 });
      const scale = Math.min(box.width / vp1.width, box.height / vp1.height) * (window.devicePixelRatio || 1);
      const vp = pg.getViewport({ scale });
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      canvas.style.width = `${vp.width / (window.devicePixelRatio || 1)}px`;
      canvas.style.height = `${vp.height / (window.devicePixelRatio || 1)}px`;
      if (renderTask) renderTask.cancel();
      renderTask = pg.render({ canvasContext: canvas.getContext('2d'), viewport: vp });
      try { await renderTask.promise; } catch { /* cancelado */ }
    }
    const redraw = debounce(draw, 150);

    return {
      el,
      wheelPages: true,
      pages: () => (doc ? doc.numPages : 1),
      show(p) { page = p; draw(); },
      inkKey: (p) => `${tab.id}:p${p}`,
      title: (p) => `${tab.title} — pág. ${p + 1}`,
      pageKey: (p) => (tab.path ? `pdf:${tab.path}#${p + 1}` : null),
      pageLabel: (p) => `${tab.title} · pág. ${p + 1}`,
      findPage: (key) => {
        const pre = `pdf:${tab.path}#`;
        if (!key.startsWith(pre)) return -1;
        const n = Number(key.slice(pre.length)) - 1;
        return doc && n < doc.numPages ? n : -1;
      },
      onResize: redraw,
    };
  },
};

// ------------------------------------------------------------------ web o archivo local
function toUrl(raw) {
  const v = String(raw || '').trim();
  if (!v) return null;
  if (/^(https?|kbfile|app):\/\//i.test(v)) return v;
  if (/^file:\/\//i.test(v)) return v.replace(/^file:\/\/\/?([A-Za-z]):\//, (m, d) => `kbfile://${d.toLowerCase()}/`);
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(v);
  if (m) return `kbfile://${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/')}`;
  return `https://${v}`;
}

// Archivos del PC que se pueden abrir en la pestaña: los PDF con el visor de la app (páginas con el HOTAS y
// marcadores), el resto en el navegador de la pestaña.
const WEB_FILES = ['html', 'htm', 'txt', 'md', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'];
const localPath = (raw) => (/^[A-Za-z]:[\\/]/.test(String(raw || '').trim()) ? String(raw).trim() : null);
const isLocalPdf = (raw) => /\.pdf$/i.test(localPath(raw) || '');

export const web = {
  icon: 'web',
  label: 'Página web o archivo local',
  create(ctx, tab) {
    const el = h('div.flush');
    const raw = String(tab.url || '').trim();
    const home = toUrl(raw);
    const pdfMode = isLocalPdf(raw);

    // Cambiar la dirección guarda la pestaña; el kneeboard la vuelve a crear ya con la nueva.
    function setAddress(v) {
      const next = String(v || '').trim();
      if (!next || next === raw) {
        if (next && wv) wv.loadURL(home);
        return;
      }
      const list = (ctx.S.config.tabs || []).map((x) => (x.id === tab.id ? { ...x, url: next } : x));
      ctx.kb.patchConfig({ tabs: list, activePreset: ctx.S.config.activePreset || null, activeTemplate: ctx.S.config.activeTemplate || null });
    }
    async function openFile() {
      const [f] = await ctx.kb.openDialog({
        title: 'Abrir un archivo en esta pestaña',
        properties: ['openFile'],
        filters: [
          { name: 'PDF, páginas web, imágenes y texto', extensions: ['pdf', ...WEB_FILES] },
          { name: 'Todos los archivos', extensions: ['*'] },
        ],
      });
      if (!f) return;
      const ext = (/\.([^.\\/]+)$/.exec(f) || [])[1] || '';
      if (ext.toLowerCase() !== 'pdf' && !WEB_FILES.includes(ext.toLowerCase())) {
        ctx.toast(`Los archivos .${ext || '?'} no se pueden mostrar aquí. Guárdalo como PDF y ábrelo.`, 'warn');
        return;
      }
      setAddress(f);
    }

    const address = h('input.url', {
      type: 'text', value: raw, spellcheck: false,
      placeholder: 'Escribe una web o la ruta de un archivo y pulsa Intro',
      title: 'Dirección: una web (https://…) o un archivo de tu PC (C:\\…). Intro para abrirla.',
      onkeydown: (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { setAddress(address.value); address.blur(); }
        if (e.key === 'Escape') { address.value = shown; address.blur(); }
      },
      onfocus: () => address.select(),
    });
    let shown = raw;
    const openBtn = h('button.btn.small', { title: 'Abrir un archivo de tu PC (PDF, HTML, imagen, texto)', onclick: openFile }, icon('folder'));
    const wrap = h('div.webwrap');
    let wv = null;
    let inner = null;

    if (!home) {
      wrap.append(emptyState(icon('web'), 'Sin dirección', 'Escribe arriba una web (https://…) o la ruta de un archivo de tu PC y pulsa Intro, o ábrelo con el botón de la carpeta.'));
      el.append(h('div.webnav', address, openBtn), wrap);
      return { el, pages: () => 1, show() {}, title: () => tab.title };
    }

    if (pdfMode) {
      // PDF del PC: el mismo visor que las pestañas PDF, con su paginación y sus marcadores.
      inner = pdf.create(ctx, { ...tab, path: localPath(raw) });
      wrap.append(inner.el);
      el.append(h('div.webnav', address, openBtn), wrap);
      return { ...inner, el, title: (p) => `${tab.title} — pág. ${p + 1}` };
    }

    wv = document.createElement('webview');
    wv.setAttribute('src', home);
    wv.setAttribute('allowpopups', 'false');
    let zoom = Number(tab.zoom) || 1;
    // Los archivos del PC se enseñan con su ruta de Windows, no con el enlace interno kbfile://.
    const showUrl = (u) => {
      const m = /^kbfile:\/\/([a-z])\/(.*)$/i.exec(u || '');
      if (m) { try { u = `${m[1].toUpperCase()}:\\${decodeURIComponent(m[2]).replace(/\//g, '\\')}`; } catch { /* ruta rara: se deja */ } }
      shown = u;
      if (document.activeElement !== address) address.value = u;
    };
    const nav = h('div.webnav',
      h('button.btn.small', { title: 'Atrás', onclick: () => wv.canGoBack() && wv.goBack() }, icon('back')),
      h('button.btn.small', { title: 'Adelante', onclick: () => wv.canGoForward() && wv.goForward() }, icon('forward')),
      h('button.btn.small', { title: 'Inicio', onclick: () => wv.loadURL(home) }, icon('home')),
      h('button.btn.small', { title: 'Recargar', onclick: () => wv.reload() }, icon('refresh')),
      address,
      openBtn,
      h('button.btn.small', { title: 'Reducir', onclick: () => setZoom(zoom - 0.1) }, icon('zoomOut')),
      h('button.btn.small', { title: 'Ampliar', onclick: () => setZoom(zoom + 0.1) }, icon('zoomIn')),
    );
    function setZoom(z) {
      zoom = Math.max(0.3, Math.min(3, Math.round(z * 10) / 10));
      try { wv.setZoomFactor(zoom); } catch { /* aún cargando */ }
    }
    wv.addEventListener('dom-ready', () => setZoom(zoom));
    wv.addEventListener('did-navigate', (e) => showUrl(e.url));
    wv.addEventListener('did-navigate-in-page', (e) => showUrl(e.url));
    wv.addEventListener('did-fail-load', (e) => {
      if (e.errorCode !== -3) ctx.toast(`No se pudo cargar: ${e.errorDescription}`, 'warn');
    });
    wrap.append(wv);
    el.append(nav, wrap);
    return {
      el,
      pages: () => 1,
      show() {},
      title: () => tab.title,
      onAction(a) {
        if (a === 'next_page') { wv.executeJavaScript('window.scrollBy(0, window.innerHeight * 0.85)').catch(() => {}); return true; }
        if (a === 'prev_page') { wv.executeJavaScript('window.scrollBy(0, -window.innerHeight * 0.85)').catch(() => {}); return true; }
        return false;
      },
    };
  },
};

// ------------------------------------------------------------------ captura de ventana
export const windowCapture = {
  icon: 'window',
  label: 'Captura de una ventana',
  create(ctx, tab) {
    const el = h('div.flush');
    const video = h('video', { autoplay: true, muted: true });
    let stream = null;
    const status = h('div.url', '');
    async function start() {
      if (stream) stream.getTracks().forEach((t) => t.stop());
      const sources = await ctx.kb.captureSources();
      const want = String(tab.window || '').toLowerCase();
      const src = sources.find((s) => want && s.name.toLowerCase().includes(want));
      if (!src) {
        status.textContent = want ? `No encuentro una ventana con «${tab.window}»` : 'Indica el título de la ventana en Ajustes > Pestañas';
        return;
      }
      status.textContent = src.name;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: src.id, maxFrameRate: 15 } },
        });
        video.srcObject = stream;
      } catch (e) {
        status.textContent = `No se pudo capturar: ${e.message}`;
      }
    }
    el.append(h('div.webnav', h('button.btn.small', { onclick: start, title: 'Volver a buscar la ventana' }, icon('refresh')), status), h('div.webwrap', video));
    start();
    return {
      el,
      pages: () => 1,
      show() {},
      destroy() { if (stream) stream.getTracks().forEach((t) => t.stop()); },
    };
  },
};
