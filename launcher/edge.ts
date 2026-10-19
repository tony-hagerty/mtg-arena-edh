// Opens the game in a Microsoft Edge app window: a plain window with the normal title bar
// and no tabs or address bar. Every Windows 10 and 11 PC has Edge, so nothing is installed.
import { execFileSync, spawn } from 'node:child_process';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Where msedge.exe is, or undefined if this PC doesn't seem to have it. */
export function findEdge(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const roots = [env['ProgramFiles(x86)'], env.ProgramFiles, env.LOCALAPPDATA].filter((r): r is string => !!r);
  for (const root of roots) {
    const exe = join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe');
    if (existsSync(exe)) return exe;
  }
  // Edge registers its own path here, wherever it was put.
  for (const hive of ['HKLM', 'HKCU']) {
    try {
      const out = execFileSync('reg', ['query', `${hive}\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\msedge.exe`, '/ve'], {
        encoding: 'utf8',
        windowsHide: true,
      });
      const exe = /REG_SZ\s+(.+)/.exec(out)?.[1]?.trim();
      if (exe && existsSync(exe)) return exe;
    } catch {
      // Not registered in this hive.
    }
  }
  return undefined;
}

/** Edge's command line for the game window. */
export function edgeArgs(url: string, profile: string): string[] {
  return [
    `--app=${url}`,
    // Its own profile, in the program's folder: separate from the user's everyday Edge,
    // and the game's storage (decks, settings, fetched cards) travels with the program.
    `--user-data-dir=${profile}`,
    '--start-maximized',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    '--disable-extensions',
    // Without background apps, this Edge exits when the game window closes.
    '--disable-background-mode',
  ];
}

/**
 * Opens the game window. Node on Windows puts a child it started in a job that ends with
 * the parent (libuv's `uv_spawn`), so Edge closes with the program: right while the program
 * runs, but a copy that only opens a window on a running program and exits (main.ts) would
 * take its own window down with it. `outlive` starts Edge detached, outside that job.
 */
export function openEdge(edge: string, url: string, profile: string, outlive = false): ChildProcess {
  return spawn(edge, edgeArgs(url, profile), edgeSpawnOptions(outlive));
}

export function edgeSpawnOptions(outlive: boolean): SpawnOptions {
  return { stdio: 'ignore', windowsHide: false, detached: outlive };
}

/** Last resort with no Edge: the default browser. Its storage isn't in the program's folder. */
export function openDefaultBrowser(url: string): void {
  const child = spawn('rundll32', ['url.dll,FileProtocolHandler', url], { stdio: 'ignore', detached: true });
  child.on('error', () => {});
  child.unref();
}

/** A message box, for errors the user must see: the .exe has no console window. */
export function showError(message: string): void {
  if (process.platform !== 'win32') return void console.error(message);
  const text = message.replace(/'/g, "''");
  try {
    execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Add-Type -AssemblyName System.Windows.Forms; [void][System.Windows.Forms.MessageBox]::Show('${text}', 'Arena EDH', 'OK', 'Error')`,
      ],
      { windowsHide: true },
    );
  } catch {
    // Nothing more we can do; the log has it.
  }
}
