// Órdenes de voz (como VoiceAttack, pero solo para el kneeboard): motor de voz de Windows, sin conexión.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { EventEmitter } = require('events');

const NUMS = ['uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce',
  'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte'];

const FIXED = [
  [['página siguiente', 'siguiente página', 'pasa página', 'siguiente'], 'next_page'],
  [['página anterior', 'atrás'], 'prev_page'],
  [['pestaña siguiente'], 'next_tab'],
  [['pestaña anterior'], 'prev_tab'],
  [['muestra', 'mostrar', 'aparece'], 'show'],
  [['oculta', 'ocultar', 'esconde'], 'hide'],
  [['marca punto', 'captura coordenadas', 'coordenadas'], 'capture_coords'],
  [['modo automático'], 'toggle_auto'],
  [['modo noche'], 'toggle_night'],
  [['recentra', 'recentrar'], 'recenter_vr'],
  [['zoom', 'amplía'], 'toggle_zoom'],
  [['cronómetro', 'para cronómetro', 'arranca cronómetro'], 'timer'],
  [['envía página', 'manda página', 'comparte página'], 'share_page'],
  [['compartido', 'abre compartido'], 'open_shared'],
  [['marcador siguiente', 'siguiente marcador'], 'next_bookmark'],
  [['marcador anterior', 'marcador previo'], 'prev_bookmark'],
  [['cruz', 'muestra la cruz'], 'toggle_crosshair'],
  [['waypoint siguiente', 'siguiente waypoint', 'punto siguiente'], 'next_wp'],
  [['waypoint anterior', 'punto anterior'], 'prev_wp'],
  [['dos kneeboards', 'segundo kneeboard'], 'toggle_dual'],
  [['índice', 'abre el índice'], 'open_index'],
  [['juego siguiente', 'siguiente juego'], 'next_section'],
  [['juego anterior'], 'prev_section'],
];

// «marcador aproximación» abre tu marcador de ese tipo
const BOOKMARKS = [['tierra', 'ground'], ['rodaje', 'taxi'], ['salida', 'takeoff'], ['en ruta', 'enroute'], ['misión', 'target'],
  ['aproximación', 'approach'], ['emergencias', 'emergency'], ['general', 'general']];

const norm = (s) => String(s).toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim();

class Voice extends EventEmitter {
  constructor(cfg, scriptPath) {
    super();
    this.cfg = cfg;
    this.script = scriptPath;
    this.proc = null;
    this.map = new Map();
    this.status = 'apagado';
    this.sig = null;
  }

  phrases() {
    const map = new Map();
    for (const [list, action] of FIXED) for (const p of list) map.set(p, action);
    NUMS.forEach((n, i) => map.set(`página ${n}`, `page:${i}`));
    for (const [word, type] of BOOKMARKS) map.set(`marcador ${word}`, `bm:${type}`);
    (this.cfg.get().tabs || []).forEach((t, i) => {
      const title = norm(t.title);
      if (!title) return;
      if (!map.has(title)) map.set(title, `tab:${i}`);
      map.set(`abre ${title}`, `tab:${i}`);
    });
    return map;
  }

  // Arranca, reinicia o para el reconocedor según la configuración (y las pestañas).
  apply() {
    const v = this.cfg.get().voice || {};
    this.map = this.phrases();
    const sig = JSON.stringify([v.enabled, v.mode, v.wake, [...this.map.keys()]]);
    if (sig === this.sig && (this.proc || !v.enabled)) return;
    this.sig = sig;
    this.stop();
    if (!v.enabled) {
      this.setStatus('apagado');
      return;
    }
    const conf = path.join(os.tmpdir(), 'lf-kneeboard-voice.txt');
    fs.writeFileSync(conf, [v.culture || 'es-ES', v.mode || 'ptt', norm(v.wake || 'piernógrafo'), ...this.map.keys()].join('\n'), 'utf8');
    this.setStatus('arrancando…');
    try {
      this.proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.script, '-Config', conf], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      this.setStatus(`error: ${e.message}`);
      return;
    }
    const proc = this.proc;
    readline.createInterface({ input: proc.stdout }).on('line', (line) => {
      let ev;
      try {
        ev = JSON.parse(line.replace(/^﻿/, ''));
      } catch {
        return;
      }
      this.onEvent(ev);
    });
    let err = '';
    proc.stderr.on('data', (d) => { err += d; });
    proc.on('exit', (code) => {
      if (this.proc !== proc) return;
      this.proc = null;
      this.sig = null;
      if (code && !/error/.test(this.status)) this.setStatus(`error: ${err.trim().split('\n')[0] || `código ${code}`}`);
    });
  }

  onEvent(ev) {
    if (ev.t === 'ready') this.setStatus(`listo (${ev.culture}, ${ev.mode === 'wake' ? 'palabra de activación' : 'pulsar para hablar'})`);
    else if (ev.t === 'error') this.setStatus(`error: ${ev.msg}`);
    else if (ev.t === 'rej') this.emit('heard', { text: null });
    else if (ev.t === 'rec') {
      const v = this.cfg.get().voice || {};
      const wake = norm(v.wake || 'piernógrafo');
      let text = norm(ev.text);
      if (v.mode === 'wake' && text.startsWith(wake)) text = text.slice(wake.length).trim();
      const action = this.map.get(text);
      const ok = action && ev.conf >= (v.minConfidence ?? 0.6);
      this.emit('heard', { text, conf: ev.conf, action: ok ? action : null });
      if (ok) this.emit('command', action, text);
    }
  }

  listen(on) {
    if (this.proc && (this.cfg.get().voice || {}).mode !== 'wake') {
      try { this.proc.stdin.write(on ? 'on\n' : 'off\n'); } catch { /* cerrado */ }
      this.emit('listening', on);
    }
  }

  setStatus(s) {
    this.status = s;
    this.emit('status', s);
  }

  stop() {
    if (this.proc) {
      const p = this.proc;
      this.proc = null;
      try { p.stdin.write('quit\n'); } catch { /* cerrado */ }
      setTimeout(() => { try { p.kill(); } catch { /* ya terminó */ } }, 500);
    }
  }
}

module.exports = { Voice, norm };
