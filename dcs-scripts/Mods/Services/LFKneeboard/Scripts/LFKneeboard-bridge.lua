-- LF Kneeboard: puente en el Lua de la interfaz de DCS. Los scripts de Scripts\Hooks corren en otro Lua y no ven
-- la herramienta de ruta del F10 («Show Route Tool») ni el editor de DTC del juego; aquí sí están.
-- Envía a la aplicación, por UDP local, la ruta de la herramienta cuando se activa y lo que tenga el editor de DTC
-- al cerrarlo (aunque no se haya guardado). Lo carga Options/optionsDb.lua de este mod.

if LFKB_BRIDGE then return end
LFKB_BRIDGE = { version = 4, appPort = 7788 }

local ok, err = pcall(function()
  local lfs = require('lfs')
  package.cpath = package.cpath .. ';.\\LuaSocket\\?.dll'
  package.path = package.path .. ';.\\LuaSocket\\?.lua'
  local socket = require('socket')
  local UpdateManager = require('UpdateManager')
  local DCSAPI = require('DCS')

  local out = socket.udp()
  out:settimeout(0)

  local JSON = nil
  local function encode(t)
    if net and net.lua2json then return net.lua2json(t) end
    JSON = JSON or dofile('Scripts/JSON.lua')
    return JSON:encode(t)
  end
  local function send(t)
    pcall(function() out:sendto(encode(t), '127.0.0.1', LFKB_BRIDGE.appPort) end)
  end
  -- Al dcs.log (print no llega desde este Lua).
  local function log(msg)
    local okW = pcall(function() _G.log.write('LF Kneeboard', _G.log.INFO or 3, tostring(msg)) end)
    if not okW then pcall(function() print('[LF Kneeboard] ' .. tostring(msg)) end) end
  end

  local function playerType()
    local t = nil
    pcall(function() t = DCSAPI.getPlayerUnitType() end)
    return t
  end

  -- Herramienta de ruta del F10: su ruta, si el piloto la ha activado para sustituir la de la misión.
  local lastTool = nil
  local function routeTool()
    local RT = package.loaded['RouteTool']
    if type(RT) ~= 'table' or type(RT.isRouteSubstitutionActivated) ~= 'function' then return false end
    local pts, sig = {}, ''
    if RT.isRouteSubstitutionActivated() then
      for _, p in ipairs(RT.getSelectedRoute() or {}) do
        if type(p.x) == 'number' and type(p.y) == 'number' then
          pts[#pts + 1] = { x = p.x, y = p.y, alt = p.alt, altType = p.alt_type, name = p.name, eta = p.ETA }
          sig = sig .. string.format('%.0f,%.0f,%s,%s,%s;', p.x, p.y, tostring(p.alt), tostring(p.ETA), tostring(p.name))
        end
      end
    end
    if sig ~= lastTool then
      lastTool = sig
      send({ t = 'routetool', pts = pts })
    end
    return true
  end

  -- Editor de DTC del juego (botón DTC del briefing o de la elección de plaza): al cerrarlo se lee su contenido.
  -- El panel del editor no es un módulo: DCS lo carga con un entorno propio y no está a la vista por nombre,
  -- y en este Lua no hay librería debug. Pero al abrirse, el panel pasa funciones suyas a dos sitios que sí
  -- vemos: UpdateManager.add (las actualizaciones que registra el avión) y DTC_manager_Map.setupDescriptorCallbacks
  -- (las funciones del mapa del editor). Se interceptan esas dos llamadas y, con getfenv (Lua básico), se llega
  -- al entorno del panel (getData/getVisible) o al del avión (returnData/isDTCVisible). Solo se lee.
  -- dtcProbe dice hasta dónde se llega (dcs.log y Ajustes > Integración DCS).
  local dtcProbe = 'esperando a que abras el editor'
  local cachedPanel = nil
  local editorWasOpen, lastEditor, lastEditorPath = false, nil, nil

  local function setProbe(p)
    if p ~= dtcProbe then log('editor de DTC: ' .. p) end
    dtcProbe = p
  end

  -- Panel uniforme a partir del entorno que se haya alcanzado.
  local function panelFromEnv(env, via)
    if type(env) ~= 'table' then return nil end
    local getData = rawget(env, 'getData') or rawget(env, 'returnData')
    local visible = rawget(env, 'getVisible') or rawget(env, 'isDTCVisible')
    if type(getData) ~= 'function' or type(visible) ~= 'function' then return nil end
    return {
      via = via,
      getVisible = function() return visible() and true or false end,
      getDataJson = function() return encode({ name = '', type = '', data = getData() }) end,
    }
  end

  local function capture(fn, via)
    if type(fn) ~= 'function' or type(getfenv) ~= 'function' then return end
    local okE, env = pcall(getfenv, fn)
    if not okE or env == _G then return end   -- las funciones normales de la interfaz (y la nuestra)
    local panel = panelFromEnv(env, via)
    if not panel and type(env) == 'table' then
      -- Funciones del avión: su entorno tiene isDTCVisible, que es del panel; el de esta, el del panel.
      local f2 = rawget(env, 'isDTCVisible')
      if type(f2) == 'function' then
        local okE2, env2 = pcall(getfenv, f2)
        if okE2 then panel = panelFromEnv(env2, via) end
      end
      panel = panel or panelFromEnv(env, via)
    end
    if panel then
      cachedPanel = panel
      setProbe('ok (' .. via .. ')')
    end
  end

  if type(getfenv) ~= 'function' then
    dtcProbe = 'sin getfenv'
  else
    -- UpdateManager: el panel registra aquí, al mostrarse, las actualizaciones del avión.
    local UM = package.loaded['UpdateManager'] or UpdateManager
    if type(UM) == 'table' and type(UM.add) == 'function' and not UM.__lfkb then
      local origAdd = UM.add
      UM.add = function(f, ...)
        pcall(capture, f, 'UpdateManager')
        return origAdd(f, ...)
      end
      UM.__lfkb = true
    end
    -- Mapa del editor: hay que tenerlo cargado antes de que se abra el editor (el panel copia sus funciones).
    local okM, M = pcall(require, 'DTC_manager_Map')
    if okM and type(M) == 'table' and type(M.setupDescriptorCallbacks) == 'function' and not M.__lfkb then
      local orig = M.setupDescriptorCallbacks
      M.setupDescriptorCallbacks = function(a, ...)
        pcall(capture, a, 'mapa')
        return orig(a, ...)
      end
      M.__lfkb = true
    end
    log('editor de DTC: esperando a que lo abras (UpdateManager ' .. tostring(UM and UM.__lfkb or false)
      .. ', mapa ' .. tostring(okM and M and M.__lfkb or false) .. ')')
  end

  local function dtcPanel()
    return cachedPanel
  end

  local function dtcEditor(force)
    local p = dtcPanel()
    if not p then return false end
    local open = false
    pcall(function() open = p.getVisible and p.getVisible() or false end)
    if open then
      if not editorWasOpen then log('editor de DTC abierto') end
      editorWasOpen = true
      return true
    end
    if not editorWasOpen and not force then return true end
    editorWasOpen = false
    local okJ, json = pcall(p.getDataJson)
    if not okJ or type(json) ~= 'string' or json == '' then return true end
    if json == lastEditor and not force then return true end
    lastEditor = json
    local dir = lfs.writedir() .. 'Temp\\LFKneeboard'
    lfs.mkdir(lfs.writedir() .. 'Temp')
    lfs.mkdir(dir)
    local path = dir .. '\\dtc-editor.json'
    local f = io.open(path, 'w')
    if not f then return true end
    f:write(json)
    f:close()
    lastEditorPath = path
    log(string.format('editor de DTC cerrado: %d bytes enviados al kneeboard', #json))
    send({ t = 'dtceditor', json = path, type = playerType() })
    return true
  end

  -- Misión nueva: lo de la herramienta de ruta y del editor era de la anterior.
  local lastMission = nil
  local function missionChanged()
    local name = nil
    pcall(function() name = DCSAPI.getMissionFilename() end)
    if name == lastMission then return end
    lastMission = name
    lastTool, lastEditor, lastEditorPath, editorWasOpen = nil, nil, nil, false
  end

  -- Señal de vida cada 5 s con lo que encuentra (Ajustes > Integración DCS). Con ella se repiten la ruta y el
  -- DTC del editor, por si la aplicación se abrió después (la aplicación ignora lo que ya tenía).
  local lastBeat, lastTick = 0, 0
  local function tick()
    local now = socket.gettime()
    if now - lastTick < 1 then return end
    lastTick = now
    missionChanged()
    local okT, tool = pcall(routeTool)
    local okE, editor = pcall(dtcEditor, false)
    if not okT then log(tool) tool = false end
    if not okE then log(editor) editor = false end
    if now - lastBeat >= 5 then
      lastBeat = now
      send({ t = 'bridge', version = LFKB_BRIDGE.version, routeTool = tool, dtcEditor = editor, dtcProbe = dtcProbe })
      lastTool = nil
      if lastEditorPath then send({ t = 'dtceditor', json = lastEditorPath, type = playerType() }) end
    end
  end

  UpdateManager.add(function()
    pcall(tick)
  end)
  log('puente cargado (versión ' .. LFKB_BRIDGE.version .. ')')
end)

if not ok then pcall(function() print('[LF Kneeboard] error al cargar el puente: ' .. tostring(err)) end) end
