// File names that only work on a case-sensitive file system. Windows and macOS don't tell
// `garden.ts` from `Garden.tsx` when an import says './Garden', so a pair like that builds on
// Linux and breaks the build on Windows (where the program is made, `npm run build:exe`).
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..');

/** Every file under `dir`, as a path from the repository's root. */
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [relative(root, join(dir, e.name))]));
}

describe('file names', () => {
  it('has no two modules whose import paths differ only in case', () => {
    const modules = ['src', 'tests', 'launcher', 'server', 'scripts'].flatMap((d) => {
      try {
        return walk(join(root, d));
      } catch {
        return [];
      }
    });
    // An import names a module without its extension: `./garden` is garden.ts or garden.tsx.
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const f of modules) {
      const key = f.replace(/\.(tsx?|jsx?|mjs|cjs)$/, '').toLowerCase();
      const had = seen.get(key);
      if (had && had !== f) clashes.push(`${had} and ${f}`);
      else seen.set(key, f);
    }
    expect(clashes).toEqual([]);
  });
});
