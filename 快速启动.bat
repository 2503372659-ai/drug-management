@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ====================================
echo   慢性病用药管理系统 v3.0
echo ====================================
echo.
echo 启动本地服务器...
start /min "" node -e "require('http').createServer((q,r)=>{r.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});require('fs').readFile('药品管理.html','utf8',(e,d)=>{r.end(d||'500')})}).listen(3000)"
timeout /t 2 /nobreak >nul
echo.
echo   电脑访问: http://localhost:3000
echo.
echo   手机访问(同WiFi):
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4"') do echo   http://%%a:3000
echo.
echo ====================================
start http://localhost:3000
echo 浏览器已自动打开
echo 关闭此窗口不影响服务运行
pause
