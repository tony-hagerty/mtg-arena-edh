// Gives the game window the program's own icon, sharp in the taskbar.
//
// The game window is an Edge app window (edge.ts), and Edge gives such a window the page's
// icon at 16 pixels, whatever sizes the page offers, so Windows scales it up for the taskbar
// and it blurs. The program carries its icon at every size up to 256 pixels
// (scripts/build-exe.mjs), so once the window is open a hidden PowerShell sets that, at the
// window's display scale, as its title bar's and taskbar's icons, and keeps it there while
// the window is open (Edge sets its own again when the page's icon changes).
import { spawn } from 'node:child_process';

/** The Win32 calls, compiled by PowerShell (Add-Type, Windows PowerShell 5's C# 5, mscorlib alone): find the windows of some processes, and set their icons from an .exe. */
const NATIVE = String.raw`
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class ArenaIcon {
  delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr hwnd);
  [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  static extern uint PrivateExtractIcons(string file, int index, int cx, int cy, IntPtr[] icons, uint[] ids, uint count, uint flags);

  const uint WM_GETICON = 0x7F, WM_SETICON = 0x80;
  static readonly Dictionary<int, IntPtr> icons = new Dictionary<int, IntPtr>();

  // The program's icon at size pixels, drawn from its own sizes; kept for the next time.
  static IntPtr Icon(string exe, int size) {
    IntPtr icon;
    if (icons.TryGetValue(size, out icon)) return icon;
    var found = new IntPtr[1];
    var ids = new uint[1];
    PrivateExtractIcons(exe, 0, size, size, found, ids, 1, 0);
    icons[size] = found[0];
    return found[0];
  }

  // Sets the icons of the visible windows of the processes pids, where they aren't ours yet.
  // Returns how many such windows there are.
  public static int Apply(string exe, uint[] pids) {
    int count = 0;
    EnumWindows((hwnd, _) => {
      uint pid;
      GetWindowThreadProcessId(hwnd, out pid);
      if (Array.IndexOf(pids, pid) < 0 || !IsWindowVisible(hwnd)) return true;
      count++;
      uint dpi = 96;
      try { dpi = GetDpiForWindow(hwnd); } catch (EntryPointNotFoundException) { }
      if (dpi == 0) dpi = 96;
      // The big icon is the taskbar's and Alt+Tab's, the small one the title bar's.
      IntPtr big = Icon(exe, (int)(32 * dpi / 96)), small = Icon(exe, (int)(16 * dpi / 96));
      if (big != IntPtr.Zero && SendMessage(hwnd, WM_GETICON, (IntPtr)1, IntPtr.Zero) != big) SendMessage(hwnd, WM_SETICON, (IntPtr)1, big);
      if (small != IntPtr.Zero && SendMessage(hwnd, WM_GETICON, IntPtr.Zero, IntPtr.Zero) != small) SendMessage(hwnd, WM_SETICON, IntPtr.Zero, small);
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
 * from `exe` on its windows every few seconds until they have all closed.
 */
export function iconScript(browser: string, profile: string, exe: string): string {
  return [
    `Add-Type -TypeDefinition @'\n${NATIVE}\n'@`,
    `$exe = ${literal(exe)}`,
    `$filter = ${literal(`Name='${browser.replace(/'/g, "''")}'`)}`,
    `$dataDir = ${literal(`--user-data-dir=${profile}`)}`,
    // The browser's processes using the game's profile: its windows are the game's.
    `function Pids { @(Get-CimInstance Win32_Process -Filter $filter | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($dataDir) } | ForEach-Object { [uint32]$_.ProcessId }) }`,
    `$deadline = (Get-Date).AddMinutes(1)`,
    `$seen = $false`,
    `while ($true) {`,
    `  $pids = Pids`,
    `  $n = if ($pids.Count) { [ArenaIcon]::Apply($exe, [uint32[]]$pids) } else { 0 }`,
    `  if ($n -gt 0) { $seen = $true } elseif ($seen -or (Get-Date) -gt $deadline) { break }`,
    // Quickly while the window comes up and its page loads, then now and then.
    `  Start-Sleep -Milliseconds $(if ($seen) { 3000 } else { 500 })`,
    `}`,
  ].join('\n');
}

/** Starts the PowerShell (`iconScript`) hidden, on its own: it ends when the window does. Windows only. */
export function keepWindowIcon(browser: string, profile: string, exe: string, log: (line: string) => void): void {
  if (process.platform !== 'win32') return;
  // As UTF-16 Base64, so nothing in the paths needs quoting on the command line.
  const encoded = Buffer.from(iconScript(browser, profile, exe), 'utf16le').toString('base64');
  try {
    const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded], {
      stdio: 'ignore',
      windowsHide: true,
      detached: true,
    });
    child.on('error', (err) => log(`Couldn't set the window's icon (${err.message})`));
    child.unref();
  } catch (err) {
    log(`Couldn't set the window's icon (${(err as Error).message})`);
  }
}
