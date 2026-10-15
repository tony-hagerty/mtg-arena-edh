// How far the Oracle text parser (src/cards/oracle.ts) reaches: for every card in the
// pool, whether it can script the card on its own, and the clause it refused otherwise.
// Hand scripts are ignored here, so this measures the parser alone. Run: npm run parse-report
import { createServer } from 'vite';

// Vite loads the TypeScript (and the JSON it imports) the same way the app and tests do.
const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' });
try {
  const { parseReport } = await server.ssrLoadModule('/src/cards/oracle-report.ts');
  console.log(parseReport());
} finally {
  await server.close();
}
