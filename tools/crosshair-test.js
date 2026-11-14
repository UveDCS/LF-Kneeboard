// La cruz del centro con DCS abierto: dcsRect() tiene que leer bien el rectángulo de la ventana de DCS.
// Crea una ventana oculta titulada «Digital Combat Simulator» (no se muestra en pantalla) y comprueba el centro.
// Con una lista en lugar de un objeto, koffi dejaba el RECT en r[0] y la cruz salía en la esquina superior izquierda.
const { execFileSync } = require('child_process');
const path = require('path');

let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'OK  ' : 'FAIL'} ${m}`); if (!c) fails++; };

const focus = require(path.join(__dirname, '..', 'src', 'main', 'focus.js'));
if (focus.dcsWindow()) {
  console.log('DCS está abierto: se salta la prueba para no confundir su ventana con la falsa.');
  process.exit(0);
}
ok(focus.dcsRect() === null, 'sin DCS no hay rectángulo (la cruz va al centro de la pantalla)');

const fs = require('fs');
const os = require('os');
const probe = path.join(os.tmpdir(), `lfkb-cruz-${process.pid}.js`);
fs.writeFileSync(probe, `process.stdout.write(JSON.stringify(require(${JSON.stringify(path.join(__dirname, '..', 'src', 'main', 'focus.js'))}).dcsRect()));`);
const ps = `
Add-Type -AssemblyName System.Windows.Forms
$f = New-Object System.Windows.Forms.Form
$f.Text = 'Digital Combat Simulator'; $f.StartPosition = 'Manual'; $f.FormBorderStyle = 'None'; $f.ShowInTaskbar = $false
$f.SetBounds(300, 200, 1920, 1080); $null = $f.Handle
& '${process.execPath.replace(/'/g, "''")}' '${probe.replace(/'/g, "''")}'
$f.Dispose()`;
let out = '';
try {
  out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8' }).trim();
} finally {
  fs.rmSync(probe, { force: true });
}
const r =JSON.parse(out.split(/\r?\n/).pop());
ok(r && r.x === 300 && r.y === 200 && r.width === 1920 && r.height === 1080, `ventana de DCS leída: ${out}`);
const cx = r ? r.x + r.width / 2 : NaN;
const cy = r ? r.y + r.height / 2 : NaN;
ok(cx === 1260 && cy === 740, `centro de la cruz en ${cx}, ${cy}`);

console.log(fails ? `\n${fails} fallos` : '\nTodo correcto');
process.exit(fails ? 1 : 0);
