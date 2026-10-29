@echo off
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-FanserviceNative.ps1" -StartGame %*
