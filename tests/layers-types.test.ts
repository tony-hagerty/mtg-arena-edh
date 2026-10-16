// Layers 4 and 5 (613.1d-e): card types, subtypes and colours, and the rules that change them:
// losing a card type (205.1a), subtypes that must go with a card type (205.3d), changeling,
// devoid and impending.
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { registerCards } from '../src/cards/db';
import {
  addContinuous,
  applyAction,
  applyBotAction,
  attach,
  botAction,
  canAttack,
  colorsOf,
  counterCount,
  creaturesOf,
  hasType,
  impending,
  isCreature,
  makeCard,
  scriptOf,
  searchable,
  stats,
  subtypesOf,
} from '../src/engine';
import type { Action, CardData, Game, PlayerId } from '../src/engine';
import { registerScripts } from '../src/engine/registry';
import './fixtures';
import { byName, emptyGame, put, run } from './helpers';

/** A made-up card, for wording no card in the pool has yet. */
function fake(name: string, typeLine: string, extra: Partial<CardData> = {}): CardData {
  return { name, manaCost: '{1}', cmc: 1, colors: [], colorIdentity: [], typeLine, oracleText: '', keywords: [], image: '', art: '', ...extra };
}

registerCards({
  'Test Time Lord': fake('Test Time Lord', 'Creature — Time Lord Wizard', { power: '1', toughness: '1' }),
  'Test Pirate': fake('Test Pirate', 'Creature — Human Pirate', { power: '1', toughness: '1' }),
  'Test Changeling': fake('Test Changeling', 'Creature — Shapeshifter', { power: '1', toughness: '1', keywords: ['Changeling'] }),
  // Printed colours that a devoid card's mana cost would give it, to show devoid wins (702.114a).
  'Test Devoid': fake('Test Devoid', 'Creature — Eldrazi', { manaCost: '{1}{B}', colors: ['B'], power: '1', toughness: '1', keywords: ['Devoid'] }),
  // Overlord of the Floodpits' impending, with a smaller N to keep the test short.
  'Test Overlord': fake('Test Overlord', 'Enchantment Creature — Avatar Horror', {
    manaCost: '{3}{U}{U}',
    cmc: 5,
    colors: ['U'],
    power: '5',
    toughness: '3',
    keywords: ['Impending', 'Flying'],
    oracleText: "Impending 2—{1}{U} (If you cast this spell for its impending cost, it enters with two time counters and isn't a creature until the last is removed. At the beginning of your end step, remove a time counter from it.)\nFlying",
  }),
});
registerScripts({ 'Test Overlord': { ...impending(2, '{1}{U}') } });

const pass = { type: 'pass' } as const;

/** Passes, bots acting as they like, until `stop` holds. */
function until(g: Game, stop: (g: Game) => boolean): Game {
  for (let i = 0; i < 400 && !stop(g); i++) g = g.decision ? applyBotAction(g, botAction(g, g.priority)) : applyAction(g, pass);
  return g;
}
/** Replaces a player's library with these cards, the first on top. */
function top(g: Game, pid: PlayerId, names: string[]) {
  g.players[pid].library = names.map((n) => makeCard(g, n, pid, 'library'));
}
const plenty = Array.from({ length: 10 }, () => 'Island');
const cast = (g: Game, name: string, extra: object = {}): Action => ({ type: 'cast', card: byName(g, 0, name, 'hand')!.id, ...extra });

describe('types are whole words (205.3b)', () => {
  it('a Pirate is not a Rat, and "Basic Land" asks for both words', () => {
    const g = emptyGame((d) => {
      put(d, 0, 'Test Pirate');
      put(d, 0, 'Plains');
      put(d, 0, 'Sol Ring');
    });
    const pirate = byName(g, 0, 'Test Pirate')!;
    expect(hasType(g, pirate, 'Pirate')).toBe(true);
    expect(hasType(g, pirate, 'Rat')).toBe(false);
    expect(hasType(g, byName(g, 0, 'Plains')!, 'Basic Land')).toBe(true);
    expect(hasType(g, byName(g, 0, 'Sol Ring')!, 'Basic Land')).toBe(false);
  });

  it('Time Lord is one creature type, and a Time Lord is not a Lord', () => {
    const g = emptyGame((d) => void put(d, 0, 'Test Time Lord'));
    const doctor = byName(g, 0, 'Test Time Lord')!;
    expect(subtypesOf(g, doctor)).toEqual(['Time Lord', 'Wizard']);
    expect(hasType(g, doctor, 'Time Lord')).toBe(true);
    expect(hasType(g, doctor, 'Lord')).toBe(false);
  });
});

describe('changeling (702.73a)', () => {
  it('is every creature type, Time Lord included, and a search for a creature type finds it in the library', () => {
    const g = emptyGame((d) => {
      put(d, 0, 'Test Changeling');
      put(d, 0, 'Test Changeling', 'library');
    });
    const onField = byName(g, 0, 'Test Changeling')!;
    for (const t of ['Shapeshifter', 'Wizard', 'Rat', 'Time Lord']) expect(hasType(g, onField, t)).toBe(true);
    // A characteristic-defining ability works in every zone (604.3).
    expect(searchable(g, byName(g, 0, 'Test Changeling', 'library')!, { subtypes: ['Wizard'], label: 'a Wizard card' })).toBe(true);
    expect(searchable(g, byName(g, 0, 'Test Changeling', 'library')!, { subtypes: ['Swamp'], label: 'a Swamp card' })).toBe(false);
  });
});

describe('losing and getting back a card type (205.1a, 205.3d)', () => {
  it('a reconfigured Lion Sash loses Cat; an effect that makes it a creature again brings Cat back', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Lion Sash');
      put(d, 0, 'Llanowar Elves');
    });
    // Attached: not a creature, so not a Cat (702.151b), still Equipment.
    g = produceWith(g, (x) => attach(x, byName(x, 0, 'Lion Sash')!, byName(x, 0, 'Llanowar Elves')!));
    let sash = byName(g, 0, 'Lion Sash')!;
    expect(isCreature(g, sash)).toBe(false);
    expect(subtypesOf(g, sash)).toEqual(['Equipment']);
    // A later effect: "becomes an artifact creature" keeps its other types (205.1b), and the
    // creature type it gets back brings Cat back with it.
    g = produceWith(g, (x) => addContinuous(x, byName(x, 0, 'Lion Sash')!, { types: ['Creature'] }, 'turn'));
    sash = byName(g, 0, 'Lion Sash')!;
    expect(isCreature(g, sash)).toBe(true);
    expect(subtypesOf(g, sash)).toEqual(['Equipment', 'Cat']);
  });

  it('losing the artifact type takes Equipment with it; a noncreature can\'t become a Wizard, a nonland can\'t become a Swamp', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Lion Sash');
      put(d, 0, 'Sol Ring');
    });
    g = produceWith(g, (x) => {
      addContinuous(x, byName(x, 0, 'Lion Sash')!, { notTypes: ['Artifact'] });
      addContinuous(x, byName(x, 0, 'Sol Ring')!, { subtypes: ['Wizard', 'Swamp', 'Equipment'] });
    });
    const sash = byName(g, 0, 'Lion Sash')!;
    expect(hasType(g, sash, 'Artifact')).toBe(false);
    expect(subtypesOf(g, sash)).toEqual(['Cat']);
    // Equipment goes with artifacts, so Sol Ring can have it; the others it can't gain (205.3d).
    expect(subtypesOf(g, byName(g, 0, 'Sol Ring')!)).toEqual(['Equipment']);
  });
});

describe('colour (layer 5)', () => {
  it('devoid is colorless whatever its mana cost, and a colour-setting effect still makes it black (613.3)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Test Devoid');
      put(d, 0, 'Test Devoid', 'hand');
    });
    expect(colorsOf(g, byName(g, 0, 'Test Devoid')!)).toEqual([]);
    expect(colorsOf(g, byName(g, 0, 'Test Devoid', 'hand')!)).toEqual([]);
    g = produceWith(g, (x) => addContinuous(x, byName(x, 0, 'Test Devoid')!, { colors: ['B'] }, 'turn'));
    expect(colorsOf(g, byName(g, 0, 'Test Devoid')!)).toEqual(['B']);
  });

  it("Plaza of Heroes adds a colour a legendary permanent has now, not its printed one", () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Plaza of Heroes');
      put(d, 0, 'Lyra Dawnbringer');
    });
    const any = scriptOf('Plaza of Heroes').mana as { colors: unknown }[];
    const among = any[2].colors as (g: Game, self: unknown) => string[];
    expect(among(g, byName(g, 0, 'Plaza of Heroes')!)).toEqual(['W']);
    g = produceWith(g, (x) => addContinuous(x, byName(x, 0, 'Lyra Dawnbringer')!, { colors: ['B'] }, 'turn'));
    expect(among(g, byName(g, 0, 'Plaza of Heroes')!)).toEqual(['B']);
  });

  it('Helm of the Ghastlord sees a creature that became black: +1/+1 for black only', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Llanowar Elves');
      put(d, 0, 'Helm of the Ghastlord');
    });
    g = produceWith(g, (x) => attach(x, byName(x, 0, 'Helm of the Ghastlord')!, byName(x, 0, 'Llanowar Elves')!));
    expect(stats(g, byName(g, 0, 'Llanowar Elves')!).power).toBe(1);
    g = produceWith(g, (x) => addContinuous(x, byName(x, 0, 'Llanowar Elves')!, { colors: ['B'] }, 'turn'));
    expect(stats(g, byName(g, 0, 'Llanowar Elves')!).power).toBe(2);
  });
});

describe('impending (702.176)', () => {
  const setup = () =>
    emptyGame((d) => {
      put(d, 0, 'Island', 'battlefield', 5);
      put(d, 0, 'Test Overlord', 'hand');
      top(d, 0, plenty);
      top(d, 1, plenty);
      top(d, 2, plenty);
      top(d, 3, plenty);
    });

  it("cast for its impending cost, it enters with N time counters and isn't a creature until the last is removed", () => {
    let g = setup();
    g = until(run(g, cast(g, 'Test Overlord', { alt: 0 })), (x) => !x.stack.length);
    let overlord = byName(g, 0, 'Test Overlord')!;
    expect(counterCount(overlord, 'time')).toBe(2);
    expect(isCreature(g, overlord)).toBe(false);
    // It stops being a creature, so its creature types go too (205.1a).
    expect(subtypesOf(g, overlord)).toEqual([]);
    expect(hasType(g, overlord, 'Enchantment')).toBe(true);
    expect(creaturesOf(g, 0)).toHaveLength(0);
    // Your end step removes one; an opponent's doesn't.
    g = until(g, (x) => x.active === 1);
    expect(counterCount(byName(g, 0, 'Test Overlord')!, 'time')).toBe(1);
    g = until(g, (x) => x.active === 0);
    expect(counterCount(byName(g, 0, 'Test Overlord')!, 'time')).toBe(1);
    // The second end step removes the last: a creature again, with its types.
    g = until(g, (x) => x.active === 1);
    overlord = byName(g, 0, 'Test Overlord')!;
    expect(counterCount(overlord, 'time')).toBe(0);
    expect(isCreature(g, overlord)).toBe(true);
    expect(subtypesOf(g, overlord)).toEqual(['Avatar', 'Horror']);
    // Under its controller's control since their last turn began, so it can attack then (302.6).
    g = until(g, (x) => x.active === 0 && x.step === 'main1');
    expect(canAttack(g, byName(g, 0, 'Test Overlord')!)).toBe(true);
  });

  it('cast for its mana cost, it is a creature, and time counters put on it later change nothing', () => {
    let g = setup();
    g = until(run(g, cast(g, 'Test Overlord')), (x) => !x.stack.length);
    expect(counterCount(byName(g, 0, 'Test Overlord')!, 'time')).toBe(0);
    g = produceWith(g, (x) => void (byName(x, 0, 'Test Overlord')!.counters.time = 3));
    const overlord = byName(g, 0, 'Test Overlord')!;
    expect(isCreature(g, overlord)).toBe(true);
    g = until(g, (x) => x.active === 1);
    expect(counterCount(byName(g, 0, 'Test Overlord')!, 'time')).toBe(3);
  });
});

/** Changes a game the way an effect would, outside any action. */
function produceWith(g: Game, change: (draft: Game) => void): Game {
  return produce(g, change);
}
