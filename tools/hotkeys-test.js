// Teclado de la ventana del kneeboard frente a las asignaciones globales (lector de mandos).
// Con la ventana activa, una tecla asignada a una acción la atiende el lector de mandos; si la ventana la
// usara también (AvPág, flechas…), cada pulsación contaría dos veces y se saltarían páginas.
// Uso: node tools/hotkeys-test.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { handledByBinding } = require('../src/shared/hotkeys');
const { Config } = require('../src/main/config');

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'OK  ' : 'FAIL'} ${msg}`); if (!cond) fails++; };

// Teclas como las ve la página (KeyboardEvent): keyCode es el código virtual de Windows.
const key = (keyCode, mods = {}) => ({ keyCode, shiftKey: false, ctrlKey: false, altKey: false, ...mods });
const ALTGR = { ctrlKey: true, altKey: true }; // AltGr en Windows: Ctrl + Alt
const PGDN = 34, PGUP = 33, RIGHT = 39, LEFT = 37;

// Asignaciones de fábrica (las de una configuración nueva)
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lfkb-hotkeys-'));
const factory = new Config(dir).get().bindings;
fs.rmSync(dir, { recursive: true, force: true });

ok(handledByBinding(factory, key(PGDN, ALTGR)), 'De fábrica: AltGr+AvPág ya es «Página siguiente» → la ventana no la usa');
ok(handledByBinding(factory, key(PGUP, ALTGR)), 'De fábrica: AltGr+RePág ya es «Página anterior» → la ventana no la usa');
// Así llega AltGr+AvPág a la página con teclado español (visto en Electron 44): sin Alt ni Ctrl, solo «AltGraph».
const altGraph = (on) => ({ getModifierState: (m) => on && m === 'AltGraph' });
ok(handledByBinding(factory, key(PGDN, altGraph(true))), 'De fábrica, teclado español: AltGr+AvPág llega como «AltGraph» → la ventana no la usa');
ok(!handledByBinding(factory, key(PGDN, altGraph(false))), 'Teclado español: AvPág sin AltGr → la ventana pasa página');
ok(!handledByBinding(factory, key(PGDN)), 'De fábrica: AvPág sola no está asignada → la ventana pasa página');
ok(!handledByBinding(factory, key(RIGHT)), 'De fábrica: → no está asignada → la ventana pasa página');

// Asignaciones del piloto (como las de la configuración donde se vio el fallo)
const mine = { ...factory, next_page: [['kbd:165', 'kbd:34'], ['kbd:39']], prev_page: [['kbd:165', 'kbd:33'], ['kbd:37']] };
ok(handledByBinding(mine, key(RIGHT)), '→ asignada a «Página siguiente» → la ventana no la usa (antes, dos páginas)');
ok(handledByBinding(mine, key(LEFT)), '← asignada a «Página anterior» → la ventana no la usa');
ok(handledByBinding(mine, key(RIGHT, { shiftKey: true })), 'Con un modificador de más también la atiende el lector de mandos');

// Combinaciones con modificador: solo cuentan si el modificador está pulsado
const shift = { next_page: [['kbd:160', 'kbd:34']] };
ok(handledByBinding(shift, key(PGDN, { shiftKey: true })), 'Mayús+AvPág asignada y pulsada con Mayús → no la usa la ventana');
ok(!handledByBinding(shift, key(PGDN)), 'Mayús+AvPág asignada pero pulsada sin Mayús → la ventana pasa página');
ok(!handledByBinding(factory, key(PGDN, { shiftKey: true })), 'AltGr+AvPág asignada pero pulsada con Mayús → la ventana pasa página');

// Cada modificador, izquierdo y derecho, por separado (códigos que guarda el lector de mandos al asignar)
const MODS = [
  [160, 'Mayús izquierda', { shiftKey: true }], [161, 'Mayús derecha', { shiftKey: true }],
  [162, 'Ctrl izquierdo', { ctrlKey: true }], [163, 'Ctrl derecho', { ctrlKey: true }],
  [164, 'Alt izquierdo', { altKey: true }], [165, 'AltGr', { altKey: true }],
];
for (const [vk, name, held] of MODS) {
  const b = { next_page: [[`kbd:${vk}`, 'kbd:34']] };
  ok(handledByBinding(b, key(PGDN, held)), `${name}+AvPág pulsada con ${name} → no la usa la ventana`);
  const other = held.shiftKey ? { ctrlKey: true } : { shiftKey: true };
  ok(!handledByBinding(b, key(PGDN, other)), `${name}+AvPág pulsada con otro modificador → la ventana pasa página`);
}

// Lo que no es teclado no cuenta
ok(!handledByBinding({ next_page: [['joy:{ABC}:3']] }, key(PGDN)), 'Un botón del mando no le quita teclas a la ventana');
ok(!handledByBinding({ next_page: [['joy:{ABC}:3', 'kbd:34']] }, key(PGDN)), 'Botón del mando + AvPág: sin saber si el botón está pulsado, la ventana sigue con AvPág');
ok(!handledByBinding({ next_page: [['kbd:65', 'kbd:34']] }, key(PGDN)), 'A + AvPág: sin saber si A está pulsada, la ventana sigue con AvPág');
ok(!handledByBinding({}, key(PGDN)) && !handledByBinding(undefined, key(PGDN)), 'Sin asignaciones: todo lo atiende la ventana');

console.log(fails ? `\n${fails} fallos` : '\nTodo correcto');
process.exit(fails ? 1 : 0);
