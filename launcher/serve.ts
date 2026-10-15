// The local web server: hands the built game (dist/) to the Edge window, and tells the
// launcher when game windows open and close. It listens on 127.0.0.1 only, so nothing
// outside this computer can reach it and Windows' firewall never asks about it.
import { readFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { join, normalize, sep } from 'node:path';

/** Looks up one built file by its path under dist/ (`index.html`, `assets/x.js`). */
export type Files = (path: string) => Buffer | undefined;

/** Built files read from a folder on disk: dist/ when the launcher runs from source. */
export function filesFromDir(dir: string): Files {
  return (path) => {
    const full = normalize(join(dir, path));
    if (!full.startsWith(normalize(dir) + sep)) return undefined;
    try {
      return readFileSync(full);
    } catch {
      return undefined;
    }
  };
}

/** Says which game windows are open; see lifetime.ts. */
export interface PageWatcher {
  pageOpened(): void;
  pageClosed(): void;
}

/** What `/__launcher/hello` answers, so a second copy of the program can find the first. */
export interface Hello {
  app: 'arena-edh';
  data: string;
}

const TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  eot: 'application/vnd.ms-fontobject',
  txt: 'text/plain; charset=utf-8',
};

// Each game window holds this connection open while it's loaded. The launcher counts them,
// so it knows when the last window has closed. EventSource reconnects on its own after a
// reload. Added to index.html as it's served, so the game's own code doesn't need to know.
const ALIVE = `<script>new EventSource('/__launcher/alive')</script>`;

export interface ServeOptions {
  files: Files;
  pages: PageWatcher;
  hello: Hello;
}

export function makeServer({ files, pages, hello }: ServeOptions): Server {
  return createServer((req, res) => {
    // Only pages from this server, by its own address. This stops a web page elsewhere
    // from reaching it through a hostname that points at 127.0.0.1 (DNS rebinding).
    const port = (req.socket.address() as { port: number }).port;
    if (req.headers.host !== `127.0.0.1:${port}` && req.headers.host !== `localhost:${port}`) {
      return send(res, 403, 'text/plain', 'Forbidden');
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'text/plain', 'Method not allowed');

    const path = decodePath(req);
    if (path === undefined) return send(res, 400, 'text/plain', 'Bad request');
    if (path === '__launcher/hello') return send(res, 200, TYPES.json, JSON.stringify(hello));
    if (path === '__launcher/alive') return alive(req, res, pages);

    const file = path === '' ? 'index.html' : path;
    let body = files(file);
    if (!body) return send(res, 404, 'text/plain', 'Not found');
    if (file === 'index.html') body = Buffer.from(body.toString('utf8').replace('</head>', `${ALIVE}</head>`));
    const type = TYPES[file.slice(file.lastIndexOf('.') + 1)] ?? 'application/octet-stream';
    // Vite names built assets by their content, so they never change; index.html can.
    res.setHeader('Cache-Control', file.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
    send(res, 200, type, req.method === 'HEAD' ? undefined : body, body.length);
  });
}

/** The request's path without its leading slash or query, or undefined if it's malformed or climbs out with `..`. */
function decodePath(req: IncomingMessage): string | undefined {
  try {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname).slice(1);
    if (path.split('/').some((part) => part === '..' || part.includes('\\') || part.includes('\0'))) return undefined;
    return path;
  } catch {
    return undefined;
  }
}

function alive(req: IncomingMessage, res: ServerResponse, pages: PageWatcher) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write(': open\n\n');
  pages.pageOpened();
  // A comment now and then keeps the connection from looking idle.
  const ping = setInterval(() => res.write(': ping\n\n'), 30_000);
  req.on('close', () => {
    clearInterval(ping);
    pages.pageClosed();
  });
}

function send(res: ServerResponse, status: number, type: string, body?: string | Buffer, length?: number) {
  res.statusCode = status;
  res.setHeader('Content-Type', type);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (length !== undefined) res.setHeader('Content-Length', length);
  res.end(body);
}

/** Starts listening on 127.0.0.1:port. False if something else already holds the port. */
export function listen(server: Server, port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.off('listening', onListening);
      if (err.code === 'EADDRINUSE' || err.code === 'EACCES') resolve(false);
      else reject(err);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve(true);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

/** Asks whatever holds 127.0.0.1:port whether it's this program, and which data folder it uses. */
export function probe(port: number): Promise<Hello | undefined> {
  return new Promise((resolve) => {
    const req = request({ host: '127.0.0.1', port, path: '/__launcher/hello', timeout: 2000 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          const hello = JSON.parse(body) as Hello;
          resolve(hello.app === 'arena-edh' ? hello : undefined);
        } catch {
          resolve(undefined);
        }
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(undefined));
    req.end();
  });
}
