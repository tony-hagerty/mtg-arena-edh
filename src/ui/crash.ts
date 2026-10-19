// What the window does with an error it didn't expect: the error screen (ErrorScreen.tsx)
// shows it and lets the player copy the details, and each one is sent to the program,
// which writes it to its log (server/game/report.ts). A page opened from disk has no
// program behind it: it only shows the error screen.
import { API } from '../net/protocol';
import type { ErrorLogged, ErrorReport } from '../net/protocol';
import { useStore } from './store';

/** At most this many reports per page load: an error that repeats every frame mustn't fill the log. */
const MAX_REPORTS = 20;
const sent = new Set<string>();

/** An error's message and stack, whatever was thrown. */
export function describe(err: unknown): { message: string; stack?: string } {
  if (err instanceof Error) return { message: err.message || err.name, stack: err.stack };
  return { message: typeof err === 'string' ? err : safeString(err) };
}

function safeString(v: unknown): string {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

/** The game's turn and step, if a game is on. */
function when(): Pick<ErrorReport, 'turn' | 'step'> {
  const g = useStore.getState().game;
  return g ? { turn: g.turn, step: g.step } : {};
}

/**
 * Sends an error to the program's log. Resolves to the program's answer (its build), or
 * null when there is no program (a page opened from disk), the same error was sent
 * already, or it couldn't be sent.
 */
export async function reportError(kind: ErrorReport['kind'], err: unknown, extra?: string): Promise<ErrorLogged | null> {
  const { message, stack } = describe(err);
  const report: ErrorReport = { kind, message, stack: [stack, extra].filter(Boolean).join('\n') || undefined, ...when() };
  const key = `${kind}|${message}|${stack ?? ''}`;
  if (!useStore.getState().server || sent.has(key) || sent.size >= MAX_REPORTS) return null;
  sent.add(key);
  try {
    const res = await fetch(`/${API}/error`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report) });
    return res.ok ? ((await res.json()) as ErrorLogged) : null;
  } catch {
    return null;
  }
}

/** Reports errors nothing else caught: in a click handler, a timer, a promise nobody waited on. */
export function watchPageErrors() {
  window.addEventListener('error', (e) => void reportError('error', e.error ?? e.message));
  window.addEventListener('unhandledrejection', (e) => void reportError('rejection', e.reason));
}

/** The last lines of the game's log, oldest first, or none outside a game. */
export function lastLogLines(n = 8): string[] {
  return useStore.getState().game?.log.slice(-n).map((l) => l.text) ?? [];
}

/** Everything a player can paste to whoever looks into the crash. */
export function crashDetails(err: unknown, componentStack: string | undefined, version: string | null): string {
  const { message, stack } = describe(err);
  const { turn, step } = when();
  return [
    `Arena EDH ${version ?? '(version unknown)'}`,
    turn !== undefined ? `Turn ${turn}, ${step}` : 'Not in a game',
    `Error: ${message}`,
    stack && `\n${stack}`,
    componentStack && `\nWhile drawing:${componentStack}`,
    lastLogLines().length ? `\nLast log lines:\n${lastLogLines().join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}
