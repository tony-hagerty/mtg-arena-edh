import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
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

/**
 * While `npm run dev` runs, the game server runs inside it too (server/game), as it does in
 * the Windows program, so the game window plays through it. Loaded through Vite, so edits
 * to the engine reach the server on the next game.
 */
function gameServer(): Plugin {
  return {
    name: 'game-server',
    apply: 'serve',
    configureServer(server) {
      let host: Promise<{ handle: (req: IncomingMessage, res: ServerResponse, path: string) => boolean }> | null = null;
      const load = async () => {
        const mod = await server.ssrLoadModule('/server/game/index.ts');
        const game = new mod.GameHost();
        return { handle: (req: IncomingMessage, res: ServerResponse, path: string) => mod.handleGameApi(game, req, res, path) as boolean };
      };
      server.middlewares.use((req, res, next) => {
        const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname).slice(1);
        if (!path.startsWith('api/game')) return next();
        // Moves are taken only from this server's own pages (see launcher/serve.ts).
        if (req.method !== 'GET' && req.headers.origin !== `http://${req.headers.host}`) {
          res.statusCode = 403;
          return res.end();
        }
        (host ??= load())
          .then(({ handle }) => handle(req, res, path) || next())
          .catch((err) => {
            host = null;
            next(err);
          });
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  // `--mode single` (npm run build:single) inlines all JS, CSS and fonts into one
  // index.html that works when opened straight from disk (file://).
  plugins: mode === 'single' ? [react(), viteSingleFile()] : [react(), cardRequests(), gameServer()],
  build: mode === 'single' ? { outDir: 'dist-single' } : {},
  // PORT lets a second dev server run beside one that already holds 5180.
  server: { port: Number(process.env.PORT) || 5180 },
  test: { include: ['tests/**/*.test.ts'], testTimeout: 120_000 },
}));
