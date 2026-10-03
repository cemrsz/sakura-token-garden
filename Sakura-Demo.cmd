@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js bulunamadi. https://nodejs.org adresinden kurup tekrar deneyin. & pause & exit /b 1)
title Sakura Token Bahcesi (demo)
node server.js --demo --open --port 4880
echo.
echo Sunucu durdu. Pencereyi kapatabilirsiniz.
pause >nul
