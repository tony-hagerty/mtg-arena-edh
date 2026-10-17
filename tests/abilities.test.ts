// Layer 6 (613.1f): abilities that effects give and take away, and what a permanent can do
// with the abilities it has now.
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { registerCards } from '../src/cards/db';
import {
  CANT_ATTACK,
  abilitiesOf,
  activatable,
  addContinuous,
  addCounters,
  addLasting,
  characteristics,
  checkState,
  creaturesOf,
  destroy,
  enterBattlefield,
  gainLife,
  isCreature,
  manaAbilities,
  refPlayer,
  stats,
  untilEndOfTurn,
  wardCosts,
} from '../src/engine';
import type { Card, CardData, Game } from '../src/engine';
import { registerScripts } from '../src/engine/registry';
import './fixtures';
import { byName, emptyGame, put, run } from './helpers';

/** A made-up card, for wording no card in the pool has yet. */
function fake(name: string, typeLine: string, oracleText: string, extra: Partial<CardData> = {}): CardData {
  return { name, manaCost: '{1}', cmc: 1, colors: [], colorIdentity: [], typeLine, oracleText, keywords: [], image: '', art: '', ...extra };
}

registerCards({
  // Humility's wording.
  'Test Humility': fake('Test Humility', 'Enchantment', 'All creatures lose all abilities and have base power and toughness 1/1.'),
  'Test Unmarked Humility': fake('Test Unmarked Humility', 'Enchantment', 'All creatures lose all abilities.'),
  'Test Captain': fake('Test Captain', 'Creature — Angel', 'Flying\nOther creatures you control get +1/+1.', { power: '2', toughness: '2', keywords: ['Flying'] }),
  'Test Wingmaker': fake('Test Wingmaker', 'Creature — Bird', 'Other creatures you control have flying.', { power: '1', toughness: '1' }),
  'Test Herald': fake('Test Herald', 'Creature — Human', 'This creature enters tapped and with a +1/+1 counter on it.\nWhen this creature enters, you gain 3 life.', { power: '1', toughness: '1' }),
  // Tarmogoyf's shape: */1+*.
  'Test Goyf': fake('Test Goyf', 'Creature — Lhurgoyf', "This creature's power is equal to 3 and its toughness is equal to 4.", { power: '*', toughness: '1+*' }),
  'Test Healer': fake('Test Healer', 'Creature — Cleric', '{T}: You gain 1 life.', { power: '1', toughness: '1' }),
  'Test Mourner': fake('Test Mourner', 'Creature — Spirit', 'When this creature dies, you gain 2 life.', { power: '1', toughness: '1' }),
  // Curious Colossus's wording, on a sorcery so the test needn't cast a creature.
  'Test Colossus': fake('Test Colossus', 'Sorcery', 'Each creature target opponent controls loses all abilities, becomes a Coward in addition to its other types, and has base power and toughness 1/1.'),
});
registerScripts({
  'Test Humility': {
    removesAbilities: true,
    static: (g, _self, c) => (isCreature(g, c) ? { loseAll: true, setPower: 1, setToughness: 1 } : null),
  },
  'Test Unmarked Humility': { static: (g, _self, c) => (isCreature(g, c) ? { loseAll: true } : null) },
  'Test Captain': { static: (g, self, c) => (c.id !== self.id && c.controller === self.controller && isCreature(g, c) ? { power: 1, toughness: 1 } : null) },
  'Test Wingmaker': { static: (g, self, c) => (c.id !== self.id && c.controller === self.controller && isCreature(g, c) ? { keywords: ['flying'] } : null) },
  'Test Herald': {
    entersTapped: true,
    entersWith: { '+1/+1': 1 },
    onEnter: (g, { you }) => gainLife(g, you, 3),
  },
  'Test Goyf': { basePT: () => ({ power: 3, toughness: 4 }) },
  'Test Healer': { activated: { cost: { tap: true }, text: 'You gain 1 life.', resolve: (g, { you }) => gainLife(g, you, 1) } },
  'Test Mourner': { onDies: (g, { you }) => gainLife(g, you, 2) },
  'Test Colossus': {
    targets: [{ type: 'player', who: 'opponent', label: 'target opponent' }],
    // The creatures are the ones that player controls as it resolves (611.2c), for good (611.2a).
    onResolve: (g, { targets }) => {
      const p = refPlayer(g, targets[0]);
      for (const c of p ? creaturesOf(g, p.id) : []) addLasting(g, c, { loseAll: true, subtypes: ['Coward'], setPower: 1, setToughness: 1 });
    },
  },
});

const pt = (g: Game, c: Card) => `${stats(g, c).power}/${stats(g, c).toughness}`;
const kw = (g: Game, c: Card) => [...stats(g, c).keywords];

describe('losing all abilities (113.10, 613.1f)', () => {
  it('takes its printed keywords and the abilities effects gave it before, but not ones given after', () => {
    let g = emptyGame((d) => {
      const angel = put(d, 0, 'Serra Angel');
      untilEndOfTurn(d, angel, { keywords: ['haste'] });
      addCounters(d, angel, 1, 'lifelink');
    });
    const angel = () => byName(g, 0, 'Serra Angel')!;
    expect(kw(g, angel()).sort()).toEqual(['flying', 'haste', 'lifelink', 'vigilance']);
    g = produce(g, (d) => untilEndOfTurn(d, byName(d, 0, 'Serra Angel'), { loseAll: true }));
    expect(kw(g, angel())).toEqual([]);
    // A later effect, and a keyword counter put on later (613.7c), give abilities back.
    g = produce(g, (d) => {
      untilEndOfTurn(d, byName(d, 0, 'Serra Angel'), { keywords: ['trample'] });
      addCounters(d, byName(d, 0, 'Serra Angel'), 1, 'lifelink');
    });
    expect(kw(g, angel()).sort()).toEqual(['lifelink', 'trample']);
  });

  it("doesn't take restrictions or designations, which aren't abilities (113.12, 701.64b)", () => {
    const g = emptyGame((d) => {
      const c = put(d, 0, 'Elite Vanguard');
      untilEndOfTurn(d, c, { keywords: [CANT_ATTACK] });
      addLasting(d, c, { flags: ['harnessed', 'urza mana'] });
      untilEndOfTurn(d, c, { loseAll: true });
    });
    const ch = characteristics(g, byName(g, 0, 'Elite Vanguard')!);
    expect(ch.keywords).toEqual([CANT_ATTACK]);
    expect(ch.flags).toEqual(['harnessed']);
  });

  it('stops its static abilities: an effect from one that is lost stops applying to others', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Test Captain');
      put(d, 0, 'Test Wingmaker');
      put(d, 0, 'Elite Vanguard');
    });
    const vanguard = () => byName(g, 0, 'Elite Vanguard')!;
    expect(pt(g, vanguard())).toBe('3/2');
    expect(kw(g, vanguard())).toEqual(['flying']);
    g = produce(g, (d) => {
      untilEndOfTurn(d, byName(d, 0, 'Test Captain'), { loseAll: true });
      untilEndOfTurn(d, byName(d, 0, 'Test Wingmaker'), { loseAll: true });
    });
    expect(pt(g, vanguard())).toBe('2/1');
    // The Wingmaker's flying is gone though it was given before the Wingmaker lost the ability
    // that gives it: that effect depends on the one that took the ability away (613.8a).
    expect(kw(g, vanguard())).toEqual([]);
    expect(kw(g, byName(g, 0, 'Test Captain')!)).toEqual([]);
  });

  it("takes a characteristic-defining ability: Tarmogoyf's shape is then 0/1 (604.3, 613.4a)", () => {
    let g = emptyGame((d) => void put(d, 0, 'Test Goyf'));
    expect(pt(g, byName(g, 0, 'Test Goyf')!)).toBe('3/4');
    g = produce(g, (d) => untilEndOfTurn(d, byName(d, 0, 'Test Goyf'), { loseAll: true }));
    expect(pt(g, byName(g, 0, 'Test Goyf')!)).toBe('0/1');
  });

  it("takes activated and triggered abilities, but one already on the stack still resolves (113.7a)", () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Test Healer');
      put(d, 0, 'Test Mourner');
    });
    const healer = byName(g, 0, 'Test Healer')!;
    expect(activatable(g, 0, healer)).toEqual([{ activated: 0 }]);
    g = run(g, { type: 'activate', card: healer.id, activated: 0, hold: true });
    g = produce(g, (d) => untilEndOfTurn(d, byName(d, 0, 'Test Healer'), { loseAll: true }));
    expect(activatable(g, 0, byName(g, 0, 'Test Healer')!)).toEqual([]);
    const life = g.players[0].life;
    g = run(g, { type: 'pass' });
    expect(g.players[0].life).toBe(life + 1);
    // A "dies" ability it has lost doesn't trigger: it looks back at a creature without it (603.10a).
    g = produce(g, (d) => {
      untilEndOfTurn(d, byName(d, 0, 'Test Mourner'), { loseAll: true });
      destroy(d, byName(d, 0, 'Test Mourner'));
    });
    expect(g.triggers.filter((t) => t.card.name === 'Test Mourner')).toEqual([]);
  });

  it('takes mana abilities, a basic land type\'s too (305.6)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Forest');
      put(d, 0, 'Llanowar Elves');
    });
    expect(manaAbilities(g, byName(g, 0, 'Forest')!)).toHaveLength(1);
    expect(manaAbilities(g, byName(g, 0, 'Llanowar Elves')!)).toHaveLength(1);
    g = produce(g, (d) => {
      untilEndOfTurn(d, byName(d, 0, 'Forest'), { loseAll: true });
      untilEndOfTurn(d, byName(d, 0, 'Llanowar Elves'), { loseAll: true });
    });
    expect(manaAbilities(g, byName(g, 0, 'Forest')!)).toEqual([]);
    expect(manaAbilities(g, byName(g, 0, 'Llanowar Elves')!)).toEqual([]);
  });

  it("takes triggered abilities other permanents give it, unless they're given later (613.7a)", () => {
    // Isilu's "each other nontoken creature you control has persist", before and after.
    let g = emptyGame((d) => {
      put(d, 0, 'Eirdu, Carrier of Dawn // Isilu, Carrier of Twilight').face = 1;
      untilEndOfTurn(d, put(d, 0, 'Elite Vanguard'), { loseAll: true });
    });
    const persists = (x: Game) => {
      const next = produce(x, (d) => destroy(d, byName(d, 0, 'Elite Vanguard')));
      return next.triggers.some((t) => t.card.name === 'Elite Vanguard' && t.hook === 'onDies');
    };
    // Isilu was there first, so its effect has the earlier timestamp.
    expect(persists(g)).toBe(false);
    g = produce(g, (d) => {
      const isilu = byName(d, 0, 'Eirdu, Carrier of Dawn // Isilu, Carrier of Twilight')!;
      isilu.ts = d.nextId++;
    });
    expect(persists(g)).toBe(true);
  });

  it('takes ward, its own and any given (702.21)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Hexing Squelcher');
      put(d, 0, 'Elite Vanguard');
    });
    expect(wardCosts(g, byName(g, 0, 'Hexing Squelcher')!)).toEqual([{ life: 2 }]);
    expect(wardCosts(g, byName(g, 0, 'Elite Vanguard')!)).toEqual([{ life: 2 }]);
    g = produce(g, (d) => {
      untilEndOfTurn(d, byName(d, 0, 'Hexing Squelcher'), { loseAll: true });
      untilEndOfTurn(d, byName(d, 0, 'Elite Vanguard'), { loseAll: true });
    });
    expect(wardCosts(g, byName(g, 0, 'Hexing Squelcher')!)).toEqual([]);
    expect(wardCosts(g, byName(g, 0, 'Elite Vanguard')!)).toEqual([]);
  });

  it("a Saga that lost its chapter abilities isn't sacrificed and doesn't trigger (714.2d, 714.4)", () => {
    let g = emptyGame((d) => {
      const saga = put(d, 0, "Urza's Saga");
      saga.counters.lore = 3;
      untilEndOfTurn(d, saga, { loseAll: true });
    });
    g = produce(g, (d) => {
      addCounters(d, byName(d, 0, "Urza's Saga"), 1, 'lore');
      checkState(d);
    });
    expect(byName(g, 0, "Urza's Saga")).toBeTruthy();
    expect(g.triggers).toEqual([]);
  });
});

describe("Curious Colossus's wording", () => {
  it('each creature the opponent controls loses all abilities, becomes a Coward and has base 1/1; a later creature is untouched (611.2c)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Test Colossus', 'hand');
      put(d, 0, 'Plains');
      put(d, 1, 'Test Captain');
      put(d, 1, 'Serra Angel');
      addCounters(d, byName(d, 1, 'Serra Angel'), 1);
    });
    g = run(g, { type: 'cast', card: byName(g, 0, 'Test Colossus', 'hand')!.id, targets: [{ kind: 'player', id: 1 }] });
    const captain = byName(g, 1, 'Test Captain')!;
    const angel = byName(g, 1, 'Serra Angel')!;
    expect(characteristics(g, captain).typeLine).toBe('Creature — Angel Coward');
    // 1/1 in layer 7b, then the counter in 7c; the Captain's +1/+1 is gone with its ability.
    expect(pt(g, captain)).toBe('1/1');
    expect(pt(g, angel)).toBe('2/2');
    expect(kw(g, angel)).toEqual([]);
    g = produce(g, (d) => void put(d, 1, 'Elite Vanguard'));
    expect(pt(g, byName(g, 1, 'Elite Vanguard')!)).toBe('2/1');
  });
});

describe('a static ability that takes abilities away (Humility)', () => {
  it("works with timestamps: Humility's 1/1 then a later +1/+1, and its loss of abilities against later gains", () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Test Captain');
      put(d, 0, 'Elite Vanguard');
      put(d, 0, 'Test Humility');
    });
    // The Captain lost the ability that gave +1/+1, and its own flying.
    expect(pt(g, byName(g, 0, 'Elite Vanguard')!)).toBe('1/1');
    expect(kw(g, byName(g, 0, 'Test Captain')!)).toEqual([]);
    g = produce(g, (d) => untilEndOfTurn(d, byName(d, 0, 'Elite Vanguard'), { keywords: ['flying'] }));
    expect(kw(g, byName(g, 0, 'Elite Vanguard')!)).toEqual(['flying']);
  });

  it('a creature entering loses its abilities as it enters: no "enters" trigger (603.6b), and none of its own replacement effects (614.12)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Test Humility');
      put(d, 0, 'Test Herald', 'hand');
    });
    g = produce(g, (d) => enterBattlefield(d, byName(d, 0, 'Test Herald', 'hand')!));
    const herald = byName(g, 0, 'Test Herald')!;
    expect(herald.tapped).toBe(false);
    expect(herald.counters).toEqual({});
    expect(g.triggers).toEqual([]);
    // Without Humility, all three.
    g = emptyGame((d) => void put(d, 0, 'Test Herald', 'hand'));
    g = produce(g, (d) => enterBattlefield(d, byName(d, 0, 'Test Herald', 'hand')!));
    expect(byName(g, 0, 'Test Herald')!.tapped).toBe(true);
    expect(byName(g, 0, 'Test Herald')!.counters).toEqual({ '+1/+1': 1 });
    expect(g.triggers).toHaveLength(1);
  });

  it('must say it removes abilities, or the layer system throws', () => {
    const g = emptyGame((d) => {
      put(d, 0, 'Test Unmarked Humility');
      put(d, 0, 'Serra Angel');
    });
    expect(() => stats(g, byName(g, 0, 'Serra Angel')!)).toThrow(/removesAbilities/);
  });

  it('must come from addContinuous, or the layer system throws', () => {
    const g = emptyGame((d) => {
      put(d, 0, 'Serra Angel').continuous.push({ loseAll: true, ts: d.nextId++, until: 'leaves' });
    });
    expect(() => stats(g, byName(g, 0, 'Serra Angel')!)).toThrow(/addContinuous/);
  });
});

describe('losing one ability (113.10b)', () => {
  it('takes every instance of a keyword: printed, given and from a counter; a later one gives it back', () => {
    let g = emptyGame((d) => {
      const angel = put(d, 0, 'Serra Angel');
      untilEndOfTurn(d, angel, { keywords: ['flying'] });
      addCounters(d, angel, 1, 'flying');
      untilEndOfTurn(d, angel, { lose: ['flying'] });
    });
    expect(kw(g, byName(g, 0, 'Serra Angel')!)).toEqual(['vigilance']);
    g = produce(g, (d) => untilEndOfTurn(d, byName(d, 0, 'Serra Angel'), { keywords: ['flying'] }));
    expect(kw(g, byName(g, 0, 'Serra Angel')!).sort()).toEqual(['flying', 'vigilance']);
  });

  it("an Aura that loses its enchant ability stays on what it's attached to (303.4c)", () => {
    const host = (lose: boolean) => {
      const g = emptyGame((d) => {
        const ring = put(d, 0, 'Sol Ring');
        // As if it had been attached while the Sol Ring was a creature.
        const aura = put(d, 0, 'Curiosity');
        aura.attachedTo = ring.id;
        if (lose) addContinuous(d, aura, { lose: ['enchant'] });
        checkState(d);
      });
      const aura = byName(g, 0, 'Curiosity');
      return aura && aura.attachedTo === byName(g, 0, 'Sol Ring')!.id;
    };
    // "Enchant creature" doesn't allow an artifact: it goes to the graveyard (704.5m).
    expect(host(false)).toBeUndefined();
    expect(host(true)).toBe(true);
  });

  it('only abilities the engine can take away one by one', () => {
    const g = emptyGame((d) => untilEndOfTurn(d, put(d, 0, 'Serra Angel'), { lose: ['equip'] }));
    expect(() => stats(g, byName(g, 0, 'Serra Angel')!)).toThrow(/equip/);
  });
});

describe('abilitiesOf', () => {
  it('is the printed script while nothing takes abilities away', () => {
    const g = emptyGame((d) => void put(d, 0, 'Test Healer'));
    const c = byName(g, 0, 'Test Healer')!;
    expect(abilitiesOf(g, c).activated).toBeDefined();
  });
});
