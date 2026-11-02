// Servidor de salas: reenvía lo que publica un miembro al resto de su sala.
// Lo usa la app en modo "anfitrión" y también relay.js para un servidor dedicado (p. ej. el de Nellis).
const { WebSocketServer } = require('ws');

const MAX_MSG = 6 * 1024 * 1024; // imágenes de página en JPEG

function createRelay({ port, host = '0.0.0.0', log = () => {} }) {
  const wss = new WebSocketServer({ port, host, maxPayload: MAX_MSG });
  const rooms = new Map(); // sala -> Set<ws>

  const members = (room) => [...(rooms.get(room) || [])].map((c) => c.meta.callsign).filter(Boolean);

  function broadcast(room, data, except) {
    for (const c of rooms.get(room) || []) {
      if (c !== except && c.readyState === 1) c.send(data);
    }
  }

  wss.on('connection', (ws, req) => {
    ws.meta = { room: null, callsign: '' };
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.type === 'join') {
        const room = String(msg.room || 'LF').slice(0, 40);
        ws.meta = { room, callsign: String(msg.callsign || 'Piloto').slice(0, 30) };
        if (!rooms.has(room)) rooms.set(room, new Set());
        rooms.get(room).add(ws);
        log(`${ws.meta.callsign} entra en ${room} (${req.socket.remoteAddress})`);
        const roster = JSON.stringify({ type: 'roster', room, members: members(room) });
        broadcast(room, roster);
        return;
      }
      if (!ws.meta.room) return;
      msg.from = ws.meta.callsign;
      msg.at = Date.now();
      broadcast(ws.meta.room, JSON.stringify(msg), ws);
    });
    ws.on('close', () => {
      const room = ws.meta.room;
      if (room && rooms.has(room)) {
        rooms.get(room).delete(ws);
        if (!rooms.get(room).size) rooms.delete(room);
        else broadcast(room, JSON.stringify({ type: 'roster', room, members: members(room) }));
      }
    });
  });

  const ping = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, 15000);
  wss.on('close', () => clearInterval(ping));
  return wss;
}

module.exports = { createRelay };
