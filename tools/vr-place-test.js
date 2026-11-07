// Colocación en VR desde el propio kneeboard: pasos de cada eje, topes, textos, repetición al mantener,
// lo que se manda a la capa mientras colocas y «Restablecer la posición en VR».
// Uso: node tools/vr-place-test.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const P = require('../src/shared/vr-placement');
const { Config, ACTIONS } = require('../src/main/config');

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'OK  ' : 'FAIL'} ${msg}`); if (!cond) fails++; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const base = () => ({ pos: [0.13, -0.36, -0.42], rot: [-8, -48, 0], width: 0.24 });

// 1) Un paso por toque, en la unidad que ve el piloto (cm y grados)
{
  const vr = base();
  const r = P.step(vr, 'lado', +1);
  ok(r.vr.pos[0] === 0.14, `Lado +1: 13 cm → 14 cm (pos[0] = ${r.vr.pos[0]})`);
  ok(vr.pos[0] === 0.13 && r.vr.pos !== vr.pos, 'No cambia la colocación de partida (devuelve una copia)');
  ok(P.step(vr, 'distancia', +1).vr.pos[2] === -0.43, 'Alejar: 42 → 43 cm (pos[2] = -0.43)');
  ok(P.step(vr, 'distancia', -1).vr.pos[2] === -0.41, 'Acercar: 42 → 41 cm (pos[2] = -0.41)');
  ok(P.step(vr, 'giro', +1, 5).vr.rot[0] === -3, 'Giro +5 (manteniendo pulsado): -8° → -3°');
  ok(P.step(vr, 'ancho', -1).vr.width === 0.235, 'Ancho: pasos de medio centímetro (24 → 23,5 cm)');
}

// 2) Sin errores de coma flotante después de muchos pasos
{
  let vr = base();
  for (let i = 0; i < 10; i++) vr = P.step(vr, 'altura', +1).vr;
  ok(vr.pos[1] === -0.26, `Altura +10 pasos: -36 → -26 cm exactos (${vr.pos[1]})`);
}

// 3) Topes: los mismos rangos que Ajustes > Realidad virtual
{
  const vr = { ...base(), pos: [0.6, -0.36, -0.42] };
  const r = P.step(vr, 'lado', +1);
  ok(r.vr.pos[0] === 0.6 && r.atMax && !r.atMin, 'Lado en 60 cm: no pasa del tope y avisa de máx.');
  const near = P.step({ ...base(), pos: [0.13, -0.36, -0.16] }, 'distancia', -1, 5);
  ok(near.vr.pos[2] === -0.15 && near.atMin, 'Acercar 5 desde 16 cm: se queda en el mínimo (15 cm)');
  ok(P.step({ ...base(), rot: [-8, 30, 0] }, 'inclinacion', +1).atMax, 'Inclinación: tope de 30°');
  ok(!P.step(base(), 'lado', +1).atMax, 'Lejos del tope no avisa');
}

// 4) Textos: valor sin signo y hacia dónde
{
  const d = (vr, id) => P.describe(vr, id);
  ok(same(d(base(), 'lado'), { value: '13 cm', hint: 'a la derecha' }), 'Lado 0,13 → «13 cm a la derecha»');
  ok(d({ ...base(), pos: [-0.05, 0, -0.4] }, 'lado').hint === 'a la izquierda', 'Lado negativo → «a la izquierda»');
  ok(d({ ...base(), pos: [0, 0, -0.4] }, 'lado').hint === 'centrado', 'Lado 0 → «centrado»');
  ok(d({ ...base(), pos: [0.6, 0, -0.4] }, 'lado').hint === 'máx. a la derecha', 'En el tope → «máx. a la derecha»');
  ok(same(d(base(), 'altura'), { value: '36 cm', hint: 'por debajo' }), 'Altura -0,36 → «36 cm por debajo»');
  ok(d(base(), 'distancia').value === '42 cm', 'Distancia -0,42 → «42 cm»');
  ok(same(d(base(), 'giro'), { value: '8°', hint: 'hacia la izquierda' }), 'Giro -8° → «8° hacia la izquierda» (la cara mira a la izquierda)');
  ok(same(d(base(), 'inclinacion'), { value: '48°', hint: 'hacia arriba' }), 'Inclinación -48° → «48° hacia arriba» (la cara mira arriba)');
  ok(same(d(base(), 'alabeo'), { value: '0°', hint: 'recto' }), 'Alabeo 0° → «0° recto»');
  ok(d({ ...base(), rot: [0, 0, 10] }, 'alabeo').hint === 'antihorario', 'Alabeo positivo → «antihorario»');
  ok(d({ ...base(), width: 0.235 }, 'ancho').value === '23,5 cm', 'Ancho 0,235 → «23,5 cm» (coma decimal)');
}

// 5) Mantener pulsado: un paso por toque y, pasado un rato, de cinco en cinco
ok(P.holdMultiplier(0) === 1 && P.holdMultiplier(1499) === 1, 'Primer segundo y medio: pasos de 1');
ok(P.holdMultiplier(1500) === 5 && P.holdMultiplier(6000) === 5, 'Después: pasos de 5');

// 6) Lo que recibe la capa VR
{
  const cfg = {
    hidden: false, dual: false,
    vr: { enabled: true, gazeZoom: true, zoomScale: 1.6 },
    views: [{ vr: base() }, { vr: { pos: [-0.13, -0.36, -0.42], rot: [8, -48, 0], width: 0.24 } }],
  };
  const p = P.placementFor(cfg, 0);
  ok(p.visible && p.gazeZoom && p.width === 0.24 && same(p.pos, [0.13, -0.36, -0.42]), 'Normal: visible, con «Ampliar al mirarlo» y su colocación guardada');
  ok(P.placementFor(cfg, 0, { placing: true }).gazeZoom === false, 'Colocando: «Ampliar al mirarlo» en pausa');
  const ov = P.placementFor(cfg, 0, { override: { pos: [0.2, -0.3, -0.5], rot: [0, -40, 0], width: 0.3 } });
  ok(same(ov.pos, [0.2, -0.3, -0.5]) && ov.width === 0.3 && same(ov.rot, [0, -40, 0]), 'Colocando: la capa usa la posición en vivo aunque aún no esté guardada');
  const fz = P.placementFor(cfg, 0, { forcedZoom: true });
  ok(Math.abs(fz.width - 0.384) < 1e-9 && fz.gazeZoom === false, 'Zoom fijo: ancho × ampliación y sin ampliar al mirar');
  ok(P.placementFor(cfg, 1).visible === false, 'El segundo kneeboard no se ve si no hay dos');
  ok(P.placementFor({ ...cfg, hidden: true }, 0).visible === false, 'Guardado: no se ve');
}

// 7) Restablecer la posición en VR (acción de HOTAS): vuelve a la de fábrica sin tocar lo demás
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lfkb-vrplace-'));
  const cfg = new Config(dir);
  const vs = cfg.get().views.map((v) => ({ ...v }));
  vs[0] = { ...vs[0], state: { tab: 3, pages: { a: 2 } }, vr: { pos: [0.6, 0.4, -1.2], rot: [90, 30, 45], width: 0.6 } };
  vs[1] = { ...vs[1], vr: { pos: [-0.5, 0.3, -1], rot: [-90, 0, 0], width: 0.5 } };
  cfg.patch({ views: vs });
  cfg.resetVrPlacement();
  const after = cfg.get().views;
  ok(same(after[0].vr, base()), 'Kneeboard 1: vuelve a 13 cm der., 36 cm abajo, 42 cm, -8°/-48°/0°, 24 cm');
  ok(same(after[1].vr, { pos: [-0.13, -0.36, -0.42], rot: [8, -48, 0], width: 0.24 }), 'Kneeboard 2: vuelve a su sitio de fábrica');
  ok(same(after[0].state, { tab: 3, pages: { a: 2 } }), 'No cambia la pestaña ni la página');
  cfg.save(true);
  fs.rmSync(dir, { recursive: true, force: true });
  ok(ACTIONS.some((a) => a.id === 'reset_vr_place'), 'Se puede asignar a un botón: «Restablecer la posición en VR»');
}

console.log(fails ? `\n${fails} fallos` : '\nTodo correcto');
process.exit(fails ? 1 : 0);
