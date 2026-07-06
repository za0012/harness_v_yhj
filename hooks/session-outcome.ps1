param(
    [string]$RunId = $env:FLIGHT_RECORDER_RUN_ID,
    [string]$Summary = "Session completed",
    [string]$Status = "completed"
)

if ([string]::IsNullOrWhiteSpace($RunId)) {
    $RunId = Get-Date -Format "yyyyMMdd-HHmmss-session"
}

$root = Split-Path -Parent $PSScriptRoot
$path = Join-Path $root ".harness\runs\$RunId\events.jsonl"
$dir = Split-Path -Parent $path
New-Item -ItemType Directory -Force -Path $dir | Out-Null

$event = [ordered]@{
    timestamp = (Get-Date).ToString("o")
    run_id = $RunId
    type = "outcome"
    summary = $Summary
    data = @{
        status = $Status
        hook = "session-outcome"
    }
}

($event | ConvertTo-Json -Depth 8 -Compress) | Add-Content -Encoding UTF8 -Path $path
Write-Output $RunId
