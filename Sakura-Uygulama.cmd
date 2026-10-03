@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem Masaüstü uygulamasını kaynak koddan açar (kurulum yapmadan).
if exist "distwin-unpackedSakura Token Bahcesi.exe" (
  start "" "distwin-unpackedSakura Token Bahcesi.exe"
  exit /b 0
)
where npm >nul 2>nul || (echo Node.js bulunamadi. https://nodejs.org adresinden kurup tekrar deneyin. & pause & exit /b 1)
if not exist "node_moduleselectron" call npm install
start "" /b cmd /c "npx electron ."
