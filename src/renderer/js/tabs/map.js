// Mapa: ruta (con tus nombres de los puntos), bullseye, apoyo, aeródromos y tu avión en directo,
// con una línea hasta el siguiente punto del plan de vuelo, y lo que trae el DTC: FLOT, zonas, corredores,
// líneas geográficas, puntos de CAP y burbujas de amenaza.
// Un clic muestra las coordenadas y las pasa al bloc; con el lápiz se dibuja sobre el mapa y se comparte con el vuelo,
// cada piloto con su color.
import { icon, iconSvg } from '../icons.js';
import { h, clear, deg, nm } from '../util.js';
import { wpName, advanceSeq } from './mission.js';

const BASES = {
  sat: { name: 'Satélite', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attr: 'Esri, Maxar, Earthstar' },
  topo: { name: 'Topográfico', url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', attr: '© OpenStreetMap, OpenTopoMap', sub: 'abc', max: 17 },
  dark: { name: 'Oscuro', url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', attr: '© OpenStreetMap, © CARTO', sub: 'abcd' },
  none: { name: 'Sin mapa (sin conexión)', url: null },
};

const ICON = { AWACS: 'radar', Tanquero: 'fuel', Barco: 'ship', JTAC: 'target' };

// Colores de los pilotos: cada indicativo tiene siempre el mismo (se puede cambiar el tuyo con el botón de color).
export const PILOT_COLORS = ['#ff2d55', '#38bdf8', '#22c55e', '#f59e0b', '#a855f7', '#f97316', '#2dd4bf', '#facc15'];
export function pilotColor(name) {
  let x = 0;
  for (const ch of String(name || '')) x = (x * 31 + ch.codePointAt(0)) >>> 0;
  return PILOT_COLORS[x % PILOT_COLORS.length];
}

const NEXT_COLOR = '#e879f9';
const DTC_STYLE = {
  geo: { color: '#f8fafc', weight: 2, dashArray: '2 6' },
  flot: { color: '#ef4444', weight: 3 },
  faor: { color: '#f97316', weight: 2, fillOpacity: 0.08 },
  corridor: { color: '#22d3ee', weight: 2, dashArray: '10 6' },
};

// Punto a una distancia y rumbo verdadero (aproximación plana: vale para unas decenas de millas).
function dest(p, brg, distNm) {
  const r = brg * Math.PI / 180;
  const dLat = distNm * Math.cos(r) / 60;
  return { lat: p.lat + dLat, lon: p.lon + distNm * Math.sin(r) / (60 * Math.cos(p.lat * Math.PI / 180)) };
}

export const map = {
  icon: 'map',
  label: 'Mapa con ruta y coordenadas',
  create(ctx, tab) {
    const L = window.L;
    const Geo = ctx.Geo;
    const wrap = h('div.mapwrap');
    const el = h('div.flush', wrap);
    let mapObj = null;
    let base = null;
    let baseId = tab.base || 'sat';
    const layers = {};
    let me = null;
    let follow = false;
    let drawing = false;
    let shareInk = false;
    let stroke = null;
    let nextIdx = null;  // punto al que vas (resaltado y con línea desde tu avión)
    let ownSeq = null;   // secuencia propia si no hay pestaña de plan de vuelo
    const inkBy = new Map(); // quién ha dibujado → color (leyenda)

    const callsign = () => (ctx.S.config.share && ctx.S.config.share.callsign) || 'Yo';
    const myColor = () => ctx.S.config.mapColor || pilotColor(callsign());

    const followBtn = h('button.tool', { title: 'Seguir a mi avión', onclick: () => { follow = !follow; followBtn.classList.toggle('on', follow); if (follow) centerMe(); } }, icon('follow'));
    const drawBtn = h('button.tool', { title: 'Lápiz sobre el mapa', onclick: () => setDrawing(!drawing) }, icon('pen'));
    const colorBtn = h('button.tool.map-color', { title: 'Tu color (el que verá el vuelo)', onclick: () => {
      const i = PILOT_COLORS.indexOf(myColor());
      const c = PILOT_COLORS[(i + 1) % PILOT_COLORS.length];
      ctx.kb.patchConfig({ mapColor: c });
    } }, h('span.swatch'));
    const shareBtn = h('button.tool', { title: 'Compartir dibujos con el vuelo', onclick: () => {
      shareInk = !shareInk;
      shareBtn.classList.toggle('on', shareInk);
      ctx.toast(shareInk ? 'Tus dibujos en el mapa los verá el vuelo' : 'Dibujos del mapa privados');
    } }, icon('live'));
    const clearBtn = h('button.tool', { title: 'Borrar dibujos', onclick: () => {
      layers.ink.clearLayers();
      inkBy.clear();
      drawLegend();
      if (shareInk) ctx.kb.shareSend({ type: 'clear', map: true });
    } }, icon('trash'));
    const baseBtn = h('button.tool', { title: 'Cambiar mapa base', onclick: () => {
      const ids = Object.keys(BASES);
      baseId = ids[(ids.indexOf(baseId) + 1) % ids.length];
      setBase();
      ctx.toast(`Mapa: ${BASES[baseId].name}`);
    } }, icon('layers'));
    const fitBtn = h('button.tool', { title: 'Ver toda la ruta', onclick: () => fit() }, icon('fit'));
    let showDtc = tab.dtcLayer !== false;
    const dtcBtn = h('button.tool', { title: 'Líneas, CAP y amenazas del DTC', hidden: true, onclick: () => {
      showDtc = !showDtc;
      dtcBtn.classList.toggle('on', showDtc);
      drawDtc();
      ctx.toast(showDtc ? 'Capas del DTC visibles' : 'Capas del DTC ocultas');
    } }, icon('radar'));
    dtcBtn.classList.toggle('on', showDtc);
    const legend = h('div.map-legend', { hidden: true });
    wrap.append(h('div.maptools', followBtn, fitBtn, baseBtn, dtcBtn, drawBtn, colorBtn, shareBtn, clearBtn), legend);

    function paintColor() {
      colorBtn.style.setProperty('--c', myColor());
    }
    paintColor();

    function init() {
      if (mapObj || !L) return;
      const mapDiv = h('div', { style: { position: 'absolute', inset: 0 } });
      wrap.prepend(mapDiv);
      mapObj = L.map(mapDiv, { zoomControl: false, attributionControl: true, worldCopyJump: true, preferCanvas: false }).setView([36, 36], 7);
      mapObj.attributionControl.setPrefix(false);
      L.control.zoom({ position: 'bottomright', zoomInTitle: 'Acercar', zoomOutTitle: 'Alejar' }).addTo(mapObj);
      L.control.scale({ imperial: true, metric: false, position: 'bottomleft' }).addTo(mapObj);
      for (const k of ['dtc', 'airfields', 'route', 'support', 'bulls', 'nav', 'ink', 'pts']) layers[k] = L.layerGroup().addTo(mapObj);
      setBase();
      mapObj.on('click', (e) => { if (!drawing) popupAt(e.latlng); });
      mapObj.on('dragstart', () => { if (follow) { follow = false; followBtn.classList.remove('on'); } });
      mapObj.on('zoomend', drawAirfields);
      mapObj.on('moveend', drawAirfields);
      // Lápiz
      const c = mapObj.getContainer();
      c.addEventListener('pointerdown', (e) => {
        if (!(drawing || e.pointerType === 'pen') || e.target.closest('.maptools, .leaflet-control, .leaflet-popup, .map-legend')) return;
        e.preventDefault();
        e.stopPropagation();
        mapObj.dragging.disable();
        const ll = mapObj.mouseEventToLatLng(e);
        stroke = { pts: [ll], line: L.polyline([ll], { color: myColor(), weight: 4, opacity: 0.9, interactive: false }).addTo(layers.ink), id: e.pointerId };
      }, true);
      window.addEventListener('pointermove', (e) => {
        if (!stroke || e.pointerId !== stroke.id) return;
        const ll = mapObj.mouseEventToLatLng(e);
        stroke.pts.push(ll);
        stroke.line.addLatLng(ll);
      }, true);
      window.addEventListener('pointerup', (e) => {
        if (!stroke || e.pointerId !== stroke.id) return;
        if (stroke.pts.length > 1) {
          stroke.line.bindTooltip(callsign(), { sticky: true });
          stroke.line.options.interactive = true;
          inkBy.set(callsign(), myColor());
          drawLegend();
          if (shareInk) ctx.kb.shareSend({ type: 'mapink', color: myColor(), pts: stroke.pts.map((p) => [round(p.lat), round(p.lng)]) });
        }
        stroke = null;
        if (!drawing) mapObj.dragging.enable();
      }, true);
      if (ctx.S.mission) onMission(ctx.S.mission, true);
      if (ctx.S.live) onLive(ctx.S.live);
    }

    const round = (v) => Math.round(v * 1e5) / 1e5;

    function setDrawing(on) {
      drawing = on;
      drawBtn.classList.toggle('on', on);
      wrap.classList.toggle('drawing', on);
      if (!mapObj) return;
      if (on) mapObj.dragging.disable();
      else mapObj.dragging.enable();
    }

    function setBase() {
      if (base) mapObj.removeLayer(base);
      base = null;
      const b = BASES[baseId];
      if (b.url) base = L.tileLayer(b.url, { attribution: b.attr, subdomains: b.sub || 'abc', maxZoom: b.max || 18, crossOrigin: true }).addTo(mapObj);
    }

    function drawLegend() {
      clear(legend);
      legend.hidden = !inkBy.size;
      for (const [who, c] of inkBy) legend.append(h('div', h('span.swatch', { style: { background: c } }), who));
    }

    function popupAt(ll, extra = {}) {
      const p = { lat: ll.lat, lon: ll.lng, src: 'mapa', type: ctx.aircraft(), ...extra };
      const fmts = Geo.formatPoint(p, p.type);
      const live = ctx.S.live;
      let rel = '';
      if (live && live.lat != null) rel = `Desde ti: ${deg(Geo.norm360(Geo.bearingDeg(live, p) - ctx.magvar()))} · ${nm(Geo.distanceNm(live, p))} nm`;
      const box = h('div.pt-popup',
        extra.title ? h('b', extra.title) : null,
        fmts.map((f) => h('div', h('span.muted', `${f.k} `), h('span.mono', f.v))),
        rel ? h('div.muted', rel) : null,
        h('div.btns',
          h('button.btn.small.primary', { onclick: () => { ctx.addPoint({ ...p, name: extra.title }); mapObj.closePopup(); } }, icon('notes'), ' Al bloc'),
          h('button.btn.small', { onclick: () => ctx.kb.shareSend({ type: 'point', point: { ...p, name: extra.title } }).then((ok) => ok && ctx.toast('Punto enviado al vuelo')) }, icon('send'), ' Al vuelo')));
      L.popup({ maxWidth: 320 }).setLatLng(ll).setContent(box).openOn(mapObj);
    }

    function fit() {
      const m = ctx.S.mission;
      const pts = m ? m.route.filter((w) => w.lat != null).map((w) => [w.lat, w.lon]) : [];
      if (pts.length) mapObj.fitBounds(pts, { padding: [40, 40], maxZoom: 10 });
      else if (me) centerMe();
    }

    // Aeródromos: puntos desde zoom 7 y su nombre desde zoom 9 (los de tu bando en azul, los neutrales en gris).
    function drawAirfields() {
      if (!mapObj) return;
      layers.airfields.clearLayers();
      const m = ctx.S.mission;
      const z = mapObj.getZoom();
      if (!m || !m.airfields || z < 7) return;
      const bounds = mapObj.getBounds().pad(0.2);
      for (const b of m.airfields) {
        if (b.lat == null || !bounds.contains([b.lat, b.lon])) continue;
        const own = b.side === 'own';
        const info = `${b.name}${b.vhf ? ` · ${b.vhf}` : ''}${b.tacan ? ` · ${b.tacan}` : ''}`;
        const mk = L.circleMarker([b.lat, b.lon], { radius: z >= 9 ? 6 : 4.5, color: '#fff', weight: 1.5, fillColor: own ? '#3b82f6' : '#64748b', fillOpacity: 0.95 })
          .on('click', (e) => { L.DomEvent.stop(e); popupAt(L.latLng(b.lat, b.lon), { title: b.name }); })
          .addTo(layers.airfields);
        if (z >= 9) mk.bindTooltip(z >= 10 ? info : b.name, { permanent: true, direction: 'right', offset: [8, 0], className: `af-label${own ? ' own' : ''}` });
        else mk.bindTooltip(info, { direction: 'top' });
      }
    }

    function drawRoute() {
      const m = ctx.S.mission;
      layers.route.clearLayers();
      if (!m) return;
      const pts = m.route.filter((w) => w.lat != null);
      if (!pts.length) return;
      L.polyline(pts.map((w) => [w.lat, w.lon]), { color: '#fbbf24', weight: 3, dashArray: '8 6', interactive: false }).addTo(layers.route);
      for (const w of pts) {
        const name = wpName(ctx, m, w);
        const isNext = w.idx === nextIdx;
        L.marker([w.lat, w.lon], { icon: L.divIcon({ className: `wp-marker${isNext ? ' next' : ''}`, html: String(w.idx) }), zIndexOffset: isNext ? 500 : 0 })
          .bindTooltip(name || w.typeText || `WP${w.idx}`, { permanent: !!name || isNext, direction: 'right', offset: [12, 0], className: `wp-label${isNext ? ' next' : ''}` })
          .on('click', (e) => { L.DomEvent.stop(e); popupAt(L.latLng(w.lat, w.lon), { title: `WP${w.idx} ${name}`.trim(), alt: w.altM }); })
          .addTo(layers.route);
      }
    }

    // Lo que trae el DTC del avión.
    function drawDtc() {
      if (!mapObj) return;
      layers.dtc.clearLayers();
      const d = ctx.S.mission && ctx.S.mission.dtc;
      const any = !!(d && (d.lines.length || d.caps.length || d.threats.length));
      dtcBtn.hidden = !any;
      if (!any || !showDtc) return;
      const ok = (p) => p && p.lat != null;
      for (const l of d.lines) {
        const pts = l.points.filter(ok).map((p) => [p.lat, p.lon]);
        if (pts.length < 2) continue;
        const st = { ...(DTC_STYLE[l.kind] || DTC_STYLE.geo), interactive: true };
        const shape = l.closed ? L.polygon(pts, st) : L.polyline(pts, { ...st, fill: false });
        shape.bindTooltip(l.label, { sticky: true, className: 'dtc-label' }).addTo(layers.dtc);
      }
      for (const c of d.caps.filter(ok)) {
        // Hipódromo: tramo de ida por el rumbo, giro hacia el lado indicado y vuelta en paralelo.
        const len = c.lengthNm || 10, dia = c.diameterNm || 5, crs = c.course || 0;
        const side = c.turn === 'derecha' ? 90 : -90;
        const a = { lat: c.lat, lon: c.lon }, b = dest(a, crs, len);
        const arc = (center, from) => Array.from({ length: 13 }, (_, i) => dest(center, from + (side > 0 ? 1 : -1) * i * 15, dia / 2));
        const cB = dest(b, crs + side, dia / 2), cA = dest(a, crs + side, dia / 2);
        const pts = [a, b, ...arc(cB, crs - side), dest(a, crs + side, dia), ...arc(cA, crs + side)].map((p) => [p.lat, p.lon]);
        L.polygon(pts, { color: '#38bdf8', weight: 2, fillOpacity: 0.06 }).bindTooltip(`${c.label} · ${Math.round(crs)}° · ${nm(len)} × ${nm(dia)} nm · giro a la ${c.turn}`, { sticky: true }).addTo(layers.dtc);
      }
      for (const t of d.threats.filter(ok)) {
        const label = [t.label, t.type && t.type !== 'Custom' ? t.type : '', t.radiusNm ? `${nm(t.radiusNm)} nm` : ''].filter(Boolean).join(' · ');
        if (t.radiusNm) L.circle([t.lat, t.lon], { radius: t.radiusNm * 1852, color: '#ef4444', weight: 2, fillColor: '#ef4444', fillOpacity: 0.1, interactive: false }).addTo(layers.dtc);
        L.marker([t.lat, t.lon], { icon: L.divIcon({ className: 'asset-marker', html: iconSvg('target', 22, '#ef4444') }), zIndexOffset: -100 })
          .bindTooltip(label, { permanent: true, direction: 'left', offset: [-12, 0], className: 'dtc-label threat' }).on('click', (e) => { L.DomEvent.stop(e); popupAt(L.latLng(t.lat, t.lon), { title: t.label }); }).addTo(layers.dtc);
      }
    }

    function onMission(m, refit) {
      if (!mapObj) return;
      for (const k of ['support', 'bulls']) layers[k].clearLayers();
      ownSeq = null;
      drawRoute();
      drawDtc();
      if (m.bullseye && m.bullseye.lat != null) {
        const c = [m.bullseye.lat, m.bullseye.lon];
        for (const r of [20, 40, 60, 80]) L.circle(c, { radius: r * 1852, color: '#38bdf8', weight: 1, fill: false, opacity: 0.55, interactive: false }).addTo(layers.bulls);
        L.marker(c, { icon: L.divIcon({ className: 'asset-marker', html: iconSvg('bullseye', 26, '#38bdf8') }) }).bindTooltip('Bullseye').addTo(layers.bulls)
          .on('click', (e) => { L.DomEvent.stop(e); popupAt(L.latLng(c[0], c[1]), { title: 'Bullseye' }); });
      }
      for (const s of m.support) {
        if (s.lat == null) continue;
        L.marker([s.lat, s.lon], { icon: L.divIcon({ className: 'asset-marker', html: iconSvg(ICON[s.kind] || 'target', 24, '#ffffff') }) })
          .bindTooltip(`${s.callsign} · ${s.kind}${s.freq ? ` · ${s.freq}` : ''}${s.tacan ? ` · ${s.tacan}` : ''}`)
          .on('click', (e) => { L.DomEvent.stop(e); popupAt(L.latLng(s.lat, s.lon), { title: s.callsign }); })
          .addTo(layers.support);
      }
      drawAirfields();
      if (ctx.S.live) drawNav(ctx.S.live);
      if (refit) fit();
    }

    function centerMe() {
      if (me && mapObj) mapObj.panTo(me.getLatLng(), { animate: true });
    }

    // El punto al que vas: el del plan de vuelo (si lo has elegido a mano, ese) o la secuencia por número.
    function currentNext(l) {
      const m = ctx.S.mission;
      if (!m || !m.route.length) return null;
      const fp = ctx.instance('flightplan');
      if (fp && fp.nextIdx) return fp.nextIdx();
      ownSeq = advanceSeq(m.route, ownSeq, l, Geo);
      return ownSeq;
    }

    // Línea discontinua desde tu avión hasta el siguiente punto, con rumbo y distancia.
    function drawNav(l) {
      layers.nav.clearLayers();
      const m = ctx.S.mission;
      if (!m || !l || l.lat == null) return;
      const idx = currentNext(l);
      if (idx !== nextIdx) { nextIdx = idx; drawRoute(); }
      const w = idx != null ? m.route[idx] : null;
      if (!w || w.lat == null) return;
      const brg = Geo.norm360(Geo.bearingDeg(l, w) - ctx.magvar());
      const d = Geo.distanceNm(l, w);
      L.polyline([[l.lat, l.lon], [w.lat, w.lon]], { color: NEXT_COLOR, weight: 2.5, dashArray: '4 6', opacity: 0.95, interactive: false }).addTo(layers.nav);
      const mid = [(l.lat + w.lat) / 2, (l.lon + w.lon) / 2];
      L.marker(mid, { icon: L.divIcon({ className: 'nav-label', html: `<span>WP${w.idx} · ${deg(brg)} · ${nm(d)} nm</span>`, iconSize: null }), interactive: false }).addTo(layers.nav);
    }

    function onLive(l) {
      if (!mapObj || !l || l.lat == null) return;
      const html = `<svg viewBox="0 0 40 40" style="transform:rotate(${Math.round(l.hdg || 0)}deg)"><path d="M20 3 L25 22 L37 28 L37 31 L24 28 L23 34 L28 37 L28 39 L20 37 L12 39 L12 37 L17 34 L16 28 L3 31 L3 28 L15 22 Z" fill="#ff2d55" stroke="#fff" stroke-width="1.5"/></svg>`;
      if (!me) me = L.marker([l.lat, l.lon], { icon: L.divIcon({ className: 'ac-marker', html }), zIndexOffset: 1000, interactive: false }).addTo(mapObj);
      else {
        me.setLatLng([l.lat, l.lon]);
        const svg = me.getElement() && me.getElement().querySelector('svg');
        if (svg) svg.style.transform = `rotate(${Math.round(l.hdg || 0)}deg)`;
      }
      drawNav(l);
      if (follow) mapObj.panTo([l.lat, l.lon], { animate: false });
    }

    return {
      el,
      pages: () => 1,
      show() {
        requestAnimationFrame(() => {
          init();
          if (mapObj) mapObj.invalidateSize();
        });
      },
      title: () => 'Mapa',
      onMission: (m) => onMission(m, true),
      onLive,
      // Nombres de los puntos cambiados (aquí o en el plan de vuelo) o color propio nuevo.
      onConfig: () => { paintColor(); if (mapObj) drawRoute(); },
      onResize: () => mapObj && mapObj.invalidateSize(),
      onShareLive(item) {
        if (!mapObj) return;
        if (item.type === 'mapink' && Array.isArray(item.pts)) {
          const c = item.color || pilotColor(item.from);
          L.polyline(item.pts, { color: c, weight: 4, opacity: 0.9 }).bindTooltip(item.from || '', { sticky: true }).addTo(layers.ink);
          inkBy.set(item.from || 'Vuelo', c);
          drawLegend();
          ctx.toast(`${item.from || 'El vuelo'} ha dibujado en el mapa`, 'share', 2000);
        }
        if (item.type === 'clear' && item.map) {
          layers.ink.clearLayers();
          inkBy.clear();
          drawLegend();
        }
        if (item.type === 'pointshow' && item.point) popupAt(L.latLng(item.point.lat, item.point.lon), { title: item.point.name });
      },
      showPoint(p) {
        ctx.goToType('map');
        requestAnimationFrame(() => {
          init();
          mapObj.setView([p.lat, p.lon], Math.max(mapObj.getZoom(), 10));
          popupAt(L.latLng(p.lat, p.lon), { title: p.name || 'Punto', alt: p.alt, mgrs: p.mgrs });
        });
      },
    };
  },
};
