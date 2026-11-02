// Controles: lanza lfkb-input.exe, mantiene qué entradas están pulsadas y dispara las acciones asignadas.
// Una asignación es una lista de entradas ("kbd:165", "joy:{GUID}:12"); se dispara al pulsar la última
// mientras las demás siguen pulsadas (combinaciones con modificador, como en OpenKneeboard).
const { spawn } = require('child_process');
const readline = require('readline');
const { EventEmitter } = require('events');

const KEY_NAMES = {
  8: 'Retroceso', 9: 'Tab', 13: 'Intro', 19: 'Pausa', 20: 'Bloq Mayús', 27: 'Esc', 32: 'Espacio',
  33: 'Re Pág', 34: 'Av Pág', 35: 'Fin', 36: 'Inicio', 37: '←', 38: '↑', 39: '→', 40: '↓',
  44: 'Impr Pant', 45: 'Insert', 46: 'Supr', 91: 'Win izq', 92: 'Win der', 93: 'Menú',
  96: 'Num 0', 97: 'Num 1', 98: 'Num 2', 99: 'Num 3', 100: 'Num 4', 101: 'Num 5', 102: 'Num 6', 103: 'Num 7',
  104: 'Num 8', 105: 'Num 9', 106: 'Num *', 107: 'Num +', 109: 'Num -', 110: 'Num .', 111: 'Num /',
  144: 'Bloq Num', 145: 'Bloq Despl', 160: 'Mayús izq', 161: 'Mayús der', 162: 'Ctrl izq', 163: 'Ctrl der',
  164: 'Alt izq', 165: 'Alt der', 186: 'Ñ/;', 187: '+', 188: ',', 189: '-', 190: '.', 191: 'Ç//', 192: 'º',
  219: "'", 220: '\\', 221: '¡', 222: '´', 226: '<',
};
for (let i = 1; i <= 24; i++) KEY_NAMES[111 + i] = `F${i}`;

function keyName(vk) {
  if (KEY_NAMES[vk]) return KEY_NAMES[vk];
  if ((vk >= 48 && vk <= 57) || (vk >= 65 && vk <= 90)) return String.fromCharCode(vk);
  return `Tecla ${vk}`;
}

function buttonName(b) {
  if (b >= 1000) {
    const hat = Math.floor((b - 1000) / 4) + 1;
    const dir = ['arriba', 'derecha', 'abajo', 'izquierda'][(b - 1000) % 4];
    return `Seta ${hat} ${dir}`;
  }
  return `Botón ${b + 1}`;
}

class Input extends EventEmitter {
  constructor(cfg, exePath) {
    super();
    this.cfg = cfg;
    this.exePath = exePath;
    this.held = new Set();
    this.devices = new Map();
    this.capturing = null;
    this.proc = null;
    this.stopped = false;
  }

  start() {
    this.stopped = false;
    try {
      this.proc = spawn(this.exePath, [], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    } catch (e) {
      this.emit('log', `No se pudo iniciar el lector de controles: ${e.message}`);
      return;
    }
    this.proc.on('error', (e) => this.emit('log', `Lector de controles: ${e.message}`));
    readline.createInterface({ input: this.proc.stdout }).on('line', (line) => {
      let ev;
      try {
        ev = JSON.parse(line);
      } catch {
        return;
      }
      this.onEvent(ev);
    });
    this.proc.on('exit', () => {
      this.proc = null;
      this.held.clear();
      if (!this.stopped) setTimeout(() => this.start(), 2000);
    });
  }

  stop() {
    this.stopped = true;
    if (this.proc) {
      try { this.proc.stdin.write('quit\n'); this.proc.stdin.end(); } catch { /* cerrado */ }
      this.proc.kill();
    }
  }

  onEvent(ev) {
    if (ev.t === 'dev') {
      const name = String(ev.name || '').trim() || 'Mando';
      this.devices.set(ev.id, name);
      const known = this.cfg.get().devices || {};
      if (known[ev.id] !== name) this.cfg.patch({ devices: { ...known, [ev.id]: name } });
      this.emit('devices', this.listDevices());
      return;
    }
    if (ev.t === 'gone') {
      this.devices.delete(ev.id);
      for (const k of [...this.held]) if (k.startsWith(`joy:${ev.id}:`)) this.held.delete(k);
      this.emit('devices', this.listDevices());
      return;
    }
    let code;
    if (ev.t === 'btn') code = `joy:${ev.id}:${ev.b}`;
    else if (ev.t === 'key') code = `kbd:${ev.k}`;
    else return;
    if (ev.v) {
      this.held.add(code);
      this.onPress(code);
    } else {
      this.held.delete(code);
      // Acciones que se mantienen (p. ej. pulsar para hablar): avisa al soltar.
      const holds = this.holds && this.holds.get(code);
      if (holds) {
        this.holds.delete(code);
        for (const a of holds) this.emit('action-release', a);
      }
      if (this.capturing && this.capturing.combo.length && this.capturing.combo.includes(code)) this.finishCapture();
    }
  }

  onPress(code) {
    if (this.capturing) {
      if (!this.capturing.combo.includes(code)) this.capturing.combo.push(code);
      this.emit('capture-progress', this.capturing.combo.map((c) => this.describe(c)));
      return;
    }
    const bindings = this.cfg.get().bindings || {};
    // Primero las combinaciones más largas, para que AltGr+K no dispare también "K".
    const matches = [];
    for (const [action, list] of Object.entries(bindings)) {
      for (const combo of list || []) {
        if (!combo.length || combo[combo.length - 1] !== code) continue;
        if (combo.slice(0, -1).every((c) => this.held.has(c))) matches.push({ action, len: combo.length });
      }
    }
    if (!matches.length) return;
    const best = Math.max(...matches.map((m) => m.len));
    const fired = [...new Set(matches.filter((m) => m.len === best).map((m) => m.action))];
    this.holds = this.holds || new Map();
    this.holds.set(code, fired);
    for (const a of fired) this.emit('action', a);
  }

  // Modo "pulsa un botón": registra lo pulsado hasta que se suelta la primera entrada.
  beginCapture(action) {
    this.capturing = { action, combo: [] };
    clearTimeout(this.captureTimer);
    this.captureTimer = setTimeout(() => this.cancelCapture(), 10000);
  }

  finishCapture() {
    const c = this.capturing;
    this.capturing = null;
    clearTimeout(this.captureTimer);
    if (c && c.combo.length) this.emit('captured', { action: c.action, combo: c.combo });
  }

  cancelCapture() {
    if (!this.capturing) return;
    const action = this.capturing.action;
    this.capturing = null;
    this.emit('captured', { action, combo: null });
  }

  describe(code) {
    if (code.startsWith('kbd:')) return keyName(Number(code.slice(4)));
    const m = /^joy:(\{[^}]+\}):(\d+)$/.exec(code);
    if (!m) return code;
    const dev = this.devices.get(m[1]) || (this.cfg.get().devices || {})[m[1]] || 'Mando desconectado';
    return `${dev.trim()} · ${buttonName(Number(m[2]))}`;
  }

  listDevices() {
    return [...this.devices.entries()].map(([id, name]) => ({ id, name }));
  }
}

module.exports = { Input, keyName, buttonName };
