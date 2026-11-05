@echo off
chcp 65001 >nul
title Portal Vocera (local)
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Falta Node.js. Instala la version LTS desde https://nodejs.org y vuelve a abrir este archivo.
  pause
  exit /b 1
)
rem La version construida (dist-demo) solo necesita Node: no instala nada en esta carpeta de OneDrive.
if exist "dist-demo\index.html" (
  node dev\serve-local.mjs --no-build
) else (
  echo No encuentro la carpeta dist-demo. Pidele a Claude que la vuelva a generar.
)
pause
