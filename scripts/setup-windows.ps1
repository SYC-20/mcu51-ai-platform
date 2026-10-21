# 51 单片机 AI 测评平台 —— Windows 一键安装（由 1-安装.bat 调用）
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
function Step($t) { Write-Host ''; Write-Host "==== $t ====" -ForegroundColor Cyan }
function Refresh-Path { $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') }

Step '1/4 检查 Node.js'
Refresh-Path
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    Write-Host '未安装 Node.js，正在用 winget 自动安装（会弹出管理员确认，请点“是”）...'
    winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
    Refresh-Path
  }
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host '自动安装失败。请手动安装：浏览器打开 https://nodejs.org/zh-cn ，下载“LTS”版 Windows 安装包，一路“下一步”装完，再重新双击 1-安装.bat' -ForegroundColor Yellow
    Start-Process 'https://nodejs.org/zh-cn/download'
    exit 1
  }
}
Write-Host "Node.js 版本：$(node -v)"

Step '2/4 检查 SDCC 编译器'
function Find-Sdcc {
  $c = Get-Command sdcc.exe -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  $roots = @("$env:ProgramFiles\SDCC", "${env:ProgramFiles(x86)}\SDCC", "$env:LOCALAPPDATA\Programs\SDCC", 'C:\SDCC', 'D:\SDCC', 'D:\Program Files\SDCC', 'E:\SDCC')
  foreach ($k in 'HKLM:\SOFTWARE\WOW6432Node\SDCC', 'HKLM:\SOFTWARE\SDCC', 'HKCU:\SOFTWARE\SDCC') {
    $v = (Get-ItemProperty $k -ErrorAction SilentlyContinue).'(default)'; if ($v) { $roots += $v }
  }
  Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -like '*SDCC*' } | ForEach-Object {
      if ($_.InstallLocation) { $roots += $_.InstallLocation }
      if ($_.UninstallString) { $roots += (Split-Path ($_.UninstallString.Trim('"')) -Parent) }
    }
  foreach ($r in $roots) { if ($r) { $f = Join-Path $r 'bin\sdcc.exe'; if (Test-Path $f) { return $f } } }
  return $null
}
function Find-Installer {
  $dirs = @((Get-Location).Path, (Join-Path $env:USERPROFILE 'Downloads'), (Join-Path $env:USERPROFILE 'Desktop'))
  try { $dirs += (New-Object -ComObject Shell.Application).NameSpace('shell:Downloads').Self.Path } catch {}
  Get-ChildItem -Path ($dirs | Select-Object -Unique) -Filter 'sdcc*.exe' -ErrorAction SilentlyContinue |
    Where-Object { $_.Length -gt 5MB } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
}
function Install-Sdcc($exe) {
  Write-Host "正在安装：$exe"
  Write-Host '会弹出“是否允许更改”请点“是”；如果出现安装窗口，一路点 Next / I Agree / Install / Finish，路径不要改。'
  try { Start-Process $exe -ArgumentList '/S' -Verb RunAs -Wait } catch { Write-Host "安装没有完成：$($_.Exception.Message)" -ForegroundColor Yellow }
}

$sdcc = Find-Sdcc
if (-not $sdcc) {
  $inst = Find-Installer
  if ($inst) { Install-Sdcc $inst.FullName; $sdcc = Find-Sdcc }
}
if (-not $sdcc) {
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show("没有自动找到 SDCC。`n`n接下来会弹出选择文件的窗口，请找到并选中下面任意一个：`n  1）你下载的 SDCC 安装包（sdcc-4.5.0-x64-setup.exe）`n  2）已装好的 sdcc.exe（在 SDCC 安装目录的 bin 文件夹里）", '51 平台安装') | Out-Null
  $dlg = New-Object System.Windows.Forms.OpenFileDialog
  $dlg.Title = '请选择 SDCC 安装包或 sdcc.exe'
  $dlg.Filter = '程序 (*.exe)|*.exe'
  $dlg.InitialDirectory = Join-Path $env:USERPROFILE 'Downloads'
  if ($dlg.ShowDialog() -eq 'OK') {
    $pick = $dlg.FileName
    if ((Split-Path $pick -Leaf) -ieq 'sdcc.exe') { $sdcc = $pick }
    else { Install-Sdcc $pick; $sdcc = Find-Sdcc }
  }
}
if (-not $sdcc) {
  Write-Host '仍然没有找到 SDCC。请把这个窗口截图发给 Devin。' -ForegroundColor Red
  exit 1
}
Write-Host "SDCC：$sdcc" -ForegroundColor Green

Step '3/4 安装平台依赖（第一次需要 1~3 分钟）'
npm install --no-audit --no-fund --registry=https://registry.npmmirror.com
if ($LASTEXITCODE -ne 0) { Write-Host 'npm 安装失败，请检查网络后重试' -ForegroundColor Red; exit 1 }

Step '4/4 生成配置文件 config.json'
if (Test-Path config.json) {
  $old = Get-Content config.json -Raw -Encoding UTF8 | ConvertFrom-Json
  $bin = Split-Path $sdcc -Parent
  $old | Add-Member -NotePropertyName sdcc -NotePropertyValue ([ordered]@{ bin = $sdcc; packihx = (Join-Path $bin 'packihx.exe') }) -Force
  [IO.File]::WriteAllText((Join-Path (Get-Location) 'config.json'), ($old | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding $false))
  Write-Host '已存在 config.json，已更新其中的 SDCC 路径。'
} else {
  $bin = Split-Path $sdcc -Parent
  $cfg = [ordered]@{
    port = 8051
    mode = 'hardware'
    sdcc = [ordered]@{ bin = $sdcc; packihx = (Join-Path $bin 'packihx.exe') }
    flash = [ordered]@{ driver = 'builtin'; port = 'COM3'; handshakeBaud = 2400; transferBaud = 19200; powerCycle = 'rts' }
    detector = [ordered]@{ port = 'COM3'; baud = 115200 }
    agh = [ordered]@{ cli = '' }
  }
  $json = $cfg | ConvertTo-Json -Depth 5
  [IO.File]::WriteAllText((Join-Path (Get-Location) 'config.json'), $json, (New-Object Text.UTF8Encoding $false))
  Write-Host '已生成 config.json（串口号以后再改）。'
}
Write-Host ''
Write-Host '安装完成！下一步：双击 2-启动模拟板.bat' -ForegroundColor Green
