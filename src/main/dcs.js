// Enlace con DCS: recibe el estado del hook por UDP, carga la misión y calcula la fase de vuelo.
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const Geo = require('../shared/geo');
const { readMiz } = require('./miz');
const { buildMissionModel, dtcGeoItems, eachGroup } = require('./mission-model');
const { readDtcFile, parseDtc } = require('./dtc');

const KT = 1.943844;

class DcsLink extends EventEmitter {
  constructor(cfg) {
    super();
    this.cfg = cfg;
    this.sock = null;
    this.live = null;
    this.lastPacket = 0;
    this.mission = null;      // modelo para las páginas
    this.missionRaw = null;   // tabla completa
    this.missionSrc = null;   // { json, miz, name }
    this.identity = {};
    this.phase = null;
    this.phaseCandidate = null;
    this.phaseSince = 0;
    this.reqId = 1;
    this.pending = new Map();
    this.messages = [];
    this.kneeboardImages = [];
    this.manual = false;      // misión cargada a mano desde Ajustes
  }

  start() {
    const { appPort } = this.cfg.get().dcs;
    this.sock = dgram.createSocket({ type: 'udp4', reuseAddr: false });
    this.sock.on('message', (buf) => {
      let msg;
      try {
        msg = JSON.parse(buf.toString('utf8'));
      } catch {
        return;
      }
      this.lastPacket = Date.now();
      this.handle(msg);
    });
    this.sock.on('error', (e) => this.emit('error', e));
    this.sock.bind(appPort, '127.0.0.1');
    this.watchdog = setInterval(() => {
      const connected = this.connected();
      if (connected !== this.wasConnected) {
        this.wasConnected = connected;
        this.emit('connection', connected);
      }
    }, 1000);
    // Si la app se abre con DCS ya en vuelo, pide la misión.
    this.send({ cmd: 'mission' });
  }

  connected() {
    return Date.now() - this.lastPacket < 3000;
  }

  send(cmd) {
    if (!this.sock) return;
    const data = Buffer.from(JSON.stringify(cmd));
    this.sock.send(data, this.cfg.get().dcs.hookPort, '127.0.0.1', () => {});
  }

  request(cmd, timeoutMs = 1500) {
    const id = this.reqId++;
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        this.pending.delete(id);
        resolve(null);
      }, timeoutMs);
      this.pending.set(id, (msg) => {
        clearTimeout(t);
        resolve(msg);
      });
      this.send({ ...cmd, id });
    });
  }

  handle(msg) {
    if (msg.id != null && this.pending.has(msg.id) && (msg.t === 'coords' || msg.t === 'converted' || msg.t === 'kbprobe')) {
      const cb = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      cb(msg);
      return;
    }
    switch (msg.t) {
      case 'state':
        this.onState(msg);
        break;
      case 'mission':
        this.resetBlocks();
        this.identity = msg.id || {};
        this.manual = false;
        // Otra misión: lo hecho en la herramienta de ruta o en el editor de DTC era de la anterior.
        if (!this.missionSrc || this.missionSrc.miz !== msg.miz || this.missionSrc.name !== msg.name) {
          this.missionAt = Date.now();
          this.dtcPickedAt = {};
          this.routeTool = null;
          this.routeToolSig = null;
          this.dtcEditor = null;
        }
        this.loadFromDcs(msg);
        break;
      case 'routetool': {
        // Ruta hecha con la herramienta de ruta del F10 («Show Route Tool») y activada para sustituir la de la misión.
        const pts = Array.isArray(msg.pts) ? msg.pts.filter((p) => typeof p.x === 'number' && typeof p.y === 'number') : [];
        const sig = JSON.stringify(pts);
        if (sig === this.routeToolSig) break;
        this.routeToolSig = sig;
        this.routeTool = pts.length >= 2 ? { pts, at: Date.now() } : null;
        this.rebuild();
        break;
      }
      case 'dtceditor': {
        // Lo que hay en el editor de DTC del juego (briefing / selección de plaza), guardado o no.
        try {
          const raw = fs.readFileSync(msg.json, 'utf8');
          // El puente lo repite cada pocos segundos: solo cuenta como nuevo si ha cambiado.
          if (this.dtcEditor && raw === this.dtcEditorRaw) break;
          const json = JSON.parse(raw);
          const type = msg.type || json.type || (this.identity && this.identity.type) || (this.live && this.live.type) || '';
          const dtc = parseDtc({ ...json, type, name: 'Editor de DTC del juego' });
          if (!dtc.route.length && !dtc.radios.length && !dtc.cmds) break;
          this.dtcEditorRaw = raw;
          this.dtcEditor = { ...dtc, origin: 'editor del juego', useRoute: true, at: Date.now() };
          this.rebuild();
        } catch (e) {
          this.emit('log', `No se pudo leer el DTC del editor del juego: ${e.message}`);
        }
        break;
      }
      case 'sources':
        // Diagnóstico (Ajustes > Integración DCS): puntos que da LoGetRoute para este avión...
        this.loGetRoute = msg.loGetRoute || 0;
        break;
      case 'bridge':
        // ...y lo que ve el puente del mod en la interfaz de DCS (herramienta de ruta y editor de DTC).
        this.bridge = { version: msg.version, routeTool: !!msg.routeTool, dtcEditor: !!msg.dtcEditor, dtcProbe: msg.dtcProbe || '', at: Date.now() };
        break;
      case 'route': {
        // Ruta que lleva el avión ahora (si DCS la da para ese avión) y su punto activo.
        this.gotoIdx = msg.goto != null ? msg.goto : null;
        const pts = Array.isArray(msg.pts) ? msg.pts.map((p) => ({ x: p.x, y: p.z, alt: p.y })) : null;
        const sig = JSON.stringify(pts);
        if (sig !== this.liveRouteSig) {
          this.liveRouteSig = sig;
          this.liveRoute = pts && pts.length >= 2 ? pts : null;
          this.rebuild();
        }
        break;
      }
      case 'identity':
        this.identity = msg.id || {};
        this.rebuild();
        break;
      case 'msg':
        this.messages.push({ kind: msg.kind, text: msg.text, mt: msg.mt, at: Date.now() });
        if (this.messages.length > 300) this.messages.splice(0, this.messages.length - 300);
        this.emit('message', this.messages[this.messages.length - 1]);
        break;
      case 'stop':
        this.resetBlocks();
        this.live = null;
        this.setPhase(null);
        this.emit('live', null);
        break;
      default:
        break;
    }
  }

  // DTC del avión (ver dtcResolver en main.js). Se relee si el archivo cambia.
  // useRoute: su ruta sustituye a la de la misión (elegido a mano, el de la misión o uno de DKS).
  dtcFor(type) {
    if (!type) return null;
    if (this.dtcEditor && this.dtcEditor.type === type) return this.dtcEditor;
    if (!this.dtcResolver) return null;
    const d = this.dtcResolver(type, this.missionSrc && this.missionSrc.miz, this.dtcContext());
    if (!d || !d.file) return null;
    try {
      const mtime = fs.statSync(d.file).mtimeMs;
      if (!this.dtcCache || this.dtcCache.file !== d.file || this.dtcCache.mtime !== mtime) {
        this.dtcCache = { file: d.file, mtime, dtc: readDtcFile(d.file) };
      }
      return { ...this.dtcCache.dtc, origin: d.origin, useRoute: d.useRoute, at: d.at || 0 };
    } catch (e) {
      this.emit('log', `No se pudo leer el DTC ${d.file}: ${e.message}`);
      return null;
    }
  }

  get sources() {
    const b = this.bridge && Date.now() - this.bridge.at < 15000 ? this.bridge : null;
    if (this.loGetRoute == null && !b) return null;
    return { loGetRoute: this.loGetRoute || 0, bridge: !!b, routeTool: !!(b && b.routeTool), dtcEditor: !!(b && b.dtcEditor), dtcProbe: (b && b.dtcProbe) || '' };
  }

  // Lo que la misión dice del DTC: los que lleva dentro el .miz y los que tiene asignados la plaza.
  dtcContext() {
    let cartridges = [];
    const name = (this.identity && this.identity.unit) || (this.mission && this.mission.unit && this.mission.unit.name);
    if (this.missionRaw && name) {
      for (const { group } of eachGroup(this.missionRaw)) {
        const u = (Array.isArray(group.units) ? group.units : Object.values(group.units || {})).find((x) => x && x.name === name);
        if (u) {
          const c = u.DTC && u.DTC.Cartridges;
          cartridges = Array.isArray(c) ? c : Object.values(c || {});
          break;
        }
      }
    }
    const type = (this.identity && this.identity.type) || (this.live && this.live.type) || (this.mission && this.mission.unit && this.mission.unit.type);
    return { mizFiles: this.mizDtcFiles || [], cartridges, since: this.missionAt || 0, pickedAt: (this.dtcPickedAt || {})[type] || 0 };
  }

  // Al elegir o importar un DTC en el kneeboard, manda ese y no lo que hubiera en el editor del juego.
  // Además queda apuntado cuándo, para que pase delante de lo hecho antes en DCS (herramienta de ruta, DTC guardado).
  dropEditorDtc(type) {
    if (this.dtcEditor && (!type || this.dtcEditor.type === type)) this.dtcEditor = null;
    if (type) this.dtcPickedAt = { ...(this.dtcPickedAt || {}), [type]: Date.now() };
  }

  async loadFromDcs(msg) {
    this.missionSrc = msg;
    let raw = null;
    try {
      if (msg.json && fs.existsSync(msg.json)) raw = JSON.parse(fs.readFileSync(msg.json, 'utf8'));
    } catch (e) {
      this.emit('log', `No se pudo leer mission.json: ${e.message}`);
    }
    let imgs = [];
    if (msg.miz && fs.existsSync(msg.miz)) {
      try {
        const data = readMiz(msg.miz, { extractImages: true, aircraft: this.identity.type });
        if (!raw) raw = data.mission;
        imgs = data.imageFiles;
        this.mizDtcFiles = data.dtcFiles;
        this.warehouses = data.warehouses;
      } catch (e) {
        this.emit('log', `No se pudo leer el .miz: ${e.message}`);
      }
    }
    this.kneeboardImages = imgs;
    if (raw) {
      this.missionRaw = raw;
      await this.rebuild();
    }
  }

  loadMizFile(file, unitName) {
    const data = readMiz(file, { extractImages: true });
    this.warehouses = data.warehouses;
    this.mizDtcFiles = data.dtcFiles;
    this.manual = true;
    this.missionRaw = data.mission;
    this.kneeboardImages = data.imageFiles;
    this.missionSrc = { miz: file, name: path.basename(file, '.miz') };
    this.identity = unitName ? { unit: unitName } : {};
    return this.rebuild();
  }

  selectUnit(unitName) {
    this.identity = { ...this.identity, unit: unitName, group: null, type: null };
    return this.rebuild();
  }

  async rebuild() {
    if (!this.missionRaw) return;
    const id = this.identity || {};
    const type = id.type || (this.live && this.live.type);
    const sel = {
      unitName: id.unit, groupName: id.group, type,
      coal: id.coal === 1 ? 'red' : id.coal === 2 ? 'blue' : null,
      missionName: (this.missionSrc && this.missionSrc.name) || '',
      warehouses: this.warehouses,
      liveRoute: this.manual ? null : this.liveRoute,
      routeTool: this.manual ? null : this.routeTool,
      routePref: (this.cfg.get().sources || {}).route || 'auto',
      dtc: this.dtcFor(type),
    };
    let model = buildMissionModel(this.missionRaw, sel);
    // Misión cargada a mano (sin DCS): el avión se sabe al elegir la plaza; con él, su DTC.
    if (!sel.dtc && !type && model.unit && model.unit.type) {
      const dtc = this.dtcFor(model.unit.type);
      if (dtc) model = buildMissionModel(this.missionRaw, { ...sel, dtc });
    }
    model.manual = this.manual;
    model.file = (this.missionSrc && this.missionSrc.miz) || '';
    model.kneeboardImages = this.kneeboardImages;
    if (!model.projection) await this.convertViaDcs(model);
    this.mission = model;
    this.emit('mission', model);
  }

  // Mapas sin proyección conocida (Afganistán, Irak...): DCS convierte las coordenadas.
  async convertViaDcs(model) {
    if (!this.connected()) return;
    const items = [...model.route, ...model.support, ...(model.bullseye ? [model.bullseye] : []), ...dtcGeoItems(model.dtc)];
    const pts = items.map((p) => [p.x, p.y]);
    if (!pts.length) return;
    const res = await this.request({ cmd: 'convert', pts }, 2500);
    if (!res || !res.pts) return;
    items.forEach((p, i) => {
      const r = res.pts[i];
      if (r) { p.lat = r[0]; p.lon = r[1]; }
    });
  }

  async capture() {
    const res = await this.request({ cmd: 'capture' });
    if (!res || !res.point) return null;
    const p = res.point;
    return { lat: p.lat, lon: p.lon, alt: p.alt, mgrs: p.mgrs, src: p.mapView ? 'F10' : 'cámara', at: Date.now() };
  }

  onState(s) {
    const live = {
      type: s.type, lat: s.lat, lon: s.lon, altM: s.alt, aglM: s.agl, hdg: s.hdg,
      iasKt: s.ias != null ? s.ias * KT : null, gsKt: s.gs != null ? s.gs * KT : null, vs: s.vs,
      gear: s.gear, fuelInt: s.fuelInt, fuelExt: s.fuelExt, mapView: !!s.mapView, cam: s.cam || null,
      modelTime: s.mt, missionTime: s.start != null ? s.start + s.mt : null, paused: !!s.paused,
    };
    live.gotoIdx = this.gotoIdx != null ? this.gotoIdx : null;
    this.live = live;
    if (live.type && this.mission && this.mission.unit && this.mission.unit.type !== live.type && !this.manual) {
      this.identity.type = live.type;
      this.rebuild();
    }
    this.updatePhase(live);
    this.emit('live', live);
  }

  // Tiempos de bloque: calzos fuera, despegue, aterrizaje y calzos dentro (con la hora de la misión).
  updateBlocks(l, onGround) {
    const now = { mt: l.missionTime, at: Date.now() };
    const gs = l.gsKt || 0;
    let b = this.blocks;
    if (!b) {
      if (!onGround || gs < 3) return;
      b = this.blocks = {
        aircraft: l.type || (this.mission && this.mission.unit && this.mission.unit.type) || '',
        mission: (this.mission && this.mission.name) || (this.missionSrc && this.missionSrc.name) || '',
        out: now, takeoff: null, landing: null, in: null, landings: 0,
      };
      this.emit('blocks', b);
      return;
    }
    if (b.in) return;
    if (!onGround && (l.aglM || 0) > 15) {
      if (!b.takeoff) { b.takeoff = now; this.emit('blocks', b); }
      if (b.landing) { b.landing = null; this.emit('blocks', b); } // toma y despegue
      this.stoppedSince = null;
    } else if (onGround && b.takeoff) {
      if (!b.landing) { b.landing = now; b.landings++; this.emit('blocks', b); }
      if (gs < 1) {
        this.stoppedSince = this.stoppedSince || Date.now();
        if (Date.now() - this.stoppedSince > 20000) this.closeBlocks(now);
      } else this.stoppedSince = null;
    }
  }

  closeBlocks(now) {
    const b = this.blocks;
    if (!b || !b.out) return;
    if (!b.in) b.in = now || { mt: this.live && this.live.missionTime, at: Date.now() };
    if (b.takeoff) this.emit('logbook', { ...b });
    this.emit('blocks', b);
  }

  resetBlocks() {
    if (this.blocks && !this.blocks.in) this.closeBlocks();
    this.blocks = null;
    this.stoppedSince = null;
    this.emit('blocks', null);
  }

  updatePhase(l) {
    if (l.lat == null) return;
    const auto = this.cfg.get().auto;
    const onGround = l.aglM != null && l.aglM < 4 && (l.gear == null || l.gear > 0.5);
    this.updateBlocks(l, onGround);
    let p;
    if (onGround) {
      const gs = l.gsKt || 0;
      p = gs < 3 ? 'ground' : gs < 45 ? 'taxi' : 'takeoff';
    } else {
      p = 'enroute';
      const m = this.mission;
      const here = { lat: l.lat, lon: l.lon };
      if (l.aglM != null && l.aglM < 450 && (l.vs || 0) > 1.5 && (l.gear || 0) > 0.5) p = 'takeoff';
      if (m) {
        const tgt = targetPoint(m);
        if (tgt && tgt.lat != null && Geo.distanceNm(here, tgt) < auto.targetNm) p = 'target';
        const arr = m.arrival;
        if (arr && arr.lat != null) {
          const d = Geo.distanceNm(here, arr);
          if (d < auto.approachNm && ((l.gear || 0) > 0.5 || ((l.vs || 0) < -1 && d < auto.approachNm * 0.66))) p = 'approach';
        }
      }
    }
    // Histéresis: la fase debe mantenerse 3 s antes de cambiar.
    if (p !== this.phaseCandidate) {
      this.phaseCandidate = p;
      this.phaseSince = Date.now();
    } else if (p !== this.phase && Date.now() - this.phaseSince > 3000) {
      this.setPhase(p);
    }
  }

  setPhase(p) {
    if (p === this.phase) return;
    this.phase = p;
    this.emit('phase', p);
  }
}

function targetPoint(m) {
  const marked = m.route.find((w) => w.tgt);
  if (marked) return marked;
  const byTask = m.route.find((w) => w.tasks && w.tasks.some((t) => /Bomb|Attack|Engage/.test(t)));
  if (byTask) return byTask;
  return m.route.find((w) => /\b(tgt|target|obj|objetivo|blanco)\b/i.test(w.name || '')) || null;
}

module.exports = { DcsLink, targetPoint };
