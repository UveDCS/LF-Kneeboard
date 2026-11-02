// Prueba de órdenes de voz sin micrófono: la voz española de Windows (Helena) dice las órdenes en un WAV
// y el reconocedor de la app tiene que entenderlas y traducirlas a la acción correcta.
// Uso: node tools/voice-test.js
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Voice, norm } = require('../src/main/voice');

const tabs = [{ title: 'Misión' }, { title: 'Plan de vuelo' }, { title: 'Radios' }, { title: 'Bloc' }, { title: 'Mapa' }];
let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'OK  ' : 'FAIL'} ${m}`); if (!c) fails++; };

function run(mode, sentences, expected) {
  const cfg = { get: () => ({ tabs, voice: { enabled: true, mode, wake: 'piernógrafo', minConfidence: 0.5 } }) };
  const v = new Voice(cfg, '');
  const map = v.phrases();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lfkb-voice-'));
  const wav = path.join(tmp, 'ordenes.wav');
  const txt = path.join(tmp, 'frases.txt');
  fs.writeFileSync(txt, sentences.join('\n'), 'utf8');
  // Sintetiza las frases separadas por silencios
  execFileSync('powershell.exe', ['-NoProfile', '-Command', `
    Add-Type -AssemblyName System.Speech
    $s = New-Object System.Speech.Synthesis.SpeechSynthesizer
    $s.SelectVoiceByHints('Female', 'Adult', 0, [Globalization.CultureInfo]'es-ES')
    $s.Rate = -1
    $s.SetOutputToWaveFile('${wav}')
    foreach ($l in [IO.File]::ReadAllLines('${txt}', [Text.Encoding]::UTF8)) { $s.Speak($l); $s.Speak(' . . . ') }
    $s.Dispose()`], { stdio: 'ignore' });
  const conf = path.join(tmp, 'conf.txt');
  fs.writeFileSync(conf, ['es-ES', mode, 'piernógrafo', ...map.keys()].join('\n'), 'utf8');
  const out = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, '..', 'native', 'voice', 'lfkb-voice.ps1'), '-Config', conf, '-Wave', wav], { encoding: 'utf8' });
  const got = [];
  for (const line of out.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const ev = JSON.parse(line.replace(/^﻿/, ''));
    if (ev.t === 'rec') {
      let t = norm(ev.text);
      if (mode === 'wake') t = t.replace(/^piernógrafo\s*/, '');
      got.push({ text: t, action: map.get(t), conf: ev.conf });
    }
  }
  expected.forEach((exp, i) => {
    const g = got[i];
    ok(g && g.action === exp, `[${mode}] «${sentences[i]}» → ${g ? `${g.text} → ${g.action} (${g.conf.toFixed(2)})` : 'nada'}`);
  });
  fs.rmSync(tmp, { recursive: true, force: true });
}

run('ptt', ['página siguiente', 'radios', 'plan de vuelo', 'marca punto', 'página tres', 'modo noche'],
  ['next_page', 'tab:2', 'tab:1', 'capture_coords', 'page:2', 'toggle_night']);
run('wake', ['piernógrafo abre mapa', 'piernógrafo oculta', 'piernógrafo marcador aproximación', 'piernógrafo cruz'], ['tab:4', 'hide', 'bm:approach', 'toggle_crosshair']);
console.log(fails ? `\n${fails} fallos` : '\nTodo correcto');
process.exit(fails ? 1 : 0);
