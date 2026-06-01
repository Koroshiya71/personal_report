@echo off
:: Ensure the script runs in the directory where it is located
cd /d "%~dp0"
echo ==================================================
echo         AI ACG & Life Report Dashboard           
echo ==================================================
echo 正在为您启动本地服务并打开浏览器看板，请稍候...
echo.

:: Launch Vite dev server and pass the --open flag to open the browser automatically
call npm run dev -- --open

pause
