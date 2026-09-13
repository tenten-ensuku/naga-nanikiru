$ErrorActionPreference = 'Stop'
$botRepo = Split-Path -Parent $PSScriptRoot
$botEntry = Join-Path $botRepo 'scripts/run-discord-sync-v242.mjs'
$botNode = (Get-Command node.exe -ErrorAction Stop).Source
$alreadyRunning = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($botEntry) -and $_.CommandLine.TrimEnd().EndsWith(' run') }
if ($alreadyRunning) { exit 0 }
$botLogs = Join-Path $botRepo 'output/discord-bot-v242/logs'
New-Item -ItemType Directory -Path $botLogs -Force | Out-Null
$botStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$botChild = Start-Process -FilePath $botNode -ArgumentList @('"' + $botEntry + '"','run') -WorkingDirectory $botRepo -WindowStyle Hidden -RedirectStandardOutput (Join-Path $botLogs "$botStamp.out.log") -RedirectStandardError (Join-Path $botLogs "$botStamp.err.log") -Wait -PassThru
exit $botChild.ExitCode
