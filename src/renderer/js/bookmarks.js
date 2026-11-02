// Tipos de marcador. El id coincide con la fase de vuelo: el modo automático va al marcador de cada fase,
// y la pestaña Misión ordena las páginas marcadas en este orden.
export const BOOKMARK_TYPES = [
  { id: 'ground', label: 'Tierra', short: 'TIE' },
  { id: 'taxi', label: 'Rodaje', short: 'ROD' },
  { id: 'takeoff', label: 'Salida', short: 'SAL' },
  { id: 'enroute', label: 'En ruta', short: 'RUT' },
  { id: 'target', label: 'Misión', short: 'MIS' },
  { id: 'approach', label: 'Aproximación', short: 'APP' },
  { id: 'emergency', label: 'Emergencias', short: 'EMG' },
  { id: 'general', label: 'General', short: 'GEN' },
];

export const bmType = (id) => BOOKMARK_TYPES.find((t) => t.id === id) || BOOKMARK_TYPES[BOOKMARK_TYPES.length - 1];
export const bmOrder = (id) => {
  const i = BOOKMARK_TYPES.findIndex((t) => t.id === id);
  return i < 0 ? BOOKMARK_TYPES.length : i;
};
