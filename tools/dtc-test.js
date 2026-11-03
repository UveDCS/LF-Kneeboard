// Pruebas del lector de DTC (F/A-18, F-16, F-14), su paso al modelo de la misión (ruta con horas fijas,
// líneas y amenazas con coordenadas, revisión), copiarlo a la carpeta de DCS y enviarlo comprimido por la sala.
const fs = require('fs');
const os = require('os');
const path = require('path');
const DTC = require('../src/main/dtc');
const { buildMissionModel } = require('../src/main/mission-model');

let fails = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'OK  ' : 'FALLO'} ${msg}`);
  if (!cond) fails++;
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lfkb-dtc-'));

// ------------------------------------------------------------------ F/A-18 (como el de «Golpe de acero»)
const f18 = {
  name: 'Golpe', type: 'FA-18C_hornet',
  data: {
    name: 'Golpe', terrain: 'Caucasus', type: 'FA-18C_hornet',
    COMM: { COMM1: { Channel_1: { frequency: 305, modulation: 0, name: 'Overlord' }, Channel_2: { frequency: 270, modulation: 0, name: 'CH 2' } } },
    WYPT: {
      NAV_PTS: [
        { wypt_num: 1, x: -297000, y: 680000, alt: 914, R1: true, R1_order: 1, text_note: 'SALIDA' },
        { wypt_num: 2, x: -290000, y: 676000, alt: 2438, R1: true, R1_order: 2, text_note: 'IP' },
        { wypt_num: 3, x: -280000, y: 672000, alt: 152, R1: true, R1_order: 3, text_note: 'BLANCO' },
        { wypt_num: 4, x: -270000, y: 670000, alt: 3000, R2: true, R2_order: 1 },
      ],
      NAV_ROUTE: [
        { STPT1: { wypt_num: 1, ETA: 36000, FIX_Time: false, speed: 611.16, TGT: false, alt: 914 },
          STPT2: { wypt_num: 2, ETA: 300, FIX_Time: true, speed: 611.16, TGT: false, alt: 2438 },
          STPT3: { wypt_num: 3, ETA: 36308, FIX_Time: true, speed: 611.16, TGT: true, alt: 152 } },
        [], [],
      ],
      NAV_SETTINGS: { TACAN: { Channel: 48, ChannelMode: 1, OnOff: true }, ICLS: { Channel: 11, OnOff: false }, ACLS: { OnOff: false }, AA_Waypoint: { AA_WP_Enabled: true, AA_WP_Number: 4 }, Home_Waypoint: { FPAS_HOME_WP: 1 }, Altitude_Warning: { Warn_Alt_Baro: 2000, Warn_Alt_Rdr: 500 } },
    },
    SA: {
      MEZ_THRTS: [{ num: 1, x: -264000, y: 675900, threat_ring_radius: 4, threat_type: 'SA-6', text: 'Kub norte' }],
      CAP_PTS: [{ num: 1, x: -160000, y: 684000, course: 234, length: 18520, diameter: 9260, turn_direction: 'Left' }],
      CORRIDORS: [],
      FAOR_FLOT: { FAOR: [], FLOT: [{ num: 1, points: [{ x: -262000, y: -105000 }, { x: -303000, y: -105000 }] }] },
    },
    ALR67: {
      CMDS: { CMDSProgramSettings: {
        MAN_1: { Chaff: { Quantity: 1, Repeat: 6, Interval: 1 }, Flare: { Quantity: 0 } },
        MAN_2: { Chaff: { Quantity: 2, Repeat: 1, Interval: 1 }, Flare: { Quantity: 2 } },
        AUTO_1: { Chaff: { Quantity: 0 }, Flare: { Quantity: 0 } },
      }, CMDS_Threat_table: { Ground: { 'SA-6': { program: 1 }, 'SA-8': { program: 1 } }, Air: { 'A-50': { program: 0 } } } },
      RWR: { NORM: { 'SA-6': { PRI: 2, display: true }, 'SA-8': { PRI: 1, display: true }, 'A-50': { PRI: 9, display: false } } },
    },
    HARM: { TOO_CLASS: { 'SA-6': 1, 'SA-8': 1, 'SA-10': 2 }, SETTINGS: { Threat_Class: 1 } },
  },
};
const d = DTC.parseDtc(f18, { file: 'Golpe.dtc' });
ok(d.aircraft === 'F/A-18C' && d.terrain === 'Caucasus', 'F/A-18: avión y mapa');
ok(d.radios[0].channels[0].name === 'Overlord' && d.radios[0].channels[1].name === '', 'Radios: nombres del DTC (y «CH 2» no cuenta como nombre)');
ok(d.routes.length === 2 && d.route.length === 3 && d.route.map((p) => p.name).join(',') === 'SALIDA,IP,BLANCO', 'Ruta 1 por su orden; la ruta 2 aparte');
ok(d.route[2].tgt && d.route[2].fixed && d.route[1].speedKt === 330, 'Objetivo, hora fija y velocidad (611 km/h = 330 kt)');
ok(d.threats.length === 1 && d.threats[0].radiusNm === 4 && d.caps[0].lengthNm === 10 && d.caps[0].turn === 'izquierda', 'Amenaza MEZ y CAP con su tamaño en millas');
ok(d.lines.length === 1 && d.lines[0].kind === 'flot', 'FLOT para el mapa');
const man1 = d.cmds.programs.find((p) => p.id === 'MAN_1');
ok(man1.chaff.total === 6 && /6 × 1 cada 1 s/.test(man1.chaff.detail) && !man1.flare, 'Contramedidas F/A-18: MAN 1 = 6 chaff');
ok(d.cmds.programs[0].id === 'MAN_1' && d.cmds.programs.at(-1).id === 'AUTO_1', 'Programas en orden (MAN y después AUTO)');
ok(d.cmds.auto.length === 2 && d.cmds.auto.every((a) => a.program === 1), 'Programa automático por amenaza (sin las que no tienen)');
ok(d.rwr.modes[0].top[0].name === 'SA-8' && d.rwr.modes[0].hidden[0] === 'A-50', 'RWR: prioridades y ocultas');
ok(d.harm.classes[0].names.join(',') === 'SA-6,SA-8' && d.harm.defaultClass === 1, 'HARM: clases');
ok(d.nav.tacan === '48X' && d.nav.aaWp === 4 && d.nav.icls === null, 'Ajustes de navegación');

// ------------------------------------------------------------------ al modelo de la misión
const mission = {
  theatre: 'Caucasus', start_time: 36000, date: { Year: 2024, Month: 3, Day: 15 },
  coalition: { blue: { bullseye: { x: -290000, y: 650000 }, country: [{ name: 'USA', plane: { group: [{
    name: 'Dagger', task: 'CAS', frequency: 270,
    route: { points: [{ x: -297000, y: 680000, alt: 900, speed: 150, type: 'TakeOffParking' }, { x: -285000, y: 676000, alt: 3000, speed: 150, type: 'Turning Point' }] },
    units: [{ name: 'Dagger 1-1', type: 'FA-18C_hornet', skill: 'Client', callsign: { name: 'Dagger11' }, Radio: [{ channels: [305, 271] }] }],
  }] } }] } },
};
const m = buildMissionModel(mission, { unitName: 'Dagger 1-1', dtc: { ...d, origin: 'misión', useRoute: true } });
ok(m.routeSource === 'DTC Golpe' && m.route.length === 3, 'El plan de vuelo usa la ruta del DTC');
ok(m.route[1].tos === 36300 && m.route[2].tos === 36308, 'Horas: la relativa se suma al inicio (10:05:00) y la absoluta se respeta');
ok(m.route[2].etaLocked && m.route[2].tgt && m.route[1].lat != null, 'Punto de objetivo con hora fija y coordenadas');
ok(m.dtc.threats[0].lat != null && m.dtc.lines[0].points[0].lat != null && m.dtc.caps[0].lat != null, 'Amenazas, líneas y CAP con lat/lon para el mapa');
const rev = m.dtc.review.map((r) => r.text).join(' | ');
ok(/presets de COMM 1 son distintos/.test(rev) && /hora fija/.test(rev), `Revisión: ${m.dtc.review.length} avisos`);
const m2 = buildMissionModel(mission, { unitName: 'Dagger 1-1', dtc: { ...d, origin: 'reciente', useRoute: false } });
ok(m2.routeSource === 'misión' && m2.dtc.radios.length === 1, 'Un DTC sin ruta en uso solo da las radios');
const wrong = DTC.review({ ...d, terrain: 'Nevada', type: 'F-16C_50', aircraft: 'F-16C' }, m);
ok(wrong.filter((r) => r.level === 'error').length === 2, 'Revisión: avisa si es de otro avión o de otro mapa');

// ------------------------------------------------------------------ F-16 y F-14
const f16 = DTC.parseDtc({ type: 'F-16C_50', data: { terrain: 'Nevada', MPD: {
  NAV_PTS: [{ number: 2, x: 1, y: 2, alt: 1000, TOS: 59836, FIX_Time: true, speed: 790, isTOSEnabled: true }, { number: 1, x: 0, y: 0, alt: 900, TOS: 59700, FIX_Time: false, speed: 790 }],
  GEO_LINES: [{ number: 1, x: 0, y: 0, L1: true }, { number: 2, x: 5, y: 5, L1: true, L2: true }, { number: 3, x: 9, y: 9, L2: true }],
  CMDS: { CMDSBingoSettings: { ChaffNum: 10, FlaresNum: 6 }, CMDSProgramSettings: { MAN1: { Chaff: { BurstQuantity: 2, BurstInterval: 0.05, SalvoQuantity: 3, SalvoInterval: 0.5 }, Flare: { BurstQuantity: 0, SalvoQuantity: 0 } } } },
  VIPVRP: { VIP_Enabled: true, VIP_Number: 3, VIPTOTGT_Bearing: 90, VIPTOTGT_Range: 5, VIPTOTGT_Elevation: 300 },
} } });
ok(f16.route.map((p) => p.num).join(',') === '1,2' && f16.route[1].fixed && f16.route[1].tos === 59836, 'F-16: steerpoints en orden con su TOS');
ok(f16.lines.length === 2 && f16.lines.every((l) => l.points.length === 2), 'F-16: líneas geográficas 1 y 2');
ok(f16.cmds.programs[0].chaff.total === 6 && f16.cmds.bingo.flare === 6, 'F-16: MAN1 = 6 chaff y bingo de bengalas');
ok(f16.vip && f16.vip[0].stpt === 3 && f16.vip[0].toTgt.bearing === 90, 'F-16: VIP');
const f14 = DTC.parseDtc({ type: 'F-14B', data: { CMDS: { CMDSProgramSettings: { PROG_1: { Chaff: { BurstQuantity: 1, SalvoQuantity: 2, SalvoInterval: 1 }, Flare: { BurstQuantity: 1, SalvoQuantity: 2, SalvoInterval: 1 } } }, CMDSAutoPrograms: { SAM: { Program: 5, Threshold: 3 } } },
  JDAM: { stations: [{ targets: [{ active: true, name: 'Puente', drop_alt: 20000, drop_spd: 450, has_impact_angle: true, impact_angle: 65 }, { active: false, name: '' }] }] } } });
ok(f14.cmds.programs[0].name === 'PROG 1' && f14.cmds.auto[0].program === 5, 'F-14: programas y automático por categoría');
ok(f14.jdam.any && f14.jdam.stations[0].targets.length === 1 && f14.jdam.stations[0].targets[0].impactAngle === 65, 'F-14: objetivos de JDAM (solo los que tienen algo)');
ok(!DTC.review(f14, null).some((r) => /radio/.test(r.text)), 'F-14: no avisa de radios (su DTC no las lleva)');

// ------------------------------------------------------------------ archivos: misión, importar y enviar
const dcsDtc = path.join(tmp, 'DTC');
fs.mkdirSync(path.join(dcsDtc, 'F-18'), { recursive: true });
fs.writeFileSync(path.join(dcsDtc, 'F-18', 'Viejo.dtc'), JSON.stringify({ ...f18, name: 'Viejo' }));
const misDir = path.join(tmp, 'Mision', 'DTC');
fs.mkdirSync(misDir, { recursive: true });
fs.writeFileSync(path.join(misDir, 'Golpe.dtc'), JSON.stringify(f18));
const found = DTC.missionDtcs(path.join(tmp, 'Mision', 'golpe.miz'));
ok(found.length === 1 && DTC.typeOf(found[0]) === 'FA-18C_hornet', 'Encuentra el DTC que trae la misión (carpeta DTC junto al .miz)');
ok(DTC.folderFor([dcsDtc], 'FA-18C_hornet') === path.join(dcsDtc, 'F-18'), 'Lo copia a la carpeta de DCS de ese avión');
const inst = DTC.installDtc([dcsDtc], found[0]);
ok(inst.file === path.join(dcsDtc, 'F-18', 'Golpe.dtc') && fs.existsSync(inst.file), 'Importar: copiado a Saved Games\\DCS\\DTC\\F-18');
fs.writeFileSync(path.join(misDir, 'Golpe.dtc'), JSON.stringify({ ...f18, data: { ...f18.data, terrain: 'Syria' } }));
const inst2 = DTC.installDtc([dcsDtc], path.join(misDir, 'Golpe.dtc'));
ok(/Golpe \(2\)\.dtc$/.test(inst2.file), 'No pisa otro DTC distinto con el mismo nombre');
const packed = DTC.pack(inst.file);
ok(packed.data.length < JSON.stringify(f18).length && packed.aircraftType === 'FA-18C_hornet', `Enviar: comprimido (${packed.data.length} caracteres)`);
const got = DTC.unpack({ ...packed, from: 'Dagger 1-2' }, path.join(tmp, 'recibidos'));
ok(DTC.readDtcFile(got.file).route.length === 3 && got.type === 'FA-18C_hornet', 'Recibido: se guarda aparte y se lee igual');

// ------------------------------------------------------------------ DTC metidos en el .miz (DTC/ + unit.DTC.Cartridges)
const AdmZip = require('adm-zip');
const { readMiz } = require('../src/main/miz');
const mz = new AdmZip();
mz.addFile('mission', Buffer.from('mission = { coalition = {} }'));
mz.addFile('DTC/Golpe.dtc', Buffer.from(JSON.stringify(f18)));
mz.addFile('DTC/Alternativo.dtc', Buffer.from(JSON.stringify({ ...f18, name: 'Alternativo' })));
mz.addFile('DTC/Vibora.dtc', Buffer.from(JSON.stringify({ name: 'Vibora', type: 'F-16C_50', data: {} })));
const mizPath = path.join(tmp, 'con-dtc.miz');
mz.writeZip(mizPath);
const inMiz = readMiz(mizPath, { extractImages: false }).dtcFiles;
ok(inMiz.length === 3 && inMiz.every((f) => fs.existsSync(f)), `Saca del .miz sus DTC (${inMiz.length})`);
const pick = (carts, type = 'FA-18C_hornet') => { const f = DTC.pickMissionDtc(inMiz, type, carts); return f && path.basename(f, '.dtc'); };
ok(pick([{ name: 'Golpe', default: false }, { name: 'Alternativo', default: true }]) === 'Alternativo', 'Elige el que la plaza lleva por defecto');
ok(pick([{ name: 'Golpe' }]) === 'Golpe', 'Si no hay uno por defecto, otro de los de la plaza');
ok(pick([{ name: 'Otro' }]) === null, 'Si la plaza lleva otros, no le pone uno ajeno');
ok(pick([]) !== null && pick([], 'F-16C_50') === 'Vibora' && pick([], 'F-14B') === null, 'Sin asignación: el de su tipo');

// ------------------------------------------------------------------ herramienta de ruta del F10 frente al DTC: manda lo último
{
  const mis = { theatre: 'Caucasus', start_time: 36000, coalition: { blue: { country: [{ name: 'USA', plane: { group: [{
    name: 'Dagger-1', route: { points: [{ x: -300000, y: 600000, alt: 1000 }, { x: -290000, y: 610000, alt: 1000 }] },
    units: [{ name: 'Dagger-1-1', type: 'FA-18C_hornet', skill: 'Client' }] }] } }] } } };
  const tool = { pts: [{ x: -301000, y: 650000, name: 'RT1' }, { x: -296000, y: 655000, name: 'RT2' }], at: 1000 };
  const dtc = { ...DTC.parseDtc(f18), useRoute: true };
  const src = (sel) => buildMissionModel(mis, { unitName: 'Dagger-1-1', ...sel }).routeSource;
  ok(src({ routeTool: tool, dtc: { ...dtc, at: 0 } }) === 'herramienta de ruta del F10', 'La herramienta de ruta pasa delante del DTC de la misión');
  ok(/^DTC /.test(src({ routeTool: tool, dtc: { ...dtc, at: 2000 } })), 'Un DTC cargado después de la herramienta de ruta pasa delante');
  ok(src({ routeTool: { ...tool, at: 3000 }, dtc: { ...dtc, at: 2000 } }) === 'herramienta de ruta del F10', 'Y al revés: la herramienta, si la tocas después');
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `\n${fails} fallos` : '\nTodo correcto');
process.exit(fails ? 1 : 0);
