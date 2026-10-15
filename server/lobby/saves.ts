/// <reference types="node" />
// Saved games: every player's program keeps a copy of their table's game, so if the host
// goes, any of them can carry on with it as the new host. A file is a short header in
// plain JSON (who played, which turn, this computer's seat) and the game itself,
// scrambled. Tony asked only for easy measures against cheating, so the key is the same
// in every copy of the program: it stops someone glancing at a file for hidden cards,
// not someone who reads this code.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { CardData, Game, PlayerId } from '../../src/engine';
import type { SavedGame } from '../../src/net/lobby';
import type { SeatPrefs } from '../../src/net/protocol';

/** What it takes to carry on with a game, as `GameHost.snapshot` gives it, plus the bots' decks for the table. */
export interface SaveData {
  game: Game;
  prefs: Partial<Record<PlayerId, SeatPrefs>>;
  cards: CardData[];
  /** Each seat's deck, for the table to show. */
  decks: ({ title: string; commanders: string[] } | null)[];
}

/** A saved game as it travels from the host to each player: the header, and the scrambled game. */
export interface SaveCopy {
  id: string;
  savedAt: number;
  turn: number;
  players: SavedGame['players'];
  /** `scramble(data)`, base64. */
  data: string;
}

const KEY = createHash('sha256').update('Arena EDH saved game, version 1').digest();
const EXT = '.arena-save';

export function scramble(data: SaveData): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', KEY, iv);
  const body = Buffer.concat([cipher.update(gzipSync(JSON.stringify(data))), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}

/** Throws if the data was changed or isn't a saved game. */
export function unscramble(text: string): SaveData {
  const b = Buffer.from(text, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', KEY, b.subarray(0, 12));
  decipher.setAuthTag(b.subarray(12, 28));
  return JSON.parse(gunzipSync(Buffer.concat([decipher.update(b.subarray(28)), decipher.final()])).toString('utf8')) as SaveData;
}

/** A save id is made here, and arrives from other programs: only these characters, so it's a safe file name. */
const isId = (id: unknown): id is string => typeof id === 'string' && /^[a-z0-9]{8,32}$/.test(id);

export const newSaveId = () => randomBytes(10).toString('hex');

/** The saved games in one folder (ArenaEDH-data/saves beside the .exe). */
export class SaveStore {
  constructor(private dir: string) {}

  /** Keeps `copy` as this computer's player's (in `yourSeat`), replacing an older one of the same game. */
  write(copy: SaveCopy, yourSeat: number) {
    if (!isId(copy.id)) return;
    mkdirSync(this.dir, { recursive: true });
    const file = join(this.dir, copy.id + EXT);
    // Written beside it and renamed over it, so a crash mid-write leaves the last good copy.
    writeFileSync(file + '.part', JSON.stringify({ ...copy, yourSeat }));
    renameSync(file + '.part', file);
  }

  /** The games saved here, newest first. An unreadable file is left out. */
  list(): SavedGame[] {
    let names: string[];
    try {
      names = readdirSync(this.dir).filter((n) => n.endsWith(EXT));
    } catch {
      return [];
    }
    const out: SavedGame[] = [];
    for (const n of names) {
      const s = this.header(n.slice(0, -EXT.length));
      if (s) out.push(s);
    }
    return out.sort((a, b) => b.savedAt - a.savedAt);
  }

  /** A saved game, with this computer's seat in it. Null if it's gone or damaged. */
  read(id: string): (SavedGame & { data: SaveData }) | null {
    const file = this.file(id);
    if (!file) return null;
    try {
      const { data, ...header } = file;
      return { ...header, data: unscramble(data) };
    } catch {
      return null;
    }
  }

  remove(id: string) {
    if (isId(id)) rmSync(join(this.dir, id + EXT), { force: true });
  }

  private header(id: string): SavedGame | null {
    const f = this.file(id);
    return f && { id: f.id, savedAt: f.savedAt, turn: f.turn, players: f.players, yourSeat: f.yourSeat };
  }

  private file(id: string): (SaveCopy & { yourSeat: number }) | null {
    if (!isId(id)) return null;
    try {
      const f = JSON.parse(readFileSync(join(this.dir, id + EXT), 'utf8'));
      return f && f.id === id && Array.isArray(f.players) && typeof f.data === 'string' ? f : null;
    } catch {
      return null;
    }
  }
}
