/**
 * Windows launches the check inside a job object so timeout and Stop kill the
 * whole tree (JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE). Network is not isolated.
 * The script is started only on win32. Linux and macOS never execute it.
 */
export const WINDOWS_JOB_SCRIPT = `
param([Parameter(Mandatory = $true)][string]$Payload)
$ErrorActionPreference = 'Stop'
$json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Payload))
$argv = @((ConvertFrom-Json $json))
if ($argv.Count -lt 1) { exit 2 }
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class SurfJob {
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
  public static extern IntPtr CreateJobObject(IntPtr attrs, string name);
  [DllImport("kernel32.dll")]
  public static extern bool SetInformationJobObject(IntPtr job, int cls, IntPtr info, uint len);
  [DllImport("kernel32.dll")]
  public static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll")]
  public static extern bool CloseHandle(IntPtr handle);
}
[StructLayout(LayoutKind.Sequential)]
public struct SurfBasicLimit {
  public long PerProcessUserTimeLimit;
  public long PerJobUserTimeLimit;
  public uint LimitFlags;
  public System.UIntPtr MinimumWorkingSetSize;
  public System.UIntPtr MaximumWorkingSetSize;
  public uint ActiveProcessLimit;
  public long Affinity;
  public uint PriorityClass;
  public uint SchedulingClass;
}
[StructLayout(LayoutKind.Sequential)]
public struct SurfIoCounters {
  public ulong ReadOperationCount;
  public ulong WriteOperationCount;
  public ulong OtherOperationCount;
  public ulong ReadTransferCount;
  public ulong WriteTransferCount;
  public ulong OtherTransferCount;
}
[StructLayout(LayoutKind.Sequential)]
public struct SurfExtendedLimit {
  public SurfBasicLimit BasicLimitInformation;
  public SurfIoCounters IoInfo;
  public System.UIntPtr ProcessMemoryLimit;
  public System.UIntPtr JobMemoryLimit;
  public System.UIntPtr PeakProcessMemoryUsed;
  public System.UIntPtr PeakJobMemoryUsed;
}
"@
$job = [SurfJob]::CreateJobObject([IntPtr]::Zero, $null)
$info = New-Object SurfExtendedLimit
$info.BasicLimitInformation.LimitFlags = 0x2000
$ptr = [Runtime.InteropServices.Marshal]::AllocHGlobal([Runtime.InteropServices.Marshal]::SizeOf($info))
try {
  [Runtime.InteropServices.Marshal]::StructureToPtr($info, $ptr, $false)
  [void][SurfJob]::SetInformationJobObject($job, 9, $ptr, [uint32][Runtime.InteropServices.Marshal]::SizeOf($info))
} finally {
  [Runtime.InteropServices.Marshal]::FreeHGlobal($ptr)
}
function Quote-Arg([string]$s) {
  if ($s -notmatch '[\\s"]') { return $s }
  return '"' + ($s -replace '"', '\\"') + '"'
}
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = [string]$argv[0]
$rest = @()
if ($argv.Count -gt 1) { $rest = $argv[1..($argv.Count - 1)] }
$psi.Arguments = ($rest | ForEach-Object { Quote-Arg ([string]$_) }) -join ' '
$psi.WorkingDirectory = (Get-Location).Path
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$proc = New-Object System.Diagnostics.Process
$proc.StartInfo = $psi
$proc.add_OutputDataReceived({ if ($_.Data) { [Console]::Out.WriteLine($_.Data) } })
$proc.add_ErrorDataReceived({ if ($_.Data) { [Console]::Error.WriteLine($_.Data) } })
[void]$proc.Start()
[void][SurfJob]::AssignProcessToJobObject($job, $proc.Handle)
$proc.BeginOutputReadLine()
$proc.BeginErrorReadLine()
$proc.WaitForExit()
$code = $proc.ExitCode
[void][SurfJob]::CloseHandle($job)
exit $code
`
