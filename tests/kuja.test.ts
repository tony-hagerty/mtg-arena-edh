// The Kuja deck's hand scripts and the rules they needed: the clauses that could go wrong.
import { describe, expect, it } from 'vitest';
import { applyAction, applyBotAction, botAction, has, makeCard, stats } from '../src/engine';
import type { Action, Card, Game, PlayerId, TargetRef } from '../src/engine';
import { produce } from 'immer';
import { byName, emptyGame, put, run } from './helpers';

const pass = { type: 'pass' } as const;
const player = (id: PlayerId): TargetRef => ({ kind: 'player', id });
const card = (c: { id: string }): TargetRef => ({ kind: 'card', id: c.id });
const cast = (g: Game, name: string, extra: object = {}, zone: 'hand' | 'graveyard' | 'exile' = 'hand', pid: PlayerId = 0): Action => ({
  type: 'cast',
  card: byName(g, pid, name, zone)!.id,
  ...extra,
});

/** Passes priority (bots answering anything asked) until the stack is empty and nothing is being decided. */
function settle(g: Game, human?: (g: Game) => Action | null): Game {
  for (let i = 0; i < 120 && (g.decision || g.stack.length || g.triggers.length); i++) {
    const mine = human && g.priority === 0 && g.decision ? human(g) : null;
    g = mine ? run(g, mine) : g.decision ? applyBotAction(g, botAction(g, g.priority)) : applyAction(g, pass);
  }
  return g;
}

/** Passes until a decision for player 0 comes up, or the stack empties. */
function untilAsked(g: Game): Game {
  for (let i = 0; i < 60 && !(g.decision && g.priority === 0) && (g.stack.length || g.triggers.length || g.decision); i++) {
    g = g.decision ? applyBotAction(g, botAction(g, g.priority)) : applyAction(g, pass);
  }
  return g;
}

/** Passes, bots acting as they like, until `stop` holds. */
function until(g: Game, stop: (g: Game) => boolean): Game {
  for (let i = 0; i < 400 && !stop(g); i++) g = g.decision ? applyBotAction(g, botAction(g, g.priority)) : applyAction(g, pass);
  return g;
}

/** Replaces a player's library with these cards, the first on top. */
function top(g: Game, pid: PlayerId, names: string[]) {
  g.players[pid].library = names.map((n) => makeCard(g, n, pid, 'library'));
}
const names = (cards: { name: string }[]) => cards.map((c) => c.name).sort();
const plenty = Array.from({ length: 10 }, () => 'Mountain');
const wizards = (g: Game, pid: PlayerId) => g.players[pid].battlefield.filter((c) => c.name === 'Wizard 0/1 ping');
/** The decision waiting on player 0 now, by kind. */
const asked = (g: Game) => g.decision && 'choice' in g.decision ? (g.decision.choice as { kind: string; text?: string; cards?: string[] }) : null;

describe('Kuja, Genome Sorcerer', () => {
  it('makes a tapped Wizard at your end step, and transforms with four or more Wizards', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Kuja, Genome Sorcerer');
      put(d, 0, 'Wizard 0/1 ping', 'battlefield', 2).isToken = true;
      top(d, 0, plenty);
      top(d, 1, plenty);
    });
    g = until(g, (x) => x.active === 1);
    expect(wizards(g, 0)).toHaveLength(3);
    // The new one entered tapped (the bot may have attacked with the others).
    expect(wizards(g, 0)[2].tapped).toBe(true);
    // Kuja and three tokens are four Wizards.
    expect(byName(g, 0, 'Kuja, Genome Sorcerer')!.face).toBe(1);
  });

  it("doesn't transform with only three Wizards, and not on an opponent's end step", () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Kuja, Genome Sorcerer');
      put(d, 0, 'Wizard 0/1 ping').isToken = true;
      top(d, 0, plenty);
      top(d, 1, plenty);
    });
    g = until(g, (x) => x.active === 1);
    expect(wizards(g, 0)).toHaveLength(2);
    expect(byName(g, 0, 'Kuja, Genome Sorcerer')!.face).toBe(0);
    g = until(g, (x) => x.active === 2);
    expect(wizards(g, 0)).toHaveLength(2);
  });

  it('Trance Kuja doubles damage a Wizard you control deals, and only a Wizard', () => {
    let g = emptyGame((d) => {
      const k = put(d, 0, 'Kuja, Genome Sorcerer');
      k.face = 1;
      put(d, 0, 'Wizard 0/1 ping').isToken = true;
      put(d, 0, 'Lightning Bolt', 'hand');
      put(d, 0, 'Mountain');
    });
    g = settle(run(g, cast(g, 'Lightning Bolt', { targets: [player(1)] })));
    // The Wizard token's ping is doubled to 2; the Bolt isn't a Wizard, so 3.
    expect(g.players[1].life).toBe(40 - 2 - 3);
    expect(g.players[2].life).toBe(40 - 2);
  });
});

describe('damage', () => {
  it('Furnace of Rath doubles all damage, to anyone', () => {
    let g = emptyGame((d) => {
      put(d, 1, 'Furnace of Rath');
      put(d, 0, 'Lightning Bolt', 'hand');
      put(d, 0, 'Mountain');
    });
    g = settle(run(g, cast(g, 'Lightning Bolt', { targets: [player(2)] })));
    expect(g.players[2].life).toBe(34);
  });

  it('Collective Inferno doubles damage from your sources of the chosen type only', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Collective Inferno', 'hand');
      put(d, 0, 'Mountain', 'battlefield', 5);
      put(d, 0, 'Wizard 0/1 ping').isToken = true;
      put(d, 0, 'Lightning Bolt', 'hand');
      put(d, 0, 'Mountain');
      d.players[0].isBot = false;
    });
    g = untilAsked(run(g, cast(g, 'Collective Inferno')));
    expect(asked(g)?.kind).toBe('name');
    g = settle(run(g, { type: 'name', name: 'Wizard' }));
    expect(byName(g, 0, 'Collective Inferno')!.chosen).toBe('Wizard');
    g = settle(run(g, cast(g, 'Lightning Bolt', { targets: [player(1)] })));
    // Casting the Inferno pinged for 1. Then the Wizard's ping doubles to 2; the Bolt (no creature type) deals 3.
    expect(g.players[1].life).toBe(40 - 1 - 2 - 3);
  });

  it('Tomik adds 1 to noncombat damage to an opponent or their permanent, not to you', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Tomik, Izzet Sparkmage');
      put(d, 0, 'Lightning Bolt', 'hand', 2);
      put(d, 0, 'Mountain', 'battlefield', 2);
      put(d, 1, 'Serra Angel');
    });
    g = settle(run(g, cast(g, 'Lightning Bolt', { targets: [card(byName(g, 1, 'Serra Angel')!)] })));
    expect(byName(g, 1, 'Serra Angel')).toBeUndefined();
    g = settle(run(g, cast(g, 'Lightning Bolt', { targets: [player(0)] })));
    expect(g.players[0].life).toBe(37);
  });
});

describe('triggers', () => {
  it("Harmonic Prodigy makes another Wizard's triggered ability trigger twice", () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Harmonic Prodigy');
      put(d, 0, 'Wizard 0/1 ping').isToken = true;
      put(d, 0, 'Shock', 'hand');
      put(d, 0, 'Mountain');
    });
    g = settle(run(g, cast(g, 'Shock', { targets: [player(1)] })));
    expect(g.players[1].life).toBe(40 - 2 - 2);
    expect(g.players[2].life).toBe(38);
    // Its own prowess isn't doubled: it isn't "another" Wizard.
    expect(stats(g, byName(g, 0, 'Harmonic Prodigy')!).power).toBe(2);
  });

  it('Gandalf gets +1/+1 and deals 1 damage to each opponent when you cast a noncreature spell', () => {
    let g = emptyGame((d) => {
      put(d, 0, "Gandalf, Goblins' Bane // Flameshape");
      put(d, 0, 'Shock', 'hand');
      put(d, 0, 'Mountain');
    });
    g = settle(run(g, cast(g, 'Shock', { targets: [player(1)] })));
    expect(stats(g, byName(g, 0, "Gandalf, Goblins' Bane // Flameshape")!).power).toBe(3);
    expect(g.players[1].life).toBe(37);
    expect(g.players[3].life).toBe(39);
  });

  it('Storm-Kiln Artist gets +1/+0 for each artifact and makes a Treasure for each instant or sorcery cast or copied', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Storm-Kiln Artist');
      put(d, 0, 'Sol Ring');
      put(d, 0, 'Shock', 'hand');
      put(d, 0, 'Mountain');
    });
    expect(stats(g, byName(g, 0, 'Storm-Kiln Artist')!).power).toBe(3);
    g = settle(run(g, cast(g, 'Shock', { targets: [player(1)] })));
    expect(g.players[0].battlefield.filter((c) => c.name === 'Treasure')).toHaveLength(1);
    expect(stats(g, byName(g, 0, 'Storm-Kiln Artist')!).power).toBe(4);
  });

  it('Slickshot Show-Off gets +2/+0 for each noncreature spell', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Slickshot Show-Off');
      put(d, 0, 'Shock', 'hand');
      put(d, 0, 'Mountain');
    });
    g = settle(run(g, cast(g, 'Shock', { targets: [player(1)] })));
    expect(stats(g, byName(g, 0, 'Slickshot Show-Off')!)).toMatchObject({ power: 3, toughness: 2 });
  });
});

describe('Electro, Assaulting Battery', () => {
  it('keeps unspent red mana between steps, and adds {R} when you cast an instant', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Electro, Assaulting Battery');
      put(d, 0, 'Shock', 'hand');
      put(d, 0, 'Mountain');
      d.players[0].pool = [
        { sym: 'R', source: 'x' },
        { sym: 'G', source: 'x' },
      ];
    });
    g = settle(run(g, cast(g, 'Shock', { targets: [player(1)] })));
    // The Shock used a pooled mana, and Electro's trigger added {R}.
    g = until(g, (x) => x.step === 'attackers' || x.step === 'main2');
    expect(g.players[0].pool.every((m) => m.sym === 'R')).toBe(true);
    expect(g.players[0].pool.length).toBeGreaterThan(0);
  });

  it('when it leaves, you may pay {X}; when you do, it deals X damage to target player', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Electro, Assaulting Battery');
      put(d, 0, 'Mountain', 'battlefield', 3);
      put(d, 1, 'Lightning Bolt', 'hand');
      put(d, 1, 'Mountain');
      put(d, 1, 'Shock', 'hand');
      d.players[0].isBot = false;
      d.priority = 1;
    });
    // Two damage won't kill a 3/2... use Bolt: it dies and leaves.
    g = run(g, cast(g, 'Lightning Bolt', { targets: [card(byName(g, 0, 'Electro, Assaulting Battery')!)] }, 'hand', 1));
    g = untilAsked(g);
    expect(asked(g)?.kind).toBe('number');
    g = run(g, { type: 'chooseNumber', n: 3 });
    g = untilAsked(g);
    expect(asked(g)?.kind).toBe('ask');
    g = run(g, { type: 'answer', yes: true });
    g = untilAsked(g);
    g = settle(g, (x) => (x.decision?.type === 'targets' || asked(x) ? ({ type: 'chooseTargets', targets: [player(2)] } as Action) : null));
    expect(g.players[2].life).toBe(37);
    expect(g.players[0].battlefield.filter((c) => c.name === 'Mountain' && c.tapped)).toHaveLength(3);
  });
});

describe('Roles and Auras', () => {
  it('Not Dead After All: the creature returns tapped with a Wicked Role; the Role makes each opponent lose 1 when it goes to a graveyard', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Not Dead After All', 'hand');
      put(d, 0, 'Swamp');
      put(d, 0, 'Serra Angel');
      put(d, 1, 'Lightning Bolt', 'hand', 2);
      put(d, 1, 'Mountain', 'battlefield', 2);
      put(d, 1, 'Shock', 'hand');
    });
    const angel = byName(g, 0, 'Serra Angel')!;
    g = settle(run(g, cast(g, 'Not Dead After All', { targets: [card(angel)] })));
    g = produce(g, (d) => {
      d.players[0].battlefield.find((c) => c.name === 'Serra Angel')!.damage = 4;
    });
    g = settle(applyAction(g, pass));
    // State-based actions killed it; it returned tapped with a Role.
    const back = byName(g, 0, 'Serra Angel')!;
    expect(back).toBeTruthy();
    expect(back.tapped).toBe(true);
    const role = byName(g, 0, 'Wicked Role')!;
    expect(role.attachedTo).toBe(back.id);
    expect(stats(g, back)).toMatchObject({ power: 5, toughness: 5 });
    // Kill it again: it stays dead (the ability lasted until end of turn only once), and the Role drains.
    g = produce(g, (d) => {
      d.players[0].battlefield.find((c) => c.name === 'Serra Angel')!.damage = 5;
    });
    g = settle(applyAction(g, pass));
    expect(byName(g, 0, 'Wicked Role')).toBeUndefined();
    expect(g.players[1].life).toBe(39);
    expect(g.players[2].life).toBe(39);
    expect(g.players[0].life).toBe(40);
  });

  it('a newer Role from the same player replaces the older one (303.7a)', () => {
    const g = emptyGame((d) => {
      const angel = put(d, 0, 'Serra Angel');
      const a = put(d, 0, 'Wicked Role');
      a.isToken = true;
      a.attachedTo = angel.id;
      a.attachedAt = 1;
      const b = put(d, 0, 'Wicked Role');
      b.isToken = true;
      b.attachedTo = angel.id;
      b.attachedAt = 2;
      // Another player's Role on the same creature stays.
      const c = put(d, 1, 'Wicked Role');
      c.isToken = true;
      c.attachedTo = angel.id;
      c.attachedAt = 0;
    });
    const after = settle(applyAction(g, pass));
    const roles = after.players.flatMap((p) => p.battlefield).filter((c) => c.name === 'Wicked Role');
    expect(roles.map((c) => c.attachedAt).sort()).toEqual([0, 2]);
    // The one that went to the graveyard made player 0's opponents lose 1 life.
    expect(after.players[1].life).toBe(39);
  });

  it("Kaya's Ghostform returns the enchanted creature when it dies, under your control", () => {
    let g = emptyGame((d) => {
      put(d, 0, "Kaya's Ghostform", 'hand');
      put(d, 0, 'Swamp');
      put(d, 0, 'Serra Angel');
    });
    g = settle(run(g, cast(g, "Kaya's Ghostform", { targets: [card(byName(g, 0, 'Serra Angel')!)] })));
    expect(byName(g, 0, "Kaya's Ghostform")!.attachedTo).toBe(byName(g, 0, 'Serra Angel')!.id);
    g = produce(g, (d) => {
      d.players[0].battlefield.find((c) => c.name === 'Serra Angel')!.damage = 4;
    });
    g = settle(applyAction(g, pass));
    expect(byName(g, 0, 'Serra Angel')).toBeTruthy();
    expect(byName(g, 0, "Kaya's Ghostform", 'graveyard')).toBeTruthy();
  });

  it("Kaya's Ghostform doesn't return a token", () => {
    let g = emptyGame((d) => {
      const t = put(d, 0, 'Serra Angel');
      t.isToken = true;
      const k = put(d, 0, "Kaya's Ghostform");
      k.attachedTo = t.id;
    });
    g = produce(g, (d) => {
      d.players[0].battlefield.find((c) => c.name === 'Serra Angel')!.damage = 4;
    });
    g = settle(applyAction(g, pass));
    expect(byName(g, 0, 'Serra Angel')).toBeUndefined();
  });

  it('Lightning Greaves gives haste and shroud', () => {
    const g = emptyGame((d) => {
      const c = put(d, 0, 'Serra Angel');
      const lg = put(d, 0, 'Lightning Greaves');
      lg.attachedTo = c.id;
    });
    const angel = byName(g, 0, 'Serra Angel')!;
    expect(has(g, angel, 'haste')).toBe(true);
    expect(has(g, angel, 'shroud')).toBe(true);
  });
});

export type { Card };
