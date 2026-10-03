@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js bulunamadi. https://nodejs.org adresinden kurup tekrar deneyin. & pause & exit /b 1)
title Sakura Token Bahcesi (widget)
node server.js --widget
echo.
echo Sunucu durdu. Pencereyi kapatabilirsiniz.
pause >nul
