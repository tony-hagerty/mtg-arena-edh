// Gives the game window the program's own icon, sharp in the taskbar.
//
// The game window is an Edge app window (edge.ts), and Edge gives such a window the page's
// icon at 16 pixels, whatever sizes the page offers, so Windows scales it up for the taskbar
// and it blurs. The program carries its icon at every size up to 256 pixels
// (scripts/build-exe.mjs), so once the window is open a hidden PowerShell sets that, at the
// window's display scale, as its title bar's and taskbar's icons, and gives the window the
// program's own taskbar identity (its own button, with the program's icon, that pins the
// program), and keeps them there while the window is open (Edge sets its own again now and
// then). What it does goes in the launcher's log.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

/** The window's taskbar identity (its AppUserModelID): the program's, not Edge's. */
export const APP_ID = 'ArenaEDH.Game';

/** The Win32 calls, compiled by PowerShell (Add-Type, Windows PowerShell 5's C# 5, mscorlib alone): find the windows of some processes, and set their icons and taskbar identity from an .exe. */
const NATIVE = String.raw`
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class ArenaIcon {
  delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hwnd, uint cmd);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongW")] static extern int GetWindowLong(IntPtr hwnd, int index);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr hwnd);
  [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  static extern uint PrivateExtractIcons(string file, int index, int cx, int cy, IntPtr[] icons, uint[] ids, uint count, uint flags);
  [DllImport("shell32.dll")] static extern int SHGetPropertyStoreForWindow(IntPtr hwnd, ref Guid iid, out IPropertyStore store);
  [DllImport("ole32.dll")] static extern int PropVariantClear(ref PropVariant value);

  [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IPropertyStore {
    [PreserveSig] int GetCount(out uint count);
    [PreserveSig] int GetAt(uint index, out PropertyKey key);
    [PreserveSig] int GetValue(ref PropertyKey key, out PropVariant value);
    [PreserveSig] int SetValue(ref PropertyKey key, ref PropVariant value);
    [PreserveSig] int Commit();
  }
  public struct PropertyKey { public Guid fmtid; public uint pid; }
  // A PROPVARIANT holding a string (VT_LPWSTR), as large as Windows' own on 64-bit.
  [StructLayout(LayoutKind.Explicit)]
  public struct PropVariant { [FieldOffset(0)] public ushort vt; [FieldOffset(8)] public IntPtr p; [FieldOffset(16)] public IntPtr p2; }

  const uint WM_GETICON = 0x7F, WM_SETICON = 0x80, GW_OWNER = 4;
  const int GWL_EXSTYLE = -20, WS_EX_TOOLWINDOW = 0x80;
  const ushort VT_LPWSTR = 31;
  // System.AppUserModel's properties: 2 RelaunchCommand, 3 RelaunchIconResource, 4 RelaunchDisplayNameResource, 5 ID.
  static readonly Guid AppUserModel = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3");
  static readonly Dictionary<int, IntPtr> icons = new Dictionary<int, IntPtr>();
  static readonly Dictionary<IntPtr, int> times = new Dictionary<IntPtr, int>();

  static void Say(string line) { Console.WriteLine(line); }

  // The program's icon at size pixels, drawn from its own sizes; kept for the next time.
  static IntPtr Icon(string exe, int size) {
    IntPtr icon;
    if (icons.TryGetValue(size, out icon)) return icon;
    var found = new IntPtr[1];
    var ids = new uint[1];
    PrivateExtractIcons(exe, 0, size, size, found, ids, 1, 0);
    if (found[0] == IntPtr.Zero) Say("Couldn't read the program's icon at " + size + " px from " + exe);
    icons[size] = found[0];
    return found[0];
  }

  static string Get(IPropertyStore store, uint pid) {
    var key = new PropertyKey { fmtid = AppUserModel, pid = pid };
    PropVariant value;
    if (store.GetValue(ref key, out value) != 0) return null;
    string text = value.vt == VT_LPWSTR ? Marshal.PtrToStringUni(value.p) : null;
    PropVariantClear(ref value);
    return text;
  }

  static void Set(IPropertyStore store, uint pid, string text) {
    var key = new PropertyKey { fmtid = AppUserModel, pid = pid };
    var value = new PropVariant { vt = VT_LPWSTR, p = Marshal.StringToCoTaskMemUni(text) };
    try {
      int hr = store.SetValue(ref key, ref value);
      if (hr != 0) Say("Setting the window's taskbar property " + pid + " failed (0x" + hr.ToString("X8") + ")");
    } finally {
      Marshal.FreeCoTaskMem(value.p);
    }
  }

  // Gives the window the program's taskbar identity, if it hasn't it: the taskbar then shows
  // it on a button of its own with the program's icon, and pinning it pins the program.
  // Returns the identity it had, or null if it already had the program's.
  static string Identify(IntPtr hwnd, string exe, string id) {
    IPropertyStore store;
    var iid = typeof(IPropertyStore).GUID;
    int hr = SHGetPropertyStoreForWindow(hwnd, ref iid, out store);
    if (hr != 0 || store == null) { Say("Couldn't open the window's taskbar properties (0x" + hr.ToString("X8") + ")"); return null; }
    try {
      string was = Get(store, 5);
      if (was == id) return null;
      // The relaunch details first: the taskbar reads them when the identity changes.
      Set(store, 2, "\"" + exe + "\"");
      Set(store, 3, exe + ",0");
      Set(store, 4, "Arena EDH");
      Set(store, 5, id);
      return was ?? "none";
    } finally {
      Marshal.ReleaseComObject(store);
    }
  }

  static void Fix(IntPtr hwnd, string exe, string id) {
    uint dpi = 96;
    try { dpi = GetDpiForWindow(hwnd); } catch (EntryPointNotFoundException) { }
    if (dpi == 0) dpi = 96;
    // The big icon is the taskbar's and Alt+Tab's, the small one the title bar's.
    int bigSize = (int)(32 * dpi / 96), smallSize = (int)(16 * dpi / 96);
    IntPtr big = Icon(exe, bigSize), small = Icon(exe, smallSize);
    var done = new List<string>();
    if (big != IntPtr.Zero && SendMessage(hwnd, WM_GETICON, (IntPtr)1, IntPtr.Zero) != big) {
      SendMessage(hwnd, WM_SETICON, (IntPtr)1, big);
      done.Add("taskbar icon (" + bigSize + " px)");
    }
    if (small != IntPtr.Zero && SendMessage(hwnd, WM_GETICON, IntPtr.Zero, IntPtr.Zero) != small) {
      SendMessage(hwnd, WM_SETICON, IntPtr.Zero, small);
      done.Add("title bar icon (" + smallSize + " px)");
    }
    string was = Identify(hwnd, exe, id);
    if (was != null) done.Add("taskbar identity (was " + was + ")");
    if (done.Count == 0) return;
    int n;
    times.TryGetValue(hwnd, out n);
    times[hwnd] = n + 1;
    // Edge puts its own back now and then: said the first few times, not every few seconds.
    if (n < 5) Say("Window " + hwnd.ToString("X") + (n == 0 ? "" : " again") + ": set its " + string.Join(", ", done) + (n == 4 ? "; no more about this window" : ""));
  }

  // Sets the icons and identity of the windows of the processes pids that have a taskbar
  // button (shown, owned by no other window, not a tool window). Returns how many there are.
  public static int Apply(string exe, string id, uint[] pids) {
    int count = 0;
    EnumWindows((hwnd, _) => {
      uint pid;
      GetWindowThreadProcessId(hwnd, out pid);
      if (Array.IndexOf(pids, pid) < 0 || !IsWindowVisible(hwnd)) return true;
      if (GetWindow(hwnd, GW_OWNER) != IntPtr.Zero || (GetWindowLong(hwnd, GWL_EXSTYLE) & WS_EX_TOOLWINDOW) != 0) return true;
      count++;
      try { Fix(hwnd, exe, id); } catch (Exception e) { Say("Window " + hwnd.ToString("X") + ": " + e.Message); }
      return true;
    }, IntPtr.Zero);
    return count;
  }
}
`;

/** A string as a PowerShell literal. */
const literal = (s: string) => `'${s.replace(/'/g, "''")}'`;

/**
 * The PowerShell that does it: waits up to a minute for a window of a `browser` (its .exe's
 * file name) process running with `profile` (the game's own, edge.ts), then keeps the icon
 * and identity from `exe` on its windows every few seconds until they have all closed. It
 * writes what it does, one line at a time.
 */
export function iconScript(browser: string, profile: string, exe: string): string {
  return [
    `$ErrorActionPreference = 'Stop'`,
    `trap { [Console]::WriteLine("Stopped: $_"); exit 1 }`,
    `Add-Type -TypeDefinition @'\n${NATIVE}\n'@`,
    `$exe = ${literal(exe)}`,
    `$id = ${literal(APP_ID)}`,
    `$filter = ${literal(`Name='${browser.replace(/'/g, "''")}'`)}`,
    `$dataDir = ${literal(`--user-data-dir=${profile}`)}`,
    // The browser's processes using the game's profile: its windows are the game's.
    `function Pids { @(Get-CimInstance Win32_Process -Filter $filter | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($dataDir) } | ForEach-Object { [uint32]$_.ProcessId }) }`,
    `$deadline = (Get-Date).AddMinutes(1)`,
    `$seen = $false`,
    `while ($true) {`,
    `  $pids = Pids`,
    `  $n = if ($pids.Count) { [ArenaIcon]::Apply($exe, $id, [uint32[]]$pids) } else { 0 }`,
    `  if ($n -gt 0) { $seen = $true } elseif ($seen -or (Get-Date) -gt $deadline) { break }`,
    // Quickly while the window comes up and its page loads, then now and then.
    `  Start-Sleep -Milliseconds $(if ($seen) { 3000 } else { 500 })`,
    `}`,
    `[Console]::WriteLine($(if ($seen) { 'The window has closed.' } else { "No game window within a minute ($($pids.Count) Edge processes with the game's profile)." }))`,
  ].join('\n');
}

/**
 * Starts the PowerShell (`iconScript`) hidden; it ends when the window does, and its lines
 * go in the log. Windows only. With `outlive` (this copy of the program is about to exit,
 * main.ts) it runs on its own, outside the job that ends this copy's children, unlogged.
 */
export function keepWindowIcon(browser: string, profile: string, exe: string, log: (line: string) => void, outlive = false): void {
  if (process.platform !== 'win32') return;
  // As UTF-16 Base64, so nothing in the paths needs quoting on the command line.
  const encoded = Buffer.from(iconScript(browser, profile, exe), 'utf16le').toString('base64');
  try {
    const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded], {
      stdio: outlive ? 'ignore' : ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: outlive,
    });
    for (const out of [child.stdout, child.stderr]) {
      if (out) createInterface({ input: out }).on('line', (line) => line.trim() && log(`Window icon: ${line.trim()}`));
    }
    child.on('error', (err) => log(`Couldn't set the window's icon (${err.message})`));
    if (outlive) child.unref();
  } catch (err) {
    log(`Couldn't set the window's icon (${(err as Error).message})`);
  }
}
