param(
  [Parameter(Mandatory = $true)]
  [string]$ProcessIds
)
$ids = @($ProcessIds -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })

$dll = Join-Path $PSScriptRoot 'CwdProbe.dll'
if (-not (Test-Path $dll)) {
  Add-Type -TypeDefinition (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'CwdProbe.cs') -Raw) -OutputAssembly $dll
}
[System.Reflection.Assembly]::LoadFrom($dll) | Out-Null

foreach ($id in $ids) {
  $cwd = [CwdProbe]::GetCwd([int]$id)
  if (-not $cwd) { $cwd = '' }
  Write-Output ("{0}`t{1}" -f $id, $cwd)
}
