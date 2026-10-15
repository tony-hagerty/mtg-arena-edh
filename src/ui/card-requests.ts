// Sends refused cards to docs/card-requests.json. While `npm run dev` runs, the dev server's
// endpoint (vite.config.ts) writes them into the file. A built or hosted version has no
// endpoint, so it keeps them in the browser for the paste screen's Download report button.
import { mergeRequests, readRequests, writeRequests } from '../cards/requests';
import type { CardRequest, RequestFile } from '../cards/requests';

/** The dev server's endpoint, added by the plugin in vite.config.ts. */
export const ENDPOINT = '/__card-requests';
const KEY = 'arena-edh.card-requests';

/** Whether refusals go straight into docs/card-requests.json (the dev server), not to a download. */
export const writesFile = import.meta.env.DEV;

/** The refusals kept in this browser for a download. */
export function keptRequests(): RequestFile {
  try {
    return readRequests(localStorage.getItem(KEY) ?? '');
  } catch {
    return { cards: [] };
  }
}

function keep(file: RequestFile) {
  try {
    if (file.cards.length) localStorage.setItem(KEY, JSON.stringify(file));
    else localStorage.removeItem(KEY);
  } catch {
    // the report just won't outlast the page
  }
}

/** Writes these refusals down: into the file through the dev server, or in the browser for a download. */
export function reportRequests(cards: CardRequest[]) {
  if (!cards.length) return;
  if (writesFile) {
    fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cards }) }).catch(() => {
      // An old dev server without the endpoint: keep them for a download instead.
      keep(mergeRequests(keptRequests(), cards));
    });
  } else keep(mergeRequests(keptRequests(), cards));
}

/**
 * Saves the kept refusals as card-requests.json, for the user to merge into the repo
 * (`npm run card-requests -- <file>`), and empties the browser's copy so nothing is
 * counted twice.
 */
export function downloadRequests() {
  const file = keptRequests();
  const url = URL.createObjectURL(new Blob([writeRequests(file)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'card-requests.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  keep({ cards: [] });
}
