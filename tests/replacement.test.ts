// Replacement and prevention effects (614, 615) and the order they apply in (616), with
// real cards: the pool's and test fixtures' (Notion Thief, Doubling Season, Hardened Scales,
// Rhox Faithmender, Rest in Peace, Daunting Defender).
import { describe, expect, it } from 'vitest';
import { applyAction, applyBotAction, botAction, hasFlag, makeCard } from '../src/engine';
import type { Action, Game, PlayerId, TargetRef } from '../src/engine';
import { byName, emptyGame, put, run } from './helpers';
import './fixtures';

const pass = { type: 'pass' } as const;
const player = (id: PlayerId): TargetRef => ({ kind: 'player', id });
const card = (c: { id: string }): TargetRef => ({ kind: 'card', id: c.id });
const cast = (g: Game, name: string, extra: object = {}, pid: PlayerId = 0): Action => ({ type: 'cast', card: byName(g, pid, name, 'hand')!.id, ...extra });
const human = (d: Game) => {
  d.players[0].isBot = false;
  d.players[0].you = true;
  d.players[0].name = 'You';
};
/** Fills a library with these cards, the first on top. */
const library = (g: Game, pid: PlayerId, names: string[]) => {
  g.players[pid].library = names.map((n) => makeCard(g, n, pid, 'library'));
};
const islands = Array.from({ length: 10 }, () => 'Island');
const logged = (g: Game, text: string) => g.log.some((l) => l.text === text);

/** Passes, bots acting as they like, until `stop` holds. */
function until(g: Game, stop: (g: Game) => boolean): Game {
  for (let i = 0; i < 400 && !stop(g); i++) g = g.decision ? applyBotAction(g, botAction(g, g.priority)) : applyAction(g, pass);
  return g;
}

describe('damage (614.1a, 615)', () => {
  it('applies each replacement effect once: two Furnaces of Rath make 2 damage 8, not more (614.5)', () => {
    let g = emptyGame((d) => {
      put(d, 1, 'Furnace of Rath');
      put(d, 2, 'Furnace of Rath');
      put(d, 0, 'Shock', 'hand');
      put(d, 0, 'Mountain');
    });
    g = run(g, cast(g, 'Shock', { targets: [player(3)] }));
    expect(g.players[3].life).toBe(40 - 8);
  });

  it("asks the damaged permanent's controller which applies first when the order matters (616.1e)", () => {
    let g = emptyGame((d) => {
      human(d);
      put(d, 0, 'Daunting Defender');
      put(d, 1, 'Furnace of Rath');
      put(d, 0, 'Lightning Bolt', 'hand');
      put(d, 0, 'Mountain');
    });
    const defender = byName(g, 0, 'Daunting Defender')!;
    g = run(g, cast(g, 'Lightning Bolt', { targets: [card(defender)] }));
    // Prevent 1 then double: 4. Double then prevent 1: 5. The least damage is listed first.
    expect(g.decision).toEqual({
      type: 'replacement',
      ask: {
        player: 0,
        text: 'Lightning Bolt would deal 3 damage to Daunting Defender. Choose which replacement effect applies first (616.1).',
        options: [
          { label: 'Daunting Defender', sub: '4 damage' },
          { label: 'Furnace of Rath', sub: '5 damage' },
        ],
      },
    });
    // The action waits for the answer, then is carried out with it: nothing has happened yet.
    expect(byName(g, 0, 'Lightning Bolt', 'hand')).toBeDefined();
    g = run(g, { type: 'replacement', option: 1 });
    expect(logged(g, 'You apply Furnace of Rath first.')).toBe(true);
    expect(logged(g, 'Lightning Bolt deals 5 damage to Daunting Defender.')).toBe(true);
    expect(byName(g, 0, 'Daunting Defender')).toBeUndefined();
  });

  it('lets a bot take the order that deals it the least damage, without asking', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Daunting Defender');
      put(d, 1, 'Furnace of Rath');
      put(d, 0, 'Lightning Bolt', 'hand');
      put(d, 0, 'Mountain');
    });
    g = run(g, cast(g, 'Lightning Bolt', { targets: [card(byName(g, 0, 'Daunting Defender')!)] }));
    expect(g.decision?.type).not.toBe('replacement');
    expect(logged(g, 'Lightning Bolt deals 4 damage to Daunting Defender.')).toBe(true);
  });

  it("doesn't ask when every order comes to the same damage", () => {
    let g = emptyGame((d) => {
      human(d);
      put(d, 1, 'Furnace of Rath');
      put(d, 2, 'Furnace of Rath');
      put(d, 1, 'Lightning Bolt', 'hand');
      put(d, 1, 'Mountain');
      d.priority = 1;
      d.active = 1;
    });
    g = run(g, cast(g, 'Lightning Bolt', { targets: [player(0)] }, 1));
    expect(g.decision?.type).not.toBe('replacement');
    expect(g.players[0].life).toBe(40 - 12);
  });
});

describe('zone changes', () => {
  it('Rest in Peace exiles a resolved spell and a dying creature instead, and "dies" abilities don\'t trigger', () => {
    let g = emptyGame((d) => {
      put(d, 1, 'Rest in Peace');
      put(d, 2, 'Blood Artist');
      put(d, 2, 'Serra Angel');
      put(d, 0, 'Lightning Bolt', 'hand', 2);
      put(d, 0, 'Mountain', 'battlefield', 2);
    });
    g = run(g, cast(g, 'Lightning Bolt', { targets: [card(byName(g, 2, 'Blood Artist')!)] }));
    expect(g.players[0].graveyard).toEqual([]);
    expect(g.players[0].exile.map((c) => c.name)).toEqual(['Lightning Bolt']);
    expect(g.players[2].exile.map((c) => c.name)).toEqual(['Blood Artist']);
    // Blood Artist didn't die, so it didn't trigger: nobody lost life.
    expect(g.players.map((p) => p.life)).toEqual([40, 40, 40, 40]);
  });

  it('Rest in Peace exiles all graveyards as it enters', () => {
    let g = emptyGame((d) => {
      put(d, 1, 'Shock', 'graveyard');
      put(d, 2, 'Serra Angel', 'graveyard');
      put(d, 0, 'Rest in Peace', 'hand');
      put(d, 0, 'Plains', 'battlefield', 2);
    });
    g = run(g, cast(g, 'Rest in Peace'));
    expect(g.players.flatMap((p) => p.graveyard)).toEqual([]);
    expect(g.players.flatMap((p) => p.exile).map((c) => c.name).sort()).toEqual(['Serra Angel', 'Shock']);
  });
});

describe('draws (614.11)', () => {
  it("Notion Thief: an opponent's draw is skipped and you draw instead", () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Notion Thief');
      put(d, 0, 'Jace Beleren', 'hand');
      put(d, 0, 'Island', 'battlefield', 3);
      for (const pid of [0, 1, 2, 3] as PlayerId[]) library(d, pid, islands);
    });
    g = run(g, cast(g, 'Jace Beleren'));
    // "+2: Each player draws a card": the three opponents' draws are yours.
    g = run(g, { type: 'activate', card: byName(g, 0, 'Jace Beleren')!.id, ability: 0 });
    expect(g.players.map((p) => p.hand.length)).toEqual([4, 0, 0, 0]);
    expect(g.players.map((p) => p.drawn)).toEqual([4, 0, 0, 0]);
  });

  it("Notion Thief leaves the first card an opponent draws in their draw step alone", () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Notion Thief');
      for (const pid of [0, 1, 2, 3] as PlayerId[]) library(d, pid, islands);
    });
    g = until(g, (x) => x.active === 1 && x.step === 'main1');
    expect(g.players[1].drawn).toBe(1);
    expect(g.players[0].hand).toEqual([]);
  });

  it('a replaced draw is replaced even with an empty library: nobody draws from an empty one (614.11)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Notion Thief');
      put(d, 0, 'Jace Beleren', 'hand');
      put(d, 0, 'Island', 'battlefield', 3);
      library(d, 0, islands);
      library(d, 1, []);
    });
    g = run(g, cast(g, 'Jace Beleren'));
    g = run(g, { type: 'activate', card: byName(g, 0, 'Jace Beleren')!.id, ability: 1, targets: [player(1)] });
    expect(g.players[1].lost).toBe(false);
    expect(g.players[0].hand).toHaveLength(1);
  });
});

describe('counters (614.16, 122.6)', () => {
  it('Doubling Season and Hardened Scales: the controller picks the order, 3 or 4 counters (616.1e)', () => {
    const setup = (asHuman: boolean) =>
      emptyGame((d) => {
        if (asHuman) human(d);
        put(d, 0, 'Doubling Season');
        put(d, 0, 'Hardened Scales');
        put(d, 0, "Ajani's Pridemate");
        put(d, 0, 'Angel of Mercy', 'hand');
        put(d, 0, 'Plains', 'battlefield', 5);
      });
    // Angel of Mercy's 3 life makes Ajani's Pridemate get a +1/+1 counter.
    let g = run(setup(true), cast(setup(true), 'Angel of Mercy'));
    expect(g.decision).toMatchObject({
      type: 'replacement',
      ask: {
        player: 0,
        options: [
          { label: 'Hardened Scales', sub: '4 +1/+1 counters' },
          { label: 'Doubling Season', sub: '3 +1/+1 counters' },
        ],
      },
    });
    g = run(g, { type: 'replacement', option: 1 });
    expect(byName(g, 0, "Ajani's Pridemate")!.counters['+1/+1']).toBe(3);
    // A bot takes the most.
    const bot = run(setup(false), cast(setup(false), 'Angel of Mercy'));
    expect(byName(bot, 0, "Ajani's Pridemate")!.counters['+1/+1']).toBe(4);
  });

  it('Doubling Season doubles the loyalty a planeswalker enters with, but not a loyalty cost', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Doubling Season');
      put(d, 0, 'Jace Beleren', 'hand');
      put(d, 0, 'Island', 'battlefield', 3);
      for (const pid of [0, 1, 2, 3] as PlayerId[]) library(d, pid, islands);
    });
    g = run(g, cast(g, 'Jace Beleren'));
    const jace = () => byName(g, 0, 'Jace Beleren')!;
    expect(jace().counters.loyalty).toBe(6);
    // +2 is a cost, not an effect (606.4).
    g = run(g, { type: 'activate', card: jace().id, ability: 0 });
    expect(jace().counters.loyalty).toBe(8);
  });

  it('Doubling Season: a Saga enters with two lore counters, and both chapters trigger (714.3a, 714.2b)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Doubling Season');
      put(d, 0, "Urza's Saga", 'hand');
    });
    g = run(g, { type: 'playLand', card: byName(g, 0, "Urza's Saga", 'hand')!.id });
    const saga = byName(g, 0, "Urza's Saga")!;
    expect(saga.counters.lore).toBe(2);
    // Chapters I and II both triggered and resolved: it has both abilities.
    expect(hasFlag(g, saga, 'urza mana')).toBe(true);
    expect(hasFlag(g, saga, 'urza construct')).toBe(true);
  });

  it("doesn't apply a permanent's own general effect to it as it enters (614.12)", () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Hardened Scales', 'hand');
      put(d, 0, 'Forest');
    });
    g = run(g, cast(g, 'Hardened Scales'));
    expect(byName(g, 0, 'Hardened Scales')!.counters).toEqual({});
  });
});

describe('tokens and life (614.16, 119.10)', () => {
  it('Doubling Season doubles tokens created under your control, not an opponent\'s', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Doubling Season');
      put(d, 0, 'Raise the Alarm', 'hand');
      put(d, 0, 'Plains', 'battlefield', 2);
    });
    g = run(g, cast(g, 'Raise the Alarm'));
    expect(g.players[0].battlefield.filter((c) => c.isToken)).toHaveLength(4);
  });

  it('Rhox Faithmender doubles life you gain', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Rhox Faithmender');
      put(d, 0, 'Angel of Mercy', 'hand');
      put(d, 0, 'Plains', 'battlefield', 5);
    });
    g = run(g, cast(g, 'Angel of Mercy'));
    expect(g.players[0].life).toBe(46);
  });
});
