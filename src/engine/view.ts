// What one player may know of the game: their copy of it, with everything hidden from them
// taken out. The host's server keeps the full game and sends each player only this.
import { makeCard } from './rules';
import type { Card, Game, LogEntry, PlayerId, Zone } from './types';

/** Zones whose cards nobody may look at, unless something lets them: libraries and hands (400.2). */
const HIDDEN_ZONES = ['library', 'hand'] as const;

/** The name of a card the viewer can't see. Empty, like a card back. */
export const HIDDEN = '';

/** Is this a stand-in for a card the viewer can't see? */
export const isHidden = (c: Card) => c.name === HIDDEN;

/**
 * The cards in `viewer`'s hidden zones that a choice in front of them lets them look at:
 * their whole library while they search it (701.23a), the cards they pick from, or the
 * card they may cast.
 */
function lookingAt(g: Game, viewer: PlayerId): Set<string> | 'library' {
  const d = g.decision;
  if (g.priority !== viewer || !d) return new Set();
  if (d.type === 'chooseCards' && d.choice.kind === 'search') return 'library';
  if (d.type === 'chooseCards' && (d.choice.kind === 'pick' || d.choice.kind === 'legend')) return new Set(d.choice.cards);
  if (d.type === 'cast') return new Set([d.choice.card]);
  return new Set();
}

/**
 * Which cards `viewer` may see. Their own hand (402.3), but not their library (401.2), and
 * nobody else's hand or library. A card exiled face down only by the players who may look
 * at it (406.3). Everything else is public.
 */
function visible(c: Card, zone: Zone, viewer: PlayerId | null, looking: Set<string> | 'library'): boolean {
  if (zone === 'exile') return !c.faceDown || (viewer !== null && c.known.includes(viewer));
  if (!(HIDDEN_ZONES as readonly string[]).includes(zone)) return true;
  // Cards a choice shows them, even another player's (Intuition-style picks).
  if (looking !== 'library' && looking.has(c.id)) return true;
  if (viewer === null || c.owner !== viewer) return false;
  return zone === 'hand' || looking === 'library';
}

/** Replaces every string in `value` that is a key of `ids`, in place, however deep. */
function renameIds(value: unknown, ids: Map<string, string>): unknown {
  if (typeof value === 'string') return ids.get(value) ?? value;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = renameIds(value[i], ids);
  } else if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    for (const k of Object.keys(o)) o[k] = renameIds(o[k], ids);
  }
  return value;
}

/** A log line as `viewer` reads it: the private version if it was written for them. */
function logLine(l: LogEntry, viewer: PlayerId | null): LogEntry {
  const { private: secret, ...line } = l;
  if (!secret || viewer === null || !secret.players.includes(viewer)) return line;
  return { ...line, text: secret.text, ...(secret.cards ? { cards: secret.cards } : {}) };
}

/**
 * The game as `viewer` may know it, or as an onlooker sees it when `viewer` is null. Each
 * card they can't see becomes a blank stand-in (`isHidden`) in the same place, with an id
 * that only says where it is ("library 3 of player 1"), so no id can follow a hidden card
 * or give away which card it is. Ids of hidden cards that appear anywhere else, like a
 * choice's list of cards, are swapped the same way. The random seed is dropped, so the next
 * shuffle can't be worked out, and log lines written for someone else read as everyone's.
 *
 * Counts stay right: hands and libraries keep their size, which anyone may count (402.3).
 */
export function viewFor(g: Game, viewer: PlayerId | null): Game {
  const view = structuredClone(g) as Game;
  const looking = viewer === null ? new Set<string>() : lookingAt(g, viewer);
  const ids = new Map<string, string>();
  const scratch = { nextId: 0 } as Game;
  for (const p of view.players) {
    for (const zone of [...HIDDEN_ZONES, 'exile'] as const) {
      p[zone] = p[zone].map((c, i) => {
        if (visible(c, zone, viewer, looking)) return c;
        const id = `hidden-${p.id}-${zone}-${i}`;
        ids.set(c.id, id);
        return makeCard(scratch, HIDDEN, p.id, zone, { id, faceDown: c.faceDown });
      });
    }
    // Looking through a library doesn't show its order (401.2), so a search shows it sorted.
    if (looking === 'library' && p.id === viewer) p.library.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }
  view.log = view.log.map((l) => logLine(l, viewer));
  view.rng = 0;
  // Everywhere but the zones themselves, which hold only stand-ins for hidden cards now.
  if (ids.size) {
    const { players, ...rest } = view;
    renameIds(rest, ids);
    for (const p of players) {
      for (const zone of ['battlefield', 'graveyard', 'command'] as const) renameIds(p[zone], ids);
      // Visible cards in hidden zones and exile can still point at hidden ones (`linked`).
      for (const zone of [...HIDDEN_ZONES, 'exile'] as const) for (const c of p[zone]) if (!isHidden(c)) renameIds(c, ids);
    }
  }
  return view;
}
