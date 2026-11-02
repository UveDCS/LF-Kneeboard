// Compila la capa OpenXR y el lector de entradas con Zig (pip install ziglang).
// Los binarios quedan en native/bin y el instalador los incluye; los usuarios no necesitan compilar nada.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const bin = path.join(root, 'native', 'bin');
fs.mkdirSync(bin, { recursive: true });

function zig(args) {
  console.log('> zig ' + args.join(' '));
  execFileSync('python', ['-m', 'ziglang', ...args], { cwd: root, stdio: 'inherit' });
}

const target = ['-target', 'x86_64-windows-gnu'];

zig(['c++', ...target, '-O2', '-shared', '-std=c++17', '-fno-exceptions', '-Wno-nullability-completeness',
  '-Inative/openxr-layer/include', 'native/openxr-layer/layer.cpp',
  '-o', 'native/bin/lfkb_openxr_layer.dll', '-lkernel32']);

zig(['cc', ...target, '-O2', 'native/input-helper/input.c',
  '-o', 'native/bin/lfkb-input.exe', '-luser32', '-lwinmm', '-Wl,--subsystem,windows']);

// Manifiesto de la capa implícita (la ruta de la DLL es relativa al propio JSON).
fs.writeFileSync(path.join(bin, 'lfkb_openxr_layer.json'), JSON.stringify({
  file_format_version: '1.0.0',
  api_layer: {
    name: 'XR_APILAYER_LAFUNDACION_kneeboard',
    library_path: '.\\lfkb_openxr_layer.dll',
    api_version: '1.0',
    implementation_version: '1',
    description: 'LF Kneeboard: kneeboard en VR para DCS World',
    disable_environment: 'DISABLE_XR_APILAYER_LAFUNDACION_kneeboard',
  },
}, null, 2));

for (const junk of fs.readdirSync(bin)) {
  if (/\.(lib|pdb)$/i.test(junk)) fs.rmSync(path.join(bin, junk), { force: true });
}
for (const f of ['lfkb_openxr_layer.dll', 'lfkb-input.exe']) {
  console.log(`${f}: ${(fs.statSync(path.join(bin, f)).size / 1024).toFixed(0)} KB`);
}
