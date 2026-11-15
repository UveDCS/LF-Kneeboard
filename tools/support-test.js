// Posición de tanqueros, AWACS y barcos: en directo (si DCS la da) emparejada con la misión, la de la misión si no es
// una plantilla con activación retrasada, y nunca la de una plantilla que copia un script (Foothold, MOOSE...).
const path = require('path');
const { pathToFileURL } = require('url');
const { DcsLink } = require('../src/main/dcs');

let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'OK  ' : 'FAIL'} ${m}`); if (!c) fails++; };

(async () => {
  const P = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'js', 'support-pos.js')).href);
  const link = new DcsLink({ get: () => ({ dcs: { appPort: 1, hookPort: 1 }, auto: {} }) });
  // Misión tipo Foothold: plantillas con activación retrasada aparcadas lejos; una AWACS normal; un portaaviones.
  link.mission = {
    coalition: 'blue',
    support: [
      { kind: 'Tanquero', callsign: 'Texaco11', group: 'Texaco', type: 'KC-135', late: true, lat: 37.114, lon: 32.371 },
      { kind: 'Tanquero', callsign: 'Arco11', group: 'Arco', type: 'KC135MPRS', late: true, lat: 37.114, lon: 32.432 },
      { kind: 'AWACS', callsign: 'Overlord11', group: 'OVERLORD 1-1', type: 'E-3A', late: false, lat: 36.6, lon: 35.85 },
      { kind: 'Barco', callsign: 'CVN-71', group: 'CVN', type: 'CVN_71', late: false, lat: 35.45, lon: 35.45 },
      { kind: 'Tanquero', callsign: 'Shell11', group: 'Shell', type: 'KC130', late: true, lat: 34.0, lon: 32.4 },
    ],
  };
  const obj = (o) => ({ coal: 2, alt: 6096, ...o });
  link.objects = { ok: true, at: Date.now(), list: [
    obj({ type: 'KC-135', group: 'Texaco#001', lat: 36.2, lon: 37.1 }),
    obj({ type: 'KC135MPRS', group: 'Tanker_Boom_Zona5', lat: 36.0, lon: 37.5 }),
    obj({ type: 'E-3A', group: 'OVERLORD 1-1', lat: 36.65, lon: 35.9 }),
    obj({ type: 'CVN_71', group: 'CVN', lat: 35.3, lon: 35.6, alt: 0 }),
    obj({ type: 'KC130', group: 'Shell_rojo', coal: 1, lat: 34.5, lon: 36.0 }),
  ] };
  let s = link.supportLive();
  ok(s[0] && s[0].lat === 36.2, 'copia de un script por nombre («Texaco#001» es «Texaco»)');
  ok(s[1] && s[1].lat === 36.0, 'plantilla sin pareja por nombre: por tipo, si solo hay uno de ese tipo en tu bando');
  ok(s[2] && s[2].lat === 36.65 && s[3] && s[3].lat === 35.3 && s[3].altFt === 0, 'AWACS y portaaviones en directo (el barco se mueve)');
  ok(s[4] === null, 'un tanquero del otro bando no se empareja');

  link.objects.list.push(obj({ type: 'KC135MPRS', group: 'Otro_Boom', lat: 35.0, lon: 38.0 }));
  ok(link.supportLive()[1] === null, 'con dos del mismo tipo y ninguno por nombre, no se adivina');
  link.objects.at = Date.now() - 30000;
  ok(link.supportLive() === null, 'datos de hace más de 20 s: no valen');
  link.objects = { ok: false, list: [], at: Date.now() };
  ok(link.supportLive() === null, 'servidor que no deja exportar objetos: sin directo');

  // Lo que usan Apoyo, Mapa y Combustible
  const m = link.mission;
  link.objects = { ok: true, at: Date.now(), list: [obj({ type: 'KC-135', group: 'Texaco#001', lat: 36.2, lon: 37.1 })] };
  const live = { support: link.supportLive() };
  let p = P.supportPos(m, live, 0);
  ok(p && p.src === 'live' && p.lat === 36.2 && P.supportPosNote(m.support[0], p) === 'en directo', 'plantilla con directo: posición real, «en directo»');
  p = P.supportPos(m, live, 1);
  ok(p === null && P.supportPosNote(m.support[1], p) === 'lo crea un script', 'plantilla sin directo: sin posición (nada de 200 nm falsas), «lo crea un script»');
  p = P.supportPos(m, null, 2);
  ok(p && p.src === 'mission' && p.lat === 36.6, 'sin directo, un apoyo normal usa su posición de la misión');

  console.log(fails ? `\n${fails} fallos` : '\nTodo correcto');
  process.exit(fails ? 1 : 0);
})();
