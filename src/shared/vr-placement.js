// Colocación del kneeboard en VR: los ejes que se ajustan desde el propio kneeboard (y desde Ajustes),
// sus pasos, topes y textos, y lo que se manda a la capa OpenXR.
// Se usa tanto en el proceso principal (Node) como en las páginas (navegador).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VrPlacement = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Valores en la unidad que ve el piloto (cm o grados). En la configuración, pos y width van en metros;
  // pos[2] es negativo (delante de la cabeza). rot = [guiñada, inclinación, alabeo], como en la capa:
  // guiñada positiva gira la cara a la derecha, inclinación negativa la levanta, alabeo positivo es antihorario.
  const side = (neg, pos, zero) => (v) => (v > 0 ? pos : v < 0 ? neg : zero);
  const AXES = [
    { id: 'lado', group: 'mover', label: 'Lado', unit: 'cm', min: -60, max: 60, step: 1,
      get: (vr) => vr.pos[0] * 100, set: (vr, v) => { vr.pos[0] = v / 100; }, hint: side('a la izquierda', 'a la derecha', 'centrado') },
    { id: 'altura', group: 'mover', label: 'Altura', unit: 'cm', min: -80, max: 40, step: 1,
      get: (vr) => vr.pos[1] * 100, set: (vr, v) => { vr.pos[1] = v / 100; }, hint: side('por debajo', 'por encima', 'a la altura de los ojos') },
    { id: 'distancia', group: 'mover', label: 'Distancia', unit: 'cm', min: 15, max: 120, step: 1,
      get: (vr) => -vr.pos[2] * 100, set: (vr, v) => { vr.pos[2] = -v / 100; }, hint: () => '' },
    { id: 'giro', group: 'girar', label: 'Giro', unit: '°', min: -90, max: 90, step: 1,
      get: (vr) => vr.rot[0], set: (vr, v) => { vr.rot[0] = v; }, hint: side('hacia la izquierda', 'hacia la derecha', 'de frente') },
    { id: 'inclinacion', group: 'girar', label: 'Inclinación', unit: '°', min: -90, max: 30, step: 1,
      get: (vr) => vr.rot[1], set: (vr, v) => { vr.rot[1] = v; }, hint: side('hacia arriba', 'hacia abajo', 'vertical') },
    { id: 'alabeo', group: 'girar', label: 'Alabeo', unit: '°', min: -45, max: 45, step: 1,
      get: (vr) => vr.rot[2], set: (vr, v) => { vr.rot[2] = v; }, hint: side('horario', 'antihorario', 'recto') },
    { id: 'ancho', group: 'tamano', label: 'Ancho', unit: 'cm', min: 10, max: 60, step: 0.5,
      get: (vr) => vr.width * 100, set: (vr, v) => { vr.width = v / 100; }, hint: () => '' },
  ];
  const GROUPS = [
    { id: 'mover', label: 'Mover' },
    { id: 'girar', label: 'Girar' },
    { id: 'tamano', label: 'Tamaño' },
  ];

  const axis = (id) => {
    const a = AXES.find((x) => x.id === id);
    if (!a) throw new Error(`Eje desconocido: ${id}`);
    return a;
  };
  // Medio centímetro o medio grado es lo más fino que se usa: redondear quita los restos de coma flotante.
  const round = (v) => Math.round(v * 2) / 2 || 0;
  const copy = (vr) => ({ ...vr, pos: [...vr.pos], rot: [...vr.rot] });
  const limits = (a, v) => ({ atMin: v <= a.min, atMax: v >= a.max });

  function value(vr, id) {
    return round(axis(id).get(vr));
  }

  // dir: -1 o +1. mult: pasos de golpe (al mantener pulsado). Devuelve una copia, sin tocar la de partida.
  function step(vr, id, dir, mult = 1) {
    const a = axis(id);
    const v = Math.min(a.max, Math.max(a.min, round(a.get(vr) + dir * a.step * mult)));
    const out = copy(vr);
    a.set(out, v);
    return { vr: out, value: v, ...limits(a, v) };
  }

  function describe(vr, id) {
    const a = axis(id);
    const v = value(vr, id);
    const { atMin, atMax } = limits(a, v);
    const n = String(Math.abs(v)).replace('.', ',');
    let hint = a.hint(v);
    if (atMin || atMax) hint = hint ? `máx. ${hint}` : atMin ? 'mínimo' : 'máximo';
    return { value: a.unit === '°' ? `${n}°` : `${n} cm`, hint };
  }

  // Mantener pulsado: un paso cada vez y, pasado un segundo y medio, de cinco en cinco.
  const HOLD = { delay: 400, interval: 125, fastAfter: 1500, fast: 5 };
  const holdMultiplier = (ms) => (ms >= HOLD.fastAfter ? HOLD.fast : 1);

  // Lo que se escribe en la memoria compartida para la capa VR. override: la posición mientras la estás
  // colocando (aún sin guardar). placing: con el panel abierto, «Ampliar al mirarlo» queda en pausa.
  function placementFor(c, i, { forcedZoom = false, placing = false, override = null } = {}) {
    const v = override || c.views[i].vr;
    return {
      visible: !!(c.vr.enabled && !c.hidden && (i === 0 || c.dual)),
      pos: v.pos,
      rot: v.rot,
      width: forcedZoom ? v.width * c.vr.zoomScale : v.width,
      zoomScale: c.vr.zoomScale,
      gazeZoom: !!(c.vr.gazeZoom && !forcedZoom && !placing),
    };
  }

  return { AXES, GROUPS, HOLD, value, step, describe, holdMultiplier, placementFor };
});
