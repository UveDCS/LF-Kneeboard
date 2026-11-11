// Carpetas de DCS: Saved Games según Windows (otro disco, otro nombre), enlaces, nombres propios (-w), carpetas
// elegidas a mano y la lista para el desinstalador. Todo con perfiles falsos en una carpeta temporal.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'OK  ' : 'FAIL'} ${m}`); if (!c) fails++; };
const INTEG = path.join(__dirname, '..', 'src', 'main', 'integration.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lfkb-sg-'));
const mk = (...p) => { const d = path.join(...p); fs.mkdirSync(d, { recursive: true }); return d; };
const junction = (link, target) => execFileSync('cmd', ['/c', 'mklink', '/J', link, target], { stdio: 'ignore' });

// Prepara un caso: perfil falso (USERPROFILE), Saved Games según Windows (LFKB_SAVED_GAMES) y la elección.
function caso(name, prep, choice = {}) {
  const base = mk(root, name);
  const home = mk(base, 'perfil');
  const other = mk(base, 'disco-D');
  const win = prep(home, other) || '';
  process.env.USERPROFILE = home;
  process.env.LFKB_SAVED_GAMES = win;
  delete require.cache[require.resolve(INTEG)];
  const integ = require(INTEG);
  integ.configure(choice.fn ? choice.fn(home, other) : choice);
  const rel = (d) => path.relative(base, d);
  return { integ, dirs: integ.savedGamesDirs().map(rel), rel, home, other };
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

let r = caso('normal', (h) => { mk(h, 'Saved Games', 'DCS'); mk(h, 'Saved Games', 'DCS.openbeta'); });
ok(same(r.dirs, ['perfil\\Saved Games\\DCS', 'perfil\\Saved Games\\DCS.openbeta']), `Saved Games de siempre: ${r.dirs}`);

r = caso('otro-disco', (h, d) => { mk(d, 'Juegos Guardados', 'DCS'); return path.join(d, 'Juegos Guardados'); });
ok(same(r.dirs, ['disco-D\\Juegos Guardados\\DCS']), `movida a otro disco con otro nombre: ${r.dirs}`);

r = caso('resto-viejo', (h, d) => { mk(h, 'Saved Games', 'DCS'); mk(d, 'SG', 'DCS'); return path.join(d, 'SG'); });
ok(same(r.dirs, ['disco-D\\SG\\DCS']), `movida, con una DCS vieja en C: se usa la de Windows: ${r.dirs}`);

r = caso('windows-no-existe', (h, d) => { mk(h, 'Saved Games', 'DCS'); return path.join(d, 'no-existe'); });
ok(same(r.dirs, ['perfil\\Saved Games\\DCS']), `Windows apunta a una carpeta que no existe: la de siempre: ${r.dirs}`);

r = caso('junction-saved-games', (h, d) => { mk(d, 'SG', 'DCS'); junction(path.join(h, 'Saved Games'), path.join(d, 'SG')); });
ok(same(r.dirs, ['perfil\\Saved Games\\DCS']), `Saved Games enlazada a otro disco: ${r.dirs}`);

r = caso('junction-dcs', (h, d) => { mk(h, 'Saved Games'); mk(d, 'DCS-real'); junction(path.join(h, 'Saved Games', 'DCS'), path.join(d, 'DCS-real')); });
ok(same(r.dirs, ['perfil\\Saved Games\\DCS']), `solo DCS enlazada a otro disco: ${r.dirs}`);

r = caso('nombre-propio', (h) => { mk(h, 'Saved Games', 'DCS.mi_servidor', 'Config'); mk(h, 'Saved Games', 'DCS.copia-vacia'); });
ok(same(r.dirs, ['perfil\\Saved Games\\DCS.mi_servidor']), `nombre propio (-w) con datos de DCS sí, carpeta vacía no: ${r.dirs}`);

r = caso('elegida', (h, d) => { mk(h, 'Saved Games', 'DCS'); mk(d, 'Mi DCS', 'Config'); }, { fn: (h, d) => ({ dcsDirs: [path.join(d, 'Mi DCS'), path.join(d, 'no-existe')] }) });
ok(same(r.dirs, ['perfil\\Saved Games\\DCS', 'disco-D\\Mi DCS']), `automáticas + elegida (la que no existe no se usa): ${r.dirs}`);
const info = r.integ.dirsInfo();
ok(info.manual.length === 2 && info.manual[0].exists && info.manual[0].dcs && !info.manual[1].exists, 'Ajustes ve la elegida que falta');

r = caso('solo-elegidas', (h, d) => { mk(h, 'Saved Games', 'DCS'); mk(d, 'Mi DCS'); }, { fn: (h, d) => ({ autoDetect: false, dcsDirs: [path.join(d, 'Mi DCS')] }) });
ok(same(r.dirs, ['disco-D\\Mi DCS']), `sin buscar solas, solo la elegida: ${r.dirs}`);

r = caso('repetida', (h) => { mk(h, 'Saved Games', 'DCS'); }, { fn: (h) => ({ dcsDirs: [path.join(h, 'SAVED GAMES', 'dcs')] }) });
ok(r.dirs.length === 1, `elegida que ya se encontraba sola no se repite: ${r.dirs}`);

r = caso('elegir-saved-games', (h, d) => { mk(d, 'SG', 'DCS', 'Logs'); mk(d, 'SG', 'DCS.openbeta'); mk(d, 'SG', 'Otro juego'); });
let pick = r.integ.resolvePicked(path.join(r.other, 'SG'));
ok(same(pick.dirs.map(r.rel), ['disco-D\\SG\\DCS', 'disco-D\\SG\\DCS.openbeta']) && pick.dcs, `elegir Saved Games entera añade sus DCS: ${pick.dirs.map(r.rel)}`);
pick = r.integ.resolvePicked(path.join(r.other, 'SG', 'DCS'));
ok(pick.dirs.length === 1 && pick.dcs, 'elegir la propia carpeta de DCS');
pick = r.integ.resolvePicked(path.join(r.other, 'SG', 'Otro juego'));
ok(pick.dirs.length === 1 && !pick.dcs, 'elegir otra carpeta: se añade, avisando de que no parece de DCS');

// Lista para el desinstalador: carpetas con el script, en UTF-16LE, y conserva las que ya no se usan pero aún lo tienen.
r = caso('lista', (h, d) => { mk(h, 'Saved Games', 'DCS'); mk(d, 'Ñandú', 'DCS', 'Config'); }, { fn: (h, d) => ({ dcsDirs: [path.join(d, 'Ñandú', 'DCS')] }) });
const hook = path.join(__dirname, '..', 'dcs-scripts', 'Hooks', r.integ.HOOK_NAME);
r.integ.installHook(hook);
const file = path.join(root, 'lista', 'dcs-dirs.txt');
r.integ.writeInstalledList(file);
const read = () => fs.readFileSync(file).toString('utf16le').split('\r\n').filter(Boolean).map(r.rel);
ok(same(read(), ['perfil\\Saved Games\\DCS', 'disco-D\\Ñandú\\DCS']), `dcs-dirs.txt: ${read()}`);
r.integ.configure({});
r.integ.writeInstalledList(file);
ok(read().length === 2, 'la elegida que se deja de usar sigue en la lista mientras tenga el script');
r.integ.uninstallHook([path.join(r.other, 'Ñandú', 'DCS')]);
r.integ.writeInstalledList(file);
ok(same(read(), ['perfil\\Saved Games\\DCS']), 'al quitarle el script sale de la lista');

fs.rmSync(root, { recursive: true, force: true });
console.log(fails ? `\n${fails} fallos` : '\nTodo correcto');
process.exit(fails ? 1 : 0);
