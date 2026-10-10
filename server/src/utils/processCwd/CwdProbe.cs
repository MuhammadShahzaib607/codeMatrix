using System;
using System.Runtime.InteropServices;
using System.Text;

public static class CwdProbe
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
    private static extern int NtQueryInformationProcess(
        IntPtr processHandle,
        int processInformationClass,
        ref PROCESS_BASIC_INFORMATION processInformation,
        int processInformationLength,
        out int returnLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(int access, bool inheritHandle, int processId);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool ReadProcessMemory(
        IntPtr process,
        IntPtr baseAddress,
        byte[] buffer,
        int size,
        out IntPtr bytesRead);

    private const int PROCESS_QUERY_INFORMATION = 0x0400;
    private const int PROCESS_VM_READ = 0x0010;

    private static bool ReadRemote(IntPtr process, IntPtr address, byte[] buffer)
    {
        IntPtr read;
        return ReadProcessMemory(process, address, buffer, buffer.Length, out read)
            && read.ToInt64() == buffer.Length;
    }

    private static long ReadPointer(IntPtr process, IntPtr address)
    {
        byte[] buffer = new byte[8];
        if (!ReadRemote(process, address, buffer)) return 0;
        return BitConverter.ToInt64(buffer, 0);
    }

    private static string ReadUnicodeString(IntPtr process, IntPtr unicodeStringAddress)
    {
        byte[] header = new byte[16];
        if (!ReadRemote(process, unicodeStringAddress, header)) return null;
        int length = BitConverter.ToUInt16(header, 0);
        long bufferAddress = BitConverter.ToInt64(header, 8);
        if (length <= 0 || bufferAddress == 0) return null;
        byte[] data = new byte[length];
        if (!ReadRemote(process, new IntPtr(bufferAddress), data)) return null;
        return Encoding.Unicode.GetString(data);
    }

    public static string GetCwd(int pid)
    {
        IntPtr process = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, false, pid);
        if (process == IntPtr.Zero) return null;
        try
        {
            PROCESS_BASIC_INFORMATION info = new PROCESS_BASIC_INFORMATION();
            int returnLength;
            int status = NtQueryInformationProcess(process, 0, ref info, Marshal.SizeOf(info), out returnLength);
            if (status != 0 || info.PebBaseAddress == IntPtr.Zero) return null;

            long parameters = ReadPointer(process, new IntPtr(info.PebBaseAddress.ToInt64() + 0x20));
            if (parameters == 0) return null;

            return ReadUnicodeString(process, new IntPtr(parameters + 0x38));
        }
        catch
        {
            return null;
        }
        finally
        {
            CloseHandle(process);
        }
    }
}
