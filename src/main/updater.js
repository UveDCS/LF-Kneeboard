// Actualizaciones automáticas desde GitHub Releases (electron-updater).
// Busca al arrancar y cada 6 horas, descarga en segundo plano y se instala al cerrar LF Kneeboard:
// nunca reinicia en mitad de un vuelo, salvo que pulses «Actualizar ahora» en el aviso o en Ajustes.
// Con LFKB_FAKE_UPDATE=<versión> (solo en desarrollo) simula una versión nueva para probar el aviso.
const { EventEmitter } = require('events');

const SIX_HOURS = 6 * 3600 * 1000;

class Updater extends EventEmitter {
  constructor(cfg, app) {
    super();
    this.cfg = cfg;
    this.app = app;
    this.au = null;
    this.timer = null;
    this.state = { state: app.isPackaged ? 'idle' : 'dev', current: app.getVersion(), version: null, notes: '', progress: 0, error: null, checkedAt: null };
    this.fake = !app.isPackaged && process.env.LFKB_FAKE_UPDATE;
    if (!app.isPackaged) return; // en desarrollo no hay instalador que actualizar
    const { autoUpdater } = require('electron-updater');
    this.au = autoUpdater;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = null;
    autoUpdater.on('checking-for-update', () => this.set({ state: 'checking', error: null }));
    autoUpdater.on('update-available', (i) => {
      this.set({ state: 'downloading', version: i.version, notes: notesText(i.releaseNotes), progress: 0 });
      this.emit('available', i.version);
    });
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
    if (this.fake) return this.simulate(String(this.fake));
    if (!this.au) return;
    clearInterval(this.timer);
    if ((this.cfg.get().updates || {}).auto === false) return;
    setTimeout(() => this.check(), 4000); // pronto: el aviso de versión nueva sale nada más arrancar
    this.timer = setInterval(() => this.check(), SIX_HOURS);
  }

  check() {
    if (!this.au || ['checking', 'downloading', 'ready'].includes(this.state.state)) return this.state;
    this.au.checkForUpdates().catch((e) => this.set({ state: 'error', error: friendly(e), checkedAt: Date.now() }));
    return this.state;
  }

  // Cierra y ejecuta el instalador ya descargado; al terminar se vuelve a abrir.
  install() {
    if (this.fake && this.state.state === 'ready') { console.log(`[update] instalaría ${this.state.version} (simulado)`); return; }
    if (this.au && this.state.state === 'ready') this.au.quitAndInstall(true, true);
  }

  // Prueba del aviso sin GitHub: versión nueva, descarga en unos segundos y lista.
  simulate(version) {
    setTimeout(() => {
      this.set({ state: 'downloading', version, progress: 0, notes: notesText('<h2>Novedades</h2><ul><li><strong>La animación</strong> de sacar y guardar ya no da tirones dentro de DCS.</li><li>Opción para elegir la animación o quitarla.</li></ul><p>Si ya lo tienes instalado, se actualiza solo.</p>') });
      this.emit('available', version);
      let p = 0;
      const t = setInterval(() => {
        p = Math.min(100, p + 20);
        if (p < 100) return this.set({ progress: p });
        clearInterval(t);
        this.set({ state: 'ready', progress: 100, checkedAt: Date.now() });
        this.emit('ready', version);
      }, 1200);
    }, 1500);
  }
}

// Notas de la versión (GitHub las da en HTML) a texto con viñetas.
function notesText(n) {
  if (Array.isArray(n)) n = n.map((x) => x.note || '').join('\n');
  return String(n || '')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<\/(p|li|h\d|ul|ol|div)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .split('\n').map((l) => l.trim()).filter(Boolean).join('\n')
    .slice(0, 1500);
}

function friendly(e) {
  const m = String((e && e.message) || e || '');
  if (/404|latest\.yml|No published versions|Unable to find latest version/i.test(m)) return 'Todavía no hay ninguna versión publicada.';
  if (/ENOTFOUND|ETIMEDOUT|ECONNRESET|ERR_INTERNET_DISCONNECTED|net::/i.test(m)) return 'Sin conexión con GitHub.';
  return m.split('\n')[0].slice(0, 160);
}

module.exports = { Updater };
