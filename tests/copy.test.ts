// Copy effects on permanents already on the battlefield (707.4, layer 1: 613.2a), with
// Likeness Looter: "{X}: This creature becomes a copy of target creature card in your
// graveyard with mana value X, except it has flying and this ability. Activate only as a sorcery."
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { registerCards } from '../src/cards/db';
import {
  activatable,
  activatedAbilities,
  addCounters,
  addLasting,
  applyAction,
  botAction,
  canActivate,
  hasType,
  isCreature,
  label,
  maxAbilityX,
  moveCard,
  pump,
  stats,
  tokenCopy,
  transform,
} from '../src/engine';
import type { Card, CardData, Game, TargetRef } from '../src/engine';
import { registerScripts } from '../src/engine/registry';
import './fixtures';
import { byName, emptyGame, put, runWith } from './helpers';

const byHand = { autoPass: false };
const pass = { type: 'pass' } as const;
const ref = (c: { id: string }): TargetRef => ({ kind: 'card', id: c.id });
const LOOTER = 'Likeness Looter';

/** A made-up creature card, for a static ability no card in the pool has on a creature. */
function fake(name: string, oracleText: string): CardData {
  return { name, manaCost: '{1}', cmc: 1, colors: [], colorIdentity: [], typeLine: 'Creature — Giant', oracleText, keywords: [], power: '2', toughness: '2', image: '', art: '' };
}
registerCards({
  'Test Copy Shrinker': fake('Test Copy Shrinker', 'Creatures you control have base power and toughness 1/1.'),
  'Test Copy Grower': fake('Test Copy Grower', 'Creatures you control have base power and toughness 4/4.'),
});
const baseFor = (power: number, toughness: number) => (g: Game, self: Card, c: Card) =>
  c.controller === self.controller && isCreature(g, c) ? { setPower: power, setToughness: toughness } : null;
registerScripts({ 'Test Copy Shrinker': { static: baseFor(1, 1) }, 'Test Copy Grower': { static: baseFor(4, 4) } });

/** Player 0 with Likeness Looter, `lands` Islands and these creature cards in their graveyard. */
const looterGame = (graveyard: string[], lands = 6, setup: (d: Game) => void = () => {}) =>
  emptyGame((d) => {
    put(d, 0, LOOTER);
    put(d, 0, 'Island', 'battlefield', lands);
    for (const name of graveyard) put(d, 0, name, 'graveyard');
    setup(d);
  });

const looter = (g: Game) => g.players[0].battlefield.find((c) => c.name === LOOTER)!;

/** Activates the Looter's copy ability with this X and target, then lets it resolve. */
function becomeCopyOf(g: Game, target: string, x: number): Game {
  const t = byName(g, 0, target, 'graveyard')!;
  g = runWith(byHand, g, { type: 'activate', card: looter(g).id, activated: activatedAbilities(g, looter(g)).length - 1, x, targets: [ref(t)] });
  return runWith(byHand, g, pass, pass, pass, pass);
}

describe('Likeness Looter becomes a copy (707.4)', () => {
  it('takes on the card\'s copiable values, except it has flying and the copy ability (707.9a)', () => {
    const g = becomeCopyOf(looterGame(['Shivan Dragon']), 'Shivan Dragon', 6);
    const c = looter(g);
    expect(c.name).toBe(LOOTER); // the card it is doesn't change
    expect(g.log.some((l) => l.text.includes('Likeness Looter becomes a copy of Shivan Dragon'))).toBe(true);
    const s = stats(g, c);
    expect([s.power, s.toughness]).toEqual([5, 5]);
    expect(hasType(g, c, 'Dragon')).toBe(true);
    expect(hasType(g, c, 'Faerie')).toBe(false);
    expect(s.keywords.has('flying')).toBe(true);
    // Shivan Dragon's own ability first, then the copy ability; not the Looter's {T} loot.
    expect(activatedAbilities(g, c).map((a) => a.text)).toEqual([
      expect.stringContaining('+1/+0'),
      'Become a copy of a creature card in your graveyard with mana value X',
    ]);
  });

  it("keeps its status, counters and other effects, and nothing triggers as if it entered (707.4)", () => {
    let g = looterGame(['Solemn Simulacrum'], 6, (d) => {
      const c = d.players[0].battlefield.find((x) => x.name === LOOTER)!;
      addCounters(d, c, 1);
      pump(d, c, 2, 0);
      c.damage = 1;
    });
    const ts = looter(g).ts;
    g = becomeCopyOf(g, 'Solemn Simulacrum', 4);
    const c = looter(g);
    const s = stats(g, c);
    // A 2/2 Golem, +1/+1 counter and +2/+0 until end of turn: 5/3, with its damage.
    expect([s.power, s.toughness]).toEqual([5, 3]);
    expect(c.damage).toBe(1);
    expect(c.ts).toBe(ts); // its own timestamp stays (613.7d)
    expect(hasType(g, c, 'Artifact')).toBe(true);
    // Solemn's "When this creature enters" doesn't trigger: it didn't enter.
    expect(g.stack).toHaveLength(0);
    expect(g.triggers).toHaveLength(0);
    expect(g.decision).toBeNull();
  });

  it('can copy again: the new copy effect replaces the old one, exceptions included (707.2)', () => {
    let g = becomeCopyOf(looterGame(['Shivan Dragon', 'Llanowar Elves'], 8), 'Shivan Dragon', 6);
    g = produce(g, (d) => {
      d.turn++; // a new turn: the Islands untap
      for (const c of d.players[0].battlefield) c.tapped = false;
    });
    g = becomeCopyOf(g, 'Llanowar Elves', 1);
    const c = looter(g);
    expect(hasType(g, c, 'Elf')).toBe(true);
    expect(hasType(g, c, 'Dragon')).toBe(false);
    expect([stats(g, c).power, stats(g, c).toughness]).toEqual([1, 1]);
    expect(stats(g, c).keywords.has('flying')).toBe(true);
    expect(activatedAbilities(g, c)).toHaveLength(1); // the copy ability, once
  });

  it('a copy of it copies the exceptions too (707.9a, 707.3)', () => {
    let g = becomeCopyOf(looterGame(['Elite Vanguard']), 'Elite Vanguard', 1);
    g = produce(g, (d) => void tokenCopy(d, 0, looter(d)));
    const token = g.players[0].battlefield.find((c) => c.isToken)!;
    expect(token.name).toBe('Elite Vanguard');
    expect(stats(g, token).keywords.has('flying')).toBe(true);
    expect(activatedAbilities(g, token).map((a) => a.text)).toEqual(['Become a copy of a creature card in your graveyard with mana value X']);
  });

  it('a copy of a double-faced card in a graveyard has its front face, and can\'t transform (712.8a, 712.9)', () => {
    let g = becomeCopyOf(looterGame(['Eirdu, Carrier of Dawn']), 'Eirdu, Carrier of Dawn', 5);
    const before = stats(g, looter(g));
    expect(label(looter(g))).toBe('Eirdu, Carrier of Dawn');
    g = produce(g, (d) => transform(d, looter(d)));
    expect(looter(g).face).toBe(0);
    expect(stats(g, looter(g)).power).toBe(before.power);
  });

  it('stops being a copy when it leaves the battlefield (400.7)', () => {
    let g = becomeCopyOf(looterGame(['Shivan Dragon']), 'Shivan Dragon', 6);
    g = produce(g, (d) => moveCard(d, looter(d), 'hand'));
    const c = byName(g, 0, LOOTER, 'hand')!;
    expect(c.copy).toBeNull();
    expect(c.copyTs).toBeUndefined();
  });

  it("loses the copy effect's exceptions with its other abilities (707.9a, 113.10)", () => {
    let g = becomeCopyOf(looterGame(['Shivan Dragon']), 'Shivan Dragon', 6);
    g = produce(g, (d) => addLasting(d, looter(d), { loseAll: true }));
    const c = looter(g);
    expect(activatedAbilities(g, c)).toEqual([]);
    expect(stats(g, c).keywords.has('flying')).toBe(false);
    expect(hasType(g, c, 'Dragon')).toBe(true); // still a copy: only its abilities are gone
  });
});

describe('a target that depends on X (107.3a, 601.2b-c via 602.2b)', () => {
  it('only a creature card in your graveyard with mana value X can be the target', () => {
    const g = looterGame(['Shivan Dragon', 'Elite Vanguard', 'Island'], 6, (d) => put(d, 1, 'Llanowar Elves', 'graveyard'));
    const c = looter(g);
    const act = (name: string, x: number, pid = 0) =>
      applyAction(g, { type: 'activate', card: c.id, activated: 1, x, targets: [ref(byName(g, pid, name, 'graveyard')!)] }, byHand);
    expect(act('Shivan Dragon', 6)).not.toBe(g);
    expect(act('Shivan Dragon', 5)).toBe(g);
    expect(act('Elite Vanguard', 1)).not.toBe(g);
    expect(act('Island', 0)).toBe(g); // not a creature card
    expect(act('Llanowar Elves', 1, 1)).toBe(g); // not in your graveyard
  });

  it('it can be activated for an X that has a target even when X = 0 has none, and only as a sorcery', () => {
    let g = looterGame(['Elite Vanguard', 'Solemn Simulacrum'], 6);
    const c = looter(g);
    expect(canActivate(g, 0, c, undefined, 1, 0)).toBe(false);
    expect(canActivate(g, 0, c, undefined, 1, 2)).toBe(false);
    expect(canActivate(g, 0, c, undefined, 1, 4)).toBe(true);
    // The highest X it can pay for that has a target, past values that have none.
    expect(maxAbilityX(g, 0, c, { activated: 1 })).toBe(4);
    expect(activatable(g, 0, c)).toContainEqual({ activated: 1 });
    // Without a creature card it could pay for, it can't be activated.
    const poor = looterGame(['Shivan Dragon'], 3);
    expect(maxAbilityX(poor, 0, looter(poor), { activated: 1 })).toBe(-1);
    expect(activatable(poor, 0, looter(poor))).not.toContainEqual({ activated: 1 });
    // Not on an opponent's turn.
    g = produce(g, (d) => {
      d.active = 1;
    });
    expect(activatable(g, 0, looter(g))).not.toContainEqual({ activated: 1 });
  });

  it('a bot tries the values of X that have a target, and picks the best copy', () => {
    const g = looterGame(['Shivan Dragon', 'Elite Vanguard']);
    expect(botAction(g, 0)).toMatchObject({ type: 'activate', card: looter(g).id, activated: 1, x: 6, targets: [ref(byName(g, 0, 'Shivan Dragon', 'graveyard')!)] });
  });

  it('does nothing if the card has left the graveyard by the time it resolves (608.2b)', () => {
    let g = looterGame(['Shivan Dragon']);
    g = runWith(byHand, g, { type: 'activate', card: looter(g).id, activated: 1, x: 6, targets: [ref(byName(g, 0, 'Shivan Dragon', 'graveyard')!)] });
    g = produce(g, (d) => moveCard(d, byName(d, 0, 'Shivan Dragon', 'graveyard')!, 'exile'));
    g = runWith(byHand, g, pass, pass, pass, pass);
    expect(looter(g).copy).toBeNull();
    expect(stats(g, looter(g)).power).toBe(1);
  });
});

describe('the copy effect has its own timestamp (613.7a, 613.7b)', () => {
  it("static abilities it gets from the copy effect take the copy effect's timestamp, not the permanent's", () => {
    // The Looter came first, then the Grower ("creatures you control have base P/T 4/4").
    // The Looter then becomes a copy of the Shrinker (base 1/1): that effect is later, so it wins.
    let g = looterGame(['Test Copy Shrinker'], 6, (d) => {
      const grower = put(d, 0, 'Test Copy Grower');
      grower.ts = d.nextId++;
    });
    expect(stats(g, looter(g)).power).toBe(4);
    g = becomeCopyOf(g, 'Test Copy Shrinker', 1);
    for (const c of [looter(g), byName(g, 0, 'Test Copy Grower')!]) expect([stats(g, c).power, stats(g, c).toughness]).toEqual([1, 1]);
    expect(looter(g).copyTs).toBeGreaterThan(byName(g, 0, 'Test Copy Grower')!.ts);
  });
});
