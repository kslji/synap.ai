@echo off
REM Self-check for one Surf AI pack folder (Windows).
setlocal EnableExtensions
cd /d "%~dp0.."

set PASS=0
set FAIL=0

call :need "agent.json" "agent.json"
call :need "MODEL.txt" "MODEL.txt"
call :need "local-agent.html" "local-agent.html"
call :need "LOCAL-SETUP.bat" "LOCAL-SETUP.bat"
call :need "SURF-OPEN.bat" "SURF-OPEN.bat"
call :need "system.md" "system.md"
call :need "harness\TESTS.md" "harness\TESTS.md"

if not exist "agent.json" goto done

set TITLE=
set TAG=
for /f "usebackq delims=" %%A in (`python -c "import json;d=json.load(open('agent.json'));print(d.get('modelTitle') or '')" 2^>nul`) do set "TITLE=%%A"
for /f "usebackq delims=" %%A in (`python -c "import json;d=json.load(open('agent.json'));print(d.get('model') or '')" 2^>nul`) do set "TAG=%%A"

if defined TITLE if defined TAG (
  call :ok "identity %TITLE% (%TAG%)"
) else (
  call :bad "identity" "agent.json missing modelTitle/model — install Python for full checks"
)

findstr /C:"html.standalone #light-note" "local-agent.html" >nul
if errorlevel 1 (call :bad "hides light-note" "missing") else (call :ok "hides light-note in standalone")

findstr /C:"Answers stay short on light models" "local-agent.html" >nul
if errorlevel 1 (call :ok "no re-download upsell copy") else (call :bad "no-upsell" "upsell still present")

findstr /C:"summarize-side" "local-agent.html" >nul
if errorlevel 1 (call :bad "summarize" "missing") else (call :ok "summarize wired")

findstr /C:"erase-side" "local-agent.html" >nul
if errorlevel 1 (call :bad "delete" "missing") else (call :ok "delete wired")

findstr /C:"mic-on" "local-agent.html" >nul
if errorlevel 1 (call :bad "mic" "missing") else (call :ok "mic recording UI")

:done
echo.
if %FAIL% GTR 0 (
  echo Pack check: %PASS% passed, %FAIL% failed.
  echo Re-download from synap.surf/download if files look wrong.
  exit /b 1
)
echo Pack check: %PASS% passed. Ready for LOCAL-SETUP / SURF-OPEN.
if defined TITLE echo This pack: %TITLE% · %TAG%
exit /b 0

:need
if exist "%~2" (call :ok "%~1") else (call :bad "%~1" "missing %~2")
exit /b 0

:ok
set /a PASS+=1
echo ok   %~1
exit /b 0

:bad
set /a FAIL+=1
echo FAIL %~1 — %~2
exit /b 0
