param(
    [string]$Application,
    [switch]$Preview
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($Application) {
    if (-not (Test-Path -LiteralPath $Application)) {
        $Application = Join-Path $PSScriptRoot "applications/$Application.json"
    }
    $Application = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Application)
    $outputPath = Join-Path $PSScriptRoot ('build/' + [System.IO.Path]::GetFileNameWithoutExtension($Application))
    $source = Join-Path $outputPath 'resume.tex'
    $pdf = Join-Path $outputPath 'resume.pdf'
}
else {
    $outputPath = Join-Path $PSScriptRoot 'build'
    $source = Join-Path $PSScriptRoot 'resume.tex'
    $pdf = Join-Path $PSScriptRoot 'resume.pdf'
}
$compiledPdf = Join-Path $outputPath 'resume.pdf'
$previewBase = Join-Path $outputPath 'resume-preview'
$artifacts = @($compiledPdf, $pdf, "$previewBase.png") | Select-Object -Unique

Push-Location -LiteralPath $PSScriptRoot
try {
    Remove-Item -LiteralPath $artifacts -Force -ErrorAction SilentlyContinue
    $compiler = Get-Command xelatex -CommandType Application -ErrorAction Stop
    $inspector = Get-Command pdfinfo -CommandType Application -ErrorAction Stop
    if ($Preview) { $renderer = Get-Command pdftoppm -CommandType Application -ErrorAction Stop }
    if ($Application) {
        & node (Join-Path $PSScriptRoot 'tailor.js') render --application $Application --out $source
        if ($LASTEXITCODE -ne 0) { throw "Could not render $Application." }
    }

    $compilerInput = (Resolve-Path -LiteralPath $source -Relative).Replace('\', '/')
    New-Item -ItemType Directory -Path $outputPath -Force | Out-Null
    for ($pass = 1; $pass -le 2; $pass++) {
        & $compiler.Source '-interaction=nonstopmode' '-halt-on-error' '-file-line-error' '-jobname=resume' "-output-directory=$outputPath" $compilerInput
        if ($LASTEXITCODE -ne 0) { throw "XeLaTeX failed; see $outputPath/resume.log." }
    }

    $info = (& $inspector.Source $compiledPdf) -join "`n"
    if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the generated PDF.' }
    $pageMatch = [regex]::Match($info, '(?m)^Pages:\s+(\d+)\s*$')
    if (-not $pageMatch.Success) { throw 'Could not determine the PDF page count.' }
    $pages = [int]$pageMatch.Groups[1].Value
    if ($pages -ne 1) { throw "Resume must be exactly one page; generated $pages pages." }
    if ($pdf -ne $compiledPdf) { Move-Item -LiteralPath $compiledPdf -Destination $pdf -Force }

    if ($Preview) {
        & $renderer.Source '-scale-to' '1600' '-png' '-singlefile' $pdf $previewBase
        if ($LASTEXITCODE -ne 0) { throw 'PDF preview rendering failed.' }
    }
    Write-Host "Built $pdf (1 page)"
}
catch {
    Remove-Item -LiteralPath $artifacts -Force -ErrorAction SilentlyContinue
    throw
}
finally { Pop-Location }
