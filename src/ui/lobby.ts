// The game window's side of the lobby (src/net/lobby.ts): hosting a table, joining one
// with a code, and the waiting room before the game starts. Like the game server
// (remote.ts), it is the program on this computer; a plain build opened from disk has none.
import { LOBBY_API } from '../net/lobby';
import type { LobbyConnection, LobbyState } from '../net/lobby';

/** Posts a lobby request. A refusal throws an Error whose message is the server's reason, in plain words. */
async function post(route: string, body: unknown = {}) {
  let res: Response;
  try {
    res = await fetch(`/${LOBBY_API}/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new Error("The game program on this computer isn't answering. Is it still running?");
  }
  if (res.ok) return;
  const reason = await res.json().then((b: { error?: unknown }) => (typeof b?.error === 'string' ? b.error : null)).catch(() => null);
  throw new Error(reason ?? `The table didn't accept that (error ${res.status}).`);
}

/**
 * The lobby of the program this page came from, or null if there is none. The lobby is
 * there when its event stream answers as one: a page served without it (a plain build, or
 * a dev server that only has the game) gets an error or a web page instead.
 */
export async function connectLobby(): Promise<LobbyConnection | null> {
  const probe = new AbortController();
  try {
    const res = await fetch(`/${LOBBY_API}/events`, { signal: probe.signal });
    if (!res.ok || !res.headers.get('Content-Type')?.startsWith('text/event-stream')) return null;
  } catch {
    return null;
  } finally {
    // Only the answer's headers were needed: the stream itself is opened by `watch`.
    probe.abort();
  }
  return {
    watch(on) {
      const source = new EventSource(`/${LOBBY_API}/events`);
      source.onmessage = (e) => on(JSON.parse(e.data) as LobbyState);
      return () => source.close();
    },
    host: (req) => post('host', req),
    join: (req) => post('join', req),
    deck: (req) => post('deck', req),
    ready: (req) => post('ready', req),
    table: (req) => post('table', req),
    start: () => post('start'),
    leave: () => post('leave'),
  };
}

const NAME_KEY = 'arena-edh.name';

/** The name this person last played under, or '' the first time. Storage can be missing or blocked. */
export function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // the name just won't outlast the page
  }
}
