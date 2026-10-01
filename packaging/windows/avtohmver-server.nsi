; AvtoHmver Server's scope-specific NSIS installer. The build helper supplies
; AVTOHMVER_STAGE, PRODUCT_VERSION, and OUTPUT_FILE. ALL_USERS is defined only
; for the elevated machine-wide variant.

Unicode true
SetCompressor /SOLID lzma

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "nsDialogs.nsh"

!ifndef AVTOHMVER_STAGE
  !error "AVTOHMVER_STAGE must name a staged AvtoHmver Server directory"
!endif
!ifndef OUTPUT_FILE
  !error "OUTPUT_FILE must name the installer artifact"
!endif
!ifndef PRODUCT_VERSION
  !define PRODUCT_VERSION "0.3.4"
!endif

!ifdef ALL_USERS
  !define SERVER_SCOPE "AllUsers"
  !define SERVER_SCOPE_ARG "all-users"
  Name "AvtoHmver Server ${PRODUCT_VERSION} (All users)"
  InstallDir "$PROGRAMFILES\AvtoHmver Server"
  RequestExecutionLevel admin
!else
  !define SERVER_SCOPE "CurrentUser"
  !define SERVER_SCOPE_ARG "current-user"
  Name "AvtoHmver Server ${PRODUCT_VERSION}"
  InstallDir "$LOCALAPPDATA\AvtoHmver Server"
  RequestExecutionLevel user
!endif

OutFile "${OUTPUT_FILE}"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
Page custom PharPageCreate PharPageLeave
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Var PharCheckbox
Var PharRequested

Function PharPageCreate
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 24u "Optional P-HAR setup"
  Pop $0
  ${NSD_CreateLabel} 0 26u 100% 30u "P-HAR is opt-in. AvtoHmver records this choice now and evaluates managed setup only after the Server starts; installer transactions never download models."
  Pop $0
  ${NSD_CreateCheckbox} 0 60u 100% 12u "Set up P-HAR after installation"
  Pop $PharCheckbox
  ${NSD_SetState} $PharCheckbox ${BST_UNCHECKED}
  nsDialogs::Show
FunctionEnd

Function PharPageLeave
  ${NSD_GetState} $PharCheckbox $PharRequested
FunctionEnd

Section "AvtoHmver Server" SecServer
  Delete "$SMPROGRAMS\Curator\Curator Server.lnk"
  Delete "$DESKTOP\Curator Server.lnk"
  RMDir "$SMPROGRAMS\Curator"
  SetOutPath "$INSTDIR"
  File "${AVTOHMVER_STAGE}\avtohmver-server.exe"
  File "${AVTOHMVER_STAGE}\LICENSE"
  File "${AVTOHMVER_STAGE}\Register-AvtoHmverServer.ps1"
  File "${AVTOHMVER_STAGE}\Unregister-AvtoHmverServer.ps1"
  SetOutPath "$INSTDIR\static"
  File /r "${AVTOHMVER_STAGE}\static\*.*"
  WriteUninstaller "$INSTDIR\Uninstall AvtoHmver Server.exe"

  ${If} $PharRequested == ${BST_CHECKED}
    ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\Register-AvtoHmverServer.ps1" -Scope "${SERVER_SCOPE}" -ServerPath "$INSTDIR\avtohmver-server.exe" -EnablePhar' $0
  ${Else}
    ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\Register-AvtoHmverServer.ps1" -Scope "${SERVER_SCOPE}" -ServerPath "$INSTDIR\avtohmver-server.exe"' $0
  ${EndIf}
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "AvtoHmver Server files were installed, but background registration failed (exit $0). Run Register-AvtoHmverServer.ps1 from this install directory to retry."
    SetErrorLevel $0
    Abort
  ${EndIf}
SectionEnd

Section "Uninstall"
  ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\Unregister-AvtoHmverServer.ps1" -Scope "${SERVER_SCOPE}"' $0
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "The AvtoHmver Server registration could not be removed (exit $0). The application files and data were left in place."
    SetErrorLevel $0
    Abort
  ${EndIf}
  Delete "$INSTDIR\Uninstall AvtoHmver Server.exe"
  Delete "$INSTDIR\Register-AvtoHmverServer.ps1"
  Delete "$INSTDIR\Unregister-AvtoHmverServer.ps1"
  Delete "$INSTDIR\avtohmver-server.exe"
  Delete "$INSTDIR\LICENSE"
  RMDir /r "$INSTDIR\static"
  RMDir "$INSTDIR"
SectionEnd
