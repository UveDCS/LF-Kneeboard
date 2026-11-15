// Posición de un elemento de apoyo (tanquero, AWACS, barco...), en este orden:
//   1. en directo, si DCS la da (live.support, mismo orden que mission.support);
//   2. la de la misión, si no es una plantilla con activación retrasada;
//   3. ninguna: una plantilla que copia un script (Foothold, MOOSE...) no vuela donde está en la misión.
export function supportPos(mission, live, i) {
  const s = mission && mission.support && mission.support[i];
  if (!s) return null;
  const lv = live && Array.isArray(live.support) ? live.support[i] : null;
  if (lv && lv.lat != null) return { lat: lv.lat, lon: lv.lon, altFt: lv.altFt != null ? lv.altFt : s.altFt, src: 'live' };
  if (s.late || s.lat == null) return null;
  return { lat: s.lat, lon: s.lon, altFt: s.altFt, src: 'mission' };
}

// Texto corto de dónde sale la posición.
export function supportPosNote(s, pos) {
  if (pos && pos.src === 'live') return 'en directo';
  if (!pos && s && s.late) return 'lo crea un script';
  return null;
}
