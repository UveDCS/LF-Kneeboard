// Servidor OTD-IPC de prueba (hace de OpenTabletDriver + plugin OTD-IPC) para probar LF Kneeboard sin tableta.
// Uso: otdipc_server.exe <segundos>   (con LOCALAPPDATA apuntando a una carpeta temporal)
// Publica el archivo de descubrimiento, espera al cliente, comprueba su Hello y manda una tableta de 152x95 mm
// con: lápiz acercándose, un trazo en zigzag con presión, el botón del lápiz (borrar) y un botón de la tableta.
#define WIN32_LEAN_AND_MEAN
#include <winsock2.h>
#include <windows.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct { ADDRESS_FAMILY sun_family; char sun_path[108]; } SockAddrUn;
typedef struct { uint32_t messageType, size, nonPersistentTabletId; } Header;
typedef struct { Header header; float maxX, maxY; uint32_t maxPressure; char persistentId[256]; char name[256]; } DeviceInfo;
typedef struct { Header header; uint32_t validBits; float x, y; uint32_t pressure, penButtons, auxButtons, hoverDistance; uint8_t penIsNearSurface; } State;
typedef struct { Header header; uint64_t protocolVersion; char humanReadableName[256], humanReadableVersion[256], implementationID[256]; uint8_t compatibilityVersion; } Hello;

static SOCKET gClient;

static void sendState(float x, float y, uint32_t pressure, uint32_t pen, uint32_t aux, int isNear, int withNear) {
  State st;
  memset(&st, 0, sizeof(st));
  st.header.messageType = 2;
  st.header.size = sizeof(State);
  st.header.nonPersistentTabletId = 7;
  st.validBits = 1 | 2 | 4 | 8 | 16 | (withNear ? 32 : 0);
  st.x = x; st.y = y; st.pressure = pressure; st.penButtons = pen; st.auxButtons = aux; st.penIsNearSurface = (uint8_t)isNear;
  send(gClient, (const char*)&st, sizeof(st), 0);
  Sleep(8);
}

int main(int argc, char** argv) {
  int seconds = argc > 1 ? atoi(argv[1]) : 10;
  char root[MAX_PATH], dir[MAX_PATH], sock[MAX_PATH], file[MAX_PATH];
  GetEnvironmentVariableA("LOCALAPPDATA", root, MAX_PATH);
  snprintf(dir, sizeof(dir), "%s\\otd-ipc", root); CreateDirectoryA(dir, NULL);
  snprintf(dir, sizeof(dir), "%s\\otd-ipc\\servers", root); CreateDirectoryA(dir, NULL);
  snprintf(dir, sizeof(dir), "%s\\otd-ipc\\servers\\v2", root); CreateDirectoryA(dir, NULL);
  snprintf(dir, sizeof(dir), "%s\\otd-ipc\\servers\\v2\\available", root); CreateDirectoryA(dir, NULL);
  snprintf(sock, sizeof(sock), "%s\\otd-ipc\\servers\\v2\\prueba.sock", root);
  DeleteFileA(sock);
  WSADATA wsa;
  WSAStartup(MAKEWORD(2, 2), &wsa);
  SOCKET l = socket(1, SOCK_STREAM, 0);
  SockAddrUn addr;
  memset(&addr, 0, sizeof(addr));
  addr.sun_family = 1;
  strncpy(addr.sun_path, sock, sizeof(addr.sun_path) - 1);
  if (bind(l, (struct sockaddr*)&addr, (int)(offsetof(SockAddrUn, sun_path) + strlen(addr.sun_path) + 1)) == SOCKET_ERROR || listen(l, 1) == SOCKET_ERROR) {
    printf("ERROR bind/listen %d\n", WSAGetLastError());
    return 1;
  }
  snprintf(file, sizeof(file), "%s\\prueba.txt", dir);
  FILE* f = fopen(file, "w");
  fprintf(f, "ID=prueba\nSOCKET=%s\nNAME=OTD-IPC de prueba\nDEBUG_VERSION=1\n", sock);
  fclose(f);
  printf("LISTO\n");
  fflush(stdout);
  gClient = accept(l, NULL, NULL);
  Hello hello;
  int got = 0;
  while (got < (int)sizeof(hello)) {
    int r = recv(gClient, (char*)&hello + got, (int)sizeof(hello) - got, 0);
    if (r <= 0) break;
    got += r;
  }
  printf("HELLO %d bytes, tipo %u, tamaño %u, version %llx, cliente '%s'\n", got, hello.header.messageType, hello.header.size,
    (unsigned long long)hello.protocolVersion, hello.humanReadableName);
  fflush(stdout);
  DeviceInfo d;
  memset(&d, 0, sizeof(d));
  d.header.messageType = 1; d.header.size = sizeof(d); d.header.nonPersistentTabletId = 7;
  d.maxX = 152.0f; d.maxY = 95.0f; d.maxPressure = 8191;
  strcpy(d.persistentId, "prueba-tableta-1");
  strcpy(d.name, "Tableta de prueba");
  send(gClient, (const char*)&d, sizeof(d), 0);
  // Si existe «otdipc-wait.txt» en LOCALAPPDATA, espera a que aparezca «otdipc-go.txt» para dibujar (así la prueba
  // de la app decide cuándo); si no, empieza a los 1,5 s.
  char go[MAX_PATH];
  snprintf(go, sizeof(go), "%s\\otdipc-wait.txt", root);
  if (GetFileAttributesA(go) != INVALID_FILE_ATTRIBUTES) {
    snprintf(go, sizeof(go), "%s\\otdipc-go.txt", root);
    for (int i = 0; i < 3000 && GetFileAttributesA(go) == INVALID_FILE_ATTRIBUTES; i++) Sleep(100);
  } else {
    Sleep(1500);
  }
  // Se acerca el lápiz (sin tocar) y se mueve.
  for (int i = 0; i <= 20; i++) sendState(20.0f + i, 30.0f, 0, 0, 0, 1, 1);
  // Trazo en zigzag con presión.
  for (int i = 0; i <= 60; i++) sendState(40.0f + i * 0.9f, 30.0f + (i % 10 < 5 ? i % 5 : 5 - i % 5) * 2.0f, 4000 + i * 40, 1, 0, 1, 1);
  sendState(94.0f, 32.0f, 0, 0, 0, 1, 1);
  // Botón 1 de la tableta (pulsar y soltar).
  sendState(94.0f, 32.0f, 0, 0, 1, 1, 1);
  sendState(94.0f, 32.0f, 0, 0, 0, 1, 1);
  // El lápiz queda cerca, quieto, para que se vea el cursor.
  for (int i = 0; i < seconds * 10; i++) sendState(70.0f, 60.0f, 0, 0, 0, 1, 1);
  closesocket(gClient);
  closesocket(l);
  DeleteFileA(file);
  DeleteFileA(sock);
  printf("FIN\n");
  return 0;
}
