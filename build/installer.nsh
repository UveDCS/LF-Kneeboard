; Al desinstalar de verdad, deja DCS y OpenXR como estaban: quita el hook y el mod de DCS y el registro de la capa OpenXR.
; Si es una ACTUALIZACIÓN (instalar encima una versión nueva) no se toca nada: si no, DCS se quedaría sin el script.
; La configuración del usuario (AppData) se conserva por si se reinstala.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "SOFTWARE\Khronos\OpenXR\1\ApiLayers\Implicit" "$INSTDIR\resources\native\lfkb_openxr_layer.json"
    Delete "$PROFILE\Saved Games\DCS\Scripts\Hooks\LFKneeboard-hook.lua"
    Delete "$PROFILE\Saved Games\DCS.openbeta\Scripts\Hooks\LFKneeboard-hook.lua"
    Delete "$PROFILE\Saved Games\DCS.release\Scripts\Hooks\LFKneeboard-hook.lua"
    RMDir /r "$PROFILE\Saved Games\DCS\Mods\Services\LFKneeboard"
    RMDir /r "$PROFILE\Saved Games\DCS.openbeta\Mods\Services\LFKneeboard"
    RMDir /r "$PROFILE\Saved Games\DCS.release\Mods\Services\LFKneeboard"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "es.lafundacion.kneeboard"
  ${endIf}
!macroend
