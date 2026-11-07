// Teclas asignadas a acciones (Ajustes › Controles) frente al teclado propio de la ventana del kneeboard.
// Las asignaciones las atiende el lector de mandos (lfkb-input.exe) aunque el kneeboard tenga el foco. Si la
// ventana usara también esa tecla (AvPág, RePág, flechas, números, Esc), cada pulsación contaría dos veces.
// Se usa en la página (navegador) y en las pruebas (Node).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Hotkeys = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Modificadores (códigos virtuales de Windows) y cómo se ven en un KeyboardEvent. AltGr es Alt derecho (165):
  // con teclados como el español, Chromium no lo marca como Alt ni Ctrl sino con getModifierState('AltGraph').
  const altGraph = (ev) => !!(ev.altKey || (typeof ev.getModifierState === 'function' && ev.getModifierState('AltGraph')));
  const MODIFIER = {
    16: (ev) => ev.shiftKey, 160: (ev) => ev.shiftKey, 161: (ev) => ev.shiftKey,
    17: (ev) => ev.ctrlKey, 162: (ev) => ev.ctrlKey, 163: (ev) => ev.ctrlKey,
    18: (ev) => ev.altKey, 164: (ev) => ev.altKey, 165: altGraph,
  };

  // ¿Esta pulsación dispara alguna asignación de teclado? El lector de mandos dispara una combinación al
  // pulsar su última tecla con las demás pulsadas. Desde la página solo se sabe si los modificadores están
  // pulsados: una combinación con otra tecla normal o con un botón del mando se deja a la ventana.
  function handledByBinding(bindings, ev) {
    const code = `kbd:${ev.keyCode}`;
    for (const list of Object.values(bindings || {})) {
      for (const combo of list || []) {
        if (!combo.length || combo[combo.length - 1] !== code) continue;
        const rest = combo.slice(0, -1);
        if (rest.every((c) => {
          const m = /^kbd:(\d+)$/.exec(c);
          const held = m && MODIFIER[Number(m[1])];
          return !!(held && held(ev));
        })) return true;
      }
    }
    return false;
  }

  return { handledByBinding };
});
