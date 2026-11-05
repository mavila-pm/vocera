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
if not exist node_modules (
  echo Instalando dependencias por unica vez...
  call npm install --no-audit --no-fund
  if errorlevel 1 ( echo No se pudieron instalar las dependencias. & pause & exit /b 1 )
)
call npm run local
pause
