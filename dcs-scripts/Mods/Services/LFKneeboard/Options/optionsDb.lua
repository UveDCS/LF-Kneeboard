-- DCS ejecuta este archivo en el Lua de su interfaz (el del editor, el briefing y el mapa F10) al arrancar.
-- Se aprovecha para poner en marcha el puente de LF Kneeboard; no tiene opciones propias.
pcall(function()
	local dir = modulelocation or (require('lfs').writedir() .. 'Mods/Services/LFKneeboard')
	dofile(dir .. '/Scripts/LFKneeboard-bridge.lua')
end)

return {}
