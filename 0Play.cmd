@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo FIELDWEAVER requires Node.js 22 or newer.
  echo Install Node.js, then run 0Play.cmd again.
  exit /b 1
)
node scripts\serve.mjs --open
