// Cambiar el foco entre DCS y el kneeboard (modo escritura) aunque la app no sea la ventana activa.
let api = null;

function load() {
  if (api !== null) return api;
  try {
    const koffi = require('koffi');
    const u32 = koffi.load('user32.dll');
    koffi.struct('RECT', { left: 'int32_t', top: 'int32_t', right: 'int32_t', bottom: 'int32_t' });
    const k32 = koffi.load('kernel32.dll');
    api = {
      GetForegroundWindow: u32.func('intptr_t __stdcall GetForegroundWindow()'),
      SetForegroundWindow: u32.func('bool __stdcall SetForegroundWindow(intptr_t h)'),
      BringWindowToTop: u32.func('bool __stdcall BringWindowToTop(intptr_t h)'),
      GetWindowThreadProcessId: u32.func('uint32_t __stdcall GetWindowThreadProcessId(intptr_t h, void *pid)'),
      AttachThreadInput: u32.func('bool __stdcall AttachThreadInput(uint32_t a, uint32_t b, bool attach)'),
      FindWindowW: u32.func('intptr_t __stdcall FindWindowW(str16 cls, str16 title)'),
      GetCurrentThreadId: k32.func('uint32_t __stdcall GetCurrentThreadId()'),
      GetWindowRect: u32.func('bool __stdcall GetWindowRect(intptr_t h, _Out_ RECT *rect)'),
      IsIconic: u32.func('bool __stdcall IsIconic(intptr_t h)'),
    };
  } catch {
    api = false;
  }
  return api;
}

function hwndOf(win) {
  const b = win.getNativeWindowHandle();
  return b.length >= 8 ? Number(b.readBigUInt64LE(0)) : b.readUInt32LE(0);
}

function forceForeground(hwnd) {
  const a = load();
  if (!a || !hwnd) return false;
  const fg = a.GetForegroundWindow();
  const fgThread = fg ? a.GetWindowThreadProcessId(fg, null) : 0;
  const me = a.GetCurrentThreadId();
  if (fgThread && fgThread !== me) a.AttachThreadInput(fgThread, me, true);
  a.BringWindowToTop(hwnd);
  const ok = a.SetForegroundWindow(hwnd);
  if (fgThread && fgThread !== me) a.AttachThreadInput(fgThread, me, false);
  return ok;
}

function focusWindow(win) {
  if (!win || win.isDestroyed()) return false;
  win.focus();
  return forceForeground(hwndOf(win));
}

function dcsWindow() {
  const a = load();
  if (!a) return 0;
  return a.FindWindowW('DCS', null) || a.FindWindowW(null, 'Digital Combat Simulator') || 0;
}

// Rectángulo de la ventana de DCS en píxeles de pantalla, o null.
function dcsRect() {
  const a = load();
  const hwnd = dcsWindow();
  if (!a || !hwnd || a.IsIconic(hwnd)) return null;
  const r = [0, 0, 0, 0];
  if (!a.GetWindowRect(hwnd, r)) return null;
  const [left, top, right, bottom] = r;
  if (right - left < 200 || bottom - top < 200) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function focusDcs() {
  return forceForeground(dcsWindow());
}

function foreground() {
  const a = load();
  return a ? a.GetForegroundWindow() : 0;
}

module.exports = { focusWindow, focusDcs, dcsWindow, dcsRect, foreground, bringToFront: forceForeground };
