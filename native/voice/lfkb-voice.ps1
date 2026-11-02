# Reconocimiento de órdenes de voz para LF Kneeboard (sin conexión, motor de voz de Windows).
# Lee la configuración de un archivo de texto UTF-8:
#   línea 1: cultura (es-ES)   línea 2: modo (ptt | wake)   línea 3: palabra de activación   resto: frases
# Escribe un JSON por línea: {"t":"ready"...}, {"t":"rec","text":"...","conf":0.83}, {"t":"error","msg":"..."}
# Por la entrada estándar recibe "on" / "off" (pulsar para hablar) y "quit".
param([Parameter(Mandatory = $true)][string]$Config, [string]$Wave = '')

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Speech
$speechAsm = [System.Speech.Recognition.SpeechRecognitionEngine].Assembly.Location

Add-Type -ReferencedAssemblies $speechAsm -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Speech.Recognition;
using System.Text;

public static class LfkbVoice {
  static readonly object Lock = new object();

  static string Esc(string s) {
    var sb = new StringBuilder();
    foreach (char c in s ?? "") {
      if (c == '"' || c == '\\') { sb.Append('\\').Append(c); }
      else if (c < 0x20) { sb.AppendFormat("\\u{0:x4}", (int)c); }
      else sb.Append(c);
    }
    return sb.ToString();
  }

  static void Out(string json) {
    lock (Lock) { Console.Out.WriteLine(json); Console.Out.Flush(); }
  }

  public static void Run(string configPath, string wave) {
    var lines = File.ReadAllLines(configPath, Encoding.UTF8).Select(l => l.Trim()).ToList();
    string culture = lines.Count > 0 ? lines[0] : "es-ES";
    string mode = lines.Count > 1 ? lines[1] : "ptt";
    string wake = lines.Count > 2 ? lines[2] : "";
    var phrases = lines.Skip(3).Where(l => l.Length > 0).Distinct().ToArray();

    var all = SpeechRecognitionEngine.InstalledRecognizers();
    if (all.Count == 0) { Out("{\"t\":\"error\",\"msg\":\"Windows no tiene ningún reconocedor de voz instalado\"}"); return; }
    RecognizerInfo info = all.FirstOrDefault(r => r.Culture.Name.Equals(culture, StringComparison.OrdinalIgnoreCase))
      ?? all.FirstOrDefault(r => r.Culture.TwoLetterISOLanguageName == culture.Substring(0, 2))
      ?? all[0];

    var eng = new SpeechRecognitionEngine(info);
    try { if (!string.IsNullOrEmpty(wave)) eng.SetInputToWaveFile(wave); else eng.SetInputToDefaultAudioDevice(); }
    catch (Exception e) { Out("{\"t\":\"error\",\"msg\":\"No hay micrófono: " + Esc(e.Message) + "\"}"); return; }

    var gb = new GrammarBuilder();
    gb.Culture = info.Culture;
    if (mode == "wake" && wake.Length > 0) gb.Append(wake);
    gb.Append(new Choices(phrases));
    eng.LoadGrammar(new Grammar(gb));
    eng.SpeechRecognized += (s, e) => Out("{\"t\":\"rec\",\"text\":\"" + Esc(e.Result.Text) + "\",\"conf\":" + e.Result.Confidence.ToString("0.000", CultureInfo.InvariantCulture) + "}");
    eng.SpeechRecognitionRejected += (s, e) => Out("{\"t\":\"rej\"}");

    if (!string.IsNullOrEmpty(wave)) {
      // Modo de prueba: reconoce un archivo WAV completo y termina.
      var done = new System.Threading.ManualResetEvent(false);
      eng.RecognizeCompleted += (s, e) => { if (e.InputStreamEnded) done.Set(); };
      eng.RecognizeAsync(RecognizeMode.Multiple);
      done.WaitOne(30000);
      return;
    }
    bool listening = false;
    Out("{\"t\":\"ready\",\"culture\":\"" + info.Culture.Name + "\",\"mode\":\"" + Esc(mode) + "\",\"phrases\":" + phrases.Length + "}");
    if (mode == "wake") { eng.RecognizeAsync(RecognizeMode.Multiple); listening = true; }

    string line;
    while ((line = Console.In.ReadLine()) != null) {
      line = line.Trim();
      if (line == "quit") break;
      if (mode != "ptt") continue;
      if (line == "on" && !listening) { eng.RecognizeAsync(RecognizeMode.Multiple); listening = true; }
      else if (line == "off" && listening) { eng.RecognizeAsyncStop(); listening = false; }
    }
    try { eng.RecognizeAsyncCancel(); } catch { }
  }
}
'@

try {
  [LfkbVoice]::Run($Config, $Wave)
} catch {
  $msg = $_.Exception.Message -replace '"', "'"
  [Console]::Out.WriteLine('{"t":"error","msg":"' + $msg + '"}')
}
