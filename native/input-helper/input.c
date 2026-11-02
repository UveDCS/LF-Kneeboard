// Lector de entradas en segundo plano para LF Kneeboard.
// Lee botones y setas (POV) de todos los mandos por DirectInput 8 y el teclado por GetAsyncKeyState,
// aunque la ventana activa sea DCS. Escribe un evento JSON por línea en la salida estándar:
//   {"t":"dev","id":"{GUID}","name":"..."}      mando conectado
//   {"t":"gone","id":"{GUID}"}                   mando desconectado
//   {"t":"btn","id":"{GUID}","b":3,"v":1}        botón (las setas son b = 1000 + seta*4 + dirección U/R/D/L)
//   {"t":"key","k":75,"v":1}                     tecla (código virtual de Windows)
// Termina cuando se cierra su entrada estándar (la app se ha cerrado).
#define WIN32_LEAN_AND_MEAN
#define DIRECTINPUT_VERSION 0x0800
#define CINTERFACE
#include <windows.h>
#include <mmsystem.h>
#include <dinput.h>
#include <stddef.h>
#include <stdio.h>
#include <string.h>

static const GUID MY_IID_IDirectInput8W = {0xBF798031, 0x483A, 0x4DA2, {0xAA, 0x99, 0x5D, 0x64, 0xED, 0x36, 0x97, 0x00}};
static const GUID MY_GUID_POV = {0xA36D02F2, 0xC9F3, 0x11CF, {0xBF, 0xC7, 0x44, 0x45, 0x53, 0x54, 0x00, 0x00}};

typedef HRESULT(WINAPI* PFN_DirectInput8Create)(HINSTANCE, DWORD, REFIID, LPVOID*, LPUNKNOWN);

#define MAX_DEV 32
#define NBTN 128
#define NPOV 4

typedef struct {
  DWORD pov[NPOV];
  BYTE btn[NBTN];
} JoyState;

typedef struct {
  int used;
  GUID guid;
  char id[40];
  LPDIRECTINPUTDEVICE8W dev;
  JoyState last;
  int failures;
  int seen;
  int primed;
} Device;

static LPDIRECTINPUT8W gDI = NULL;
static HWND gWnd = NULL;
static Device gDevs[MAX_DEV];
static DIOBJECTDATAFORMAT gObjs[NPOV + NBTN];
static DIDATAFORMAT gFmt;
static volatile LONG gQuit = 0;
static CRITICAL_SECTION gOut;

static void emit(const char* line) {
  EnterCriticalSection(&gOut);
  fputs(line, stdout);
  fputc('\n', stdout);
  fflush(stdout);
  LeaveCriticalSection(&gOut);
}

static void guidStr(const GUID* g, char* out) {
  sprintf(out, "{%08lX-%04X-%04X-%02X%02X-%02X%02X%02X%02X%02X%02X}", (unsigned long)g->Data1, g->Data2, g->Data3,
          g->Data4[0], g->Data4[1], g->Data4[2], g->Data4[3], g->Data4[4], g->Data4[5], g->Data4[6], g->Data4[7]);
}

static void jsonEscape(const char* in, char* out, size_t cap) {
  size_t o = 0;
  for (; *in && o + 7 < cap; in++) {
    unsigned char c = (unsigned char)*in;
    if (c == '"' || c == '\\') { out[o++] = '\\'; out[o++] = (char)c; }
    else if (c < 0x20) { o += sprintf(out + o, "\\u%04x", c); }
    else out[o++] = (char)c;
  }
  out[o] = 0;
}

static void buildFormat(void) {
  for (int i = 0; i < NPOV; i++) {
    gObjs[i].pguid = &MY_GUID_POV;
    gObjs[i].dwOfs = (DWORD)(offsetof(JoyState, pov) + i * sizeof(DWORD));
    gObjs[i].dwType = DIDFT_POV | DIDFT_ANYINSTANCE | DIDFT_OPTIONAL;
    gObjs[i].dwFlags = 0;
  }
  for (int i = 0; i < NBTN; i++) {
    gObjs[NPOV + i].pguid = NULL;
    gObjs[NPOV + i].dwOfs = (DWORD)(offsetof(JoyState, btn) + i);
    gObjs[NPOV + i].dwType = DIDFT_BUTTON | DIDFT_ANYINSTANCE | DIDFT_OPTIONAL;
    gObjs[NPOV + i].dwFlags = 0;
  }
  gFmt.dwSize = sizeof(DIDATAFORMAT);
  gFmt.dwObjSize = sizeof(DIOBJECTDATAFORMAT);
  gFmt.dwFlags = DIDF_ABSAXIS;
  gFmt.dwDataSize = sizeof(JoyState);
  gFmt.dwNumObjs = NPOV + NBTN;
  gFmt.rgodf = gObjs;
}

static void povDirs(DWORD v, int out[4]) {
  out[0] = out[1] = out[2] = out[3] = 0;
  if (LOWORD(v) == 0xFFFF) return;
  DWORD a = v / 100;  // grados
  if (a >= 315 || a <= 45) out[0] = 1;   // U
  if (a >= 45 && a <= 135) out[1] = 1;   // R
  if (a >= 135 && a <= 225) out[2] = 1;  // D
  if (a >= 225 && a <= 315) out[3] = 1;  // L
}

static Device* findDev(const GUID* g) {
  for (int i = 0; i < MAX_DEV; i++)
    if (gDevs[i].used && IsEqualGUID(&gDevs[i].guid, g)) return &gDevs[i];
  return NULL;
}

static void closeDev(Device* d) {
  char line[96];
  sprintf(line, "{\"t\":\"gone\",\"id\":\"%s\"}", d->id);
  emit(line);
  if (d->dev) {
    IDirectInputDevice8_Unacquire(d->dev);
    IDirectInputDevice8_Release(d->dev);
  }
  memset(d, 0, sizeof(*d));
}

static BOOL CALLBACK enumCb(LPCDIDEVICEINSTANCEW inst, LPVOID ctx) {
  (void)ctx;
  Device* existing = findDev(&inst->guidInstance);
  if (existing) {
    existing->seen = 1;
    return DIENUM_CONTINUE;
  }
  Device* d = NULL;
  for (int i = 0; i < MAX_DEV; i++)
    if (!gDevs[i].used) { d = &gDevs[i]; break; }
  if (!d) return DIENUM_STOP;
  LPDIRECTINPUTDEVICE8W dev = NULL;
  if (FAILED(IDirectInput8_CreateDevice(gDI, &inst->guidInstance, &dev, NULL))) return DIENUM_CONTINUE;
  if (FAILED(IDirectInputDevice8_SetDataFormat(dev, &gFmt)) ||
      FAILED(IDirectInputDevice8_SetCooperativeLevel(dev, gWnd, DISCL_BACKGROUND | DISCL_NONEXCLUSIVE))) {
    IDirectInputDevice8_Release(dev);
    return DIENUM_CONTINUE;
  }
  IDirectInputDevice8_Acquire(dev);
  memset(d, 0, sizeof(*d));
  d->used = 1;
  d->seen = 1;
  d->guid = inst->guidInstance;
  d->dev = dev;
  guidStr(&d->guid, d->id);
  for (int i = 0; i < NPOV; i++) d->last.pov[i] = 0xFFFFFFFF;
  char name[260], esc[600], line[800];
  WideCharToMultiByte(CP_UTF8, 0, inst->tszInstanceName, -1, name, sizeof(name), NULL, NULL);
  jsonEscape(name, esc, sizeof(esc));
  snprintf(line, sizeof(line), "{\"t\":\"dev\",\"id\":\"%s\",\"name\":\"%s\"}", d->id, esc);
  emit(line);
  return DIENUM_CONTINUE;
}

static void rescan(void) {
  for (int i = 0; i < MAX_DEV; i++) gDevs[i].seen = 0;
  IDirectInput8_EnumDevices(gDI, DI8DEVCLASS_GAMECTRL, enumCb, NULL, DIEDFL_ATTACHEDONLY);
  for (int i = 0; i < MAX_DEV; i++)
    if (gDevs[i].used && !gDevs[i].seen) closeDev(&gDevs[i]);
}

static void pollDev(Device* d) {
  JoyState s;
  IDirectInputDevice8_Poll(d->dev);
  HRESULT hr = IDirectInputDevice8_GetDeviceState(d->dev, sizeof(s), &s);
  if (hr == DIERR_INPUTLOST || hr == DIERR_NOTACQUIRED) {
    IDirectInputDevice8_Acquire(d->dev);
    hr = IDirectInputDevice8_GetDeviceState(d->dev, sizeof(s), &s);
  }
  if (FAILED(hr)) {
    if (++d->failures > 200) closeDev(d);
    return;
  }
  d->failures = 0;
  if (!d->primed) {  // la primera lectura solo fija el estado inicial (botones mantenidos)
    d->primed = 1;
    d->last = s;
    return;
  }
  char line[128];
  for (int b = 0; b < NBTN; b++) {
    int now = (s.btn[b] & 0x80) != 0, was = (d->last.btn[b] & 0x80) != 0;
    if (now != was) {
      sprintf(line, "{\"t\":\"btn\",\"id\":\"%s\",\"b\":%d,\"v\":%d}", d->id, b, now);
      emit(line);
    }
  }
  for (int p = 0; p < NPOV; p++) {
    int a[4], b4[4];
    povDirs(s.pov[p], a);
    povDirs(d->last.pov[p], b4);
    for (int k = 0; k < 4; k++) {
      if (a[k] != b4[k]) {
        sprintf(line, "{\"t\":\"btn\",\"id\":\"%s\",\"b\":%d,\"v\":%d}", d->id, 1000 + p * 4 + k, a[k]);
        emit(line);
      }
    }
  }
  d->last = s;
}

static BYTE gKeys[256];
static int gKeysPrimed = 0;
static void pollKeys(void) {
  char line[64];
  for (int vk = 8; vk < 255; vk++) {
    if (vk == VK_SHIFT || vk == VK_CONTROL || vk == VK_MENU) continue;  // se usan las versiones izquierda/derecha
    BYTE now = (GetAsyncKeyState(vk) & 0x8000) ? 1 : 0;
    if (now != gKeys[vk]) {
      gKeys[vk] = now;
      if (!gKeysPrimed) continue;
      sprintf(line, "{\"t\":\"key\",\"k\":%d,\"v\":%d}", vk, now);
      emit(line);
    }
  }
  gKeysPrimed = 1;
}

static DWORD WINAPI stdinWatch(LPVOID arg) {
  (void)arg;
  HANDLE in = GetStdHandle(STD_INPUT_HANDLE);
  char buf[256];
  DWORD n;
  while (ReadFile(in, buf, sizeof(buf) - 1, &n, NULL) && n > 0) {
    buf[n] = 0;
    if (strstr(buf, "quit")) break;
  }
  InterlockedExchange(&gQuit, 1);
  return 0;
}

int main(void) {
  InitializeCriticalSection(&gOut);
  timeBeginPeriod(1);
  HMODULE di = LoadLibraryW(L"dinput8.dll");
  PFN_DirectInput8Create create = di ? (PFN_DirectInput8Create)(void*)GetProcAddress(di, "DirectInput8Create") : NULL;
  if (!create || FAILED(create(GetModuleHandleW(NULL), DIRECTINPUT_VERSION, &MY_IID_IDirectInput8W, (LPVOID*)&gDI, NULL))) {
    emit("{\"t\":\"error\",\"msg\":\"DirectInput no disponible\"}");
    gDI = NULL;
  }
  gWnd = CreateWindowExW(0, L"STATIC", L"LFKneeboardInput", WS_OVERLAPPED, 0, 0, 1, 1, NULL, NULL, GetModuleHandleW(NULL), NULL);
  buildFormat();
  CreateThread(NULL, 0, stdinWatch, NULL, 0, NULL);
  emit("{\"t\":\"ready\"}");
  if (gDI) rescan();
  DWORD lastScan = GetTickCount();
  while (!gQuit) {
    MSG msg;
    while (PeekMessageW(&msg, NULL, 0, 0, PM_REMOVE)) DispatchMessageW(&msg);
    if (gDI) {
      for (int i = 0; i < MAX_DEV; i++)
        if (gDevs[i].used) pollDev(&gDevs[i]);
      if (GetTickCount() - lastScan > 3000) {
        rescan();
        lastScan = GetTickCount();
      }
    }
    pollKeys();
    Sleep(10);
  }
  for (int i = 0; i < MAX_DEV; i++)
    if (gDevs[i].used) closeDev(&gDevs[i]);
  if (gDI) IDirectInput8_Release(gDI);
  return 0;
}
