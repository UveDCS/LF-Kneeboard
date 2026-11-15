// Paquete naval: horas de los eventos (ciclos de duración variable), recovery, airplan por escuadrón, stack, Marshal,
// DRR, ladder con horas reales y la fila de ahora, y exportar/importar. Datos de ejemplo, solo para la prueba.
const path = require('path');
const { pathToFileURL } = require('url');

let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'OK  ' : 'FAIL'} ${m}`); if (!c) fails++; };

(async () => {
  const C = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'js', 'cvw-data.js')).href);

  ok(C.toMin('09:45') === 585 && C.toMin('9.45') === 585 && C.toMin('25:00') === 1500 && C.toMin('x') === null, 'horas HH:MM');
  ok(C.hhmm(585) === '09:45' && C.hhmm(1500) === '01:00' && C.hhmm(-15) === '23:45', 'y al revés, con la medianoche');

  // Paquete vacío: nada fijado
  const e = C.emptyPackage();
  ok(!e.events.length && !e.squadrons.length && !e.ladders.length && !e.card.radios.length && e.name === '', 'el paquete nuevo está vacío');

  // Eventos: se rellenan con una duración y luego se retoca uno (ciclo variable)
  const p = C.emptyPackage();
  p.events = ['1', '2', '3', '4'].map((n) => ({ id: `e${n}`, name: n, time: '' }));
  C.fillTimes(p, '09:45', 105);
  ok(p.events.map((x) => x.time).join(' ') === '09:45 11:30 13:15 15:00', `horas con ciclo de 1:45: ${p.events.map((x) => x.time).join(' ')}`);
  p.events[2].time = '13:45';
  let i2 = C.eventInfo(p, 1), i3 = C.eventInfo(p, 2);
  ok(i2.cycle === 135 && i3.cycle === 75, `cada ciclo dura distinto: ${C.durText(i2.cycle)} y ${C.durText(i3.cycle)}`);
  ok(C.hhmm(i3.launch[0]) === '13:30' && C.hhmm(i3.recovery[1]) === '14:00' && i3.recovers === '2', 'ventanas de launch y recovery del evento 3 (recupera a los del 2)');
  ok(C.eventInfo(p, 0).recovery === null, 'el primer evento no tiene recovery');
  const rec = C.recoveryFor(p, 2);
  ok(rec && rec.event === '4' && C.hhmm(rec.window[0]) === '15:00', 'si despegas en el 3, recuperas en el recovery del 4');
  // Medianoche
  const q = C.emptyPackage();
  q.events = [{ id: 'a', name: '8', time: '22:00' }, { id: 'b', name: '9', time: '23:45' }, { id: 'c', name: 'FF', time: '01:30' }];
  ok(C.eventInfo(q, 1).cycle === 105 && C.eventInfo(q, 2).time === 1530, 'el ciclo cruza la medianoche');

  // Airplan: eventos del escuadrón (solo donde despega; «en el aire» no cuenta)
  p.squadrons = [{ id: 's1', name: 'DRAGON', unit: 'VFA-37', aircraft: 'FA-18C_hornet', modex: '300', drr: 20 }, { id: 's2', name: 'VACÍO' }];
  p.airplan = { s1: { e3: [{ code: '3D1', msn: 'CAP', n: 2, ch: 9 }], e4: [{ call: 'DRAGON11', ch: 9, air: true }] } };
  ok(C.squadronEvents(p, 's1').join(',') === '2', 'eventos de VFA-37: solo el 3 (el «en el aire» del 4 no cuenta)');
  ok(C.squadronEvents(p, 's2').length === 4, 'un escuadrón sin vuelos puede elegir cualquier evento');
  ok(C.flightsOf(p, 's1', 'e3')[0].code === '3D1' && C.flightsOf(p, 'nada', 'e3').length === 0, 'vuelos de un escuadrón en un evento');

  // Carrier Card: stack, canal, DRR, Marshal
  p.card.radios = [{ ch: 9, name: 'Fighter A' }];
  p.card.holding = [{ alt: 23, sq: 's1' }, { alt: 20, sq: null, text: 'Big Wing Tkr' }, { alt: 3, sq: 's1' }, { alt: 14, sq: 's1' }];
  ok(C.stackLevels(p, 's1').join(',') === '3,14,23', 'stack de Case I del escuadrón, de menor a mayor');
  ok(C.channel(p, 9).name === 'Fighter A', 'nombre del canal');
  ok(C.drrRadial(20, 20) === 40 && C.drrRadial(350, 20) === 10 && C.drrRadial(340, 20) === 360 && C.drrRadial(null, 20) === null, 'radial de salida = BRC + offset');
  const m3 = C.marshal(p, 3, C.toMin('15:00'), 20);
  ok(m3.altFt === 8000 && m3.dme === 23 && m3.radial === 200 && C.hhmm(m3.push) === '15:02', `Marshal del 3.º: ${m3.altFt} ft · ${m3.dme} nm · ${m3.radial}° · Push ${C.hhmm(m3.push)}`);

  // Ladder: rellenar desde On the Ball con el FF, horas reales y fila de ahora
  // Tomcat del ejemplo: sube su FF (1.1) en todos los tramos. (El del Hornet no: de On the Ball a recovery sube 1.2 y luego 1.1;
  // por eso «Rellenar» es una ayuda que luego se retoca.)
  const L = { aircraft: 'FA-18C_hornet', columns: ['Case I', 'Case II / III'], ff: 1.1, rows: [{ label: 'On the Ball', offset: null, values: [3.6, 6.5] }], fuel: [{ label: 'Interno', qty: 10.8 }, { label: '1 EXT', qty: 2.2 }] };
  C.fillLadder(L);
  ok(L.rows.length === 8 && L.rows[1].values[0] === 4.7 && L.rows[3].values[0] === 6.9 && L.rows[7].values[0] === 11.3 && L.rows[7].values[1] === 14.2, `ladder rellenado: ${L.rows.map((r) => r.values[0]).join(' ')}`);
  p.ladders = [C.normalize({ ladders: [L] }).ladders[0]];
  const lad = C.ladderFor(p, 'FA-18C_hornet');
  ok(lad && !C.ladderFor(p, 'F-14B'), 'el ladder sale del avión del escuadrón');
  const rows = C.ladderTimes(lad, 0, C.toMin('15:00'));
  ok(rows[0].ball && rows[0].time === null && C.hhmm(rows[1].time) === '15:00' && C.hhmm(rows[3].time) === '14:30', 'horas reales del ladder');
  ok(C.nowRow(rows, C.toMin('14:31')) === 3 && rows[3].value === 6.9, 'a las 14:31 toca la fila de las 14:30 (6.9)');
  ok(C.nowRow(rows, C.toMin('15:10')) === 1, 'pasado el recovery, la de recovery');
  ok(C.nowRow(rows, C.toMin('12:00')) === -1, 'antes del ladder, ninguna');
  ok(C.fuelTotals(lad).map((f) => f.total).join(',') === '10.8,13', 'totales de combustible');

  // Exportar e importar
  p.name = 'CVW-5';
  const txt = C.toFile(p);
  const back = C.fromFile(txt);
  ok(back.name === 'CVW-5' && back.events[2].time === '13:45' && back.airplan.s1.e3[0].code === '3D1' && back.ladders[0].rows[3].values[0] === 6.9, 'exportar e importar conserva todo');
  let err = '';
  try { C.fromFile('{"hola":1}'); } catch (x) { err = x.message; }
  ok(/No es un paquete naval/.test(err), `un JSON cualquiera no se importa: «${err}»`);
  try { C.fromFile('no json'); err = ''; } catch (x) { err = x.message; }
  ok(/no se puede leer/.test(err), 'un archivo roto tampoco');
  try { C.fromFile(JSON.stringify({ format: 'lf-cvw', version: 99 })); err = ''; } catch (x) { err = x.message; }
  ok(/versión más nueva/.test(err), 'uno de una versión más nueva avisa');
  const n = C.normalize({ squadrons: [{ name: 'X', drr: '−20' }], ladders: [{ columns: ['A'], rows: [{ label: 'r', values: ['3', 'x', 9] }] }] });
  ok(n.squadrons[0].id && n.ladders[0].rows[0].values.length === 1 && n.ladders[0].rows[0].values[0] === 3, 'normaliza lo que llega (ids, números, columnas)');

  console.log(fails ? `\n${fails} fallos` : '\nTodo correcto');
  process.exit(fails ? 1 : 0);
})();
