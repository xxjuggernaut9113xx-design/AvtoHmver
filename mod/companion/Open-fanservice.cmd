@echo off
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0Start-FanserviceMenu.ps1"
if errorlevel 1 pause
