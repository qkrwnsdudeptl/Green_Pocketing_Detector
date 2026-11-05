@echo off
echo [1] Enable server at Windows startup
echo [2] Disable server at Windows startup
echo [3] Check status
choice /C 123 /N /M "Select 1, 2, or 3: "
if errorlevel 255 exit /b 1
if not errorlevel 1 exit /b
if errorlevel 3 (
    set "action=Status"
) else if errorlevel 2 (
    set "action=Off"
) else (
    set "action=On"
)
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0inventory_windows.ps1" %action%
pause
