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
    ; Carpetas de DCS fuera de la ruta de siempre (Saved Games en otro disco o elegidas a mano): la app las apunta
    ; en dcs-dirs.txt, UTF-16LE, una por línea.
    ClearErrors
    FileOpen $0 "$APPDATA\LF Kneeboard\dcs-dirs.txt" r
    ${IfNot} ${Errors}
      ${Do}
        ClearErrors
        FileReadUTF16LE $0 $1
        ${If} ${Errors}
          ${ExitDo}
        ${EndIf}
        ${Do}
          StrCpy $2 $1 1 -1
          ${If} $2 == "$\r"
          ${OrIf} $2 == "$\n"
            StrCpy $1 $1 -1
          ${Else}
            ${ExitDo}
          ${EndIf}
        ${Loop}
        StrLen $2 $1
        ${If} $2 > 3
          Delete "$1\Scripts\Hooks\LFKneeboard-hook.lua"
          RMDir /r "$1\Mods\Services\LFKneeboard"
        ${EndIf}
      ${Loop}
      FileClose $0
    ${EndIf}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "es.lafundacion.kneeboard"
  ${endIf}
!macroend
