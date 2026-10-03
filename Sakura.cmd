@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js bulunamadi. https://nodejs.org adresinden kurup tekrar deneyin. & pause & exit /b 1)
title Sakura Token Bahcesi
node server.js --open
echo.
echo Sunucu durdu. Pencereyi kapatabilirsiniz.
pause >nul
