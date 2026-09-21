@echo off
REM One-command Colibri setup for Surf AI (optional). Needs Git + internet the first time.
cd /d "%USERPROFILE%"
set DEST=%USERPROFILE%\colibri
set REPO=https://github.com/JustVugg/colibri.git

echo Surf AI — Colibri local agent
echo Repo: %REPO%
echo.

where git >nul 2>&1
if errorlevel 1 (
  echo Git is required. Install Git for Windows, then run this again.
  pause
  exit /b 1
)

if not exist "%DEST%\.git" (
  echo Cloning Colibri into %DEST% ...
  git clone "%REPO%" "%DEST%"
) else (
  echo Colibri already at %DEST%
  cd /d "%DEST%"
  git pull --ff-only
)

cd /d "%DEST%\c"
echo.
echo Next steps from the Colibri docs:
echo   1. Download a Colibri model container onto a large disk.
echo   2. Run:  python coli serve --model D:\path\to\model
echo   3. Leave it on port 8000, then start Surf LOCAL-SETUP to chat.
echo.
echo Online once for clone + model. Offline later if the model is already on disk.
pause
