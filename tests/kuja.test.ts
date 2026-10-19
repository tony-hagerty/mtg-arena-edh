// The Kuja deck's hand scripts and the rules they needed: the clauses that could go wrong.
import { describe, expect, it } from 'vitest';
import { applyAction, applyBotAction, botAction, canBlock, colorsOf, has, makeCard, stats } from '../src/engine';
import type { Action, Game, PlayerId, TargetRef } from '../src/engine';
import { produce } from 'immer';
import { cardData } from '../src/cards/db';
import { byName, emptyGame, put, run } from './helpers';
import './fixtures';

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
      a.ts = 1;
      const b = put(d, 0, 'Wicked Role');
      b.isToken = true;
      b.attachedTo = angel.id;
      b.ts = 2;
      // Another player's Role on the same creature stays.
      const c = put(d, 1, 'Wicked Role');
      c.isToken = true;
      c.attachedTo = angel.id;
      c.ts = 0;
    });
    const after = settle(applyAction(g, pass));
    const roles = after.players.flatMap((p) => p.battlefield).filter((c) => c.name === 'Wicked Role');
    expect(roles.map((c) => c.ts).sort()).toEqual([0, 2]);
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
    expect(g.log.some((l) => l.text === 'Serra Angel returns to the battlefield.')).toBe(true);
  });

  it("Kaya's Ghostform returns another player's card under your control, and says so", () => {
    // Its owner's creature, which player 0 controls (as after Reanimate), dies: it goes to
    // its owner's graveyard (404.1) and comes back under player 0's control.
    let g = emptyGame((d) => {
      const angel = put(d, 1, 'Serra Angel');
      angel.controller = 0;
      d.players[1].battlefield.pop();
      d.players[0].battlefield.push(angel);
      put(d, 0, "Kaya's Ghostform").attachedTo = angel.id;
    });
    g = produce(g, (d) => {
      d.players[0].battlefield.find((c) => c.name === 'Serra Angel')!.damage = 4;
    });
    g = settle(applyAction(g, pass));
    const angel = byName(g, 0, 'Serra Angel')!;
    expect(angel.owner).toBe(1);
    expect(angel.controller).toBe(0);
    expect(g.log.some((l) => l.text === `Serra Angel returns to the battlefield under ${g.players[0].name}'s control.`)).toBe(true);
  });

  it("flashes the Wizard token whose trigger Kaya's Ghostform sets off, by a name the screen can look up", () => {
    // The black screen at a table: the Wizard token's "whenever you cast a noncreature spell"
    // trigger flashed its source as "Wizard", the name it shows, which isn't a card or token
    // key, so the screen's SpellFlash threw while drawing and both windows went blank.
    let g = emptyGame((d) => {
      put(d, 0, "Kaya's Ghostform", 'hand');
      put(d, 0, 'Swamp');
      put(d, 0, 'Serra Angel');
      put(d, 0, 'Wizard 0/1 ping').isToken = true;
    });
    g = run(g, cast(g, "Kaya's Ghostform", { targets: [card(byName(g, 0, 'Serra Angel')!)] }));
    expect(g.lastSpell).toMatchObject({ name: 'Wizard 0/1 ping', ability: 'triggered' });
    expect(cardData(g.lastSpell!.name).name).toBe('Wizard');
    g = settle(g);
    expect(g.players[1].life).toBe(39);
    expect(byName(g, 0, "Kaya's Ghostform")!.attachedTo).toBe(byName(g, 0, 'Serra Angel')!.id);
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

/** Player 0 decides for themself: the rest of their decisions this game are theirs. */
const human = (d: Game) => {
  d.players[0].isBot = false;
};
const inExile = (g: Game, pid: PlayerId, name: string) => g.players[pid].exile.find((c) => c.name === name);

describe('Aphotic Wisps', () => {
  it('the creature becomes black and gains fear until end of turn; you draw a card', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Llanowar Elves');
      put(d, 0, 'Swamp');
      put(d, 0, 'Aphotic Wisps', 'hand');
      top(d, 0, plenty);
      put(d, 1, 'Elvish Mystic');
      put(d, 1, 'Blood Artist');
      put(d, 1, 'Meteor Golem');
    });
    const elves = byName(g, 0, 'Llanowar Elves')!;
    g = settle(run(g, cast(g, 'Aphotic Wisps', { targets: [card(elves)] })));
    const now = byName(g, 0, 'Llanowar Elves')!;
    // Black replaces green (105.3).
    expect(colorsOf(g, now)).toEqual(['B']);
    expect(has(g, now, 'fear')).toBe(true);
    expect(g.players[0].hand.map((c) => c.name)).toEqual(['Mountain']);
    // Only artifact creatures and black creatures can block it (702.36b).
    const blocks = (name: string) => canBlock(g, byName(g, 1, name)!, now);
    expect(blocks('Elvish Mystic')).toBe(false);
    expect(blocks('Blood Artist')).toBe(true);
    expect(blocks('Meteor Golem')).toBe(true);
    // Both end at the cleanup step (514.2).
    g = until(g, (x) => x.active === 1);
    const later = byName(g, 0, 'Llanowar Elves')!;
    expect(colorsOf(g, later)).toEqual(['G']);
    expect(has(g, later, 'fear')).toBe(false);
  });
});

describe('changing and copying spells', () => {
  it('Redirect Lightning: pay 5 life, then the Bolt must go to another target', () => {
    let g = emptyGame((d) => {
      human(d);
      put(d, 0, 'Lightning Bolt', 'hand');
      put(d, 0, 'Redirect Lightning', 'hand');
      put(d, 0, 'Mountain', 'battlefield', 2);
    });
    g = run(g, cast(g, 'Lightning Bolt', { targets: [player(1)], hold: true }));
    const bolt = g.stack[0];
    g = run(g, cast(g, 'Redirect Lightning', { targets: [{ kind: 'stack', id: bolt.id }], extra: 0 }));
    expect(g.players[0].life).toBe(35);
    g = settle(g, (x) => (x.decision?.type === 'retarget' ? { type: 'chooseTargets', targets: [player(2)] } : null));
    expect(g.players[1].life).toBe(40);
    expect(g.players[2].life).toBe(37);
  });

  it("Redirect Lightning can't target a spell with two targets", () => {
    let g = emptyGame((d) => {
      human(d);
      put(d, 0, 'Fire Covenant', 'hand');
      put(d, 0, 'Redirect Lightning', 'hand');
      put(d, 0, 'Swamp');
      put(d, 0, 'Mountain', 'battlefield', 4);
      put(d, 1, 'Serra Angel', 'battlefield', 2);
    });
    const [a, b] = g.players[1].battlefield;
    g = run(g, cast(g, 'Fire Covenant', { x: 2, targets: [card(a), card(b)], divide: [1, 1], hold: true }));
    expect(applyAction(g, cast(g, 'Redirect Lightning', { targets: [{ kind: 'stack', id: g.stack[0].id }], extra: 1 }))).toBe(g);
  });

  it('Return the Favor copies a Bolt with new targets', () => {
    let g = emptyGame((d) => {
      human(d);
      put(d, 0, 'Lightning Bolt', 'hand');
      put(d, 0, 'Return the Favor', 'hand');
      put(d, 0, 'Mountain', 'battlefield', 4);
    });
    g = run(g, cast(g, 'Lightning Bolt', { targets: [player(1)], hold: true }));
    g = run(g, cast(g, 'Return the Favor', { modes: [0], targets: [{ kind: 'stack', id: g.stack[0].id }] }));
    g = settle(g, (x) => (x.decision?.type === 'targets' || x.decision?.type === 'retarget' ? { type: 'chooseTargets', targets: [player(2)] } : null));
    expect(g.players[1].life).toBe(37);
    expect(g.players[2].life).toBe(37);
  });

  it("Mages' Contest: the bidders top each other; the winner loses that much life, and the spell is countered if you win", () => {
    let g = emptyGame((d) => {
      human(d);
      put(d, 0, "Mages' Contest", 'hand');
      put(d, 0, 'Mountain', 'battlefield', 3);
      put(d, 1, 'Lightning Bolt', 'hand');
      put(d, 1, 'Mountain');
      d.priority = 1;
    });
    g = run(g, cast(g, 'Lightning Bolt', { targets: [player(0)] }, 'hand', 1));
    for (let i = 0; i < 10 && g.priority !== 0; i++) g = applyAction(g, pass);
    g = run(g, cast(g, "Mages' Contest", { targets: [{ kind: 'stack', id: g.stack[0].id }] }));
    // The bot tops 1 with 2 (up to 2 + the Bolt's mana value); you top it with 4; it passes.
    g = settle(g, (x) => (x.decision?.type === 'number' ? { type: 'chooseNumber', n: 4 } : null));
    expect(g.players[0].life).toBe(36);
    expect(g.players[1].life).toBe(40);
    expect(byName(g, 1, 'Lightning Bolt', 'graveyard')).toBeTruthy();
  });

  it("Tibalt's Trickery counters, mills 1-3, exiles until a different nonland card, which may be cast free; the rest go to the bottom", () => {
    let g = emptyGame((d) => {
      human(d);
      put(d, 0, 'Shock', 'hand');
      put(d, 0, "Tibalt's Trickery", 'hand');
      put(d, 0, 'Mountain', 'battlefield', 3);
      top(d, 0, ['Mountain', 'Mountain', 'Mountain', 'Shock', 'Lightning Bolt', 'Plains', 'Plains']);
    });
    g = run(g, cast(g, 'Shock', { targets: [player(1)], hold: true }));
    g = run(g, cast(g, "Tibalt's Trickery", { targets: [{ kind: 'stack', id: g.stack[0].id }] }));
    g = settle(g, (x) =>
      x.decision?.type === 'cast' ? { type: 'cast', card: x.decision.choice.card, targets: [player(2)] } : x.decision?.type === 'targets' ? { type: 'chooseTargets', targets: [player(2)] } : null,
    );
    expect(g.players[1].life).toBe(40);
    expect(g.players[2].life).toBe(37);
    const milled = g.players[0].graveyard.filter((c) => c.name === 'Mountain').length;
    expect(milled).toBeGreaterThanOrEqual(1);
    expect(milled).toBeLessThanOrEqual(3);
    // The Shock with the same name was passed over and went to the bottom with the other exiled cards.
    expect(g.players[0].exile).toHaveLength(0);
    expect(g.players[0].library.slice(0, 2).map((c) => c.name)).toEqual(['Plains', 'Plains']);
    expect(names(g.players[0].library.slice(2))).toEqual(names([...Array(3 - milled).fill({ name: 'Mountain' }), { name: 'Shock' }]));
  });

  it("Mizzix's Mastery exiles the card and casts a copy free; the copy doesn't stay in exile", () => {
    let g = emptyGame((d) => {
      human(d);
      put(d, 0, "Mizzix's Mastery", 'hand');
      put(d, 0, 'Lightning Bolt', 'graveyard');
      put(d, 0, 'Mountain', 'battlefield', 4);
    });
    g = run(g, cast(g, "Mizzix's Mastery", { targets: [card(g.players[0].graveyard[0])] }));
    g = settle(g, (x) =>
      x.decision?.type === 'chooseCards'
        ? { type: 'chooseCards', cards: (x.decision.choice as { cards: string[] }).cards.slice(0, 1) }
        : x.decision?.type === 'cast'
          ? { type: 'cast', card: x.decision.choice.card, targets: [player(1)] }
          : null,
    );
    expect(g.players[1].life).toBe(37);
    expect(names(g.players[0].exile)).toEqual(['Lightning Bolt', "Mizzix's Mastery"]);
  });

  it("Mizzix's Mastery overloaded copies each instant and sorcery card in your graveyard", () => {
    let g = emptyGame((d) => {
      human(d);
      put(d, 0, "Mizzix's Mastery", 'hand');
      put(d, 0, 'Lightning Bolt', 'graveyard');
      put(d, 0, 'Shock', 'graveyard');
      put(d, 0, 'Serra Angel', 'graveyard');
      put(d, 0, 'Mountain', 'battlefield', 8);
    });
    g = run(g, cast(g, "Mizzix's Mastery", { alt: 0 }));
    g = settle(g, (x) =>
      x.decision?.type === 'chooseCards'
        ? { type: 'chooseCards', cards: (x.decision.choice as { cards: string[] }).cards.slice(0, 1) }
        : x.decision?.type === 'cast'
          ? { type: 'cast', card: x.decision.choice.card, targets: [player(1)] }
          : null,
    );
    expect(g.players[1].life).toBe(35);
    expect(names(g.players[0].graveyard)).toEqual(['Serra Angel']);
  });

  it('Overmaster: the next instant or sorcery you cast this turn can’t be countered', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Overmaster', 'hand');
      put(d, 0, 'Shock', 'hand');
      put(d, 0, 'Counterspell', 'hand');
      put(d, 0, 'Mountain', 'battlefield', 2);
      put(d, 0, 'Island', 'battlefield', 2);
      top(d, 0, plenty);
    });
    g = settle(run(g, cast(g, 'Overmaster')));
    g = run(g, cast(g, 'Shock', { targets: [player(1)], hold: true }));
    g = settle(run(g, cast(g, 'Counterspell', { targets: [{ kind: 'stack', id: g.stack[0].id }] })));
    expect(g.players[1].life).toBe(38);
  });
});

describe('damage spells', () => {
  it('Fire Covenant: pay X life, X damage divided among the targets', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Fire Covenant', 'hand');
      put(d, 0, 'Swamp');
      put(d, 0, 'Mountain', 'battlefield', 2);
      put(d, 1, 'Serra Angel');
      put(d, 1, 'Walking Corpse');
    });
    const [a, b] = g.players[1].battlefield;
    g = settle(run(g, cast(g, 'Fire Covenant', { x: 6, targets: [card(a), card(b)], divide: [4, 2] })));
    expect(g.players[0].life).toBe(34);
    expect(g.players[1].battlefield).toHaveLength(0);
  });

  it('Saw in Half: two token copies at half power and toughness, rounded up', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Saw in Half', 'hand');
      put(d, 0, 'Swamp', 'battlefield', 3);
      put(d, 1, 'Serra Angel');
    });
    g = settle(run(g, cast(g, 'Saw in Half', { targets: [card(byName(g, 1, 'Serra Angel')!)] })));
    const copies = g.players[1].battlefield.filter((c) => c.isToken);
    expect(copies).toHaveLength(2);
    for (const c of copies) {
      expect(stats(g, c)).toMatchObject({ power: 2, toughness: 2 });
      expect(has(g, c, 'flying')).toBe(true);
    }
    expect(byName(g, 1, 'Serra Angel', 'graveyard')).toBeTruthy();
  });

  it('Stingerquill Charm makes a Cadet with haste', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Stingerquill Charm', 'hand');
      put(d, 0, 'Swamp');
      put(d, 0, 'Mountain');
    });
    g = settle(run(g, cast(g, 'Stingerquill Charm', { modes: [2] })));
    const cadet = byName(g, 0, 'Cadet')!;
    expect(stats(g, cadet)).toMatchObject({ power: 2, toughness: 2 });
    expect(has(g, cadet, 'haste')).toBe(true);
  });

  it("Untimely Malfunction: two target creatures can't block", () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Untimely Malfunction', 'hand');
      put(d, 0, 'Mountain', 'battlefield', 2);
      put(d, 1, 'Serra Angel');
      put(d, 1, 'Walking Corpse');
    });
    const [a, b] = g.players[1].battlefield;
    g = settle(run(g, cast(g, 'Untimely Malfunction', { modes: [2], targets: [card(a), card(b)] })));
    for (const c of g.players[1].battlefield) expect(has(g, c, "can't block")).toBe(true);
  });

  it('Matoc exiles the top card when a source you control deals exactly 2, and pings for 2 by exiling two graveyard cards', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Matoc, Lavamancer');
      put(d, 0, 'Shock', 'hand');
      put(d, 0, 'Mountain', 'battlefield', 2);
      put(d, 0, 'Plains', 'graveyard', 2);
      top(d, 0, ['Lightning Bolt', ...plenty]);
    });
    g = settle(run(g, cast(g, 'Shock', { targets: [player(1)] })));
    const bolt = inExile(g, 0, 'Lightning Bolt')!;
    expect(bolt).toBeTruthy();
    expect(g.effects.some((e) => e.kind === 'mayCast' && e.card === bolt.id)).toBe(true);
    const matoc = byName(g, 0, 'Matoc, Lavamancer')!;
    g = settle(run(g, { type: 'activate', card: matoc.id, targets: [player(2)], graveyard: g.players[0].graveyard.filter((c) => c.name === 'Plains').map((c) => c.id) }));
    expect(g.players[2].life).toBe(38);
    expect(g.players[0].graveyard.filter((c) => c.name === 'Plains')).toHaveLength(0);
  });

  it('Ensnared by the Mara: each opponent chooses in turn; the damage is the exiled cards’ total mana value', () => {
    let g = emptyGame((d) => {
      human(d);
      put(d, 0, 'Ensnared by the Mara', 'hand');
      put(d, 0, 'Mountain', 'battlefield', 4);
      top(d, 1, ['Serra Angel', 'Shock', 'Mountain', 'Mountain', 'Plains']);
      top(d, 2, ['Mountain', 'Lightning Bolt', 'Plains']);
      top(d, 3, ['Shock', 'Shock', 'Shock', 'Shock']);
      d.players[2].life = 10;
    });
    g = settle(run(g, cast(g, 'Ensnared by the Mara')), (x) => (x.decision?.type === 'cast' ? { type: 'cast', card: x.decision.choice.card, targets: [player(3)] } : null));
    // Player 1 took 5 + 1; player 2 (low on life) let you cast its Bolt, at player 3; player 3 took 4.
    expect(g.players[1].life).toBe(34);
    expect(g.players[1].exile).toHaveLength(4);
    expect(g.players[2].life).toBe(10);
    expect(g.players[3].life).toBe(40 - 3 - 4);
  });
});

describe('exile and play', () => {
  it('Bloodsoaked Insight costs less for life opponents lost; you may play the exiled cards until your next turn ends, with any mana', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Bloodsoaked Insight', 'hand');
      put(d, 0, 'Mountain', 'battlefield', 4);
      d.players[1].lifeLost = 3;
      d.players[2].lifeLost = 2;
      top(d, 1, ['Serra Angel', 'Plains', 'Shock']);
    });
    g = settle(run(g, cast(g, 'Bloodsoaked Insight', { targets: [player(1)] })));
    expect(g.players[1].exile).toHaveLength(3);
    const e = g.effects.find((x) => x.kind === 'mayCast' && x.card === inExile(g, 1, 'Serra Angel')!.id)!;
    expect(e).toMatchObject({ player: 0, play: true, anyMana: true, until: { player: 0, turn: 2 } });
  });

  it('Light Up the Stage: spectacle only once an opponent lost life this turn', () => {
    const g = emptyGame((d) => {
      put(d, 0, 'Light Up the Stage', 'hand');
      put(d, 0, 'Mountain');
    });
    expect(applyAction(g, cast(g, 'Light Up the Stage', { alt: 0 }))).toBe(g);
    const after = produce(g, (d) => {
      d.players[3].lifeLost = 1;
      top(d, 0, plenty);
    });
    const done = settle(run(after, cast(after, 'Light Up the Stage', { alt: 0 })));
    expect(done.players[0].exile).toHaveLength(2);
  });

  it('Dance with Calamity: exile as many as you like; with 13 or less, cast them free', () => {
    let g = emptyGame((d) => {
      human(d);
      put(d, 0, 'Dance with Calamity', 'hand');
      put(d, 0, 'Mountain', 'battlefield', 8);
      top(d, 0, ['Lightning Bolt', 'Lightning Bolt']);
    });
    let asks = 0;
    g = settle(run(g, cast(g, 'Dance with Calamity')), (x) => {
      const c = asked(x);
      if (x.decision?.type === 'ask') return { type: 'answer', yes: ++asks < 2 };
      if (x.decision?.type === 'chooseCards') return { type: 'chooseCards', cards: c!.cards!.slice(0, 1) };
      if (x.decision?.type === 'cast') return { type: 'cast', card: x.decision.choice.card, targets: [player(1)] };
      return null;
    });
    // One card exiled (the library was shuffled, both are Bolts), then cast.
    expect(g.players[1].life).toBe(37);
    expect(g.players[0].library).toHaveLength(1);
  });

  it('Dance with Calamity: over 13, nothing is cast', () => {
    let g = emptyGame((d) => {
      human(d);
      put(d, 0, 'Dance with Calamity', 'hand');
      put(d, 0, 'Mountain', 'battlefield', 8);
      top(d, 0, ['Serra Angel', 'Serra Angel', 'Serra Angel']);
    });
    g = settle(run(g, cast(g, 'Dance with Calamity')), (x) => (x.decision?.type === 'ask' ? { type: 'answer', yes: true } : null));
    expect(g.players[0].exile).toHaveLength(3);
    expect(g.decision).toBeNull();
  });

  it('Hex Magic exiles your hand, draws that many, and lets you play the exiled cards', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Hex Magic', 'hand');
      put(d, 0, 'Shock', 'hand');
      put(d, 0, 'Plains', 'hand');
      put(d, 0, 'Mountain', 'battlefield', 3);
      top(d, 0, plenty);
    });
    g = settle(run(g, cast(g, 'Hex Magic')));
    expect(g.players[0].hand).toHaveLength(2);
    expect(names(g.players[0].exile)).toEqual(['Plains', 'Shock']);
    expect(g.effects.filter((e) => e.kind === 'mayCast')).toHaveLength(2);
  });

  it('Flameshape exiles two face down that you may play only while you control a Wizard', () => {
    let g = emptyGame((d) => {
      put(d, 0, "Gandalf, Goblins' Bane", 'hand');
      put(d, 0, 'Mountain', 'battlefield', 3);
      top(d, 0, ['Plains', 'Shock', ...plenty]);
    });
    g = settle(run(g, cast(g, "Gandalf, Goblins' Bane", { face: 1 })));
    const exiled = g.players[0].exile.filter((c) => c.faceDown);
    expect(exiled).toHaveLength(2);
    expect(exiled.every((c) => c.known.includes(0))).toBe(true);
    expect(g.effects.filter((e) => e.kind === 'mayCast' && e.ifSubtype === 'Wizard')).toHaveLength(2);
  });

  it('Flashback gives an instant in your graveyard flashback for its mana cost; it is exiled after', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Flashback', 'hand');
      put(d, 0, 'Lightning Bolt', 'graveyard');
      put(d, 0, 'Mountain', 'battlefield', 2);
    });
    g = settle(run(g, cast(g, 'Flashback', { targets: [card(g.players[0].graveyard[0])] })));
    g = settle(run(g, cast(g, 'Lightning Bolt', { targets: [player(1)] }, 'graveyard')));
    expect(g.players[1].life).toBe(37);
    expect(inExile(g, 0, 'Lightning Bolt')).toBeTruthy();
  });
});

describe('card selection', () => {
  it('Highway Robbery: discard a card to draw two', () => {
    let g = emptyGame((d) => {
      human(d);
      put(d, 0, 'Highway Robbery', 'hand');
      put(d, 0, 'Plains', 'hand');
      put(d, 0, 'Mountain', 'battlefield', 2);
      top(d, 0, plenty);
    });
    g = settle(run(g, cast(g, 'Highway Robbery')), (x) => (x.decision?.type === 'chooseCards' ? { type: 'chooseCards', cards: [byName(x, 0, 'Plains', 'hand')!.id] } : null));
    expect(names(g.players[0].hand)).toEqual(['Mountain', 'Mountain']);
  });

  it('Highway Robbery: sacrifice a land to draw two, or do neither and draw nothing', () => {
    let g = emptyGame((d) => {
      human(d);
      put(d, 0, 'Highway Robbery', 'hand', 2);
      put(d, 0, 'Mountain', 'battlefield', 5);
      top(d, 0, plenty);
    });
    g = settle(run(g, cast(g, 'Highway Robbery')), (x) =>
      x.decision?.type === 'chooseCards' ? { type: 'chooseCards', cards: [x.players[0].battlefield.find((c) => c.tapped)!.id] } : null,
    );
    expect(g.players[0].battlefield).toHaveLength(4);
    expect(g.players[0].hand.filter((c) => c.name === 'Mountain')).toHaveLength(2);
    g = settle(run(g, cast(g, 'Highway Robbery')), (x) => (x.decision?.type === 'chooseCards' ? { type: 'chooseCards', cards: [] } : null));
    expect(g.players[0].hand).toHaveLength(2);
  });

  it('Valakut Awakening: put cards on the bottom in the order you choose, then draw that many plus one', () => {
    let g = emptyGame((d) => {
      human(d);
      put(d, 0, 'Valakut Awakening', 'hand');
      put(d, 0, 'Plains', 'hand');
      put(d, 0, 'Shock', 'hand');
      put(d, 0, 'Serra Angel', 'hand');
      put(d, 0, 'Mountain', 'battlefield', 3);
      top(d, 0, ['Swamp', 'Swamp', 'Swamp', 'Island']);
    });
    let step = 0;
    g = settle(run(g, cast(g, 'Valakut Awakening')), (x) => {
      if (x.decision?.type !== 'chooseCards') return null;
      const id = (n: string) => byName(x, 0, n, 'hand')!.id;
      return { type: 'chooseCards', cards: step++ === 0 ? [id('Plains'), id('Shock')] : [id('Shock'), id('Plains')] };
    });
    expect(names(g.players[0].hand)).toEqual(['Serra Angel', 'Swamp', 'Swamp', 'Swamp']);
    expect(g.players[0].library.map((c) => c.name)).toEqual(['Island', 'Shock', 'Plains']);
  });

  it('Tablet of Discovery mills a card you may play this turn', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Tablet of Discovery', 'hand');
      put(d, 0, 'Mountain', 'battlefield', 3);
      top(d, 0, ['Plains', ...plenty]);
    });
    g = settle(run(g, cast(g, 'Tablet of Discovery')));
    const plains = byName(g, 0, 'Plains', 'graveyard')!;
    expect(g.effects.some((e) => e.kind === 'mayCast' && e.card === plains.id && e.play)).toBe(true);
  });
});

describe('graveyard triggers', () => {
  it("Vivi's Persistence: when your commander enters, you may pay {2} to return it to your hand", () => {
    let g = emptyGame((d) => {
      put(d, 0, "Vivi's Persistence", 'graveyard');
      put(d, 0, 'Plains', 'battlefield', 7);
    });
    g = settle(run(g, { type: 'cast', card: g.players[0].command[0].id }));
    expect(byName(g, 0, "Vivi's Persistence", 'hand')).toBeTruthy();
  });

  it('Asgardian Inspiration returns when a source you control deals noncombat damage to an opponent, if you pay {2}', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Asgardian Inspiration', 'graveyard');
      put(d, 0, 'Shock', 'hand');
      put(d, 0, 'Mountain', 'battlefield', 3);
    });
    g = settle(run(g, cast(g, 'Shock', { targets: [player(1)] })));
    expect(byName(g, 0, 'Asgardian Inspiration', 'hand')).toBeTruthy();
  });

  it("Asgardian Inspiration doesn't trigger on damage to you", () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Asgardian Inspiration', 'graveyard');
      put(d, 0, 'Shock', 'hand');
      put(d, 0, 'Mountain', 'battlefield', 3);
    });
    g = settle(run(g, cast(g, 'Shock', { targets: [player(0)] })));
    expect(byName(g, 0, 'Asgardian Inspiration', 'graveyard')).toBeTruthy();
  });
});

describe('Black Market Connections', () => {
  it('chooses modes at the beginning of your first main phase', () => {
    let g = emptyGame((d) => {
      human(d);
      put(d, 0, 'Black Market Connections');
      top(d, 0, plenty);
      d.step = 'upkeep';
      d.turn = 2;
    });
    g = until(g, (x) => x.decision?.type === 'triggerModes');
    g = settle(run(g, { type: 'chooseModes', modes: [0, 2] }));
    expect(byName(g, 0, 'Treasure')).toBeTruthy();
    const shifter = byName(g, 0, 'Shapeshifter 3/2 changeling')!;
    expect(stats(g, shifter)).toMatchObject({ power: 3, toughness: 2 });
    expect(g.players[0].life).toBe(36);
  });
});

describe('lands and mana', () => {
  it('Dark Fortress makes {B} or {R} only the turn it entered or with a basic land', () => {
    const g = emptyGame((d) => {
      const f = put(d, 0, 'Dark Fortress');
      f.entered = 0;
      put(d, 0, 'Shock', 'hand');
    });
    const fortress = byName(g, 0, 'Dark Fortress')!;
    expect(applyAction(g, { type: 'tapMana', card: fortress.id, ability: 1, color: 'R' })).toBe(g);
    const withBasic = produce(g, (d) => void put(d, 0, 'Mountain'));
    run(withBasic, { type: 'tapMana', card: fortress.id, ability: 1, color: 'R' });
  });

  it('Phyrexian Tower sacrifices a creature for {B}{B}', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Phyrexian Tower');
      put(d, 0, 'Walking Corpse');
    });
    g = run(g, { type: 'tapMana', card: byName(g, 0, 'Phyrexian Tower')!.id, ability: 1, sacrifice: byName(g, 0, 'Walking Corpse')!.id });
    expect(g.players[0].pool.map((m) => m.sym)).toEqual(['B', 'B']);
    expect(byName(g, 0, 'Walking Corpse', 'graveyard')).toBeTruthy();
  });

  it('Coruscation Mage with offspring makes a 1/1 token copy that pings too', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Coruscation Mage', 'hand');
      put(d, 0, 'Mountain', 'battlefield', 5);
      put(d, 0, 'Shock', 'hand');
    });
    g = settle(run(g, cast(g, 'Coruscation Mage', { offspring: true })));
    const token = g.players[0].battlefield.find((c) => c.name === 'Coruscation Mage' && c.isToken)!;
    expect(stats(g, token)).toMatchObject({ power: 1, toughness: 1 });
    g = settle(run(g, cast(g, 'Shock', { targets: [player(1)] })));
    expect(g.players[1].life).toBe(36);
  });
});
