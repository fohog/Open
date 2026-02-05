param(
  [Parameter(Mandatory=$true)]
  [string]$ExePath
)

if (-not (Test-Path -LiteralPath $ExePath)) {
  Write-Error "File not found: $ExePath"
  exit 1
}

Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class IconGroupDump {
  public delegate bool EnumResNameProc(IntPtr hModule, IntPtr lpszType, IntPtr lpszName, IntPtr lParam);
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern IntPtr LoadLibraryEx(string lpFileName, IntPtr hFile, uint dwFlags);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool FreeLibrary(IntPtr hModule);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)]
  public static extern bool EnumResourceNames(IntPtr hModule, IntPtr lpszType, EnumResNameProc lpEnumFunc, IntPtr lParam);
  public static readonly IntPtr RT_GROUP_ICON = (IntPtr)14;
}
"@

$LOAD_LIBRARY_AS_DATAFILE = 0x00000002
$h = [IconGroupDump]::LoadLibraryEx($ExePath, [IntPtr]::Zero, $LOAD_LIBRARY_AS_DATAFILE)
if ($h -eq [IntPtr]::Zero) {
  Write-Error "Failed to load module."
  exit 2
}

$results = New-Object System.Collections.Generic.List[string]
$callback = [IconGroupDump+EnumResNameProc]{
  param($hModule, $lpszType, $lpszName, $lParam)
  if ($lpszName.ToInt64() -gt 65535) {
    $name = [Runtime.InteropServices.Marshal]::PtrToStringUni($lpszName)
    $results.Add($name)
  } else {
    $id = $lpszName.ToInt64()
    $results.Add($id.ToString())
  }
  return $true
}

[IconGroupDump]::EnumResourceNames($h, [IconGroupDump]::RT_GROUP_ICON, $callback, [IntPtr]::Zero) | Out-Null
[IconGroupDump]::FreeLibrary($h) | Out-Null

Write-Host "Icon Group IDs in $ExePath"
$numeric = $results | Where-Object { $_ -match '^\d+$' } | Sort-Object { [int]$_ }
$named = $results | Where-Object { $_ -notmatch '^\d+$' } | Sort-Object
$numeric | ForEach-Object { Write-Host $_ }
$named | ForEach-Object { Write-Host $_ }
