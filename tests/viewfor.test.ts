// Each player's own view of the game (phase 2 of multiplayer): `viewFor` takes out what they can't see.
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import './fixtures';
import { DECKS } from '../src/cards/db';
import { applyBotAction, botAction, isHidden, newGame, viewFor } from '../src/engine';
import type { Card, Game, PlayerId } from '../src/engine';
import { byName, emptyGame, put, run } from './helpers';

/**
 * Every card id in a player's hidden zones that `viewer` shouldn't see, in the full game:
 * all but what a choice in front of them shows them (their library while they search it,
 * the cards they pick from, the card they may cast).
 */
function secretIds(g: Game, viewer: PlayerId | null): string[] {
  const d = viewer !== null && g.priority === viewer ? g.decision : null;
  const searching = d?.type === 'chooseCards' && d.choice.kind === 'search';
  const shown = new Set(d?.type === 'chooseCards' && 'cards' in d.choice ? d.choice.cards : d?.type === 'cast' ? [d.choice.card] : []);
  return g.players.flatMap((p) => [
    ...(searching && p.id === viewer ? [] : p.library.map((c) => c.id).filter((id) => !shown.has(id))),
    ...(p.id === viewer ? [] : p.hand.map((c) => c.id)),
    ...p.exile.filter((c) => c.faceDown && (viewer === null || !c.known.includes(viewer))).map((c) => c.id),
  ]);
}

/** Every string anywhere in a value. */
function strings(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (typeof value === 'string') out.add(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => strings(v, out));
  return out;
}

describe('viewFor: what one player may see', () => {
  const game = () =>
    emptyGame((d) => {
      put(d, 0, 'Forest', 'hand', 2);
      put(d, 1, 'Shivan Dragon', 'hand');
      put(d, 2, 'Lightning Bolt', 'hand', 3);
      put(d, 1, 'Llanowar Elves');
    });

  it('shows your own hand, and only the size of everyone else’s hand and every library (402.3, 401.2)', () => {
    const g = game();
    const v = viewFor(g, 0);
    expect(v.players[0].hand.map((c) => c.name)).toEqual(['Forest', 'Forest']);
    expect(v.players[1].hand.every(isHidden)).toBe(true);
    expect(v.players.map((p) => p.hand.length)).toEqual(g.players.map((p) => p.hand.length));
    expect(v.players.map((p) => p.library.length)).toEqual(g.players.map((p) => p.library.length));
    expect(v.players.every((p) => p.library.every(isHidden))).toBe(true);
    // The battlefield is public.
    expect(v.players[1].battlefield.map((c) => c.name)).toEqual(['Llanowar Elves']);
  });

  it('names a hidden card only by where it is, and drops the random seed', () => {
    const g = game();
    const v = viewFor(g, 0);
    expect(v.players[2].hand.map((c) => c.id)).toEqual(['hidden-2-hand-0', 'hidden-2-hand-1', 'hidden-2-hand-2']);
    const seen = strings(v);
    expect(secretIds(g, 0).filter((id) => seen.has(id))).toEqual([]);
    expect(v.rng).toBe(0);
    expect(g.rng).not.toBe(0);
  });

  it('shows an onlooker no hand at all', () => {
    const v = viewFor(game(), null);
    expect(v.players.every((p) => p.hand.every(isHidden))).toBe(true);
  });

  it('leaves the full game as it was', () => {
    const g = game();
    const before = JSON.stringify(g);
    viewFor(g, 1);
    expect(JSON.stringify(g)).toBe(before);
  });

  it('shows a card exiled face down only to the players who may look at it (406.3)', () => {
    const g = produce(game(), (d) => {
      const c = put(d, 0, 'Sol Ring', 'exile');
      c.faceDown = true;
      c.known = [0];
    });
    expect(viewFor(g, 0).players[0].exile.map((c) => c.name)).toEqual(['Sol Ring']);
    const other = viewFor(g, 1).players[0].exile;
    expect(other.map((c) => [isHidden(c), c.faceDown])).toEqual([[true, true]]);
  });
});

describe('viewFor while a choice shows hidden cards', () => {
  const searching = () =>
    run(
      emptyGame((d) => {
        d.players[0].isBot = false;
        d.players[0].library = [];
        put(d, 0, 'Forest', 'battlefield', 3);
        put(d, 0, 'Rampant Growth', 'hand');
        put(d, 0, 'Plains', 'library');
        put(d, 0, 'Kalonian Tusker', 'library');
        put(d, 0, 'Forest', 'library');
      }),
    );

  it('shows the searcher their library, sorted so its order stays hidden (701.23a, 401.2)', () => {
    let g = searching();
    g = run(g, { type: 'cast', card: byName(g, 0, 'Rampant Growth', 'hand')!.id });
    expect(g.decision?.type).toBe('chooseCards');
    expect(viewFor(g, 0).players[0].library.map((c) => c.name)).toEqual(['Forest', 'Kalonian Tusker', 'Plains']);
    expect(viewFor(g, 1).players[0].library.every(isHidden)).toBe(true);
  });

  it('shows the cards to pick to whoever picks, even from another player’s library', () => {
    let g = emptyGame((d) => {
      d.players[0].isBot = false;
      d.players[1].isBot = false;
      d.players[0].library = [];
      put(d, 0, 'Island', 'battlefield', 3);
      put(d, 0, 'Intuition', 'hand');
      for (const name of ['Sol Ring', 'Arcane Signet', 'Thran Dynamo', 'Plains']) put(d, 0, name, 'library');
    });
    g = run(g, { type: 'cast', card: byName(g, 0, 'Intuition', 'hand')!.id, targets: [{ kind: 'player', id: 1 }] });
    const three = g.players[0].library.filter((c) => c.name !== 'Plains').map((c) => c.id);
    g = run(g, { type: 'chooseCards', cards: three });
    expect([g.decision?.type, g.priority]).toEqual(['chooseCards', 1]);
    const chooser = viewFor(g, 1);
    expect(chooser.players[0].library.filter((c) => !isHidden(c)).map((c) => c.id).sort()).toEqual([...three].sort());
    // A third player sees stand-ins, and the choice names the stand-ins too.
    const third = viewFor(g, 2);
    expect(third.players[0].library.every(isHidden)).toBe(true);
    const choice = third.decision?.type === 'chooseCards' && third.decision.choice.kind === 'pick' ? third.decision.choice.cards : [];
    expect(choice.every((id) => id.startsWith('hidden-0-library-'))).toBe(true);
  });
});

describe('viewFor and the log', () => {
  it('shows the card a search found only to the searcher (701.23e)', () => {
    let g = emptyGame((d) => {
      d.players[0].isBot = false;
      d.players[0].library = [];
      put(d, 0, 'Swamp', 'battlefield', 2);
      put(d, 0, 'Demonic Tutor', 'hand');
      put(d, 0, 'Kalonian Tusker', 'library');
    });
    g = run(g, { type: 'cast', card: byName(g, 0, 'Demonic Tutor', 'hand')!.id });
    g = run(g, { type: 'chooseCards', cards: [byName(g, 0, 'Kalonian Tusker', 'library')!.id] });
    const line = (v: Game) => v.log.find((l) => l.text.includes('searches'))!;
    expect(line(viewFor(g, 0))).toMatchObject({ text: expect.stringMatching(/for Kalonian Tusker\.$/), cards: ['Kalonian Tusker'] });
    expect(line(viewFor(g, 1)).text).toMatch(/for a card\.$/);
    expect(line(viewFor(g, 1)).cards).toBeUndefined();
    expect(viewFor(g, 0).log.some((l) => 'private' in l)).toBe(false);
  });
});

describe('viewFor through whole games', () => {
  it('never gives any player a hidden card’s id, at any point of a four-player game', () => {
    let g = newGame({ seed: 31, seats: DECKS.slice(0, 4).map((deck) => ({ deck })) });
    let checked = 0;
    for (let i = 0; g.step !== 'gameOver' && i < 4000; i++) {
      g = applyBotAction(g, botAction(g, g.priority));
      if (i % 25) continue;
      for (const viewer of [0, 1, 2, 3, null] as (PlayerId | null)[]) {
        const v = viewFor(g, viewer);
        const seen = strings(v);
        const leaked = secretIds(g, viewer).filter((id) => seen.has(id));
        if (leaked.length) throw new Error(`step ${i}: player ${viewer} can see ${leaked.join(', ')}`);
        // Everything public matches the full game.
        expect(v.players.map((p) => p.battlefield.length)).toEqual(g.players.map((p) => p.battlefield.length));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('keeps hidden stand-ins blank', () => {
    const v = viewFor(newGame({ seed: 2, seats: DECKS.slice(0, 2).map((deck) => ({ deck })) }), 0);
    const blank = (c: Card) => c.name === '' && c.continuous.length === 0 && c.cast === null;
    expect(v.players[1].hand.every(blank)).toBe(true);
  });
});

describe('the screen drawn from a player’s view', () => {
  it('builds from a filtered game at every point of a game with one person', async () => {
    const { useStore } = await import('../src/ui/store');
    const { buildView } = await import('../src/ui/view');
    let g = newGame({ seed: 12, seats: [{ deck: DECKS[0], human: true }, ...DECKS.slice(1, 4).map((deck) => ({ deck }))] });
    for (let i = 0; g.step !== 'gameOver' && i < 1500; i++) {
      if (i % 10 === 0) {
        useStore.setState({ game: viewFor(g, 0), human: 0, humans: [0], handoff: null, targeting: null, pickedBlockers: [] });
        expect(() => buildView()).not.toThrow();
      }
      g = applyBotAction(g, botAction(g, g.priority));
    }
  });
});
