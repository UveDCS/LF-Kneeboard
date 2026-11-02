// Vuelo compartido: conexión a una sala (y, si somos anfitriones, el propio servidor de salas).
const os = require('os');
const { EventEmitter } = require('events');
const WebSocket = require('ws');
const { createRelay } = require('../../relay/relay-core');

class Share extends EventEmitter {
  constructor(cfg) {
    super();
    this.cfg = cfg;
    this.ws = null;
    this.server = null;
    this.status = 'desconectado';
    this.members = [];
    this.retry = null;
  }

  apply() {
    const s = this.cfg.get().share;
    if (s.host && !this.server) {
      try {
        this.server = createRelay({ port: s.hostPort, log: (m) => this.emit('log', m) });
        this.server.on('error', (e) => {
          this.emit('log', `Servidor de sala: ${e.message}`);
          this.server = null;
        });
      } catch (e) {
        this.emit('log', `No se pudo abrir el servidor de sala: ${e.message}`);
      }
    } else if (!s.host && this.server) {
      this.server.close();
      this.server = null;
    }
    this.disconnect();
    if (s.connect || s.host) this.connect();
    else this.setStatus('desconectado');
  }

  url() {
    const s = this.cfg.get().share;
    return s.host ? `ws://127.0.0.1:${s.hostPort}` : s.url;
  }

  connect() {
    clearTimeout(this.retry);
    const s = this.cfg.get().share;
    let ws;
    try {
      ws = new WebSocket(this.url(), { maxPayload: 6 * 1024 * 1024 });
    } catch (e) {
      this.setStatus(`dirección no válida`);
      return;
    }
    this.ws = ws;
    this.setStatus('conectando…');
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'join', room: s.room, callsign: s.callsign || os.userInfo().username }));
      this.setStatus('conectado');
    });
    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.type === 'roster') {
        this.members = msg.members || [];
        this.emit('roster', this.members);
        return;
      }
      this.emit('item', msg);
    });
    ws.on('close', () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.members = [];
      this.emit('roster', []);
      const cur = this.cfg.get().share;
      if (cur.connect || cur.host) {
        this.setStatus('reconectando…');
        this.retry = setTimeout(() => this.connect(), 4000);
      } else this.setStatus('desconectado');
    });
    ws.on('error', (e) => this.setStatus(`sin conexión (${e.code || e.message})`));
  }

  disconnect() {
    clearTimeout(this.retry);
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      ws.removeAllListeners('close');
      try { ws.close(); } catch { /* ya cerrado */ }
    }
  }

  send(item) {
    if (!this.ws || this.ws.readyState !== 1) return false;
    this.ws.send(JSON.stringify(item));
    return true;
  }

  setStatus(st) {
    this.status = st;
    this.emit('status', { status: st, members: this.members, lan: lanAddresses(), host: this.cfg.get().share.host });
  }

  stop() {
    this.disconnect();
    if (this.server) this.server.close();
  }
}

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

module.exports = { Share, lanAddresses };
