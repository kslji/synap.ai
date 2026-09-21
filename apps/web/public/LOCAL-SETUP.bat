@echo off
REM Surf AI — ONE command for every agent pack.
REM Reads agent.json → Ollama + model → Chrome on http://127.0.0.1:18766
cd /d "%~dp0"
setlocal EnableExtensions
set CACHE=%USERPROFILE%\.surf-ai\cache
if not exist "%CACHE%" mkdir "%CACHE%"

set AGENT=surf
set MODEL=llama3.2:3b
set TITLE=Surf + Ollama
set PORT=18766
set URL=http://127.0.0.1:18766/local-agent.html

if exist "agent.json" (
  where python >nul 2>&1 && set PY=python
  if not defined PY where py >nul 2>&1 && set PY=py
  if defined PY (
    for /f "usebackq delims=" %%A in (`%PY% -c "import json;d=json.load(open('agent.json'));print(d.get('agent','surf'))"`) do set AGENT=%%A
    for /f "usebackq delims=" %%A in (`%PY% -c "import json;d=json.load(open('agent.json'));print(d.get('model') or 'llama3.2:3b')"`) do set MODEL=%%A
    for /f "usebackq delims=" %%A in (`%PY% -c "import json;d=json.load(open('agent.json'));print(d.get('title') or 'Surf')"`) do set TITLE=%%A
  )
)

echo Surf AI — one-command local chat
echo Pack: %TITLE% (%AGENT%)
echo Model: %MODEL%
echo Folder: %cd%
echo Chrome will open %URL%
echo.

if not exist "local-agent.html" (
  echo local-agent.html missing. Unzip the pack and run LOCAL-SETUP.bat from that folder.
  pause
  exit /b 1
)

where python >nul 2>&1 && set PY=python
if not defined PY where py >nul 2>&1 && set PY=py
if not defined PY (
  echo Python 3 is required once. Install from https://www.python.org/downloads/windows/  (Add to PATH)
  pause
  exit /b 1
)

echo Python:
%PY% --version

where ollama >nul 2>&1
if errorlevel 1 (
  echo Installing Ollama once...
  set OLL=%CACHE%\OllamaSetup.exe
  if not exist "%OLL%" (
    powershell -NoProfile -Command "Invoke-WebRequest -Uri 'https://ollama.com/download/OllamaSetup.exe' -OutFile '%OLL%'"
  )
  start "" "%OLL%"
  echo Finish the Ollama installer, open Ollama once, then run LOCAL-SETUP.bat again.
  pause
  exit /b 0
)

echo Ensuring model %MODEL% is on this computer...
ollama list 2>nul | findstr /i /c:"%MODEL%" >nul
if errorlevel 1 (
  echo Downloading %MODEL% once. After this, chat works offline.
  ollama pull %MODEL%
) else (
  echo Model already present — offline OK.
)

echo Starting local chat and opening Chrome...
echo Leave this window open while you chat.
start "" %PY% -m http.server %PORT% --bind 127.0.0.1
timeout /t 2 /nobreak >nul
start "" "chrome" "%URL%" 2>nul
if errorlevel 1 start "" "%URL%"

echo.
echo Chat is at %URL%
pause
endlocal
