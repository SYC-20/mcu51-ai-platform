# 一键接入 Agnes Harness：找到 agnes.mjs → 写入 config.json → 登记并启用 MCP 服务 → 试一次对话
param([string]$Agnes = '')
$ErrorActionPreference = 'Continue'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
function Step($t) { Write-Host ''; Write-Host "==== $t ====" -ForegroundColor Cyan }
function Fail($t) { Write-Host $t -ForegroundColor Red; exit 1 }
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { Fail '没有找到 Node.js，请先双击 1-安装.bat' }

$cfgFile = Join-Path $root 'config.json'
if (-not (Test-Path $cfgFile)) { Copy-Item (Join-Path $root 'config.example.json') $cfgFile }
$cfg = (Get-Content $cfgFile -Raw -Encoding UTF8) -replace '^\uFEFF', '' | ConvertFrom-Json

Step '1/4 查找 agnes.mjs'
$cands = @()
if ($Agnes) { $cands += $Agnes }
if ($cfg.agh -and $cfg.agh.cli) { $cands += $cfg.agh.cli }
$rel = 'packages\cli\dist\stable\agnes.mjs'
$bases = @([Environment]::GetFolderPath('Desktop'), (Join-Path $env:USERPROFILE 'Desktop'), (Join-Path $env:USERPROFILE 'Downloads'), $env:USERPROFILE, 'D:\', 'C:\', 'E:\')
foreach ($b in $bases) {
  if (-not $b) { continue }
  foreach ($n in @('agnes-harness-main', 'agnes-harness', 'agh')) {
    $cands += (Join-Path (Join-Path $b $n) $rel)
    $cands += (Join-Path (Join-Path (Join-Path $b $n) $n) $rel)
  }
}
$cli = $cands | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
if (-not $cli) {
  Write-Host '没自动找到，请在弹出的窗口里选中 agnes.mjs（在 AGH 文件夹的 packages\cli\dist\stable 里）' -ForegroundColor Yellow
  Add-Type -AssemblyName System.Windows.Forms
  $dlg = New-Object System.Windows.Forms.OpenFileDialog
  $dlg.Filter = 'agnes.mjs|agnes.mjs|所有文件|*.*'
  $dlg.Title = '选择 agnes.mjs'
  if ($dlg.ShowDialog() -ne 'OK') { Fail '没有选择文件，已退出' }
  $cli = $dlg.FileName
}
$cli = (Resolve-Path -LiteralPath $cli).Path
Write-Host "使用：$cli" -ForegroundColor Green
if (-not $cfg.agh) { $cfg | Add-Member -NotePropertyName agh -NotePropertyValue ([pscustomobject]@{}) }
if ($cfg.agh.PSObject.Properties.Name -contains 'cli') { $cfg.agh.cli = $cli } else { $cfg.agh | Add-Member -NotePropertyName cli -NotePropertyValue $cli }
[IO.File]::WriteAllText($cfgFile, ($cfg | ConvertTo-Json -Depth 10), [Text.UTF8Encoding]::new($false))
Write-Host '已写入 config.json 的 agh.cli' -ForegroundColor Green

function Get-Mcp {
  $out = (& $node $cli mcp get mcu51 2>&1 | Out-String)
  if ($out -match 'revision=([a-f0-9]{64})\s+trust=(\S+)\s+desired=(\S+)\s+actual=(\S+)') {
    return @{ revision = $Matches[1]; trust = $Matches[2]; desired = $Matches[3]; actual = $Matches[4]; raw = $out.Trim() }
  }
  return @{ raw = $out.Trim() }
}

Step '2/4 登记平台 MCP 服务（mcu51-platform）'
Write-Host '下面出现 "Continue? [y/N]" 时，输入 y 再按回车。' -ForegroundColor Yellow
$m = Get-Mcp
if (-not $m.revision) {
  $mcp = Join-Path $root 'server\mcp-stdio.js'
  $tools = 'board_status', 'list_experiments', 'get_code', 'compile', 'flash', 'capture', 'run_test', 'search_docs'
  $a = @('mcp', 'add', 'mcu51', '--name', 'mcu51-platform', '--stdio', $node, '--arg', $mcp)
  foreach ($t in $tools) { $a += @('--allow-tool', $t) }
  & $node $cli @a
  $m = Get-Mcp
  if (-not $m.revision) { Fail "登记失败：$($m.raw)" }
} else { Write-Host '已经登记过，跳过' }

Step '3/4 信任并启用 MCP 服务'
if ($m.trust -ne 'trusted') {
  & $node $cli mcp trust mcu51 --expected-revision $m.revision
  $m = Get-Mcp
}
if ($m.desired -ne 'enabled') {
  & $node $cli mcp enable mcu51 --expected-revision $m.revision
  $m = Get-Mcp
}
Write-Host $m.raw
$st = (& $node $cli mcp status mcu51 2>&1 | Out-String).Trim()
Write-Host $st
$n = 0
if ($st -match 'tools=(\d+)') { $n = [int]$Matches[1] }
if ($m.trust -ne 'trusted' -or $m.desired -ne 'enabled' -or $st -notmatch 'connection=ready' -or $n -lt 1) {
  Write-Host ''
  Write-Host 'MCP 服务没有就绪。常见原因：' -ForegroundColor Yellow
  Write-Host '  1. 上面问 Continue? [y/N] 时没有输入 y —— 重新双击 5-接入AI.bat 即可。'
  Write-Host '  2. 出现 "not allowed by profile policy"：AGH 的安全策略不允许启动 node.exe。'
  Write-Host '     请打开 AGH 网页 → 设置 → MCP，找到 mcu51-platform，点“信任”和“启用”。'
  Write-Host '  3. 出现 tools=0：把本窗口截图发给开发者。'
  Fail '接入未完成'
}
& $node $cli mcp tools mcu51

Step '4/4 试一次 Agnes 对话'
$ws = Join-Path $root ('data\agh-workspace\chat-setup-' + [DateTimeOffset]::Now.ToUnixTimeMilliseconds())
New-Item -ItemType Directory -Force $ws | Out-Null
$res = (& $node $cli -p --mode json --cwd $ws '请只回复一句：你好，我是 Agnes 助教' 2>&1 | Out-String)
$line = ($res -split "`r?`n" | Where-Object { $_.StartsWith('{') } | Select-Object -Last 1)
if ($line) {
  $r = $line | ConvertFrom-Json
  Write-Host "结束原因：$($r.reason)"
  Write-Host "Agnes 回复：$($r.text)" -ForegroundColor Green
} else {
  Write-Host $res
  Fail 'Agnes 没有返回结果，请把本窗口截图发给开发者'
}
Write-Host ''
Write-Host '完成。请关掉平台窗口后重新双击 3-启动实物板.bat，在右侧“Agnes AI 助教”里提问。' -ForegroundColor Green
