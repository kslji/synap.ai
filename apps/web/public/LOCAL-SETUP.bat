@echo off
REM local.ai — one-file local setup. From this folder:
REM   LOCAL-SETUP.bat
cd /d "%~dp0"
set PORT=18766
set URL=http://127.0.0.1:18766/local-agent.html

echo Surf AI — local Small Cloud on this computer
echo Folder: %cd%
echo Models: after Chrome opens, pull one that fits your RAM — see PULL-MODEL.bat
echo         e.g. PULL-MODEL.bat llama3.2:3b
echo Colibri optional: INSTALL-COLIBRI.bat then coli serve with your model path
echo Moss: add MOSS_PROJECT_ID / MOSS_PROJECT_KEY to the host .env when you run the full host;
echo       if credits fail, Surf falls back to on-device keyword search automatically.
echo.

if not exist "local-agent.html" (
  echo local-agent.html is not in this folder.
  echo Unzip local-ai-on-this-device.zip, then run LOCAL-SETUP.bat from the unzipped local-ai folder.
  pause
  exit /b 1
)

where python >nul 2>&1 && set PY=python
if not defined PY where py >nul 2>&1 && set PY=py
if not defined PY (
  echo Python 3 is not installed.
  echo Install from https://www.python.org/downloads/windows/
  echo Tick "Add python.exe to PATH", Finish, close this window, run LOCAL-SETUP.bat again.
  echo Or: winget install -e --id Python.Python.3.12
  pause
  exit /b 1
)

echo Python:
%PY% --version

echo.
echo Starting Surf AI and opening Google Chrome...
echo Leave this window open while you chat. Close it when you are finished.
echo.

start /b %PY% -m http.server %PORT% --bind 127.0.0.1
timeout /t 1 >nul

echo Opening Google Chrome...

if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
  start "" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" --new-window "%URL%"
  goto keep
)
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
  start "" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" --new-window "%URL%"
  goto keep
)
if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" (
  start "" "%LocalAppData%\Google\Chrome\Application\chrome.exe" --new-window "%URL%"
  goto keep
)
where chrome >nul 2>&1 && start chrome --new-window "%URL%" && goto keep

echo Google Chrome is not installed. Get it from https://www.google.com/chrome/
echo Opening your usual browser instead.
start "" "%URL%"
:keep
pause
