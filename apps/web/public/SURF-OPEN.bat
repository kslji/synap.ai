@echo off
REM Surf AI — pick among multiple downloaded packs, then open chat.
REM From any directory:
REM   %USERPROFILE%\Downloads\surf-ai-*\SURF-OPEN.bat
REM Or pass a number: SURF-OPEN.bat 2
setlocal EnableExtensions EnableDelayedExpansion

set "LIST=%TEMP%\surf-packs-%RANDOM%.txt"
if exist "%LIST%" del "%LIST%" >nul 2>&1

for %%R in ("%USERPROFILE%\Downloads" "%USERPROFILE%\Desktop" "%USERPROFILE%\Documents") do (
  if exist %%~R\surf-ai-*\LOCAL-SETUP.bat (
    for /d %%D in (%%~R\surf-ai-*) do (
      if exist "%%~D\LOCAL-SETUP.bat" echo %%~D>>"%LIST%"
    )
  )
  if exist "%%~R\local-ai\LOCAL-SETUP.bat" echo %%~R\local-ai>>"%LIST%"
)

if not exist "%LIST%" (
  echo No Surf AI packs found under Downloads, Desktop, or Documents.
  echo Download a zip from https://synap.surf/download , unzip it, then run this again.
  pause
  exit /b 1
)

set /a COUNT=0
for /f "usebackq delims=" %%L in ("%LIST%") do set /a COUNT+=1

if %COUNT%==0 (
  echo No Surf AI packs found.
  del "%LIST%" >nul 2>&1
  pause
  exit /b 1
)

set "CHOICE=%~1"
if "%CHOICE%"=="" if %COUNT%==1 set CHOICE=1

if "%CHOICE%"=="" (
  echo Surf AI — multiple packs on this computer:
  echo.
  set /a N=0
  for /f "usebackq delims=" %%L in ("%LIST%") do (
    set /a N+=1
    set "LABEL=%%~nxL"
    if exist "%%L\agent.json" (
      for /f "usebackq delims=" %%A in (`python -c "import json;d=json.load(open(r'%%L\agent.json'));print((d.get('modelTitle') or d.get('model') or '')+' ('+(d.get('model') or '?')+')')" 2^>nul`) do set "LABEL=%%A — %%~nxL"
    )
    echo   !N!) !LABEL!
  )
  echo.
  set /p CHOICE=Open which pack? [1-%COUNT%]: 
)

set /a IDX=%CHOICE% 2>nul
if %IDX% LSS 1 goto bad
if %IDX% GTR %COUNT% goto bad

set /a N=0
for /f "usebackq delims=" %%L in ("%LIST%") do (
  set /a N+=1
  if !N!==%IDX% (
    echo Opening: %%L
    del "%LIST%" >nul 2>&1
    call "%%L\LOCAL-SETUP.bat"
    endlocal
    exit /b %ERRORLEVEL%
  )
)

:bad
echo Choice out of range.
del "%LIST%" >nul 2>&1
pause
exit /b 1
