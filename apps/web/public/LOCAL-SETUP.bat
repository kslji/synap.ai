@echo off
REM Surf AI — ONE command after unzip. Reads agent.json baked into this zip.
REM   LOCAL-SETUP.bat
cd /d "%~dp0"
setlocal EnableExtensions
set CACHE=%USERPROFILE%\.surf-ai\cache
if not exist "%CACHE%" mkdir "%CACHE%"

set AGENT=surf
set MODEL=llama3.2:3b
set TITLE=Surf + Ollama

if exist "agent.json" (
  where python >nul 2>&1 && set PY=python
  if not defined PY where py >nul 2>&1 && set PY=py
  if defined PY (
    for /f "usebackq delims=" %%A in (`%PY% -c "import json;d=json.load(open('agent.json'));print(d.get('agent','surf'))"`) do set AGENT=%%A
    for /f "usebackq delims=" %%A in (`%PY% -c "import json;d=json.load(open('agent.json'));print(d.get('model') or 'llama3.2:3b')"`) do set MODEL=%%A
    for /f "usebackq delims=" %%A in (`%PY% -c "import json;d=json.load(open('agent.json'));print(d.get('title') or 'Surf')"`) do set TITLE=%%A
  )
)

echo Surf AI — one-command local setup
echo Pack: %TITLE% (%AGENT%)
echo Folder: %cd%
echo.

if /i "%AGENT%"=="gpt4all" goto GPT4ALL
if /i "%AGENT%"=="jan" goto JAN
if /i "%AGENT%"=="anythingllm" goto ANYTHING
goto SURF

:GPT4ALL
echo GPT4All (MIT) — https://www.nomic.ai/gpt4all
set DEST=%CACHE%\gpt4all-installer-win64.exe
if not exist "%DEST%" (
  echo Downloading GPT4All installer once...
  powershell -NoProfile -Command "Invoke-WebRequest -Uri 'https://gpt4all.io/installers/gpt4all-installer-win64.exe' -OutFile '%DEST%'"
)
echo Opening installer / app...
start "" "%DEST%"
goto END

:JAN
echo Jan AI (AGPL-3.0) — https://jan.ai
set DEST=%CACHE%\jan.exe
if not exist "%DEST%" (
  echo Downloading Jan once...
  powershell -NoProfile -Command "Invoke-WebRequest -Uri 'https://app.jan.ai/download/latest/win-x64' -OutFile '%DEST%'"
)
start "" "%DEST%"
goto END

:ANYTHING
echo AnythingLLM (MIT) — https://anythingllm.com
set DEST=%CACHE%\AnythingLLMDesktop.exe
if not exist "%DEST%" (
  echo Downloading AnythingLLM Desktop once...
  powershell -NoProfile -Command "Invoke-WebRequest -Uri 'https://cdn.anythingllm.com/latest/AnythingLLMDesktop.exe' -OutFile '%DEST%'"
)
start "" "%DEST%"
goto END

:SURF
set PORT=18766
set URL=http://127.0.0.1:18766/local-agent.html

if not exist "local-agent.html" (
  echo local-agent.html is not in this folder.
  echo Unzip the Surf pack, then run LOCAL-SETUP.bat from the local-ai folder.
  pause
  exit /b 1
)

where python >nul 2>&1 && set PY=python
if not defined PY where py >nul 2>&1 && set PY=py
if not defined PY (
  echo Python 3 is required once to open Surf in Chrome.
  echo Install from https://www.python.org/downloads/windows/  (tick Add to PATH)
  pause
  exit /b 1
)

echo Python:
%PY% --version
echo Model baked into this zip: %MODEL%

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
  echo Downloading %MODEL% once. After this, Surf works offline.
  ollama pull %MODEL%
) else (
  echo Model already present — offline OK.
)

echo Starting Surf and opening Chrome...
echo Leave this window open while you chat.
start "" %PY% -m http.server %PORT% --bind 127.0.0.1
timeout /t 2 /nobreak >nul
start "" "chrome" "%URL%" 2>nul
if errorlevel 1 start "" "%URL%"

echo.
echo Surf is running at %URL%
pause
goto END

:END
endlocal
