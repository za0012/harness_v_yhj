param(
    [string]$RunId = $env:FLIGHT_RECORDER_RUN_ID,
    [string]$ToolName = "unknown",
    [string]$Summary = "Tool call started"
)

if ([string]::IsNullOrWhiteSpace($RunId)) {
    $RunId = Get-Date -Format "yyyyMMdd-HHmmss-hook"
}

$root = Split-Path -Parent $PSScriptRoot
$path = Join-Path $root ".harness\runs\$RunId\events.jsonl"
$dir = Split-Path -Parent $path
New-Item -ItemType Directory -Force -Path $dir | Out-Null

$event = [ordered]@{
    timestamp = (Get-Date).ToString("o")
    run_id = $RunId
    type = "tool_call"
    summary = $Summary
    data = @{
        tool_name = $ToolName
        hook = "pre-tool-use"
    }
}

($event | ConvertTo-Json -Depth 8 -Compress) | Add-Content -Encoding UTF8 -Path $path
Write-Output $RunId
