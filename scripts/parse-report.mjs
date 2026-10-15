// How far the Oracle text parser (src/cards/oracle.ts) reaches: for every card in the
// pool, whether it can script the card on its own, and the clause it refused otherwise.
// Hand scripts are ignored here, so this measures the parser alone. Pool cards that can't
// be played at all (no hand script either) are added to docs/card-requests.json, for the
// /script-requested-cards skill. Run: npm run parse-report
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';

const target = new URL('../docs/card-requests.json', import.meta.url);

// Vite loads the TypeScript (and the JSON it imports) the same way the app and tests do.
const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' });
try {
  const { parseReport, poolRequests } = await server.ssrLoadModule('/src/cards/oracle-report.ts');
  const { mergeRequests, readRequests, writeRequests } = await server.ssrLoadModule('/src/cards/requests.ts');
  console.log(parseReport());
  const add = poolRequests();
  if (add.length) {
    // Running the report again isn't a new request, so counts stay as they are.
    const file = mergeRequests(readRequests(existsSync(target) ? readFileSync(target, 'utf8') : ''), add, { count: false });
    writeFileSync(target, writeRequests(file));
    console.log(`\n${add.length} pool cards can't be played; listed in docs/card-requests.json.`);
  }
} finally {
  await server.close();
}
