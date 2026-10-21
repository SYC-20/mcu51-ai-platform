# 检查 Agnes 模型能不能连上：先测网络，再让 AGH 自己做一次最小调用
$ErrorActionPreference = 'Continue'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
function Step($t) { Write-Host ''; Write-Host "==== $t ====" -ForegroundColor Cyan }

Step '1/2 网络能否连到 api.agnes-ai.cn'
try {
  $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 15 'https://api.agnes-ai.cn/v1/models'
  Write-Host "能连上（状态 $($r.StatusCode)）" -ForegroundColor Green
} catch {
  $code = $_.Exception.Response.StatusCode.value__
  if ($code) { Write-Host "能连上（服务器返回 $code，没带密钥时这是正常的）" -ForegroundColor Green }
  else { Write-Host "连不上：$($_.Exception.Message)" -ForegroundColor Red; Write-Host '请检查电脑能否上网，是否开了代理/VPN 或校园网需要登录。' -ForegroundColor Yellow }
}

Step '2/2 让 AGH 用你的账号试调用一次模型'
$cfg = (Get-Content (Join-Path $root 'config.json') -Raw -Encoding UTF8) -replace '^\uFEFF', '' | ConvertFrom-Json
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $cfg.agh.cli) { Write-Host 'config.json 里没有 agh.cli，请先双击 5-接入AI.bat' -ForegroundColor Red; exit 1 }
& $node $cfg.agh.cli doctor provider --probe 2>&1 | Out-Host
Write-Host ''
Write-Host '请把整个窗口截图发给开发者。' -ForegroundColor Green
