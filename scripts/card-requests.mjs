// Merges a card-requests.json downloaded from the deck-paste screen (a built or hosted
// version, with no dev server to write the file) into docs/card-requests.json, the same
// way the dev server does. Run: npm run card-requests -- ~/Downloads/card-requests.json
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// Node strips the module's types.
import { mergeRequests, readRequests, writeRequests } from '../src/cards/requests.ts';

const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs/card-requests.json');
const sources = process.argv.slice(2);
if (!sources.length) {
  console.error('Usage: npm run card-requests -- <downloaded card-requests.json> [more files]');
  process.exit(1);
}
let file = readRequests(existsSync(target) ? readFileSync(target, 'utf8') : '');
for (const src of sources) {
  const add = readRequests(readFileSync(src, 'utf8')).cards;
  file = mergeRequests(file, add);
  console.log(`${src}: ${add.length} cards merged.`);
}
writeFileSync(target, writeRequests(file));
console.log(`docs/card-requests.json now lists ${file.cards.length} cards.`);
