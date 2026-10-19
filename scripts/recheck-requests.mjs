// Reads every card in docs/card-requests.json again with the Oracle text parser, from its
// Scryfall data, and takes out the ones it now scripts (removeRequests in
// src/cards/requests.ts). Prints what stays and the clause each one stops on. Run after
// adding templates: npm run recheck-requests (behind an HTTPS proxy:
// NODE_USE_ENV_PROXY=1 npm run recheck-requests). With --dry-run it changes nothing.
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';

const target = new URL('../docs/card-requests.json', import.meta.url);
const dry = process.argv.includes('--dry-run');

// Vite loads the TypeScript the same way the app and tests do.
const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' });
try {
  const { fetchCollection } = await server.ssrLoadModule('/src/cards/scryfall.ts');
  const { parseCard, needsScript } = await server.ssrLoadModule('/src/cards/oracle.ts');
  const { readRequests, removeRequests, writeRequests } = await server.ssrLoadModule('/src/cards/requests.ts');
  const file = readRequests(readFileSync(target, 'utf8'));
  const names = file.cards.map((c) => c.name);
  const res = await fetchCollection(names, { pause: 150, headers: { 'User-Agent': 'mtg-arena-edh-prototype/0.1' } });
  if (res.error) throw new Error(`${res.error} (${res.failed.length} cards not fetched)`);
  // A request may name a card by its first face.
  const byName = new Map(res.cards.map((c) => [c.name, c]));
  for (const c of res.cards) for (const f of c.faces ?? []) if (!byName.has(f.name)) byName.set(f.name, c);
  const read = [];
  const left = [];
  for (const name of names) {
    const d = byName.get(name);
    if (!d) left.push(`${name}: not found on Scryfall`);
    else if (!needsScript(d)) read.push(name);
    else {
      const p = parseCard(d);
      if (p.ok) read.push(name);
      else left.push(`${name}: ${p.clause} (${p.reason})`);
    }
  }
  console.log(`${read.length} now parse:${read.map((n) => `\n  ${n}`).join('')}\n\n${left.length} stay:${left.map((n) => `\n  ${n}`).join('')}`);
  if (!dry && read.length) {
    writeFileSync(target, writeRequests(removeRequests(file, read)));
    console.log(`\nTook ${read.length} cards out of docs/card-requests.json.`);
  }
} finally {
  await server.close();
}
