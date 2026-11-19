# Integration tests use isolated copies; resume.tex is never modified.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$testRoot = Join-Path $PSScriptRoot ('build/test-build-' + [guid]::NewGuid().ToString('N'))
$shell = (Get-Process -Id $PID).Path
New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'resume.sty'), (Join-Path $PSScriptRoot 'build.ps1') -Destination $testRoot
$original = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'resume.tex') -Raw
$fixture = Join-Path $testRoot 'resume.tex'
$pdf = Join-Path $testRoot 'resume.pdf'
$previewImage = Join-Path $testRoot 'build/resume-preview.png'

function Invoke-TestBuild {
    param([string]$Content, [bool]$ExpectSuccess, [string]$ExpectedError = '')
    [System.IO.File]::WriteAllText($fixture, $Content, [System.Text.UTF8Encoding]::new($false))
    $output = & $shell -NoProfile -File (Join-Path $testRoot 'build.ps1') -Preview 2>&1
    $exitCode = $LASTEXITCODE
    if (($exitCode -eq 0) -ne $ExpectSuccess) {
        throw "Unexpected build result ($exitCode): $($output -join "`n")"
    }
    if ($ExpectSuccess) {
        if (-not (Test-Path -LiteralPath $pdf) -or -not (Test-Path -LiteralPath $previewImage)) {
            throw 'Successful build did not produce both PDF and preview.'
        }
    }
    else {
        if (Test-Path -LiteralPath $pdf) { throw 'Rejected build left a PDF behind.' }
        if (Test-Path -LiteralPath $previewImage) { throw 'Rejected build left a stale preview behind.' }
        $log = Get-Content -LiteralPath (Join-Path $testRoot 'build/resume.log') -Raw
        if (($log + ($output -join "`n")) -notmatch $ExpectedError) {
            throw "Failure did not report the expected error: $ExpectedError"
        }
    }
}

try {
    Invoke-TestBuild -Content $original -ExpectSuccess $true
    Write-Host 'PASS: current resume builds with a one-page PDF and preview.'

    # Ordinary flowing text must trigger the TeX guard without explicit page breaks.
    $overflow = ('Overflow content for the page-limit regression test.\par' + "`n") * 120
    Invoke-TestBuild -Content $original.Replace('\end{document}', $overflow + '\end{document}') -ExpectSuccess $false -ExpectedError 'Resume exceeds one page'
    Write-Host 'PASS: natural overflow is rejected and stale deliverables are removed.'

    # Disable only the TeX guard to prove the independent final-PDF check works.
    $twoPages = $original.Replace('\begin{document}', '\RemoveFromHook{shipout/before}[resume/one-page]' + "`n" + '\begin{document}')
    $twoPages = $twoPages.Replace('\end{document}', '\newpage Second page.\end{document}')
    Invoke-TestBuild -Content $twoPages -ExpectSuccess $false -ExpectedError 'Resume must be exactly one page; generated 2 pages'
    Write-Host 'PASS: PDF inspection independently rejects two-page output.'

    Invoke-TestBuild -Content $original -ExpectSuccess $true
    Invoke-TestBuild -Content $original.Replace('\end{document}', '\undefinedResumeTestCommand\end{document}') -ExpectSuccess $false -ExpectedError 'Undefined control sequence'
    Write-Host 'PASS: compilation errors fail the build and remove stale deliverables.'

    # Exercise the actual tailoring CLI and build arguments, including spaces in paths.
    $application = Join-Path $testRoot 'application.json'
    $tailoredSource = Join-Path $testRoot 'tailored with spaces/resume.tex'
    $tailoredOutput = Join-Path $testRoot 'tailored output'
    $tailor = Join-Path $PSScriptRoot 'tailor.js'
    'Jenkins, continuous integration, microservices, and blue-green deployments' | & node $tailor recommend --out $application | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not recommend tailored bullets.' }
    & node $tailor render --application $application --out $tailoredSource | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not render tailored resume.' }
    $output = & $shell -NoProfile -File (Join-Path $PSScriptRoot 'build.ps1') -Source $tailoredSource -OutputDirectory $tailoredOutput -Preview 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Tailored build failed: $($output -join "`n")" }
    if (-not (Test-Path -LiteralPath (Join-Path $tailoredOutput 'resume.pdf')) -or
        -not (Test-Path -LiteralPath (Join-Path $tailoredOutput 'resume-preview.png'))) {
        throw 'Tailored build did not produce a PDF and preview.'
    }
    if ((Get-Content -LiteralPath (Join-Path $PSScriptRoot 'resume.tex') -Raw) -cne $original) {
        throw 'Tailoring modified the baseline resume.tex.'
    }
    Write-Host 'PASS: keyword-ranked resume builds separately with a one-page PDF and preview.'
}
finally {
    # Only remove this run's verified workspace-local directory.
    $buildRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'build')) + [System.IO.Path]::DirectorySeparatorChar
    $resolvedTestRoot = [System.IO.Path]::GetFullPath($testRoot)
    if (-not $resolvedTestRoot.StartsWith($buildRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to clean a test directory outside build/: $resolvedTestRoot"
    }
    Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force
}
