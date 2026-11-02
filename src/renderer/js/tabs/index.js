// Registro de tipos de pestaña. La clave es el "type" guardado en la configuración.
import { folder, dcsKneeboard, library, pdf, web, windowCapture } from './docs.js';
import { cards } from './cards.js';
import { lesson } from './lesson.js';
import { chart } from './chart.js';
import { flightplan, radios, support, timers } from './mission.js';
import { notes } from './notes.js';
import { draw } from './draw.js';
import { map } from './map.js';
import { radiolog, shared } from './social.js';
import { dtc } from './dtc.js';

export const TAB_TYPES = {
  'dcs-kneeboard': dcsKneeboard,
  library,
  folder,
  pdf,
  web,
  window: windowCapture,
  cards,
  flightplan,
  radios,
  dtc,
  support,
  timers,
  notes,
  map,
  draw,
  radiolog,
  shared,
  lesson,
  chart,
};
