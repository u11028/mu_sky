@echo off
chcp 65001 >nul
title MU Sky - เปิดเกมออนไลน์
cd /d "%~dp0"

rem Start the game server in its own window unless it is already running.
curl -s -m 3 http://localhost:2567/health >nul 2>&1
if errorlevel 1 (
  echo กำลังเปิดเซิร์ฟเวอร์เกม...
  start "MU Sky - เซิร์ฟเวอร์เกม (ห้ามปิด)" cmd /k "npm start"
  timeout /t 15 /nobreak >nul
)

if not exist "tools\cloudflared.exe" (
  echo กำลังดาวน์โหลด cloudflared...
  if not exist tools mkdir tools
  curl -L -o "tools\cloudflared.exe" https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe
)

echo.
echo ================================================================
echo  รอสักครู่ จะมีลิงก์  https://xxxx.trycloudflare.com  ขึ้นในกรอบด้านล่าง
echo  คัดลอกลิงก์นั้นส่งให้เพื่อนเล่นได้จากทุกที่
echo  ห้ามปิดหน้าต่างนี้ (ปิดเมื่อไหร่ ลิงก์ใช้ไม่ได้)  กด Ctrl+C เพื่อหยุด
echo ================================================================
echo.
"tools\cloudflared.exe" tunnel --no-autoupdate --url http://localhost:2567
pause
