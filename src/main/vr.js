// Puente con la capa OpenXR: memoria compartida con los fotogramas del kneeboard y su colocación.
// La estructura coincide con native/shared/lfkb_shared.h.
const { EventEmitter } = require('events');

const SHM_NAME = 'Local\\LFKneeboard.Frames.v1';
const MAGIC = 0x42464b4c;
const VERSION = 1;
const MAX_VIEWS = 2;
const MAX_W = 1600;
const MAX_H = 2400;
const HEADER = 4096;
const SLOT = MAX_W * MAX_H * 4;
const TOTAL = HEADER + MAX_VIEWS * 2 * SLOT;
const VIEW_OFF = (i) => 64 + i * 128;

class VrBridge extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.name = opts.name || SHM_NAME; // otro nombre solo en las pruebas
    this.ok = false;
    this.front = [0, 0];
    this.seq = [0, 0];
    this.gazed = [false, false];
    this.lastAlive = 0;
    this.aliveChangedAt = 0;
    this.active = false;
  }

  start() {
    let koffi;
    try {
      koffi = require('koffi');
    } catch (e) {
      this.emit('log', `VR desactivado: ${e.message}`);
      this.error = `No se pudo cargar el puente con el visor (${e.message}).`;
      return false;
    }
    const k32 = koffi.load('kernel32.dll');
    const SA = koffi.struct('LFKB_SECURITY_ATTRIBUTES', { nLength: 'uint32_t', lpSecurityDescriptor: 'void *', bInheritHandle: 'int' });
    this.CreateFileMappingW = k32.func('intptr_t __stdcall CreateFileMappingW(intptr_t hFile, LFKB_SECURITY_ATTRIBUTES *attr, uint32_t protect, uint32_t hi, uint32_t lo, str16 name)');
    this.MapViewOfFile = k32.func('intptr_t __stdcall MapViewOfFile(intptr_t h, uint32_t access, uint32_t offHi, uint32_t offLo, uintptr_t bytes)');
    this.copyTo = k32.func('void __stdcall RtlMoveMemory(intptr_t dst, const void *src, uintptr_t n)');
    this.copyFrom = k32.func('void __stdcall RtlMoveMemory(void *dst, intptr_t src, uintptr_t n)');
    const PAGE_READWRITE = 0x04;
    const FILE_MAP_ALL_ACCESS = 0xf001f;
    // Permisos explícitos: si LF Kneeboard se abre como administrador, Windows solo dejaría abrir la memoria
    // a otros procesos elevados y DCS (sin elevar) no vería el kneeboard. Se da acceso a los usuarios del
    // equipo (el nombre «Local\» ya la limita a esta sesión de Windows) con nivel de integridad medio.
    let attr = null;
    try {
      const adv = koffi.load('advapi32.dll');
      const toSd = adv.func('bool __stdcall ConvertStringSecurityDescriptorToSecurityDescriptorW(str16 sddl, uint32_t rev, _Out_ void **sd, void *len)');
      const out = [null];
      if (toSd('D:(A;;GA;;;SY)(A;;GA;;;BA)(A;;GA;;;AU)S:(ML;;NW;;;ME)', 1, out, null) && out[0]) {
        attr = { nLength: koffi.sizeof(SA), lpSecurityDescriptor: out[0], bInheritHandle: 0 };
      }
    } catch (e) {
      this.emit('log', `Permisos de la memoria compartida: ${e.message}`);
    }
    try {
      this.elevated = !!koffi.load('shell32.dll').func('bool __stdcall IsUserAnAdmin()')();
    } catch { this.elevated = null; }
    this.handle = this.CreateFileMappingW(-1, attr, PAGE_READWRITE, 0, TOTAL, this.name);
    if (!this.handle && attr) this.handle = this.CreateFileMappingW(-1, null, PAGE_READWRITE, 0, TOTAL, this.name);
    if (!this.handle) {
      this.emit('log', 'No se pudo crear la memoria compartida para VR');
      this.error = 'No se pudo preparar la memoria compartida con el visor.';
      return false;
    }
    this.emit('log', `Memoria compartida lista (${attr ? 'permisos para DCS con o sin administrador' : 'permisos por defecto'}; LF Kneeboard ${this.elevated ? 'como administrador' : 'sin elevar'})`);
    this.base = BigInt(this.MapViewOfFile(this.handle, FILE_MAP_ALL_ACCESS, 0, 0, TOTAL));
    if (!this.base) {
      this.emit('log', 'No se pudo abrir la memoria compartida para VR');
      this.error = 'No se pudo preparar la memoria compartida con el visor.';
      return false;
    }
    const h = Buffer.alloc(16);
    h.writeUInt32LE(MAGIC, 0);
    h.writeUInt32LE(VERSION, 4);
    h.writeUInt32LE(MAX_VIEWS, 8);
    h.writeUInt32LE(1, 12);
    this.copyTo(this.base, h, 16);
    this.ok = true;
    let beat = 1;
    this.beatTimer = setInterval(() => this.writeU32(12, ++beat), 250);
    this.pollTimer = setInterval(() => this.poll(), 100);
    return true;
  }

  writeU32(off, v) {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(v >>> 0, 0);
    this.copyTo(this.base + BigInt(off), b, 4);
  }

  readHeader() {
    const b = Buffer.alloc(64 + MAX_VIEWS * 128);
    this.copyFrom(b, this.base, b.length);
    return b;
  }

  poll() {
    const b = this.readHeader();
    const alive = b.readUInt32LE(20);
    const now = Date.now();
    if (alive !== this.lastAlive) {
      this.lastAlive = alive;
      this.aliveChangedAt = now;
    }
    const active = now - this.aliveChangedAt < 1500;
    if (active !== this.active) {
      this.active = active;
      this.emit('active', active);
    }
    for (let i = 0; i < MAX_VIEWS; i++) {
      const g = active && b.readUInt32LE(VIEW_OFF(i) + 56) === 1;
      if (g !== this.gazed[i]) {
        this.gazed[i] = g;
        this.emit('gaze', i, g);
      }
    }
  }

  // Colocación de cada kneeboard: { visible, pos[3], rot[3], width, zoomScale, gazeZoom }
  setPlacement(i, p) {
    if (!this.ok) return;
    const b = Buffer.alloc(40);
    b.writeUInt32LE(p.visible ? 1 : 0, 0); // +16
    b.writeFloatLE(p.pos[0], 4);
    b.writeFloatLE(p.pos[1], 8);
    b.writeFloatLE(p.pos[2], 12);
    b.writeFloatLE(p.rot[0], 16);
    b.writeFloatLE(p.rot[1], 20);
    b.writeFloatLE(p.rot[2], 24);
    b.writeFloatLE(p.width, 28);
    b.writeFloatLE(p.zoomScale, 32);
    b.writeUInt32LE(p.gazeZoom ? 1 : 0, 36);
    this.copyTo(this.base + BigInt(VIEW_OFF(i) + 16), b, 40);
  }

  // Cruz en el centro de la vista del visor (la que marca el punto que se captura del F10).
  setReticle(on) {
    if (this.ok && on !== this.reticle) {
      this.reticle = on;
      this.writeU32(24, on ? 1 : 0);
    }
  }

  recenter() {
    if (!this.ok) return;
    const b = this.readHeader();
    this.writeU32(16, b.readUInt32LE(16) + 1);
  }

  // image: NativeImage de Electron (BGRA en Windows)
  pushFrame(i, image) {
    if (!this.ok || !image || image.isEmpty()) return;
    let { width, height } = image.getSize();
    if (width > MAX_W || height > MAX_H) {
      const k = Math.min(MAX_W / width, MAX_H / height);
      image = image.resize({ width: Math.floor(width * k), height: Math.floor(height * k), quality: 'good' });
      ({ width, height } = image.getSize());
    }
    const bmp = image.toBitmap();
    if (bmp.length < width * height * 4) return;
    const back = this.front[i] ^ 1;
    const slotAddr = this.base + BigInt(HEADER + (i * 2 + back) * SLOT);
    this.copyTo(slotAddr, bmp, width * height * 4);
    const meta = Buffer.alloc(16);
    meta.writeUInt32LE(this.seq[i], 0);
    meta.writeUInt32LE(back, 4);
    meta.writeUInt32LE(width, 8);
    meta.writeUInt32LE(height, 12);
    // front, width y height primero; el número de secuencia al final avisa a la capa.
    this.copyTo(this.base + BigInt(VIEW_OFF(i) + 4), meta.subarray(4), 12);
    this.front[i] = back;
    this.seq[i] = (this.seq[i] + 1) >>> 0;
    this.writeU32(VIEW_OFF(i), this.seq[i]);
  }

  stop() {
    clearInterval(this.beatTimer);
    clearInterval(this.pollTimer);
    if (this.ok) {
      for (let i = 0; i < MAX_VIEWS; i++) this.writeU32(VIEW_OFF(i) + 16, 0);
    }
  }
}

module.exports = { VrBridge, MAX_W, MAX_H };
