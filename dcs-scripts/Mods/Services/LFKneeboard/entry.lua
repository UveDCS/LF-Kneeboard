-- LF Kneeboard: mod mínimo para que DCS cargue el puente de la interfaz (Scripts/LFKneeboard-bridge.lua).
-- Lo instala y lo quita la propia aplicación (Ajustes > Integración DCS), junto con el script de Scripts\Hooks.
declare_plugin("LF Kneeboard", {
	installed = true,
	dirName = current_mod_path,
	developerName = _("La Fundación"),
	displayName = _("LF Kneeboard"),
	version = "1.0.0",
	state = "installed",
	info = _("Puente de LF Kneeboard con la interfaz de DCS (herramienta de ruta del F10 y editor de DTC)."),
	Options = {
		{ name = "LF Kneeboard", nameId = "LFKneeboard", dir = "Options", allow_in_simulation = true; },
	},
})
plugin_done()
