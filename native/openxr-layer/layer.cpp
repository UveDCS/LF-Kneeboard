// Capa implícita de OpenXR: añade el kneeboard como capa "quad" en cada fotograma de DCS.
// Solo actúa en sesiones Direct3D 11 (las que usa DCS). Si la app no está abierta, no hace nada.
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <d3d11.h>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <cstdarg>
#include <vector>
#include <mutex>

#define XR_USE_PLATFORM_WIN32
#define XR_USE_GRAPHICS_API_D3D11
#include <openxr/openxr.h>
#include <openxr/openxr_platform.h>
#include <openxr/openxr_loader_negotiation.h>

#include "../shared/lfkb_shared.h"

#define LAYER_NAME "XR_APILAYER_LAFUNDACION_kneeboard"
#define EXPORT extern "C" __declspec(dllexport)

namespace {

// ---------------------------------------------------------------- registro
FILE* gLog = nullptr;
void logf(const char* fmt, ...) {
  if (!gLog) {
    wchar_t dir[MAX_PATH];
    DWORD n = GetEnvironmentVariableW(L"LOCALAPPDATA", dir, MAX_PATH);
    if (!n || n >= MAX_PATH) return;
    wchar_t path[MAX_PATH * 2];
    swprintf(path, MAX_PATH * 2, L"%ls\\LF Kneeboard", dir);
    CreateDirectoryW(path, nullptr);
    wcscat(path, L"\\openxr-layer.log");
    gLog = _wfopen(path, L"w");
    if (!gLog) return;
  }
  SYSTEMTIME st;
  GetLocalTime(&st);
  fprintf(gLog, "[%02d:%02d:%02d] ", st.wHour, st.wMinute, st.wSecond);
  va_list ap;
  va_start(ap, fmt);
  vfprintf(gLog, fmt, ap);
  va_end(ap);
  fputc('\n', gLog);
  fflush(gLog);
}

// ---------------------------------------------------------------- funciones siguientes
PFN_xrGetInstanceProcAddr nextGetInstanceProcAddr = nullptr;
PFN_xrCreateSession nextCreateSession = nullptr;
PFN_xrDestroySession nextDestroySession = nullptr;
PFN_xrEndFrame nextEndFrame = nullptr;
PFN_xrDestroyInstance nextDestroyInstance = nullptr;
PFN_xrEnumerateSwapchainFormats xEnumerateSwapchainFormats = nullptr;
PFN_xrCreateSwapchain xCreateSwapchain = nullptr;
PFN_xrDestroySwapchain xDestroySwapchain = nullptr;
PFN_xrEnumerateSwapchainImages xEnumerateSwapchainImages = nullptr;
PFN_xrAcquireSwapchainImage xAcquireSwapchainImage = nullptr;
PFN_xrWaitSwapchainImage xWaitSwapchainImage = nullptr;
PFN_xrReleaseSwapchainImage xReleaseSwapchainImage = nullptr;
PFN_xrCreateReferenceSpace xCreateReferenceSpace = nullptr;
PFN_xrDestroySpace xDestroySpace = nullptr;
PFN_xrLocateSpace xLocateSpace = nullptr;

XrInstance gInstance = XR_NULL_HANDLE;

// ---------------------------------------------------------------- memoria compartida
HANDLE gMapping = nullptr;
LfkbHeader* gShm = nullptr;
DWORD gLastOpenTry = 0;
DWORD gLastOpenError = 0;
uint32_t gLastHeartbeat = 0;
DWORD gHeartbeatChangedAt = 0;

bool openShared() {
  if (gShm) return true;
  DWORD now = GetTickCount();
  if (now - gLastOpenTry < 2000) return false;
  gLastOpenTry = now;
  gMapping = OpenFileMappingW(FILE_MAP_ALL_ACCESS, FALSE, LFKB_SHM_NAME);
  if (!gMapping) {
    // Se anota el motivo una vez (y otra si cambia), para poder diagnosticar sin llenar el registro.
    DWORD err = GetLastError();
    if (err != gLastOpenError) {
      gLastOpenError = err;
      if (err == ERROR_FILE_NOT_FOUND) {
        logf("Sin conexión: LF Kneeboard no está abierto (se reintenta cada 2 s)");
      } else if (err == ERROR_ACCESS_DENIED) {
        logf("Sin conexión: permiso denegado (error 5). LF Kneeboard y DCS se ejecutan con permisos distintos: "
             "abre los dos como administrador o ninguno");
      } else {
        logf("Sin conexión con LF Kneeboard (error %lu)", err);
      }
    }
    return false;
  }
  void* p = MapViewOfFile(gMapping, FILE_MAP_ALL_ACCESS, 0, 0, LFKB_TOTAL_BYTES);
  if (!p) {
    CloseHandle(gMapping);
    gMapping = nullptr;
    return false;
  }
  gShm = static_cast<LfkbHeader*>(p);
  if (gShm->magic != LFKB_MAGIC || gShm->version != LFKB_VERSION) {
    logf("Memoria compartida con versión distinta (%08x/%u)", gShm->magic, gShm->version);
    UnmapViewOfFile(p);
    CloseHandle(gMapping);
    gShm = nullptr;
    gMapping = nullptr;
    return false;
  }
  gLastOpenError = 0;
  logf("Conectado con LF Kneeboard");
  return true;
}

bool appAlive() {
  DWORD now = GetTickCount();
  if (gShm->heartbeat != gLastHeartbeat) {
    gLastHeartbeat = gShm->heartbeat;
    gHeartbeatChangedAt = now;
  }
  return now - gHeartbeatChangedAt < 3000;
}

// ---------------------------------------------------------------- matemáticas
struct V3 { float x, y, z; };
V3 operator+(V3 a, V3 b) { return {a.x + b.x, a.y + b.y, a.z + b.z}; }
V3 operator-(V3 a, V3 b) { return {a.x - b.x, a.y - b.y, a.z - b.z}; }
V3 operator*(V3 a, float s) { return {a.x * s, a.y * s, a.z * s}; }
float dot(V3 a, V3 b) { return a.x * b.x + a.y * b.y + a.z * b.z; }

XrQuaternionf qmul(XrQuaternionf a, XrQuaternionf b) {
  return {
    a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}
XrQuaternionf qaxis(float ax, float ay, float az, float deg) {
  float h = deg * 3.14159265f / 360.0f;
  float s = std::sin(h);
  return {ax * s, ay * s, az * s, std::cos(h)};
}
V3 qrot(XrQuaternionf q, V3 v) {
  V3 u{q.x, q.y, q.z};
  V3 t = V3{u.y * v.z - u.z * v.y, u.z * v.x - u.x * v.z, u.x * v.y - u.y * v.x} * 2.0f;
  V3 c{u.y * t.z - u.z * t.y, u.z * t.x - u.x * t.z, u.x * t.y - u.y * t.x};
  return v + t * q.w + c;
}

// ---------------------------------------------------------------- estado de sesión
struct ViewState {
  XrSwapchain swapchain = XR_NULL_HANDLE;
  std::vector<XrSwapchainImageD3D11KHR> images;
  uint32_t w = 0, h = 0;
  uint32_t lastSeq = 0xFFFFFFFF;
  bool hasImage = false;
  float zoom = 1.0f;
  float appear = 0.0f;  // 0 = guardado, 1 = fuera del todo (animación al sacarlo)
};

struct Session {
  XrSession handle = XR_NULL_HANDLE;
  ID3D11Device* device = nullptr;
  ID3D11DeviceContext* context = nullptr;
  XrSpace local = XR_NULL_HANDLE;
  XrSpace view = XR_NULL_HANDLE;
  int64_t format = 0;
  bool swizzle = false;
  ViewState views[LFKB_MAX_VIEWS];
  XrPosef origin{{0, 0, 0, 1}, {0, 0, 0}};
  uint32_t lastRecenter = 0;
  std::vector<uint8_t> scratch;
  XrSwapchain reticle = XR_NULL_HANDLE;
  bool reticleReady = false;
};

const uint32_t RETICLE_PX = 64;

// Cruz roja con borde oscuro (BGRA premultiplicado), dibujada una vez.
void makeReticle(std::vector<uint8_t>& px, bool rgba) {
  const int n = (int)RETICLE_PX, c = n / 2;
  px.assign((size_t)n * n * 4, 0);
  for (int y = 0; y < n; y++) {
    for (int x = 0; x < n; x++) {
      int dx = std::abs(x - c), dy = std::abs(y - c);
      bool arm = (dx <= 1 && dy >= 7 && dy <= 29) || (dy <= 1 && dx >= 7 && dx <= 29);
      bool dot = dx <= 1 && dy <= 1;
      bool edge = (dx <= 3 && dy >= 5 && dy <= 31) || (dy <= 3 && dx >= 5 && dx <= 31) || (dx <= 3 && dy <= 3);
      uint8_t* p = &px[((size_t)y * n + x) * 4];
      if (arm || dot) {
        uint8_t r = 255, g = 45, b = 85;
        p[0] = rgba ? r : b; p[1] = g; p[2] = rgba ? b : r; p[3] = 255;
      } else if (edge) {
        p[0] = 0; p[1] = 0; p[2] = 0; p[3] = 150;
      }
    }
  }
}
Session* gSession = nullptr;
std::mutex gMutex;

void destroyReticle(Session* s) {
  if (s->reticle) xDestroySwapchain(s->reticle);
  s->reticle = XR_NULL_HANDLE;
  s->reticleReady = false;
}

void destroyViews(Session* s) {
  destroyReticle(s);
  for (auto& v : s->views) {
    if (v.swapchain) xDestroySwapchain(v.swapchain);
    v = ViewState{};
  }
}

void destroySession(Session* s) {
  if (!s) return;
  destroyViews(s);
  if (s->local) xDestroySpace(s->local);
  if (s->view) xDestroySpace(s->view);
  if (s->context) s->context->Release();
  if (s->device) s->device->Release();
  delete s;
}

bool pickFormat(Session* s) {
  uint32_t count = 0;
  if (XR_FAILED(xEnumerateSwapchainFormats(s->handle, 0, &count, nullptr)) || !count) return false;
  std::vector<int64_t> formats(count);
  xEnumerateSwapchainFormats(s->handle, count, &count, formats.data());
  const int64_t prefs[] = {DXGI_FORMAT_B8G8R8A8_UNORM_SRGB, DXGI_FORMAT_B8G8R8A8_UNORM,
                           DXGI_FORMAT_R8G8B8A8_UNORM_SRGB, DXGI_FORMAT_R8G8B8A8_UNORM};
  for (int64_t p : prefs) {
    for (int64_t f : formats) {
      if (f == p) {
        s->format = f;
        s->swizzle = (f == DXGI_FORMAT_R8G8B8A8_UNORM_SRGB || f == DXGI_FORMAT_R8G8B8A8_UNORM);
        logf("Formato de swapchain: %lld%s", (long long)f, s->swizzle ? " (con conversión RGBA)" : "");
        return true;
      }
    }
  }
  logf("El runtime no ofrece formatos BGRA/RGBA de 8 bits");
  return false;
}

bool ensureSwapchain(Session* s, ViewState& v, uint32_t w, uint32_t h) {
  if (v.swapchain && v.w == w && v.h == h) return true;
  if (v.swapchain) {
    xDestroySwapchain(v.swapchain);
    v = ViewState{};
  }
  if (!s->format && !pickFormat(s)) return false;
  XrSwapchainCreateInfo ci{XR_TYPE_SWAPCHAIN_CREATE_INFO};
  ci.usageFlags = XR_SWAPCHAIN_USAGE_SAMPLED_BIT | XR_SWAPCHAIN_USAGE_COLOR_ATTACHMENT_BIT | XR_SWAPCHAIN_USAGE_TRANSFER_DST_BIT;
  ci.format = s->format;
  ci.sampleCount = 1;
  ci.width = w;
  ci.height = h;
  ci.faceCount = 1;
  ci.arraySize = 1;
  ci.mipCount = 1;
  XrResult r = xCreateSwapchain(s->handle, &ci, &v.swapchain);
  if (XR_FAILED(r)) {
    logf("xrCreateSwapchain falló (%d)", r);
    v.swapchain = XR_NULL_HANDLE;
    return false;
  }
  uint32_t n = 0;
  xEnumerateSwapchainImages(v.swapchain, 0, &n, nullptr);
  v.images.assign(n, XrSwapchainImageD3D11KHR{XR_TYPE_SWAPCHAIN_IMAGE_D3D11_KHR});
  xEnumerateSwapchainImages(v.swapchain, n, &n, reinterpret_cast<XrSwapchainImageBaseHeader*>(v.images.data()));
  v.w = w;
  v.h = h;
  logf("Swapchain %ux%u creada (%u imágenes)", w, h, n);
  return true;
}

void upload(Session* s, ViewState& v, const uint8_t* src) {
  uint32_t index = 0;
  if (XR_FAILED(xAcquireSwapchainImage(v.swapchain, nullptr, &index))) return;
  XrSwapchainImageWaitInfo wi{XR_TYPE_SWAPCHAIN_IMAGE_WAIT_INFO};
  wi.timeout = 50000000;  // 50 ms
  if (XR_SUCCEEDED(xWaitSwapchainImage(v.swapchain, &wi))) {
    const uint8_t* data = src;
    if (s->swizzle) {
      size_t bytes = (size_t)v.w * v.h * 4;
      s->scratch.resize(bytes);
      for (size_t i = 0; i < bytes; i += 4) {
        s->scratch[i] = src[i + 2];
        s->scratch[i + 1] = src[i + 1];
        s->scratch[i + 2] = src[i];
        s->scratch[i + 3] = src[i + 3];
      }
      data = s->scratch.data();
    }
    s->context->UpdateSubresource(v.images[index].texture, 0, nullptr, data, v.w * 4, 0);
    v.hasImage = true;
  }
  XrSwapchainImageReleaseInfo ri{XR_TYPE_SWAPCHAIN_IMAGE_RELEASE_INFO};
  xReleaseSwapchainImage(v.swapchain, &ri);
}

bool locateHead(Session* s, XrTime time, XrPosef* out) {
  XrSpaceLocation loc{XR_TYPE_SPACE_LOCATION};
  if (XR_FAILED(xLocateSpace(s->view, s->local, time, &loc))) return false;
  const XrSpaceLocationFlags need = XR_SPACE_LOCATION_POSITION_VALID_BIT | XR_SPACE_LOCATION_ORIENTATION_VALID_BIT;
  if ((loc.locationFlags & need) != need) return false;
  *out = loc.pose;
  return true;
}

// Prepara las capas del kneeboard. Devuelve cuántas se han rellenado.
uint32_t buildLayers(Session* s, XrTime displayTime, XrCompositionLayerQuad* quads) {
  if (!openShared() || !appAlive()) return 0;
  gShm->layerAlive++;

  XrPosef head;
  bool haveHead = locateHead(s, displayTime, &head);

  if (gShm->recenterSeq != s->lastRecenter) {
    s->lastRecenter = gShm->recenterSeq;
    if (haveHead) {
      // Nuevo origen: posición de la cabeza y solo su guiñada.
      V3 fwd = qrot(head.orientation, {0, 0, -1});
      float yaw = std::atan2(-fwd.x, -fwd.z) * 180.0f / 3.14159265f;
      s->origin.position = head.position;
      s->origin.orientation = qaxis(0, 1, 0, yaw);
      logf("Recentrado (guiñada %.1f°)", yaw);
    }
  }

  uint32_t used = 0;
  uint32_t count = gShm->viewCount < LFKB_MAX_VIEWS ? gShm->viewCount : LFKB_MAX_VIEWS;
  for (uint32_t i = 0; i < count; i++) {
    LfkbView& cfg = gShm->views[i];
    ViewState& v = s->views[i];
    if (!cfg.visible || !cfg.width || !cfg.height || cfg.width > LFKB_MAX_W || cfg.height > LFKB_MAX_H) {
      cfg.gazed = 0;
      // Guardado: la próxima vez que se saque empieza igual que la primera (tamaño normal y animación de entrada).
      v.zoom = 1.0f;
      v.appear = 0.0f;
      continue;
    }
    if (!ensureSwapchain(s, v, cfg.width, cfg.height)) continue;
    uint32_t seq = cfg.seq;
    if (seq != v.lastSeq) {
      MemoryBarrier();
      upload(s, v, lfkbSlot(gShm, i, cfg.front & 1u));
      v.lastSeq = seq;
    }
    if (!v.hasImage) continue;

    XrQuaternionf rot = qmul(qmul(qaxis(0, 1, 0, cfg.rotDeg[0]), qaxis(1, 0, 0, cfg.rotDeg[1])), qaxis(0, 0, 1, cfg.rotDeg[2]));
    XrQuaternionf orient = qmul(s->origin.orientation, rot);
    V3 offset = qrot(s->origin.orientation, {cfg.pos[0], cfg.pos[1], cfg.pos[2]});
    V3 center = V3{s->origin.position.x, s->origin.position.y, s->origin.position.z} + offset;

    float baseW = cfg.widthM > 0.05f ? cfg.widthM : 0.25f;
    float baseH = baseW * (float)cfg.height / (float)cfg.width;

    // ¿Lo está mirando? Rayo desde la cabeza contra el plano del kneeboard.
    bool gazed = false;
    if (haveHead) {
      V3 p{head.position.x, head.position.y, head.position.z};
      V3 f = qrot(head.orientation, {0, 0, -1});
      V3 n = qrot(orient, {0, 0, 1});
      float den = dot(f, n);
      if (std::fabs(den) > 1e-4f) {
        float t = dot(center - p, n) / den;
        if (t > 0) {
          V3 hit = p + f * t - center;
          float lx = dot(hit, qrot(orient, {1, 0, 0}));
          float ly = dot(hit, qrot(orient, {0, 1, 0}));
          gazed = std::fabs(lx) < baseW * v.zoom * 0.55f && std::fabs(ly) < baseH * v.zoom * 0.55f;
        }
      }
    }
    cfg.gazed = gazed ? 1u : 0u;
    float target = (cfg.gazeZoom && gazed && cfg.zoomScale > 1.0f) ? cfg.zoomScale : 1.0f;
    v.zoom += (target - v.zoom) * 0.15f;
    // Al sacarlo sube unos centímetros y crece un poco hasta su sitio (unos 0,25 s).
    v.appear += (1.0f - v.appear) * 0.18f;
    if (v.appear > 0.999f) v.appear = 1.0f;
    float rise = (1.0f - v.appear);
    center = center - qrot(orient, {0, 1, 0}) * (0.06f * rise);
    float grow = 0.94f + 0.06f * v.appear;

    XrCompositionLayerQuad& q = quads[used++];
    q = XrCompositionLayerQuad{XR_TYPE_COMPOSITION_LAYER_QUAD};
    q.layerFlags = XR_COMPOSITION_LAYER_BLEND_TEXTURE_SOURCE_ALPHA_BIT;
    q.space = s->local;
    q.eyeVisibility = XR_EYE_VISIBILITY_BOTH;
    q.subImage.swapchain = v.swapchain;
    q.subImage.imageRect = {{0, 0}, {(int32_t)v.w, (int32_t)v.h}};
    q.subImage.imageArrayIndex = 0;
    q.pose.orientation = orient;
    q.pose.position = {center.x, center.y, center.z};
    q.size = {baseW * v.zoom * grow, baseH * v.zoom * grow};
  }
  // Cruz en el centro de la vista (ligada a la cabeza).
  if (gShm->reticle) {
    if (!s->reticle) {
      XrSwapchainCreateInfo ci{XR_TYPE_SWAPCHAIN_CREATE_INFO};
      ci.usageFlags = XR_SWAPCHAIN_USAGE_SAMPLED_BIT | XR_SWAPCHAIN_USAGE_COLOR_ATTACHMENT_BIT | XR_SWAPCHAIN_USAGE_TRANSFER_DST_BIT;
      if (!s->format) pickFormat(s);
      ci.format = s->format;
      ci.sampleCount = 1;
      ci.width = RETICLE_PX;
      ci.height = RETICLE_PX;
      ci.faceCount = 1;
      ci.arraySize = 1;
      ci.mipCount = 1;
      if (s->format && XR_SUCCEEDED(xCreateSwapchain(s->handle, &ci, &s->reticle))) {
        uint32_t n = 0;
        xEnumerateSwapchainImages(s->reticle, 0, &n, nullptr);
        std::vector<XrSwapchainImageD3D11KHR> imgs(n, XrSwapchainImageD3D11KHR{XR_TYPE_SWAPCHAIN_IMAGE_D3D11_KHR});
        xEnumerateSwapchainImages(s->reticle, n, &n, reinterpret_cast<XrSwapchainImageBaseHeader*>(imgs.data()));
        std::vector<uint8_t> px;
        makeReticle(px, s->swizzle);
        uint32_t index = 0;
        if (XR_SUCCEEDED(xAcquireSwapchainImage(s->reticle, nullptr, &index))) {
          XrSwapchainImageWaitInfo wi{XR_TYPE_SWAPCHAIN_IMAGE_WAIT_INFO};
          wi.timeout = 50000000;
          if (XR_SUCCEEDED(xWaitSwapchainImage(s->reticle, &wi))) {
            s->context->UpdateSubresource(imgs[index].texture, 0, nullptr, px.data(), RETICLE_PX * 4, 0);
            s->reticleReady = true;
          }
          XrSwapchainImageReleaseInfo ri{XR_TYPE_SWAPCHAIN_IMAGE_RELEASE_INFO};
          xReleaseSwapchainImage(s->reticle, &ri);
        }
        logf("Cruz del centro preparada");
      } else {
        s->reticle = XR_NULL_HANDLE;
      }
    }
    if (s->reticleReady) {
      XrCompositionLayerQuad& q = quads[used++];
      q = XrCompositionLayerQuad{XR_TYPE_COMPOSITION_LAYER_QUAD};
      q.layerFlags = XR_COMPOSITION_LAYER_BLEND_TEXTURE_SOURCE_ALPHA_BIT;
      q.space = s->view;
      q.eyeVisibility = XR_EYE_VISIBILITY_BOTH;
      q.subImage.swapchain = s->reticle;
      q.subImage.imageRect = {{0, 0}, {(int32_t)RETICLE_PX, (int32_t)RETICLE_PX}};
      q.pose.orientation.w = 1;
      q.pose.position = {0, 0, -0.8f};
      q.size = {0.045f, 0.045f};
    }
  }
  return used;
}

// ---------------------------------------------------------------- funciones interceptadas
XRAPI_ATTR XrResult XRAPI_CALL hookCreateSession(XrInstance instance, const XrSessionCreateInfo* info, XrSession* session) {
  XrResult r = nextCreateSession(instance, info, session);
  if (XR_FAILED(r)) return r;
  const XrBaseInStructure* it = static_cast<const XrBaseInStructure*>(info->next);
  const XrGraphicsBindingD3D11KHR* d3d = nullptr;
  for (; it; it = it->next) {
    if (it->type == XR_TYPE_GRAPHICS_BINDING_D3D11_KHR) d3d = reinterpret_cast<const XrGraphicsBindingD3D11KHR*>(it);
  }
  if (!d3d) {
    logf("Sesión sin Direct3D 11: el kneeboard no se mostrará en esta sesión");
    return r;
  }
  std::lock_guard<std::mutex> lock(gMutex);
  destroySession(gSession);
  Session* s = new Session();
  s->handle = *session;
  s->device = d3d->device;
  s->device->AddRef();
  s->device->GetImmediateContext(&s->context);
  XrReferenceSpaceCreateInfo rs{XR_TYPE_REFERENCE_SPACE_CREATE_INFO};
  rs.poseInReferenceSpace.orientation.w = 1;
  rs.referenceSpaceType = XR_REFERENCE_SPACE_TYPE_LOCAL;
  xCreateReferenceSpace(*session, &rs, &s->local);
  rs.referenceSpaceType = XR_REFERENCE_SPACE_TYPE_VIEW;
  xCreateReferenceSpace(*session, &rs, &s->view);
  gSession = s;
  logf("Sesión D3D11 creada");
  return r;
}

XRAPI_ATTR XrResult XRAPI_CALL hookDestroySession(XrSession session) {
  {
    std::lock_guard<std::mutex> lock(gMutex);
    if (gSession && gSession->handle == session) {
      destroySession(gSession);
      gSession = nullptr;
      logf("Sesión cerrada");
    }
  }
  return nextDestroySession(session);
}

XRAPI_ATTR XrResult XRAPI_CALL hookEndFrame(XrSession session, const XrFrameEndInfo* info) {
  Session* s = gSession;
  if (!s || s->handle != session || !info) return nextEndFrame(session, info);
  XrCompositionLayerQuad quads[LFKB_MAX_VIEWS + 1];
  uint32_t added = buildLayers(s, info->displayTime, quads);
  if (!added) return nextEndFrame(session, info);
  std::vector<const XrCompositionLayerBaseHeader*> layers(info->layers, info->layers + info->layerCount);
  for (uint32_t i = 0; i < added; i++) layers.push_back(reinterpret_cast<const XrCompositionLayerBaseHeader*>(&quads[i]));
  XrFrameEndInfo copy = *info;
  copy.layerCount = (uint32_t)layers.size();
  copy.layers = layers.data();
  return nextEndFrame(session, &copy);
}

XRAPI_ATTR XrResult XRAPI_CALL hookDestroyInstance(XrInstance instance) {
  {
    std::lock_guard<std::mutex> lock(gMutex);
    destroySession(gSession);
    gSession = nullptr;
  }
  gInstance = XR_NULL_HANDLE;
  return nextDestroyInstance(instance);
}

XRAPI_ATTR XrResult XRAPI_CALL layerGetInstanceProcAddr(XrInstance instance, const char* name, PFN_xrVoidFunction* fn) {
  XrResult r = nextGetInstanceProcAddr(instance, name, fn);
  if (XR_FAILED(r) || !fn || !*fn) return r;
  if (!strcmp(name, "xrGetInstanceProcAddr")) {
    *fn = reinterpret_cast<PFN_xrVoidFunction>(layerGetInstanceProcAddr);
  } else if (!strcmp(name, "xrCreateSession")) {
    nextCreateSession = reinterpret_cast<PFN_xrCreateSession>(*fn);
    *fn = reinterpret_cast<PFN_xrVoidFunction>(hookCreateSession);
  } else if (!strcmp(name, "xrDestroySession")) {
    nextDestroySession = reinterpret_cast<PFN_xrDestroySession>(*fn);
    *fn = reinterpret_cast<PFN_xrVoidFunction>(hookDestroySession);
  } else if (!strcmp(name, "xrEndFrame")) {
    nextEndFrame = reinterpret_cast<PFN_xrEndFrame>(*fn);
    *fn = reinterpret_cast<PFN_xrVoidFunction>(hookEndFrame);
  } else if (!strcmp(name, "xrDestroyInstance")) {
    nextDestroyInstance = reinterpret_cast<PFN_xrDestroyInstance>(*fn);
    *fn = reinterpret_cast<PFN_xrVoidFunction>(hookDestroyInstance);
  }
  return r;
}

template <typename T>
void load(XrInstance inst, const char* name, T& out) {
  PFN_xrVoidFunction f = nullptr;
  nextGetInstanceProcAddr(inst, name, &f);
  out = reinterpret_cast<T>(f);
}

XRAPI_ATTR XrResult XRAPI_CALL layerCreateApiLayerInstance(const XrInstanceCreateInfo* info, const XrApiLayerCreateInfo* layerInfo, XrInstance* instance) {
  if (!layerInfo || !layerInfo->nextInfo) return XR_ERROR_INITIALIZATION_FAILED;
  nextGetInstanceProcAddr = layerInfo->nextInfo->nextGetInstanceProcAddr;
  XrApiLayerCreateInfo nextLayerInfo = *layerInfo;
  nextLayerInfo.nextInfo = layerInfo->nextInfo->next;
  XrResult r = layerInfo->nextInfo->nextCreateApiLayerInstance(info, &nextLayerInfo, instance);
  if (XR_FAILED(r)) return r;
  gInstance = *instance;
  load(gInstance, "xrCreateSession", nextCreateSession);
  load(gInstance, "xrDestroySession", nextDestroySession);
  load(gInstance, "xrEndFrame", nextEndFrame);
  load(gInstance, "xrDestroyInstance", nextDestroyInstance);
  load(gInstance, "xrEnumerateSwapchainFormats", xEnumerateSwapchainFormats);
  load(gInstance, "xrCreateSwapchain", xCreateSwapchain);
  load(gInstance, "xrDestroySwapchain", xDestroySwapchain);
  load(gInstance, "xrEnumerateSwapchainImages", xEnumerateSwapchainImages);
  load(gInstance, "xrAcquireSwapchainImage", xAcquireSwapchainImage);
  load(gInstance, "xrWaitSwapchainImage", xWaitSwapchainImage);
  load(gInstance, "xrReleaseSwapchainImage", xReleaseSwapchainImage);
  load(gInstance, "xrCreateReferenceSpace", xCreateReferenceSpace);
  load(gInstance, "xrDestroySpace", xDestroySpace);
  load(gInstance, "xrLocateSpace", xLocateSpace);
  char exe[MAX_PATH] = {0};
  GetModuleFileNameA(nullptr, exe, MAX_PATH);
  logf("Instancia OpenXR creada en %s (%s)", exe, info->applicationInfo.applicationName);
  HANDLE tok = nullptr;
  if (OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &tok)) {
    TOKEN_ELEVATION el{};
    DWORD n = 0;
    if (GetTokenInformation(tok, TokenElevation, &el, sizeof(el), &n)) {
      logf("DCS %s", el.TokenIsElevated ? "se ejecuta como administrador" : "se ejecuta sin elevar");
    }
    CloseHandle(tok);
  }
  return r;
}

}  // namespace

EXPORT XrResult XRAPI_CALL xrNegotiateLoaderApiLayerInterface(const XrNegotiateLoaderInfo* loaderInfo, const char* layerName, XrNegotiateApiLayerRequest* req) {
  if (!loaderInfo || !req || loaderInfo->structType != XR_LOADER_INTERFACE_STRUCT_LOADER_INFO ||
      req->structType != XR_LOADER_INTERFACE_STRUCT_API_LAYER_REQUEST) {
    return XR_ERROR_INITIALIZATION_FAILED;
  }
  if (layerName && strcmp(layerName, LAYER_NAME) != 0) return XR_ERROR_INITIALIZATION_FAILED;
  if (loaderInfo->minInterfaceVersion > XR_CURRENT_LOADER_API_LAYER_VERSION ||
      loaderInfo->maxInterfaceVersion < XR_CURRENT_LOADER_API_LAYER_VERSION) {
    return XR_ERROR_INITIALIZATION_FAILED;
  }
  req->layerInterfaceVersion = XR_CURRENT_LOADER_API_LAYER_VERSION;
  req->layerApiVersion = XR_MAKE_VERSION(1, 0, 0);
  req->getInstanceProcAddr = layerGetInstanceProcAddr;
  req->createApiLayerInstance = layerCreateApiLayerInstance;
  return XR_SUCCESS;
}
