// Tabletas gráficas por OTD-IPC, el mismo protocolo que usa OpenKneeboard: un plugin de OpenTabletDriver
// (o wintab-adapter, para los drivers de Wacom/Huion) publica el estado del lápiz en un socket AF_UNIX
// local. Aquí se lee ese socket y se pasa cada mensaje a la aplicación como una línea JSON:
//   {"t":"tstatus","state":"connected|no-server|disconnected","server":"..."}
//   {"t":"tdev","tid":1,"id":"...","name":"...","mx":152.0,"my":95.0,"mp":8191}
//   {"t":"tab","tid":1,"v":63,"x":76.2,"y":40.1,"p":1200,"pb":1,"ab":0,"near":1}
// Protocolo: https://github.com/OpenKneeboard/OTD-IPC (MIT). Solo se lee; nunca se escribe en la tableta.
#define WIN32_LEAN_AND_MEAN
#include <winsock2.h>
#include <windows.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#ifndef AF_UNIX
#define AF_UNIX 1
#endif
typedef struct {
  ADDRESS_FAMILY sun_family;
  char sun_path[108];
} SockAddrUn;

void emit(const char* line);
extern volatile LONG gQuit;

enum { MSG_DEVICE_INFO = 1, MSG_STATE = 2, MSG_PING = 3, MSG_DEBUG = 4, MSG_EXPERIMENTAL = 5, MSG_HELLO = 6 };

typedef struct {
  uint32_t messageType;
  uint32_t size;
  uint32_t nonPersistentTabletId;
} Header;

typedef struct {
  Header header;
  float maxX;
  float maxY;
  uint32_t maxPressure;
  char persistentId[256];
  char name[256];
} DeviceInfo;

typedef struct {
  Header header;
  uint32_t validBits;
  float x;
  float y;
  uint32_t pressure;
  uint32_t penButtons;
  uint32_t auxButtons;
  uint32_t hoverDistance;
  uint8_t penIsNearSurface;
} State;

typedef struct {
  Header header;
  uint64_t protocolVersion;
  char humanReadableName[256];
  char humanReadableVersion[256];
  char implementationID[256];
  uint8_t compatibilityVersion;
} Hello;

_Static_assert(sizeof(Header) == 12, "Header");
_Static_assert(sizeof(DeviceInfo) == 536, "DeviceInfo");
_Static_assert(offsetof(State, penIsNearSurface) == 40 && sizeof(State) == 44, "State");
_Static_assert(offsetof(Hello, protocolVersion) == 16 && sizeof(Hello) == 800, "Hello");

#define VALID_NEAR (1u << 5)

// Texto seguro para JSON: sin comillas, barras ni caracteres de control.
static void jsonSafe(const char* in, size_t max, char* out, size_t outSize) {
  size_t o = 0;
  for (size_t i = 0; i < max && in[i] && o + 1 < outSize; i++) {
    unsigned char c = (unsigned char)in[i];
    out[o++] = (c < 32 || c == '"' || c == '\\') ? ' ' : (char)c;
  }
  out[o] = 0;
}

static void status(const char* state, const char* server) {
  static char last[300] = "";
  char line[400], name[200];
  jsonSafe(server ? server : "", 200, name, sizeof(name));
  snprintf(line, sizeof(line), "{\"t\":\"tstatus\",\"state\":\"%s\",\"server\":\"%s\"}", state, name);
  if (strcmp(line, last) == 0) return;
  strncpy(last, line, sizeof(last) - 1);
  emit(line);
}

static int readFile(const wchar_t* path, char* buf, int size) {
  HANDLE h = CreateFileW(path, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, NULL, OPEN_EXISTING, 0, NULL);
  if (h == INVALID_HANDLE_VALUE) return 0;
  DWORD n = 0;
  ReadFile(h, buf, size - 1, &n, NULL);
  CloseHandle(h);
  buf[n] = 0;
  return (int)n;
}

// Valor de una línea «CLAVE=valor» del archivo de descubrimiento.
static int field(const char* text, const char* key, char* out, size_t outSize) {
  size_t kl = strlen(key);
  for (const char* p = text; p && *p;) {
    if (strncmp(p, key, kl) == 0 && p[kl] == '=') {
      p += kl + 1;
      size_t i = 0;
      while (p[i] && p[i] != '\r' && p[i] != '\n' && i + 1 < outSize) { out[i] = p[i]; i++; }
      out[i] = 0;
      return 1;
    }
    p = strchr(p, '\n');
    if (p) p++;
  }
  return 0;
}

// Busca los servidores en %LOCALAPPDATA%\otd-ipc\servers\v2\available\<ID>.txt (el de default.txt primero).
static int findServer(char* socketPath, size_t pathSize, char* name, size_t nameSize) {
  wchar_t root[MAX_PATH], pattern[MAX_PATH], file[MAX_PATH];
  DWORD n = GetEnvironmentVariableW(L"LOCALAPPDATA", root, MAX_PATH);
  if (!n || n >= MAX_PATH - 64) return 0;
  wcscat(root, L"\\otd-ipc\\servers\\v2");
  char preferred[260] = "";
  {
    char buf[300];
    swprintf(file, MAX_PATH, L"%ls\\default.txt", root);
    if (readFile(file, buf, sizeof(buf))) {
      size_t i = 0, o = 0;
      for (; buf[i] && o + 1 < sizeof(preferred); i++) if (!strchr(" \t\r\n", buf[i])) preferred[o++] = buf[i];
      preferred[o] = 0;
    }
  }
  swprintf(pattern, MAX_PATH, L"%ls\\available\\*.txt", root);
  WIN32_FIND_DATAW fd;
  HANDLE f = FindFirstFileW(pattern, &fd);
  if (f == INVALID_HANDLE_VALUE) return 0;
  int found = 0;
  do {
    char text[4096], id[260] = "", sock[300] = "", nm[260] = "";
    swprintf(file, MAX_PATH, L"%ls\\available\\%ls", root, fd.cFileName);
    if (!readFile(file, text, sizeof(text))) continue;
    if (!field(text, "SOCKET", sock, sizeof(sock)) || !sock[0]) continue;
    field(text, "ID", id, sizeof(id));
    field(text, "NAME", nm, sizeof(nm));
    int isDefault = preferred[0] && strcmp(id, preferred) == 0;
    if (!found || isDefault) {
      strncpy(socketPath, sock, pathSize - 1);
      socketPath[pathSize - 1] = 0;
      strncpy(name, nm[0] ? nm : id, nameSize - 1);
      name[nameSize - 1] = 0;
      found = 1;
      if (isDefault) break;
    }
  } while (FindNextFileW(f, &fd));
  FindClose(f);
  return found;
}

static int recvAll(SOCKET s, char* buf, int size) {
  int got = 0;
  while (got < size) {
    int r = recv(s, buf + got, size - got, 0);
    if (r > 0) { got += r; continue; }
    if (r == SOCKET_ERROR && WSAGetLastError() == WSAETIMEDOUT) {
      if (gQuit) return 0;
      continue;
    }
    return 0;
  }
  return 1;
}

static void onMessage(const char* buf, uint32_t size) {
  const Header* h = (const Header*)buf;
  char line[900];
  if (h->messageType == MSG_DEVICE_INFO && size >= sizeof(DeviceInfo)) {
    const DeviceInfo* d = (const DeviceInfo*)buf;
    char id[260], name[260];
    jsonSafe(d->persistentId, sizeof(d->persistentId), id, sizeof(id));
    jsonSafe(d->name, sizeof(d->name), name, sizeof(name));
    snprintf(line, sizeof(line), "{\"t\":\"tdev\",\"tid\":%u,\"id\":\"%s\",\"name\":\"%s\",\"mx\":%.3f,\"my\":%.3f,\"mp\":%u}",
      d->header.nonPersistentTabletId, id, name, d->maxX, d->maxY, d->maxPressure);
    emit(line);
  } else if (h->messageType == MSG_STATE && size >= sizeof(State)) {
    const State* st = (const State*)buf;
    snprintf(line, sizeof(line), "{\"t\":\"tab\",\"tid\":%u,\"v\":%u,\"x\":%.3f,\"y\":%.3f,\"p\":%u,\"pb\":%u,\"ab\":%u,\"near\":%d}",
      st->header.nonPersistentTabletId, st->validBits, st->x, st->y, st->pressure, st->penButtons, st->auxButtons,
      (st->validBits & VALID_NEAR) ? (st->penIsNearSurface ? 1 : 0) : -1);
    emit(line);
  }
}

DWORD WINAPI tabletThread(LPVOID arg) {
  (void)arg;
  WSADATA wsa;
  if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) return 0;
  while (!gQuit) {
    char path[300], name[260];
    if (!findServer(path, sizeof(path), name, sizeof(name))) {
      status("no-server", "");
      for (int i = 0; i < 20 && !gQuit; i++) Sleep(100);
      continue;
    }
    SOCKET s = socket(AF_UNIX, SOCK_STREAM, 0);
    if (s == INVALID_SOCKET) {
      status("no-server", "");
      Sleep(2000);
      continue;
    }
    SockAddrUn addr;
    memset(&addr, 0, sizeof(addr));
    addr.sun_family = AF_UNIX;
    strncpy(addr.sun_path, path, sizeof(addr.sun_path) - 1);
    int addrLen = (int)(offsetof(SockAddrUn, sun_path) + strlen(addr.sun_path) + 1);
    if (connect(s, (struct sockaddr*)&addr, addrLen) == SOCKET_ERROR) {
      closesocket(s);
      status("no-server", name);
      for (int i = 0; i < 20 && !gQuit; i++) Sleep(100);
      continue;
    }
    DWORD timeout = 500;
    setsockopt(s, SOL_SOCKET, SO_RCVTIMEO, (const char*)&timeout, sizeof(timeout));
    Hello hello;
    memset(&hello, 0, sizeof(hello));
    hello.header.messageType = MSG_HELLO;
    hello.header.size = sizeof(Hello);
    hello.protocolVersion = 0x0220260205ull * 0x100ull + 0x01ull;
    strcpy(hello.humanReadableName, "LF Kneeboard");
    strcpy(hello.humanReadableVersion, "1");
    strcpy(hello.implementationID, "lf-kneeboard.lafundacion");
    hello.compatibilityVersion = 1;
    send(s, (const char*)&hello, sizeof(hello), 0);
    status("connected", name);
    char buf[2048];
    while (!gQuit) {
      if (!recvAll(s, buf, sizeof(Header))) break;
      uint32_t size = ((Header*)buf)->size;
      if (size < sizeof(Header) || size > sizeof(buf)) break;
      if (size > sizeof(Header) && !recvAll(s, buf + sizeof(Header), (int)(size - sizeof(Header)))) break;
      onMessage(buf, size);
    }
    closesocket(s);
    if (!gQuit) status("disconnected", name);
    for (int i = 0; i < 10 && !gQuit; i++) Sleep(100);
  }
  WSACleanup();
  return 0;
}
