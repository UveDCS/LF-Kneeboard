# LF Kneeboard

Kneeboard para **DCS World**, en **VR** y en el monitor. Además de enseñar tus PDF e imágenes, lee la misión y te da el plan de vuelo, las radios, el apoyo y un bloc con coordenadas. También comparte páginas, puntos y dibujos con el resto del vuelo.

Hecho por y para **La Fundación**.

## Instalación

1. Descarga `LF Kneeboard Setup x.y.z.exe` de la página de *Releases* y ejecútalo. No necesita permisos de administrador.
2. Al abrirlo por primera vez sale **Bienvenida**. Pulsa **Instalar y empezar**, que hace dos cosas:
   - Copia un script en `Saved Games\DCS\Scripts\Hooks\`. **No toca tu `Export.lua`**, así que convive con DCS-BIOS, Tacview, SRS, DKS u OpenKneeboard.
   - Registra la capa OpenXR para tu usuario de Windows, para que el kneeboard se vea en el visor.
3. Entra en una misión. El kneeboard se rellena solo.

**Si no lo ves en el visor**: mira **Ajustes › Realidad virtual**. Cuando el visor no está activo, dice qué pasó la última vez que DCS arrancó en VR (si cargó la capa, si conectó con el kneeboard y, si no, por qué), con un botón para ver el registro. DCS tiene que arrancar en VR por OpenXR (no forzado a SteamVR/OpenVR) y hay que reiniciarlo después de registrar la capa.

**Iniciar con Windows** (Ajustes › Aspecto): se abre oculto al encender el PC, listo para sacarlo con tu tecla.

Para desinstalar, usa *Agregar o quitar programas*. Quita también el script de DCS y el registro de OpenXR.

**Actualizaciones**: el programa busca versiones nuevas en *Releases* al arrancar y cada 6 horas. Si hay una, nada más arrancar sale un aviso con las novedades y el botón *Actualizar ahora* (con DCS abierto avisa con una notificación y enseña la ventana al cerrarlo). Las descarga en segundo plano y, si no actualizas en ese momento, las instala al cerrarlo, sin tocar tus ajustes ni lo instalado en DCS. Se puede desactivar en **Ajustes > Actualizar y perfil**.

**Tu perfil en otro PC**: en **Ajustes > Actualizar y perfil**, *Exportar perfil* guarda en un `.zip` tus pestañas, controles, temas, ajustes de VR, marcadores, nombres de puntos, presets, tarjetas, bloc y libro de vuelo. *Importar perfil* lo carga en otro PC o en el de otro piloto.

## Qué hace

### Lo básico (como OpenKneeboard)
- **VR** con cualquier visor OpenXR y **escritorio** como ventana superpuesta encima de DCS.
- Pestañas de **PDF**, **carpeta de imágenes y PDF** (las páginas de los PDF van seguidas de las imágenes, sin saltos; la carpeta se cambia desde el propio kneeboard, también en VR), **kneeboard de DCS** (las imágenes del `.miz` y de `Saved Games\DCS\Kneeboard\<avión>`), **web o archivo local** y **captura de una ventana** (SRS, Discord…).
- La pestaña web admite una dirección `https://…` o la ruta de un archivo de tu PC (`C:\…\guia.html`). Los enlaces relativos de esa página funcionan. La dirección se **escribe en la propia pestaña** (Intro para abrirla; se queda guardada) y el botón de la carpeta **abre un archivo del PC**: los PDF con el visor de la app (páginas con el HOTAS y marcadores), y HTML, imágenes y texto en la pestaña.
- **Lápiz** sobre cualquier página, con la presión de tu tableta.
- **Tableta gráfica como en OpenKneeboard** (Wacom, Huion, Gaomon…): toda la superficie de la tableta es el kneeboard, con un **cursor que se ve también en el visor** cuando acercas el lápiz. Apoyarlo escribe o pulsa, el botón del lápiz borra, y los botones de la tableta se asignan como los de un mando. No le quita el foco a DCS y funciona aunque la ventana del kneeboard esté oculta. Usa el mismo camino que OpenKneeboard: **OpenTabletDriver con el plugin OTD-IPC** (o **wintab-adapter** si usas el driver del fabricante). Solo un programa a la vez puede leer la tableta. Orientación y kneeboard que controla, en Ajustes › Controles.
- **Dos kneeboards** a la vez, cada uno con su pestaña.
- **Ampliar al mirarlo** en VR, con opacidad distinta mientras lo miras.
- **Controles personalizables**: teclado y botones o setas de cualquier mando DirectInput. Admiten varias asignaciones por acción y combinaciones con modificador. Funcionan aunque DCS tenga el foco.

### Marcadores y navegación
- **Marcadores con tipo** (Tierra, Rodaje, Salida, En ruta, Misión, Aproximación, Emergencias, General) en las páginas de Misión, Biblioteca, Carpeta y PDF. **Cada avión tiene los suyos**: marcar o quitar una página en el F-16 no cambia los del F/A-18. Se guardan aunque cierres el programa o DCS.
- Con el modo **AUTO** activado, al empezar cada fase del vuelo el kneeboard abre **tu** marcador de esa fase. El programa no decide por ti qué página corresponde a cada fase.
- **Añadir a Misión sin marcador**: en el menú del marcador, «Añadir a la pestaña Misión» la pone en Misión sin que el modo AUTO ni la lista de marcadores la usen. También va por avión. En el **índice del Piernógrafo** cada miniatura tiene un «+» para añadirla con un clic (y cada juego, un botón para añadirlo entero); en el **índice de Misión**, una «×» para quitarla (se puede deshacer tocándola otra vez). Misión enseña todas sus páginas en el orden normal del Piernógrafo, agrupadas por juego.
- **Ir a una página escribiendo su número**: pulsa el contador «3/77» o teclea el número directamente.
- **Índice del Piernógrafo**: miniaturas de todas las páginas agrupadas por juego, con saltos directos a cada juego. Con el HOTAS, la acción «Índice de páginas» lo abre y «Página siguiente / anterior» salta de juego mientras está abierto. También hay acciones «Juego siguiente / anterior» y la orden de voz «índice».
- **Pestañas favoritas**: la barra de abajo enseña solo las que marques con la estrella. Las demás están en la cuadrícula (botón de la izquierda de la barra). La barra se desplaza con la rueda o arrastrándola. Pestaña siguiente/anterior del HOTAS recorre solo las favoritas.
- **Ordenar las pestañas arrastrándolas** por su asa (⠿) en Ajustes › Pestañas.
- **Presets de pestañas**: guarda tus pestañas tal como están (cuáles, orden, nombres, fijas y ajustes) con un nombre y cambia de uno a otro desde Ajustes > Pestañas, desde la cuadrícula del kneeboard o con la acción «Preset de pestañas siguiente».
- **Plantillas por tipo de vuelo** en Ajustes > Pestañas: Sencillo (la de fábrica: solo el Piernógrafo y el Bloc fijos en la barra), Completa, Caza, Ataque, Helicóptero y Entrenamiento. Todas traen todos los tipos de pestaña (las que no son de la plantilla van en la cuadrícula, sin fijar) y conservan los nombres y ajustes de tus pestañas, y tus PDF y webs.
- **Tamaño en 2D**: textos y botones (Ctrl + rueda) y alto de la ventana, en Ajustes > Aspecto, o arrastrando la esquina.
- **Cruz del centro** para capturar coordenadas del F10. Se centra en la ventana de DCS y en VR va fija en el centro de la vista. Puede salir automática (con el F10 abierto o en la página Coordenadas), siempre o nunca.

### Tu bando y el avión real
- Solo se ven las unidades, el apoyo, los aeródromos y las frecuencias de **tu bando** (y los aeródromos neutrales).
- **Plan de vuelo**: el siguiente punto sigue el **número de waypoint**. Avanza al pasar a menos de 1 nm del punto, o al rebasarlo. Si DCS da el steerpoint activo del avión, manda ese. Hay acciones de «Waypoint siguiente / anterior».
- **Ruta y radios se sincronizan con el DTC**: si cargas o cambias un DTC (DKS, el editor de DTC…), se actualizan solas. En vuelo, si DCS da la ruta del avión, se usa esa. Los waypoints y los presets se pueden **renombrar**, y los presets también **editar** si los cambias en cabina.

### DTC (F-16C, F/A-18C, F-14)
- **Importar un DTC** desde la pestaña DTC o Ajustes > Misión: se copia a `Saved Games\DCS\DTC\<avión>` para cargarlo también en cabina. Lo último que hagas manda: un DTC que guardes o cargues en DCS durante la misión (aparece en su carpeta de Saved Games) pasa delante de lo anterior. Si no, por este orden: lo que tengas en el **editor de DTC del juego** (botón DTC del briefing o de la elección de plaza; se lee al cerrarlo, aunque no lo guardes), el elegido o importado en el kneeboard, el que la misión lleva dentro del `.miz` para tu plaza, el de una carpeta `DTC` junto al `.miz`, y el de DKS (`*_OB.dtc`). Si no hay ningún DTC en uso, radios y ruta salen de la misión (otros DTC que tengas guardados no se usan solos).
- **«Do not upload tab data»**: las secciones que marques así en el editor de DTC (radios COMM 1/2, waypoints, amenazas, líneas…) no se cargan en el avión, y el kneeboard tampoco las usa: se queda lo de la misión. La revisión del DTC dice cuáles son.
- **Elegir el origen a mano**: en el Plan de vuelo, «Ruta: Auto · Misión · DTC · F10» (el mapa y la tarjeta usan la misma); en Radios, «Origen: Auto · Misión · DTC». En automático, las radios que el DTC no trae o no carga salen de la misión.
- **Pestaña DTC**: revisión antes de despegar (otro avión u otro mapa, horas que no cuadran con la misión, radios distintas, secciones vacías), rutas con sus horas, navegación (TACAN, ICLS, WP de casa y A/A), **contramedidas** (programas, bingo y programa automático por amenaza), **amenazas** (MEZ, prioridades del RWR, clases del HARM) y **armamento** (JDAM por estación, VIP/VRP).
- **Plan de vuelo**: ruta del DTC con sus horas. Si haces una ruta con la **herramienta de ruta del F10** («Show Route Tool») y la activas, el plan usa esa (con sus nombres, altitudes y horas); entre ella y cualquier DTC (el del editor, uno guardado o cargado en DCS o uno elegido en el kneeboard) manda lo último que hayas tocado. Lo que cambies a mano en cabina solo llega si DCS da la ruta del avión (Ajustes > Integración DCS dice qué da tu avión). La herramienta de ruta y el editor de DTC viven en el Lua de la interfaz de DCS, que el script de `Scripts\Hooks` no ve: los lee un mod mínimo, `Saved Games\DCS\Mods\Services\LFKneeboard`, que se instala y se quita junto con el script (sale como «LF Kneeboard» en Opciones > Especial, sin nada que ajustar). En los puntos con hora fija dice si llegas pronto o tarde y a qué velocidad sobre el suelo ir para llegar justo; los puntos de objetivo salen marcados.
- **Mapa**: FLOT, FAOR, corredores, líneas geográficas, hipódromos de CAP y burbujas de amenaza (botón para ocultarlas).
- **Tarjeta**: contramedidas, objetivos de JDAM y TOT del objetivo.
- **Enviar el DTC al vuelo**: llega comprimido a «Compartido» y cada piloto decide si lo usa.

### Páginas que se generan con la misión
- **Plan de vuelo**: rumbos magnéticos, distancias, tiempos, ETA y combustible estimado. En vuelo marca el siguiente punto con rumbo, distancia y tiempo.
- **Radios**: los presets de la misión o de tu archivo **DTC**, con cada frecuencia identificada (intravuelo, AWACS, torre…). Incluye también las frecuencias útiles.
- **Apoyo**: AWACS, tanqueros, barcos (TACAN, ICLS, Link 4) y JTAC. El bullseye muestra tu posición respecto a él.
- **Tiempos**: hora de la misión, cronómetro, cuenta atrás al *push*, y bingo y joker según la distancia a casa.
- **Mensajes**: radio, avisos de la misión y chat. Eliges cuánto tiempo se ven (toda la sesión, 60, 30, 15 o 5 minutos) y los vacías con un botón.

### Bloc y coordenadas (como DCS Scratchpad)
- Plantillas: notas libres, **9-line**, **check-in JTAC**, **autorización ATC**, **repostaje** y **BDA**.
- **A mano**: con el botón «A mano», cada campo de la plantilla se rellena escribiendo con el lápiz de una tableta (con presión), el ratón o el dedo. Se guarda por campo, la goma del lápiz borra y lo escrito con el teclado se sigue viendo debajo.
- **Captura de coordenadas del centro del mapa F10** con una tecla o botón. En el monitor sale una cruz que marca el punto.
- **Clic en el Mapa** para pasar un punto al bloc.
- Cada punto sale en los formatos de tu avión (DDM o DMS con la precisión de su cabina, MGRS) y con su elevación. Si estabas rellenando un campo de ubicación (por ejemplo, la línea 6 del 9-line), se completa solo.

### Mapa
- Satélite, topográfico u oscuro. Las capas necesitan internet; sin conexión se sigue viendo la ruta.
- Muestra la ruta con los nombres que hayas puesto a los puntos, el bullseye con sus anillos, el apoyo, los aeródromos con su nombre (los de tu bando en azul) y tu avión en directo.
- Una **línea hasta el siguiente punto** del plan de vuelo, con su rumbo magnético y su distancia.
- **Lápiz** sobre el mapa, compartible con el vuelo. Cada piloto dibuja con su color, y una leyenda dice quién ha dibujado qué. Tu color se cambia con el botón redondo.

### Modo automático (opcional)
- Botón **AUTO** en el propio kneeboard, o la acción asignada. Cambia de pestaña según la fase del vuelo: en tierra, rodaje, despegue, en ruta, zona del objetivo y aproximación.
- Primero usa tus marcadores de cada fase. En **Ajustes > Pestañas**, con *Opciones avanzadas*, también puedes asignar pestañas enteras a una fase. Si cambias de página a mano, espera un rato antes de volver a moverse solo.

### Vuelo compartido
- **Enviar una página** al vuelo (botón 📤 o una tecla), notas, plantillas y puntos.
- **Pizarra en directo** y **dibujos sobre el mapa** que ven todos, cada uno en su propio mapa.
- Lo que **tú** envías (páginas, notas, puntos y DTC) también queda en tu «Compartido», marcado como «enviado», para tenerlo a mano. El aviso de cosas nuevas solo cuenta lo que te mandan los demás.
- Un piloto hace de anfitrión, o usáis un servidor de salas (ver abajo).

### Biblioteca de páginas (compatible con KneeboardManager)
- Usa el mismo formato que KneeboardManager: una carpeta por juego, con su `kneeboard.json`. Si ya tienes una biblioteca, la encuentra sola.
- En cada juego eliges para qué aviones es, desactivas páginas y las reordenas arrastrándolas. Se pueden importar imágenes o **convertir un PDF en páginas**.
- **Aplicar al kneeboard de DCS**: copia las páginas activas a `Saved Games\DCS\Kneeboard\<avión>`, numeradas para que salgan en orden. Al quitarlas se borran solo las suyas (`LFK …`), nunca las de DKS ni las tuyas.
- **Meter en un .miz**: añade las páginas a la misión, por avión o para todos, y guarda antes una copia de seguridad.
- La pestaña **Biblioteca** muestra en el kneeboard los juegos del avión que vuelas.

### Tarjeta de vuelo y nav log (como CombatFlite)
- Se generan con la misión. La tarjeta lleva el vuelo (indicativos, números de cola, códigos láser y STN), las comunicaciones, el cargamento con los nombres de las armas, el combustible, bingo y joker, y los aeródromos. El nav log lleva rumbos, distancias acumuladas, ETE, ETA y combustible.
- Tiene campos editables (paquete, código de abortar, TOT, notas por punto) que se guardan por misión.
- **Guardar en la biblioteca**: convierte las dos páginas en imágenes, listas para llevarlas a DCS o al `.miz`.

### Lección del curso de DKS
- Carga el curso en el formato de DKS (fases → módulos → lecciones). Si el nombre de la misión lleva el código de la lección (por ejemplo, «TIE-1»), la lección se abre sola.
- Muestra el perfil, los objetivos con su nivel (I/P/D), las tareas para marcar en vuelo y las notas, con sus tablas.
- Incluye la **hoja de evaluación** con la escala del curso, que se puede enviar al instructor por la sala.
- Si existe un DTC de DKS (`*_OB.dtc`) para tu avión, las radios lo usan automáticamente.

### Como un EFB (ForeFlight)
- **Carta georreferenciada**: una imagen o la página de un PDF calibrada con dos o más puntos conocidos (aeródromos, waypoints o coordenadas escritas). Encima se dibujan tu avión con su rumbo y la ruta. Tiene zoom y modo seguir.
- **Tiempos de bloque automáticos** (calzos fuera, despegue, aterrizaje, calzos dentro) y un **libro de vuelo** con las horas por avión, exportable a CSV.

### Órdenes de voz (como VoiceAttack)
- Funcionan sin conexión, con el reconocedor de voz en español de Windows. Hay dos modos: **mantener un botón** o decir una **palabra de activación** (por defecto «piernógrafo»).
- Ejemplos: «radios», «plan de vuelo», «página siguiente», «página tres», «marca punto», «oculta», «modo noche»…

### Temas
Tablet táctica · Libreta de vuelo · Portapapeles · Kneeboard táctico · MFD de fósforo verde · Dossier · Noche (rojo). Cada uno, salvo el rojo, tiene su **variante Noche** (el mismo kneeboard en oscuro y con poco brillo): la luna de la barra, o `AltGr + N`, cambia entre el tema y su variante.

## Controles por defecto

| Acción | Tecla |
|---|---|
| Mostrar / ocultar | `AltGr + K` |
| Página siguiente / anterior | `AltGr + Av Pág` / `AltGr + Re Pág` |
| Pestaña siguiente / anterior | `AltGr + Fin` / `AltGr + Inicio` |
| Capturar coordenadas del F10 | `AltGr + M` |
| Modo automático | `AltGr + A` |
| Modo escritura (el teclado escribe en el kneeboard) | `AltGr + W` |
| Recentrar VR | `AltGr + R` |
| Zoom fijo VR | `AltGr + Z` |
| Modo noche | `AltGr + N` |
| Enviar página al vuelo | `AltGr + S` |
| Cronómetro | `AltGr + T` |

Todo se cambia en **Ajustes > Controles**.

## Servidor de salas (opcional)

Para que el escuadrón tenga una sala siempre disponible (por ejemplo, junto al servidor de DCS):

```bash
cd relay
npm install ws
node relay.js 7790
```

Los pilotos ponen `ws://IP_DEL_SERVIDOR:7790` en **Ajustes > Vuelo compartido**. Si no hay servidor, un piloto marca *Soy el anfitrión* y los demás se conectan a su IP. Para eso hace falta estar en la misma red, en una VPN tipo Radmin, Tailscale o ZeroTier, o tener abierto el puerto 7790 TCP.

## Para desarrolladores

```bash
npm install
npm start            # ejecutar en desarrollo
npm test             # geodesia, .miz, controles, sala compartida, biblioteca, secuencia de waypoints, plantillas, presets, perfil y DTC
npm run test:voz     # órdenes de voz con la voz española de Windows (sin micrófono)
npm run test:hook -- ruta\mision.miz   # el hook de DCS con Lua 5.1 y un DCS simulado
npm run test:tableta # el lector de tabletas contra un servidor OTD-IPC falso (native/test/otdipc_server.c)
npm run test:vr      # permisos de la memoria compartida con la capa VR
npm run test:paquete # tras compilar el instalador: koffi y el puente VR funcionan dentro del app.asar
npm run native       # compila la capa OpenXR y el lector de mandos (pip install ziglang)
npm run dist         # genera el instalador en dist/ (sin publicar)
npm run release      # genera el instalador y lo publica en GitHub Releases (necesita GH_TOKEN)
```

Publicar una versión: sube `version` en `package.json` y ejecuta `npm run release` con la variable `GH_TOKEN`, que debe ser un token de GitHub con permiso sobre el repositorio `UveDCS/LF-Kneeboard`. electron-builder crea un borrador de *release* con el instalador y `latest.yml`. Al publicar ese borrador, los programas instalados lo descargan solos. El repositorio tiene que ser público.

Estructura:

- `src/main/`: proceso principal. Configuración, enlace UDP con DCS, lector de `.miz`, fases de vuelo, controles, puente VR (memoria compartida) y sala compartida.
- `src/renderer/`: kneeboard y ajustes (HTML/CSS/JS sin framework). Cada tipo de pestaña está en `js/tabs/`.
- `native/openxr-layer/`: capa implícita OpenXR (C++/D3D11). `native/test/layer_test.cpp` la prueba sin visor, con un runtime simulado.
- `native/input-helper/`: lector DirectInput y teclado en segundo plano (C), y tabletas gráficas por OTD-IPC (`tablet.c`).
- `dcs-scripts/Hooks/`: el script que se instala en DCS.
- `relay/`: servidor de salas.
- `data/airports.json`: aeródromos, frecuencias, TACAN y pistas de cada mapa (`npm run airports`, a partir de pydcs).

## Créditos

Leaflet (BSD-2) · pdf.js (Apache-2.0) · ws (MIT) · koffi (MIT) · fuentes Inter, JetBrains Mono, Caveat, Patrick Hand, Share Tech Mono y Special Elite (SIL OFL / Apache) · datos de mapas de pydcs (LGPL-3.0) · cabeceras OpenXR de Khronos (Apache-2.0) · teselas © Esri/Maxar, © OpenStreetMap, OpenTopoMap, © CARTO.

## Licencia

MIT
