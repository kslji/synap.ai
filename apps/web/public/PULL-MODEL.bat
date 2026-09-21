@echo off
REM Pull an Ollama model. Usage: PULL-MODEL.bat [tag]
REM Default: llama3.2:1b
cd /d "%~dp0"
set MODEL=%~1
if "%MODEL%"=="" set MODEL=llama3.2:1b

where ollama >nul 2>&1
if errorlevel 1 (
  echo Ollama is not installed yet.
  echo Install from https://ollama.com then open a new Command Prompt and run:
  echo   ollama pull %MODEL%
  pause
  exit /b 1
)

echo Downloading model: %MODEL%
echo Needs internet once. After that, Surf can chat offline with this model.
ollama pull %MODEL%
echo.
echo Done. Leave Ollama running, then use Surf (LOCAL-SETUP.bat) to chat.
pause
