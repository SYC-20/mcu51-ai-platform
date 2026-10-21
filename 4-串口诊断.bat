@echo off
cd /d "%~dp0"
if not exist node_modules\serialport (
  echo Installing components, please wait...
  call npm install --no-fund --no-audit
)
node scripts\diag-serial.js %*
pause
