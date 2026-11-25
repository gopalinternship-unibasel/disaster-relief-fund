@echo off
rem Starts the Disaster Relief Fund app at http://localhost:4173 and opens it in your browser.
rem Needs Node.js (https://nodejs.org). Without Node.js, open Disaster-Relief-Fund.html instead.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install it from https://nodejs.org or open Disaster-Relief-Fund.html instead.
  start "" "%~dp0Disaster-Relief-Fund.html"
  pause
  exit /b 1
)
node scripts\serve.mjs
pause
