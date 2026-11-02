// Genera los iconos (PNG e ICO) a partir de un SVG. Uso: npx electron tools/make-icons.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1e3a5f"/><stop offset="1" stop-color="#0b1320"/></linearGradient>
    <linearGradient id="pp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#dfe7ef"/></linearGradient>
  </defs>
  <rect x="8" y="8" width="240" height="240" rx="56" fill="url(#bg)"/>
  <rect x="60" y="44" width="136" height="176" rx="16" fill="url(#pp)"/>
  <rect x="96" y="30" width="64" height="30" rx="10" fill="#94a3b8"/>
  <rect x="106" y="38" width="44" height="12" rx="6" fill="#1e3a5f"/>
  <path d="M84 188 L112 128 L148 150 L176 88" fill="none" stroke="#f59e0b" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="1 0"/>
  <circle cx="84" cy="188" r="10" fill="#38bdf8"/><circle cx="112" cy="128" r="10" fill="#38bdf8"/>
  <circle cx="148" cy="150" r="10" fill="#38bdf8"/><circle cx="176" cy="88" r="12" fill="#e11d48"/>
  <rect x="76" y="70" width="58" height="8" rx="4" fill="#94a3b8"/>
</svg>`;

function ico(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 256, height: 256, show: false, transparent: true, frame: false, webPreferences: { offscreen: true } });
  await win.loadURL(`data:text/html,${encodeURIComponent(`<html><body style="margin:0;background:transparent">${SVG.replace('<svg ', '<svg width="256" height="256" ')}</body></html>`)}`);
  await new Promise((r) => setTimeout(r, 500));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 256, height: 256 });
  const root = path.join(__dirname, '..');
  const assets = path.join(root, 'src', 'renderer', 'assets');
  fs.mkdirSync(assets, { recursive: true });
  fs.mkdirSync(path.join(root, 'build'), { recursive: true });
  const sizes = [256, 64, 48, 32, 16].map((s) => ({ size: s, data: (s === 256 ? img : img.resize({ width: s, height: s, quality: 'best' })).toPNG() }));
  fs.writeFileSync(path.join(assets, 'icon.png'), sizes[0].data);
  fs.writeFileSync(path.join(assets, 'tray.png'), img.resize({ width: 32, height: 32, quality: 'best' }).toPNG());
  fs.writeFileSync(path.join(root, 'build', 'icon.ico'), ico(sizes));
  fs.writeFileSync(path.join(root, 'build', 'icon.svg'), SVG);
  console.log('Iconos generados');
  app.quit();
});
