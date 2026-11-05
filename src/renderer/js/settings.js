// Ventana de ajustes.
import { h, clear } from './util.js';
import { THEMES } from './themes.js';
import { TAB_TYPES } from './tabs/index.js';
import { loadPdfJs } from './tabs/docs.js';
import { icon, tabIcon, PICKABLE } from './icons.js';

const kb = window.kb;
let C = null;          // configuración
let INIT = null;
let section = location.hash.slice(1) || 'general';
let bindNames = new Map();

const SECTIONS = [
  { id: 'bienvenida', icon: 'welcome', label: 'Bienvenida' },
  { id: 'general', icon: 'palette', label: 'Aspecto' },
  { id: 'pestanas', icon: 'tabs', label: 'Pestañas' },
  { id: 'controles', icon: 'gamepad', label: 'Controles' },
  { id: 'vr', icon: 'vr', label: 'Realidad virtual' },
  { id: 'mision', icon: 'route', label: 'Misión y curso' },
  { id: 'biblioteca', icon: 'mission', label: 'Piernógrafo' },
  { id: 'voz', icon: 'mic', label: 'Órdenes de voz' },
  { id: 'compartir', icon: 'users', label: 'Vuelo compartido' },
  { id: 'dcs', icon: 'plug', label: 'Integración DCS' },
  { id: 'actualizar', icon: 'update', label: 'Actualizar y perfil' },
  { id: 'acerca', icon: 'info', label: 'Acerca de' },
];

const main = document.getElementById('main');
const patch = async (p) => { C = await kb.patchConfig(p); return C; };

function nav() {
  const n = document.getElementById('nav');
  clear(n);
  for (const s of SECTIONS) {
    n.append(h('button', { className: s.id === section ? 'sel' : '', onclick: () => go(s.id) }, icon(s.icon), s.label));
  }
}

function go(id) {
  section = id;
  location.hash = id;
  nav();
  render();
}

async function sideStatus() {
  const st = await kb.integrationStatus();
  const el = document.getElementById('sideStatus');
  clear(el).append(
    h('div.st', h('span', { className: `dot${st.dcsConnected ? ' on' : ''}` }), st.dcsConnected ? 'DCS conectado' : 'DCS sin conectar'),
    h('div.st', h('span', { className: `dot${st.vrActive ? ' on' : ''}` }), st.vrActive ? 'Visor VR activo' : 'VR en espera'),
  );
}

// Alto actual de una ventana del kneeboard respecto a la pantalla.
function sizeOf(i) {
  const b = (C.views[i] || {}).bounds;
  return b ? Math.min(1, Math.max(0.3, b.height / (window.screen.availHeight || 1080))) : 0.78;
}

// Selector de icono para una pestaña (iconos propios, no emojis).
function iconPicker(t, save) {
  const btn = h('button.icbtn', { title: 'Cambiar el icono' }, tabIcon(t));
  const pop = h('div.icpop', { hidden: true }, PICKABLE.map((n) => h('button', {
    className: t.icon === n ? 'sel' : '', title: n,
    onclick: () => { t.icon = n; btn.replaceChildren(tabIcon(t)); pop.hidden = true; save(); },
  }, icon(n))));
  btn.onclick = () => { pop.hidden = !pop.hidden; };
  return h('div', { style: { position: 'relative' } }, btn, pop);
}

function chk(label, desc, value, onchange) {
  return h('label.chk', h('input', { type: 'checkbox', checked: !!value, onchange: (e) => onchange(e.target.checked) }), h('span', h('b', label), desc ? h('small', desc) : null));
}

function slider(label, value, min, max, step, fmt, onchange) {
  const out = h('output', fmt(value));
  return h('div.slider', h('span', label),
    h('input', { type: 'range', min, max, step, value, oninput: (e) => { out.textContent = fmt(Number(e.target.value)); onchange(Number(e.target.value)); } }), out);
}

// ------------------------------------------------------------------ secciones
const R = {};

R.bienvenida = async () => {
  const st = await kb.integrationStatus();
  let hook = true, layer = true;
  const dirs = st.savedGames;
  main.append(
    h('h1', 'Bienvenido a LF Kneeboard'),
    h('p.lead', 'Un kneeboard para DCS en VR y en el monitor: páginas de la misión, radios, plan de vuelo, bloc con coordenadas, mapa y pizarra compartida con tu vuelo. Para empezar solo hace falta un paso.'),
    h('div.card',
      h('div.steps',
        h('div.step', h('div',
          h('b', 'Conectar con DCS'),
          h('div.muted.small', dirs.length ? `Se copiará un archivo en ${dirs.map((d) => `${d}\\Scripts\\Hooks`).join(' y ')}. No se toca tu Export.lua, así que convive con DCS-BIOS, Tacview, SRS u OpenKneeboard.` : 'No encuentro la carpeta Saved Games\\DCS. Abre DCS una vez y vuelve aquí.'),
          chk('Instalar el script de DCS', null, hook, (v) => { hook = v; }))),
        h('div.step', h('div',
          h('b', 'Mostrarlo en el visor de VR'),
          h('div.muted.small', 'Registra la capa OpenXR del kneeboard para tu usuario de Windows (no necesita permisos de administrador). Funciona con cualquier visor OpenXR.'),
          chk('Activar en VR', null, layer, (v) => { layer = v; }))),
        h('div.step', h('div',
          h('b', 'Controles'),
          h('div.muted.small', 'Vienen asignados al teclado con AltGr (Alt derecho). Puedes cambiarlos y asignar botones del HOTAS en Controles.'),
          h('div.row', { style: { marginTop: '6px' } },
            h('span', h('kbd', 'AltGr'), ' + ', h('kbd', 'K'), ' mostrar'),
            h('span', h('kbd', 'AltGr'), ' + ', h('kbd', 'Av Pág'), ' / ', h('kbd', 'Re Pág'), ' página'),
            h('span', h('kbd', 'AltGr'), ' + ', h('kbd', 'Fin'), ' / ', h('kbd', 'Inicio'), ' pestaña'),
            h('span', h('kbd', 'AltGr'), ' + ', h('kbd', 'M'), ' coordenadas F10')))))),
    h('div.row',
      h('button.btn.primary', { onclick: async (e) => {
        e.target.disabled = true;
        const r = await kb.integrationInstall({ hook: hook && dirs.length > 0, layer });
        await patch({ firstRun: false, vr: { enabled: layer } });
        if (r.error) alert(`Algo ha fallado: ${r.error}`);
        go('general');
      } }, 'Instalar y empezar'),
      h('button.btn', { onclick: async () => { await patch({ firstRun: false }); go('general'); } }, 'Ahora no')),
  );
};

R.general = () => {
  main.append(h('h1', 'Aspecto'), h('p.lead', 'Elige cómo se ve tu kneeboard. El tema se aplica al momento, también en el visor.'));
  const grid = h('div.themes');
  for (const t of THEMES) {
    grid.append(h('button.theme', { className: `theme${C.theme === t.id ? ' sel' : ''}`, onclick: async () => { await patch({ theme: t.id }); render(); } },
      h('div.pv', h('iframe', { src: `preview.html?theme=${t.id}`, tabindex: -1 })),
      h('b', t.name), h('span', t.desc)));
  }
  main.append(grid,
    h('h2', 'Opciones'),
    h('div.card',
      chk('Modo noche', 'Atenúa y tiñe de rojo cualquier tema. Acción «Modo noche» para cambiarlo en vuelo.', C.night, (v) => patch({ night: v })),
      chk('Dos kneeboards', 'Un segundo kneeboard independiente (por ejemplo, radios a la izquierda y plan a la derecha).', C.dual, (v) => patch({ dual: v })),
      chk('Iniciar con Windows', 'Se abre oculto al encender el PC (en la bandeja), listo para cuando entres en DCS: sácalo con tu tecla.', C.startWithWindows, (v) => patch({ startWithWindows: v })),
      chk('Siempre encima de DCS', 'Recomendado si juegas en ventana o pantalla completa sin bordes.', C.alwaysOnTop, (v) => patch({ alwaysOnTop: v })),
      chk('Clic a través', 'El ratón atraviesa el kneeboard en el monitor (se puede alternar con una tecla).', C.clickThrough, (v) => patch({ clickThrough: v })),
      slider('Opacidad en el monitor', C.overlayOpacity, 0.3, 1, 0.05, (v) => `${Math.round(v * 100)} %`, (v) => patch({ overlayOpacity: v }))),
    h('h2', 'Tamaño en el monitor (2D)'),
    h('div.card',
      slider('Textos y botones', C.uiScale || 1, 0.7, 1.6, 0.05, (v) => `${Math.round(v * 100)} %`, (v) => patch({ uiScale: v })),
      [0, 1].slice(0, C.dual ? 2 : 1).map((i) => slider(C.dual ? `Alto del kneeboard ${i + 1}` : 'Alto de la ventana', sizeOf(i), 0.3, 1, 0.01, (v) => `${Math.round(v * 100)} % de la pantalla`, (v) => kb.setSize(i, v))),
      h('div.small.muted', 'También puedes arrastrar la esquina inferior derecha del kneeboard, o usar Ctrl + rueda del ratón sobre él para los textos.')),
    h('h2', 'Cruz del centro (coordenadas del F10)'),
    h('div.card',
      h('div.row', h('span', { style: { width: '170px' } }, 'Mostrar la cruz'),
        h('select.f', { onchange: (e) => patch({ crosshair: e.target.value }) },
          [['auto', 'Automática: mientras ves la página Coordenadas del Bloc'], ['always', 'Siempre'], ['never', 'Nunca']]
            .map(([v, l]) => h('option', { value: v, selected: (C.crosshair === false ? 'never' : C.crosshair || 'auto') === v }, l)))),
      chk('Mostrarla también al detectar el mapa F10 (experimental)', 'Intenta saber si tienes el F10 abierto por la posición de la cámara. Puedes ver qué detecta en Integración DCS.', C.crosshairF10, (v) => patch({ crosshairF10: v })),
      h('div.small.muted', 'Marca el centro de la ventana de DCS (y el centro de tu vista en VR): es el punto que se guarda al capturar coordenadas. También puedes asignar la acción «Mostrar la cruz del centro».')),
  );
};

R.pestanas = async () => {
  main.append(h('h1', 'Pestañas'), h('p.lead', 'Ordena las pestañas, cámbiales el nombre y el icono, y marca con la estrella las que quieres fijas en la barra de abajo. Las demás se abren desde la cuadrícula del kneeboard.'));
  // Presets propios: tu juego de pestañas guardado con un nombre, para cambiar de uno a otro según el vuelo.
  const presets = (C.tabPresets || []).map((p) => ({ ...p }));
  const savePresets = (list) => patch({ tabPresets: list });
  const snapshot = () => C.tabs.map((t) => ({ ...t, phases: [...(t.phases || [])] }));
  const nameIn = h('input.f.grow', { placeholder: 'Nombre del preset (p. ej. «CAS en el A-10» o «Entreno VFR»)' });
  const addPreset = async () => {
    const name = nameIn.value.trim();
    if (!name) { nameIn.focus(); return; }
    const same = presets.find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (same && !confirm(`Ya tienes un preset «${same.name}». ¿Lo sustituyes por las pestañas actuales?`)) return;
    const list = same ? presets.map((p) => (p === same ? { ...p, tabs: snapshot(), at: Date.now() } : p))
      : [...presets, { id: `p${Date.now().toString(36)}`, name, tabs: snapshot(), at: Date.now() }];
    await savePresets(list);
    if (!same) await patch({ activePreset: list[list.length - 1].id });
    render();
  };
  nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') addPreset(); });
  main.append(h('h2', 'Tus presets'), h('div.card',
    h('p.small.muted', { style: { marginTop: 0 } }, 'Guarda tus pestañas tal como están ahora (cuáles hay, su orden, nombres, fijas en la barra y ajustes) y vuelve a ellas cuando quieras: desde aquí, desde la cuadrícula del kneeboard o con la acción «Preset de pestañas siguiente» del HOTAS.'),
    presets.length ? h('div.presets', presets.map((p, i) => {
      const nIn = h('input.f', { value: p.name, onchange: async (e) => { const v = e.target.value.trim(); if (!v) return; presets[i] = { ...p, name: v }; await savePresets(presets); } });
      return h('div.preset', { className: `preset${C.activePreset === p.id ? ' on' : ''}` },
        icon('preset'), nIn,
        h('span.muted.small', `${p.tabs.length} pestañas · ${p.tabs.filter((t) => t.fav).length} fijas`),
        h('button.btn.small.primary', { onclick: async () => { C = await kb.applyPreset(p.id); render(); } }, 'Usar'),
        h('button.btn.small', { title: 'Guardar aquí las pestañas actuales', onclick: async () => {
          if (!confirm(`¿Guardar las pestañas actuales en «${p.name}»?`)) return;
          presets[i] = { ...p, tabs: snapshot(), at: Date.now() };
          await savePresets(presets); render();
        } }, 'Actualizar'),
        h('button.btn.small.danger', { onclick: async () => {
          if (!confirm(`¿Borrar el preset «${p.name}»? Tus pestañas actuales no cambian.`)) return;
          presets.splice(i, 1);
          await savePresets(presets); render();
        } }, 'Borrar'));
    })) : h('div.muted.small', 'Todavía no tienes ninguno.'),
    h('div.row', { style: { marginTop: '.6rem' } }, nameIn, h('button.btn.primary', { onclick: addPreset }, icon('plus'), ' Guardar las pestañas actuales'))));
  const templates = await kb.tabTemplates();
  main.append(h('h2', 'Plantillas por tipo de vuelo'), h('div.card',
    h('div.tpls', templates.map((tp) => h('button.tpl', { onclick: async () => {
      if (!confirm(`¿Aplicar la plantilla «${tp.label}»?

Las pestañas que ya tienes conservan su nombre y sus ajustes, y tus PDF, webs y carpetas se quedan al final.`)) return;
      C = await kb.applyTemplate(tp.id);
      render();
    } }, h('b', tp.label), h('span', tp.desc)))),
    h('div.small.muted', 'Cambian qué pestañas hay, su orden y cuáles van fijas en la barra.')));
  const adv = !!C.tabsAdvanced;
  main.append(h('h2', 'Tus pestañas'));
  const card = h('div.card');
  const tabs = C.tabs.map((t) => ({ ...t }));
  const save = () => patch({ tabs });
  // Arrastrar una pestaña por su asa (⠿) a otra posición. Con eventos de puntero, no con el arrastre del
  // navegador, para que no se líe con los campos de texto de cada fila. Una línea marca dónde caerá.
  function startDrag(e, from) {
    if (e.button > 0) return;
    e.preventDefault();
    const rows = [...card.querySelectorAll(':scope > .tabrow')];
    const row = rows[from];
    if (!row) return;
    row.classList.add('dragging');
    document.body.classList.add('dragging-tab');
    let ins = from;
    const mark = () => rows.forEach((r, k) => {
      r.classList.toggle('drop-before', k === ins && ins !== from && ins !== from + 1);
      r.classList.toggle('drop-after', k === rows.length - 1 && ins === rows.length && from !== rows.length - 1);
    });
    let scroll = 0;
    const timer = setInterval(() => { if (scroll) main.scrollTop += scroll; }, 16);
    const move = (ev) => {
      ins = rows.length;
      for (let k = 0; k < rows.length; k++) {
        const r = rows[k].getBoundingClientRect();
        if (ev.clientY < r.top + r.height / 2) { ins = k; break; }
      }
      const box = main.getBoundingClientRect();
      scroll = ev.clientY < box.top + 50 ? -12 : ev.clientY > box.bottom - 50 ? 12 : 0;
      mark();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      clearInterval(timer);
      document.body.classList.remove('dragging-tab');
      rows.forEach((r) => r.classList.remove('dragging', 'drop-before', 'drop-after'));
      const to = ins > from ? ins - 1 : ins;
      if (to === from) return;
      const [t] = tabs.splice(from, 1);
      tabs.splice(to, 0, t);
      save().then(render);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
  tabs.forEach((t, i) => {
    const type = TAB_TYPES[t.type] || { label: t.type };
    const opts = h('div.opts');
    if (t.type === 'folder' || t.type === 'pdf') {
      const p = h('input.f.grow', { value: t.path || '', placeholder: t.type === 'pdf' ? 'Ruta del PDF' : 'Carpeta con imágenes', onchange: (e) => { t.path = e.target.value; save(); } });
      opts.append(p, h('button.btn.small', { onclick: async () => {
        const r = await kb.openDialog(t.type === 'pdf' ? { properties: ['openFile'], filters: [{ name: 'PDF', extensions: ['pdf'] }] } : { properties: ['openDirectory'] });
        if (r[0]) { t.path = r[0]; p.value = r[0]; save(); }
      } }, 'Elegir…'));
    }
    if (t.type === 'web') {
      const u = h('input.f.grow', { value: t.url || '', placeholder: 'https://… o C:\\carpeta\\pagina.html', onchange: (e) => { t.url = e.target.value; save(); } });
      opts.append(u, h('button.btn.small', { title: 'Elegir un archivo de tu PC', onclick: async () => {
        const r = await kb.openDialog({ properties: ['openFile'], filters: [{ name: 'Páginas y documentos', extensions: ['html', 'htm', 'pdf', 'png', 'jpg', 'svg', 'txt'] }] });
        if (r[0]) { t.url = r[0]; u.value = r[0]; save(); }
      } }, 'Archivo…'));
    }
    if (t.type === 'chart') {
      const p = h('input.f.grow', { value: t.path || '', placeholder: 'Imagen o PDF de la carta', onchange: (e) => { t.path = e.target.value; save(); } });
      opts.append(p, h('button.btn.small', { onclick: async () => {
        const r = await kb.openDialog({ properties: ['openFile'], filters: [{ name: 'Cartas', extensions: ['png', 'jpg', 'jpeg', 'webp', 'pdf'] }] });
        if (r[0]) { t.path = r[0]; p.value = r[0]; save(); }
      } }, 'Elegir…'), h('span.muted.small', 'Pág.'), h('input.f', { type: 'number', min: 1, value: t.page || 1, style: { width: '64px' }, onchange: (e) => { t.page = Number(e.target.value) || 1; save(); } }));
    }
    if (t.type === 'window') {
      opts.append(h('input.f.grow', { value: t.window || '', placeholder: 'Parte del título de la ventana (p. ej. «SRS» o «Discord»)', onchange: (e) => { t.window = e.target.value; save(); } }));
    }
    const phases = !adv ? null : h('div.phases', h('span.muted.small', 'Auto:'), INIT.phases.map((p) => h('button.ph', {
      className: `ph${(t.phases || []).includes(p.id) ? ' sel' : ''}`,
      onclick: (e) => {
        t.phases = t.phases || [];
        if (t.phases.includes(p.id)) t.phases = t.phases.filter((x) => x !== p.id);
        else t.phases.push(p.id);
        e.target.classList.toggle('sel');
        save();
      },
    }, p.label)));
    const favBtn = h('button.favbtn', { className: `favbtn${t.fav ? ' on' : ''}`, title: t.fav ? 'Fija en la barra (quitar)' : 'Fijar en la barra',
      onclick: () => { t.fav = !t.fav; favBtn.classList.toggle('on', t.fav); favBtn.replaceChildren(icon('star', t.fav ? 'filled' : '')); save(); } }, icon('star', t.fav ? 'filled' : ''));
    card.append(h('div.tabrow',
      h('div.mv',
        h('span.grip', { title: 'Arrastra para cambiar el orden', onpointerdown: (e) => startDrag(e, i) }, '⠿'),
        h('button', { title: 'Subir', onclick: () => { if (i > 0) { [tabs[i - 1], tabs[i]] = [tabs[i], tabs[i - 1]]; save().then(render); } } }, '▲'),
        h('button', { title: 'Bajar', onclick: () => { if (i < tabs.length - 1) { [tabs[i + 1], tabs[i]] = [tabs[i], tabs[i + 1]]; save().then(render); } } }, '▼')),
      h('div.ic', favBtn, iconPicker(t, save)),
      h('div', h('input.f', { value: t.title, style: { width: '100%' }, onchange: (e) => { t.title = e.target.value; save(); } })),
      h('div.type', type.label),
      h('button.btn.small.danger', { onclick: () => { tabs.splice(i, 1); save().then(render); } }, 'Quitar'),
      opts.childNodes.length ? opts : null,
      phases));
  });
  card.append(chk('Opciones avanzadas: abrir pestañas según la fase del vuelo', 'Con el modo AUTO, primero se usan tus marcadores de cada fase; esto asigna además pestañas enteras a una fase (rodaje, aproximación…).', adv, async (v) => { await patch({ tabsAdvanced: v }); render(); }));
  const sel = h('select.f', Object.entries(TAB_TYPES).map(([id, t]) => h('option', { value: id }, t.label)));
  main.append(card, h('div.row',
    sel,
    h('button.btn.primary', { onclick: () => {
      const t = TAB_TYPES[sel.value];
      tabs.push({ id: `t${Date.now().toString(36)}`, type: sel.value, title: t.label.split(/[(:]/)[0].trim(), icon: t.icon, phases: [], fav: true });
      save().then(render);
    } }, 'Añadir pestaña'),
    h('span.grow'),
    h('button.btn', { onclick: async () => { if (confirm('¿Volver a las pestañas de fábrica?')) { await kb.resetTabs(); C = (await kb.init()).config; render(); } } }, 'Restaurar pestañas')));
};

R.controles = async () => {
  main.append(h('h1', 'Controles'), h('p.lead', 'Asigna teclas o botones del HOTAS a cada acción. Funcionan aunque DCS tenga el foco. Puedes poner varias asignaciones por acción y combinaciones con un modificador (por ejemplo, un botón de cambio + otro botón).'));
  const all = Object.values(C.bindings || {}).flat();
  const names = await Promise.all(all.map((c) => kb.bindDescribe(c)));
  bindNames = new Map(all.map((c, i) => [JSON.stringify(c), names[i].join(' + ')]));
  const tbl = h('table.t', h('thead', h('tr', h('th', 'Acción'), h('th', 'Asignaciones'), h('th', ''))));
  const body = h('tbody');
  for (const a of INIT.actions) {
    const list = (C.bindings || {})[a.id] || [];
    body.append(h('tr',
      h('td', a.label),
      h('td', list.length ? list.map((combo, i) => h('span.bind', bindNames.get(JSON.stringify(combo)) || combo.join(' + '),
        h('button', { title: 'Quitar', onclick: async () => {
          const b = { ...(C.bindings || {}) };
          b[a.id] = list.filter((_, j) => j !== i);
          await patch({ bindings: b });
          render();
        } }, '✕'))) : h('span.muted.small', 'Sin asignar')),
      h('td', h('button.btn.small', { onclick: () => startCapture(a) }, '+ Asignar'))));
  }
  tbl.append(body);
  main.append(h('div.card', tbl));
  const devs = INIT.devices || [];
  main.append(h('h2', 'Mandos detectados'), h('div.card', devs.length ? devs.map((d) => h('div.row', icon('gamepad'), d.name, h('span.mono.muted', d.id))) : h('div.muted', 'No se detecta ningún mando DirectInput. Los atajos de teclado funcionan igualmente.')));

  // Tableta gráfica (Wacom, Huion, Gaomon…), igual que en OpenKneeboard: por OpenTabletDriver con el plugin OTD-IPC,
  // o por wintab-adapter con el driver del fabricante.
  const T = C.tablet || {};
  const ts = INIT.tablet || { state: 'no-server', tablets: [] };
  const STATE = {
    connected: ts.tablets && ts.tablets.length ? `Conectada: ${ts.tablets.map((t) => `${t.name} (${Math.round(t.mx)}×${Math.round(t.my)})`).join(', ')}` : `Conectado a ${ts.server || 'OTD-IPC'}; mueve el lápiz para que aparezca la tableta`,
    disconnected: 'Se ha desconectado: ¿has cerrado OpenTabletDriver?',
    'no-server': 'No se encuentra OpenTabletDriver con OTD-IPC (ni wintab-adapter)',
  };
  const orient = h('select.f', { style: { width: 'auto' }, onchange: (e) => patch({ tablet: { orientation: Number(e.target.value) } }) },
    [[0, 'Normal (horizontal)'], [90, 'Girada 90° (vertical, como OpenKneeboard)'], [180, 'Girada 180°'], [270, 'Girada 270°']]
      .map(([v, l]) => h('option', { value: v, selected: Number(T.orientation != null ? T.orientation : 90) === v }, l)));
  const which = h('select.f', { style: { width: 'auto' }, onchange: (e) => patch({ tablet: { view: e.target.value === 'a' ? null : Number(e.target.value) } }) },
    [['a', 'El activo'], ['0', 'Kneeboard 1'], ['1', 'Kneeboard 2']]
      .map(([v, l]) => h('option', { value: v, selected: (T.view == null ? 'a' : String(T.view)) === v }, l)));
  main.append(h('h2', 'Tableta gráfica'), h('div.card',
    h('div.row', h('b', 'Estado'), h('span', { className: `pillst ${ts.state === 'connected' ? 'ok ok' : ''}` }, STATE[ts.state] || ts.state)),
    chk('Usar la tableta', 'Toda la superficie de la tableta es el kneeboard: con el lápiz cerca ves un cursor (también en el visor), al apoyarlo escribes o pulsas, y con el botón del lápiz borras. No le quita el foco a DCS.', T.enabled !== false, (v) => patch({ tablet: { enabled: v } })),
    h('div.row', h('span', { style: { width: '160px' } }, 'Orientación'), orient),
    h('div.row', h('span', { style: { width: '160px' } }, 'Controla'), which),
    h('p.small.muted', { style: { marginBottom: 0 } }, 'Cómo prepararla (igual que para OpenKneeboard): instala OpenTabletDriver (opentabletdriver.net) y su plugin OTD-IPC (go.openkneeboard.com/otd-ipc), después de quitar el driver del fabricante. Si prefieres el driver de Wacom o Huion, usa wintab-adapter. Solo un programa a la vez puede leer la tableta: cierra OpenKneeboard si lo tienes abierto. Los botones de la tableta aparecen como un mando más y se asignan arriba, en esta misma página.')));
};
kb.on('tablet-status', (s) => { INIT.tablet = s; if (section === 'controles') render(); });

function startCapture(action) {
  const box = document.getElementById('capture');
  document.getElementById('captureAction').textContent = action.label;
  document.getElementById('captureKeys').textContent = 'Esperando…';
  box.hidden = false;
  kb.bindCapture(action.id);
}
document.getElementById('captureCancel').onclick = () => kb.bindCancel();
kb.on('bind:progress', (names) => { document.getElementById('captureKeys').textContent = names.join(' + '); });
kb.on('bind:captured', async ({ action, combo }) => {
  document.getElementById('capture').hidden = true;
  if (!combo) return;
  const b = { ...(C.bindings || {}) };
  const list = b[action] ? [...b[action]] : [];
  if (!list.some((c) => JSON.stringify(c) === JSON.stringify(combo))) list.push(combo);
  b[action] = list;
  await patch({ bindings: b });
  if (section === 'controles') render();
});
kb.on('devices', (d) => { INIT.devices = d; if (section === 'controles') render(); });

// Qué pasó la última vez que DCS arrancó en VR, leído del registro de la capa. Solo se muestra si el visor no está activo.
function vrDiagnosis(st) {
  const L = st.layerLog;
  const b = st.vrBridge || {};
  const when = L ? new Date(L.at).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  let cls = 'muted';
  let msg;
  if (b.error) {
    cls = 'warn';
    msg = `${b.error} Cierra LF Kneeboard del todo (también de la bandeja) y vuelve a abrirlo.`;
  } else if (!L || !L.loaded) {
    msg = 'DCS aún no ha cargado la capa. Si DCS estaba abierto cuando la registraste, reinícialo. Tiene que arrancar en VR por OpenXR: si lo fuerzas a SteamVR/OpenVR, la capa no entra.';
  } else if (L.problem && /permiso denegado/.test(L.problem)) {
    cls = 'warn';
    msg = `Última vez en DCS (${when}): la capa no pudo conectar porque DCS y LF Kneeboard se ejecutaban con permisos distintos (uno como administrador). Desde esta versión debería funcionar igual; si sigue pasando, ábrelos los dos igual.`;
  } else if (L.problem && /no está abierto/.test(L.problem)) {
    msg = `Última vez en DCS (${when}): LF Kneeboard no estaba abierto (o se cerró) mientras volabas en VR.`;
  } else if (L.problem) {
    cls = 'warn';
    msg = `Última vez en DCS (${when}): ${L.problem}`;
  } else if (!L.session) {
    cls = 'warn';
    msg = `Última vez en DCS (${when}): la capa se cargó, pero DCS no llegó a abrir la sesión de VR.`;
  } else if (!L.connected) {
    cls = 'warn';
    msg = `Última vez en DCS (${when}): la capa se cargó pero no conectó con el kneeboard. Hasta la 0.3.11 era un fallo del instalador, ya corregido: reinicia DCS y vuelve a probar. Si sigue pasando, envía el registro de VR.`;
  } else {
    msg = `Última vez en DCS (${when}): todo correcto, la capa se conectó con el kneeboard.`;
  }
  const extra = [];
  if (b.elevated) extra.push('LF Kneeboard se está ejecutando como administrador.');
  if (L && L.dcsElevated) extra.push('DCS se ejecutó como administrador.');
  return h('div.vrdiag',
    h(`div.small.${cls}`, msg),
    extra.length ? h('div.small.muted', extra.join(' ')) : null,
    h('div.row', h('button.btn.small', { onclick: () => kb.vrOpenLog() }, 'Ver registro de VR'), h('button.btn.small', { onclick: () => render() }, 'Comprobar de nuevo')));
}

R.vr = async () => {
  const st = await kb.integrationStatus();
  main.append(h('h1', 'Realidad virtual'), h('p.lead', 'El kneeboard se dibuja dentro del visor mediante una capa OpenXR (como OpenKneeboard). Mueve los controles con DCS abierto y verás el cambio al momento.'));
  main.append(h('div.card',
    h('div.row', h('b', 'Capa OpenXR'), st.layer.registered ? h('span.pillst.ok.ok', 'Registrada') : h('span.pillst.warn.warn', 'No registrada'),
      st.vrActive ? h('span.pillst.ok.ok', 'Visor activo ahora') : null, h('span.grow'),
      st.layer.registered
        ? h('button.btn.small', { onclick: async () => { await kb.integrationUninstall({ layer: true }); render(); } }, 'Quitar')
        : h('button.btn.small.primary', { onclick: async () => { const r = await kb.integrationInstall({ layer: true }); if (r.error) alert(r.error); render(); } }, 'Registrar')),
    st.layer.others.length ? h('div.small.muted', `También tienes registrado: ${st.layer.others.map((o) => o.path).join(', ')}. Si usas los dos kneeboards a la vez, se verán ambos.`) : null,
    !st.vrActive && (st.layer.registered || st.layerLog) ? vrDiagnosis(st) : null,
    chk('Mostrar en VR', null, C.vr.enabled, (v) => patch({ vr: { enabled: v } })),
    chk('Ocultar la ventana del monitor', 'Útil si solo vuelas en VR. Para escribir con el teclado usa la acción «Modo escritura».', C.vr.hideWindow, (v) => patch({ vr: { hideWindow: v } })),
    chk('Ampliar al mirarlo', 'El kneeboard crece cuando lo miras de frente.', C.vr.gazeZoom, (v) => patch({ vr: { gazeZoom: v } })),
    slider('Ampliación', C.vr.zoomScale, 1, 2.5, 0.05, (v) => `×${v.toFixed(2)}`, (v) => patch({ vr: { zoomScale: v } })),
    slider('Opacidad sin mirar', C.vr.opacityIdle, 0.1, 1, 0.05, (v) => `${Math.round(v * 100)} %`, (v) => patch({ vr: { opacityIdle: v } })),
    slider('Opacidad mirándolo', C.vr.opacityGaze, 0.3, 1, 0.05, (v) => `${Math.round(v * 100)} %`, (v) => patch({ vr: { opacityGaze: v } })),
    h('div.row', h('button.btn', { onclick: () => kb.recenter() }, '⟳ Recentrar ahora'), h('span.muted.small', 'Toma tu posición actual de la cabeza como referencia (también con la acción «Recentrar en VR»).'))));
  const count = C.dual ? 2 : 1;
  for (let i = 0; i < count; i++) {
    const v = C.views[i].vr;
    const upd = (fn) => {
      const views = C.views.map((x) => ({ ...x, vr: { ...x.vr, pos: [...x.vr.pos], rot: [...x.vr.rot] } }));
      fn(views[i].vr);
      patch({ views });
    };
    main.append(h('h2', count > 1 ? `Kneeboard ${i + 1}` : 'Posición'),
      h('div.card',
        slider('Derecha / izquierda', v.pos[0] * 100, -60, 60, 1, (x) => `${x.toFixed(0)} cm`, (x) => upd((o) => { o.pos[0] = x / 100; })),
        slider('Altura', v.pos[1] * 100, -80, 40, 1, (x) => `${x.toFixed(0)} cm`, (x) => upd((o) => { o.pos[1] = x / 100; })),
        slider('Distancia', -v.pos[2] * 100, 15, 120, 1, (x) => `${x.toFixed(0)} cm`, (x) => upd((o) => { o.pos[2] = -x / 100; })),
        slider('Giro (guiñada)', v.rot[0], -90, 90, 1, (x) => `${x.toFixed(0)}°`, (x) => upd((o) => { o.rot[0] = x; })),
        slider('Inclinación', v.rot[1], -90, 30, 1, (x) => `${x.toFixed(0)}°`, (x) => upd((o) => { o.rot[1] = x; })),
        slider('Alabeo', v.rot[2], -45, 45, 1, (x) => `${x.toFixed(0)}°`, (x) => upd((o) => { o.rot[2] = x; })),
        slider('Tamaño (ancho)', v.width * 100, 10, 60, 0.5, (x) => `${x.toFixed(1)} cm`, (x) => upd((o) => { o.width = x / 100; }))));
  }
};

R.mision = async () => {
  main.append(h('h1', 'Misión'), h('p.lead', 'Con DCS abierto la misión se carga sola. También puedes cargar un .miz a mano para preparar el vuelo antes de entrar.'));
  const init = await kb.init();
  const m = init.mission;
  const unitSel = h('select.f', { onchange: async (e) => { await kb.selectUnit(e.target.value); render(); } },
    (m ? m.players : []).map((p) => h('option', { value: p.unitName, selected: m.unit && m.unit.name === p.unitName }, `${p.callsign || p.unitName} — ${p.type} (${p.coalition === 'red' ? 'rojo' : 'azul'})`)));
  main.append(h('div.card',
    m ? h('div', h('div.row', h('b', m.name || 'Misión'), h('span.muted', `${m.theatre} · inicio ${m.startTimeText}${m.manual ? ' · cargada a mano' : ''}`)),
      h('div.row', h('span.muted', 'Tu plaza:'), unitSel)) : h('div.muted', 'Sin misión cargada.'),
    h('div.row', h('button.btn.primary', { onclick: async () => {
      const r = await kb.openDialog({ properties: ['openFile'], filters: [{ name: 'Misión de DCS', extensions: ['miz'] }] });
      if (r[0]) {
        try { await kb.loadMiz(r[0]); } catch (e) { alert(`No se pudo leer: ${e.message}`); }
        render();
      }
    } }, 'Cargar .miz…'))));

  const type = (m && m.unit && m.unit.type) || (init.live && init.live.type) || '';
  const dtcs = await kb.dtcList();
  if (type) {
    const plan = C.plan || {};
    const dtcSel = h('select.f', { onchange: (e) => patch({ dtc: { ...(C.dtc || {}), [type]: e.target.value || null } }) },
      h('option', { value: '' }, 'Automático: el de la misión o el de DKS (*_OB)'),
      h('option', { value: 'mision', selected: (C.dtc || {})[type] === 'mision' }, 'Ninguno: presets y ruta de la misión'),
      dtcs.map((d) => h('option', { value: d.file, selected: (C.dtc || {})[type] === d.file }, `${d.aircraft} / ${d.name}`)));
    main.append(h('h2', `Ajustes para ${type}`), h('div.card',
      h('div.row', h('span', { style: { width: '220px' } }, 'DTC del avión'), dtcSel,
        h('button.btn', { onclick: async () => { const r = await kb.dtcImport(); if (r && !r.error) { C = (await kb.init()).config; render(); } } }, icon('importFile'), ' Importar…')),
      h('div.small.muted', 'Del DTC salen las radios, la ruta con sus horas, las líneas y amenazas del mapa y la pestaña DTC (contramedidas, RWR, HARM, JDAM). Al importarlo se copia a Saved Games\DCS\DTC para que también lo puedas cargar en cabina. Si la misión trae una carpeta «DTC» junto al .miz, se usa sola.'),
      h('div.row', h('span', { style: { width: '220px' } }, 'Consumo medio (lb/min)'),
        h('input.f', { type: 'number', min: 0, step: 1, value: (plan.fuelFlow || {})[type] || '', style: { width: '110px' },
          onchange: (e) => patch({ plan: { fuelFlow: { ...(plan.fuelFlow || {}), [type]: Number(e.target.value) || 0 } } }) }),
        h('span.muted.small', 'Para estimar el combustible en cada punto del plan de vuelo.'))));
  }
  const th = m && m.theatre;
  if (th) {
    main.append(h('h2', 'Declinación magnética'), h('div.card', h('div.row',
      h('span', `${th}: `), h('input.f', { type: 'number', step: 0.5, value: (C.magvar || {})[th] ?? '', placeholder: String(m.magvar), style: { width: '100px' },
        onchange: (e) => patch({ magvar: { ...(C.magvar || {}), [th]: e.target.value === '' ? null : Number(e.target.value) } }) }),
      h('span.muted.small', 'Grados (este positivo). Vacío = valor aproximado del mapa. Compruébalo con el rumbo magnético de tu avión.'))));
  }
  const course = init.course;
  main.append(h('h2', 'Curso de DKS'), h('div.card',
    h('p.muted.small', { style: { marginTop: 0 } }, 'La pestaña «Lección» muestra la lección del curso: objetivos, tareas para marcar en vuelo, notas y la hoja de evaluación. Si el nombre de la misión o del .miz lleva el código de la lección (p. ej. «TIE-1»), se abre sola.'),
    course && !course.error
      ? h('div.row', h('b', `${course.course.identifier || ''} · ${course.course.title || ''}`), h('span.muted', `${course.phases.reduce((n, p) => n + p.modules.reduce((k, m) => k + m.lessons.length, 0), 0)} lecciones`))
      : h('div.muted', course && course.error ? `No se pudo leer el curso: ${course.error}` : 'Sin curso cargado.'),
    h('div.row',
      h('button.btn.primary', { onclick: async () => {
        const r = await kb.openDialog({ properties: ['openFile'], filters: [{ name: 'Curso de DKS', extensions: ['json'] }] });
        if (r[0]) { const c = await kb.courseLoad(r[0]); if (c && c.error) alert(c.error); render(); }
      } }, 'Cargar curso (.json)…'),
      chk('Elegir la lección según la misión', null, (C.course || {}).auto !== false, (v) => patch({ course: { auto: v } })))));

  main.append(h('h2', 'Modo automático'), h('div.card',
    h('p.muted.small', { style: { marginTop: 0 } }, 'Cuando está activado (botón AUTO del kneeboard o su acción), el kneeboard cambia a la pestaña asignada a cada fase. Si cambias de página a mano, espera un rato antes de volver a moverse solo.'),
    slider('Pausa tras uso manual', C.auto.pauseSec, 10, 300, 5, (v) => `${v} s`, (v) => patch({ auto: { pauseSec: v } })),
    slider('Aproximación a', C.auto.approachNm, 5, 40, 1, (v) => `${v} nm`, (v) => patch({ auto: { approachNm: v } })),
    slider('Zona del objetivo a', C.auto.targetNm, 2, 30, 1, (v) => `${v} nm`, (v) => patch({ auto: { targetNm: v } }))));
};

R.biblioteca = async () => {
  const st = await kb.library.status();
  main.append(h('h1', 'Piernógrafo'), h('p.lead', 'El piernógrafo de cada avión se arma con tus juegos de páginas (mismo formato que KneeboardManager: una carpeta por juego con su kneeboard.json), más las páginas que trae la misión y las de la carpeta Kneeboard de DCS. Aquí eliges para qué aviones va cada juego, desactivas o reordenas páginas e importas PDF. En vuelo, marca en la pestaña Piernógrafo las páginas que te interesen y la pestaña Misión mostrará solo esas.'));
  const rootIn = h('input.f.grow', { value: st.root || '', placeholder: st.defaultRoot, readOnly: true });
  main.append(h('div.card',
    h('div.row', h('b', 'Carpeta'), rootIn,
      h('button.btn', { onclick: async () => { const r = await kb.openDialog({ properties: ['openDirectory', 'createDirectory'] }); if (r[0]) { await kb.library.setRoot(r[0]); render(); } } }, 'Elegir…'),
      h('button.btn', { onclick: async () => {
        const found = await kb.library.detect();
        if (!found.length) alert('No he encontrado ninguna biblioteca de KneeboardManager en el Escritorio ni en Documentos.');
        else { await kb.library.setRoot(found[0]); render(); }
      } }, 'Detectar'),
      st.root ? h('button.btn', { onclick: () => kb.library.open(st.root) }, 'Abrir') : null),
    !st.root ? h('div.row', h('span.muted.small', 'Sin biblioteca todavía.'), h('button.btn.small.primary', { onclick: async () => { await kb.library.setRoot(st.defaultRoot); await kb.library.create('Mis páginas', []); render(); } }, `Crear en ${st.defaultRoot}`)) : null,
    st.root ? h('div.row',
      h('button.btn.primary', { onclick: async (e) => {
        e.target.disabled = true;
        const r = await kb.library.apply();
        alert(`Copiadas ${r.copied} páginas al kneeboard de DCS (${r.aircraft.length} aviones). Solo se tocan los archivos que empiezan por «LFK».`);
        e.target.disabled = false;
      } }, 'Aplicar al kneeboard de DCS'),
      h('button.btn', { onclick: async () => { const n = await kb.library.remove(); alert(`Quitadas ${n} páginas de DCS.`); } }, 'Quitar de DCS'),
      h('button.btn', { onclick: async () => {
        const r = await kb.openDialog({ properties: ['openFile'], filters: [{ name: 'Misión de DCS', extensions: ['miz'] }] });
        if (!r[0]) return;
        const forAll = confirm('¿Meter las páginas para TODOS los aviones de la misión?\n\nAceptar: para todos (KNEEBOARD/IMAGES).\nCancelar: cada juego solo para sus aviones.');
        const res = await kb.library.inject(r[0], { forAll });
        alert(`Añadidas ${res.added} páginas al .miz. Copia de seguridad: ${res.backup}`);
      } }, 'Meter en un .miz…'),
      h('span.grow'),
      h('button.btn', { onclick: async () => { const n = prompt('Nombre del juego nuevo'); if (n) { await kb.library.create(n, []); libSel = n; render(); } } }, '+ Juego'),
      h('button.btn', { onclick: () => importPdf() }, 'Importar PDF…')) : null,
    h('div.small.muted', { id: 'libProgress' })));
  if (!st.root) return;

  const set = st.sets.find((s) => s.name === libSel) || st.sets.find((s) => s.pages.length) || st.sets[0];
  libSel = set ? set.name : null;
  const list = h('div.libsets', st.sets.map((s) => h('button.libset', { className: `libset${s === set ? ' sel' : ''}`, onclick: () => { libSel = s.name; render(); } },
    h('b', s.name), h('span', `${s.pages.filter((p) => !p.disabled).length}/${s.pages.length} págs · ${s.aircrafts.length ? `${s.aircrafts.length} aviones` : 'inactivo'}`))));
  const editor = h('div.card');
  if (set) {
    const acSel = h('select.f', h('option', { value: '' }, 'Añadir avión…'), st.aircraft.filter((a) => !set.aircrafts.includes(a)).map((a) => h('option', { value: a }, a)));
    acSel.onchange = async () => { if (acSel.value) { await kb.library.meta(set.dir, { aircrafts: [...set.aircrafts, acSel.value] }); render(); } };
    const pagesOrder = set.pages.map((p) => p.file);
    let dragFrom = null;
    editor.append(
      h('div.row', h('input.f.grow', { value: set.name, onchange: async (e) => { const n = e.target.value.trim(); if (n && n !== set.name) { await kb.library.rename(set.dir, n); libSel = n; render(); } } }),
        h('button.btn.small', { onclick: async () => { const r = await kb.openDialog({ properties: ['openFile', 'multiSelections'], filters: [{ name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] }); if (r.length) { await kb.library.importFiles(set.dir, r); render(); } } }, 'Importar imágenes…'),
        h('button.btn.small', { onclick: () => kb.library.open(set.dir) }, 'Abrir carpeta'),
        h('button.btn.small.danger', { onclick: async () => { if (confirm(`¿Mover «${set.name}» a la papelera?`)) { await kb.library.trash(set.dir); libSel = null; render(); } } }, 'Papelera')),
      h('div.row', h('span.muted.small', 'Aviones:'), set.aircrafts.length ? set.aircrafts.map((a) => h('span.bind', a, h('button', { onclick: async () => { await kb.library.meta(set.dir, { aircrafts: set.aircrafts.filter((x) => x !== a) }); render(); } }, '✕'))) : h('span.muted.small', 'ninguno (el juego no se usa)'), acSel),
      h('div.small.muted', { style: { margin: '10px 0 6px' } }, 'Clic en una página para activarla o desactivarla; arrástrala para cambiar el orden.'),
      h('div.thumbs', set.pages.map((p, i) => h('div.thumb', {
        className: `thumb${p.disabled ? ' off' : ''}`, draggable: true, title: p.file,
        ondragstart: () => { dragFrom = i; },
        ondragover: (e) => e.preventDefault(),
        ondrop: async (e) => {
          e.preventDefault();
          if (dragFrom == null || dragFrom === i) return;
          const order = [...pagesOrder];
          const [m] = order.splice(dragFrom, 1);
          order.splice(i, 0, m);
          await kb.library.meta(set.dir, { order });
          render();
        },
        onclick: async () => {
          const dis = new Set(set.pages.filter((x) => x.disabled).map((x) => x.file));
          if (dis.has(p.file)) dis.delete(p.file); else dis.add(p.file);
          await kb.library.meta(set.dir, { disabled_pages: [...dis] });
          render();
        },
      }, h('img', { src: p.url, loading: 'lazy' }), h('span', `${i + 1}. ${p.file}`)))));
  } else editor.append(h('div.muted', 'La biblioteca está vacía: crea un juego o importa un PDF.'));
  main.append(h('div.lib', list, editor));
};
let libSel = null;

async function importPdf() {
  const r = await kb.openDialog({ properties: ['openFile'], filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  if (!r[0]) return;
  const prog = document.getElementById('libProgress');
  const name = r[0].split(/[\\/]/).pop().replace(/\.pdf$/i, '');
  const lib = await loadPdfJs();
  const doc = await lib.getDocument({ url: await kb.fileUrl(r[0]), isEvalSupported: false }).promise;
  const urls = [];
  for (let i = 1; i <= doc.numPages; i++) {
    prog.textContent = `Convirtiendo «${name}»: página ${i} de ${doc.numPages}…`;
    const pg = await doc.getPage(i);
    const v1 = pg.getViewport({ scale: 1 });
    const vp = pg.getViewport({ scale: 1240 / v1.width });
    const c = document.createElement('canvas');
    c.width = Math.round(vp.width);
    c.height = Math.round(vp.height);
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    await pg.render({ canvasContext: g, viewport: vp }).promise;
    urls.push(c.toDataURL('image/png'));
  }
  prog.textContent = 'Guardando…';
  await kb.library.savePages(name, name, urls, {});
  prog.textContent = `«${name}»: ${urls.length} páginas importadas. Elige ahora para qué aviones es.`;
  libSel = name;
  render();
}

R.voz = async () => {
  const v = C.voice || {};
  main.append(h('h1', 'Órdenes de voz'), h('p.lead', 'Controla el kneeboard hablando, sin conexión, con el reconocedor de voz de Windows en español. Útil en VR, donde no ves el teclado.'));
  const status = h('span.pillst', await kb.voiceStatus());
  const heard = h('span.mono.muted', '—');
  kb.on('voice-status', (s) => { status.textContent = s; });
  kb.on('voice-heard', (x) => { heard.textContent = x.text ? `«${x.text}» ${x.action ? `→ ${x.action}` : '(sin acción)'} ${x.conf != null ? `(${Math.round(x.conf * 100)} %)` : ''}` : 'no entendido'; });
  main.append(h('div.card',
    chk('Activar órdenes de voz', null, v.enabled, async (x) => { await patch({ voice: { enabled: x } }); render(); }),
    h('div.row', h('span', { style: { width: '170px' } }, 'Cómo se activa'),
      h('select.f', { onchange: (e) => patch({ voice: { mode: e.target.value } }) },
        h('option', { value: 'ptt', selected: v.mode !== 'wake' }, 'Mantener un botón (acción «Orden de voz» en Controles)'),
        h('option', { value: 'wake', selected: v.mode === 'wake' }, 'Palabra de activación (siempre escuchando)'))),
    h('div.row', h('span', { style: { width: '170px' } }, 'Palabra de activación'), h('input.f', { value: v.wake || 'piernógrafo', onchange: (e) => patch({ voice: { wake: e.target.value } }) }), h('span.muted.small', 'p. ej. «piernógrafo, radios»')),
    slider('Confianza mínima', v.minConfidence ?? 0.55, 0.3, 0.9, 0.05, (x) => `${Math.round(x * 100)} %`, (x) => patch({ voice: { minConfidence: x } })),
    h('div.row', h('b', 'Estado'), status), h('div.row', h('b', 'Último'), heard)));
  const rows = [
    ['página siguiente · siguiente · pasa página', 'Página siguiente'], ['página anterior · atrás', 'Página anterior'],
    ['página uno … página veinte', 'Ir a esa página'], ['pestaña siguiente / anterior', 'Cambiar de pestaña'],
    ['el nombre de una pestaña (p. ej. «radios», «plan de vuelo»)', 'Abrir esa pestaña'], ['muestra · oculta', 'Mostrar u ocultar el kneeboard'],
    ['marca punto · captura coordenadas', 'Coordenadas del centro del F10 al bloc'], ['modo automático · modo noche', 'Activar o desactivar'],
    ['recentra · zoom', 'VR'], ['cronómetro', 'Iniciar / parar'], ['envía página · compartido', 'Vuelo compartido'],
  ];
  main.append(h('h2', 'Qué puedes decir'), h('div.card', h('table.t', h('tbody', rows.map((r) => h('tr', h('td', h('kbd', r[0])), h('td', r[1])))))));
};

R.compartir = () => {
  const s = C.share;
  main.append(h('h1', 'Vuelo compartido'), h('p.lead', 'Comparte páginas, notas, puntos y dibujos con tu vuelo. Un piloto hace de anfitrión (o usáis un servidor de salas) y el resto se une con la misma sala.'));
  const status = h('span.pillst', INIT.share.status);
  kb.on('share-status', (st) => { status.textContent = st.status; status.className = `pillst ${st.status === 'conectado' ? 'ok' : ''}`; });
  main.append(h('div.card',
    h('div.row', h('span', { style: { width: '160px' } }, 'Tu indicativo'), h('input.f', { value: s.callsign, placeholder: 'Viper 1-1', onchange: (e) => patch({ share: { callsign: e.target.value } }) })),
    h('div.row', h('span', { style: { width: '160px' } }, 'Sala'), h('input.f', { value: s.room, onchange: (e) => patch({ share: { room: e.target.value } }) }), h('span.muted.small', 'Todos los del vuelo deben poner la misma.')),
    h('div.row', h('span', { style: { width: '160px' } }, 'Servidor'), h('input.f.grow', { value: s.url, disabled: s.host, onchange: (e) => patch({ share: { url: e.target.value } }) })),
    chk('Soy el anfitrión', `Tu PC hace de servidor en el puerto ${s.hostPort}. Pasa a tu vuelo la dirección ws://TU_IP:${s.hostPort}.`, s.host, async (v) => { await patch({ share: { host: v } }); render(); }),
    chk('Conectarme', null, s.connect || s.host, (v) => patch({ share: { connect: v } })),
    chk('Avisarme al recibir algo', null, s.notify, (v) => patch({ share: { notify: v } })),
    h('div.row', h('span', 'Estado:'), status)));
  // Qué dirección dar al vuelo (si eres el anfitrión): siempre la IP pública; las de la red local no se enseñan.
  const pubOut = h('span.bind', 'consultando tu IP pública…');
  const port = s.hostPort;
  const lookup = async () => {
    pubOut.textContent = 'consultando tu IP pública…';
    try {
      const r = await fetch('https://api.ipify.org?format=json');
      pubOut.textContent = `ws://${(await r.json()).ip}:${port}`;
    } catch { pubOut.textContent = 'no se pudo consultar (¿sin internet?)'; }
  };
  lookup();
  main.append(h('h2', 'Qué dirección dar a tu vuelo'), h('div.card',
    h('div.row', h('span', { style: { width: '160px' } }, 'Tu dirección pública'), pubOut,
      h('button.btn.small', { onclick: lookup }, 'Actualizar')),
    h('p.small.muted', { style: { marginBottom: 0 } }, `Solo hace falta si eres el anfitrión. Para que te lleguen, abre el puerto ${port} TCP en tu router hacia este PC. La IP pública se consulta en ipify.org; las direcciones de tu red local no se muestran.`)));
  main.append(h('div.card.small.muted',
    h('b', { style: { color: 'var(--ink)' } }, '¿Cómo nos conectamos?'),
    h('ul',
      h('li', 'Por internet sin VPN: el anfitrión abre el puerto 7790 TCP en su router y da su IP pública.'),
      h('li', 'Servidor del escuadrón: en la carpeta relay/ hay un servidor de salas (node relay.js) para dejarlo siempre encendido, por ejemplo junto al servidor de DCS. Así nadie tiene que hacer de anfitrión.'))));
};

R.dcs = async () => {
  const st = await kb.integrationStatus();
  main.append(h('h1', 'Integración con DCS'), h('p.lead', 'El script de DCS envía al kneeboard tu posición, la misión y los mensajes, y devuelve las coordenadas del F10. Es un archivo en Scripts\\Hooks; no modifica Export.lua.'));
  const card = h('div.card');
  if (!st.hooks.length) card.append(h('div.warn', 'No encuentro ninguna carpeta Saved Games\\DCS.'));
  for (const hk of st.hooks) {
    card.append(h('div.row', h('span.mono.grow', hk.dir), h('span', { className: `pillst ${hk.state === 'instalado' ? 'ok ok' : 'warn warn'}` }, hk.state)));
  }
  card.append(h('div.row',
    h('button.btn.primary', { onclick: async () => { const r = await kb.integrationInstall({ hook: true }); if (r.error) alert(r.error); render(); } }, st.hooks.some((x) => x.state !== 'instalado') ? 'Instalar / actualizar' : 'Reinstalar'),
    h('button.btn.danger', { onclick: async () => { await kb.integrationUninstall({ hook: true }); render(); } }, 'Quitar de DCS')));
  const camInfo = h('div.small.mono.muted', 'Cámara: sin datos (entra en una misión)');
  const showCam = (l) => {
    const c = l && l.cam;
    if (!c) return;
    camInfo.textContent = `Cámara: ${Math.round(c.agl)} m sobre el suelo · ${c.dist < 0 ? 'sin avión' : `${Math.round(c.dist)} m del avión`} · F10 detectado: ${c.mapView ? 'SÍ' : 'no'}`;
  };
  kb.on('live', showCam);
  // De dónde puede sacar el plan de vuelo la ruta de este avión (lo dice el script de DCS).
  const rs = st.routeSources;
  const srcInfo = h('div.small.mono.muted', rs
    ? `Ruta: avión en directo ${rs.loGetRoute ? `sí (${rs.loGetRoute} puntos)` : 'no'} · ${rs.bridge
      ? `herramienta de ruta del F10 ${rs.routeTool ? 'sí' : 'no'} · editor de DTC del juego ${rs.dtcEditor ? 'sí' : `no (ábrelo una vez${rs.dtcProbe ? ` · ${rs.dtcProbe}` : ''})`}`
      : 'puente con la interfaz de DCS sin conexión (reinicia DCS tras instalar)'}`
    : 'Ruta: sin datos (entra en una misión)');
  // Prueba: kneeboards dinámicos de los módulos (los que el propio módulo rellena, como los del Viggen).
  const probeOut = h('div.small.muted', 'Entra en la cabina del avión (por ejemplo, el Viggen) y pulsa «Probar».');
  const probeCard = h('div.card',
    h('div.row', h('b', 'Kneeboards de los módulos (prueba)'), h('span.grow'),
      h('button.btn.small', { onclick: async () => {
        probeOut.textContent = 'Probando…';
        const r = await kb.kneeboardProbe();
        probeOut.textContent = !r ? 'DCS no ha respondido: entra en una misión (el script de DCS tiene que estar actualizado, reinicia DCS si acabas de instalar).'
          : `list_indication: ${r.where} · ${r.found} indicadores con texto. Resultado en ${r.path}`;
      } }, 'Probar')),
    h('div.small.muted', 'Algunos módulos dibujan páginas de kneeboard que cambian con el mapa (aeródromos, waypoints, radios del Viggen…). No son imágenes: las rellena el módulo. Esta prueba mira si DCS deja leer ese texto para traerlo aquí.'),
    probeOut);
  main.append(card,
    h('div.card', h('div.row', h('b', 'Estado'), st.dcsConnected ? h('span.pillst.ok.ok', 'DCS conectado') : h('span.pillst', 'Sin conexión: entra en una misión')), camInfo, srcInfo,
      h('div.small.muted', `Puertos UDP locales ${C.dcs.appPort} (app) y ${C.dcs.hookPort} (DCS). Solo se usan dentro de tu PC.`)),
    probeCard);
};

R.actualizar = async () => {
  main.append(h('h1', 'Actualizaciones y perfil'), h('p.lead', 'LF Kneeboard se actualiza solo: descarga la versión nueva en segundo plano y la instala al cerrarlo, sin tocar tus ajustes ni lo instalado en DCS. Y puedes guardar todo tu perfil en un archivo para llevarlo a otro PC o pasárselo a otro piloto.'));
  const st = h('span.pillst');
  const detail = h('div.small.muted');
  const actions = h('div.row');
  const paint = (s) => {
    const txt = {
      dev: 'Versión de desarrollo: sin actualizaciones', idle: 'Sin comprobar todavía', checking: 'Buscando…', latest: 'Tienes la última versión',
      downloading: `Descargando ${s.version || ''} · ${s.progress || 0} %`, ready: `Versión ${s.version} lista`, error: 'No se pudo comprobar',
    }[s.state] || s.state;
    st.textContent = txt;
    st.className = `pillst ${s.state === 'latest' || s.state === 'ready' ? 'ok ok' : s.state === 'error' ? 'warn warn' : ''}`;
    detail.textContent = s.state === 'error' ? s.error || '' : s.state === 'ready'
      ? 'Se instalará al cerrar LF Kneeboard. Si prefieres, reinicia ahora (mejor fuera de vuelo).'
      : s.checkedAt ? `Última comprobación: ${new Date(s.checkedAt).toLocaleString('es-ES')}` : '';
    clear(actions).append(...[
      h('button.btn', { disabled: s.state === 'dev' || s.state === 'checking' || s.state === 'downloading', onclick: () => kb.update.check() }, icon('refresh'), ' Buscar ahora'),
      s.state === 'ready' ? h('button.btn.primary', { onclick: () => kb.update.install() }, icon('update'), ' Reiniciar e instalar') : null].filter(Boolean));
  };
  paint(await kb.update.status());
  kb.on('update-status', paint);
  main.append(h('div.card',
    h('div.row', h('b', `Versión ${INIT.version}`), st), detail,
    chk('Buscar actualizaciones automáticamente', 'Al arrancar y cada 6 horas, en GitHub (Releases de LF Kneeboard). Solo se descarga el instalador; no se envía nada tuyo.', (C.updates || {}).auto !== false, (v) => patch({ updates: { auto: v } })),
    actions));

  const out = h('div.small.muted');
  main.append(h('h2', 'Copia de tu perfil'), h('div.card',
    h('p.small.muted', { style: { marginTop: 0 } }, 'Un .zip con tus pestañas, controles del HOTAS, temas, ajustes de VR y tus datos: marcadores, nombres de los puntos, presets de radio, tarjetas guardadas, bloc y libro de vuelo. Las páginas de la biblioteca no van dentro (están en su carpeta).'),
    h('div.row',
      h('button.btn.primary', { onclick: async () => {
        const r = await kb.profileExport();
        if (!r) return;
        out.textContent = r.error ? `No se pudo exportar: ${r.error}` : `Guardado en ${r.file} (${r.stores} archivos de datos).`;
      } }, icon('exportFile'), ' Exportar perfil…'),
      h('button.btn', { onclick: async () => {
        const r = await kb.profileImport();
        if (r && r.error) out.textContent = r.error;
      } }, icon('importFile'), ' Importar perfil…')),
    out));
};

R.acerca = () => {
  main.append(h('h1', 'Acerca de'),
    h('div.card',
      h('div', h('b', 'LF Kneeboard '), h('span.muted', INIT.version)),
      h('p.muted', 'Hecho para La Fundación. Código abierto (MIT).'),
      h('div.small.muted', `Datos: ${INIT.userData}`)),
    h('h2', 'Créditos'),
    h('div.card.small.muted',
      h('div', 'Mapas: Leaflet (BSD-2). Teselas © Esri / Maxar, © OpenStreetMap, OpenTopoMap (CC-BY-SA), © CARTO.'),
      h('div', 'PDF: pdf.js de Mozilla (Apache-2.0).'),
      h('div', 'Fuentes: Inter, JetBrains Mono, Caveat, Patrick Hand, Share Tech Mono, Special Elite (SIL OFL / Apache).'),
      h('div', 'Datos de aeródromos y proyecciones: pydcs (LGPL-3.0).'),
      h('div', 'Cabeceras OpenXR: Khronos Group (Apache-2.0).')),
    h('div.row', h('button.btn.danger', { onclick: () => kb.quit() }, 'Cerrar LF Kneeboard')));
};

async function render() {
  clear(main);
  await (R[section] || R.general)();
}

(async function start() {
  INIT = await kb.init();
  C = INIT.config;
  document.getElementById('ver').textContent = `v${INIT.version}`;
  if (C.firstRun && !location.hash) section = 'bienvenida';
  nav();
  render();
  sideStatus();
  setInterval(sideStatus, 3000);
  kb.on('config', (c) => { C = c; });
  kb.on('goto', (s) => go(s));
  window.addEventListener('hashchange', () => { const s = location.hash.slice(1); if (s && s !== section) go(s); });
})();
