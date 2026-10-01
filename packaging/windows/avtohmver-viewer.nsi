; AvtoHmver Viewer's scope-specific NSIS installer. The build helper supplies
; AVTOHMVER_STAGE, PRODUCT_VERSION, and OUTPUT_FILE. ALL_USERS is defined only
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

!ifndef AVTOHMVER_STAGE
  !error "AVTOHMVER_STAGE must name a staged AvtoHmver Viewer directory"
!endif
!ifndef OUTPUT_FILE
  !error "OUTPUT_FILE must name the installer artifact"
!endif
!ifndef PRODUCT_VERSION
  !define PRODUCT_VERSION "0.3.4"
!endif

!ifdef ALL_USERS
  !define VIEWER_REGROOT HKLM
  !define VIEWER_SCOPE "AllUsers"
  Name "AvtoHmver Viewer ${PRODUCT_VERSION} (All users)"
  InstallDir "$PROGRAMFILES\AvtoHmver Viewer"
  RequestExecutionLevel admin
!else
  !define VIEWER_REGROOT HKCU
  !define VIEWER_SCOPE "CurrentUser"
  Name "AvtoHmver Viewer ${PRODUCT_VERSION}"
  InstallDir "$LOCALAPPDATA\Programs\AvtoHmver Viewer"
  RequestExecutionLevel user
!endif

OutFile "${OUTPUT_FILE}"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Section "AvtoHmver Viewer" SecViewer
  Delete "$SMPROGRAMS\Curator\Curator Viewer.lnk"
  Delete "$DESKTOP\Curator Viewer.lnk"
  RMDir "$SMPROGRAMS\Curator"
  SetOutPath "$INSTDIR"
  File "${AVTOHMVER_STAGE}\avtohmver-viewer.exe"
  File "${AVTOHMVER_STAGE}\icon.ico"
  File "${AVTOHMVER_STAGE}\THIRD_PARTY_NOTICES.md"
  File "${AVTOHMVER_STAGE}\LICENSE"
  SetOutPath "$INSTDIR\tools"
  File /r "${AVTOHMVER_STAGE}\tools\*.*"
  WriteUninstaller "$INSTDIR\Uninstall AvtoHmver Viewer.exe"

  CreateDirectory "$SMPROGRAMS\AvtoHmver Viewer"
  CreateShortcut "$SMPROGRAMS\AvtoHmver Viewer\AvtoHmver Viewer.lnk" "$INSTDIR\avtohmver-viewer.exe" "" "$INSTDIR\icon.ico"

  WriteRegStr ${VIEWER_REGROOT} "Software\Microsoft\Windows\CurrentVersion\Uninstall\AvtoHmverViewer-${VIEWER_SCOPE}" \
    "DisplayName" "AvtoHmver Viewer"
  WriteRegStr ${VIEWER_REGROOT} "Software\Microsoft\Windows\CurrentVersion\Uninstall\AvtoHmverViewer-${VIEWER_SCOPE}" \
    "DisplayVersion" "${PRODUCT_VERSION}"
  WriteRegStr ${VIEWER_REGROOT} "Software\Microsoft\Windows\CurrentVersion\Uninstall\AvtoHmverViewer-${VIEWER_SCOPE}" \
    "InstallLocation" "$INSTDIR"
  WriteRegStr ${VIEWER_REGROOT} "Software\Microsoft\Windows\CurrentVersion\Uninstall\AvtoHmverViewer-${VIEWER_SCOPE}" \
    "UninstallString" '"$INSTDIR\Uninstall AvtoHmver Viewer.exe"'
  WriteRegStr ${VIEWER_REGROOT} "Software\Microsoft\Windows\CurrentVersion\Uninstall\AvtoHmverViewer-${VIEWER_SCOPE}" \
    "DisplayIcon" "$INSTDIR\avtohmver-viewer.exe"
  WriteRegDWORD ${VIEWER_REGROOT} "Software\Microsoft\Windows\CurrentVersion\Uninstall\AvtoHmverViewer-${VIEWER_SCOPE}" \
    "NoModify" 1
  WriteRegDWORD ${VIEWER_REGROOT} "Software\Microsoft\Windows\CurrentVersion\Uninstall\AvtoHmverViewer-${VIEWER_SCOPE}" \
    "NoRepair" 1
SectionEnd

Section "Uninstall"
  Delete "$SMPROGRAMS\AvtoHmver Viewer\AvtoHmver Viewer.lnk"
  RMDir "$SMPROGRAMS\AvtoHmver Viewer"
  DeleteRegKey ${VIEWER_REGROOT} "Software\Microsoft\Windows\CurrentVersion\Uninstall\AvtoHmverViewer-${VIEWER_SCOPE}"
  Delete "$INSTDIR\Uninstall AvtoHmver Viewer.exe"
  Delete "$INSTDIR\avtohmver-viewer.exe"
  Delete "$INSTDIR\icon.ico"
  Delete "$INSTDIR\THIRD_PARTY_NOTICES.md"
  Delete "$INSTDIR\LICENSE"
  RMDir /r "$INSTDIR\tools"
  RMDir "$INSTDIR"
SectionEnd
