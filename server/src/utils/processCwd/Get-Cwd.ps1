param(
  [Parameter(Mandatory = $true)]
  [string]$ProcessIds
)

$dll = Join-Path $PSScriptRoot 'CwdProbe.dll'
if (-not (Test-Path $dll)) {
  Add-Type -TypeDefinition (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'CwdProbe.cs') -Raw) -OutputAssembly $dll
}
[System.Reflection.Assembly]::LoadFrom($dll) | Out-Null

foreach ($entry in ($ProcessIds -split ',')) {
  $id = $entry.Trim()
  if (-not $id) { continue }
  $cwd = [CwdProbe]::GetCwd([int]$id)
  if ($cwd) {
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($cwd))
  } else {
    $encoded = ''
  }
  Write-Output ("{0}`t{1}" -f $id, $encoded)
}
