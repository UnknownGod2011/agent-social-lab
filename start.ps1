param([switch]$Install, [int]$Port = 8000)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if ($Install -or !(Test-Path '.venv/Scripts/python.exe')) {
    py -3.12 -m venv .venv
    if ($LASTEXITCODE) { throw 'Python 3.12 environment creation failed' }
    & ./.venv/Scripts/python.exe -m pip install -r requirements.txt
    if ($LASTEXITCODE) { throw 'Python dependencies failed' }
}
if ($Install -or !(Test-Path 'web/dist/index.html')) {
    npm --prefix web install
    if ($LASTEXITCODE) { throw 'Frontend dependencies failed' }
    npm --prefix web run build
    if ($LASTEXITCODE) { throw 'Frontend build failed' }
}
Write-Host "Beyond Task Talk Lab: http://127.0.0.1:$Port"
& ./.venv/Scripts/python.exe -m uvicorn api.main:app --host 127.0.0.1 --port $Port
