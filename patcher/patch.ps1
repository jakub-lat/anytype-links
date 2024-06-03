$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $true

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "Node.js is not installed!"
    exit 1
}

if (-not (Test-Path node_modules)) {
    npm install
}

npm run patch -- @args | Tee-Object -Variable out

Write-Host "Starting Anytype..."

$dir = $out | Select-String -Pattern "Using directory (.+)" | ForEach-Object { $_.Matches.Groups[1].Value }

Start-Process "$dir\Anytype.exe" &