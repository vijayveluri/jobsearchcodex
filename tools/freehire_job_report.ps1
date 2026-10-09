<#
.SYNOPSIS
Search FreeHire and create a local HTML report with clickable posting links and expandable descriptions.

.EXAMPLE
.\tools\freehire_job_report.ps1 -Query "site reliability engineer" -City Hyderabad

.EXAMPLE
.\tools\freehire_job_report.ps1 -Query "site reliability engineer" -Region mena
#>
[CmdletBinding()]
param(
    [string]$Query = "site reliability engineer",
    [string]$City,
    [string]$Region,
    [ValidateRange(1, 3650)][int]$JobAge = 30,
    [ValidateRange(1, 100)][int]$Limit = 10
)

if ($City -and $Region) {
    throw 'Pass either -City or -Region, not both. The FreeHire facets can mix locations when combined.'
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$bun = Join-Path $repoRoot '.runtime\bin\bun.exe'
$cli = Join-Path $repoRoot '.agents\skills\freehire-search\cli\src\cli.ts'
if (!(Test-Path -LiteralPath $bun)) { throw "Bun was not found at $bun" }
if (!(Test-Path -LiteralPath $cli)) { throw "FreeHire CLI was not found at $cli" }

$cliArgs = @('run', $cli, 'search', '-q', $Query, '--jobage', "$JobAge", '--limit', "$Limit", '--description-format', 'text', '--format', 'json')
if ($City) { $cliArgs += @('--city', $City) }
if ($Region) { $cliArgs += @('--region', $Region) }

Push-Location $repoRoot
try {
    $rawJson = & $bun @cliArgs
    $cliExitCode = $LASTEXITCODE
} finally {
    Pop-Location
}
if ($cliExitCode -ne 0) { throw 'FreeHire search failed. See the CLI error above.' }

try {
    $payload = ($rawJson -join [Environment]::NewLine) | ConvertFrom-Json
} catch {
    throw "The FreeHire CLI did not return valid JSON: $($_.Exception.Message)"
}

function ConvertTo-SafeHtml([object]$Value) {
    return [System.Net.WebUtility]::HtmlEncode([string]$Value)
}

$cards = foreach ($job in $payload.results) {
    $title = ConvertTo-SafeHtml $job.title
    $company = ConvertTo-SafeHtml $job.company
    $location = ConvertTo-SafeHtml $job.location
    $date = ConvertTo-SafeHtml $job.date
    $description = ([string]$job.description -replace '\s+', ' ').Trim()
    if (!$description) { $description = 'No description was provided by the source.' }
    $short = $description
    if ($short.Length -gt 280) { $short = $short.Substring(0, 280).TrimEnd() + '…' }
    $short = ConvertTo-SafeHtml $short
    $fullDescription = ConvertTo-SafeHtml $description
    $url = [string]$job.url
    if ($url -match '^https?://') {
        $safeUrl = ConvertTo-SafeHtml $url
        $postingLink = "<a class=`"button`" href=`"$safeUrl`" target=`"_blank`" rel=`"noopener noreferrer`">Open posting / apply</a>"
        $titleHtml = "<a href=`"$safeUrl`" target=`"_blank`" rel=`"noopener noreferrer`">$title</a>"
    } else {
        $postingLink = '<span class="muted">No valid posting URL supplied</span>'
        $titleHtml = $title
    }
    @"
<article class="job">
  <h2>$titleHtml</h2>
  <p class="meta">$company · $location · Posted $date</p>
  <p>$short</p>
  <details><summary>View more</summary><div class="full">$fullDescription</div></details>
  <p>$postingLink</p>
</article>
"@
}

if (!$cards) { $cards = '<p>No jobs matched this search.</p>' }
$generated = Get-Date -Format 'yyyy-MM-dd HH:mm'
$heading = 'Job results: ' + (ConvertTo-SafeHtml $Query)
$reportHtml = @"
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>$heading</title>
<style>
body{font:16px/1.5 Segoe UI,Arial,sans-serif;max-width:1000px;margin:2rem auto;padding:0 1rem;color:#18212b;background:#f5f7fa}
h1{font-size:1.7rem}.note,.meta,.muted{color:#596579}.job{background:#fff;border:1px solid #d8dee8;border-radius:10px;padding:1rem 1.25rem;margin:1rem 0;box-shadow:0 2px 7px #10204012}.job h2{font-size:1.2rem;margin:.1rem 0}.job a{color:#0759b7}.meta{font-size:.92rem}.button{display:inline-block;background:#0759b7;color:#fff!important;text-decoration:none;padding:.55rem .85rem;border-radius:6px}.button:hover{background:#06458e}summary{cursor:pointer;color:#0759b7;font-weight:600}.full{white-space:pre-wrap;margin-top:.6rem}footer{margin-top:2rem;color:#596579;font-size:.85rem}
</style>
</head>
<body>
<h1>$heading</h1>
<p class="note">$($payload.meta.count) results · Generated $generated · Select “View more” to expand each full description.</p>
$($cards -join "`n")
<footer>Job data from FreeHire. Check the posting for current status and application instructions.</footer>
</body>
</html>
"@

$reportsDir = Join-Path $repoRoot 'reports'
New-Item -ItemType Directory -Force -Path $reportsDir | Out-Null
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$reportPath = Join-Path $reportsDir "freehire-$timestamp.html"
Set-Content -LiteralPath $reportPath -Value $reportHtml -Encoding utf8
Write-Output "Report created: $reportPath"
