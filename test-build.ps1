Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$testRoot = Join-Path $PSScriptRoot ('build/test-build-' + [guid]::NewGuid().ToString('N'))
$shell = (Get-Process -Id $PID).Path
New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
Copy-Item -LiteralPath ('resume.sty', 'build.ps1', 'tailor.js', 'bullets.json' | ForEach-Object { Join-Path $PSScriptRoot $_ }) -Destination $testRoot
$original = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'resume.tex') -Raw -Encoding UTF8
$fixture = Join-Path $testRoot 'resume.tex'

function Invoke-TestBuild {
    param([string]$Content, [bool]$ExpectSuccess, [string]$ExpectedError = '', [string]$Application = '')
    $ErrorActionPreference = 'Continue'
    [System.IO.File]::WriteAllText($fixture, $Content, [System.Text.UTF8Encoding]::new($false))
    $arguments = @('-NoProfile', '-File', (Join-Path $testRoot 'build.ps1'), '-Preview')
    $outputPath = Join-Path $testRoot 'build'
    $pdf = Join-Path $testRoot 'resume.pdf'
    if ($Application) {
        $arguments += @('-Application', $Application)
        $outputPath = Join-Path $outputPath $Application
        $pdf = Join-Path $outputPath 'resume.pdf'
    }
    $preview = Join-Path $outputPath 'resume-preview.png'
    $output = & $shell @arguments 2>&1
    if (($LASTEXITCODE -eq 0) -ne $ExpectSuccess) {
        throw "Unexpected build result ($LASTEXITCODE): $($output -join "`n")"
    }
    if ($ExpectSuccess) {
        if (-not (Test-Path -LiteralPath $pdf) -or -not (Test-Path -LiteralPath $preview)) {
            throw 'Successful build did not produce both PDF and preview.'
        }
        return
    }
    if ((Test-Path -LiteralPath $pdf) -or (Test-Path -LiteralPath $preview)) { throw 'Rejected build left output behind.' }
    $log = Get-Content -LiteralPath (Join-Path $outputPath 'resume.log') -Raw -Encoding UTF8
    if (($log + ($output -join "`n")) -notmatch $ExpectedError) {
        throw "Failure did not report the expected error: $ExpectedError"
    }
}

try {
    Invoke-TestBuild -Content $original -ExpectSuccess $true
    Write-Host 'PASS: current resume builds with a one-page PDF and preview.'

    $overflow = ('Overflow content for the page-limit regression test.\par' + "`n") * 120
    Invoke-TestBuild -Content $original.Replace('\end{document}', $overflow + '\end{document}') -ExpectSuccess $false -ExpectedError 'Resume exceeds one page'
    Write-Host 'PASS: natural overflow is rejected and stale output is removed.'

    $twoPages = $original.Replace('\begin{document}', '\RemoveFromHook{shipout/before}[resume/one-page]' + "`n" + '\begin{document}')
    $twoPages = $twoPages.Replace('\end{document}', '\newpage Second page.\end{document}')
    Invoke-TestBuild -Content $twoPages -ExpectSuccess $false -ExpectedError 'Resume must be exactly one page; generated 2 pages'
    Write-Host 'PASS: PDF inspection independently rejects two-page output.'

    Invoke-TestBuild -Content $original -ExpectSuccess $true
    Invoke-TestBuild -Content $original.Replace('\end{document}', '\undefinedResumeTestCommand\end{document}') -ExpectSuccess $false -ExpectedError 'Undefined control sequence'
    Write-Host 'PASS: compilation errors fail the build and remove stale output.'

    $name = 'tailored app'
    'Jenkins, continuous integration, microservices, and blue-green deployments' |
        & node (Join-Path $testRoot 'tailor.js') recommend --out (Join-Path $testRoot "applications/$name.json") | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not recommend tailored bullets.' }
    Invoke-TestBuild -Content $original -ExpectSuccess $true -Application $name
    if ((Get-Content -LiteralPath $fixture -Raw -Encoding UTF8) -cne $original) { throw 'Tailoring modified the baseline resume.tex.' }
    Write-Host 'PASS: an application renders and builds separately with a one-page PDF and preview.'
}
finally {
    $buildRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'build')) + [System.IO.Path]::DirectorySeparatorChar
    $resolvedTestRoot = [System.IO.Path]::GetFullPath($testRoot)
    if (-not $resolvedTestRoot.StartsWith($buildRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to clean a test directory outside build/: $resolvedTestRoot"
    }
    Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force
}
