// The layer system (613): continuous effects applied layer by layer in timestamp order, and
// the timestamps themselves (613.7).
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { DECKS, registerCards } from '../src/cards/db';
import {
  addContinuous,
  addCounters,
  applyAction,
  applyBotAction,
  botAction,
  attach,
  characteristics,
  checkState,
  destroy,
  enterTogether,
  hasType,
  isCreature,
  lastKnown,
  moveCard,
  newGame,
  pump,
  settled,
  stats,
  subtypesOf,
  timestampTogether,
  untilEndOfTurn,
} from '../src/engine';
import type { Card, CardData, Game } from '../src/engine';
import { registerScripts } from '../src/engine/registry';
import './fixtures';
import { byName, emptyGame, put, run } from './helpers';

/** A made-up card, for effects no card in the pool has yet. */
function fake(name: string, typeLine: string, oracleText: string, extra: Partial<CardData> = {}): CardData {
  return { name, manaCost: '{1}', cmc: 1, colors: [], colorIdentity: [], typeLine, oracleText, keywords: [], image: '', art: '', ...extra };
}

registerCards({
  // Avacyn, Angel of Hope's second ability on its own.
  'Test Guardian': fake('Test Guardian', 'Enchantment', 'Other permanents you control have indestructible.'),
  'Test Bulwark': fake('Test Bulwark', 'Enchantment', 'Creatures you control get +0/+2.'),
  // March of the Machines' wording, for 613.6's example.
  'Test March': fake('Test March', 'Enchantment', 'Each noncreature artifact is an artifact creature with base power and toughness 2/2.'),
  'Test Shrinker': fake('Test Shrinker', 'Enchantment', 'Creatures you control have base power and toughness 0/1.'),
  'Test Ogre': fake('Test Ogre', 'Creature — Ogre', '', { power: '2', toughness: '2' }),
  'Test Wall': fake('Test Wall', 'Creature — Wall', '', { power: '1', toughness: '3' }),
  'Test Small Lord': fake('Test Small Lord', 'Creature — Human', 'Creatures you control have base power and toughness 1/1.', { power: '2', toughness: '2' }),
  'Test Big Lord': fake('Test Big Lord', 'Creature — Giant', 'Creatures you control have base power and toughness 4/4.', { power: '2', toughness: '2' }),
  'Test Recall': fake('Test Recall', 'Sorcery', 'Return all creature cards from your graveyard to the battlefield.'),
  // For dependency (613.8).
  'Test Terraform': fake('Test Terraform', 'Enchantment', 'Each artifact is a land in addition to its other types.'),
  'Test Golem': fake('Test Golem', 'Artifact Creature — Golem', '', { power: '3', toughness: '3' }),
  'Test Unforging': fake('Test Unforging', 'Enchantment', "Each creature isn't an artifact."),
  'Test Stilling': fake('Test Stilling', 'Enchantment', "Each artifact isn't a creature."),
  'Test Mirror': fake('Test Mirror', 'Enchantment', "Creatures you control get +X/+0, where X is that creature's toughness."),
  'Test Echo': fake('Test Echo', 'Creature — Shapeshifter', 'This creature has base power and toughness X/X, where X is 1 plus the greatest power among other creatures you control.', {
    power: '0',
    toughness: '0',
  }),
  'Test Leveler': fake('Test Leveler', 'Enchantment', 'Creatures you control with power 2 or less have base power and toughness 4/4.'),
});
const baseFor = (power: number, toughness: number) => (g: Game, self: Card, c: Card) =>
  c.controller === self.controller && isCreature(g, c) ? { setPower: power, setToughness: toughness } : null;
registerScripts({
  'Test Guardian': { static: (_g, self, c) => (c.id !== self.id && c.controller === self.controller ? { keywords: ['indestructible'] } : null) },
  'Test Bulwark': { static: (g, self, c) => (c.controller === self.controller && isCreature(g, c) ? { toughness: 2 } : null) },
  'Test March': {
    static: (g, _self, c) => (hasType(g, c, 'Artifact') && !isCreature(g, c) ? { types: ['Creature'], setPower: 2, setToughness: 2 } : null),
  },
  'Test Shrinker': { static: (g, self, c) => (c.controller === self.controller && isCreature(g, c) ? { setPower: 0, setToughness: 1 } : null) },
  'Test Small Lord': { static: baseFor(1, 1) },
  'Test Big Lord': { static: baseFor(4, 4) },
  'Test Terraform': { static: (g, _self, c) => (hasType(g, c, 'Artifact') ? { types: ['Land'] } : null) },
  'Test Unforging': { static: (g, _self, c) => (isCreature(g, c) ? { notTypes: ['Artifact'] } : null) },
  'Test Stilling': { static: (g, _self, c) => (hasType(g, c, 'Artifact') ? { notTypes: ['Creature'] } : null) },
  'Test Mirror': { static: (g, self, c) => (c.controller === self.controller && isCreature(g, c) ? { power: stats(g, c).toughness } : null) },
  'Test Echo': {
    static: (g, self, c) => {
      if (c.id !== self.id) return null;
      const others = g.players[self.controller].battlefield.filter((x) => x.id !== self.id && isCreature(g, x));
      const x = 1 + Math.max(0, ...others.map((o) => stats(g, o).power));
      return { setPower: x, setToughness: x };
    },
  },
  'Test Leveler': {
    static: (g, self, c) => (c.controller === self.controller && isCreature(g, c) && stats(g, c).power <= 2 ? { setPower: 4, setToughness: 4 } : null),
  },
  'Test Recall': {
    onResolve: (g, { you }) => enterTogether(g, g.players[you].graveyard.filter((c) => isCreature(g, c)).map((card) => ({ card, opts: { controller: you } }))),
  },
});

const pt = (g: Game, name: string, pid = 0) => {
  const s = stats(g, byName(g, pid, name)!);
  return `${s.power}/${s.toughness}`;
};

describe('static abilities on noncreature permanents', () => {
  it('"other permanents you control have indestructible" covers artifacts and lands, not only creatures', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Test Guardian');
      put(d, 0, 'Sol Ring');
      put(d, 0, 'Plains');
      put(d, 0, 'Elite Vanguard');
      put(d, 1, 'Sol Ring');
    });
    for (const name of ['Sol Ring', 'Plains', 'Elite Vanguard']) expect(stats(g, byName(g, 0, name)!).keywords.has('indestructible')).toBe(true);
    expect(stats(g, byName(g, 0, 'Test Guardian')!).keywords.has('indestructible')).toBe(false);
    expect(stats(g, byName(g, 1, 'Sol Ring')!).keywords.has('indestructible')).toBe(false);
    g = produce(g, (d) => {
      destroy(d, byName(d, 0, 'Sol Ring'));
      destroy(d, byName(d, 1, 'Sol Ring'));
    });
    expect(byName(g, 0, 'Sol Ring')).toBeDefined();
    expect(byName(g, 1, 'Sol Ring')).toBeUndefined();
  });

  it('a keyword counter works on a noncreature permanent (122.1b)', () => {
    const g = emptyGame((d) => {
      addCounters(d, put(d, 0, 'Sol Ring'), 1, 'indestructible');
    });
    expect(stats(g, byName(g, 0, 'Sol Ring')!).keywords.has('indestructible')).toBe(true);
  });

  it('"creatures you control" leaves out an uncrewed Vehicle and takes in a crewed one (702.122a)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Test Bulwark');
      put(d, 0, 'Untethered Express');
    });
    expect(isCreature(g, byName(g, 0, 'Untethered Express')!)).toBe(false);
    expect(pt(g, 'Untethered Express')).toBe('4/4');
    g = produce(g, (d) => untilEndOfTurn(d, byName(d, 0, 'Untethered Express'), { types: ['Artifact', 'Creature'] }));
    expect(hasType(g, byName(g, 0, 'Untethered Express')!, 'Artifact Creature')).toBe(true);
    expect(pt(g, 'Untethered Express')).toBe('4/6');
  });
});

describe('layer 7 (613.4)', () => {
  it("613.5's Gray Ogre: 0/1, +4/+4, +0/+2 and a +1/+1 counter make it 5/8, in whatever order they came", () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Test Ogre');
    });
    const step = (fn: (d: Game) => void, expected: string) => {
      g = produce(g, fn);
      expect(pt(g, 'Test Ogre')).toBe(expected);
    };
    step((d) => addCounters(d, byName(d, 0, 'Test Ogre'), 1), '3/3');
    step((d) => pump(d, byName(d, 0, 'Test Ogre'), 4, 4), '7/7');
    step((d) => void put(d, 0, 'Test Bulwark'), '7/9');
    step((d) => untilEndOfTurn(d, byName(d, 0, 'Test Ogre'), { setPower: 0, setToughness: 1 }), '5/8');
  });

  it("613.4d's switches: each takes the values it finds, two cancel out, and a later +5/+0 goes to toughness", () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Test Wall');
    });
    g = produce(g, (d) => {
      const c = byName(d, 0, 'Test Wall')!;
      pump(d, c, 0, 1);
      untilEndOfTurn(d, c, { switchPT: true });
    });
    expect(pt(g, 'Test Wall')).toBe('4/1');
    g = produce(g, (d) => pump(d, byName(d, 0, 'Test Wall'), 5, 0));
    expect(pt(g, 'Test Wall')).toBe('4/6');
    g = produce(g, (d) => untilEndOfTurn(d, byName(d, 0, 'Test Wall'), { switchPT: true }));
    expect(pt(g, 'Test Wall')).toBe('6/4');
  });

  it('effects that set power and toughness apply in timestamp order: the latest wins (613.7)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Test Ogre');
      put(d, 0, 'Test Shrinker');
    });
    expect(pt(g, 'Test Ogre')).toBe('0/1');
    // A resolved effect after the static ability's source entered comes later.
    g = produce(g, (d) => untilEndOfTurn(d, byName(d, 0, 'Test Ogre'), { setPower: 3, setToughness: 3 }));
    expect(pt(g, 'Test Ogre')).toBe('3/3');
    // The static ability gets a new timestamp when its source enters again (613.7d).
    g = produce(g, (d) => {
      const s = byName(d, 0, 'Test Shrinker')!;
      moveCard(d, s, 'hand');
      moveCard(d, s, 'battlefield');
    });
    expect(pt(g, 'Test Ogre')).toBe('0/1');
  });

  it('a characteristic-defining ability applies first (613.4a), and can count what layer 4 made (Nightmare with Urborg)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Nightmare');
      put(d, 0, 'Plains', 'battlefield', 2);
    });
    expect(pt(g, 'Nightmare')).toBe('0/0');
    g = produce(g, (d) => {
      put(d, 0, 'Urborg, Tomb of Yawgmoth');
      addCounters(d, byName(d, 0, 'Nightmare'), 1);
    });
    expect(pt(g, 'Nightmare')).toBe('4/4');
    // A set P/T effect comes after the CDA whatever its timestamp (613.4b).
    g = produce(g, (d) => untilEndOfTurn(d, byName(d, 0, 'Nightmare'), { setPower: 1, setToughness: 1 }));
    expect(pt(g, 'Nightmare')).toBe('2/2');
  });

  it('leaving out effects with a duration, for what lasts', () => {
    const g = emptyGame((d) => {
      const c = put(d, 0, 'Test Ogre');
      pump(d, c, 3, 3);
      addContinuous(d, c, { power: 1 });
    });
    expect(stats(g, byName(g, 0, 'Test Ogre')!, { base: true })).toMatchObject({ power: 3, toughness: 2 });
    expect(pt(g, 'Test Ogre')).toBe('6/5');
  });
});

describe('one effect, several layers (613.6)', () => {
  it('an effect that makes noncreature artifacts 2/2 creatures sets the P/T of the ones it made creatures, though they are creatures by layer 7b', () => {
    const g = emptyGame((d) => {
      put(d, 0, 'Test March');
      put(d, 0, 'Sol Ring');
      put(d, 0, 'Lion Sash');
    });
    const ring = byName(g, 0, 'Sol Ring')!;
    expect(isCreature(g, ring)).toBe(true);
    expect(pt(g, 'Sol Ring')).toBe('2/2');
    // Lion Sash was a creature already, so the effect leaves it alone.
    expect(pt(g, 'Lion Sash')).toBe('1/1');
  });
});

describe('layer 4 (613.1d)', () => {
  it('a reconfigured Equipment stops being a creature and loses its creature types while attached (702.151b)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Lion Sash');
      put(d, 0, 'Elite Vanguard');
    });
    expect(subtypesOf(g, byName(g, 0, 'Lion Sash')!)).toEqual(['Equipment', 'Cat']);
    g = produce(g, (d) => attach(d, byName(d, 0, 'Lion Sash'), byName(d, 0, 'Elite Vanguard')));
    const sash = byName(g, 0, 'Lion Sash')!;
    expect(isCreature(g, sash)).toBe(false);
    expect(subtypesOf(g, sash)).toEqual(['Equipment']);
    expect(characteristics(g, sash).typeLine).toBe('Artifact — Equipment');
  });

  it("can't give a noncreature a creature type (205.3d)", () => {
    const g = emptyGame((d) => {
      addContinuous(d, put(d, 0, 'Sol Ring'), { subtypes: ['Spirit'] });
    });
    expect(subtypesOf(g, byName(g, 0, 'Sol Ring')!)).toEqual([]);
  });
});

describe('dependency (613.8)', () => {
  it("an effect waits for one that changes what it applies to: Urborg makes an artifact a Swamp once another effect made it a land, whichever came first", () => {
    for (const order of [
      ['Urborg, Tomb of Yawgmoth', 'Test Terraform'],
      ['Test Terraform', 'Urborg, Tomb of Yawgmoth'],
    ]) {
      const g = emptyGame((d) => {
        put(d, 0, 'Sol Ring');
        for (const name of order) put(d, 0, name);
      });
      expect(characteristics(g, byName(g, 0, 'Sol Ring')!).typeLine).toBe('Artifact Land — Swamp');
    }
  });

  it('an effect that changes what another does goes first, whatever the timestamps (613.8b)', () => {
    // Mirror adds the creature's toughness, so it waits for Bulwark's +0/+2 and the counter.
    for (const order of [
      ['Test Mirror', 'Test Bulwark'],
      ['Test Bulwark', 'Test Mirror'],
    ]) {
      let g = emptyGame((d) => {
        put(d, 0, 'Test Ogre');
        for (const name of order) put(d, 0, name);
      });
      expect(pt(g, 'Test Ogre')).toBe('6/4');
      g = produce(g, (d) => addCounters(d, byName(d, 0, 'Test Ogre'), 1));
      expect(pt(g, 'Test Ogre')).toBe('8/5');
    }
  });

  it('two effects that each change what the other applies to are a loop: timestamp order, and the second then no longer applies (613.8b)', () => {
    const typeLine = (order: string[]) => {
      const g = emptyGame((d) => {
        put(d, 0, 'Test Golem');
        for (const name of order) put(d, 0, name);
      });
      return characteristics(g, byName(g, 0, 'Test Golem')!).typeLine;
    };
    expect(typeLine(['Test Unforging', 'Test Stilling'])).toBe('Creature — Golem');
    // It stops being a creature and so loses its creature type (205.3m).
    expect(typeLine(['Test Stilling', 'Test Unforging'])).toBe('Artifact');
  });

  it("depends on an effect that changes another permanent it looks at: Echo's X counts the 4/4 the later Big Lord made", () => {
    for (const order of [
      ['Test Echo', 'Test Big Lord'],
      ['Test Big Lord', 'Test Echo'],
    ]) {
      const g = emptyGame((d) => {
        put(d, 0, 'Test Ogre');
        for (const name of order) put(d, 0, name);
      });
      expect(['Test Echo', 'Test Ogre', 'Test Big Lord'].map((n) => pt(g, n))).toEqual(['5/5', '4/4', '4/4']);
    }
  });

  it('in a loop, the one that goes first sees another permanent as it was before the rest of the loop applied', () => {
    // Leveler changes what Echo counts (the Ogre's power), and Echo changes whether Leveler
    // applies to Echo. Echo first: X is 1 plus the Ogre's 2, and 3 is too big for Leveler.
    // Leveler first: everything is 4/4, then Echo's X is 1 plus 4.
    const echo = (order: string[]) => {
      const g = emptyGame((d) => {
        put(d, 0, 'Test Ogre');
        for (const name of order) put(d, 0, name);
      });
      return [pt(g, 'Test Echo'), pt(g, 'Test Ogre')];
    };
    expect(echo(['Test Echo', 'Test Leveler'])).toEqual(['3/3', '4/4']);
    expect(echo(['Test Leveler', 'Test Echo'])).toEqual(['5/5', '4/4']);
  });

  it('effects that change nothing about each other keep timestamp order: the later base P/T wins', () => {
    const g = emptyGame((d) => {
      put(d, 0, 'Test Ogre');
      put(d, 0, 'Test Big Lord');
      put(d, 0, 'Test Small Lord');
    });
    expect(pt(g, 'Test Ogre')).toBe('1/1');
  });
});

describe('timestamps (613.7)', () => {
  it('a permanent gets a new one as it enters (613.7d), as it becomes attached (613.7e) and as it transforms (613.7g)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Bonesplitter');
      put(d, 0, 'Elite Vanguard');
      put(d, 0, 'Serra Angel');
    });
    const ts = (name: string) => byName(g, 0, name)!.ts;
    const first = ts('Bonesplitter');
    g = produce(g, (d) => attach(d, byName(d, 0, 'Bonesplitter'), byName(d, 0, 'Elite Vanguard')));
    expect(ts('Bonesplitter')).toBeGreaterThan(first);
    expect(ts('Bonesplitter')).toBeGreaterThan(ts('Serra Angel'));
    const attached = ts('Bonesplitter');
    g = produce(g, (d) => {
      const v = byName(d, 0, 'Elite Vanguard')!;
      moveCard(d, v, 'hand');
      moveCard(d, v, 'battlefield');
    });
    expect(ts('Elite Vanguard')).toBeGreaterThan(attached);
  });

  it('objects getting one at the same moment get them in APNAP order (613.7m)', () => {
    let g = emptyGame((d) => {
      put(d, 2, 'Sol Ring');
      put(d, 1, 'Sol Ring');
      put(d, 0, 'Sol Ring');
      d.active = 1;
    });
    g = produce(g, (d) => timestampTogether(d, [0, 1, 2].map((p) => byName(d, p, 'Sol Ring')!)));
    const [a, b, c] = [0, 1, 2].map((p) => byName(g, p, 'Sol Ring')!.ts);
    expect(b).toBeLessThan(c);
    expect(c).toBeLessThan(a);
  });

  it('a person chooses the order of their own permanents entering together; a bot keeps the listed order (613.7m)', () => {
    const recall = (human: boolean) => {
      let g = emptyGame((d) => {
        d.players[0].isBot = !human;
        put(d, 0, 'Plains');
        put(d, 0, 'Test Recall', 'hand');
        put(d, 0, 'Test Small Lord', 'graveyard');
        put(d, 0, 'Test Big Lord', 'graveyard');
        put(d, 0, 'Elite Vanguard');
      });
      return run(g, { type: 'cast', card: byName(g, 0, 'Test Recall', 'hand')!.id });
    };
    let g = recall(true);
    if (g.decision?.type !== 'chooseCards') throw new Error('no choice');
    expect(g.decision.choice.kind === 'pick' && g.decision.choice.ordered).toBe(true);
    expect(byName(g, 0, 'Test Big Lord', 'graveyard')).toBeDefined();
    // Big Lord's timestamp comes first, so Small Lord's 1/1 applies after it and wins (613.7).
    g = run(g, { type: 'chooseCards', cards: ['Test Big Lord', 'Test Small Lord'].map((n) => byName(g, 0, n, 'graveyard')!.id) });
    expect(['Test Small Lord', 'Test Big Lord', 'Elite Vanguard'].map((n) => pt(g, n))).toEqual(['1/1', '1/1', '1/1']);
    g = recall(true);
    g = run(g, { type: 'chooseCards', cards: ['Test Small Lord', 'Test Big Lord'].map((n) => byName(g, 0, n, 'graveyard')!.id) });
    expect(['Test Small Lord', 'Test Big Lord', 'Elite Vanguard'].map((n) => pt(g, n))).toEqual(['4/4', '4/4', '4/4']);
    // A bot isn't asked: the graveyard's order stands, Big Lord last.
    g = recall(false);
    expect(g.decision).toBeNull();
    expect(pt(g, 'Elite Vanguard')).toBe('4/4');
  });

  it('counters of a kind get the timestamp of the last one put on (613.7c)', () => {
    let g = emptyGame((d) => {
      addCounters(d, put(d, 0, 'Elite Vanguard'), 1);
    });
    const first = byName(g, 0, 'Elite Vanguard')!.counterTs!['+1/+1'];
    g = produce(g, (d) => addCounters(d, byName(d, 0, 'Elite Vanguard'), 1));
    expect(byName(g, 0, 'Elite Vanguard')!.counterTs!['+1/+1']).toBeGreaterThan(first);
  });
});

describe('durations (611.2)', () => {
  it('"until your next turn" ends as that turn begins; "for as long as" ends when that object leaves', () => {
    let g = emptyGame((d) => {
      const c = put(d, 0, 'Test Ogre');
      const ring = put(d, 0, 'Sol Ring');
      addContinuous(d, c, { power: 1 }, { nextTurnOf: 1 });
      addContinuous(d, c, { toughness: 1 }, 'leaves', { while: { id: ring.id, moves: ring.moves } });
    });
    expect(pt(g, 'Test Ogre')).toBe('3/3');
    g = produce(g, (d) => moveCard(d, byName(d, 0, 'Sol Ring')!, 'hand'));
    expect(pt(g, 'Test Ogre')).toBe('3/2');
    for (let i = 0; i < 100 && g.active === 0; i++) g = g.decision ? applyBotAction(g, botAction(g, g.priority)) : applyAction(g, { type: 'pass' });
    expect(g.active).toBe(1);
    expect(pt(g, 'Test Ogre')).toBe('2/2');
  });
});

describe('what the layers see', () => {
  it('answers change as the game does: inside one action, and from one state to the next', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Test Bulwark');
      put(d, 0, 'Untethered Express');
    });
    const express = () => byName(g, 0, 'Untethered Express')!;
    expect(isCreature(g, express())).toBe(false);
    g = produce(g, (d) => {
      const v = byName(d, 0, 'Untethered Express')!;
      expect(isCreature(d, v)).toBe(false);
      untilEndOfTurn(d, v, { types: ['Artifact', 'Creature'] });
      expect(isCreature(d, v)).toBe(true);
      expect(stats(d, v).toughness).toBe(6);
    });
    expect(isCreature(g, express())).toBe(true);
    g = produce(g, (d) => {
      byName(d, 0, 'Untethered Express')!.continuous = [];
      checkState(d);
    });
    expect(isCreature(g, express())).toBe(false);
    expect(stats(g, express()).toughness).toBe(4);
  });

  it('answers kept while a game stays the same are the answers worked out afresh', () => {
    let g = newGame({ seed: 7, seats: DECKS.slice(0, 4).map((deck) => ({ deck })) });
    const all = (x: Game) => x.players.flatMap((p) => p.battlefield);
    // Up to layer 4 only the types are settled.
    const each = (x: Game) => JSON.stringify(all(x).map((c) => [c.id, characteristics(x, c, '4').typeLine, characteristics(x, c)]));
    for (let i = 0; g.step !== 'gameOver' && i < 120; i++) {
      if (i % 10 === 0 && all(g).length) {
        // Inside a draft nothing is kept, so these are worked out afresh.
        let fresh = '';
        let held = '';
        produce(g, (d) => {
          fresh = each(d);
          held = settled(d, () => each(d) && each(d));
        });
        expect(held).toBe(fresh);
        // A finished state keeps its answers: the second time they are the kept ones.
        expect(each(g)).toBe(fresh);
        expect(each(g)).toBe(fresh);
      }
      g = applyBotAction(g, botAction(g, g.priority));
    }
  });

  it('remembers a permanent as it last was, with the effects of others that left with it (603.10a)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Test Bulwark');
      put(d, 0, 'Elite Vanguard');
    });
    const last = lastKnown(g, byName(g, 0, 'Elite Vanguard')!);
    g = produce(g, (d) => moveCard(d, byName(d, 0, 'Test Bulwark')!, 'graveyard'));
    expect(stats(g, last).toughness).toBe(3);
    expect(stats(g, byName(g, 0, 'Elite Vanguard')!).toughness).toBe(1);
  });
});
