$src = @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class CwdDebug
{
    [StructLayout(LayoutKind.Sequential)]
    public struct PROCESS_BASIC_INFORMATION
    {
        public IntPtr Reserved1;
        public IntPtr PebBaseAddress;
        public IntPtr Reserved2_0;
        public IntPtr Reserved2_1;
        public IntPtr UniqueProcessId;
        public IntPtr Reserved3;
    }

    [DllImport("ntdll.dll")]
    private static extern int NtQueryInformationProcess(IntPtr processHandle, int processInformationClass, ref PROCESS_BASIC_INFORMATION processInformation, int processInformationLength, out int returnLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(int access, bool inheritHandle, int processId);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool ReadProcessMemory(IntPtr process, IntPtr baseAddress, byte[] buffer, int size, out IntPtr bytesRead);

    public static string Describe(int pid)
    {
        IntPtr process = OpenProcess(0x0400 | 0x0010, false, pid);
        if (process == IntPtr.Zero) return "OPEN_FAILED win32=" + Marshal.GetLastWin32Error();
        try
        {
            PROCESS_BASIC_INFORMATION info = new PROCESS_BASIC_INFORMATION();
            int returnLength;
            int status = NtQueryInformationProcess(process, 0, ref info, Marshal.SizeOf(info), out returnLength);
            if (status != 0) return "NTQIP_status=" + status;
            if (info.PebBaseAddress == IntPtr.Zero) return "PEB_NULL";
            byte[] ptr = new byte[8];
            IntPtr read;
            if (!ReadProcessMemory(process, new IntPtr(info.PebBaseAddress.ToInt64() + 0x20), ptr, 8, out read) || read.ToInt64() != 8)
                return "READ_PARAMS_FAILED win32=" + Marshal.GetLastWin32Error();
            long parameters = BitConverter.ToInt64(ptr, 0);
            if (parameters == 0) return "PARAMS_NULL";
            byte[] header = new byte[16];
            if (!ReadProcessMemory(process, new IntPtr(parameters + 0x38), header, 16, out read) || read.ToInt64() != 16)
                return "READ_CURDIR_FAILED win32=" + Marshal.GetLastWin32Error();
            int length = BitConverter.ToUInt16(header, 0);
            long bufferAddress = BitConverter.ToInt64(header, 8);
            if (length <= 0 || bufferAddress == 0) return "CWD_EMPTY len=" + length;
            byte[] data = new byte[length];
            if (!ReadProcessMemory(process, new IntPtr(bufferAddress), data, length, out read) || read.ToInt64() != length)
                return "READ_PATH_FAILED win32=" + Marshal.GetLastWin32Error();
            return Encoding.Unicode.GetString(data);
        }
        finally
        {
            CloseHandle(process);
        }
    }
}
'@

Add-Type -TypeDefinition $src

foreach ($id in ($args -split ',')) {
  $trimmed = $id.Trim()
  if ($trimmed) { Write-Output ("{0}`t{1}" -f $trimmed, [CwdDebug]::Describe([int]$trimmed)) }
}
