// Catálogo de temas (la apariencia está en css/themes.css). Cada uno va seguido de su variante «· Noche»:
// la luna del kneeboard cambia entre los dos.
export const THEMES = [
  { id: 'tablet', name: 'Tablet táctica', desc: 'Bisel de aluminio oscuro y pantalla de cristal. Limpio y legible de día y de noche.', sw: ['#0c0e11', '#19283a', '#38bdf8'] },
  { id: 'tablet-noche', name: 'Tablet táctica · Noche', desc: 'La misma tableta con la pantalla casi negra y el texto atenuado.', sw: ['#060708', '#06090d', '#2c8fbd'] },
  { id: 'libreta', name: 'Libreta de vuelo', desc: 'Cuaderno de espiral con papel rayado, margen rojo, letra a mano y subrayador amarillo.', sw: ['#fdfaf0', '#1e3a8a', '#dc2626'] },
  { id: 'libreta-noche', name: 'Libreta de vuelo · Noche', desc: 'Cuaderno de hojas negras, rayado azul tenue y tinta clara.', sw: ['#15171c', '#d3d9e6', '#e05252'] },
  { id: 'portapapeles', name: 'Portapapeles', desc: 'Tablero de madera prensada con pinza metálica y folios limpios.', sw: ['#7c5431', '#fdfdfb', '#1d4ed8'] },
  { id: 'portapapeles-noche', name: 'Portapapeles · Noche', desc: 'Madera de nogal oscura y folios grafito.', sw: ['#3a2715', '#1e2024', '#6d8ef0'] },
  { id: 'tactico', name: 'Kneeboard táctico', desc: 'Nailon verde oliva con velcro, costuras y ficha plastificada con brillo.', sw: ['#434a27', '#efece0', '#b45309'] },
  { id: 'tactico-noche', name: 'Kneeboard táctico · Noche', desc: 'Nailon casi negro, ficha oscura y texto color arena.', sw: ['#222616', '#1c1f15', '#c2741f'] },
  { id: 'mfd', name: 'MFD', desc: 'Pantalla multifunción de fósforo verde con botones OSB y líneas de barrido.', sw: ['#18191b', '#04210f', '#45ff92'] },
  { id: 'mfd-noche', name: 'MFD · Noche', desc: 'El fósforo verde con el brillo bajado, como el MFD de noche.', sw: ['#0d0e0f', '#021309', '#2fb366'] },
  { id: 'dossier', name: 'Dossier', desc: 'Carpeta de cartulina, máquina de escribir, clip y sello de CONFIDENCIAL.', sw: ['#d3ae6e', '#fbf6ea', '#9f1c1c'] },
  { id: 'dossier-noche', name: 'Dossier · Noche', desc: 'Carpeta de cuero oscuro, papel sepia oscuro y tinta clara.', sw: ['#3a2d19', '#1d1913', '#c0453a'] },
  { id: 'noche', name: 'Noche (rojo)', desc: 'Rojo tenue sobre negro para vuelos nocturnos: no deslumbra ni rompe la adaptación a la oscuridad.', sw: ['#050505', '#000000', '#c42020'] },
];
