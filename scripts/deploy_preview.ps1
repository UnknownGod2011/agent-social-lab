param([switch]$BuildOnly)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$project = 'beyond-task-talk-lab'
$stage = Join-Path $root ".verification/vercel/$project"
$output = Join-Path $stage '.vercel/output'
$assets = Join-Path $output 'static'
$python = Join-Path $root '.venv/Scripts/python.exe'

if (!(Test-Path $python)) { throw 'Install the locked Python environment with start.ps1 -Install first.' }
New-Item -Path $output -ItemType Directory -Force | Out-Null
Push-Location -LiteralPath $root
try {
    npm --prefix web run build -- --mode public --outDir $assets --emptyOutDir
    if ($LASTEXITCODE) { throw 'Hosted frontend build failed.' }
    & $python scripts/build_public_demo.py --output (Join-Path $assets 'demo')
    if ($LASTEXITCODE) { throw 'Synthetic demo export failed.' }
    $routing = '{"version":3,"routes":[{"src":"^/$","dest":"/index.html"},{"handle":"filesystem"}]}'
    [IO.File]::WriteAllText((Join-Path $output 'config.json'), $routing)
} finally {
    Pop-Location
}

if ($BuildOnly) {
    Write-Output $assets
    return
}

Push-Location -LiteralPath $stage
try {
    vercel link --yes --project $project
    if ($LASTEXITCODE) { throw 'Vercel project link failed.' }
    $deployment = vercel deploy --target preview --prebuilt --yes --archive=tgz
    if ($LASTEXITCODE) { throw 'Preview deployment failed.' }
    $url = $deployment | Where-Object { $_ -match '^https://[a-zA-Z0-9.-]+\.vercel\.app$' } | Select-Object -Last 1
    if (!$url) { throw 'Vercel did not return a preview URL.' }
    vercel alias set $url "$project-preview.vercel.app"
    if ($LASTEXITCODE) { throw "Published at $url. Updating the stable preview alias failed." }
    Write-Output "Stable preview: https://$project-preview.vercel.app"
    Write-Output "Build: $url"
} finally {
    Pop-Location
}
