// The game window's side of the game server (src/net/protocol.ts, server/game): it streams
// one seat's view of the game and sends that seat's moves. Without a server (a plain
// `vite build` opened from disk, or tests), the store runs the whole game in the page.
import type { PlayerId } from '../engine';
import { API } from '../net/protocol';
import type { ActRequest, PrefsRequest, StartRequest, ViewMessage } from '../net/protocol';

export interface Connection {
  start(req: StartRequest): Promise<void>;
  /** Calls `on` with `seat`'s view now and after every change, until the returned function is called. */
  watch(seat: PlayerId | null, on: (m: ViewMessage) => void): () => void;
  act(req: ActRequest): void;
  prefs(req: PrefsRequest): void;
  speed(speed: number): void;
  end(): void;
}

const post = (route: string, body: unknown) =>
  fetch(`/${API}/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((res) => {
    if (!res.ok) throw new Error(`${route}: ${res.status}`);
  });

/** Moves and settings don't wait for an answer: the next view says what happened. */
const send = (route: string, body: unknown) => void post(route, body).catch((err) => console.warn('Game server:', err));

/** The game server this page came from, or null if there is none. */
export async function connectServer(): Promise<Connection | null> {
  try {
    const res = await fetch(`/${API}/hello`);
    if (!res.ok || !(await res.json()).server) return null;
  } catch {
    return null;
  }
  return {
    start: (req) => post('start', req),
    watch(seat, on) {
      const source = new EventSource(`/${API}/events?seat=${seat ?? 'watch'}`);
      source.onmessage = (e) => on(JSON.parse(e.data) as ViewMessage);
      return () => source.close();
    },
    act: (req) => send('act', req),
    prefs: (req) => send('prefs', req),
    speed: (speed) => send('speed', { speed }),
    end: () => send('end', {}),
  };
}
