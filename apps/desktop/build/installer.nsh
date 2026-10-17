; Writes resources\setup-model.json from the installer file name.
; Synap.surf-<version>-x64-4b.exe -> qwen3.5-4b-q4_k_m
; Synap.surf-<version>-x64-offline-2b.exe -> qwen3.5-2b-q4_k_m
; A name with no size token leaves the choice to the app (RAM, or 2B).
; offline-2b is checked before 2b because that name also ends with 2b.
; This file is included inside the install Section, so it only defines a macro.

!macro customInstall
  Push $R0
  Push $R1
  Push $R2
  StrCpy $R2 ""

  StrLen $R0 "-offline-2b.exe"
  StrLen $R1 "$EXEFILE"
  IntOp $R1 $R1 - $R0
  StrCpy $R0 "$EXEFILE" $R0 $R1
  StrCmp $R0 "-offline-2b.exe" 0 +3
    StrCpy $R2 "qwen3.5-2b-q4_k_m"
    Goto surfSetupWrite

  StrLen $R0 "-9b.exe"
  StrLen $R1 "$EXEFILE"
  IntOp $R1 $R1 - $R0
  StrCpy $R0 "$EXEFILE" $R0 $R1
  StrCmp $R0 "-9b.exe" 0 +3
    StrCpy $R2 "qwen3.5-9b-q4_k_m"
    Goto surfSetupWrite

  StrLen $R0 "-4b.exe"
  StrLen $R1 "$EXEFILE"
  IntOp $R1 $R1 - $R0
  StrCpy $R0 "$EXEFILE" $R0 $R1
  StrCmp $R0 "-4b.exe" 0 +3
    StrCpy $R2 "qwen3.5-4b-q4_k_m"
    Goto surfSetupWrite

  StrLen $R0 "-2b.exe"
  StrLen $R1 "$EXEFILE"
  IntOp $R1 $R1 - $R0
  StrCpy $R0 "$EXEFILE" $R0 $R1
  StrCmp $R0 "-2b.exe" 0 surfSetupRestore
    StrCpy $R2 "qwen3.5-2b-q4_k_m"

  surfSetupWrite:
  StrCmp $R2 "" surfSetupRestore
  ClearErrors
  FileOpen $R0 "$INSTDIR\resources\setup-model.json" w
  IfErrors surfSetupRestore
  FileWrite $R0 '{"model":"'
  FileWrite $R0 $R2
  FileWrite $R0 '"}'
  FileClose $R0

  surfSetupRestore:
  Pop $R2
  Pop $R1
  Pop $R0
!macroend
