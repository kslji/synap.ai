@echo off
cd /d "%~dp0.."
where python >nul 2>&1 && set PY=python
if not defined PY where py >nul 2>&1 && set PY=py
if not defined PY (
  echo Python 3 required to run pack evals.
  exit /b 1
)
%PY% harness\run-evals.py
exit /b %ERRORLEVEL%
