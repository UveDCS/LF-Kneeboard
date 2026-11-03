// Modo de prueba sin DCS (LFKB_SNAPSHOT=carpeta): carga un .miz (LFKB_MIZ), simula un avión en vuelo
// y guarda capturas de cada tema y cada pestaña. Lo usan las pruebas, no los usuarios.
const fs = require('fs');
const path = require('path');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function run({ cfg, dcs, views, vr, broadcast, openSettings, updater, injectShare }) {
  const out = process.env.LFKB_SNAPSHOT;
  fs.mkdirSync(out, { recursive: true });
  const log = [];
  const say = (m) => { log.push(m); console.log(`[snapshot] ${m}`); };
  try {
    const win = views[0];
    win.webContents.on('console-message', (e) => {
      const { level, message, lineNumber, sourceId } = e;
      if (level === 'error' || level === 'warning' || level === 3 || level === 2) say(`consola: ${message} (${sourceId}:${lineNumber})`);
    });
    win.webContents.reload();
    await wait(3000);
    if (process.env.LFKB_MIZ) {
      await dcs.loadMizFile(process.env.LFKB_MIZ);
      const m = dcs.mission;
      say(`misión: ${m.theatre}, unidad ${m.unit && m.unit.name}, ${m.route.length} WPs`);
      // Avión simulado a mitad del segundo tramo.
      const a = m.route[1] || m.route[0], b = m.route[2] || a;
      if (a && a.lat != null) {
        dcs.lastPacket = Date.now();
        dcs.handle({ t: 'state', type: m.unit.type, lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2, alt: 6700, agl: 6000, hdg: 75, ias: 180, gs: 210, vs: 0, gear: 0, mt: 1260, start: m.startTime, fuelInt: 2800 });
        dcs.emit('connection', true);
      }
      dcs.messages.push({ kind: 'radio', text: 'Overlord, Viper 1-1, comprobación, picture.', mt: 1200 }, { kind: 'trigger', text: 'Objetivo 1 destruido. Procedan al egreso.', mt: 1230 });
    }
    // Coordenadas de ejemplo en el bloc
    const r0 = dcs.mission && dcs.mission.route[1];
    if (r0) broadcast('coords', { lat: r0.lat + 0.05, lon: r0.lon + 0.05, alt: 412, src: 'F10', type: dcs.mission.unit.type, at: Date.now(), id: 'snap1' });
    await wait(800);

    const shot = async (name) => {
      await wait(900);
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(out, `${name}.png`), img.toPNG());
      say(`captura ${name} ${img.getSize().width}x${img.getSize().height}`);
    };
    const exec = (js) => win.webContents.executeJavaScript(js, true);
    const goTab = async (i) => { win.webContents.send('goto-tab', i); await wait(200); };
    if (process.env.LFKB_LIBRARY) cfg.patch({ library: { root: process.env.LFKB_LIBRARY } });
    // Pestañas de documentos opcionales para la prueba
    const extra = [];
    if (process.env.LFKB_PDF) extra.push({ id: 'snap-pdf', type: 'pdf', title: 'PDF', icon: '📕', path: process.env.LFKB_PDF, phases: [] });
    if (process.env.LFKB_WEB) extra.push({ id: 'snap-web', type: 'web', title: 'Web local', icon: '🌐', url: process.env.LFKB_WEB, phases: [] });
    if (process.env.LFKB_FOLDER) extra.push({ id: 'snap-folder', type: 'folder', title: 'Carpeta', icon: '🗂️', path: process.env.LFKB_FOLDER, phases: [] });
    if (process.env.LFKB_CHART) {
      // Calibración de prueba: dos waypoints de la misión en píxeles de la imagen (LFKB_CHART_CAL = JSON)
      const cal = JSON.parse(process.env.LFKB_CHART_CAL || '{"pts":[]}');
      const m = dcs.mission;
      cal.pts = cal.pts.map((p) => ({ ...p, lat: m.route[p.wp].lat, lon: m.route[p.wp].lon, label: `WP${p.wp}` }));
      await exec(`kb.storeSet(${JSON.stringify(`chart:${process.env.LFKB_CHART}:1`)}, ${JSON.stringify(cal)})`);
      extra.push({ id: 'snap-chart', type: 'chart', title: 'Carta', icon: '🛬', path: process.env.LFKB_CHART, page: 1, phases: [] });
    }
    if (process.env.LFKB_COURSE) {
      await exec(`kb.courseLoad(${JSON.stringify(process.env.LFKB_COURSE)})`);
      cfg.patch({ course: { lesson: process.env.LFKB_LESSON || null } });
    }
    if (extra.length) {
      cfg.patch({ tabs: [...cfg.get().tabs, ...extra] });
      broadcast('config', cfg.get());
      await wait(1500);
    }
    const tabs = cfg.get().tabs;
    // Presets de pestañas de ejemplo (el primero, en uso)
    const fav = (types) => tabs.map((t) => ({ ...t, fav: types.includes(t.type) }));
    cfg.patch({ tabPresets: [
      { id: 'snap-p1', name: 'Ataque con DTC', tabs: fav(['library', 'cards', 'flightplan', 'dtc', 'map', 'notes']) },
      { id: 'snap-p2', name: 'Entreno VFR', tabs: fav(['library', 'map', 'flightplan', 'timers']) },
    ], activePreset: 'snap-p1' });
    broadcast('config', cfg.get());

    // Una pestaña por captura con el tema tablet
    cfg.patch({ theme: 'tablet' });
    broadcast('config', cfg.get());
    for (let i = 0; i < tabs.length; i++) {
      await goTab(i);
      if (tabs[i].type === 'map' || tabs[i].type === 'pdf' || tabs[i].type === 'web') await wait(3500);
      await shot(`tab-${String(i).padStart(2, '0')}-${tabs[i].type}`);
    }
    // Marcadores, todas las pestañas e ir a página
    // Marcadores: se marcan en el Piernógrafo y la pestaña Misión enseña solo esas páginas
    const mi = tabs.findIndex((t) => t.type === 'dcs-kneeboard');
    const pg = tabs.findIndex((t) => t.type === 'library');
    if (mi >= 0 && pg >= 0) {
      await goTab(pg);
      await wait(800);
      await exec(`document.getElementById('bmBtn').click()`);
      await shot('bm-menu');
      await exec(`document.querySelectorAll('.bm-type')[5].click()`);
      await exec(`document.getElementById('nextPage').click(); document.getElementById('nextPage').click()`);
      await wait(300);
      await exec(`document.getElementById('bmBtn').click()`);
      await exec(`document.querySelectorAll('.bm-type')[0].click()`);
      await goTab(mi);
      await wait(800);
      await shot('mision-marcadas');
      await exec(`document.getElementById('bmListBtn').click()`);
      await shot('bm-list');
      await exec(`document.querySelector('.bm-go').click()`);
      await shot('bm-jump');
      await exec(`document.getElementById('allTabs').click()`);
      await shot('all-tabs');
      await exec(`document.querySelector('.tabtile').click()`);
      await exec(`document.getElementById('pageInd').click(); document.querySelector('#pageInd input').value = '12';`);
      await shot('goto-input');
      await exec(`document.querySelector('#pageInd input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
      await shot('goto-done');
    }
    if (pg >= 0) {
      await goTab(pg);
      await wait(800);
      await exec(`document.getElementById('idxBtn').click()`);
      await wait(2500);
      await shot('indice');
      win.webContents.send('action', 'next_page');
      win.webContents.send('action', 'next_page');
      await wait(1500);
      await shot('indice-juego-siguiente');
      win.webContents.send('action', 'open_index');
      await shot('indice-cerrado');
    }
    const mp = tabs.findIndex((t) => t.type === 'map');
    if (mp >= 0 && dcs.mission) {
      const m = dcs.mission;
      // Como si los hubiera renombrado el otro kneeboard
      broadcast('store-changed', 'wpnames', { [m.name || m.file || '']: { 1: 'IP Norte', 2: 'Objetivo' } });
      await wait(500);
      await win.webContents.executeJavaScript(`window.dispatchEvent(new Event('resize'))`);
      await goTab(mp);
      await wait(3500);
      const a = m.route[1], b = m.route[2] || a;
      if (a) broadcast('share-live', { type: 'mapink', from: 'Dagger 1-2', color: '#22c55e', pts: [[a.lat + 0.08, a.lon - 0.1], [a.lat + 0.12, a.lon], [b.lat + 0.08, b.lon + 0.05]] });
      await wait(1500);
      await shot('mapa-nombres');
      cfg.patch({ theme: 'libreta' });
      broadcast('config', cfg.get());
      await wait(1500);
      await shot('mapa-libreta');
      cfg.patch({ theme: 'tablet' });
      broadcast('config', cfg.get());
    }
    const li = tabs.findIndex((t) => t.type === 'lesson');
    if (li >= 0) {
      await goTab(li);
      for (const p of [1, 2]) {
        await exec(`document.getElementById('nextPage').click()`);
        await shot(`lesson-p${p}`);
      }
    }
    const ci = tabs.findIndex((t) => t.type === 'cards');
    if (ci >= 0) {
      await goTab(ci);
      await wait(500);
      await exec(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Añadir piloto')).click()`);
      await wait(200);
      await exec(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Añadir frecuencia')).click()`);
      await wait(200);
      await exec(`const i = document.querySelectorAll('.view:not(.hidden) input[placeholder="Indicativo"]')[0]; if (i) { i.value = 'Dagger 1-3'; i.dispatchEvent(new Event('input')); }`);
      await shot('cards-edit');
      await exec(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Guardadas')).click()`);
      await shot('cards-saved');
      await goTab(ci);
      await exec(`document.getElementById('nextPage').click()`);
      await shot('cards-navlog');
    }
    // DTC: pestaña página a página
    const di = tabs.findIndex((t) => t.type === 'dtc');
    if (di >= 0 && dcs.mission) {
      say(`DTC: ${dcs.mission.dtc ? `${dcs.mission.dtc.name} (${dcs.mission.dtc.origin}), ruta ${dcs.mission.routeSource}` : 'ninguno'}`);
      await goTab(di);
      await wait(800);
      await shot('dtc-resumen');
      for (let p = 1; p < 4; p++) {
        await exec(`document.getElementById('nextPage').click()`);
        await shot(`dtc-p${p}`);
      }
    }
    // DTC recibido por la sala
    const si = tabs.findIndex((t) => t.type === 'shared');
    if (si >= 0 && injectShare && dcs.mission && dcs.mission.dtc) {
      injectShare({ type: 'dtc', from: 'Dagger 1-2', ...require('./dtc').pack(dcs.mission.dtc.file) });
      await wait(500);
      await goTab(si);
      await shot('compartido-dtc');
      // Lo que manda el resto del vuelo: una nota, un punto y una página con datos (para la imagen del anuncio).
      const t0 = Date.now();
      injectShare({ type: 'note', from: 'Dagger 1-3', title: 'Cambio de plan', text: 'Push 14:25. Entramos por el norte, Dagger 1-3 y 1-4 cubren el SA-6.', at: t0 - 90000 });
      injectShare({ type: 'point', from: 'Dagger 1-2', point: { lat: 42.2711, lon: 42.0662, alt: 1214, name: 'SA-6 visto', note: 'Radar activo, 2 lanzadores' }, at: t0 - 45000 });
      const ci = tabs.findIndex((t) => t.type === 'cards');
      if (ci >= 0) {
        await goTab(ci);
        for (let k = 0; k < 4; k++) { win.webContents.send('action', 'prev_page'); await wait(150); }
        await wait(900);
      }
      const pageImg = await win.webContents.capturePage();
      injectShare({
        type: 'page', from: 'Dagger 1-1', title: 'Tarjeta de vuelo · Golpe de acero', at: t0,
        image: `data:image/jpeg;base64,${pageImg.resize({ width: 420 }).toJPEG(80).toString('base64')}`,
        data: { kind: 'card', label: 'Copiar la tarjeta en mi kneeboard', payload: {} },
      });
      await wait(800);
      await goTab(si);
      await wait(600);
      await shot('compartido-vuelo');
      for (const n of ['compartido-punto', 'compartido-nota']) {
        win.webContents.send('action', 'next_page');
        await wait(700);
        await shot(n);
      }
      // Dibujos de otros pilotos en el mapa, cada uno con su color y en la leyenda.
      const mpi = tabs.findIndex((t) => t.type === 'map');
      const r = dcs.mission.route || [];
      if (mpi >= 0 && r.length >= 3) {
        await goTab(mpi);
        await wait(2500);
        const A = r[0], T = r[1];   // del IP al objetivo, entrando por el norte
        const ctrl = { lat: (A.lat + T.lat) / 2 + 0.2, lon: (A.lon + T.lon) / 2 };
        const bez = Array.from({ length: 14 }, (_, i) => {
          const t = i / 13, u = 1 - t;
          return [u * u * A.lat + 2 * u * t * ctrl.lat + t * t * T.lat, u * u * A.lon + 2 * u * t * ctrl.lon + t * t * T.lon].map((v) => Math.round(v * 1e5) / 1e5);
        });
        const th = (dcs.mission.dtc && dcs.mission.dtc.threats || [])[0] || T;
        const ring = Array.from({ length: 25 }, (_, i) => [th.lat + 0.06 * Math.sin(i / 24 * 2 * Math.PI), th.lon + 0.08 * Math.cos(i / 24 * 2 * Math.PI)].map((v) => Math.round(v * 1e5) / 1e5));
        // Punta de flecha al final del arco.
        const [pa, pb] = [bez[bez.length - 2], bez[bez.length - 1]];
        const ang = Math.atan2(pb[0] - pa[0], pb[1] - pa[1]);
        const tip = (d) => [pb[0] - 0.035 * Math.sin(ang + d), pb[1] - 0.035 * Math.cos(ang + d)].map((v) => Math.round(v * 1e5) / 1e5);
        injectShare({ type: 'mapink', from: 'Dagger 1-2', color: '#f472b6', pts: bez });
        injectShare({ type: 'mapink', from: 'Dagger 1-2', color: '#f472b6', pts: [tip(0.5), pb, tip(-0.5)] });
        await wait(400);
        injectShare({ type: 'mapink', from: 'Dagger 1-3', color: '#fb923c', pts: ring });
        await wait(1200);
        await shot('mapa-compartido');
      }
    }
    // Marcadores por avión: en el F-16 no salen los del F/A-18, y quitar/poner en uno no toca el otro
    if (mi >= 0 && dcs.mission && dcs.live) {
      const l0 = { ...dcs.live };
      const send = (type) => { dcs.lastPacket = Date.now(); dcs.handle({ t: 'state', type, lat: l0.lat, lon: l0.lon, alt: 6700, agl: 6000, hdg: 75, ias: 180, gs: 210, vs: 0, gear: 0, mt: 1260, start: dcs.mission.startTime, fuelInt: 2800 }); };
      send('F-16C_50');
      await wait(1200);
      await goTab(mi);
      await wait(800);
      await shot('bm-f16-vacio');
      await goTab(pg);
      await wait(800);
      await exec(`document.getElementById('bmBtn').click()`);
      await exec(`document.querySelectorAll('.bm-type')[3].click()`);
      await wait(400);
      const count = async (ac) => exec(`kb.storeGet('bookmarks@${ac}').then((b) => Object.keys(b || {}).length)`);
      say(`marcadores: F/A-18 ${await count('FA-18C_hornet')}, F-16 ${await count('F-16C_50')}`);
      send(dcs.mission.unit.type);
      await wait(1200);
      await goTab(mi);
      await wait(800);
      await shot('bm-f18-intactos');
    }
    // Pestaña web: escribir la dirección en la propia pestaña (aquí, un PDF del PC) la cambia y la guarda.
    if (process.env.LFKB_WEB && process.env.LFKB_PDF) {
      const wi = cfg.get().tabs.findIndex((t) => t.id === 'snap-web');
      if (wi >= 0) {
        await goTab(wi);
        await wait(2500);
        await shot('web-pagina');
        await exec(`(() => { const i = [...document.querySelectorAll('.webnav input.url')].find((x) => x.offsetParent);
          i.focus(); i.value = ${JSON.stringify(process.env.LFKB_PDF)};
          i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
        await wait(3000);
        const saved = (cfg.get().tabs.find((t) => t.id === 'snap-web') || {}).url;
        const pages = await exec(`(document.querySelector('.bar-page') || {}).textContent || ''`);
        say(`pestaña web con un PDF escrito en la dirección: guardada «${saved}», contador «${pages}», visor PDF ${await exec(`!!document.querySelector('.webwrap > .doc canvas')`)}`);
        await shot('web-pdf');
        win.webContents.send('action', 'next_page');
        await wait(1200);
        say(`pestaña web, PDF, página siguiente: «${await exec(`(document.querySelector('.bar-page') || {}).textContent || ''`)}»`);
        await exec(`(() => { const i = [...document.querySelectorAll('.webnav input.url')].find((x) => x.offsetParent);
          i.value = ''; })()`);
        cfg.patch({ tabs: cfg.get().tabs.map((t) => (t.id === 'snap-web' ? { ...t, url: '' } : t)) });
        broadcast('config', cfg.get());
        await wait(1500);
        await shot('web-vacia');
      }
    }

    // Página en la pestaña Misión sin ser marcador; Bloc a mano; Mensajes con su duración.
    {
      const list = cfg.get().tabs;
      const lib = list.findIndex((t) => t.type === 'library');
      const mis = list.findIndex((t) => t.type === 'dcs-kneeboard');
      if (lib >= 0 && mis >= 0) {
        await goTab(lib);
        win.webContents.send('action', 'next_page');
        win.webContents.send('action', 'next_page');
        await wait(900);
        await exec(`document.getElementById('bmBtn').click()`);
        await wait(500);
        await shot('bm-menu-mision');
        const added = await exec(`(() => { const b = [...document.querySelectorAll('#overlay button')].find((x) => /Añadir a la pestaña Misión/.test(x.textContent)); if (b) b.click(); return !!b; })()`);
        await wait(700);
        await goTab(mis);
        await wait(1200);
        say(`página añadida a Misión sin marcador: botón ${added}, contador «${await exec(`(document.querySelector('.bar-page') || {}).textContent || ''`)}»`);
        await shot('mision-sin-marcador');
        // Desde el índice del Piernógrafo: «+» en dos miniaturas y «Añadir todo el juego» en el segundo juego.
        await goTab(lib);
        await wait(600);
        await exec(`document.getElementById('idxBtn').click()`);
        await wait(1500);
        const r = await exec(`(() => {
          const t = [...document.querySelectorAll('.idx-mis')];
          t[3].click(); t[5].click();
          const all = document.querySelectorAll('.idx-mis-all');
          if (all[1]) all[1].click();
          return { toggles: t.length, on: document.querySelectorAll('.idx-mis.on').length, grupos: all.length };
        })()`);
        await wait(600);
        await shot('indice-mision');
        await exec(`document.querySelector('#overlay .close, #overlayClose') && document.querySelector('#overlay .close, #overlayClose').click()`);
        await goTab(mis);
        await wait(1500);
        say(`índice → Misión: ${JSON.stringify(r)}, contador de Misión «${await exec(`(document.querySelector('.bar-page') || {}).textContent || ''`)}»`);
        // Índice de la pestaña Misión: quitar dos páginas, quitar un grupo entero y devolver una.
        await exec(`document.getElementById('idxBtn').click()`);
        await wait(1500);
        const q = await exec(`(() => {
          const t = [...document.querySelectorAll('.idx-mis')];
          const antes = t.length;
          t[0].click(); t[1].click();
          const g = document.querySelectorAll('.idx-mis-all');
          if (g.length > 1) g[g.length - 1].click();
          t[1].click();
          return { antes, quitadas: document.querySelectorAll('.idx-tile.removed').length, grupos: g.length };
        })()`);
        await wait(600);
        await shot('indice-mision-quitar');
        await exec(`document.querySelector('#overlay .close, #overlayClose') && document.querySelector('#overlay .close, #overlayClose').click()`);
        await wait(1500);
        say(`Misión, quitar desde su índice: ${JSON.stringify(q)}, contador ahora «${await exec(`(document.querySelector('.bar-page') || {}).textContent || ''`)}»`);
      }
      const nti = list.findIndex((t) => t.type === 'notes');
      if (nti >= 0) {
        await goTab(nti);
        await wait(400);
        for (let k = 0; k < 8; k++) { win.webContents.send('action', 'prev_page'); await wait(80); }
        win.webContents.send('action', 'next_page'); // Coordenadas
        await wait(150);
        win.webContents.send('action', 'next_page'); // 9-line
        await wait(500);
        say(`bloc: títulos visibles ${await exec(`JSON.stringify([...document.querySelectorAll('.h1')].filter((x) => x.offsetParent).map((x) => x.textContent))`)} · página ${await exec(`(document.querySelector('.bar-page') || {}).textContent || ''`)} · pestaña ${await exec(`(document.querySelector('#tabs .tab.sel') || {}).title || ''`)}`);
        await exec(`(() => { const b = [...document.querySelectorAll('.h1 button')].find((x) => /A mano/.test(x.textContent)); if (b) b.click(); })()`);
        await wait(600);
        // Trazos simulados con un lápiz (pointerType pen, con presión) en los primeros campos.
        const drawn = await exec(`(() => {
          const pads = [...document.querySelectorAll('.handpad')].filter((p) => p.offsetParent);
          const strokes = [
            [[.05, .35], [.09, .75], [.13, .35]], [[.17, .7], [.2, .3], [.24, .7], [.21, .55], [.18, .55]],
            [[.30, .3], [.30, .75]], [[.36, .3], [.42, .3], [.36, .75], [.42, .75]],
          ];
          pads.slice(0, 4).forEach((pad, n) => {
            const r = pad.getBoundingClientRect();
            for (const st of strokes) {
              const pt = ([x, y], i) => ({ pointerId: 7, pointerType: 'pen', pressure: .6, buttons: 1, bubbles: true, clientX: r.left + (x + n * .08) * r.width, clientY: r.top + y * r.height });
              pad.dispatchEvent(new PointerEvent('pointerdown', pt(st[0])));
              for (let i = 1; i < st.length; i++) pad.dispatchEvent(new PointerEvent('pointermove', pt(st[i])));
              pad.dispatchEvent(new PointerEvent('pointerup', pt(st[st.length - 1])));
            }
          });
          return pads.length;
        })()`);
        await wait(800);
        say(`bloc a mano: ${drawn} campos para escribir`);
        await shot('bloc-a-mano');
      }
      const rl = list.findIndex((t) => t.type === 'radiolog');
      if (rl >= 0) {
        await goTab(rl);
        await wait(500);
        await exec(`[...document.querySelectorAll('.chip')].find((b) => /^15 min$/.test(b.textContent)).click()`);
        await wait(500);
        say(`mensajes: guardar ${JSON.stringify((cfg.get().messages || {}).keepMin)} min`);
        await shot('mensajes');
      }
      // Tableta gráfica (OTD-IPC falso, ver native/test/otdipc_server.c): trazo en la pizarra y cursor.
      const dr = list.findIndex((t) => t.type === 'draw');
      if (process.env.LFKB_TABLET_GO && dr >= 0) {
        await goTab(dr);
        await wait(700);
        fs.writeFileSync(process.env.LFKB_TABLET_GO, '1');
        await wait(3500);
        say(`tableta: cursor ${await exec(`(() => { const c = document.querySelector('.tablet-cursor'); return c && !c.hidden ? c.style.transform : 'oculto'; })()`)}`);
        await shot('tableta-pizarra');
      }
    }

    // Lo que envías al vuelo también sale en tu «Compartido» (sala propia de prueba en el puerto 17790).
    {
      const list = cfg.get().tabs;
      const sh = list.findIndex((t) => t.type === 'shared');
      if (sh >= 0) {
        await exec(`kb.patchConfig({ share: { host: true, hostPort: 17790, connect: true, room: 'PRUEBA', callsign: 'Dagger 1-1' } })`);
        await wait(2500);
        const sent = await exec(`(async () => [
          await kb.shareSend({ type: 'note', title: 'Push', text: 'Push a las 14:25 por el norte.' }),
          await kb.shareSend({ type: 'point', point: { lat: 42.2711, lon: 42.0662, alt: 1214, name: 'Blanco 2', note: 'SA-6' } }),
          await kb.sharePage('Plan de vuelo', null),
          await kb.shareSend({ type: 'mapink', color: '#f00', pts: [[42, 42], [42.1, 42.1]] }),
        ])()`);
        await wait(800);
        await goTab(sh);
        await wait(800);
        say(`enviado al vuelo: ${JSON.stringify(sent)} · en mi Compartido: ${await exec(`kb.init().then((i) => (i.inbox || []).filter((x) => x.mine).map((x) => x.type).join(','))`)} · aviso de nuevos: «${await exec(`(document.querySelector('#tabs .tab.sel .badge') || {}).textContent || 'sin aviso'`)}»`);
        await shot('compartido-enviado');
        await exec(`kb.patchConfig({ share: { host: false, connect: false } })`);
      }
    }

    // Pestaña siguiente/anterior con favoritas: solo pasa por ellas (también saliendo de una que no lo es).
    {
      const list = cfg.get().tabs;
      const nonFav = list.findIndex((t) => !t.fav);
      if (nonFav >= 0 && list.some((t) => t.fav)) {
        const sel = () => exec(`(document.querySelector('#tabs .tab.sel') || {}).title || ''`);
        const favs = new Set(list.filter((t) => t.fav).map((t) => t.title));
        await goTab(nonFav);
        const seen = [];
        for (const a of ['next_tab', 'next_tab', 'next_tab', 'prev_tab', 'prev_tab']) {
          win.webContents.send('action', a);
          await wait(250);
          seen.push(await sel());
        }
        say(`pestaña siguiente desde «${list[nonFav].title}» (no favorita): ${seen.join(' > ')} · todas favoritas: ${seen.every((t) => favs.has(t)) ? 'SÍ' : 'NO'}`);
      }
    }
    const ti = tabs.findIndex((t) => t.type === 'timers');
    if (ti >= 0) {
      dcs.blocks = { aircraft: 'FA-18C_hornet', mission: 'Prueba', out: { mt: 50500, at: Date.now() - 900000 }, takeoff: { mt: 50820, at: Date.now() - 600000 }, landing: null, in: null, landings: 0 };
      broadcast('blocks', dcs.blocks);
      await goTab(ti);
      await shot('timers-blocks');
    }
    const ri = tabs.findIndex((t) => t.type === 'radios');
    if (ri >= 0) {
      await goTab(ri);
      await wait(500);
      await exec(`[...document.querySelectorAll('.view:not(.hidden) button')].find((b) => b.textContent.includes('Editar')).click()`);
      await shot('radios-edit');
      await exec(`[...document.querySelectorAll('.view:not(.hidden) button')].find((b) => b.textContent.includes('Listo')).click()`);
    }
    await exec(`document.getElementById('dualBtn').click()`);
    await wait(2500);
    await shot('dual-on');
    if (views[1]) {
      const img2 = await views[1].webContents.capturePage();
      fs.writeFileSync(path.join(out, 'dual-second.png'), img2.toPNG());
      say('captura dual-second');
    }
    await exec(`document.getElementById('dualBtn').click()`);
    // Bloc: coordenadas y 9-line
    const nt = tabs.findIndex((t) => t.type === 'notes');
    await goTab(nt);
    await exec(`[...document.querySelectorAll('.chip')].find((c) => c.textContent.startsWith('Coordenadas')).click()`);
    await shot('notes-coords');
    await exec(`[...document.querySelectorAll('.chip')].find((c) => c.textContent.startsWith('9-line')).click()`);
    await shot('notes-9line');
    // Todos los temas sobre el plan de vuelo y el bloc
    const fp = tabs.findIndex((t) => t.type === 'flightplan');
    for (const theme of ['tablet', 'libreta', 'portapapeles', 'tactico', 'mfd', 'dossier', 'noche']) {
      cfg.patch({ theme });
      broadcast('config', cfg.get());
      await goTab(fp);
      await shot(`theme-${theme}-plan`);
      await goTab(nt);
      await shot(`theme-${theme}-bloc`);
    }
    cfg.patch({ theme: 'tablet' });
    broadcast('config', cfg.get());

    // Actualizaciones (solo en la versión instalada): ¿responde GitHub y se entiende el resultado?
    if (process.env.LFKB_UPDATE_TEST && updater) {
      updater.check();
      await wait(10000);
      say(`actualizaciones: ${JSON.stringify(updater.state)}`);
    }
    // VR: ¿llegan fotogramas a la memoria compartida?
    if (vr && vr.ok) {
      const h0 = vr.readHeader();
      say(`VR: secuencia ${h0.readUInt32LE(64)}, ${h0.readUInt32LE(72)}x${h0.readUInt32LE(76)}, visible ${h0.readUInt32LE(80)}`);
    }

    const sw = openSettings();
    await wait(2500);
    for (const s of ['general', 'pestanas', 'controles', 'vr', 'mision', 'biblioteca', 'voz', 'compartir', 'dcs', 'actualizar']) {
      await sw.webContents.executeJavaScript(`location.hash = '${s}'`);
      await wait(s === 'general' || s === 'biblioteca' ? 3000 : 1200);
      const img = await sw.webContents.capturePage();
      fs.writeFileSync(path.join(out, `settings-${s}.png`), img.toPNG());
      say(`ajustes ${s}`);
    }
  } catch (e) {
    say(`ERROR ${e.stack}`);
  }
  fs.writeFileSync(path.join(out, 'log.txt'), log.join('\n'));
  require('electron').app.exit(0);
}

module.exports = { run };
