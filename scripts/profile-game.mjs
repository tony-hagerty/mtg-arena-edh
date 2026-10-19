// Plays one bot-vs-bot game under Node's CPU profiler and prints where the time went, so
// the engine's hot spots can be found and checked after a change. The game is the slowest
// one the suite plays: two Hashaton decks, from tests/simulation/hashaton-pair.test.ts.
//
//   npm run profile-game -- <seed>             default seed 94
//   npm run profile-game -- <seed> starter     the four starter decks instead
//   npm run profile-game -- <seed> <set>       a deck set from tests/simulation/games.ts (kuja, costs, ...)
//
// It prints the top functions by self time (time in the function's own code) and by
// inclusive time (its own code plus everything it called), and writes the raw
// .cpuprofile beside it, which Chrome's DevTools (Performance > Load profile) can open.
//
// The profiler is Node's own (`--cpu-prof`), so this script runs itself again under it:
// the first run spawns the second with the flag, then reads the profile it wrote.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const seed = Number(process.argv[2] ?? 94);
const decks = process.argv[3] ?? 'hashaton';
const self = fileURLToPath(import.meta.url);

if (process.env.PROFILE_GAME_CHILD) {
  // The profiled run: Vite loads the TypeScript the same way the tests do.
  const { createServer } = await import('vite');
  const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' });
  try {
    const { DECKS } = await server.ssrLoadModule('/src/cards/db.ts');
    const { playOut } = await server.ssrLoadModule('/tests/simulation/play.ts');
    const hashaton = DECKS.find((d) => d.id === 'hashaton');
    const ketramose = DECKS.find((d) => d.id === 'ketramose');
    const started = performance.now();
    const { GAMES } = await server.ssrLoadModule('/tests/simulation/games.ts');
    const set = GAMES[decks];
    const group = set?.groups.find((x) => x.seeds.includes(seed)) ?? set?.groups[0];
    const tables = decks === 'starter' ? undefined : decks === 'hashaton' ? [hashaton, DECKS[3], { ...hashaton, id: 'hashaton2' }, ketramose] : group?.decks();
    if (decks !== 'starter' && decks !== 'hashaton' && !group) throw new Error(`No deck set ${decks} in tests/simulation/games.ts`);
    const { g, actions } = playOut(seed, tables);
    const secs = ((performance.now() - started) / 1000).toFixed(1);
    console.log(`seed ${seed}: ${actions} actions, ${g.turn} turns, winner ${g.winner}, ${secs} s`);
  } finally {
    await server.close();
  }
} else {
  const dir = mkdtempSync(join(tmpdir(), 'profile-game-'));
  const run = spawnSync(process.execPath, ['--cpu-prof', `--cpu-prof-dir=${dir}`, self, String(seed), decks], {
    stdio: 'inherit',
    env: { ...process.env, PROFILE_GAME_CHILD: '1' },
  });
  if (run.status !== 0) process.exit(run.status ?? 1);
  const file = readdirSync(dir).find((f) => f.endsWith('.cpuprofile'));
  const profile = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  report(profile);
  console.log(`\nraw profile: ${join(dir, file)}`);
}

/** Self and inclusive time per function, from the profile's samples. */
function report(profile) {
  const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  // Each sample is one node; the time between samples is its self time.
  const self = new Map();
  const total = profile.endTime - profile.startTime;
  for (let i = 0; i < profile.samples.length; i++) {
    const dt = profile.timeDeltas[i] ?? 0;
    self.set(profile.samples[i], (self.get(profile.samples[i]) ?? 0) + dt);
  }
  // Vite runs each module as transformed code, so line numbers are those of the transformed
  // module, and some frames of the same function come without a file: they are merged by
  // name and line, and shown with the file any of them names.
  const fileOf = new Map();
  const id = (f) => `${f.functionName || '(anonymous)'}:${f.lineNumber}`;
  for (const n of profile.nodes) if (n.callFrame.url) fileOf.set(id(n.callFrame), n.callFrame.url);
  const key = (n) => {
    const f = n.callFrame;
    const url = fileOf.get(id(f)) ?? '';
    const file = url.replace(/^file:\/\//, '').replace(/.*\/node_modules\//, 'node_modules/').replace(/.*\/mtg-arena-edh\//, '');
    return `${f.functionName || '(anonymous)'} ${file}`;
  };
  const bySelf = new Map();
  const byIncl = new Map();
  for (const [id, t] of self) {
    bySelf.set(key(nodes.get(id)), (bySelf.get(key(nodes.get(id))) ?? 0) + t);
    // Inclusive: credit each distinct function on the path once (recursion counts once).
    const seen = new Set();
    for (let at = id; at !== undefined; at = parent.get(at)) {
      const k = key(nodes.get(at));
      if (seen.has(k)) continue;
      seen.add(k);
      byIncl.set(k, (byIncl.get(k) ?? 0) + t);
    }
  }
  const print = (title, m, n) => {
    console.log(`\n${title}`);
    const rows = [...m].filter(([k]) => !k.startsWith('(root)') && !k.startsWith('(program)') && !k.startsWith('(idle)')).sort((a, b) => b[1] - a[1]).slice(0, n);
    for (const [k, t] of rows) console.log(`${((100 * t) / total).toFixed(1).padStart(5)}%  ${(t / 1e6).toFixed(2).padStart(6)} s  ${k}`);
  };
  console.log(`\nprofile: ${(total / 1e6).toFixed(1)} s sampled`);
  print('Top 25 by self time (the function\'s own code):', bySelf, 25);
  print('Top 25 by inclusive time (the function and what it calls):', byIncl, 25);
  print('Project functions by inclusive time:', new Map([...byIncl].filter(([k]) => k.includes(' src/') || k.includes(' tests/'))), 30);
}
