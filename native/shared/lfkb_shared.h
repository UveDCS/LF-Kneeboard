// Memoria compartida entre la aplicación (escribe páginas) y la capa OpenXR (las pinta en el visor).
// Debe coincidir con src/main/vr.js.
#pragma once
#include <stdint.h>

#define LFKB_SHM_NAME L"Local\\LFKneeboard.Frames.v1"
#define LFKB_MAGIC 0x42464B4Cu /* 'LFKB' */
#define LFKB_VERSION 1u
#define LFKB_MAX_VIEWS 2u
#define LFKB_MAX_W 1600u
#define LFKB_MAX_H 2400u
#define LFKB_HEADER_BYTES 4096u
#define LFKB_SLOT_BYTES (LFKB_MAX_W * LFKB_MAX_H * 4u)
#define LFKB_TOTAL_BYTES (LFKB_HEADER_BYTES + LFKB_MAX_VIEWS * 2u * LFKB_SLOT_BYTES)

#pragma pack(push, 4)
typedef struct LfkbView {
  uint32_t seq;        // +0  se incrementa tras escribir un fotograma completo
  uint32_t front;      // +4  ranura (0/1) con el último fotograma completo
  uint32_t width;      // +8
  uint32_t height;     // +12
  uint32_t visible;    // +16
  float pos[3];        // +20 posición en metros respecto al origen (espacio LOCAL)
  float rotDeg[3];     // +32 guiñada, cabeceo, alabeo
  float widthM;        // +44 ancho físico del kneeboard
  float zoomScale;     // +48 escala al mirarlo
  uint32_t gazeZoom;   // +52 0/1
  uint32_t gazed;      // +56 lo escribe la capa: 1 si el piloto lo está mirando
  uint32_t reserved[17];
} LfkbView;            // 128 bytes

typedef struct LfkbHeader {
  uint32_t magic;       // +0
  uint32_t version;     // +4
  uint32_t viewCount;   // +8
  uint32_t heartbeat;   // +12 la app lo incrementa cada 250 ms
  uint32_t recenterSeq; // +16
  uint32_t layerAlive;  // +20 lo incrementa la capa en cada fotograma de VR
  uint32_t reticle;     // +24 1 = pintar una cruz en el centro de la vista (punto que se captura del F10)
  uint32_t reserved[9];
  LfkbView views[LFKB_MAX_VIEWS]; // +64
} LfkbHeader;
#pragma pack(pop)

static inline uint8_t* lfkbSlot(void* base, uint32_t view, uint32_t slot) {
  return (uint8_t*)base + LFKB_HEADER_BYTES + (size_t)(view * 2u + slot) * LFKB_SLOT_BYTES;
}
