// Errors in the game window, written to the program's log: the Windows build has no console,
// so `ArenaEDH-data/launcher.log` is the one place a crash can be read afterwards. The
// window posts each one (src/ui/crash.ts); the launcher and the dev server say where it goes.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { API } from '../../src/net/protocol';
import type { ErrorLogged, ErrorReport } from '../../src/net/protocol';
import { APP_VERSION } from '../lobby/version';
import { json, readJson } from './http';

const ROUTE = `${API}/error`;
/** Enough for any stack trace; a line in the log stays readable. */
const MAX_TEXT = 4000;

/**
 * Answers POST `api/game/error` by writing the report as one line (`errorLine`) with `write`.
 * Returns false for any other path, for the caller to serve.
 */
export function handleErrorReport(req: IncomingMessage, res: ServerResponse, path: string, write: (line: string) => void, version = APP_VERSION): boolean {
  if (path !== ROUTE || req.method !== 'POST') return false;
  readJson(req)
    .then((body) => {
      const report = body as Partial<ErrorReport> | null;
      if (!report || typeof report.message !== 'string') return json(res, 400, { error: 'Bad report' });
      write(errorLine(report as ErrorReport, version));
      return json(res, 200, { version } satisfies ErrorLogged);
    })
    .catch((err: Error) => json(res, 400, { error: err.message }));
  return true;
}

/**
 * One line for the log: "Page error (render) dev turn 7 main1: <message> | at ... | at ...".
 * Line breaks become " | ", so one error never spans lines, and long text is cut short.
 */
export function errorLine(r: ErrorReport, version: string): string {
  const flat = (s: string) => s.replace(/\s*\r?\n\s*/g, ' | ').slice(0, MAX_TEXT);
  const kind = ['render', 'error', 'rejection'].includes(r.kind) ? r.kind : 'error';
  const when = typeof r.turn === 'number' ? ` turn ${r.turn}${typeof r.step === 'string' ? ` ${flat(r.step).slice(0, 20)}` : ''}` : '';
  // A stack trace usually starts with the message: no need to say it twice.
  const stack = typeof r.stack === 'string' && r.stack ? flat(r.stack) : '';
  const text = stack.includes(flat(r.message)) ? stack : [flat(r.message), stack].filter(Boolean).join(' | ');
  return `Page error (${kind}) ${version}${when}: ${text}`;
}
