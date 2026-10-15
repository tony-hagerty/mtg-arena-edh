// The Arena EDH program: double-click ArenaEDH.exe and the game opens in its own window.
// It serves the built game on 127.0.0.1 and opens it in an Edge app window whose profile is
// in the folder beside the .exe. Closing the window quits the program. Phase 3 adds the game
// server to this same program.
//
// Flags, for development: `--no-window` only serves the game and prints its address,
// `--browser <path>` opens the window in that Chromium-based browser instead of Edge, and
// `--dist <folder>` serves that folder instead of dist/ when run from source.
import { appendFileSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { resolve } from 'node:path';
import { getAsset, isSea } from 'node:sea';
import { findEdge, openDefaultBrowser, openEdge, showError } from './edge';
import { createLifetime } from './lifetime';
import type { Lifetime } from './lifetime';
import { pathsFor } from './paths';
import { filesFromDir, listen, makeServer, probe } from './serve';
import type { Files } from './serve';

/**
 * The game's storage belongs to its address, port included, so the program always tries
 * this port first: on another port, saved decks and settings would seem to be gone.
 */
const PORT = 47180;
/** Ports to try after PORT, if another program holds it. */
const TRIES = 10;

const sea = isSea();
const args = process.argv.slice(sea ? 1 : 2).filter((a) => a !== process.execPath);
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const paths = pathsFor(sea ? process.execPath : resolve(process.argv[1] ?? '.'));
let logReady = false;

function log(line: string) {
  if (!sea) console.log(line);
  if (logReady) {
    try {
      appendFileSync(paths.log, `${new Date().toISOString()} ${line}\n`);
    } catch {
      // A full or read-only disk shouldn't stop the game.
    }
  }
}

function fail(message: string, err?: unknown): never {
  log(`${message}${err ? ` ${err instanceof Error ? (err.stack ?? err.message) : String(err)}` : ''}`);
  showError(message);
  process.exit(1);
}

/** The built game, from inside the .exe (the build script embeds dist/), or from disk. */
function builtFiles(): Files {
  if (!sea) return filesFromDir(resolve(option('--dist') ?? 'dist'));
  const list = new Set<string>(JSON.parse(getAsset('files.json', 'utf8')));
  return (path) => (list.has(path) ? Buffer.from(getAsset(path)) : undefined);
}

const samePath = (a: string, b: string) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);

/** Opens a game window at url: in Edge with the program's profile, else the default browser. */
function openWindow(url: string, lifetime?: Lifetime) {
  const edge = option('--browser') ?? findEdge();
  if (!edge) {
    log('Microsoft Edge not found; opening the default browser. Its storage is not in the program folder.');
    openDefaultBrowser(url);
    return lifetime?.browserExited();
  }
  log(`Opening ${url} in ${edge}`);
  const child = openEdge(edge, url, paths.edge);
  child.on('error', (err) => {
    log(`Edge failed to start (${err.message}); opening the default browser.`);
    openDefaultBrowser(url);
    lifetime?.browserExited();
  });
  child.on('exit', (code) => {
    log(`Edge exited (${code})`);
    lifetime?.browserExited();
  });
  if (!lifetime) child.unref();
}

async function main() {
  try {
    mkdirSync(paths.edge, { recursive: true });
    // Kept across runs (a second copy started from this folder writes to it too), but small.
    if ((statSync(paths.log, { throwIfNoEntry: false })?.size ?? 0) > 1_000_000) writeFileSync(paths.log, '');
    logReady = true;
  } catch (err) {
    fail(`Arena EDH can't write its data folder:\n${paths.data}\n\nMove ArenaEDH.exe to a folder you can write to, such as Documents or a USB stick.`, err);
  }
  log(`Arena EDH launcher, data in ${paths.data}`);

  const files = builtFiles();
  if (!files('index.html')) fail(sea ? 'This copy of Arena EDH is damaged: the game files are missing.' : 'No dist/index.html: run `npm run build` first.');

  let server: Server | undefined;
  const lifetime = createLifetime({
    quit() {
      log('Game window closed; quitting.');
      server?.close();
      process.exit(0);
    },
  });

  let open = 0;
  const pages = {
    pageOpened() {
      log(`Game page opened (${++open} open)`);
      lifetime.pageOpened();
    },
    pageClosed() {
      log(`Game page closed (${--open} open)`);
      lifetime.pageClosed();
    },
  };

  for (let port = PORT; port < PORT + TRIES; port++) {
    const candidate = makeServer({ files, pages, hello: { app: 'arena-edh', data: paths.data } });
    if (await listen(candidate, port)) {
      server = candidate;
      const url = `http://127.0.0.1:${port}/`;
      log(`Serving the game at ${url}`);
      if (port !== PORT) log(`Port ${PORT} was taken, so decks and settings saved on it don't show on this port.`);
      if (flag('--no-window')) return;
      return openWindow(url, lifetime);
    }
    // Already running from this folder (the .exe double-clicked twice): open another
    // window on that one and leave it in charge.
    const other = await probe(port);
    if (other && samePath(other.data, paths.data)) {
      log(`Already running on port ${port}; opening another window.`);
      if (!flag('--no-window')) openWindow(`http://127.0.0.1:${port}/`);
      return setTimeout(() => process.exit(0), 1000);
    }
  }
  fail(`Arena EDH couldn't find a free port between ${PORT} and ${PORT + TRIES - 1}.`);
}

const crashed = (err: unknown) => fail('Arena EDH stopped because of an error. The details are in ArenaEDH-data\\launcher.log.', err);
process.on('uncaughtException', crashed);
main().catch(crashed);
