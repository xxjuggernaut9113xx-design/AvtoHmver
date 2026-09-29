; Curator Viewer's scope-specific NSIS installer. The build helper supplies
; CURATOR_STAGE, PRODUCT_VERSION, and OUTPUT_FILE. ALL_USERS is defined only
; for the elevated machine-wide variant.
;
; The Viewer streams from a Host/Server and keeps no library of its own. It
; carries libmpv and its dependency DLLs for in-shell remote playback.
; Reinstalling over the same directory upgrades in place; the uninstaller
; removes app files, shortcuts, and registry but never user data (preferences
; live in the data directory).

Unicode true
SetCompressor /SOLID lzma

!include "MUI2.nsh"
!include "LogicLib.nsh"

!ifndef CURATOR_STAGE
  !error "CURATOR_STAGE must name a staged Curator Viewer directory"
!endif
!ifndef OUTPUT_FILE
  !error "OUTPUT_FILE must name the installer artifact"
!endif
!ifndef PRODUCT_VERSION
  !define PRODUCT_VERSION "0.3.0"
!endif

!ifdef ALL_USERS
  !define VIEWER_REGROOT HKLM
  !define VIEWER_SCOPE "AllUsers"
  Name "Curator Viewer ${PRODUCT_VERSION} (All users)"
  InstallDir "$PROGRAMFILES\Curator Viewer"
  RequestExecutionLevel admin
!else
  !define VIEWER_REGROOT HKCU
  !define VIEWER_SCOPE "CurrentUser"
  Name "Curator Viewer ${PRODUCT_VERSION}"
  InstallDir "$LOCALAPPDATA\Programs\Curator Viewer"
  RequestExecutionLevel user
!endif

OutFile "${OUTPUT_FILE}"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Section "Curator Viewer" SecViewer
  SetOutPath "$INSTDIR"
  File "${CURATOR_STAGE}\curator-viewer.exe"
  File "${CURATOR_STAGE}\icon.ico"
  File "${CURATOR_STAGE}\THIRD_PARTY_NOTICES.md"
  SetOutPath "$INSTDIR\tools"
  File /r "${CURATOR_STAGE}\tools\*.*"
  WriteUninstaller "$INSTDIR\Uninstall Curator Viewer.exe"

  CreateDirectory "$SMPROGRAMS\Curator Viewer"
  CreateShortcut "$SMPROGRAMS\Curator Viewer\Curator Viewer.lnk" "$INSTDIR\curator-viewer.exe" "" "$INSTDIR\icon.ico"

  WriteRegStr ${VIEWER_REGROOT} "Software\Microsoft\Windows\CurrentVersion\Uninstall\CuratorViewer-${VIEWER_SCOPE}" \
    "DisplayName" "Curator Viewer"
  WriteRegStr ${VIEWER_REGROOT} "Software\Microsoft\Windows\CurrentVersion\Uninstall\CuratorViewer-${VIEWER_SCOPE}" \
    "DisplayVersion" "${PRODUCT_VERSION}"
  WriteRegStr ${VIEWER_REGROOT} "Software\Microsoft\Windows\CurrentVersion\Uninstall\CuratorViewer-${VIEWER_SCOPE}" \
    "InstallLocation" "$INSTDIR"
  WriteRegStr ${VIEWER_REGROOT} "Software\Microsoft\Windows\CurrentVersion\Uninstall\CuratorViewer-${VIEWER_SCOPE}" \
    "UninstallString" '"$INSTDIR\Uninstall Curator Viewer.exe"'
  WriteRegStr ${VIEWER_REGROOT} "Software\Microsoft\Windows\CurrentVersion\Uninstall\CuratorViewer-${VIEWER_SCOPE}" \
    "DisplayIcon" "$INSTDIR\curator-viewer.exe"
  WriteRegDWORD ${VIEWER_REGROOT} "Software\Microsoft\Windows\CurrentVersion\Uninstall\CuratorViewer-${VIEWER_SCOPE}" \
    "NoModify" 1
  WriteRegDWORD ${VIEWER_REGROOT} "Software\Microsoft\Windows\CurrentVersion\Uninstall\CuratorViewer-${VIEWER_SCOPE}" \
    "NoRepair" 1
SectionEnd

Section "Uninstall"
  Delete "$SMPROGRAMS\Curator Viewer\Curator Viewer.lnk"
  RMDir "$SMPROGRAMS\Curator Viewer"
  DeleteRegKey ${VIEWER_REGROOT} "Software\Microsoft\Windows\CurrentVersion\Uninstall\CuratorViewer-${VIEWER_SCOPE}"
  Delete "$INSTDIR\Uninstall Curator Viewer.exe"
  Delete "$INSTDIR\curator-viewer.exe"
  Delete "$INSTDIR\icon.ico"
  Delete "$INSTDIR\THIRD_PARTY_NOTICES.md"
  RMDir /r "$INSTDIR\tools"
  RMDir "$INSTDIR"
SectionEnd
