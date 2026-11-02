// Pestañas de documentos: carpeta de imágenes, kneeboard de DCS, PDF, página web / archivo local y captura de ventana.
import { icon } from '../icons.js';
import { bmType, bmOrder } from '../bookmarks.js';
import { h, clear, emptyState, debounce } from '../util.js';

// ------------------------------------------------------------------ imágenes (carpeta y kneeboard de DCS)
function imagePages(ctx, tab, loader, emptyMsg) {
  const el = h('div.flush.doc');
  let list = [];
  let page = 0;
  let loadedFor = null;
  const img = h('img', { draggable: false });

  async function load(force) {
    const key = loader.key();
    if (!force && key === loadedFor) return;
    loadedFor = key;
    list = await loader.list();
    render();
    ctx.refresh();
  }

  function render() {
    clear(el);
    if (!list.length) {
      el.append(emptyMsg());
      return;
    }
    const it = list[Math.min(page, list.length - 1)];
    img.src = it.url;
    img.title = it.name;
    el.append(img);
  }

  load(true);
  return {
    el,
    wheelPages: true,
    pages: () => list.length,
    show(p) { page = p; load(); render(); },
    inkKey: (p) => (list[p] ? `${tab.id}:${list[p].name}` : null),
    title: (p) => (list[p] ? `${tab.title} — ${list[p].name.replace(/\.\w+$/, '')}` : tab.title),
    // Marcadores: clave estable de cada página (sobrevive a reinicios) y búsqueda por clave.
    pageKey: (p) => (list[p] ? loader.keyOf(list[p]) : null),
    pageLabel: (p) => (list[p] ? (loader.labelOf ? loader.labelOf(list[p]) : list[p].name.replace(/\.\w+$/, '')) : ''),
    findPage: (key) => list.findIndex((it) => loader.keyOf(it) === key),
    // Índice: cada página con su grupo (juego de la biblioteca, tipo de marcador…) y el archivo para la miniatura.
    indexItems: () => list.map((it, i) => ({
      page: i, path: it.path, key: loader.keyOf(it),
      group: loader.groupOf ? loader.groupOf(it) : tab.title,
      label: it.name.replace(/\.\w+$/, '').replace(/^LFK \d{2}\.\d{3} /, ''),
    })),
    onMission: () => load(true),
    onLive: () => load(),
    onConfig: () => load(true),
    onLibrary: () => load(true),
    onBookmarks: () => { if (loader.bookmarkDriven) load(true); },
  };
}

export const folder = {
  icon: 'folder',
  label: 'Carpeta de imágenes',
  create(ctx, tab) {
    return imagePages(ctx, tab, {
      key: () => tab.path,
      list: () => ctx.kb.listFiles(tab.path, 'images'),
      keyOf: (it) => `dir:${tab.path}|${it.name}`,
    }, () => emptyState(icon('folder'), 'Carpeta vacía', tab.path ? `No hay imágenes en ${tab.path}` : 'Elige una carpeta en Ajustes > Pestañas.'));
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

// Misión: las páginas que has marcado en el Piernógrafo, ordenadas por fase (Tierra → Emergencias), y después
// las que has añadido a Misión sin marcador, en el orden en que las añadiste.
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
        const rank = (it) => (it.bm ? bmOrder(it.bm.type) : 1000);
        return all
          .map((it, i) => { const k = kneeboardKey(ctx, it); return { ...it, i, bm: bms[k], mp: mp[k] }; })
          .filter((it) => it.bm || it.mp)
          .sort((a, b) => rank(a) - rank(b) || (a.bm ? a.i - b.i : (a.mp.at || 0) - (b.mp.at || 0)));
      },
      keyOf: (it) => kneeboardKey(ctx, it),
      groupOf: (it) => (it.bm ? bmType(it.bm.type).label : 'En Misión'),
      labelOf: (it) => `${it.bm ? bmType(it.bm.type).label : 'En Misión'} · ${it.group} · ${pageName(it)}`,
    }, () => emptyState(icon('bookmarks'), 'Sin páginas marcadas',
      'Abre el Piernógrafo, busca las páginas que te interesan para esta misión y márcalas con el icono de marcador (Tierra, Salida, Aproximación…). Aparecerán aquí ordenadas por fase. En ese mismo menú puedes añadir una página a Misión sin que sea un marcador.'));
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
      ctx.kb.patchConfig({ tabs: list, activePreset: ctx.S.config.activePreset || null });
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
