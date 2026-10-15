// The lobby's web endpoints (src/net/lobby.ts), for this computer's game window. Like the
// game's (server/game/http.ts), they are served by the launcher and by the dev server.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { LOBBY_API } from '../../src/net/lobby';
import type { DeckRequest, HostRequest, JoinRequest, ReadyRequest, TableRequest } from '../../src/net/lobby';
import { handleGameApi, json, readJson, Refused } from '../game';
import type { Lobby } from './lobby';

/** Answers a request if `path` (without its leading slash or query) is the lobby's. Returns false for any other path. */
export function handleLobbyApi(lobby: Lobby, req: IncomingMessage, res: ServerResponse, path: string): boolean {
  if (path !== LOBBY_API && !path.startsWith(`${LOBBY_API}/`)) return false;
  const route = path.slice(LOBBY_API.length + 1);
  if (req.method === 'GET' && route === 'events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    const stop = lobby.watch((s) => res.write(`data: ${JSON.stringify(s)}\n\n`));
    const ping = setInterval(() => res.write(': ping\n\n'), 30_000);
    req.on('close', () => {
      clearInterval(ping);
      stop();
    });
    return true;
  }
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' }), true;
  readJson(req)
    .then(async (body) => {
      switch (route) {
        case 'host':
          await lobby.host(body as HostRequest);
          break;
        case 'join':
          await lobby.join(body as JoinRequest);
          break;
        case 'deck':
          lobby.deck(body as DeckRequest);
          break;
        case 'ready':
          lobby.ready(body as ReadyRequest);
          break;
        case 'table':
          lobby.table(body as TableRequest);
          break;
        case 'start':
          lobby.start();
          break;
        case 'leave':
          lobby.leave();
          break;
        default:
          return json(res, 404, { error: 'Not found' });
      }
      json(res, 204);
    })
    .catch((err: Error) => json(res, err instanceof Refused ? 409 : 400, { error: err.message }));
  return true;
}

/** Every endpoint a game window uses: the lobby's, then the game's, played wherever the lobby says. */
export function handleApi(lobby: Lobby, req: IncomingMessage, res: ServerResponse, path: string): boolean {
  return handleLobbyApi(lobby, req, res, path) || handleGameApi(lobby.games(), req, res, path);
}
