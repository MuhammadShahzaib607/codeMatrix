param(
  [Parameter(Mandatory = $true)]
  [string]$Match
)

$dll = Join-Path $PSScriptRoot 'CwdProbe.dll'
if (-not (Test-Path $dll)) {
  Add-Type -TypeDefinition (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'CwdProbe.cs') -Raw) -OutputAssembly $dll
}
[System.Reflection.Assembly]::LoadFrom($dll) | Out-Null

$processes = Get-CimInstance Win32_Process
foreach ($p in $processes) {
  $cwd = [CwdProbe]::GetCwd([int]$p.ProcessId)
  if ($cwd -and $cwd.ToLower().Contains($Match.ToLower())) {
    $cmd = $p.CommandLine
    if ($cmd -and $cmd.Length -gt 160) { $cmd = $cmd.Substring(0, 160) }
    Write-Output ("{0}`t{1}`t{2}`t{3}" -f $p.ProcessId, $p.ParentProcessId, $p.Name, $cmd)
  }
}
