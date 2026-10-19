// The bot games in tests/simulation/ are one file per game, listed in games.ts: the two must match.
import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { gameFiles } from './simulation/games';

describe('the bot games', () => {
  it('have a file for every game in the table, and no other', () => {
    const files = readdirSync(new URL('./simulation/', import.meta.url)).filter((f) => f.endsWith('.test.ts'));
    expect(files.sort()).toEqual(gameFiles().sort());
  });

  it('are 43 games, the regression set', () => {
    expect(gameFiles().length).toBe(43);
  });
});
