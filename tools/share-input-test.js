// Pruebas de la sala compartida (anfitrión + otro piloto) y de las combinaciones de controles.
const { Share } = require('../src/main/share');
const { Input } = require('../src/main/input');

let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'OK  ' : 'FAIL'} ${m}`); if (!c) fails++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function fakeCfg(data) {
  return { get: () => data, patch: (p) => Object.assign(data, p) };
}

(async () => {
  // ---- Controles
  const cfg = fakeCfg({
    devices: {},
    bindings: {
      toggle_visible: [['kbd:165', 'kbd:75']],
      next_page: [['joy:{A}:4'], ['joy:{A}:10', 'joy:{A}:4']],
      prev_page: [['joy:{A}:1001']],
    },
  });
  const input = new Input(cfg, 'nada.exe');
  const fired = [];
  input.on('action', (a) => fired.push(a));
  const ev = (e) => input.onEvent(e);
  ev({ t: 'dev', id: '{A}', name: ' VKBsim Gladiator EVO R  ' });
  ev({ t: 'key', k: 75, v: 1 }); ev({ t: 'key', k: 75, v: 0 });
  ok(fired.length === 0, 'K solo no dispara nada');
  ev({ t: 'key', k: 165, v: 1 }); ev({ t: 'key', k: 75, v: 1 }); ev({ t: 'key', k: 75, v: 0 }); ev({ t: 'key', k: 165, v: 0 });
  ok(fired.join() === 'toggle_visible', `AltGr+K → ${fired.join()}`);
  fired.length = 0;
  ev({ t: 'btn', id: '{A}', b: 4, v: 1 }); ev({ t: 'btn', id: '{A}', b: 4, v: 0 });
  ok(fired.join() === 'next_page', `Botón 5 → ${fired.join()}`);
  fired.length = 0;
  ev({ t: 'btn', id: '{A}', b: 10, v: 1 }); ev({ t: 'btn', id: '{A}', b: 4, v: 1 });
  ok(fired.length === 1 && fired[0] === 'next_page', 'Modificador + botón 5 dispara una sola vez (gana la combinación más larga)');
  ev({ t: 'btn', id: '{A}', b: 10, v: 0 }); ev({ t: 'btn', id: '{A}', b: 4, v: 0 });
  fired.length = 0;
  ev({ t: 'btn', id: '{A}', b: 1001, v: 1 });
  ok(fired.join() === 'prev_page', `Seta 1 derecha → ${fired.join()}`);
  ok(input.describe('joy:{A}:1001') === 'VKBsim Gladiator EVO R · Seta 1 derecha', `Nombre: ${input.describe('joy:{A}:1001')}`);
  // Captura de una combinación
  let captured = null;
  input.on('captured', (c) => { captured = c; });
  input.beginCapture('timer');
  ev({ t: 'btn', id: '{A}', b: 1001, v: 0 });
  ev({ t: 'btn', id: '{A}', b: 7, v: 1 }); ev({ t: 'key', k: 84, v: 1 }); ev({ t: 'key', k: 84, v: 0 });
  ok(captured && captured.combo.join() === 'joy:{A}:7,kbd:84', `Asignación capturada: ${captured && captured.combo.join(' + ')}`);
  clearTimeout(input.captureTimer);

  // ---- Sala compartida
  const port = 7899;
  const a = new Share(fakeCfg({ share: { host: true, hostPort: port, room: 'LF', callsign: 'Viper 1-1', connect: true, url: '' } }));
  const b = new Share(fakeCfg({ share: { host: false, hostPort: port, room: 'LF', callsign: 'Viper 1-2', connect: true, url: `ws://127.0.0.1:${port}` } }));
  const c = new Share(fakeCfg({ share: { host: false, hostPort: port, room: 'OTRA', callsign: 'Intruso', connect: true, url: `ws://127.0.0.1:${port}` } }));
  const gotB = [], gotC = [];
  b.on('item', (i) => gotB.push(i));
  c.on('item', (i) => gotC.push(i));
  a.apply();
  await wait(400);
  b.apply();
  c.apply();
  await wait(600);
  ok(a.status === 'conectado' && b.status === 'conectado', `Estados: anfitrión ${a.status}, piloto ${b.status}`);
  ok(a.members.length === 2 && b.members.includes('Viper 1-1'), `Sala LF: ${b.members.join(', ')}`);
  a.send({ type: 'point', point: { lat: 42.1, lon: 42.2, name: 'SA-6' } });
  a.send({ type: 'page', title: 'Radios', image: `data:image/jpeg;base64,${Buffer.alloc(300000, 7).toString('base64')}` });
  a.send({ type: 'mapink', pts: [[42, 42], [42.1, 42.1]] });
  await wait(500);
  ok(gotB.length === 3 && gotB[0].from === 'Viper 1-1' && gotB[0].point.name === 'SA-6', `Viper 1-2 recibe ${gotB.length} elementos (${gotB.map((i) => i.type).join(', ')})`);
  ok(gotB[1] && gotB[1].image.length > 300000, 'Las páginas grandes (≈400 KB) llegan completas');
  ok(gotC.length === 0, 'Otra sala no recibe nada');
  a.stop(); b.stop(); c.stop();
  console.log(fails ? `\n${fails} fallos` : '\nTodo correcto');
  process.exit(fails ? 1 : 0);
})();
