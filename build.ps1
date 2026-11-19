param(
    [switch]$Preview,
    [string]$Source = (Join-Path $PSScriptRoot 'resume.tex'),
    [string]$OutputDirectory = (Join-Path $PSScriptRoot 'build')
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
# Resolve caller-provided paths before changing to the stylesheet directory.
$sourcePath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Source)
$outputPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputDirectory)
$compiledPdf = Join-Path $outputPath 'resume.pdf'
$isDefaultBuild = -not $PSBoundParameters.ContainsKey('Source') -and -not $PSBoundParameters.ContainsKey('OutputDirectory')
$pdf = if ($isDefaultBuild) { Join-Path $PSScriptRoot 'resume.pdf' } else { $compiledPdf }
$previewBase = Join-Path $outputPath 'resume-preview'
$previewImage = $previewBase + '.png'
$artifacts = @($compiledPdf, $pdf, $previewImage) | Select-Object -Unique

Push-Location -LiteralPath $PSScriptRoot
try {
    # A failed build must never leave a stale or rejected deliverable.
    Remove-Item -LiteralPath $artifacts -Force -ErrorAction SilentlyContinue
    $compiler = Get-Command xelatex -CommandType Application -ErrorAction Stop
    $inspector = Get-Command pdfinfo -CommandType Application -ErrorAction Stop
    if ($Preview) {
        $renderer = Get-Command pdftoppm -CommandType Application -ErrorAction Stop
    }
    $compilerInput = (Resolve-Path -LiteralPath $sourcePath -Relative).Replace('\', '/')
    New-Item -ItemType Directory -Path $outputPath -Force | Out-Null
    for ($pass = 1; $pass -le 2; $pass++) {
        & $compiler.Source '-interaction=nonstopmode' '-halt-on-error' '-file-line-error' '-jobname=resume' "-output-directory=$outputPath" $compilerInput
        if ($LASTEXITCODE -ne 0) { throw "XeLaTeX failed; see $outputPath/resume.log." }
    }

    $info = & $inspector.Source $compiledPdf
    if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the generated PDF.' }
    $pageMatch = [regex]::Match(($info -join "`n"), '(?m)^Pages:\s+(\d+)\s*$')
    if (-not $pageMatch.Success) { throw 'Could not determine the PDF page count.' }
    $pages = [int]$pageMatch.Groups[1].Value
    if ($pages -ne 1) { throw "Resume must be exactly one page; generated $pages pages." }
    if ($isDefaultBuild) {
        Move-Item -LiteralPath $compiledPdf -Destination $pdf -Force
    }

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
