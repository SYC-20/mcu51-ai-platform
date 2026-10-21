# 51 单片机 AI 测评平台 —— Windows 一键启动
# 用法（PowerShell）：  .\scripts\start-windows.ps1          使用 config.json（实物板）
#                     .\scripts\start-windows.ps1 -Sim     使用模拟板
param([switch]$Sim, [switch]$OnChip)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Error '未找到 Node.js，请先安装 Node.js 24（https://nodejs.org）' }
$cfg = if (Test-Path config.json) { Get-Content config.json -Raw -Encoding UTF8 | ConvertFrom-Json } else { $null }
$sdcc = if ($cfg -and $cfg.sdcc.bin) { $cfg.sdcc.bin } else { 'sdcc' }
if (-not (Get-Command $sdcc -ErrorAction SilentlyContinue) -and -not (Test-Path $sdcc)) { Write-Warning "未找到 SDCC（$sdcc），编译功能不可用。请安装 https://sdcc.sourceforge.net 并在 config.json 中填写 sdcc.bin" }
if (-not (Test-Path node_modules\serialport)) { Write-Host '首次运行，正在安装平台组件（npm install）...' -ForegroundColor Yellow; npm install --no-fund --no-audit; if ($LASTEXITCODE -ne 0) { Write-Error '组件安装失败，请双击 1-安装.bat' } }

$port = if ($cfg -and $cfg.port) { [int]$cfg.port } else { 8051 }
$busy = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
foreach ($c in $busy) {
  $p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
  if ($p -and $p.ProcessName -eq 'node') {
    Write-Host "端口 $port 被之前打开的平台占用，正在关闭旧平台..." -ForegroundColor Yellow
    Stop-Process -Id $p.Id -Force; Start-Sleep 1
  } elseif ($p) {
    Write-Host "端口 $port 被其他程序（$($p.ProcessName)）占用，请关闭它，或在 config.json 里把 port 改成别的数字（如 8061）" -ForegroundColor Red
    exit 1
  }
}
Write-Host '可用串口：' ([System.IO.Ports.SerialPort]::GetPortNames() -join ', ')
# 优先用 Edge 打开：语音输入在 Edge 里能用（Chrome 的语音识别在国内连不上）
Start-Job { Start-Sleep 3; try { Start-Process msedge "http://127.0.0.1:$using:port" -ErrorAction Stop } catch { Start-Process "http://127.0.0.1:$using:port" } } | Out-Null
Write-Host "浏览器会自动打开 http://127.0.0.1:$port ；使用期间不要关闭本窗口，关闭窗口即停止平台。" -ForegroundColor Green
$extra = @(); if ($OnChip) { $extra += '--onchip' }
if ($Sim) { node server/index.js --sim @extra } else { node server/index.js @extra }
