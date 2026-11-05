// Comprueba los permisos de la memoria compartida con la capa VR: tiene que poder abrirla DCS tanto si
// él o LF Kneeboard se ejecutan como administrador como si no (usuarios autenticados, integridad media).
// Uso: node tools/vr-perm-test.js
const koffi = require('koffi');
const { VrBridge } = require('../src/main/vr');

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${msg}`); if (!ok) fails++; };

const name = `Local\\LFKneeboard.PermTest.${process.pid}`;
const vr = new VrBridge({ name });
const logs = [];
vr.on('log', (m) => logs.push(m));
check(vr.start() === true, `memoria creada (${logs.join(' | ')})`);

const k32 = koffi.load('kernel32.dll');
const adv = koffi.load('advapi32.dll');
const OpenFileMappingW = k32.func('intptr_t __stdcall OpenFileMappingW(uint32_t access, int inherit, str16 name)');
const CloseHandle = k32.func('int __stdcall CloseHandle(intptr_t h)');
const GetSecurityInfo = adv.func('uint32_t __stdcall GetSecurityInfo(intptr_t h, int type, uint32_t info, void *o, void *g, _Out_ void **dacl, void *sacl, _Out_ void **sd)');
const ToString = adv.func('bool __stdcall ConvertSecurityDescriptorToStringSecurityDescriptorW(void *sd, uint32_t rev, uint32_t info, _Out_ char16_t **str, void *len)');

const SE_KERNEL_OBJECT = 6;
const DACL = 0x4;
const LABEL = 0x10;
const h = OpenFileMappingW(0x000f001f, 0, name);
check(!!h, 'se abre desde otro manejador con acceso completo');
const dacl = [null];
const sd = [null];
const r = GetSecurityInfo(h, SE_KERNEL_OBJECT, DACL | LABEL, null, null, dacl, null, sd);
check(r === 0, `permisos leídos (código ${r})`);
const str = [null];
ToString(sd[0], 1, DACL | LABEL, str, null);
const sddl = String(str[0] || '');
console.log(`     ${sddl}`);
check(/\(A;;(GA|0xf001f|FA);;;AU\)/i.test(sddl) || /;;;AU\)/.test(sddl), 'acceso para usuarios autenticados (DCS con o sin administrador)');
check(/;;;BA\)/.test(sddl), 'acceso para administradores');
check(/\(ML;;NW;;;ME\)/.test(sddl), 'integridad media: un DCS sin elevar puede escribir aunque la app esté elevada');
check(vr.elevated === false || vr.elevated === true, `sabe si la app está elevada (${vr.elevated})`);
CloseHandle(h);
vr.stop();
console.log(fails ? `\n${fails} fallo(s)` : '\nTodo correcto');
process.exit(fails ? 1 : 0);
