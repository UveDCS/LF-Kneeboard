// Prueba del lector de tabletas (OTD-IPC) sin tableta: compila un servidor OTD-IPC falso y el lector de
// entradas, los conecta en una carpeta LOCALAPPDATA temporal y comprueba lo que llega a la aplicación.
// Uso: node tools/tablet-test.js
const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

const root = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lfkb-tablet-'));
let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'OK  ' : 'FALLO'} ${m}`); if (!c) fails++; };
const zig = (args) => execFileSync('python', ['-m', 'ziglang', ...args], { cwd: root, stdio: 'inherit' });

const server = path.join(tmp, 'otdipc_server.exe');
const reader = path.join(tmp, 'lfkb-input.exe');
zig(['cc', '-target', 'x86_64-windows-gnu', '-O1', 'native/test/otdipc_server.c', '-o', server, '-lws2_32']);
zig(['cc', '-target', 'x86_64-windows-gnu', '-O1', 'native/input-helper/input.c', 'native/input-helper/tablet.c', '-o', reader, '-luser32', '-lwinmm', '-lws2_32']);

const env = { ...process.env, LOCALAPPDATA: tmp };
const srv = spawn(server, ['2'], { env });
const srvOut = [];
readline.createInterface({ input: srv.stdout }).on('line', (l) => srvOut.push(l));

setTimeout(() => {
  const rd = spawn(reader, [], { env, stdio: ['pipe', 'pipe', 'ignore'] });
  const ev = [];
  readline.createInterface({ input: rd.stdout }).on('line', (l) => { try { ev.push(JSON.parse(l)); } catch { /* otra cosa */ } });
  setTimeout(() => {
    try { rd.stdin.write('quit\n'); rd.stdin.end(); } catch { /* cerrado */ }
    setTimeout(() => {
      rd.kill(); srv.kill();
      const hello = srvOut.find((l) => l.startsWith('HELLO')) || '';
      ok(/HELLO 800 bytes, tipo 6, tamaño 800, version 220260205/.test(hello) && /LF Kneeboard/.test(hello), `El servidor recibe el Hello del lector: ${hello}`);
      const st = ev.find((e) => e.t === 'tstatus' && e.state === 'connected');
      ok(st && st.server === 'OTD-IPC de prueba', `Se conecta al servidor anunciado: ${st && st.server}`);
      const dev = ev.find((e) => e.t === 'tdev');
      ok(dev && dev.name === 'Tableta de prueba' && dev.id === 'prueba-tableta-1' && dev.mx === 152 && dev.my === 95 && dev.mp === 8191, `Tableta: ${dev && `${dev.name} ${dev.mx}x${dev.my} mm, presión ${dev.mp}`}`);
      const tabs = ev.filter((e) => e.t === 'tab');
      const hover = tabs.filter((e) => e.near === 1 && !(e.pb & 1));
      const stroke = tabs.filter((e) => e.pb & 1);
      ok(hover.length >= 20 && stroke.length === 61, `Lápiz cerca: ${hover.length} posiciones; trazo: ${stroke.length} posiciones`);
      ok(stroke.length && Math.abs(stroke[0].x - 40) < 0.01 && stroke[0].p === 4000 && stroke[60].p === 6400, `Posición y presión del trazo: ${stroke[0] && `${stroke[0].x},${stroke[0].y} p=${stroke[0].p}…${stroke[60].p}`}`);
      ok(tabs.some((e) => e.ab === 1), 'Botón de la tableta');
      fs.rmSync(tmp, { recursive: true, force: true });
      console.log(fails ? `\n${fails} fallos` : '\nTodo correcto');
      process.exit(fails ? 1 : 0);
    }, 800);
  }, 4500);
}, 600);
