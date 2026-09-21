@echo off
cd /d "%~dp0.."
where python >nul 2>&1 && set PY=python
if not defined PY where py >nul 2>&1 && set PY=py
if not defined PY (
  echo Python 3 required to run custom harness cases.
  exit /b 1
)
%PY% harness\run-custom.py
exit /b %ERRORLEVEL%
