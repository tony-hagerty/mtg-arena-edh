// The game server's web endpoints (see src/net/protocol.ts). Each window streams its seat's
// view as server-sent events and POSTs its moves. The launcher's web server and the dev
// server both hand requests under /api/game/ to `handleGameApi`.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PlayerId } from '../../src/engine';
import { API } from '../../src/net/protocol';
import type { ActRequest, PrefsRequest, SpeedRequest, StartRequest } from '../../src/net/protocol';
import { Refused } from './service';
import type { GameService } from './service';

/** The most a request body may hold: a game start carries the decks and any fetched cards. */
const MAX_BODY = 8 * 1024 * 1024;

/**
 * Answers a request if `path` (without its leading slash or query) is one of the game
 * server's. Returns false for any other path, for the caller to serve.
 */
export function handleGameApi(host: GameService, req: IncomingMessage, res: ServerResponse, path: string): boolean {
  if (path !== API && !path.startsWith(`${API}/`)) return false;
  const route = path.slice(API.length + 1);
  if (req.method === 'GET' && route === 'hello') return json(res, 200, { server: true }), true;
  if (req.method === 'GET' && route === 'events') return events(host, req, res), true;
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' }), true;
  readJson(req)
    .then((body) => {
      switch (route) {
        case 'start':
          host.start(body as StartRequest);
          return json(res, 204);
        case 'act': {
          const { seat, seq, action } = body as ActRequest;
          return json(res, 200, { ok: host.act(seat, seq, action) });
        }
        case 'prefs': {
          const { seat, prefs } = body as PrefsRequest;
          host.setPrefs(seat, prefs);
          return json(res, 204);
        }
        case 'speed':
          host.setSpeed((body as SpeedRequest).speed);
          return json(res, 204);
        case 'end':
          host.end();
          return json(res, 204);
        default:
          return json(res, 404, { error: 'Not found' });
      }
    })
    .catch((err: Error) => json(res, err instanceof Refused ? 409 : 400, { error: err.message }));
  return true;
}

/** The seat's view now and after every change, as server-sent events, until the window goes. */
function events(host: GameService, req: IncomingMessage, res: ServerResponse) {
  const asked = new URL(req.url ?? '/', 'http://x').searchParams.get('seat');
  const seat: PlayerId | null = asked === null || asked === 'watch' ? null : Number(asked);
  if (seat !== null && !Number.isInteger(seat)) return json(res, 400, { error: 'Bad seat' });
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const stop = host.watch(seat, (m) => res.write(`data: ${JSON.stringify(m)}\n\n`));
  // A comment now and then keeps the connection from looking idle.
  const ping = setInterval(() => res.write(': ping\n\n'), 30_000);
  req.on('close', () => {
    clearInterval(ping);
    stop();
  });
}

export function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('Request too large'));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'));
      } catch {
        reject(new Error('Bad JSON'));
      }
    });
    req.on('error', reject);
  });
}

export function json(res: ServerResponse, status: number, body?: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.end(body === undefined ? undefined : JSON.stringify(body));
}
