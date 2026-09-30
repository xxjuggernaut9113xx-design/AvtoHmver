; Curator Host's scope-specific NSIS installer. The build helper supplies
; CURATOR_STAGE, PRODUCT_VERSION, and OUTPUT_FILE. ALL_USERS is defined only
; for the elevated machine-wide variant.
;
; Identity and upgrade guarantees:
; - InstallDir never collides with the data directory (%LOCALAPPDATA%\Curator
;   holds the library/config; the app lives under Programs\Curator).
; - Reinstalling over the same directory upgrades in place; the uninstaller
;   removes app files, shortcuts, and registry but never user data.
; - Add/Remove Programs registration carries DisplayVersion so upgrades are
;   visible and the entry is unique per scope.

Unicode true
SetCompressor /SOLID lzma

!include "MUI2.nsh"
!include "LogicLib.nsh"

!ifndef CURATOR_STAGE
  !error "CURATOR_STAGE must name a staged Curator Host directory"
!endif
!ifndef OUTPUT_FILE
  !error "OUTPUT_FILE must name the installer artifact"
!endif
!ifndef PRODUCT_VERSION
  !define PRODUCT_VERSION "0.3.0"
!endif

!ifdef ALL_USERS
  !define HOST_REGROOT HKLM
  !define HOST_SCOPE "AllUsers"
  Name "Curator Host ${PRODUCT_VERSION} (All users)"
  InstallDir "$PROGRAMFILES\Curator"
  RequestExecutionLevel admin
!else
  !define HOST_REGROOT HKCU
  !define HOST_SCOPE "CurrentUser"
  Name "Curator Host ${PRODUCT_VERSION}"
  InstallDir "$LOCALAPPDATA\Programs\Curator"
  RequestExecutionLevel user
!endif

OutFile "${OUTPUT_FILE}"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Section "Curator Host" SecHost
  SetOutPath "$INSTDIR"
  File "${CURATOR_STAGE}\Curator.exe"
  File "${CURATOR_STAGE}\icon.ico"
  ; The release builder verifies this complete runtime before staging it.
  SetOutPath "$INSTDIR\tools"
  File /r "${CURATOR_STAGE}\tools\*.*"
  SetOutPath "$INSTDIR"
  File "${CURATOR_STAGE}\THIRD_PARTY_NOTICES.md"
  File "${CURATOR_STAGE}\LICENSE"
  WriteUninstaller "$INSTDIR\Uninstall Curator Host.exe"

  CreateDirectory "$SMPROGRAMS\Curator"
  CreateShortcut "$SMPROGRAMS\Curator\Curator Host.lnk" "$INSTDIR\Curator.exe" "" "$INSTDIR\icon.ico"

  WriteRegStr ${HOST_REGROOT} "Software\Microsoft\Windows\CurrentVersion\Uninstall\CuratorHost-${HOST_SCOPE}" \
    "DisplayName" "Curator Host"
  WriteRegStr ${HOST_REGROOT} "Software\Microsoft\Windows\CurrentVersion\Uninstall\CuratorHost-${HOST_SCOPE}" \
    "DisplayVersion" "${PRODUCT_VERSION}"
  WriteRegStr ${HOST_REGROOT} "Software\Microsoft\Windows\CurrentVersion\Uninstall\CuratorHost-${HOST_SCOPE}" \
    "InstallLocation" "$INSTDIR"
  WriteRegStr ${HOST_REGROOT} "Software\Microsoft\Windows\CurrentVersion\Uninstall\CuratorHost-${HOST_SCOPE}" \
    "UninstallString" '"$INSTDIR\Uninstall Curator Host.exe"'
  WriteRegStr ${HOST_REGROOT} "Software\Microsoft\Windows\CurrentVersion\Uninstall\CuratorHost-${HOST_SCOPE}" \
    "DisplayIcon" "$INSTDIR\Curator.exe"
  WriteRegDWORD ${HOST_REGROOT} "Software\Microsoft\Windows\CurrentVersion\Uninstall\CuratorHost-${HOST_SCOPE}" \
    "NoModify" 1
  WriteRegDWORD ${HOST_REGROOT} "Software\Microsoft\Windows\CurrentVersion\Uninstall\CuratorHost-${HOST_SCOPE}" \
    "NoRepair" 1
SectionEnd

Section "Uninstall"
  Delete "$SMPROGRAMS\Curator\Curator Host.lnk"
  RMDir "$SMPROGRAMS\Curator"
  DeleteRegKey ${HOST_REGROOT} "Software\Microsoft\Windows\CurrentVersion\Uninstall\CuratorHost-${HOST_SCOPE}"
  ; App files only. The library, config, and preferences under the data
  ; directory are user data and are deliberately left behind.
  Delete "$INSTDIR\Uninstall Curator Host.exe"
  Delete "$INSTDIR\Curator.exe"
  Delete "$INSTDIR\icon.ico"
  Delete "$INSTDIR\THIRD_PARTY_NOTICES.md"
  Delete "$INSTDIR\LICENSE"
  RMDir /r "$INSTDIR\tools"
  RMDir "$INSTDIR"
SectionEnd
