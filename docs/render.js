// Genera los documentos de LF Kneeboard (PDF y las imágenes del anuncio) a partir de docs/src/*.html,
// con el mismo Chromium de la aplicación. Uso: npx electron docs/render.js <nombre> (uno por proceso)
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'src');
const JOBS = [
  { name: 'guia', html: 'guia.html', pdf: path.join(__dirname, 'LF Kneeboard - Guía de uso.pdf') },
  { name: 'interno', html: 'interno.html', pdf: path.join(__dirname, 'LF Kneeboard - Cómo funciona por dentro.pdf') },
  { name: 'anuncio-1', html: 'anuncio-1.html', png: path.join(__dirname, '..', 'discord', 'anuncio', '1-lf-kneeboard.png'), w: 1600, h: 900 },
  { name: 'anuncio-2', html: 'anuncio-2.html', png: path.join(__dirname, '..', 'discord', 'anuncio', '2-dtc-y-plan.png'), w: 1600, h: 900 },
  { name: 'anuncio-3', html: 'anuncio-3.html', png: path.join(__dirname, '..', 'discord', 'anuncio', '3-temas.png'), w: 1600, h: 900 },
  { name: 'anuncio-4', html: 'anuncio-4.html', png: path.join(__dirname, '..', 'discord', 'anuncio', '4-compartir-con-el-vuelo.png'), w: 1600, h: 900 },
];

// Espera a las fuentes y a todas las imágenes antes de imprimir o capturar.
const READY = `Promise.all([document.fonts.ready, ...[...document.images].map((i) => i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; }))]).then(() => new Promise((r) => setTimeout(r, 300)))`;

async function run(job) {
  const win = new BrowserWindow({
    show: false, width: job.w || 1240, height: job.h || 1754, useContentSize: true,
    webPreferences: { offscreen: !!job.png, backgroundThrottling: false },
  });
  if (job.png) win.webContents.setFrameRate(1);
  await win.loadFile(path.join(SRC, job.html));
  await win.webContents.executeJavaScript(READY, true);
  fs.mkdirSync(path.dirname(job.pdf || job.png), { recursive: true });
  if (job.pdf) {
    const data = await win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, margins: { marginType: 'none' } });
    fs.writeFileSync(job.pdf, data);
    console.log(`${job.name}: ${job.pdf} (${Math.round(data.length / 1024)} KB)`);
  } else {
    const img = await win.webContents.capturePage();
    const png = img.resize({ width: job.w, height: job.h, quality: 'best' }).toPNG();
    fs.writeFileSync(job.png, png);
    console.log(`${job.name}: ${job.png} (${img.getSize().width}x${img.getSize().height})`);
  }
  win.destroy();
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const only = process.argv.slice(2).filter((a) => !a.startsWith('-') && !a.endsWith('.js'));
  for (const job of JOBS) {
    if (only.length && !only.includes(job.name)) continue;
    try { await run(job); } catch (e) { console.error(`${job.name}: ${e.message}`); process.exitCode = 1; }
  }
  app.quit();
});
