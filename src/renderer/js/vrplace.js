// Panel «Posición en VR»: colocar el kneeboard en el visor desde el propio kneeboard, con el lápiz de la tableta
// o el ratón, sin quitarse el visor. Los ejes, pasos y topes son los de Ajustes > Realidad virtual
// (src/shared/vr-placement.js). Cada toque es un paso; manteniendo pulsado se repite y acelera.
// Mientras pulsas, la capa VR recibe la posición en vivo (kb.vrPreview); al soltar se guarda en la configuración.
import { icon } from './icons.js';
import { h, clear } from './util.js';

const VP = window.VrPlacement;

// Botón de cada sentido: [icono, texto para lectores de pantalla y para el título]. El primero resta, el segundo suma.
const BUTTONS = {
  lado: [['prev', 'Mover a la izquierda'], ['next', 'Mover a la derecha']],
  altura: [['down', 'Bajar'], ['up', 'Subir']],
  distancia: [['nearer', 'Acercar'], ['farther', 'Alejar']],
  giro: [['yawLeft', 'Girar a la izquierda'], ['yawRight', 'Girar a la derecha']],
  inclinacion: [['tiltUp', 'Inclinar hacia arriba'], ['tiltDown', 'Inclinar hacia abajo']],
  alabeo: [['rollCw', 'Alabear en sentido horario'], ['rollCcw', 'Alabear en sentido antihorario']],
  ancho: [['minus', 'Más estrecho'], ['plus', 'Más ancho']],
};
const SAVE_DELAY = 600;
const MAX_HOLD = 15000; // por si se pierde el «soltar»: nunca repite para siempre

const copyVr = (v) => ({ ...v, pos: [...v.pos], rot: [...v.rot] });

// Abre el panel dentro de `ov` (el #overlay del kneeboard). Devuelve { refresh(config), dispose() }.
export function openVrPlace({ kb, S, ov, onDone }) {
  const myVr = () => S.config.views[kb.view].vr;
  const start = copyVr(myVr()); // para «Como estaba»
  let cur = copyVr(start);
  let hold = null;
  let saveTimer = null;
  const rows = {};

  function save() {
    clearTimeout(saveTimer);
    saveTimer = null;
    const views = S.config.views.map((v, i) => (i === kb.view ? { ...v, vr: copyVr(cur) } : v));
    kb.patchConfig({ views });
  }
  const saveSoon = () => { clearTimeout(saveTimer); saveTimer = setTimeout(save, SAVE_DELAY); };

  function paint(id) {
    const r = rows[id];
    const a = VP.AXES.find((x) => x.id === id);
    const v = VP.value(cur, id);
    const d = VP.describe(cur, id);
    r.val.replaceChildren(d.value, h('small', d.hint));
    r.val.classList.toggle('limit', v <= a.min || v >= a.max);
    r.minus.disabled = v <= a.min;
    r.plus.disabled = v >= a.max;
  }
  const paintAll = () => VP.AXES.forEach((a) => paint(a.id));

  function apply(id, dir, mult) {
    const r = VP.step(cur, id, dir, mult);
    cur = r.vr;
    kb.vrPreview(cur);
    paint(id);
    if ((dir < 0 && r.atMin) || (dir > 0 && r.atMax)) stop();
  }

  function stop() {
    if (!hold) return;
    clearTimeout(hold.timer);
    clearTimeout(hold.safety);
    hold.btn.classList.remove('pressed');
    hold = null;
    save();
  }

  function press(e, btn, id, dir) {
    if (e.button > 0 || btn.disabled) return;
    e.preventDefault();
    e.stopPropagation();
    stop();
    const t0 = performance.now();
    btn.classList.add('pressed');
    hold = { btn, timer: null, safety: setTimeout(stop, MAX_HOLD) };
    apply(id, dir, 1);
    const repeat = () => {
      if (!hold) return;
      apply(id, dir, VP.holdMultiplier(performance.now() - t0));
      if (hold) hold.timer = setTimeout(repeat, VP.HOLD.interval);
    };
    if (hold) hold.timer = setTimeout(repeat, VP.HOLD.delay);
  }

  function stepButton(id, dir) {
    const [ico, label] = BUTTONS[id][dir < 0 ? 0 : 1];
    const btn = h('button.vp-st', { type: 'button', title: label, 'aria-label': label }, icon(ico));
    // Se actúa al apoyar el lápiz o pulsar el ratón, no al soltar: con el temblor de la mano el «clic» se pierde.
    btn.addEventListener('pointerdown', (e) => press(e, btn, id, dir));
    // Teclado (en el monitor): Intro o espacio dan un paso.
    btn.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      e.stopPropagation();
      apply(id, dir, 1);
      saveSoon();
    });
    return btn;
  }

  const body = h('div.ov-body.vp-body');
  for (const g of VP.GROUPS) {
    const grp = h(`div.vp-grp.${g.id}`, h('div.vp-grp-t', g.label));
    for (const a of VP.AXES.filter((x) => x.group === g.id)) {
      const minus = stepButton(a.id, -1);
      const plus = stepButton(a.id, +1);
      const val = h('div.vp-val', { 'aria-live': 'polite' });
      rows[a.id] = { minus, plus, val };
      grp.append(h('div.vp-row', h('span.vp-lb', a.label), minus, val, plus));
    }
    body.append(grp);
  }

  const foot = h('div.vp-foot');
  const paintFoot = () => foot.replaceChildren(icon('info'), S.vrActive
    ? 'Se guarda solo. Mantén pulsado para ir más rápido. «Ampliar al mirarlo» queda en pausa mientras colocas.'
    : 'El visor no está activo: verás los cambios al entrar en VR. Se guarda solo.');

  const undoBtn = h('button.btn.vp-act', {
    type: 'button',
    title: 'Volver a la posición que tenía al abrir este panel',
    onclick: () => { stop(); cur = copyVr(start); kb.vrPreview(cur); paintAll(); save(); },
  }, icon('undo'), 'Como estaba');
  const recenterBtn = h('button.btn.vp-act', {
    type: 'button',
    title: 'Toma la posición actual de tu cabeza como referencia',
    onclick: () => kb.recenter(),
  }, icon('bullseye'), 'Recentrar');
  const doneBtn = h('button.btn.primary.vp-act', { type: 'button', onclick: () => onDone() }, 'Listo');
  const title = h('b', 'Posición en VR', S.config.dual ? h('small', ` · Kneeboard ${kb.view + 1}`) : null);

  clear(ov).append(h('div.ov-panel', { role: 'dialog', 'aria-label': 'Posición en VR' },
    h('div.ov-head.vp-head', title, undoBtn, recenterBtn, doneBtn),
    body,
    foot));
  ov.classList.add('place');
  ov.hidden = false;
  paintAll();
  paintFoot();

  // Soltar en cualquier sitio (el lápiz suelta sobre el botón que pulsó; el ratón puede soltar fuera).
  const onUp = () => stop();
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  window.addEventListener('blur', onUp);
  kb.vrPlacing(true);

  return {
    // Configuración nueva (Ajustes, «Restablecer la posición en VR» o el otro kneeboard): se muestra salvo mientras pulsas.
    refresh() {
      paintFoot();
      if (hold || saveTimer) return;
      cur = copyVr(myVr());
      paintAll();
    },
    dispose() {
      stop();
      if (saveTimer) save();
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('blur', onUp);
      ov.classList.remove('place');
      kb.vrPlacing(false);
    },
  };
}
