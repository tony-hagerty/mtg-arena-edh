import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';
import { BaseSequencer } from 'vitest/node';
import type { TestSpecification } from 'vitest/node';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { mergeRequests, readRequests, writeRequests } from './src/cards/requests.ts';

/**
 * The page's icon as PNGs at every size Windows draws one (the tab, the title bar, the taskbar
 * at each display scale), written into index.html as data, so the game window and the
 * Windows program carry them with no files to serve. Edge's app window, which is the game's
 * window in the Windows program, draws an SVG icon at 16 pixels and scales that up for the
 * taskbar, so the SVG alone looked blurry there. Drawn from src/ui/icon.svg, as the
 * program's own icon is (scripts/build-exe.mjs).
 */
function appIcons(): Plugin {
  const sizes = [16, 24, 32, 48, 64, 96, 128, 192, 256];
  let links: string | null = null;
  return {
    name: 'app-icons',
    transformIndexHtml: {
      // Before Vite turns the SVG's link into an asset's.
      order: 'pre',
      handler: async (html) => {
        if (!links) {
          const { Resvg } = await import('@resvg/resvg-js');
          const svg = readFileSync(new URL('./src/ui/icon.svg', import.meta.url));
          links = sizes
            .map((size) => {
              const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
              return `<link rel="icon" type="image/png" sizes="${size}x${size}" href="data:image/png;base64,${Buffer.from(png).toString('base64')}" />`;
            })
            .join('\n    ');
        }
        return html.replace(/<link rel="icon"[^>]*>/, links);
      },
    },
  };
}

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
        const game = await server.ssrLoadModule('/server/game/index.ts');
        const lobby = await server.ssrLoadModule('/server/lobby/index.ts');
        const net = await server.ssrLoadModule('/server/net/index.ts');
        const it = new lobby.Lobby(new game.GameHost(), {
          checkHost: (port: number) => net.checkHost(port),
          // The dev server keeps its saved games out of the repository.
          saves: join(tmpdir(), 'arena-edh-dev-saves'),
        });
        // The page's errors (server/game/report.ts) go to this terminal, where the launcher would write its log.
        const report = (line: string) => server.config.logger.error(line, { timestamp: true });
        return {
          handle: (req: IncomingMessage, res: ServerResponse, path: string) => (game.handleErrorReport(req, res, path, report) || lobby.handleApi(it, req, res, path)) as boolean,
        };
      };
      server.middlewares.use((req, res, next) => {
        const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname).slice(1);
        if (!path.startsWith('api/game') && !path.startsWith('api/lobby')) return next();
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

/** The bot games that took longest when last measured, longest first (see BotGamesFirst). */
const SLOW_GAMES = ['hashaton-pair-94', 'kuja-71', 'counters-auras-22', 'starter-decks-11', 'hashaton-pair-95', 'planeswalkers-35', 'kraum-tymna-65', 'kraum-tymna-62', 'faces-and-tokens-47', 'counterspells-14', 'hashaton-91', 'counterspells-12', 'costs-6', 'two-commanders-8'];

/**
 * Starts the bot-vs-bot games (tests/simulation/, one file each) first. They take far longer
 * than any other file, so the run takes as long as the last game to finish. Vitest orders
 * files by how long they took last time, longest first. With no timings from an earlier run
 * (a fresh checkout, CI) it would order them by size, and every game file is the same size,
 * so the games that were slowest when last measured go first.
 */
class BotGamesFirst extends BaseSequencer {
  async sort(files: TestSpecification[]) {
    const sorted = await super.sort(files);
    const name = (f: TestSpecification) => f.moduleId.replaceAll('\\', '/').split('/').pop()!.replace('.test.ts', '');
    const game = (f: TestSpecification) => f.moduleId.replaceAll('\\', '/').includes('/tests/simulation/');
    const games = sorted.filter(game);
    if (games.some((f) => !this.ctx.cache.getTestSpecificationResult(f))) {
      const rank = (f: TestSpecification) => (SLOW_GAMES.includes(name(f)) ? SLOW_GAMES.indexOf(name(f)) : SLOW_GAMES.length);
      games.sort((a, b) => rank(a) - rank(b));
    }
    return [...games, ...sorted.filter((f) => !game(f))];
  }
}

export default defineConfig(({ mode }) => ({
  // `--mode single` (npm run build:single) inlines all JS, CSS and fonts into one
  // index.html that works when opened straight from disk (file://).
  plugins: mode === 'single' ? [react(), appIcons(), viteSingleFile()] : [react(), appIcons(), cardRequests(), gameServer()],
  build: mode === 'single' ? { outDir: 'dist-single' } : {},
  // PORT lets a second dev server run beside one that already holds 5180.
  server: { port: Number(process.env.PORT) || 5180 },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 120_000,
    // Every core: the tests keep them busy, and the main process hardly needs one.
    maxWorkers: '100%',
    sequence: { sequencer: BotGamesFirst },
    // `npm run test:games` runs the tests tagged `game`, `npm run test:quick` the rest.
    tags: [{ name: 'game', description: 'Plays a whole game with bots: the games in tests/simulation/ and a few others.' }],
  },
}));
