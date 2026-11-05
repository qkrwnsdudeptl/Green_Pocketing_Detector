@echo off
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0inventory_windows.ps1" Start
if errorlevel 1 pause
