-- LF Kneeboard: envía a la aplicación el estado del vuelo y responde a sus peticiones
-- (coordenadas del punto central del mapa F10, conversión de coordenadas).
-- No modifica Export.lua: convive con DCS-BIOS, Tacview, SRS, OpenKneeboard, etc.
-- Lo instala y lo quita la propia aplicación (Ajustes > DCS).

local LFKB = { version = 1, appPort = 7788, hookPort = 7789 }

local ok, err = pcall(function()
  package.path = package.path .. ';.\\LuaSocket\\?.lua'
  package.cpath = package.cpath .. ';.\\LuaSocket\\?.dll'
  local socket = require('socket')
  local lfs = require('lfs')
  local Terrain = require('terrain')

  local out = socket.udp()
  out:settimeout(0)
  local inp = socket.udp()
  inp:settimeout(0)
  inp:setsockname('127.0.0.1', LFKB.hookPort)

  local function send(t)
    pcall(function()
      out:sendto(net.lua2json(t), '127.0.0.1', LFKB.appPort)
    end)
  end

  local function log(msg)
    pcall(function() net.log('[LF Kneeboard] ' .. tostring(msg)) end)
  end

  local function identity()
    local id = {}
    pcall(function()
      if DCS.isMultiplayer() then
        local slot = net.get_player_info(net.get_my_player_id(), 'slot')
        if slot and slot ~= '' then
          id.unit = DCS.getUnitProperty(slot, DCS.UNIT_NAME)
          id.group = DCS.getUnitProperty(slot, DCS.UNIT_GROUPNAME)
          id.type = DCS.getUnitProperty(slot, DCS.UNIT_TYPE)
          id.callsign = DCS.getUnitProperty(slot, DCS.UNIT_CALLSIGN)
        end
      end
    end)
    if not id.type then
      -- Un jugador en el briefing todavía no tiene LoGetSelfData: su plaza sí se sabe.
      pcall(function()
        local u = DCS.getPlayerUnit()
        if u then id.type = DCS.getUnitProperty(u, DCS.UNIT_TYPE) end
      end)
    end
    local selfData = Export.LoGetSelfData()
    if selfData then
      id.type = id.type or selfData.Name
      id.unit = id.unit or selfData.UnitName
      id.group = id.group or selfData.GroupName
      id.coal = selfData.CoalitionID
    end
    return id
  end

  local function sendMission()
    local info = { t = 'mission', mp = DCS.isMultiplayer() }
    pcall(function() info.miz = DCS.getMissionFilename() end)
    pcall(function() info.name = DCS.getMissionName() end)
    pcall(function()
      local m = DCS.getCurrentMission()
      if m and m.mission then
        info.theatre = m.mission.theatre
        local dir = lfs.writedir() .. 'Temp\\LFKneeboard'
        lfs.mkdir(lfs.writedir() .. 'Temp')
        lfs.mkdir(dir)
        local path = dir .. '\\mission.json'
        local f = io.open(path, 'w')
        if f then
          f:write(net.lua2json(m.mission))
          f:close()
          info.json = path
        end
      end
    end)
    info.id = identity()
    send(info)
  end

  -- Datos de la cámara para saber si el piloto mira el mapa F10 (experimental):
  -- en el F10 la cámara está muy alta y lejos del avión. Se envían también los valores en bruto
  -- para poder ver en Ajustes > Integración DCS qué detecta.
  local function cameraInfo(cam)
    if not cam or not cam.p then return nil end
    local ground = 0
    pcall(function() ground = Terrain.GetSurfaceHeightWithSeabed(cam.p.x, cam.p.z) end)
    local info = { agl = cam.p.y - ground, dist = -1 }
    pcall(function()
      local s = Export.LoGetSelfData()
      if s and s.Position then
        local px, py, pz = s.Position.x, s.Position.y or cam.p.y, s.Position.z
        info.dist = math.sqrt((cam.p.x - px) ^ 2 + (cam.p.y - py) ^ 2 + (cam.p.z - pz) ^ 2)
      end
    end)
    pcall(function() info.fy = cam.x.y; info.uy = cam.y.y end)
    info.mapView = info.agl > 4000 and (info.dist < 0 or info.dist > 4000)
    return info
  end

  local function cameraPoint()
    local cam = Export.LoGetCameraPosition()
    if not cam or not cam.p then return nil end
    local x, z = cam.p.x, cam.p.z
    local lat, lon = Terrain.convertMetersToLatLon(x, z)
    local pt = { lat = lat, lon = lon, x = x, z = z }
    pcall(function() pt.alt = Terrain.GetSurfaceHeightWithSeabed(x, z) end)
    pcall(function() pt.mgrs = Terrain.GetMGRScoordinates(x, z) end)
    local ci = cameraInfo(cam)
    pt.mapView = ci and ci.mapView or false
    return pt
  end

  local resendPlan = false   -- la aplicación ha pedido la misión (se acaba de abrir): repetir el diagnóstico

  -- Prueba (a petición, desde Ajustes): ¿se puede leer el texto de los kneeboards dinámicos de los módulos
  -- (Viggen…)? Esos textos los rellena el módulo en sus indicadores; aquí se mira qué da list_indication.
  local function kneeboardProbe()
    local fn = nil
    local where = 'ninguno'
    if type(list_indication) == 'function' then fn, where = list_indication, 'global'
    elseif type(Export) == 'table' and type(Export.list_indication) == 'function' then fn, where = Export.list_indication, 'Export'
    end
    local lines, found = {}, 0
    lines[#lines + 1] = 'list_indication: ' .. where
    pcall(function()
      local s = Export.LoGetSelfData()
      lines[#lines + 1] = 'avion: ' .. tostring(s and s.Name)
    end)
    if type(Export) == 'table' then
      local names = {}
      for k in pairs(Export) do if tostring(k):lower():find('indic') or tostring(k):lower():find('device') then names[#names + 1] = tostring(k) end end
      lines[#lines + 1] = 'Export (indic/device): ' .. table.concat(names, ', ')
    end
    if fn then
      for i = 0, 40 do
        local okL, txt = pcall(fn, i)
        if okL and type(txt) == 'string' and txt ~= '' then
          found = found + 1
          lines[#lines + 1] = string.format('===== indicador %d (%d caracteres)', i, #txt)
          lines[#lines + 1] = txt
        end
      end
    end
    local dir = lfs.writedir() .. 'Temp\\LFKneeboard'
    lfs.mkdir(lfs.writedir() .. 'Temp')
    lfs.mkdir(dir)
    local path = dir .. '\\kneeboard-probe.txt'
    local f = io.open(path, 'w')
    if f then f:write(table.concat(lines, '\n')) f:close() end
    log(string.format('prueba del kneeboard del módulo: list_indication %s, %d indicadores con texto', where, found))
    return { where = where, found = found, path = path }
  end

  local function handle(cmd)
    if cmd.cmd == 'capture' then
      local pt = cameraPoint()
      send({ t = 'coords', id = cmd.id, point = pt })
    elseif cmd.cmd == 'convert' and type(cmd.pts) == 'table' then
      local res = {}
      for i, p in ipairs(cmd.pts) do
        local lat, lon = Terrain.convertMetersToLatLon(p[1], p[2])
        res[i] = { lat, lon }
      end
      send({ t = 'converted', id = cmd.id, pts = res })
    elseif cmd.cmd == 'ping' then
      send({ t = 'pong', version = LFKB.version })
    elseif cmd.cmd == 'kbprobe' then
      local r = kneeboardProbe()
      send({ t = 'kbprobe', id = cmd.id, where = r.where, found = r.found, path = r.path })
    elseif cmd.cmd == 'mission' then
      sendMission()
      resendPlan = true
    end
  end

  local function readCommands()
    for _ = 1, 10 do
      local data = inp:receive()
      if not data then return end
      local okDecode, cmd = pcall(net.json2lua, data)
      if okDecode and type(cmd) == 'table' then
        local okRun, e = pcall(handle, cmd)
        if not okRun then log(e) end
      end
    end
  end

  -- Ruta que lleva el avión y su punto activo (LoGetRoute). No todos los aviones de DCS la dan.
  local lastRoute = 0
  local function sendRoute()
    local r = Export.LoGetRoute()
    if type(r) ~= 'table' or type(r.route) ~= 'table' then return end
    local pts, goto = {}, nil
    local gp = r.goto_point and r.goto_point.world_point
    for i, p in ipairs(r.route) do
      local wp = p.world_point
      if wp then
        pts[#pts + 1] = { x = wp.x, y = wp.y, z = wp.z }
        if gp and math.abs(wp.x - gp.x) < 1 and math.abs(wp.z - gp.z) < 1 then goto = #pts - 1 end
      end
    end
    if #pts >= 2 then send({ t = 'route', pts = pts, goto = goto }) end
  end

  -- Diagnóstico: cuántos puntos da LoGetRoute para este avión (la herramienta de ruta del F10 y el editor de DTC
  -- del juego no se ven desde aquí; los manda el puente del mod Mods\Services\LFKneeboard).
  local lastSources = nil
  local function sendPlanSources()
    if resendPlan then
      resendPlan = false
      lastSources = nil
    end
    local n = 0
    pcall(function()
      local r = Export.LoGetRoute()
      n = r and r.route and #r.route or 0
    end)
    if n == lastSources then return end
    lastSources = n
    log(string.format('ruta del avión (LoGetRoute): %d puntos', n))
    send({ t = 'sources', loGetRoute = n })
  end

  local lastSend = 0
  local function sendState()
    local st = { t = 'state', mt = DCS.getModelTime(), paused = DCS.getPause() }
    pcall(function() st.start = Export.LoGetMissionStartTime() end)
    local s = Export.LoGetSelfData()
    if s then
      st.type = s.Name
      st.lat = s.LatLongAlt and s.LatLongAlt.Lat
      st.lon = s.LatLongAlt and s.LatLongAlt.Long
      st.alt = s.LatLongAlt and s.LatLongAlt.Alt
      st.hdg = s.Heading and math.deg(s.Heading)
      st.x = s.Position and s.Position.x
      st.z = s.Position and s.Position.z
      pcall(function() st.agl = Export.LoGetAltitudeAboveGroundLevel() end)
      pcall(function() st.ias = Export.LoGetIndicatedAirSpeed() end)
      pcall(function()
        local v = Export.LoGetVectorVelocity()
        if v then
          st.gs = math.sqrt(v.x * v.x + v.z * v.z)
          st.vs = v.y
        end
      end)
      pcall(function()
        local mech = Export.LoGetMechInfo()
        if mech and mech.gear then st.gear = mech.gear.value end
      end)
      pcall(function()
        local e = Export.LoGetEngineInfo()
        if e then
          st.fuelInt = e.fuel_internal
          st.fuelExt = e.fuel_external
        end
      end)
    end
    pcall(function()
      local cam = Export.LoGetCameraPosition()
      local ci = cameraInfo(cam)
      st.mapView = ci and ci.mapView or false
      st.cam = ci
    end)
    send(st)
  end

  local callbacks = {}

  function callbacks.onMissionLoadEnd()
    lastSources = nil
    sendMission()
  end

  function callbacks.onSimulationStart()
    sendMission()
  end

  function callbacks.onPlayerChangeSlot()
    send({ t = 'identity', id = identity() })
  end

  function callbacks.onSimulationStop()
    send({ t = 'stop' })
  end

  function callbacks.onSimulationFrame()
    readCommands()
    local now = DCS.getRealTime()
    if now - lastSend >= 0.2 then
      lastSend = now
      local okState, e = pcall(sendState)
      if not okState then log(e) end
    end
    if now - lastRoute >= 2 then
      lastRoute = now
      pcall(sendRoute)
      pcall(sendPlanSources)
    end
  end

  local function msg(kind, text)
    if text and text ~= '' then
      send({ t = 'msg', kind = kind, text = text, mt = DCS.getModelTime() })
    end
  end

  function callbacks.onTriggerMessage(message) msg('trigger', message) end
  function callbacks.onRadioMessage(message) msg('radio', message) end
  function callbacks.onShowMessage(message) msg('sistema', message) end
  function callbacks.onChatMessage(message, from)
    local name = ''
    pcall(function() name = net.get_player_info(from, 'name') or '' end)
    msg('chat', (name ~= '' and (name .. ': ') or '') .. tostring(message))
  end

  DCS.setUserCallbacks(callbacks)
  log('cargado (versión ' .. LFKB.version .. ')')
end)

if not ok then
  pcall(function() net.log('[LF Kneeboard] error al cargar: ' .. tostring(err)) end)
end
