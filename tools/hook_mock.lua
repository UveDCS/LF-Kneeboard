-- Ejecuta el hook de DCS fuera de DCS con un entorno simulado (para las pruebas).
-- Uso: lua hook_mock.lua <hook.lua> <mission.lua> <carpeta_temporal> <segundos>
local hookPath, missionPath, tmp, seconds = arg[1], arg[2], arg[3], tonumber(arg[4] or '3')

local socket = require('socket')
local lfs = require('lfs')
lfs.writedir = function() return tmp .. '\\' end

-- JSON mínimo (DCS trae net.lua2json / net.json2lua)
local function encode(v)
  local t = type(v)
  if t == 'nil' then return 'null' end
  if t == 'boolean' then return tostring(v) end
  if t == 'number' then
    if v ~= v or v == math.huge or v == -math.huge then return 'null' end
    return string.format('%.10g', v)
  end
  if t == 'string' then
    return '"' .. v:gsub('[%c"\\]', function(c)
      local map = { ['"'] = '\\"', ['\\'] = '\\\\', ['\n'] = '\\n', ['\r'] = '\\r', ['\t'] = '\\t' }
      return map[c] or string.format('\\u%04x', c:byte())
    end) .. '"'
  end
  local n = 0
  for _ in pairs(v) do n = n + 1 end
  if n > 0 and #v == n then
    local parts = {}
    for i = 1, n do parts[i] = encode(v[i]) end
    return '[' .. table.concat(parts, ',') .. ']'
  end
  local parts = {}
  for k, val in pairs(v) do parts[#parts + 1] = encode(tostring(k)) .. ':' .. encode(val) end
  return '{' .. table.concat(parts, ',') .. '}'
end

local json = require('json')
local t0 = socket.gettime()
local callbacks

net = {
  lua2json = encode,
  json2lua = function(s) return json.decode(s) end,
  log = function(m) io.stderr:write(m .. '\n') end,
  get_my_player_id = function() return 1 end,
  get_player_info = function() return 'Piloto' end,
}

local f = assert(io.open(missionPath, 'r'))
local src = f:read('*a')
f:close()
assert(loadstring(src))()
local MISSION = mission

DCS = {
  setUserCallbacks = function(c) callbacks = c end,
  isMultiplayer = function() return false end,
  getMissionFilename = function() return '' end,
  getMissionName = function() return 'Prueba' end,
  getCurrentMission = function() return { mission = MISSION } end,
  getModelTime = function() return socket.gettime() - t0 + 1200 end,
  getRealTime = function() return socket.gettime() - t0 end,
  getPause = function() return false end,
}

Export = {
  LoGetSelfData = function()
    return { Name = 'FA-18C_hornet', UnitName = 'Dagger-1-1', GroupName = 'Dagger-1', CoalitionID = 2,
      LatLongAlt = { Lat = 42.25, Long = 42.05, Alt = 3000 }, Heading = 1.3, Position = { x = -281000, y = 3000, z = 647000 } }
  end,
  LoGetAltitudeAboveGroundLevel = function() return 2900 end,
  LoGetIndicatedAirSpeed = function() return 150 end,
  LoGetVectorVelocity = function() return { x = 180, y = 0, z = 60 } end,
  LoGetMechInfo = function() return { gear = { value = 0 } } end,
  LoGetEngineInfo = function() return { fuel_internal = 3500, fuel_external = 0 } end,
  LoGetMissionStartTime = function() return 50400 end,
  LoGetCameraPosition = function() return { p = { x = -282000, y = 40000, z = 646000 }, x = { x = 0, y = -1, z = 0 } } end,
}

package.preload['terrain'] = function()
  return {
    convertMetersToLatLon = function(x, z) return 42.123456, 42.654321 end,
    GetSurfaceHeightWithSeabed = function() return 321 end,
    GetMGRScoordinates = function() return '38T KM 12345 67890' end,
  }
end

-- Herramienta de ruta del F10 activada con 3 puntos, y editor de DTC del juego abierto hasta el segundo 4,5
-- (al cerrarse, el puente lee lo que tenga: el archivo que se pasa como quinto argumento).
package.loaded['RouteTool'] = {
  isRouteSubstitutionActivated = function() return true end,
  getSelectedRoute = function()
    return {
      { x = -300000, y = 640000, alt = 3000, alt_type = 'BARO', ETA = 900, name = 'RT1' },
      { x = -295000, y = 650000, alt = 4000, alt_type = 'BARO', ETA = 1500, name = 'RT2' },
      { x = -285000, y = 660000, alt = 500, alt_type = 'RADIO', ETA = 2100, name = 'RT3' },
    }
  end,
}
-- Como en DCS: el panel no está en package.loaded ni hay librería debug. Al abrir el editor, el panel registra
-- en UpdateManager funciones suyas y el avión llama a DTC_manager_Map.setupDescriptorCallbacks con las suyas.
local openEditor = nil
if arg[5] then
  local f = io.open(arg[5], 'r')
  local dtcData = json.decode(f:read('*a')).data
  f:close()
  local panelEnv = { getVisible = function() return socket.gettime() - t0 < 4.5 end }
  panelEnv.getData = function() return dtcData end
  local isVisible = function() return panelEnv.getVisible() end
  setfenv(isVisible, panelEnv)
  local functionPtr = function() end
  setfenv(functionPtr, panelEnv)
  local descriptorEnv = { isDTCVisible = isVisible, returnData = function() return dtcData end }
  local onWaypointAdd = function() end
  setfenv(onWaypointAdd, descriptorEnv)
  package.loaded['DTC_manager_Map'] = { setupDescriptorCallbacks = function() end }
  openEditor = function()
    package.loaded['DTC_manager_Map'].setupDescriptorCallbacks(onWaypointAdd)
    package.loaded['UpdateManager'].add(functionPtr)
  end
end
debug = nil   -- en la interfaz de DCS no está

-- Puente del mod (Lua de la interfaz): sexto argumento. Su UpdateManager se llama en cada «frame».
local updaters = {}
if arg[6] then
  package.loaded['UpdateManager'] = { add = function(f) updaters[#updaters + 1] = f end }
  package.loaded['DCS'] = {
    getPlayerUnitType = function() return 'FA-18C_hornet' end,
    getMissionFilename = function() return 'C:\Misiones\prueba.miz' end,
  }
  dofile(arg[6])
  if openEditor then openEditor() end
end

dofile(hookPath)
assert(callbacks, 'el hook no registró callbacks')
callbacks.onMissionLoadEnd()
callbacks.onTriggerMessage('Mensaje de prueba de la misión', 10, false)
while socket.gettime() - t0 < seconds do
  callbacks.onSimulationFrame()
  for _, f in ipairs(updaters) do f() end
  socket.sleep(0.02)
end
callbacks.onSimulationStop()
