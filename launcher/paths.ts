// Where the program keeps its data: one folder beside the .exe, so the whole thing stays
// portable (copy the .exe and its folder to a USB stick and everything comes along).
import { dirname, join } from 'node:path';

export const APP = 'ArenaEDH';

export interface Paths {
  /** The folder the .exe sits in. */
  home: string;
  /** `ArenaEDH-data`, beside the .exe. */
  data: string;
  /**
   * Edge's profile (`--user-data-dir`). Decks, settings and fetched cards are kept in the
   * browser's storage today, so they live here until they move into files of their own.
   */
  edge: string;
  /** This run's log. With no console window, it's the only place errors show up. */
  log: string;
  /** Saved and paused games (phase 5). Not created yet. */
  saves: string;
  /** Card data fetched from Scryfall, for the game server (phase 4). Not created yet. */
  cards: string;
}

/** `exe` is the running program: `process.execPath` in the .exe, the bundle when run from source. */
export function pathsFor(exe: string): Paths {
  const home = dirname(exe);
  const data = join(home, `${APP}-data`);
  return {
    home,
    data,
    edge: join(data, 'edge'),
    log: join(data, 'launcher.log'),
    saves: join(data, 'saves'),
    cards: join(data, 'cards'),
  };
}
