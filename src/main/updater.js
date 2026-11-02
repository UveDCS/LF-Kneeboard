// Actualizaciones automáticas desde GitHub Releases (electron-updater).
// Busca al arrancar y cada 6 horas, descarga en segundo plano y se instala al cerrar LF Kneeboard:
// nunca reinicia en mitad de un vuelo, salvo que pulses «Reiniciar e instalar» en Ajustes.
const { EventEmitter } = require('events');

const SIX_HOURS = 6 * 3600 * 1000;

class Updater extends EventEmitter {
  constructor(cfg, app) {
    super();
    this.cfg = cfg;
    this.app = app;
    this.au = null;
    this.timer = null;
    this.state = { state: app.isPackaged ? 'idle' : 'dev', current: app.getVersion(), version: null, progress: 0, error: null, checkedAt: null };
    if (!app.isPackaged) return; // en desarrollo no hay instalador que actualizar
    const { autoUpdater } = require('electron-updater');
    this.au = autoUpdater;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = null;
    autoUpdater.on('checking-for-update', () => this.set({ state: 'checking', error: null }));
    autoUpdater.on('update-available', (i) => this.set({ state: 'downloading', version: i.version, progress: 0 }));
    autoUpdater.on('update-not-available', () => this.set({ state: 'latest', checkedAt: Date.now() }));
    autoUpdater.on('download-progress', (p) => this.set({ state: 'downloading', progress: Math.round(p.percent || 0) }));
    autoUpdater.on('update-downloaded', (i) => {
      this.set({ state: 'ready', version: i.version, progress: 100, checkedAt: Date.now() });
      this.emit('ready', i.version);
    });
    autoUpdater.on('error', (e) => this.set({ state: 'error', error: friendly(e), checkedAt: Date.now() }));
  }

  set(p) {
    Object.assign(this.state, p);
    this.emit('status', this.state);
  }

  start() {
    if (!this.au) return;
    clearInterval(this.timer);
    if ((this.cfg.get().updates || {}).auto === false) return;
    setTimeout(() => this.check(), 20000);
    this.timer = setInterval(() => this.check(), SIX_HOURS);
  }

  check() {
    if (!this.au || ['checking', 'downloading', 'ready'].includes(this.state.state)) return this.state;
    this.au.checkForUpdates().catch((e) => this.set({ state: 'error', error: friendly(e), checkedAt: Date.now() }));
    return this.state;
  }

  // Cierra y ejecuta el instalador ya descargado; al terminar se vuelve a abrir.
  install() {
    if (this.au && this.state.state === 'ready') this.au.quitAndInstall(true, true);
  }
}

function friendly(e) {
  const m = String((e && e.message) || e || '');
  if (/404|latest\.yml|No published versions|Unable to find latest version/i.test(m)) return 'Todavía no hay ninguna versión publicada.';
  if (/ENOTFOUND|ETIMEDOUT|ECONNRESET|ERR_INTERNET_DISCONNECTED|net::/i.test(m)) return 'Sin conexión con GitHub.';
  return m.split('\n')[0].slice(0, 160);
}

module.exports = { Updater };
