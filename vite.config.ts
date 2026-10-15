import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { mergeRequests, readRequests, writeRequests } from './src/cards/requests.ts';

/**
 * While `npm run dev` runs, the deck-paste screen posts the cards it refused here, and they
 * are merged into docs/card-requests.json (see src/ui/card-requests.ts).
 */
function cardRequests(): Plugin {
  const file = new URL('./docs/card-requests.json', import.meta.url);
  return {
    name: 'card-requests',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__card-requests', (req, res, next) => {
        if (req.method !== 'POST') return next();
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          try {
            const now = readRequests(existsSync(file) ? readFileSync(file, 'utf8') : '');
            writeFileSync(file, writeRequests(mergeRequests(now, readRequests(body).cards)));
            res.statusCode = 204;
          } catch {
            res.statusCode = 500;
          }
          res.end();
        });
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  // `--mode single` (npm run build:single) inlines all JS, CSS and fonts into one
  // index.html that works when opened straight from disk (file://).
  plugins: mode === 'single' ? [react(), viteSingleFile()] : [react(), cardRequests()],
  build: mode === 'single' ? { outDir: 'dist-single' } : {},
  // PORT lets a second dev server run beside one that already holds 5180.
  server: { port: Number(process.env.PORT) || 5180 },
  test: { include: ['tests/**/*.test.ts'], testTimeout: 120_000 },
}));
