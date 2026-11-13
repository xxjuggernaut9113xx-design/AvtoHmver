; AvtoHmver Host's scope-specific NSIS installer. The build helper supplies
; AVTOHMVER_STAGE, PRODUCT_VERSION, and OUTPUT_FILE. ALL_USERS is defined only
; for the elevated machine-wide variant.
;
; Identity and upgrade guarantees:
; - InstallDir never collides with the data directory (%LOCALAPPDATA%\AvtoHmver
;   holds the library/config; the app lives under Programs\AvtoHmver).
; - Reinstalling over the same directory upgrades in place; the uninstaller
;   removes app files, shortcuts, and registry but never user data.
; - Add/Remove Programs registration carries DisplayVersion so upgrades are
;   visible and the entry is unique per scope.

Unicode true
SetCompressor /SOLID lzma

!include "MUI2.nsh"
!include "LogicLib.nsh"

!ifndef AVTOHMVER_STAGE
  !error "AVTOHMVER_STAGE must name a staged AvtoHmver Host directory"
!endif
!ifndef OUTPUT_FILE
  !error "OUTPUT_FILE must name the installer artifact"
!endif
!ifndef PRODUCT_VERSION
  !define PRODUCT_VERSION "0.3.4"
!endif

!ifdef ALL_USERS
  !define HOST_REGROOT HKLM
  !define HOST_SCOPE "AllUsers"
  Name "AvtoHmver Host ${PRODUCT_VERSION} (All users)"
  InstallDir "$PROGRAMFILES\AvtoHmver"
  RequestExecutionLevel admin
!else
  !define HOST_REGROOT HKCU
  !define HOST_SCOPE "CurrentUser"
  Name "AvtoHmver Host ${PRODUCT_VERSION}"
  InstallDir "$LOCALAPPDATA\Programs\AvtoHmver"
  RequestExecutionLevel user
!endif

OutFile "${OUTPUT_FILE}"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Section "AvtoHmver Host" SecHost
  SectionIn RO
  Delete "$SMPROGRAMS\Curator\Curator Host.lnk"
  Delete "$DESKTOP\Curator Host.lnk"
  Delete "$SMPROGRAMS\AvtoHmver\AvtoHmver Host.lnk"
  RMDir "$SMPROGRAMS\Curator"
  SetOutPath "$INSTDIR"
  File "${AVTOHMVER_STAGE}\AvtoHmver.exe"
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Curator"
  ${If} $0 != ""
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "AvtoHmver" "$\"$INSTDIR\AvtoHmver.exe$\" --background"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Curator"
  ${EndIf}
  File "${AVTOHMVER_STAGE}\icon.ico"
  ; The release builder verifies this complete runtime before staging it.
  SetOutPath "$INSTDIR\tools"
  File /r "${AVTOHMVER_STAGE}\tools\*.*"
  SetOutPath "$INSTDIR"
  File "${AVTOHMVER_STAGE}\THIRD_PARTY_NOTICES.md"
  File "${AVTOHMVER_STAGE}\LICENSE"
  WriteUninstaller "$INSTDIR\Uninstall AvtoHmver Host.exe"

  CreateDirectory "$SMPROGRAMS\AvtoHmver"
  CreateShortcut "$SMPROGRAMS\AvtoHmver\AvtoHmver Library.lnk" "$INSTDIR\AvtoHmver.exe" "" "$INSTDIR\icon.ico"
  CreateShortcut "$SMPROGRAMS\AvtoHmver\AvtoHmver Game Launcher.lnk" "$INSTDIR\AvtoHmver.exe" "--game-launcher" "$INSTDIR\icon.ico"

  WriteRegStr ${HOST_REGROOT} "Software\Microsoft\Windows\CurrentVersion\Uninstall\AvtoHmverHost-${HOST_SCOPE}" \
    "DisplayName" "AvtoHmver Host"
  WriteRegStr ${HOST_REGROOT} "Software\Microsoft\Windows\CurrentVersion\Uninstall\AvtoHmverHost-${HOST_SCOPE}" \
    "DisplayVersion" "${PRODUCT_VERSION}"
  WriteRegStr ${HOST_REGROOT} "Software\Microsoft\Windows\CurrentVersion\Uninstall\AvtoHmverHost-${HOST_SCOPE}" \
    "InstallLocation" "$INSTDIR"
  WriteRegStr ${HOST_REGROOT} "Software\Microsoft\Windows\CurrentVersion\Uninstall\AvtoHmverHost-${HOST_SCOPE}" \
    "UninstallString" '"$INSTDIR\Uninstall AvtoHmver Host.exe"'
  WriteRegStr ${HOST_REGROOT} "Software\Microsoft\Windows\CurrentVersion\Uninstall\AvtoHmverHost-${HOST_SCOPE}" \
    "DisplayIcon" "$INSTDIR\AvtoHmver.exe"
  WriteRegDWORD ${HOST_REGROOT} "Software\Microsoft\Windows\CurrentVersion\Uninstall\AvtoHmverHost-${HOST_SCOPE}" \
    "NoModify" 1
  WriteRegDWORD ${HOST_REGROOT} "Software\Microsoft\Windows\CurrentVersion\Uninstall\AvtoHmverHost-${HOST_SCOPE}" \
    "NoRepair" 1
SectionEnd

; Startup stays opt-in and starts the Host hidden so its built-in Server is
; available in the tray. The optional section is unchecked by default.
Section /o "Start AvtoHmver with Windows" SecStartup
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "AvtoHmver" "$\"$INSTDIR\AvtoHmver.exe$\" --background"
SectionEnd

Section "Uninstall"
  Delete "$SMPROGRAMS\AvtoHmver\AvtoHmver Host.lnk"
  Delete "$SMPROGRAMS\AvtoHmver\AvtoHmver Library.lnk"
  Delete "$SMPROGRAMS\AvtoHmver\AvtoHmver Game Launcher.lnk"
  RMDir "$SMPROGRAMS\AvtoHmver"
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "AvtoHmver"
  ${If} $0 == "$\"$INSTDIR\AvtoHmver.exe$\" --background"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "AvtoHmver"
  ${EndIf}
  DeleteRegKey ${HOST_REGROOT} "Software\Microsoft\Windows\CurrentVersion\Uninstall\AvtoHmverHost-${HOST_SCOPE}"
  ; App files only. The library, config, and preferences under the data
  ; directory are user data and are deliberately left behind.
  Delete "$INSTDIR\Uninstall AvtoHmver Host.exe"
  Delete "$INSTDIR\AvtoHmver.exe"
  Delete "$INSTDIR\icon.ico"
  Delete "$INSTDIR\THIRD_PARTY_NOTICES.md"
  Delete "$INSTDIR\LICENSE"
  RMDir /r "$INSTDIR\tools"
  RMDir "$INSTDIR"
SectionEnd
