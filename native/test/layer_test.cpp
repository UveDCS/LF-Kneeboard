// Banco de pruebas de la capa OpenXR sin visor: simula el cargador y un runtime OpenXR con un
// dispositivo Direct3D 11 real, publica un fotograma en la memoria compartida y comprueba que la capa
// añade el quad con el tamaño, la postura y los píxeles correctos, y que detecta la mirada.
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <d3d11.h>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <vector>

#define XR_USE_PLATFORM_WIN32
#define XR_USE_GRAPHICS_API_D3D11
#include <openxr/openxr.h>
#include <openxr/openxr_platform.h>
#include <openxr/openxr_loader_negotiation.h>

#include "../shared/lfkb_shared.h"

static int fails = 0;
#define CHECK(c, ...) do { if (c) printf("OK   "); else { printf("FAIL "); fails++; } printf(__VA_ARGS__); printf("\n"); } while (0)

static ID3D11Device* dev = nullptr;
static ID3D11DeviceContext* ctx = nullptr;
static std::vector<int64_t> offeredFormats;

struct MockSwapchain { std::vector<ID3D11Texture2D*> tex; uint32_t next = 0, w = 0, h = 0; int64_t fmt = 0; };
static std::vector<MockSwapchain*> swapchains;
static XrPosef headPose{{0, 0, 0, 1}, {0, 0, 0}};
static const XrCompositionLayerQuad* lastQuad = nullptr;
static XrCompositionLayerQuad quadCopy;
static uint32_t lastLayerCount = 0;
static MockSwapchain* lastQuadSc = nullptr;
static std::vector<XrCompositionLayerQuad> allQuads;

static XRAPI_ATTR XrResult XRAPI_CALL mCreateSession(XrInstance, const XrSessionCreateInfo*, XrSession* s) { *s = (XrSession)(uintptr_t)0x5e55; return XR_SUCCESS; }
static XRAPI_ATTR XrResult XRAPI_CALL mDestroySession(XrSession) { return XR_SUCCESS; }
static XRAPI_ATTR XrResult XRAPI_CALL mDestroyInstance(XrInstance) { return XR_SUCCESS; }
static XRAPI_ATTR XrResult XRAPI_CALL mEndFrame(XrSession, const XrFrameEndInfo* info) {
  lastLayerCount = info->layerCount;
  lastQuad = nullptr;
  allQuads.clear();
  for (uint32_t i = 0; i < info->layerCount; i++) {
    if (info->layers[i]->type == XR_TYPE_COMPOSITION_LAYER_QUAD) {
      quadCopy = *reinterpret_cast<const XrCompositionLayerQuad*>(info->layers[i]);
      allQuads.push_back(quadCopy);
      lastQuad = &quadCopy;
      lastQuadSc = reinterpret_cast<MockSwapchain*>(quadCopy.subImage.swapchain);
    }
  }
  return XR_SUCCESS;
}
static XRAPI_ATTR XrResult XRAPI_CALL mEnumFormats(XrSession, uint32_t cap, uint32_t* n, int64_t* f) {
  *n = (uint32_t)offeredFormats.size();
  if (cap) for (size_t i = 0; i < offeredFormats.size() && i < cap; i++) f[i] = offeredFormats[i];
  return XR_SUCCESS;
}
static XRAPI_ATTR XrResult XRAPI_CALL mCreateSwapchain(XrSession, const XrSwapchainCreateInfo* ci, XrSwapchain* out) {
  auto* sc = new MockSwapchain();
  sc->w = ci->width; sc->h = ci->height; sc->fmt = ci->format;
  for (int i = 0; i < 3; i++) {
    D3D11_TEXTURE2D_DESC d{};
    d.Width = ci->width; d.Height = ci->height; d.MipLevels = 1; d.ArraySize = 1;
    d.Format = (DXGI_FORMAT)ci->format; d.SampleDesc.Count = 1; d.Usage = D3D11_USAGE_DEFAULT;
    d.BindFlags = D3D11_BIND_SHADER_RESOURCE | D3D11_BIND_RENDER_TARGET;
    ID3D11Texture2D* t = nullptr;
    if (FAILED(dev->CreateTexture2D(&d, nullptr, &t))) return XR_ERROR_RUNTIME_FAILURE;
    sc->tex.push_back(t);
  }
  swapchains.push_back(sc);
  *out = reinterpret_cast<XrSwapchain>(sc);
  return XR_SUCCESS;
}
static XRAPI_ATTR XrResult XRAPI_CALL mDestroySwapchain(XrSwapchain) { return XR_SUCCESS; }
static XRAPI_ATTR XrResult XRAPI_CALL mEnumImages(XrSwapchain s, uint32_t cap, uint32_t* n, XrSwapchainImageBaseHeader* imgs) {
  auto* sc = reinterpret_cast<MockSwapchain*>(s);
  *n = (uint32_t)sc->tex.size();
  if (cap) for (uint32_t i = 0; i < *n; i++) reinterpret_cast<XrSwapchainImageD3D11KHR*>(imgs)[i].texture = sc->tex[i];
  return XR_SUCCESS;
}
static XRAPI_ATTR XrResult XRAPI_CALL mAcquire(XrSwapchain s, const XrSwapchainImageAcquireInfo*, uint32_t* idx) {
  auto* sc = reinterpret_cast<MockSwapchain*>(s);
  *idx = sc->next; sc->next = (sc->next + 1) % sc->tex.size();
  return XR_SUCCESS;
}
static XRAPI_ATTR XrResult XRAPI_CALL mWait(XrSwapchain, const XrSwapchainImageWaitInfo*) { return XR_SUCCESS; }
static XRAPI_ATTR XrResult XRAPI_CALL mRelease(XrSwapchain, const XrSwapchainImageReleaseInfo*) { return XR_SUCCESS; }
static XRAPI_ATTR XrResult XRAPI_CALL mCreateSpace(XrSession, const XrReferenceSpaceCreateInfo* ci, XrSpace* s) {
  *s = (XrSpace)(uintptr_t)(0x100 + ci->referenceSpaceType); return XR_SUCCESS;
}
static XRAPI_ATTR XrResult XRAPI_CALL mDestroySpace(XrSpace) { return XR_SUCCESS; }
static XRAPI_ATTR XrResult XRAPI_CALL mLocateSpace(XrSpace, XrSpace, XrTime, XrSpaceLocation* loc) {
  loc->locationFlags = XR_SPACE_LOCATION_POSITION_VALID_BIT | XR_SPACE_LOCATION_ORIENTATION_VALID_BIT;
  loc->pose = headPose;
  return XR_SUCCESS;
}

static XRAPI_ATTR XrResult XRAPI_CALL mGetProcAddr(XrInstance, const char* name, PFN_xrVoidFunction* fn) {
  struct { const char* n; void* f; } table[] = {
    {"xrCreateSession", (void*)mCreateSession}, {"xrDestroySession", (void*)mDestroySession},
    {"xrEndFrame", (void*)mEndFrame}, {"xrDestroyInstance", (void*)mDestroyInstance},
    {"xrEnumerateSwapchainFormats", (void*)mEnumFormats}, {"xrCreateSwapchain", (void*)mCreateSwapchain},
    {"xrDestroySwapchain", (void*)mDestroySwapchain}, {"xrEnumerateSwapchainImages", (void*)mEnumImages},
    {"xrAcquireSwapchainImage", (void*)mAcquire}, {"xrWaitSwapchainImage", (void*)mWait},
    {"xrReleaseSwapchainImage", (void*)mRelease}, {"xrCreateReferenceSpace", (void*)mCreateSpace},
    {"xrDestroySpace", (void*)mDestroySpace}, {"xrLocateSpace", (void*)mLocateSpace},
    {"xrGetInstanceProcAddr", (void*)mGetProcAddr},
  };
  for (auto& e : table) if (!strcmp(e.n, name)) { *fn = (PFN_xrVoidFunction)e.f; return XR_SUCCESS; }
  *fn = nullptr;
  return XR_ERROR_FUNCTION_UNSUPPORTED;
}
static XRAPI_ATTR XrResult XRAPI_CALL mCreateApiLayerInstance(const XrInstanceCreateInfo*, const XrApiLayerCreateInfo*, XrInstance* inst) {
  *inst = (XrInstance)(uintptr_t)0x1234; return XR_SUCCESS;
}

static uint32_t readPixel(ID3D11Texture2D* tex, uint32_t x, uint32_t y) {
  D3D11_TEXTURE2D_DESC d; tex->GetDesc(&d);
  d.Usage = D3D11_USAGE_STAGING; d.BindFlags = 0; d.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
  ID3D11Texture2D* st = nullptr;
  dev->CreateTexture2D(&d, nullptr, &st);
  ctx->CopyResource(st, tex);
  D3D11_MAPPED_SUBRESOURCE m;
  ctx->Map(st, 0, D3D11_MAP_READ, 0, &m);
  uint32_t v = *reinterpret_cast<uint32_t*>((uint8_t*)m.pData + y * m.RowPitch + x * 4);
  ctx->Unmap(st, 0);
  st->Release();
  return v;
}

int main(int argc, char** argv) {
  const char* dllPath = argc > 1 ? argv[1] : "native/bin/lfkb_openxr_layer.dll";
  D3D_FEATURE_LEVEL fl;
  HRESULT hr = D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, 0, nullptr, 0, D3D11_SDK_VERSION, &dev, &fl, &ctx);
  if (FAILED(hr)) hr = D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_WARP, nullptr, 0, nullptr, 0, D3D11_SDK_VERSION, &dev, &fl, &ctx);
  CHECK(SUCCEEDED(hr), "Dispositivo D3D11 creado");

  // Memoria compartida con un fotograma de prueba (como haría la app)
  HANDLE map = CreateFileMappingW(INVALID_HANDLE_VALUE, nullptr, PAGE_READWRITE, 0, LFKB_TOTAL_BYTES, LFKB_SHM_NAME);
  auto* shm = (LfkbHeader*)MapViewOfFile(map, FILE_MAP_ALL_ACCESS, 0, 0, LFKB_TOTAL_BYTES);
  CHECK(shm != nullptr, "Memoria compartida creada (%u MB)", LFKB_TOTAL_BYTES >> 20);
  shm->magic = LFKB_MAGIC; shm->version = LFKB_VERSION; shm->viewCount = 2; shm->heartbeat = 1;
  const uint32_t W = 64, H = 96;
  LfkbView& v = shm->views[0];
  v.width = W; v.height = H; v.visible = 1; v.front = 0;
  v.pos[0] = 0.13f; v.pos[1] = -0.36f; v.pos[2] = -0.42f;
  v.rotDeg[0] = 0; v.rotDeg[1] = -48; v.rotDeg[2] = 0;
  v.widthM = 0.24f; v.zoomScale = 1.6f; v.gazeZoom = 1;
  uint32_t* px = (uint32_t*)lfkbSlot(shm, 0, 0);
  for (uint32_t i = 0; i < W * H; i++) px[i] = 0xFF2040C0u;  // BGRA en memoria: C0 40 20 FF
  px[5 * W + 7] = 0xFF00FF00u;
  v.seq = 1;

  // Cargador simulado
  HMODULE dll = LoadLibraryA(dllPath);
  CHECK(dll != nullptr, "DLL cargada: %s", dllPath);
  auto negotiate = (PFN_xrNegotiateLoaderApiLayerInterface)(void*)GetProcAddress(dll, "xrNegotiateLoaderApiLayerInterface");
  CHECK(negotiate != nullptr, "Exporta xrNegotiateLoaderApiLayerInterface");
  XrNegotiateLoaderInfo li{XR_LOADER_INTERFACE_STRUCT_LOADER_INFO, XR_LOADER_INFO_STRUCT_VERSION, sizeof(li), 1, 1, XR_MAKE_VERSION(1, 0, 0), XR_MAKE_VERSION(1, 1, 0)};
  XrNegotiateApiLayerRequest req{XR_LOADER_INTERFACE_STRUCT_API_LAYER_REQUEST, XR_API_LAYER_INFO_STRUCT_VERSION, sizeof(req)};
  CHECK(negotiate(&li, "XR_APILAYER_LAFUNDACION_kneeboard", &req) == XR_SUCCESS, "Negociación con el cargador");

  XrApiLayerNextInfo next{XR_LOADER_INTERFACE_STRUCT_API_LAYER_NEXT_INFO, XR_API_LAYER_NEXT_INFO_STRUCT_VERSION, sizeof(next)};
  strcpy(next.layerName, "XR_APILAYER_LAFUNDACION_kneeboard");
  next.nextGetInstanceProcAddr = mGetProcAddr;
  next.nextCreateApiLayerInstance = mCreateApiLayerInstance;
  XrApiLayerCreateInfo lci{XR_LOADER_INTERFACE_STRUCT_API_LAYER_CREATE_INFO, XR_API_LAYER_CREATE_INFO_STRUCT_VERSION, sizeof(lci)};
  lci.nextInfo = &next;
  XrInstanceCreateInfo ici{XR_TYPE_INSTANCE_CREATE_INFO};
  strcpy(ici.applicationInfo.applicationName, "DCS World (prueba)");
  XrInstance inst;
  CHECK(req.createApiLayerInstance(&ici, &lci, &inst) == XR_SUCCESS, "Instancia creada a través de la capa");

  PFN_xrCreateSession createSession; PFN_xrEndFrame endFrame;
  req.getInstanceProcAddr(inst, "xrCreateSession", (PFN_xrVoidFunction*)&createSession);
  req.getInstanceProcAddr(inst, "xrEndFrame", (PFN_xrVoidFunction*)&endFrame);
  CHECK((void*)endFrame != (void*)mEndFrame, "xrEndFrame interceptado por la capa");

  for (int round = 0; round < 2; round++) {
    offeredFormats = round == 0 ? std::vector<int64_t>{DXGI_FORMAT_B8G8R8A8_UNORM_SRGB, DXGI_FORMAT_R8G8B8A8_UNORM_SRGB}
                                : std::vector<int64_t>{DXGI_FORMAT_R8G8B8A8_UNORM_SRGB};
    XrGraphicsBindingD3D11KHR bind{XR_TYPE_GRAPHICS_BINDING_D3D11_KHR};
    bind.device = dev;
    XrSessionCreateInfo sci{XR_TYPE_SESSION_CREATE_INFO};
    sci.next = &bind;
    XrSession session;
    CHECK(createSession(inst, &sci, &session) == XR_SUCCESS, "[%s] Sesión D3D11 creada", round ? "RGBA" : "BGRA");

    XrCompositionLayerProjection proj{XR_TYPE_COMPOSITION_LAYER_PROJECTION};
    const XrCompositionLayerBaseHeader* layers[] = {(XrCompositionLayerBaseHeader*)&proj};
    XrFrameEndInfo fei{XR_TYPE_FRAME_END_INFO};
    fei.displayTime = 1000; fei.layerCount = 1; fei.layers = layers;
    headPose = XrPosef{{0, 0, 0, 1}, {0, 0, 0}};
    float firstW = 0;
    for (int i = 0; i < 60; i++) { shm->heartbeat++; endFrame(session, &fei); if (i == 0 && lastQuad) firstW = lastQuad->size.width; Sleep(1); }
    CHECK(firstW > 0.2f && firstW < 0.235f, "Al sacarlo entra con su animación (%.3f m en el primer fotograma)", firstW);
    CHECK(lastLayerCount == 2 && lastQuad, "[%s] Se añade 1 capa quad a la proyección de DCS (%u capas)", round ? "RGBA" : "BGRA", lastLayerCount);
    if (lastQuad) {
      float expH = 0.24f * H / W;
      CHECK(std::fabs(lastQuad->size.width - 0.24f) < 1e-3f && std::fabs(lastQuad->size.height - expH) < 1e-3f,
            "Tamaño del quad %.3f x %.3f m", lastQuad->size.width, lastQuad->size.height);
      CHECK(std::fabs(lastQuad->pose.position.x - 0.13f) < 1e-3f && std::fabs(lastQuad->pose.position.y + 0.36f) < 1e-3f && std::fabs(lastQuad->pose.position.z + 0.42f) < 1e-3f,
            "Posición del quad (%.2f, %.2f, %.2f)", lastQuad->pose.position.x, lastQuad->pose.position.y, lastQuad->pose.position.z);
      CHECK(lastQuad->subImage.imageRect.extent.width == (int)W && lastQuad->subImage.imageRect.extent.height == (int)H, "Rectángulo de imagen %dx%d",
            lastQuad->subImage.imageRect.extent.width, lastQuad->subImage.imageRect.extent.height);
      CHECK(shm->views[0].gazed == 0, "Mirando al frente: no cuenta como mirarlo");
      MockSwapchain* sc = lastQuadSc;
      uint32_t p0 = readPixel(sc->tex[0], 0, 0), p1 = readPixel(sc->tex[0], 7, 5);
      uint32_t want0 = sc->fmt == DXGI_FORMAT_R8G8B8A8_UNORM_SRGB ? 0xFFC04020u : 0xFF2040C0u;
      uint32_t want1 = 0xFF00FF00u;
      CHECK(p0 == want0 && p1 == want1, "Píxeles subidos a la textura del visor (%08X, %08X)", p0, p1);
    }
    // Mirar hacia el kneeboard: girar la cabeza hacia abajo y a la derecha
    float dx = 0.13f, dy = -0.36f, dz = -0.42f;
    float yaw = std::atan2(-dx, -dz), pitch = std::atan2(dy, std::sqrt(dx * dx + dz * dz));
    auto q = [](float ax, float ay, float az, float rad) { float s = std::sin(rad / 2); return XrQuaternionf{ax * s, ay * s, az * s, std::cos(rad / 2)}; };
    XrQuaternionf qy = q(0, 1, 0, yaw), qp = q(1, 0, 0, pitch);
    headPose.orientation = XrQuaternionf{
      qy.w * qp.x + qy.x * qp.w + qy.y * qp.z - qy.z * qp.y,
      qy.w * qp.y - qy.x * qp.z + qy.y * qp.w + qy.z * qp.x,
      qy.w * qp.z + qy.x * qp.y - qy.y * qp.x + qy.z * qp.w,
      qy.w * qp.w - qy.x * qp.x - qy.y * qp.y - qy.z * qp.z};
    for (int i = 0; i < 40; i++) { shm->heartbeat++; endFrame(session, &fei); }
    CHECK(shm->views[0].gazed == 1, "Mirando al kneeboard: se detecta la mirada");
    CHECK(lastQuad && lastQuad->size.width > 0.24f * 1.5f, "Zoom al mirarlo: ancho %.3f m", lastQuad ? lastQuad->size.width : 0);

    // Cruz del centro de la vista
    shm->reticle = 1;
    shm->heartbeat++;
    endFrame(session, &fei);
    const XrCompositionLayerQuad* ret = nullptr;
    for (auto& q : allQuads) if (q.space == (XrSpace)(uintptr_t)(0x100 + XR_REFERENCE_SPACE_TYPE_VIEW)) ret = &q;
    CHECK(ret && lastLayerCount == 3 && std::fabs(ret->size.width - 0.045f) < 1e-4f && std::fabs(ret->pose.position.z + 0.8f) < 1e-4f,
          "Cruz del centro: capa ligada a la cabeza (%u capas)", lastLayerCount);
    if (ret) {
      auto* rsc = reinterpret_cast<MockSwapchain*>(ret->subImage.swapchain);
      uint32_t c = readPixel(rsc->tex[0], 31, 20), bg = readPixel(rsc->tex[0], 2, 2);
      uint32_t red = rsc->fmt == DXGI_FORMAT_R8G8B8A8_UNORM_SRGB ? 0xFF552DFFu : 0xFFFF2D55u;
      CHECK(c == red && (bg >> 24) == 0, "Cruz roja con fondo transparente (%08X, %08X)", c, bg);
    }
    shm->reticle = 0;
    endFrame(session, &fei);
    CHECK(lastLayerCount == 2, "Sin cruz cuando la app no la pide");
    // Ocultarlo
    shm->views[0].visible = 0;
    endFrame(session, &fei);
    CHECK(lastLayerCount == 1, "Oculto: la capa no se añade");
    shm->views[0].visible = 1;
    // Volver a sacarlo mirándolo: empieza igual que la primera vez (sin el zoom de antes) y se amplía poco a poco.
    shm->heartbeat++;
    endFrame(session, &fei);
    CHECK(lastQuad && lastQuad->size.width < 0.24f * 1.2f, "Al sacarlo otra vez no aparece ya ampliado (%.3f m)", lastQuad ? lastQuad->size.width : 0);
    for (int i = 0; i < 60; i++) { shm->heartbeat++; endFrame(session, &fei); }
    CHECK(lastQuad && lastQuad->size.width > 0.24f * 1.5f, "y luego se amplía al mirarlo (%.3f m)", lastQuad ? lastQuad->size.width : 0);

    // App cerrada (sin latido): deja de pintarse
    for (int i = 0; i < 2; i++) endFrame(session, &fei);
    Sleep(3200);
    endFrame(session, &fei);
    CHECK(lastLayerCount == 1, "Sin la app abierta: DCS no se ve afectado");
    PFN_xrDestroySession destroySession;
    req.getInstanceProcAddr(inst, "xrDestroySession", (PFN_xrVoidFunction*)&destroySession);
    destroySession(session);
    shm->heartbeat++;
  }
  printf(fails ? "\n%d fallos\n" : "\nTodo correcto\n", fails);
  return fails ? 1 : 0;
}
