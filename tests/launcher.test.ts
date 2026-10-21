// The portable Windows program's launcher (launcher/): its local web server, and when it quits.
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { edgeArgs, edgeSpawnOptions, windowUrl } from '../launcher/edge';
import { APP_ID, iconScript } from '../launcher/icon';
import { createLifetime } from '../launcher/lifetime';
import { pathsFor } from '../launcher/paths';
import { filesFromDir, listen, makeServer, probe } from '../launcher/serve';

describe('lifetime', () => {
  afterEach(() => vi.useRealTimers());

  function setup() {
    vi.useFakeTimers();
    const quit = vi.fn();
    return { quit, life: createLifetime({ quit, graceMs: 3000, startupMs: 30000 }) };
  }

  it('quits once Edge exits and its window has closed', () => {
    const { quit, life } = setup();
    life.pageOpened();
    life.pageClosed();
    life.browserExited();
    vi.advanceTimersByTime(2999);
    expect(quit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(quit).toHaveBeenCalledOnce();
  });

  it('never quits on closed pages while its Edge runs', () => {
    const { quit, life } = setup();
    life.pageOpened();
    life.pageClosed();
    vi.advanceTimersByTime(600_000);
    expect(quit).not.toHaveBeenCalled();
  });

  it('keeps running through a reload after Edge handed the window off', () => {
    const { quit, life } = setup();
    life.browserExited();
    life.pageOpened();
    life.pageClosed();
    vi.advanceTimersByTime(1000);
    life.pageOpened();
    vi.advanceTimersByTime(600_000);
    expect(quit).not.toHaveBeenCalled();
    life.pageClosed();
    vi.advanceTimersByTime(3000);
    expect(quit).toHaveBeenCalledOnce();
  });

  it('waits longer for a first page after a hand-off', () => {
    const { quit, life } = setup();
    life.browserExited();
    vi.advanceTimersByTime(29_999);
    expect(quit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(quit).toHaveBeenCalledOnce();
  });

  it('waits for a window another copy announced, instead of quitting under it', () => {
    const { quit, life } = setup();
    life.pageOpened();
    life.pageClosed();
    life.browserExited();
    vi.advanceTimersByTime(2000);
    life.pageExpected();
    vi.advanceTimersByTime(29_999);
    expect(quit).not.toHaveBeenCalled();
    life.pageOpened();
    vi.advanceTimersByTime(600_000);
    expect(quit).not.toHaveBeenCalled();
    life.pageClosed();
    vi.advanceTimersByTime(3000);
    expect(quit).toHaveBeenCalledOnce();
  });

  it('quits if the announced window never comes', () => {
    const { quit, life } = setup();
    life.browserExited();
    life.pageExpected();
    vi.advanceTimersByTime(30_000);
    expect(quit).toHaveBeenCalledOnce();
  });

  it('counts each open window', () => {
    const { quit, life } = setup();
    life.browserExited();
    life.pageOpened();
    life.pageOpened();
    life.pageClosed();
    vi.advanceTimersByTime(60_000);
    expect(quit).not.toHaveBeenCalled();
  });
});

describe('paths', () => {
  it('keeps everything in a folder beside the program', () => {
    const p = pathsFor(join('/games', 'arena', 'ArenaEDH.exe'));
    expect(p.data).toBe(join('/games', 'arena', 'ArenaEDH-data'));
    expect(p.edge).toBe(join(p.data, 'edge'));
    expect(p.log).toBe(join(p.data, 'launcher.log'));
  });

  it('gives Edge its own profile and an app window', () => {
    const args = edgeArgs('http://127.0.0.1:47180/', 'D:\\ArenaEDH-data\\edge');
    expect(args).toContain('--app=http://127.0.0.1:47180/');
    expect(args).toContain('--user-data-dir=D:\\ArenaEDH-data\\edge');
  });

  it('opens the CSS table with --table css, and the plain address (the 3D table) otherwise', () => {
    expect(windowUrl('http://127.0.0.1:47180/')).toBe('http://127.0.0.1:47180/');
    expect(windowUrl('http://127.0.0.1:47180/', 'css')).toBe('http://127.0.0.1:47180/?table=css');
    expect(windowUrl('http://127.0.0.1:47180/', 'a b')).toBe('http://127.0.0.1:47180/?table=a%20b');
  });

  it("sets the game window's icon from the program, finding the window by the game's profile", () => {
    const script = iconScript('msedge.exe', "D:\\Bob's games\\ArenaEDH-data\\edge", "D:\\Bob's games\\ArenaEDH.exe");
    // Quotes in a path are doubled in PowerShell's single-quoted strings.
    expect(script).toContain("$exe = 'D:\\Bob''s games\\ArenaEDH.exe'");
    expect(script).toContain("$dataDir = '--user-data-dir=D:\\Bob''s games\\ArenaEDH-data\\edge'");
    expect(script).toContain(`$filter = 'Name=''msedge.exe'''`);
    // $profile is PowerShell's own: never assigned.
    expect(script).not.toMatch(/\$profile\s*=/);
    expect(script).toContain('[ArenaIcon]::Apply($exe, $id');
    expect(script).toContain(`$id = '${APP_ID}'`);
    // What it does is written out, for the launcher's log: failures included.
    expect(script).toMatch(/^trap \{ \[Console\]::WriteLine/m);
  });

  // Node on Windows ends a child with its parent unless it is detached (libuv's job object):
  // a copy that opens a window on a running program and exits must not take Edge with it.
  it('starts Edge detached only when the program is about to exit', () => {
    expect(edgeSpawnOptions(false).detached).toBe(false);
    expect(edgeSpawnOptions(true).detached).toBe(true);
  });
});

describe('server', () => {
  const dir = mkdtempSync(join(tmpdir(), 'arena-launcher-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<html><head><title>x</title></head><body></body></html>');
  writeFileSync(join(dir, 'assets', 'index-abc.js'), 'console.log(1)');
  writeFileSync(join(dir, '..', 'arena-launcher-secret.txt'), 'secret');

  let server: Server | undefined;
  afterEach(() => {
    server?.closeAllConnections();
    server?.close();
    server = undefined;
  });

  async function start(pages: { pageOpened: Mock; pageClosed: Mock; pageExpected?: Mock } = { pageOpened: vi.fn(), pageClosed: vi.fn() }) {
    server = makeServer({ files: filesFromDir(dir), pages, hello: { app: 'arena-edh', data: 'D:\\data' } });
    expect(await listen(server, 0)).toBe(true);
    const port = (server.address() as { port: number }).port;
    return { port, pages };
  }

  function get(port: number, path: string, host = `127.0.0.1:${port}`) {
    return new Promise<{ status: number; type: string; cache: string; body: string }>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path, headers: { host } }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () =>
          resolve({ status: res.statusCode!, type: String(res.headers['content-type']), cache: String(res.headers['cache-control']), body }),
        );
      });
      req.on('error', reject);
      req.end();
    });
  }

  it('serves the game, with the window watcher added to index.html', async () => {
    const { port } = await start();
    const page = await get(port, '/');
    expect(page.status).toBe(200);
    expect(page.type).toContain('text/html');
    expect(page.cache).toBe('no-cache');
    expect(page.body).toContain(`<script>new EventSource('/__launcher/alive')</script></head>`);
    const js = await get(port, '/assets/index-abc.js?v=1');
    expect(js).toMatchObject({ status: 200, body: 'console.log(1)', cache: 'public, max-age=31536000, immutable' });
    expect(js.type).toContain('text/javascript');
  });

  it("refuses other hosts, missing files and paths outside dist", async () => {
    const { port } = await start();
    expect((await get(port, '/', 'evil.example:80')).status).toBe(403);
    expect((await get(port, '/', `localhost:${port}`)).status).toBe(200);
    expect((await get(port, '/nope.js')).status).toBe(404);
    expect((await get(port, '/../arena-launcher-secret.txt')).status).toBe(404);
    expect((await get(port, '/assets/..%2F..%2Farena-launcher-secret.txt')).status).toBe(400);
    expect((await get(port, '/%2e%2e/arena-launcher-secret.txt')).body).not.toContain('secret');
  });

  it('answers a second copy of the program', async () => {
    const { port } = await start();
    expect(await probe(port)).toEqual({ app: 'arena-edh', data: 'D:\\data' });
  });

  it('is told when a second copy is about to open a window on it', async () => {
    const { port, pages } = await start({ pageOpened: vi.fn(), pageClosed: vi.fn(), pageExpected: vi.fn() });
    expect(await probe(port)).toEqual({ app: 'arena-edh', data: 'D:\\data' });
    expect(pages.pageExpected).not.toHaveBeenCalled();
    expect(await probe(port, true)).toEqual({ app: 'arena-edh', data: 'D:\\data' });
    expect(pages.pageExpected).toHaveBeenCalledOnce();
  });

  it('counts game windows by their open connection', async () => {
    const { port, pages } = await start();
    const req = request({ host: '127.0.0.1', port, path: '/__launcher/alive' });
    const res = await new Promise<import('node:http').IncomingMessage>((resolve) => req.on('response', resolve).end());
    expect(res.headers['content-type']).toBe('text/event-stream');
    expect(pages.pageOpened).toHaveBeenCalledOnce();
    res.destroy();
    await vi.waitFor(() => expect(pages.pageClosed).toHaveBeenCalledOnce());
  });

  it('reports a port that is taken', async () => {
    const { port } = await start();
    const other = makeServer({ files: filesFromDir(dir), pages: { pageOpened() {}, pageClosed() {} }, hello: { app: 'arena-edh', data: '' } });
    expect(await listen(other, port)).toBe(false);
  });
});
