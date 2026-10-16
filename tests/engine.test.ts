import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  applyBotAction,
  availableMana,
  botAction,
  canCast,
  canMulligan,
  canPlayLand,
  castCost,
  choiceOptions,
  costText,
  maxX,
  data,
  defaultStops,
  moveCard,
  addCounters,
  attackOptions,
  canActivate,
  canAttack,
  legalTargets,
  pump,
  scriptOf,
  label,
  transform,
  castFaces,
  landFaces,
  createToken,
  draw,
  maxHandSize,
  nextStop,
  canBlock,
  canTapForMana,
  forbidden,
  manaOf,
  checkState,
  destroy,
  isCreature,
  makeCard,
  newGame,
  parseCost,
  planPayment,
  stats,
  tapForMana,
  turnOrder,
  abilityCost,
  findCard,
  manaValue,
  maxModes,
  triggerText,
  activatable,
  maxAbilityX,
  damageRooms,
} from '../src/engine';
import type { Action, ActivatedAbility, ApplyOptions, Game, TurnStops } from '../src/engine';
import { DECKS } from '../src/cards/db';
import './fixtures';
import { byName, emptyGame, onBattlefield, put, run, runWith, twoCommanderDeck } from './helpers';

const pass = { type: 'pass' } as const;

describe('commander rules', () => {
  it('starts at 40 life with the commander in the command zone', () => {
    const g = emptyGame();
    expect(g.players.map((p) => p.life)).toEqual([40, 40, 40, 40]);
    expect(g.players.map((p) => p.command.length)).toEqual([1, 1, 1, 1]);
    expect(g.players.every((p) => p.command[0].isCommander)).toBe(true);
  });

  it('charges 2 more each time the commander is recast, and it returns to the command zone', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Plains', 'battlefield', 12);
      put(d, 0, 'Murder', 'hand');
      put(d, 0, 'Swamp', 'battlefield', 3);
    });
    const lyra = g.players[0].command[0];
    g = run(g, { type: 'cast', card: lyra.id });
    expect(availableMana(g, 0)).toBe(15 - 5);
    const murder = byName(g, 0, 'Murder', 'hand')!;
    g = run(g, { type: 'cast', card: murder.id, targets: [{ kind: 'card', id: lyra.id }] });
    expect(g.players[0].command.map((c) => c.id)).toEqual([lyra.id]);
    expect(g.players[0].graveyard.some((c) => c.id === lyra.id)).toBe(false);
    // 15 lands - 5 (Lyra) - 3 (Murder) = 7 left, exactly Lyra + 2 tax.
    g = run(g, { type: 'cast', card: lyra.id });
    expect(availableMana(g, 0)).toBe(0);
    expect(g.players[0].commanderCasts).toEqual([2]);
  });

  // Player 0 is made human in these, since bots always send their commander home.
  it('asks a human whether their dead commander goes to the command zone (903.9a)', () => {
    let g = emptyGame((d) => {
      d.players[0].isBot = false;
      d.players[0].you = true;
      put(d, 0, 'Plains', 'battlefield', 12);
      put(d, 0, 'Murder', 'hand');
      put(d, 0, 'Swamp', 'battlefield', 3);
    });
    const lyra = g.players[0].command[0];
    g = run(g, { type: 'cast', card: lyra.id });
    g = run(g, { type: 'cast', card: byName(g, 0, 'Murder', 'hand')!.id, targets: [{ kind: 'card', id: lyra.id }] });
    // It really is in the graveyard until the owner chooses.
    expect(g.decision).toEqual({ type: 'commanderZone', card: lyra.id, resume: 0 });
    expect(g.players[0].graveyard.map((c) => c.id)).toContain(lyra.id);
    g = run(g, { type: 'commanderZone', toCommand: true });
    expect(g.players[0].command.map((c) => c.id)).toEqual([lyra.id]);
    expect([g.decision, g.priority]).toEqual([null, 0]);
  });

  it('lets a human leave their commander in exile, and asks only once', () => {
    let g = emptyGame((d) => {
      d.players[0].isBot = false;
      d.players[0].you = true;
      put(d, 0, 'Plains', 'battlefield', 6);
      put(d, 0, 'Swords to Plowshares', 'hand');
    });
    const lyra = g.players[0].command[0];
    g = run(g, { type: 'cast', card: lyra.id });
    g = run(g, { type: 'cast', card: byName(g, 0, 'Swords to Plowshares', 'hand')!.id, targets: [{ kind: 'card', id: lyra.id }] });
    expect(g.decision).toMatchObject({ type: 'commanderZone', card: lyra.id });
    g = run(g, { type: 'commanderZone', toCommand: false });
    expect(g.players[0].exile.map((c) => c.id)).toEqual([lyra.id]);
    expect(g.players[0].command).toEqual([]);
    g = run(g, pass);
    expect(g.decision?.type).not.toBe('commanderZone');
    expect(g.players[0].exile.map((c) => c.id)).toEqual([lyra.id]);
  });

  // No card in the pool bounces or tucks a permanent yet, so these call moveCard as one would.
  it('sends a bot commander headed for a hand or library to the command zone instead (903.9b)', () => {
    const g = emptyGame((d) => {
      moveCard(d, d.players[0].command[0], 'hand');
      moveCard(d, d.players[1].command[0], 'library');
    });
    expect(g.players.map((p) => p.command.length)).toEqual([1, 1, 1, 1]);
    expect(g.players[0].hand).toEqual([]);
    expect(g.players[1].library.some((c) => c.isCommander)).toBe(false);
  });

  it('asks a human whose commander goes to their hand, and lets them keep it there (903.9b)', () => {
    let g = emptyGame((d) => {
      d.players[0].isBot = false;
      d.players[0].you = true;
      d.players[0].commanderCasts = [1];
      put(d, 0, 'Plains', 'battlefield', 5);
      moveCard(d, d.players[0].command[0], 'hand');
    });
    // Any action lets the game check state, and the owner is asked.
    g = run(g, { type: 'tapMana', card: byName(g, 0, 'Plains')!.id });
    const lyra = byName(g, 0, 'Lyra Dawnbringer', 'hand')!;
    expect(g.decision).toEqual({ type: 'commanderZone', card: lyra.id, resume: 0 });
    g = run(g, { type: 'commanderZone', toCommand: false });
    expect(byName(g, 0, 'Lyra Dawnbringer', 'hand')?.id).toBe(lyra.id);
    // Cast from the hand, it costs its printed {3}{W}{W} with no tax (903.8).
    expect(canCast(g, 0, byName(g, 0, 'Lyra Dawnbringer', 'hand')!)).toBe(true);
  });

  it('lets a human send their commander from the library to the command zone (903.9b)', () => {
    let g = emptyGame((d) => {
      d.players[0].isBot = false;
      d.players[0].you = true;
      put(d, 0, 'Plains');
      moveCard(d, d.players[0].command[0], 'library');
    });
    g = run(g, { type: 'tapMana', card: byName(g, 0, 'Plains')!.id });
    expect(g.decision?.type).toBe('commanderZone');
    g = run(g, { type: 'commanderZone', toCommand: true });
    expect(g.players[0].command.map((c) => c.name)).toEqual(['Lyra Dawnbringer']);
    expect(g.players[0].library.some((c) => c.isCommander)).toBe(false);
  });

  it('eliminates a player at 21 combat damage from one commander', () => {
    let g = emptyGame((d) => {
      const c = put(d, 0, 'Ghalta, Primal Hunger');
      c.isCommander = true;
      d.players[0].commanders = ['Ghalta, Primal Hunger'];
      d.players[1].commanderDamage[0] = [10];
    });
    const ghalta = byName(g, 0, 'Ghalta, Primal Hunger')!;
    g = run(g, pass, { type: 'declareAttack', card: ghalta.id, defender: 1 }, pass);
    expect(g.players[1].life).toBe(28);
    expect(g.players[1].lost).toBe(true);
    expect(g.winner).toBe(null);
  });

  it('reduces Ghalta by the power you control', () => {
    // Seat 3's commander is Ghalta here. {10}{G}{G} minus 10 power = {G}{G}.
    const setup = (withDino: boolean) =>
      emptyGame((d) => {
        d.active = 3;
        d.priority = 3;
        d.players[3].commanders = ['Ghalta, Primal Hunger'];
        d.players[3].command = [makeCard(d, 'Ghalta, Primal Hunger', 3, 'command', { isCommander: true })];
        put(d, 3, 'Forest', 'battlefield', 2);
        if (withDino) put(d, 3, 'Gigantosaurus');
      });
    const ghalta = (g: ReturnType<typeof setup>) => g.players[3].command[0];
    expect(ghalta(setup(true)).name).toBe('Ghalta, Primal Hunger');
    expect(canCast(setup(false), 3, ghalta(setup(false)))).toBe(false);
    expect(canCast(setup(true), 3, ghalta(setup(true)))).toBe(true);
  });
});

describe('two commanders (702.124) and multicolour decks', () => {
  /** Player 0 gets two commanders, Lyra (W) and Torbran (R), both in the command zone. */
  const boros = (setup: (g: Game) => void = () => {}) =>
    emptyGame((d) => {
      const p = d.players[0];
      p.commanders = ['Lyra Dawnbringer', 'Torbran, Thane of Red Fell'];
      p.colors = ['W', 'R'];
      p.commanderCasts = [0, 0];
      p.command.push(makeCard(d, 'Torbran, Thane of Red Fell', 0, 'command', { isCommander: true }));
      for (const o of d.players) o.commanderDamage[0] = [0, 0];
      setup(d);
    });

  it('starts both commanders in the command zone, with colours from both (702.124b-c)', () => {
    const g = newGame({ seed: 3, humanDeck: null, decks: [twoCommanderDeck(), ...DECKS.slice(1)] });
    const p = g.players[0];
    expect(p.command.map((c) => c.name).sort()).toEqual(['Lyra Dawnbringer', 'Torbran, Thane of Red Fell']);
    expect(p.command.every((c) => c.isCommander)).toBe(true);
    expect(p.library.length + p.hand.length).toBe(98);
    expect(p.colors).toEqual(['W', 'R']);
    expect(p.commanderCasts).toEqual([0, 0]);
    // Everyone tracks damage from each of player 0's two commanders separately.
    expect(g.players[1].commanderDamage[0]).toEqual([0, 0]);
    expect(g.players[1].commanderDamage[1]).toEqual([0]);
  });

  it('charges each commander only for its own casts (903.8, 702.124d)', () => {
    let g = boros((d) => put(d, 0, 'Mountain', 'battlefield', 4));
    const torbran = byName(g, 0, 'Torbran, Thane of Red Fell', 'command')!;
    g = run(g, { type: 'cast', card: torbran.id }, pass);
    expect(g.players[0].commanderCasts).toEqual([0, 1]);
    g = produce(g, (d) => moveCard(d, byName(d, 0, 'Torbran, Thane of Red Fell')!, 'command'));
    const lyra = byName(g, 0, 'Lyra Dawnbringer', 'command')!;
    expect(castCost(g, lyra).generic).toBe(3); // no tax: Torbran's cast doesn't count
    expect(castCost(g, byName(g, 0, 'Torbran, Thane of Red Fell', 'command')!).generic).toBe(3); // {1} + 2 tax
  });

  it('counts commander damage from each partner separately (903.10a, 702.124d)', () => {
    const attack = (damage: number[]) => {
      let g = boros((d) => {
        const c = put(d, 0, 'Ghalta, Primal Hunger'); // a 12/12 standing in as the second commander
        c.isCommander = true;
        d.players[0].commanders = ['Lyra Dawnbringer', 'Ghalta, Primal Hunger'];
        d.players[1].commanderDamage[0] = damage;
      });
      g = run(g, pass, { type: 'declareAttack', card: byName(g, 0, 'Ghalta, Primal Hunger')!.id, defender: 1 }, pass);
      return g.players[1];
    };
    // 20 from Lyra plus 12 from Ghalta is 32, but no single commander has dealt 21.
    const safe = attack([20, 0]);
    expect(safe.commanderDamage[0]).toEqual([20, 12]);
    expect(safe.lost).toBe(false);
    expect(attack([0, 10]).lost).toBe(true);
  });

  it('pays multicolour costs from multicolour sources', () => {
    const g = boros((d) => {
      put(d, 0, 'Arcane Signet'); // W or R: the commanders' combined identity (702.124c)
      put(d, 0, 'Plains');
    });
    expect(planPayment(g, 0, parseCost('{R}{W}'))?.tap).toHaveLength(2);
    expect(planPayment(g, 0, parseCost('{W}{W}'))?.tap).toHaveLength(2);
    expect(planPayment(g, 0, parseCost('{R}{R}'))).toBe(null);
    // Pips go to the source that can't make anything else first, scarcest colour first.
    const both = boros((d) => {
      put(d, 0, 'Manalith');
      put(d, 0, 'Arcane Signet');
      put(d, 0, 'Mountain');
    });
    expect(planPayment(both, 0, parseCost('{G}{R}{W}'))?.tap).toHaveLength(3);
    expect(planPayment(both, 0, parseCost('{G}{G}{R}'))).toBe(null);
  });

  it('a hand-tapped multicolour source makes the colour the hand needs', () => {
    const g = boros((d) => {
      put(d, 0, 'Arcane Signet');
      put(d, 0, 'Lightning Bolt', 'hand');
    });
    const after = produce(g, (d) => tapForMana(d, 0, byName(d, 0, 'Arcane Signet')!));
    expect(after.players[0].pool.map((m) => m.sym)).toEqual(['R']);
  });

  it('bots play the land for the colour they are missing', () => {
    const g = boros((d) => {
      put(d, 0, 'Plains', 'battlefield', 2);
      put(d, 0, 'Plains', 'hand');
      put(d, 0, 'Mountain', 'hand');
      put(d, 0, 'Lightning Bolt', 'hand');
    });
    const action = botAction(g, 0);
    expect(action.type).toBe('playLand');
    expect(action.type === 'playLand' && g.players[0].hand.find((c) => c.id === action.card)?.name).toBe('Mountain');
  });
});

describe('auto-pay: which sources it taps', () => {
  // No commander in the command zone, so only the hand says which colours are wanted.
  const game = (setup: (g: Game) => void) =>
    emptyGame((d) => {
      d.players[0].command = [];
      setup(d);
    });
  const tapped = (g: Game, cost: string) => planPayment(g, 0, parseCost(cost))!.tap.map((id) => findCard(g, id)!.name);

  it('pays generic with a colour nothing in hand wants', () => {
    const g = game((d) => {
      put(d, 0, 'Mountain');
      put(d, 0, 'Plains');
      put(d, 0, 'Lightning Bolt', 'hand');
    });
    expect(tapped(g, '{1}')).toEqual(['Plains']);
  });

  it('pays generic with a basic before a dual', () => {
    const g = game((d) => {
      put(d, 0, 'Plateau');
      put(d, 0, 'Plains');
    });
    expect(tapped(g, '{1}')).toEqual(['Plains']);
  });

  it('taps a land before a mana creature, for coloured and generic mana', () => {
    const g = game((d) => {
      put(d, 0, 'Llanowar Elves');
      put(d, 0, 'Forest');
    });
    expect(tapped(g, '{G}')).toEqual(['Forest']);
    expect(tapped(g, '{1}')).toEqual(['Forest']);
    expect(tapped(g, '{1}{G}').sort()).toEqual(['Forest', 'Llanowar Elves']);
  });

  it('taps a land before a mana rock with another {T} ability', () => {
    const g = game((d) => {
      put(d, 0, 'Mind Stone');
      put(d, 0, 'Plains');
    });
    expect(tapped(g, '{1}')).toEqual(['Plains']);
  });

  it('pays a hybrid symbol with the colour the hand needs less (107.4e)', () => {
    const g = game((d) => {
      put(d, 0, 'Mountain');
      put(d, 0, 'Plains');
      put(d, 0, 'Lightning Bolt', 'hand');
    });
    expect(tapped(g, '{R/W}')).toEqual(['Plains']);
    // With only a Mountain it still pays.
    const one = game((d) => {
      put(d, 0, 'Mountain');
      put(d, 0, 'Lightning Bolt', 'hand');
    });
    expect(tapped(one, '{R/W}')).toEqual(['Mountain']);
  });

  it('pays generic from the pool with the colour the hand needs less', () => {
    const g = game((d) => {
      const bolt = put(d, 0, 'Lightning Bolt', 'hand');
      d.players[0].pool = [
        { sym: 'R', source: bolt.id },
        { sym: 'W', source: bolt.id },
      ];
    });
    expect(planPayment(g, 0, parseCost('{1}'))!.pool.map((m) => m.sym)).toEqual(['R']);
  });

  it("doesn't count the spell being paid for as wanting its own colours", () => {
    // Lyra ({3}{W}{W}) in the command zone wants white; the Bolt being cast wants nothing more.
    const g = emptyGame((d) => {
      put(d, 0, 'Plains');
      put(d, 0, 'Mountain');
      put(d, 0, 'Lightning Bolt', 'hand');
    });
    const bolt = byName(g, 0, 'Lightning Bolt', 'hand')!;
    expect(planPayment(g, 0, parseCost('{1}'), bolt)!.tap.map((id) => findCard(g, id)!.name)).toEqual(['Mountain']);
  });
});

describe('costs (107.3, 107.4, 118, 601.2f)', () => {
  const opp = { kind: 'player', id: 1 } as const;
  const cast = (g: Game, name: string, extra: object = {}) => ({ type: 'cast', card: byName(g, 0, name, 'hand')!.id, ...extra }) as const;

  it('parses X, hybrid, monocoloured hybrid and Phyrexian symbols', () => {
    const c = parseCost('{X}{1}{R/G}{2/W}{B/P}{G/U/P}{C}');
    expect(c).toEqual({ generic: 1, pips: ['C'], hybrid: [['R', 'G'], ['W', '2'], ['B', 'life'], ['G', 'U', 'life']], x: 1, life: 0 });
    expect(costText(parseCost('{2}{R/G}{W/P}'))).toBe('{2}{R/G}{W/P}');
  });

  it('lets the caster choose X and pay it as generic mana (107.3a)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Mountain', 'battlefield', 4);
      put(d, 0, 'Blaze', 'hand');
    });
    const blaze = byName(g, 0, 'Blaze', 'hand')!;
    expect(maxX(g, 0, blaze)).toBe(3);
    expect(canCast(g, 0, blaze, { x: 4, targets: [opp] } as never)).toBe(false);
    expect(applyAction(g, cast(g, 'Blaze', { x: 4, targets: [opp] }))).toBe(g);
    g = run(g, cast(g, 'Blaze', { x: 3, targets: [opp] }), pass);
    expect(g.players[1].life).toBe(37);
    expect(g.log.some((l) => l.text.includes('Blaze (X = 3)'))).toBe(true);
    // Off the stack, X is gone again (107.3g).
    expect(byName(g, 0, 'Blaze', 'graveyard')!.cast).toBe(null);
  });

  it('pays a hybrid symbol with either colour (107.4e)', () => {
    for (const land of ['Plains', 'Mountain']) {
      const g = emptyGame((d) => {
        put(d, 0, land);
        put(d, 0, 'Boros Recruit', 'hand');
      });
      expect(canCast(g, 0, byName(g, 0, 'Boros Recruit', 'hand')!), land).toBe(true);
    }
    const g = emptyGame((d) => {
      put(d, 0, 'Forest');
      put(d, 0, 'Boros Recruit', 'hand');
    });
    expect(canCast(g, 0, byName(g, 0, 'Boros Recruit', 'hand')!)).toBe(false);
  });

  it('pays {2/W} with one white mana or two of any type (107.4e)', () => {
    const lands = (plains: number, mountains: number) =>
      emptyGame((d) => {
        put(d, 0, 'Plains', 'battlefield', plains);
        put(d, 0, 'Mountain', 'battlefield', mountains);
      });
    const procession = parseCost('{2/W}{2/W}{2/W}');
    expect(planPayment(lands(3, 0), 0, procession)?.tap).toHaveLength(3);
    expect(planPayment(lands(0, 6), 0, procession)?.tap).toHaveLength(6);
    expect(planPayment(lands(1, 4), 0, procession)?.tap).toHaveLength(5);
    expect(planPayment(lands(1, 3), 0, procession)).toBe(null);
  });

  it('pays a Phyrexian symbol with mana if it can, otherwise 2 life (107.4f, 119.4)', () => {
    let g = emptyGame((d) => put(d, 0, 'Gut Shot', 'hand'));
    g = run(g, cast(g, 'Gut Shot', { targets: [opp] }), pass);
    expect(g.players[0].life).toBe(38);
    expect(g.players[1].life).toBe(39);
    g = emptyGame((d) => {
      put(d, 0, 'Mountain');
      put(d, 0, 'Gut Shot', 'hand');
    });
    g = run(g, cast(g, 'Gut Shot', { targets: [opp] }), pass);
    expect(g.players[0].life).toBe(40);
    // With 1 life, 2 life can't be paid.
    g = emptyGame((d) => {
      d.players[0].life = 1;
      put(d, 0, 'Gut Shot', 'hand');
    });
    expect(canCast(g, 0, byName(g, 0, 'Gut Shot', 'hand')!)).toBe(false);
  });

  it('adds the kicker cost when the spell is kicked (702.33)', () => {
    const setup = (mountains: number) =>
      emptyGame((d) => {
        put(d, 0, 'Mountain', 'battlefield', mountains);
        put(d, 0, 'Burst Lightning', 'hand');
      });
    let g = setup(5);
    g = run(g, cast(g, 'Burst Lightning', { kicked: 1, targets: [opp] }), pass);
    expect(g.players[1].life).toBe(36);
    expect(g.log.some((l) => l.text.includes('Burst Lightning (kicked)'))).toBe(true);
    g = setup(4);
    expect(applyAction(g, cast(g, 'Burst Lightning', { kicked: 1, targets: [opp] }))).toBe(g);
    // Kicker without multikicker is paid at most once (702.33d).
    g = setup(9);
    expect(applyAction(g, cast(g, 'Burst Lightning', { kicked: 2, targets: [opp] }))).toBe(g);
    g = run(g, cast(g, 'Burst Lightning', { targets: [opp] }), pass);
    expect(g.players[1].life).toBe(38);
  });

  it('sacrifices a creature as an additional cost (118.8)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Swamp');
      put(d, 0, 'Elite Vanguard');
      put(d, 1, 'Serra Angel');
      put(d, 0, 'Bone Splinters', 'hand');
    });
    const angel = { kind: 'card', id: byName(g, 1, 'Serra Angel')!.id } as const;
    const vanguard = byName(g, 0, 'Elite Vanguard')!.id;
    // The sacrifice must be chosen.
    expect(applyAction(g, cast(g, 'Bone Splinters', { targets: [angel] }))).toBe(g);
    expect(applyAction(g, cast(g, 'Bone Splinters', { targets: [angel], sacrifice: [angel.id] }))).toBe(g);
    g = run(g, cast(g, 'Bone Splinters', { targets: [angel], sacrifice: [vanguard] }));
    expect(onBattlefield(g, vanguard)).toBe(false); // paid on casting, before it resolves
    g = run(g, pass);
    expect(onBattlefield(g, angel.id)).toBe(false);
    // With no creature to sacrifice, it can't be cast at all.
    g = emptyGame((d) => {
      put(d, 0, 'Swamp');
      put(d, 1, 'Serra Angel');
      put(d, 0, 'Bone Splinters', 'hand');
    });
    expect(canCast(g, 0, byName(g, 0, 'Bone Splinters', 'hand')!)).toBe(false);
  });

  it('allows an alternative cost only when its condition holds (118.9)', () => {
    const setup = (commander: boolean) =>
      emptyGame((d) => {
        const lyra = put(d, 0, 'Lyra Dawnbringer');
        lyra.isCommander = commander;
        put(d, 0, 'Flawless Maneuver', 'hand');
      });
    let g = setup(false);
    expect(canCast(g, 0, byName(g, 0, 'Flawless Maneuver', 'hand')!)).toBe(false);
    g = setup(true);
    expect(canCast(g, 0, byName(g, 0, 'Flawless Maneuver', 'hand')!)).toBe(true);
    g = run(g, cast(g, 'Flawless Maneuver', { alt: 0 }), pass);
    expect(stats(g, byName(g, 0, 'Lyra Dawnbringer')!).keywords.has('indestructible')).toBe(true);
  });

  it('adds cost increases and takes off reductions together, generic mana only (601.2f)', () => {
    const g = emptyGame((d) => {
      put(d, 1, 'Thalia, Guardian of Thraben');
      put(d, 0, 'Ruby Medallion');
      put(d, 0, 'Lightning Bolt', 'hand');
      put(d, 0, 'Blaze', 'hand');
      put(d, 0, 'Boros Recruit', 'hand');
    });
    const cost = (name: string, choices = {}) => costText(castCost(g, byName(g, 0, name, 'hand')!, choices));
    expect(cost('Lightning Bolt')).toBe('{R}'); // +1 from Thalia, -1 from the Medallion
    expect(cost('Blaze', { x: 2 })).toBe('{2}{R}');
    expect(cost('Boros Recruit')).toBe('{R/W}'); // a creature, and red: -1 can't go below {0}
    const noThalia = produce(g, (d) => {
      d.players[1].battlefield = [];
    });
    expect(costText(castCost(noThalia, byName(noThalia, 0, 'Lightning Bolt', 'hand')!))).toBe('{R}'); // coloured mana isn't reduced
  });

  it('bots choose X, kicker and what to sacrifice', () => {
    let g = emptyGame((d) => {
      d.players[1].life = 3;
      put(d, 0, 'Mountain', 'battlefield', 5);
      put(d, 0, 'Blaze', 'hand');
    });
    const blaze = botAction(g, 0);
    expect(blaze).toMatchObject({ type: 'cast', targets: [opp] });
    expect(blaze.type === 'cast' && blaze.x! >= 3).toBe(true);

    g = emptyGame((d) => {
      put(d, 0, 'Mountain', 'battlefield', 5);
      put(d, 1, 'Serra Angel');
      put(d, 0, 'Burst Lightning', 'hand');
    });
    expect(botAction(g, 0)).toMatchObject({ type: 'cast', kicked: 1, targets: [{ kind: 'card', id: byName(g, 1, 'Serra Angel')!.id }] });

    g = emptyGame((d) => {
      put(d, 0, 'Swamp');
      put(d, 0, 'Elite Vanguard');
      put(d, 0, 'Serra Angel');
      put(d, 1, 'Shivan Dragon');
      put(d, 0, 'Bone Splinters', 'hand');
    });
    expect(botAction(g, 0)).toMatchObject({
      type: 'cast',
      sacrifice: [byName(g, 0, 'Elite Vanguard')!.id],
      targets: [{ kind: 'card', id: byName(g, 1, 'Shivan Dragon')!.id }],
    });
  });
});

describe('counterspells, modes, copies and holding priority', () => {
  const opp = (id: number) => ({ kind: 'player', id }) as const;
  const top = (g: Game) => ({ kind: 'stack', id: g.stack[g.stack.length - 1].id }) as const;
  const cast = (g: Game, pid: number, name: string, extra: object = {}) =>
    ({ type: 'cast', card: byName(g, pid, name, 'hand')!.id, ...extra }) as const;

  /** Player 0 has 4 Mountains and Lightning Bolt; player 1 has 4 Islands and `answer`. */
  const duel = (answer: string, setup: (g: Game) => void = () => {}) =>
    emptyGame((d) => {
      put(d, 0, 'Mountain', 'battlefield', 4);
      put(d, 0, 'Lightning Bolt', 'hand');
      put(d, 1, 'Island', 'battlefield', 4);
      put(d, 1, answer, 'hand');
      setup(d);
    });

  it('counters a spell: it goes to the graveyard and does nothing (701.6a)', () => {
    let g = duel('Counterspell');
    g = run(g, cast(g, 0, 'Lightning Bolt', { targets: [opp(1)] }));
    // Player 1 could respond, so the game stops for them.
    expect(g.priority).toBe(1);
    g = run(g, cast(g, 1, 'Counterspell', { targets: [top(g)] }));
    expect(g.log.some((l) => l.text === 'Lightning Bolt is countered.')).toBe(true);
    expect(g.stack).toEqual([]);
    expect(g.players[1].life).toBe(40);
    expect(byName(g, 0, 'Lightning Bolt', 'graveyard')).toBeDefined();
    // The mana spent on it isn't refunded (701.6b).
    expect(g.players[0].battlefield.filter((c) => c.tapped)).toHaveLength(1);
  });

  it('only targets the spells a counterspell allows', () => {
    const negate = duel('Negate', (d) => put(d, 0, 'Raging Goblin', 'hand'));
    // Negate can't target a creature spell, so player 1 isn't asked and it resolves.
    let g = run(negate, cast(negate, 0, 'Raging Goblin'));
    expect(g.stack).toHaveLength(0);
    const scatter = duel('Essence Scatter', (d) => put(d, 0, 'Raging Goblin', 'hand'));
    g = run(scatter, cast(scatter, 0, 'Raging Goblin'));
    expect(g.priority).toBe(1);
    expect(canCast(g, 1, byName(g, 1, 'Essence Scatter', 'hand')!)).toBe(true);
  });

  it('a countered commander can still go to the command zone, and its tax still counts (903.8, 903.9a)', () => {
    let g = duel('Counterspell', (d) => put(d, 0, 'Plains', 'battlefield', 5));
    const lyra = byName(g, 0, 'Lyra Dawnbringer', 'command')!;
    g = run(g, { type: 'cast', card: lyra.id });
    // Player 0 still has Lightning Bolt and the mana for it, so they get to respond too.
    g = run(g, cast(g, 1, 'Counterspell', { targets: [top(g)] }), pass);
    expect(byName(g, 0, 'Lyra Dawnbringer', 'command')).toBeDefined();
    expect(g.players[0].commanderCasts).toEqual([1]);
  });

  it('counters a triggered ability (701.6a)', () => {
    let g = duel('Stifle', (d) => {
      put(d, 0, 'Flametongue Kavu', 'hand');
      put(d, 1, 'Serra Angel');
    });
    g = run(g, cast(g, 0, 'Flametongue Kavu'));
    // It resolves, and its enters ability waits for player 0 to choose a target.
    expect(g.decision?.type).toBe('targets');
    const angel = byName(g, 1, 'Serra Angel')!;
    g = run(g, { type: 'chooseTargets', targets: [{ kind: 'card', id: angel.id }] });
    expect(g.priority).toBe(1);
    g = run(g, cast(g, 1, 'Stifle', { targets: [top(g)] }));
    expect(g.log.some((l) => l.text === "Flametongue Kavu's ability is countered.")).toBe(true);
    expect(byName(g, 1, 'Serra Angel')!.damage).toBe(0);
  });

  it('casts a modal spell with the modes chosen, each with its own targets (700.2)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Mountain', 'battlefield', 2);
      put(d, 0, 'Plains', 'battlefield', 2);
      put(d, 0, 'Boros Charm', 'hand');
    });
    const charm = byName(g, 0, 'Boros Charm', 'hand')!;
    // Choose one: two modes, or none, is illegal. With no creature around, the double
    // strike mode has no target and can't be chosen (700.2a).
    expect(canCast(g, 0, charm, { modes: [0, 1], targets: [opp(1)] } as never)).toBe(false);
    expect(canCast(g, 0, charm, { modes: [] })).toBe(false);
    expect(canCast(g, 0, charm, { modes: [2] })).toBe(false);
    g = run(g, cast(g, 0, 'Boros Charm', { modes: [0], targets: [opp(1)] }));
    expect(g.players[1].life).toBe(36);
    expect(g.log.some((l) => l.text.includes('Boros Charm (“Boros Charm deals 4 damage to target player.”) targeting Mortis'))).toBe(true);
  });

  it('lets a mode be chosen more than once when the spell says so (700.2d)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Mountain', 'battlefield', 4);
      put(d, 0, 'Fiery Confluence', 'hand');
      put(d, 1, 'Sol Ring');
    });
    expect(applyAction(g, cast(g, 0, 'Fiery Confluence', { modes: [1, 1] }))).toBe(g); // needs three
    g = run(g, cast(g, 0, 'Fiery Confluence', { modes: [1, 1, 2], targets: [{ kind: 'card', id: byName(g, 1, 'Sol Ring')!.id }] }));
    expect(g.players.slice(1).map((p) => p.life)).toEqual([36, 36, 36]);
    expect(byName(g, 1, 'Sol Ring')).toBeUndefined();
  });

  it('takes targets only for the chosen modes (700.2c)', () => {
    let g = duel('Cryptic Command');
    g = run(g, cast(g, 0, 'Lightning Bolt', { targets: [opp(1)] }));
    const hand = g.players[1].hand.length;
    // Counter + draw: one target, for the counter mode.
    g = run(g, cast(g, 1, 'Cryptic Command', { modes: [0, 3], targets: [top(g)] }));
    expect(g.players[1].life).toBe(40);
    expect(g.players[1].hand.length).toBe(hand); // Cryptic left the hand, a card was drawn
  });

  it('holds priority after casting, to respond to your own spell (117.3c)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Mountain', 'battlefield', 3);
      put(d, 0, 'Lightning Bolt', 'hand');
      put(d, 0, 'Reverberate', 'hand');
    });
    const held = run(g, cast(g, 0, 'Lightning Bolt', { targets: [opp(1)], hold: true }));
    expect(held.stack).toHaveLength(1);
    expect(held.priority).toBe(0);
    // Without holding, everyone passes and it resolves.
    expect(run(g, cast(g, 0, 'Lightning Bolt', { targets: [opp(1)] })).stack).toHaveLength(0);

    // Copy it: the copy keeps its target unless new ones are chosen (707.10c).
    g = run(held, cast(held, 0, 'Reverberate', { targets: [top(held)] }));
    expect(g.decision?.type).toBe('targets');
    g = run(g, { type: 'chooseTargets', targets: [opp(2)] });
    // The copy resolves first: it went on the stack above the original.
    const damage = g.log.filter((l) => l.text.startsWith('Lightning Bolt deals')).map((l) => l.text);
    expect(damage).toEqual([`Lightning Bolt deals 3 damage to ${g.players[2].name}.`, `Lightning Bolt deals 3 damage to ${g.players[1].name}.`]);
    expect(g.players[1].life).toBe(37);
    expect(g.players[2].life).toBe(37);
    // The copy ceases to exist instead of going to a graveyard (707.10a).
    expect(g.players[0].graveyard.map((c) => c.name).sort()).toEqual(['Lightning Bolt', 'Reverberate']);
  });

  it('bots counter a spell that would kill them', () => {
    let g = duel('Counterspell', (d) => {
      d.players[1].life = 3;
    });
    g = run(g, cast(g, 0, 'Lightning Bolt', { targets: [opp(1)] }));
    expect(botAction(g, 1)).toMatchObject({ type: 'cast', card: byName(g, 1, 'Counterspell', 'hand')!.id, targets: [top(g)] });
  });
});

describe('counters and attachments (122, 301.5, 303.4, 702.122)', () => {
  const cast = (g: Game, name: string, extra: object = {}) => ({ type: 'cast', card: byName(g, 0, name, 'hand')!.id, ...extra }) as const;
  const ref = (c: { id: string }) => ({ kind: 'card', id: c.id }) as const;

  it('keeps counters by kind, and +1/+1 and -1/-1 counters cancel out (122.1a, 704.5q)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Swamp', 'battlefield', 3);
      addCounters(d, put(d, 0, 'Serra Angel'), 2);
      put(d, 1, 'Shivan Dragon'); // 5/5
      put(d, 1, 'Raging Goblin'); // 1/1
      put(d, 0, "Black Sun's Zenith", 'hand');
    });
    g = run(g, cast(g, "Black Sun's Zenith", { x: 1 }));
    const angel = byName(g, 0, 'Serra Angel')!;
    expect(angel.counters).toEqual({ '+1/+1': 1 });
    expect(stats(g, angel).power).toBe(5);
    expect(byName(g, 1, 'Shivan Dragon')!.counters).toEqual({ '-1/-1': 1 });
    expect(stats(g, byName(g, 1, 'Shivan Dragon')!)).toMatchObject({ power: 4, toughness: 4 });
    expect(byName(g, 1, 'Raging Goblin')).toBeUndefined(); // 0/0
    // It shuffled itself into the library instead of going to the graveyard.
    expect(byName(g, 0, "Black Sun's Zenith", 'library')).toBeDefined();
  });

  it('gives a keyword for a keyword counter (122.1b)', () => {
    const g = emptyGame((d) => addCounters(d, put(d, 0, 'Elite Vanguard'), 1, 'flying'));
    expect(stats(g, byName(g, 0, 'Elite Vanguard')!).keywords.has('flying')).toBe(true);
  });

  it('casts an Aura targeting what it will enchant, and it gives its bonus (303.4a)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Plains');
      put(d, 0, 'Elite Vanguard');
      put(d, 0, 'Holy Strength', 'hand');
    });
    const vanguard = byName(g, 0, 'Elite Vanguard')!;
    g = run(g, cast(g, 'Holy Strength', { targets: [ref(vanguard)] }));
    expect(byName(g, 0, 'Holy Strength')!.attachedTo).toBe(vanguard.id);
    expect(stats(g, byName(g, 0, 'Elite Vanguard')!)).toMatchObject({ power: 3, toughness: 3 });
    // The creature dies: the Aura goes to the graveyard (704.5m).
    g = produce(g, (d) => {
      destroy(d, byName(d, 0, 'Elite Vanguard'));
      checkState(d);
    });
    expect(byName(g, 0, 'Holy Strength', 'graveyard')).toBeDefined();
  });

  it("stops an enchanted creature attacking or blocking (Pacifism)", () => {
    const g = emptyGame((d) => {
      const angel = put(d, 1, 'Serra Angel');
      const p = put(d, 0, 'Pacifism');
      p.attachedTo = angel.id;
      put(d, 0, 'Elite Vanguard');
    });
    const angel = byName(g, 1, 'Serra Angel')!;
    expect(canAttack(g, angel)).toBe(false);
    expect(canBlock(g, angel, byName(g, 0, 'Elite Vanguard')!)).toBe(false);
  });

  it('puts an Aura whose target is gone into the graveyard instead (303.4g)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Plains', 'battlefield', 2);
      put(d, 1, 'Serra Angel');
      put(d, 0, 'Pacifism', 'hand');
    });
    g = runWith({ autoPass: false }, g, cast(g, 'Pacifism', { targets: [ref(byName(g, 1, 'Serra Angel')!)] }));
    g = produce(g, (d) => destroy(d, byName(d, 1, 'Serra Angel')));
    g = run(g, pass);
    expect(byName(g, 0, 'Pacifism', 'graveyard')).toBeDefined();
  });

  it('equips at sorcery speed, moves between creatures, and falls off a creature that dies (702.6, 704.5n)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Mountain', 'battlefield', 2);
      put(d, 0, 'Bonesplitter');
      put(d, 0, 'Elite Vanguard');
      put(d, 0, 'Raging Goblin');
    });
    const eq = (target: string): Action => ({ type: 'activate', card: byName(g, 0, 'Bonesplitter')!.id, targets: [ref(byName(g, 0, target)!)] });
    g = run(g, eq('Elite Vanguard'));
    expect(stats(g, byName(g, 0, 'Elite Vanguard')!).power).toBe(4);
    g = run(g, eq('Raging Goblin'));
    expect(stats(g, byName(g, 0, 'Elite Vanguard')!).power).toBe(2);
    expect(byName(g, 0, 'Bonesplitter')!.attachedTo).toBe(byName(g, 0, 'Raging Goblin')!.id);
    g = produce(g, (d) => {
      destroy(d, byName(d, 0, 'Raging Goblin'));
      checkState(d);
    });
    expect(byName(g, 0, 'Bonesplitter')!.attachedTo).toBe(null); // stays on the battlefield
    // Not at instant speed: with a spell on the stack, it can't be activated.
    const busy = produce(g, (d) => {
      d.step = 'beginCombat';
    });
    expect(canActivate(busy, 0, byName(busy, 0, 'Bonesplitter')!)).toBe(false);
  });

  it('crews a Vehicle with enough power, and it is a creature until end of turn (702.122)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Untethered Express');
      put(d, 0, 'Elite Vanguard').sick = true; // summoning sickness doesn't stop crewing
    });
    const express = byName(g, 0, 'Untethered Express')!;
    expect(isCreature(express)).toBe(false);
    const crewIt: Action = { type: 'activate', card: express.id, crew: [byName(g, 0, 'Elite Vanguard')!.id] };
    expect(applyAction(g, { type: 'activate', card: express.id })).toBe(g); // no crew picked
    g = run(g, crewIt);
    expect(isCreature(byName(g, 0, 'Untethered Express')!)).toBe(true);
    expect(byName(g, 0, 'Elite Vanguard')!.tapped).toBe(true);
    // It attacks, and its attack trigger puts a +1/+1 counter on it.
    g = run(g, pass, { type: 'declareAttack', card: express.id, defender: 1 }, pass);
    expect(g.players[1].life).toBe(35);
    expect(byName(g, 0, 'Untethered Express')!.counters).toEqual({ '+1/+1': 1 });
  });

  it('Equipment falls off a Vehicle when it stops being a creature at end of turn (704.5n)', () => {
    let g = emptyGame((d) => {
      const v = put(d, 0, 'Untethered Express');
      v.mods.push({ power: 0, toughness: 0, keywords: [], creature: true });
      put(d, 0, 'Bonesplitter').attachedTo = v.id;
    });
    expect(stats(g, byName(g, 0, 'Untethered Express')!).power).toBe(6);
    g = produce(g, (d) => {
      byName(d, 0, 'Untethered Express')!.mods = []; // what the cleanup step does (514.2)
      checkState(d);
    });
    expect(byName(g, 0, 'Bonesplitter')!.attachedTo).toBe(null);
  });

  it("can't crew with too little power", () => {
    const g = emptyGame((d) => {
      put(d, 0, 'Untethered Express');
      put(d, 0, 'Angelic Wall'); // 0/4
    });
    expect(canActivate(g, 0, byName(g, 0, 'Untethered Express')!)).toBe(false);
  });

  it('bots equip, enchant and crew', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Mountain', 'battlefield', 2);
      put(d, 0, 'Bonesplitter');
      put(d, 0, 'Elite Vanguard');
    });
    expect(botAction(g, 0)).toMatchObject({ type: 'activate', card: byName(g, 0, 'Bonesplitter')!.id });

    g = emptyGame((d) => {
      put(d, 0, 'Plains', 'battlefield', 2);
      put(d, 1, 'Shivan Dragon');
      put(d, 1, 'Raging Goblin');
      put(d, 0, 'Pacifism', 'hand');
    });
    expect(botAction(g, 0)).toMatchObject({ type: 'cast', targets: [ref(byName(g, 1, 'Shivan Dragon')!)] });

    g = emptyGame((d) => {
      put(d, 0, 'Untethered Express');
      put(d, 0, 'Raging Goblin').sick = true;
    });
    expect(botAction(g, 0)).toMatchObject({ type: 'activate', crew: [byName(g, 0, 'Raging Goblin')!.id] });
  });
});

describe('planeswalkers and battles (306, 310, 606)', () => {
  const ref = (c: { id: string }) => ({ kind: 'card', id: c.id }) as const;
  const player = (id: number) => ({ kind: 'player', id }) as const;
  /** A planeswalker already on the battlefield, with `loyalty` loyalty counters. */
  const walker = (d: Game, pid: number, name: string, loyalty: number) => {
    const c = put(d, pid, name);
    c.counters.loyalty = loyalty;
    return c;
  };
  /** Invasion of Dominaria on `pid`'s battlefield, protected by `protector`. */
  const siege = (d: Game, pid: number, protector: number, defense = 5) => {
    const c = put(d, pid, 'Invasion of Dominaria');
    c.counters.defense = defense;
    c.protector = protector;
    return c;
  };

  it('enters with its printed loyalty, and a loyalty ability adds or removes counters as its cost (306.5b, 606.4)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Island', 'battlefield', 3);
      put(d, 0, 'Jace Beleren', 'hand');
    });
    g = run(g, { type: 'cast', card: byName(g, 0, 'Jace Beleren', 'hand')!.id });
    const jace = byName(g, 0, 'Jace Beleren')!;
    expect(jace.counters).toEqual({ loyalty: 3 });
    const hands = g.players.map((p) => p.hand.length);
    g = run(g, { type: 'activate', card: jace.id, ability: 0 });
    expect(byName(g, 0, 'Jace Beleren')!.counters.loyalty).toBe(5);
    expect(g.players.map((p) => p.hand.length)).toEqual(hands.map((n) => n + 1));
    expect(g.log.some((l) => l.text.includes("activates Jace Beleren's +2"))).toBe(true);
  });

  it('allows one loyalty ability a turn, only at sorcery speed (606.3)', () => {
    let g = emptyGame((d) => walker(d, 0, 'Jace Beleren', 3));
    const jace = byName(g, 0, 'Jace Beleren')!;
    g = run(g, { type: 'activate', card: jace.id, ability: 1, targets: [player(0)] });
    expect(canActivate(g, 0, byName(g, 0, 'Jace Beleren')!, 0)).toBe(false);
    expect(applyAction(g, { type: 'activate', card: jace.id, ability: 0 })).toBe(g);
    // Not in another player's turn.
    const theirs = emptyGame((d) => {
      walker(d, 1, 'Jace Beleren', 3);
      d.priority = 1;
    });
    expect(canActivate(theirs, 1, byName(theirs, 1, 'Jace Beleren')!, 0)).toBe(false);
  });

  it("can't pay a minus cost with too little loyalty (606.6)", () => {
    const g = emptyGame((d) => walker(d, 0, 'Jace Beleren', 3));
    const jace = byName(g, 0, 'Jace Beleren')!;
    expect(canActivate(g, 0, jace, 1)).toBe(true);
    expect(canActivate(g, 0, jace, 2)).toBe(false); // −10
  });

  it('goes to the graveyard with no loyalty left (704.5i)', () => {
    let g = emptyGame((d) => walker(d, 0, 'Jace Beleren', 1));
    g = run(g, { type: 'activate', card: byName(g, 0, 'Jace Beleren')!.id, ability: 1, targets: [player(0)] });
    expect(byName(g, 0, 'Jace Beleren', 'graveyard')).toBeDefined();
    // The ability still resolves without its source (113.7a).
    expect(g.players[0].hand).toHaveLength(1);
  });

  it('loses loyalty when dealt damage, and "any target" can name it (115.4, 120.3c)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Mountain', 'battlefield', 5);
      put(d, 0, 'Lightning Bolt', 'hand');
      put(d, 0, 'Lava Axe', 'hand');
      walker(d, 1, 'Jace Beleren', 4);
      put(d, 1, 'Walking Corpse');
    });
    const jace = byName(g, 1, 'Jace Beleren')!;
    const corpse = byName(g, 1, 'Walking Corpse')!;
    const axe = scriptOf('Lava Axe').targets![0];
    // "Target player or planeswalker" can't name a creature.
    expect(legalTargets(g, 0, axe, jace)).toContainEqual(ref(jace));
    expect(legalTargets(g, 0, axe, jace)).not.toContainEqual(ref(corpse));
    g = run(g, { type: 'cast', card: byName(g, 0, 'Lightning Bolt', 'hand')!.id, targets: [ref(jace)] });
    expect(byName(g, 1, 'Jace Beleren')!.counters.loyalty).toBe(1);
    expect(byName(g, 1, 'Jace Beleren')!.damage).toBe(0);
  });

  it("is attacked: unblocked damage removes loyalty, not the controller's life (506.3, 508.1b, 510.1b)", () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Kalonian Tusker'); // 3/3
      walker(d, 1, 'Jace Beleren', 3);
    });
    const tusker = byName(g, 0, 'Kalonian Tusker')!;
    const jace = byName(g, 1, 'Jace Beleren')!;
    g = run(g, pass);
    expect(attackOptions(g, 0)).toContainEqual({ defender: 1, target: jace.id });
    // The defending player must be its controller.
    expect(applyAction(g, { type: 'declareAttack', card: tusker.id, defender: 2, target: jace.id })).toBe(g);
    g = run(g, { type: 'declareAttack', card: tusker.id, defender: 1, target: jace.id }, pass);
    expect(byName(g, 1, 'Jace Beleren', 'graveyard')).toBeDefined();
    expect(g.players[1].life).toBe(40);
    expect(g.log.some((l) => l.text.includes('Kalonian Tusker → Jace Beleren'))).toBe(true);
  });

  it("lets only the planeswalker's controller block for it (509.1a)", () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Kalonian Tusker');
      walker(d, 1, 'Jace Beleren', 3);
      put(d, 1, 'Walking Corpse');
      put(d, 2, 'Walking Corpse');
    });
    const jace = byName(g, 1, 'Jace Beleren')!;
    g = run(g, pass, { type: 'declareAttack', card: byName(g, 0, 'Kalonian Tusker')!.id, defender: 1, target: jace.id }, pass);
    expect(g.decision?.type).toBe('blockers');
    expect(g.combat!.toBlock).toEqual([1]);
  });

  it('deals trample damage over a blocker to the planeswalker attacked (702.19b)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Kalonian Tusker');
      walker(d, 1, 'Jace Beleren', 5);
      put(d, 1, 'Walking Corpse'); // 2/2
    });
    const tusker = byName(g, 0, 'Kalonian Tusker')!;
    g = produce(g, (d) => void pump(d, byName(d, 0, 'Kalonian Tusker'), 0, 0, ['trample']));
    const jace = byName(g, 1, 'Jace Beleren')!;
    g = run(
      g,
      pass,
      { type: 'declareAttack', card: tusker.id, defender: 1, target: jace.id },
      pass,
      { type: 'declareBlock', blocker: byName(g, 1, 'Walking Corpse')!.id, attacker: tusker.id },
      pass,
    );
    expect(byName(g, 1, 'Jace Beleren')!.counters.loyalty).toBe(4);
    expect(g.players[1].life).toBe(40);
  });

  it('a battle enters with its printed defense, protected by the opponent chosen (310.4b, 310.12a)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Plains', 'battlefield', 3);
      put(d, 0, 'Invasion of Dominaria', 'hand');
    });
    const card = byName(g, 0, 'Invasion of Dominaria', 'hand')!;
    // The caster can't protect their own Siege.
    expect(canCast(g, 0, card, { protector: 0 })).toBe(false);
    g = run(g, { type: 'cast', card: card.id, protector: 2 });
    const battle = byName(g, 0, 'Invasion of Dominaria')!;
    expect(battle.counters).toEqual({ defense: 5 });
    expect(battle.protector).toBe(2);
    expect(g.players[0].life).toBe(44); // its enters ability
  });

  it("can be attacked by its controller but not its protector, and the protector blocks (310.9b-c)", () => {
    const g = emptyGame((d) => {
      siege(d, 0, 1);
      put(d, 0, 'Kalonian Tusker');
    });
    const battle = byName(g, 0, 'Invasion of Dominaria')!;
    expect(attackOptions(g, 0)).toContainEqual({ defender: 1, target: battle.id });
    expect(attackOptions(g, 2)).toContainEqual({ defender: 1, target: battle.id });
    expect(attackOptions(g, 1).some((o) => o.target === battle.id)).toBe(false);
  });

  it('is exiled when defeated, staying until its defeat ability resolves, then cast transformed (310.12b, 704.5v)', () => {
    let g = emptyGame((d) => {
      siege(d, 0, 1, 3);
      put(d, 0, 'Kalonian Tusker');
    });
    const battle = byName(g, 0, 'Invasion of Dominaria')!;
    while (g.step !== 'attackers') g = runWith({ autoPass: false }, g, pass);
    g = runWith({ autoPass: false }, g, { type: 'declareAttack', card: byName(g, 0, 'Kalonian Tusker')!.id, defender: 1, target: battle.id }, pass);
    while (g.step !== 'damage') g = runWith({ autoPass: false }, g, pass);
    // Damaged to 0, it is defeated but waits on the stack's ability before leaving.
    expect(byName(g, 0, 'Invasion of Dominaria')!.counters.defense).toBeUndefined();
    expect(g.stack.map((x) => x.hook)).toEqual(['onDefeat']);
    g = runWith({ autoPass: false }, g, pass, pass, pass, pass);
    expect(g.log.some((l) => l.text === 'Invasion of Dominaria is defeated.')).toBe(true);
    expect(g.log.some((l) => l.text === 'Invasion of Dominaria is exiled.')).toBe(true);
    // It was cast from exile with its back face up, for free (712.11a).
    expect(g.stack.map((x) => label(x.card))).toEqual(['Serra Faithkeeper']);
    g = run(g, pass);
    const angel = byName(g, 0, 'Invasion of Dominaria')!;
    expect(label(angel)).toBe('Serra Faithkeeper');
    expect(stats(g, angel)).toMatchObject({ power: 4, toughness: 4 });
    expect(stats(g, angel).keywords.has('flying')).toBe(true);
    // A transformed permanent's mana value is its front face's (712.8e).
    expect(data(angel).cmc).toBe(3);
  });

  it('gets a new protector when its protector leaves the game (310.11)', () => {
    let g = emptyGame((d) => siege(d, 0, 1));
    g = produce(g, (d) => {
      d.players[1].life = 0;
      checkState(d);
    });
    const protector = byName(g, 0, 'Invasion of Dominaria')!.protector;
    expect([2, 3]).toContain(protector);
  });

  it('bots attack a planeswalker they can kill', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Kalonian Tusker');
      walker(d, 1, 'Jace Beleren', 3);
    });
    g = run(g, pass);
    expect(botAction(g, 0)).toMatchObject({ type: 'declareAttack', defender: 1, target: byName(g, 1, 'Jace Beleren')!.id });
  });

  it('bots use loyalty abilities', () => {
    const g = emptyGame((d) => walker(d, 0, 'Garruk Wildspeaker', 3));
    expect(botAction(g, 0)).toMatchObject({ type: 'activate', card: byName(g, 0, 'Garruk Wildspeaker')!.id });
    expect((botAction(g, 0) as { ability?: number }).ability).toBeDefined();
  });

  it('bots chump block to save a planeswalker the attack would kill', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Kalonian Tusker');
      walker(d, 1, 'Jace Beleren', 3);
      put(d, 1, 'Raging Goblin');
    });
    const jace = byName(g, 1, 'Jace Beleren')!;
    g = run(g, pass, { type: 'declareAttack', card: byName(g, 0, 'Kalonian Tusker')!.id, defender: 1, target: jace.id }, pass);
    expect(botAction(g, 1)).toMatchObject({ type: 'declareBlock', blocker: byName(g, 1, 'Raging Goblin')!.id });
  });
});

describe('card faces, Sagas, Classes, flashback and tokens (709, 712, 714, 715, 716, 702.34, 111.10)', () => {
  const ref = (c: { id: string }) => ({ kind: 'card', id: c.id }) as const;
  const cast = (g: Game, name: string, extra: object = {}, zone: 'hand' | 'graveyard' | 'exile' = 'hand') =>
    ({ type: 'cast', card: byName(g, 0, name, zone)!.id, ...extra }) as Action;
  /** Passes until player 0's next precombat main phase. */
  const nextTurn = (g: Game) => {
    const turn = g.turn;
    while (!(g.active === 0 && g.step === 'main1' && g.turn > turn && !g.stack.length && !g.decision)) g = run(g, pass);
    return g;
  };

  it("transforms: the back face's characteristics, and the front face again off the battlefield (701.27, 712.8)", () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Delver of Secrets');
      d.players[0].library.unshift(makeCard(d, 'Lightning Bolt', 0, 'library'));
    });
    const delver = byName(g, 0, 'Delver of Secrets')!;
    expect(label(delver)).toBe('Delver of Secrets');
    g = nextTurn(g);
    const bug = byName(g, 0, 'Delver of Secrets')!;
    expect(label(bug)).toBe('Insectile Aberration');
    expect(stats(g, bug)).toMatchObject({ power: 3, toughness: 2 });
    expect(stats(g, bug).keywords.has('flying')).toBe(true);
    expect(g.log.some((l) => l.text === 'Delver of Secrets transforms into Insectile Aberration.')).toBe(true);
    g = produce(g, (d) => destroy(d, byName(d, 0, 'Delver of Secrets')));
    expect(label(byName(g, 0, 'Delver of Secrets', 'graveyard')!)).toBe('Delver of Secrets');
  });

  it("doesn't transform a card with one face (712.9)", () => {
    const g = produce(
      emptyGame((d) => void put(d, 0, 'Kalonian Tusker')),
      (d) => transform(d, byName(d, 0, 'Kalonian Tusker')),
    );
    expect(byName(g, 0, 'Kalonian Tusker')!.face).toBe(0);
  });

  it('plays a modal double-faced card as either face: a spell, or its land face (712.11b, 712.12)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Kazandu Mammoth', 'hand');
      put(d, 0, 'Needleverge Pathway', 'hand');
    });
    const mammoth = byName(g, 0, 'Kazandu Mammoth', 'hand')!;
    expect(castFaces(mammoth)).toEqual([0]);
    expect(landFaces(mammoth)).toEqual([1]);
    expect(canPlayLand(g, 0, mammoth, 0)).toBe(false);
    g = run(g, { type: 'playLand', card: mammoth.id, face: 1 });
    const valley = byName(g, 0, 'Kazandu Mammoth')!;
    expect(label(valley)).toBe('Kazandu Valley');
    expect(valley.tapped).toBe(true); // "enters tapped" is the back face's
    // A pathway: both faces are lands, and the one played decides its colour.
    g = produce(g, (d) => void (d.players[0].landsPlayed = 0));
    g = run(g, { type: 'playLand', card: byName(g, 0, 'Needleverge Pathway', 'hand')!.id, face: 1 });
    expect(label(byName(g, 0, 'Needleverge Pathway')!)).toBe('Pillarverge Pathway');
    g = run(g, { type: 'tapMana', card: byName(g, 0, 'Needleverge Pathway')!.id });
    expect(g.players[0].pool.map((m) => m.sym)).toEqual(['W']);
  });

  it('casts one half of a split card; elsewhere it has both halves combined (709.3, 709.4)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Mountain', 'battlefield', 3);
      put(d, 0, 'Dead', 'hand');
      put(d, 1, 'Walking Corpse');
    });
    const card = byName(g, 0, 'Dead', 'hand')!;
    expect(data(card).cmc).toBe(4);
    expect(costText(castCost(g, card, { face: 0 }))).toBe('{R}');
    expect(costText(castCost(g, card, { face: 1 }))).toBe('{2}{R}');
    const corpse = byName(g, 1, 'Walking Corpse')!;
    g = run(g, cast(g, 'Dead', { face: 1, targets: [ref(corpse)] }));
    expect(byName(g, 1, 'Walking Corpse', 'hand')).toBeDefined();
    expect(g.log.some((l) => l.text.endsWith('casts Gone targeting Walking Corpse.'))).toBe(true);
    expect(label(byName(g, 0, 'Dead', 'graveyard')!)).toBe('Dead // Gone');
  });

  it('casts an Adventure, exiles it, then casts the creature from exile (715.3, 715.3d)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Swamp', 'battlefield', 6);
      put(d, 0, 'Murderous Rider', 'hand');
      put(d, 1, 'Walking Corpse');
    });
    g = run(g, cast(g, 'Murderous Rider', { face: 1, targets: [ref(byName(g, 1, 'Walking Corpse')!)] }));
    expect(byName(g, 1, 'Walking Corpse')).toBeUndefined();
    expect(g.players[0].life).toBe(38);
    const exiled = byName(g, 0, 'Murderous Rider', 'exile')!;
    expect(exiled.adventure).toBe(true);
    // Not as an Adventure again (715.3d).
    expect(castFaces(exiled)).toEqual([0]);
    g = run(g, cast(g, 'Murderous Rider', {}, 'exile'));
    const rider = byName(g, 0, 'Murderous Rider')!;
    expect(label(rider)).toBe('Murderous Rider');
    expect(stats(g, rider).keywords.has('lifelink')).toBe(true);
  });

  it('a countered Adventure goes to the graveyard, not exile (715.3d)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Swamp', 'battlefield', 3);
      put(d, 0, 'Murderous Rider', 'hand');
      put(d, 1, 'Walking Corpse');
      put(d, 1, 'Island', 'battlefield', 2);
      put(d, 1, 'Counterspell', 'hand');
    });
    g = run(g, cast(g, 'Murderous Rider', { face: 1, targets: [ref(byName(g, 1, 'Walking Corpse')!)] }));
    g = run(g, { type: 'cast', card: byName(g, 1, 'Counterspell', 'hand')!.id, targets: [{ kind: 'stack', id: g.stack[0].id }] });
    expect(byName(g, 0, 'Murderous Rider', 'graveyard')).toBeDefined();
  });

  it('runs a Saga: a chapter as it enters and each precombat main phase, then sacrifices it (714)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Plains', 'battlefield', 3);
      put(d, 0, 'History of Benalia', 'hand');
    });
    g = run(g, cast(g, 'History of Benalia'));
    const knights = (g: Game) => g.players[0].battlefield.filter((c) => label(c) === 'Knight');
    expect(byName(g, 0, 'History of Benalia')!.counters.lore).toBe(1);
    expect(knights(g)).toHaveLength(1);
    g = nextTurn(g);
    expect(knights(g)).toHaveLength(2);
    g = nextTurn(g);
    // Chapter III pumps the Knights, then the Saga is sacrificed (714.4).
    expect(knights(g).map((k) => stats(g, k).power)).toEqual([4, 4]);
    expect(byName(g, 0, 'History of Benalia')).toBeUndefined();
    expect(byName(g, 0, 'History of Benalia', 'graveyard')).toBeDefined();
  });

  it('levels up a Class one level at a time, as a sorcery (716.2a)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Island', 'battlefield', 9);
      put(d, 0, 'Wizard Class');
      put(d, 0, 'Walking Corpse');
    });
    const wc = byName(g, 0, 'Wizard Class')!;
    expect(canActivate(g, 0, wc, 1)).toBe(false); // level 3 needs level 2 first
    g = run(g, { type: 'activate', card: wc.id, ability: 0 });
    expect(byName(g, 0, 'Wizard Class')!.level).toBe(2);
    expect(g.players[0].hand).toHaveLength(2); // "when this Class becomes level 2"
    expect(canActivate(g, 0, byName(g, 0, 'Wizard Class')!, 0)).toBe(false);
    g = run(g, { type: 'activate', card: wc.id, ability: 1 });
    expect(byName(g, 0, 'Wizard Class')!.level).toBe(3);
    // Level 3: drawing puts a +1/+1 counter on a creature.
    g = produce(g, (d) => draw(d, 0, 1));
    g = run(g, pass);
    expect(g.decision?.type).toBe('targets');
    g = run(g, { type: 'chooseTargets', targets: [ref(byName(g, 0, 'Walking Corpse')!)] });
    expect(byName(g, 0, 'Walking Corpse')!.counters['+1/+1']).toBe(1);
    expect(maxHandSize(g, 0)).toBe(Infinity);
  });

  it('casts a flashback card from the graveyard for its flashback cost, then exiles it (702.34a)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Island', 'battlefield', 5);
      put(d, 0, 'Think Twice', 'hand');
    });
    g = run(g, cast(g, 'Think Twice'));
    const card = byName(g, 0, 'Think Twice', 'graveyard')!;
    expect(costText(castCost(g, card))).toBe('{2}{U}');
    g = run(g, cast(g, 'Think Twice', {}, 'graveyard'));
    expect(byName(g, 0, 'Think Twice', 'exile')).toBeDefined();
    expect(g.players[0].hand).toHaveLength(2);
    expect(g.log.some((l) => l.text.endsWith('casts Think Twice (flashback).'))).toBe(true);
  });

  it('Treasure is sacrificed for one mana of any colour; auto-pay saves it for last (111.10a)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Mountain');
      put(d, 0, 'Strike It Rich', 'hand');
      put(d, 0, 'Lightning Bolt', 'hand');
      put(d, 0, 'Think Twice', 'hand');
    });
    g = run(g, cast(g, 'Strike It Rich'));
    expect(byName(g, 0, 'Treasure')).toBeDefined();
    // Bolt is paid with... nothing left but the Treasure: the Mountain paid for Strike It Rich.
    expect(canCast(g, 0, byName(g, 0, 'Think Twice', 'hand')!)).toBe(false);
    g = run(g, cast(g, 'Lightning Bolt', { targets: [{ kind: 'player', id: 1 }] }));
    expect(byName(g, 0, 'Treasure')).toBeUndefined();
    expect(g.log.some((l) => l.text === 'Treasure is sacrificed.')).toBe(true);
  });

  it('Food gains 3 life and Clue draws a card (111.10b, 111.10f)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Plains', 'battlefield', 4);
      createToken(d, 0, 'Food');
      createToken(d, 0, 'Clue');
    });
    g = run(g, { type: 'activate', card: byName(g, 0, 'Food')!.id });
    expect(g.players[0].life).toBe(43);
    g = run(g, { type: 'activate', card: byName(g, 0, 'Clue')!.id });
    expect(g.players[0].hand).toHaveLength(1);
    expect(g.players[0].battlefield.filter((c) => c.isToken)).toEqual([]);
  });
});

describe('combat', () => {
  it('lets each attacker pick its own defender', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Kalonian Tusker');
      put(d, 0, 'Leatherback Baloth');
    });
    const [a, b] = g.players[0].battlefield;
    g = run(g, pass, { type: 'declareAttack', card: a.id, defender: 1 }, { type: 'declareAttack', card: b.id, defender: 3 }, pass);
    expect(g.players.map((p) => p.life)).toEqual([40, 37, 40, 36]);
    // Player 0 always stops in main 2; passing that, the turn runs out and player 1's begins.
    expect(g.step).toBe('main2');
    g = run(g, pass);
    expect([g.active, g.step]).toEqual([1, 'main1']);
  });

  it('asks only attacked players who can block, in turn order', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Kalonian Tusker');
      put(d, 0, 'Leatherback Baloth');
      put(d, 1, 'Walking Corpse');
      put(d, 2, 'Walking Corpse');
      put(d, 3, 'Walking Corpse');
    });
    const [a, b] = g.players[0].battlefield;
    g = run(g, pass, { type: 'declareAttack', card: a.id, defender: 3 }, { type: 'declareAttack', card: b.id, defender: 1 }, pass);
    expect(g.step).toBe('blockers');
    expect(g.priority).toBe(1);
    g = run(g, pass);
    expect(g.priority).toBe(3);
    const corpse = g.players[3].battlefield[0];
    g = run(g, { type: 'declareBlock', blocker: corpse.id, attacker: a.id }, pass);
    expect(onBattlefield(g, corpse.id)).toBe(false);
    expect(g.players[1].life).toBe(36);
    expect(g.players[3].life).toBe(40);
  });

  it('enforces flying, deathtouch, first strike, trample and lifelink', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Serra Angel'); // 4/4 flying vigilance
      put(d, 0, 'Colossal Dreadmaw'); // 6/6 trample
      put(d, 0, 'Child of Night'); // 2/1 lifelink
      put(d, 0, 'Youthful Knight'); // 2/1 first strike
      put(d, 1, 'Walking Corpse'); // 2/2
      put(d, 1, 'Typhoid Rats'); // 1/1 deathtouch
      put(d, 1, 'Goblin Piker'); // 2/1
    });
    const [angel, maw, child, knight] = g.players[0].battlefield;
    const [corpse, rats, piker] = g.players[1].battlefield;
    g = run(g, pass, ...[angel, maw, child, knight].map((c) => ({ type: 'declareAttack', card: c.id, defender: 1 }) as const), pass);
    // Ground creatures can't block a flyer.
    expect(applyAction(g, { type: 'declareBlock', blocker: corpse.id, attacker: angel.id })).toBe(g);
    g = run(
      g,
      { type: 'declareBlock', blocker: rats.id, attacker: maw.id },
      { type: 'declareBlock', blocker: piker.id, attacker: knight.id },
      pass,
    );
    expect(onBattlefield(g, maw.id)).toBe(false); // deathtouch
    expect(onBattlefield(g, knight.id)).toBe(true); // first strike killed the Piker first
    expect(onBattlefield(g, piker.id)).toBe(false);
    // 4 (angel) + 5 trample over the 1/1 + 2 (child) = 11
    expect(g.players[1].life).toBe(29);
    expect(g.players[0].life).toBe(42); // lifelink
    expect(g.players[0].battlefield.find((c) => c.id === angel.id)!.tapped).toBe(false); // vigilance
  });

  it('keeps summoning-sick creatures home unless they have haste', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Raging Goblin').sick = true; // haste
      put(d, 0, 'Goblin Piker').sick = true;
    });
    const [goblin, piker] = g.players[0].battlefield;
    g = run(g, pass);
    expect(applyAction(g, { type: 'declareAttack', card: piker.id, defender: 1 })).toBe(g);
    g = run(g, { type: 'declareAttack', card: goblin.id, defender: 2 }, pass);
    expect(g.players[2].life).toBe(39);
  });
});

describe('card scripts', () => {
  it('Torbran adds 2 to red damage dealt to opponents', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Torbran, Thane of Red Fell');
      put(d, 0, 'Mountain', 'battlefield', 2);
      put(d, 0, 'Lightning Bolt', 'hand');
    });
    g = run(g, { type: 'cast', card: byName(g, 0, 'Lightning Bolt', 'hand')!.id, targets: [{ kind: 'player', id: 2 }] });
    expect(g.players[2].life).toBe(35);
    g = emptyGame((d) => {
      put(d, 0, 'Torbran, Thane of Red Fell');
      put(d, 0, 'Mountain', 'battlefield', 2);
      put(d, 0, 'Flame Rift', 'hand');
    });
    g = run(g, { type: 'cast', card: byName(g, 0, 'Flame Rift', 'hand')!.id });
    expect(g.players.map((p) => p.life)).toEqual([36, 34, 34, 34]);
  });

  it('Sheoldred drains opponents who draw and feeds its controller', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Sheoldred, the Apocalypse');
    });
    // To combat, declare no attackers, pass main 2: the turn ends and player 1 draws in their draw step.
    g = run(g, pass, pass, pass);
    expect(g.active).toBe(1);
    expect(g.players[1].life).toBe(38);
  });

  it('wraths trigger every death at once (Zulaport sees creatures that died with it)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Swamp', 'battlefield', 4);
      put(d, 0, 'Damnation', 'hand');
      put(d, 0, 'Zulaport Cutthroat');
      put(d, 0, 'Walking Corpse');
      put(d, 1, 'Gigantosaurus');
    });
    g = run(g, { type: 'cast', card: byName(g, 0, 'Damnation', 'hand')!.id });
    expect(g.players.flatMap((p) => p.battlefield).filter((c) => c.name !== 'Swamp')).toEqual([]);
    expect(g.players.map((p) => p.life)).toEqual([42, 38, 38, 38]);
  });

  it('static bonuses and tokens work (Captain of the Watch)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Plains', 'battlefield', 6);
      put(d, 0, 'Captain of the Watch', 'hand');
    });
    g = run(g, { type: 'cast', card: byName(g, 0, 'Captain of the Watch', 'hand')!.id });
    const soldiers = g.players[0].battlefield.filter((c) => c.isToken);
    expect(soldiers.length).toBe(3);
    expect(stats(g, soldiers[0])).toMatchObject({ power: 2, toughness: 2 });
    expect(stats(g, soldiers[0]).keywords.has('vigilance')).toBe(true);
  });

  it('pays coloured costs with lands and generic costs with Sol Ring first', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Sol Ring');
      put(d, 0, 'Swamp', 'battlefield', 2);
      put(d, 0, 'Murder', 'hand'); // {1}{B}{B}
      put(d, 1, 'Gigantosaurus');
    });
    const target = g.players[1].battlefield[0];
    g = run(g, { type: 'cast', card: byName(g, 0, 'Murder', 'hand')!.id, targets: [{ kind: 'card', id: target.id }] });
    expect(g.players[0].battlefield.filter((c) => c.name === 'Swamp' && c.tapped).length).toBe(2);
    expect(byName(g, 0, 'Sol Ring')!.tapped).toBe(true);
    expect(g.players[0].pool.map((m) => m.sym)).toEqual(['C']); // one colourless left floating
  });

  it('taps a land for mana by hand and takes it back', () => {
    let g = emptyGame((d) => put(d, 0, 'Swamp'));
    const swamp = byName(g, 0, 'Swamp')!;
    g = run(g, { type: 'tapMana', card: swamp.id });
    expect(byName(g, 0, 'Swamp')!.tapped).toBe(true);
    expect(g.players[0].pool.map((m) => m.sym)).toEqual(['B']);
    g = run(g, { type: 'untapMana', card: swamp.id });
    expect(byName(g, 0, 'Swamp')!.tapped).toBe(false);
    expect(g.players[0].pool).toEqual([]);
  });

  it('spends the pool before tapping anything else', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Swamp', 'battlefield', 3);
      put(d, 0, 'Sol Ring', 'hand'); // {1}
    });
    const [first, second] = g.players[0].battlefield;
    g = run(g, { type: 'tapMana', card: first.id }, { type: 'tapMana', card: second.id });
    g = run(g, { type: 'cast', card: byName(g, 0, 'Sol Ring', 'hand')!.id });
    expect(g.players[0].battlefield.filter((c) => c.name === 'Swamp' && c.tapped).length).toBe(2);
    expect(g.players[0].pool.length).toBe(1);
  });

  it('only lets a land untap while its mana is unspent', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Swamp', 'battlefield', 2);
      put(d, 0, 'Sol Ring', 'hand'); // {1}
    });
    const [spent, floating] = g.players[0].battlefield;
    g = run(g, { type: 'tapMana', card: spent.id }, { type: 'tapMana', card: floating.id });
    g = run(g, { type: 'cast', card: byName(g, 0, 'Sol Ring', 'hand')!.id });
    expect(applyAction(g, { type: 'untapMana', card: spent.id })).toBe(g);
    g = run(g, { type: 'untapMana', card: floating.id });
    expect(g.players[0].pool).toEqual([]);
  });

  it('empties the pool when the step changes, and the land stays tapped', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Swamp');
      put(d, 0, 'Gigantosaurus'); // something to attack with, so passing only moves to combat
    });
    const swamp = byName(g, 0, 'Swamp')!;
    g = run(g, { type: 'tapMana', card: swamp.id }, pass);
    expect(g.step).toBe('attackers');
    expect(g.players[0].pool).toEqual([]);
    expect(applyAction(g, { type: 'untapMana', card: swamp.id })).toBe(g);
  });
});

describe('turn structure', () => {
  const byHand = { autoPass: false };

  it('goes through every step in order, skipping blocks and damage when nobody attacks (500.1, 508.8)', () => {
    let g = emptyGame();
    const seen: string[] = [];
    while (g.turn === 1 || g.step !== 'main1') {
      if (seen[seen.length - 1] !== g.step) seen.push(g.step);
      g = runWith(byHand, g, pass);
    }
    // No one gets priority in the untap or cleanup steps (502.4, 514.3), so they never wait on a pass.
    expect(seen).toEqual(['main1', 'beginCombat', 'attackers', 'endCombat', 'main2', 'end', 'upkeep', 'draw']);
    expect(g.active).toBe(1);
  });

  it('ends a step only after every player passes in a row (117.4)', () => {
    let g = emptyGame();
    for (const next of [1, 2, 3]) {
      g = runWith(byHand, g, pass);
      expect([g.step, g.priority]).toEqual(['main1', next]);
    }
    g = runWith(byHand, g, pass);
    expect([g.step, g.priority]).toEqual(['beginCombat', 0]);
  });

  it('untaps, then draws a card in the draw step (502.3, 504.1)', () => {
    let g = emptyGame((d) => {
      put(d, 1, 'Forest').tapped = true;
      put(d, 1, 'Kalonian Tusker').sick = true;
    });
    // Past player 0's stops in main 1 and main 2.
    g = run(g, pass, pass);
    expect([g.active, g.step]).toEqual([1, 'main1']);
    expect(g.players[1].hand.length).toBe(1);
    expect(g.players[1].battlefield.some((c) => c.tapped || c.sick)).toBe(false);
  });

  it('discards down to seven and wears off damage in the cleanup step (514.1, 514.2)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Plains', 'hand', 9);
      put(d, 0, 'Mountain');
      put(d, 0, 'Shock', 'hand');
      put(d, 1, 'Kalonian Tusker'); // 3/3
    });
    const tusker = byName(g, 1, 'Kalonian Tusker')!;
    g = run(g, { type: 'cast', card: byName(g, 0, 'Shock', 'hand')!.id, targets: [{ kind: 'card', id: tusker.id }] });
    expect(byName(g, 1, 'Kalonian Tusker')!.damage).toBe(2);
    g = run(g, pass, pass); // both main phases: there is a land to play, so the second one stops too
    expect([g.step, g.decision?.type, g.priority]).toEqual(['cleanup', 'discard', 0]);
    const [a, b] = g.players[0].hand;
    g = run(g, { type: 'discard', card: a.id }, { type: 'discard', card: b.id });
    expect(g.players[0].hand.length).toBe(7);
    expect(g.active).toBe(1);
    expect(byName(g, 1, 'Kalonian Tusker')!.damage).toBe(0);
  });

  it('allows one land a turn, only in your own main phase with the stack empty (305.1, 305.2)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Plains', 'hand', 2);
      put(d, 1, 'Forest', 'hand');
    });
    const [first, second] = g.players[0].hand;
    expect(canPlayLand(g, 1, g.players[1].hand[0])).toBe(false);
    g = run(g, { type: 'playLand', card: first.id });
    expect(applyAction(g, { type: 'playLand', card: second.id })).toBe(g);
  });
});

describe('the stack', () => {
  const shockVsGrowth = () =>
    emptyGame((d) => {
      put(d, 0, 'Mountain');
      put(d, 0, 'Shock', 'hand');
      put(d, 1, 'Forest');
      put(d, 1, 'Giant Growth', 'hand');
      put(d, 1, 'Kalonian Tusker', 'hand');
      put(d, 1, 'Walking Corpse'); // 2/2
    });
  const castShock = (g: Game) => {
    const corpse = byName(g, 1, 'Walking Corpse')!;
    return run(g, { type: 'cast', card: byName(g, 0, 'Shock', 'hand')!.id, targets: [{ kind: 'card', id: corpse.id }] });
  };

  it('holds a spell until every player passes, then resolves it (601.2a, 117.4)', () => {
    let g = castShock(shockVsGrowth());
    expect(g.stack.map((x) => x.card.name)).toEqual(['Shock']);
    expect(g.stack[0].card.zone).toBe('stack');
    expect(byName(g, 1, 'Walking Corpse')).toBeDefined();
    // Player 1 could respond, so the game stops for them. The others were passed automatically.
    expect(g.priority).toBe(1);
    g = run(g, pass);
    expect(g.stack).toEqual([]);
    expect(byName(g, 1, 'Walking Corpse')).toBeUndefined();
    expect(g.players[0].graveyard.map((c) => c.name)).toEqual(['Shock']);
    expect([g.step, g.priority]).toEqual(['main1', 0]); // the active player gets priority back (117.3b)
  });

  it('resolves the last thing added first (117.7, 405.5)', () => {
    let g = castShock(shockVsGrowth());
    const corpse = byName(g, 1, 'Walking Corpse')!;
    g = run(g, { type: 'cast', card: byName(g, 1, 'Giant Growth', 'hand')!.id, targets: [{ kind: 'card', id: corpse.id }] });
    // Giant Growth resolved first, so Shock hit a 5/5.
    expect(g.stack).toEqual([]);
    expect(byName(g, 1, 'Walking Corpse')!.damage).toBe(2);
  });

  it('only lets instants be cast in response or on another turn (117.1a)', () => {
    let g = shockVsGrowth();
    const tusker = byName(g, 1, 'Kalonian Tusker', 'hand')!;
    expect(canCast(g, 1, tusker)).toBe(false); // no priority
    g = castShock(g);
    expect(canCast(g, 1, tusker)).toBe(false); // priority, but not their main phase
    expect(canCast(g, 1, byName(g, 1, 'Giant Growth', 'hand')!)).toBe(true);
  });

  it('does nothing when its only target is gone by the time it resolves (608.2b)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Swamp', 'battlefield', 3);
      put(d, 0, 'Murder', 'hand');
      put(d, 1, 'Mogg Fanatic');
    });
    const fanatic = byName(g, 1, 'Mogg Fanatic')!;
    g = run(g, { type: 'cast', card: byName(g, 0, 'Murder', 'hand')!.id, targets: [{ kind: 'card', id: fanatic.id }] });
    expect(g.priority).toBe(1);
    // In response, sacrifice the Fanatic. The ability is on the stack without its source (113.7a).
    g = run(g, { type: 'activate', card: fanatic.id, targets: [{ kind: 'player', id: 0 }] });
    expect(g.stack).toEqual([]);
    expect(g.players[0].life).toBe(39);
    expect(g.players[0].graveyard.map((c) => c.name)).toEqual(['Murder']);
    expect(g.log.some((l) => l.text.includes('no legal target'))).toBe(true);
  });

  it('puts a permanent spell onto the battlefield when it resolves, and its enters ability on the stack (608.3, 603.3)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Forest', 'battlefield', 2);
      put(d, 0, 'Elvish Visionary', 'hand');
    });
    const byHand = { autoPass: false };
    g = runWith(byHand, g, { type: 'cast', card: byName(g, 0, 'Elvish Visionary', 'hand')!.id });
    expect(byName(g, 0, 'Elvish Visionary')).toBeUndefined();
    g = runWith(byHand, g, pass, pass, pass, pass);
    expect(byName(g, 0, 'Elvish Visionary')).toBeDefined();
    expect(g.stack.map((x) => [x.kind, x.card.name])).toEqual([['triggered', 'Elvish Visionary']]);
    expect(g.players[0].hand.length).toBe(0);
    g = runWith(byHand, g, pass, pass, pass, pass);
    expect(g.players[0].hand.length).toBe(1);
  });

  it('chooses targets for a triggered ability as it goes on the stack (603.3d)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Mountain', 'battlefield', 4);
      put(d, 0, 'Flametongue Kavu', 'hand');
      put(d, 1, 'Leatherback Baloth'); // 4/5
    });
    const baloth = byName(g, 1, 'Leatherback Baloth')!;
    g = run(g, { type: 'cast', card: byName(g, 0, 'Flametongue Kavu', 'hand')!.id });
    expect([g.decision?.type, g.priority]).toEqual(['targets', 0]);
    expect(applyAction(g, pass)).toBe(g); // "target creature" isn't optional
    g = run(g, { type: 'chooseTargets', targets: [{ kind: 'card', id: baloth.id }] });
    expect(byName(g, 1, 'Leatherback Baloth')!.damage).toBe(4);
    expect([g.decision, g.priority]).toEqual([null, 0]);
  });

  it('drops a triggered ability that has no legal target (603.3d)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Swamp', 'battlefield', 4);
      put(d, 0, 'Ravenous Chupacabra', 'hand');
    });
    g = run(g, { type: 'cast', card: byName(g, 0, 'Ravenous Chupacabra', 'hand')!.id });
    expect(byName(g, 0, 'Ravenous Chupacabra')).toBeDefined();
    expect([g.decision, g.stack]).toEqual([null, []]);
  });

  it("puts the active player's triggers on the stack first, so they resolve last (603.3b)", () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Soul Warden');
      put(d, 2, 'Soul Warden');
      put(d, 1, 'Soul Warden');
      put(d, 0, 'Forest', 'battlefield', 2);
      put(d, 0, 'Kalonian Tusker', 'hand');
    });
    const byHand = { autoPass: false };
    g = runWith(byHand, g, { type: 'cast', card: byName(g, 0, 'Kalonian Tusker', 'hand')!.id }, pass, pass, pass, pass);
    expect(g.stack.map((x) => x.controller)).toEqual([0, 1, 2]);
    g = run(g, pass);
    expect(g.players.map((p) => p.life)).toEqual([41, 41, 41, 40]);
  });

  it('gives defenders a chance to act after attackers are declared (508.2)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Kalonian Tusker');
      put(d, 1, 'Plains', 'battlefield', 4);
      put(d, 1, 'Divine Verdict', 'hand');
    });
    const tusker = byName(g, 0, 'Kalonian Tusker')!;
    const verdict = byName(g, 1, 'Divine Verdict', 'hand')!;
    g = run(g, pass);
    expect(canCast(g, 1, verdict)).toBe(false); // nothing is attacking yet
    g = run(g, { type: 'declareAttack', card: tusker.id, defender: 1 }, pass);
    expect([g.step, g.decision, g.priority]).toEqual(['attackers', null, 1]);
    g = run(g, { type: 'cast', card: verdict.id, targets: [{ kind: 'card', id: tusker.id }] });
    expect(onBattlefield(g, tusker.id)).toBe(false);
    expect(g.players[1].life).toBe(40);
  });
});

describe('eliminations', () => {
  it('passes the turn on when the active player dies, and ends the game with one player left', () => {
    let g = emptyGame((d) => {
      d.players[0].life = 3;
      d.players[1].life = 3;
      d.players[2].life = 3;
      put(d, 0, 'Mountain', 'battlefield', 2);
      put(d, 0, 'Flame Rift', 'hand');
    });
    g = run(g, { type: 'cast', card: byName(g, 0, 'Flame Rift', 'hand')!.id });
    expect(g.players.map((p) => p.lost)).toEqual([true, true, true, false]);
    expect(g.winner).toBe(3);
    expect(g.step).toBe('gameOver');
  });

  it('skips dead players in turn order', () => {
    let g = emptyGame((d) => {
      d.players[1].life = 2;
      put(d, 0, 'Mountain', 'battlefield', 1);
      put(d, 0, 'Shock', 'hand');
    });
    g = run(g, { type: 'cast', card: byName(g, 0, 'Shock', 'hand')!.id, targets: [{ kind: 'player', id: 1 }] }, pass, pass);
    expect(g.players[1].lost).toBe(true);
    expect(g.active).toBe(2);
  });
});

describe('log', () => {
  it('records the cards each line names, so the UI can link them', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Swamp', 'battlefield', 3);
      put(d, 0, 'Murder', 'hand');
      put(d, 1, 'Mogg Fanatic');
    });
    const fanatic = byName(g, 1, 'Mogg Fanatic')!;
    g = run(g, { type: 'cast', card: byName(g, 0, 'Murder', 'hand')!.id, targets: [{ kind: 'card', id: fanatic.id }] });
    const cast = g.log.find((l) => l.text.includes('Murder targeting'))!;
    expect(cast.cards).toEqual(['Murder', 'Mogg Fanatic']);
    while (g.stack.length) g = run(g, pass);
    expect(g.log.find((l) => l.text === 'Mogg Fanatic is destroyed.')?.cards).toEqual(['Mogg Fanatic']);
    expect(g.log.find((l) => l.text.startsWith('Turn '))?.cards).toBeUndefined();
  });
});

describe('stops', () => {
  // Player 1's stops: none at all, then whatever a test adds for player 0's turn.
  const stopsFor1 = (onTurn0: TurnStops): ApplyOptions => ({ stops: { 1: [onTurn0, {}, {}, {}] } });

  it('stops a player at an "always" stop even when all they can do is pass', () => {
    let g = emptyGame();
    g = runWith(stopsFor1({ beginCombat: 'always' }), g, pass);
    expect([g.step, g.priority]).toEqual(['beginCombat', 1]);
  });

  it('skips an "ifAble" stop when the player can only pass', () => {
    let g = emptyGame();
    const turn = g.turn;
    // Past player 0's stops in main 1 and main 2.
    g = runWith(stopsFor1({ beginCombat: 'ifAble' }), g, pass, pass);
    // Player 1 has no stops on their own turn either, so it goes by; player 2 stops in main 1 by default.
    expect([g.turn, g.active, g.step, g.priority]).toEqual([turn + 2, 2, 'main1', 2]);
  });

  it('stops at an "ifAble" stop when the player could act', () => {
    let g = emptyGame((d) => {
      put(d, 1, 'Mountain');
      put(d, 1, 'Shock', 'hand');
    });
    g = runWith(stopsFor1({ beginCombat: 'ifAble' }), g, pass);
    expect([g.step, g.priority]).toEqual(['beginCombat', 1]);
  });

  it("still stops for an opponent's spell on the stack, whatever the stops", () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Mountain');
      put(d, 0, 'Shock', 'hand');
      put(d, 1, 'Mountain');
      put(d, 1, 'Shock', 'hand');
    });
    const shock = byName(g, 0, 'Shock', 'hand')!;
    g = runWith(stopsFor1({}), g, { type: 'cast', card: shock.id, targets: [{ kind: 'player', id: 1 }] });
    expect([g.stack.length, g.priority]).toEqual([1, 1]);
  });

  it('ignores a declare attackers stop when nothing attacks (508.8)', () => {
    let g = emptyGame();
    g = runWith(stopsFor1({ attackers: 'always', endCombat: 'always' }), g, pass);
    expect([g.step, g.priority]).toEqual(['endCombat', 1]);
  });

  it('only changes the player whose stops they are', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Mountain');
      put(d, 0, 'Shock', 'hand');
    });
    // Player 0 would stop in main 2 by default, holding Shock. With no stops they don't,
    // but player 1 keeps the default stop in their own main 1.
    g = runWith({ stops: { 0: [{}, {}, {}, {}] } }, g, pass);
    expect([g.active, g.step, g.priority]).toEqual([1, 'main1', 1]);
  });

  it('forecasts where passing goes next: the next stop this turn, or declaring attackers', () => {
    const g = emptyGame();
    expect([g.active, g.step]).toEqual([0, 'main1']);
    // Main 2 is an "always" stop: the game stops there even with nothing to do.
    expect(nextStop(g, 0)).toBe('main2');
    expect(nextStop(g, 0, [{ main2: 'ifAble' }, {}, {}, {}])).toBe(null);
    const shock = emptyGame((d) => {
      put(d, 0, 'Mountain');
      put(d, 0, 'Shock', 'hand');
    });
    expect(nextStop(shock, 0)).toBe('beginCombat');
    const attacker = emptyGame((d) => {
      put(d, 0, 'Elite Vanguard').sick = false;
    });
    expect(canAttack(attacker, attacker.players[0].battlefield[0])).toBe(true);
    expect(nextStop(attacker, 0)).toBe('attackers');
    // Player 1 on player 0's turn: nothing attacks them, so the end step if they can act.
    expect(nextStop(g, 1)).toBe(null);
    const theirs = emptyGame((d) => {
      put(d, 1, 'Mountain');
      put(d, 1, 'Shock', 'hand');
    });
    expect(nextStop(theirs, 1)).toBe('end');
    expect(nextStop(theirs, 1, [{ draw: 'always' }, {}, {}, {}])).toBe(null);
  });

  it('matches the defaults when no stops are given', () => {
    expect(defaultStops(0)[0]).toEqual({ main1: 'always', beginCombat: 'ifAble', blockers: 'ifAble', main2: 'always' });
    expect(defaultStops(0)[1]).toEqual({ upkeep: 'ifAble', attackers: 'ifAble', blockers: 'ifAble', end: 'ifAble' });
  });
});

describe('searching a library (701.23)', () => {
  /** Player 0 is the human, with a search spell to cast and a small library to search. */
  const searchGame = (spell: string) =>
    emptyGame((d) => {
      d.players[0].isBot = false;
      d.players[0].you = true;
      d.players[0].library = [];
      put(d, 0, 'Forest', 'battlefield', 3);
      put(d, 0, spell, 'hand');
      put(d, 0, 'Kalonian Tusker', 'library');
      put(d, 0, 'Forest', 'library', 2);
      put(d, 0, 'Plains', 'library');
    });
  const cast = (g: Game, name: string) => run(g, { type: 'cast', card: byName(g, 0, name, 'hand')!.id });

  it('shows the whole library and lets the player pick only a valid card', () => {
    let g = cast(searchGame('Rampant Growth'), 'Rampant Growth');
    expect([g.decision?.type, g.priority]).toEqual(['chooseCards', 0]);
    // The spell is still resolving: it stays on the stack until the choice is made (608.2).
    expect(g.stack.map((x) => x.card.name)).toEqual(['Rampant Growth']);
    if (g.decision?.type !== 'chooseCards') throw new Error('no choice');
    const { cards, valid, max } = choiceOptions(g, g.decision.choice);
    expect(cards.map((c) => c.name)).toEqual(['Forest', 'Forest', 'Kalonian Tusker', 'Plains']);
    expect(cards.filter((c) => valid.has(c.id)).map((c) => c.name)).toEqual(['Forest', 'Forest', 'Plains']);
    expect(max).toBe(1);
    expect(applyAction(g, { type: 'chooseCards', cards: [byName(g, 0, 'Kalonian Tusker', 'library')!.id] })).toBe(g);
    const plains = byName(g, 0, 'Plains', 'library')!;
    g = run(g, { type: 'chooseCards', cards: [plains.id] });
    expect(byName(g, 0, 'Plains')!.tapped).toBe(true);
    expect(g.players[0].library.length).toBe(3);
    expect(g.players[0].graveyard.map((c) => c.name)).toEqual(['Rampant Growth']);
    expect([g.stack, g.decision, g.priority]).toEqual([[], null, 0]);
  });

  it('may find nothing, even when a valid card is there (701.23b)', () => {
    let g = cast(searchGame('Rampant Growth'), 'Rampant Growth');
    g = run(g, { type: 'chooseCards', cards: [] });
    expect(g.players[0].battlefield.length).toBe(3);
    expect(g.players[0].library.length).toBe(4);
    expect(g.log.at(-1)!.text).toMatch(/find nothing\.$/);
  });

  it('asks once per land for Cultivate: one to the battlefield, then one to hand', () => {
    let g = cast(searchGame('Cultivate'), 'Cultivate');
    const [first, second] = g.players[0].library.filter((c) => c.name === 'Forest');
    g = run(g, { type: 'chooseCards', cards: [first.id] });
    expect(g.decision?.type === 'chooseCards' && g.decision.choice).toMatchObject({ kind: 'search', to: 'hand', source: 'Cultivate' });
    expect(g.stack.length).toBe(1);
    g = run(g, { type: 'chooseCards', cards: [second.id] });
    expect(byName(g, 0, 'Forest', 'hand')?.id).toBe(second.id);
    expect(onBattlefield(g, first.id)).toBe(true);
    expect(g.stack).toEqual([]);
  });

  it("lets a bot search too, for an opponent's Path to Exile", () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Plains');
      put(d, 0, 'Path to Exile', 'hand');
      put(d, 1, 'Kalonian Tusker');
    });
    const tusker = byName(g, 1, 'Kalonian Tusker')!;
    g = run(g, { type: 'cast', card: byName(g, 0, 'Path to Exile', 'hand')!.id, targets: [{ kind: 'card', id: tusker.id }] });
    expect([g.decision?.type === 'chooseCards' && g.decision.choice.player, g.priority]).toEqual([1, 1]);
    g = applyBotAction(g, botAction(g, 1));
    expect(g.players[1].exile.map((c) => c.name)).toEqual(['Kalonian Tusker']);
    expect(g.players[1].battlefield.map((c) => data(c).typeLine)).toEqual([expect.stringContaining('Basic Land')]);
    expect([g.decision, g.stack]).toEqual([null, []]);
  });
});

describe('mulligans (103.5)', () => {
  it('asks each player in turn order from the starting player, then takes the mulligans together', () => {
    let g = newGame({ seed: 7, humanDeck: null });
    const [first, ...rest] = turnOrder(g, g.active);
    expect([g.turn, g.decision?.type, g.priority]).toEqual([0, 'mulligan', first]);
    const oldHand = g.players[first].hand.map((c) => c.id);
    g = run(g, { type: 'mulligan' });
    // Nothing happens until everyone has declared.
    expect(g.players[first].hand.map((c) => c.id)).toEqual(oldHand);
    g = run(g, { type: 'keep' }, { type: 'keep' }, { type: 'keep' });
    // The first mulligan in a multiplayer game is free: seven new cards, none to the bottom (103.5c).
    expect([g.decision?.type, g.priority]).toEqual(['mulligan', first]);
    expect(g.players[first].hand.length).toBe(7);
    expect(g.players[first].library.length).toBe(92); // 99 cards besides the commander
    // The second costs a card.
    g = run(g, { type: 'mulligan' });
    expect(g.decision?.type === 'chooseCards' && g.decision.choice).toEqual({ kind: 'bottom', player: first, count: 1 });
    expect(applyAction(g, { type: 'chooseCards', cards: [] })).toBe(g);
    const bottom = g.players[first].hand[3];
    g = run(g, { type: 'chooseCards', cards: [bottom.id] });
    expect(g.players[first].hand.length).toBe(6);
    expect(g.players[first].library.at(-1)!.id).toBe(bottom.id);
    // The others kept, so only this player declares again.
    expect([g.decision?.type, g.priority]).toEqual(['mulligan', first]);
    g = run(g, { type: 'keep' });
    expect(g.mulligan).toBe(null);
    expect([g.turn, g.active]).toEqual([1, first]);
    expect(rest.every((pid) => g.players[pid].hand.length === 7)).toBe(true);
    // In multiplayer the starting player draws on their first turn too (103.8c).
    expect(g.players[first].hand.length).toBe(7);
  });

  it('stops offering mulligans once the hand would be zero cards', () => {
    const g = produce(newGame({ seed: 7, humanDeck: null }), (d) => {
      d.mulligan!.taken[d.priority] = 8; // 7 counted, after the free one
    });
    expect(canMulligan(g, g.priority)).toBe(false);
    expect(applyAction(g, { type: 'mulligan' })).toBe(g);
  });

  it('lets bots mulligan and keep on their own', () => {
    let g = newGame({ seed: 3, humanDeck: null });
    for (let i = 0; i < 40 && g.mulligan; i++) g = applyBotAction(g, botAction(g, g.priority));
    expect([g.mulligan, g.turn]).toEqual([null, 1]);
  });
});

describe('ordering triggers (603.3b)', () => {
  const wardens = (pid: number, human: boolean) =>
    emptyGame((d) => {
      d.players[pid].isBot = !human;
      put(d, pid, 'Soul Warden', 'battlefield', 2);
      put(d, 0, 'Forest', 'battlefield', 2);
      put(d, 0, 'Kalonian Tusker', 'hand');
    });
  const byHand = { autoPass: false };
  const castTusker = (g: Game) =>
    runWith(byHand, g, { type: 'cast', card: byName(g, 0, 'Kalonian Tusker', 'hand')!.id }, pass, pass, pass, pass);

  it('asks a human with two or more triggers for their order', () => {
    let g = castTusker(wardens(0, true));
    expect([g.decision?.type, g.priority]).toEqual(['orderTriggers', 0]);
    const ids = g.triggers.map((t) => t.id);
    expect(ids.length).toBe(2);
    expect(applyAction(g, { type: 'orderTriggers', order: [ids[0]] })).toBe(g); // every one of them must be placed
    g = runWith(byHand, g, { type: 'orderTriggers', order: [ids[1], ids[0]] });
    expect(g.stack.map((x) => x.id)).toEqual([ids[1], ids[0]]);
    expect([g.decision, g.priority]).toEqual([null, 0]);
  });

  it('keeps the order they triggered in for a bot', () => {
    const g = castTusker(wardens(1, false));
    expect(g.decision).toBe(null);
    expect(g.stack.map((x) => x.card.name)).toEqual(['Soul Warden', 'Soul Warden']);
  });
});

describe('combo turns: searches, choices, mana, storm, taxes and extra turns (session 7a)', () => {
  const player = (id: number) => ({ kind: 'player', id }) as const;
  const top = (g: Game) => ({ kind: 'stack', id: g.stack[g.stack.length - 1].id }) as const;
  const cast = (g: Game, pid: number, name: string, extra: object = {}) =>
    run(g, { type: 'cast', card: byName(g, pid, name, 'hand')!.id, ...extra } as Action);
  const yes = { type: 'answer', yes: true } as const;
  const no = { type: 'answer', yes: false } as const;
  const choose = (...cards: { id: string }[]) => ({ type: 'chooseCards', cards: cards.map((c) => c.id) }) as const;
  /** The choice the game is waiting on. */
  const asking = (g: Game) => (g.decision && 'choice' in g.decision ? g.decision.choice : undefined);
  /** Passes (declining anything asked) until `done`. */
  const passUntil = (g: Game, done: (g: Game) => boolean) => {
    for (let i = 0; i < 500 && !done(g); i++) g = run(g, g.decision?.type === 'ask' ? no : pass);
    return g;
  };
  /** A small library for player `pid`, top card first. */
  const library = (d: Game, pid: number, names: string[]) => {
    d.players[pid].library = [];
    for (const n of names) put(d, pid, n, 'library');
  };

  describe('searching and looking', () => {
    it('cracks a fetch land: 1 life, sacrifice it, a land with either type enters untapped (701.23)', () => {
      let g = emptyGame((d) => {
        put(d, 0, 'Polluted Delta');
        library(d, 0, ['Plateau', 'Underground Sea', 'Island', 'Volcanic Island']);
      });
      g = run(g, { type: 'activate', card: byName(g, 0, 'Polluted Delta')!.id });
      expect(g.players[0].life).toBe(39);
      expect(byName(g, 0, 'Polluted Delta', 'graveyard')).toBeDefined();
      const choice = asking(g)!;
      if (choice.kind !== 'search') throw new Error('no search');
      const { cards, valid } = choiceOptions(g, choice);
      expect(cards.filter((c) => valid.has(c.id)).map((c) => c.name)).toEqual(['Island', 'Underground Sea', 'Volcanic Island']);
      g = run(g, choose(byName(g, 0, 'Underground Sea', 'library')!));
      expect(byName(g, 0, 'Underground Sea')!.tapped).toBe(false);
    });

    it('Demonic Tutor must find a card (701.23d); Vampiric Tutor puts it on top and costs 2 life', () => {
      let g = emptyGame((d) => {
        put(d, 0, 'Swamp', 'battlefield', 3);
        put(d, 0, 'Demonic Tutor', 'hand');
        put(d, 0, 'Vampiric Tutor', 'hand');
        library(d, 0, ['Plains', 'Sol Ring', 'Plains', 'Plains']);
      });
      g = cast(g, 0, 'Vampiric Tutor');
      // Any card, so finding nothing isn't allowed.
      expect(applyAction(g, choose())).toBe(g);
      g = run(g, choose(byName(g, 0, 'Sol Ring', 'library')!));
      expect(g.players[0].library[0].name).toBe('Sol Ring');
      expect(g.players[0].life).toBe(38);
      g = cast(g, 0, 'Demonic Tutor');
      g = run(g, choose(byName(g, 0, 'Sol Ring', 'library')!));
      expect(byName(g, 0, 'Sol Ring', 'hand')).toBeDefined();
      expect(g.stack).toEqual([]);
    });

    it('Gamble discards a card at random after the search', () => {
      let g = emptyGame((d) => {
        put(d, 0, 'Mountain');
        put(d, 0, 'Gamble', 'hand');
        put(d, 0, 'Plains', 'hand', 2);
        library(d, 0, ['Sol Ring', 'Plains']);
      });
      g = cast(g, 0, 'Gamble');
      g = run(g, choose(byName(g, 0, 'Sol Ring', 'library')!));
      expect(g.players[0].hand).toHaveLength(2);
      expect(g.players[0].graveyard.map((c) => c.name).sort()).toHaveLength(2); // Gamble and the discarded card
    });

    it('Enlightened Tutor finds only an artifact or enchantment, and reveals it', () => {
      let g = emptyGame((d) => {
        put(d, 0, 'Plains');
        put(d, 0, 'Enlightened Tutor', 'hand');
        library(d, 0, ['Lightning Bolt', 'Rhystic Study', 'Sol Ring']);
      });
      g = cast(g, 0, 'Enlightened Tutor');
      const choice = asking(g)!;
      if (choice.kind !== 'search') throw new Error('no search');
      const { valid, min } = choiceOptions(g, choice);
      expect([valid.size, min]).toEqual([2, 0]);
      g = run(g, choose(byName(g, 0, 'Rhystic Study', 'library')!));
      expect(g.players[0].library[0].name).toBe('Rhystic Study');
      expect(g.log.some((l) => l.text.includes('for Rhystic Study'))).toBe(true);
    });

    it("a bot's unrevealed search doesn't name the card in the log (701.23e)", () => {
      let g = emptyGame((d) => {
        put(d, 1, 'Swamp', 'battlefield', 2);
        put(d, 1, 'Demonic Tutor', 'hand');
        d.active = 1;
        d.priority = 1;
      });
      g = cast(g, 1, 'Demonic Tutor');
      g = applyBotAction(g, botAction(g, 1));
      expect(g.log.some((l) => l.text === 'Mortis searches their library for a card.')).toBe(true);
    });
  });

  describe('mana abilities', () => {
    it('uses the free ability first and the painful one only for colour (Tarnished Citadel)', () => {
      let g = emptyGame((d) => {
        put(d, 0, 'Tarnished Citadel');
        put(d, 0, 'Sol Ring', 'hand');
        put(d, 0, 'Mystical Tutor', 'hand');
      });
      g = cast(g, 0, 'Sol Ring');
      expect(g.players[0].life).toBe(40);
      g = produce(g, (d) => void (byName(d, 0, 'Tarnished Citadel')!.tapped = false));
      g = cast(g, 0, 'Mystical Tutor');
      expect(g.players[0].life).toBe(37);
    });

    it('Spire of Industry makes colour only with an artifact, for 1 life', () => {
      let g = emptyGame((d) => put(d, 0, 'Spire of Industry'));
      expect(planPayment(g, 0, parseCost('{U}'))).toBeNull();
      g = produce(g, (d) => void (put(d, 0, 'Sol Ring').tapped = true));
      expect(planPayment(g, 0, parseCost('{U}'))).not.toBeNull();
    });

    it('Ancient Tomb deals 2 damage; City of Brass deals 1 when its trigger resolves', () => {
      let g = emptyGame((d) => {
        put(d, 0, 'Ancient Tomb');
        put(d, 0, 'City of Brass');
      });
      g = run(g, { type: 'tapMana', card: byName(g, 0, 'Ancient Tomb')!.id });
      expect([g.players[0].life, g.players[0].pool.length]).toEqual([38, 2]);
      g = run(g, { type: 'tapMana', card: byName(g, 0, 'City of Brass')!.id });
      expect(g.players[0].life).toBe(37);
      expect(g.players[0].pool.length).toBe(3);
      // Neither can be undone: they did more than tap.
      expect(applyAction(g, { type: 'untapMana', card: byName(g, 0, 'City of Brass')!.id })).toBe(g);
    });

    it("Simian Spirit Guide is exiled from the hand for {R}, by hand only (auto-pay won't)", () => {
      let g = emptyGame((d) => put(d, 0, 'Simian Spirit Guide', 'hand'));
      expect(planPayment(g, 0, parseCost('{R}'))).toBeNull();
      g = run(g, { type: 'tapMana', card: byName(g, 0, 'Simian Spirit Guide', 'hand')!.id });
      expect(g.players[0].pool.map((m) => m.sym)).toEqual(['R']);
      expect(byName(g, 0, 'Simian Spirit Guide', 'exile')).toBeDefined();
    });

    it('Mox Opal needs three artifacts; Mox Amber makes the colours of your legends', () => {
      let g = emptyGame((d) => {
        put(d, 0, 'Mox Opal');
        put(d, 0, 'Mox Amber');
      });
      expect(canTapForMana(g, 0, byName(g, 0, 'Mox Opal')!)).toBe(false);
      expect(canTapForMana(g, 0, byName(g, 0, 'Mox Amber')!)).toBe(false);
      g = produce(g, (d) => {
        put(d, 0, 'Sol Ring');
        put(d, 0, 'Lotho, Corrupt Shirriff');
      });
      expect(canTapForMana(g, 0, byName(g, 0, 'Mox Opal')!)).toBe(true);
      expect(manaOf(g, byName(g, 0, 'Mox Amber')!)?.colors).toEqual(['W', 'B']);
    });

    it("Fellwar Stone makes only what opponents' lands could", () => {
      let g = emptyGame((d) => {
        put(d, 0, 'Fellwar Stone');
        put(d, 1, 'Badlands');
        put(d, 2, 'Island');
      });
      expect(manaOf(g, byName(g, 0, 'Fellwar Stone')!)?.colors).toEqual(['U', 'B', 'R']);
      g = emptyGame((d) => put(d, 0, 'Fellwar Stone'));
      expect(manaOf(g, byName(g, 0, 'Fellwar Stone')!)).toBeNull();
    });

    it("Mana Vault doesn't untap; its owner may pay {4} in upkeep, and it hurts in the draw step while tapped", () => {
      let g = emptyGame((d) => {
        put(d, 0, 'Mana Vault').tapped = true;
        put(d, 0, 'Plains', 'battlefield', 4);
      });
      g = passUntil(g, (x) => x.active === 0 && x.turn > 1 && x.decision?.type === 'ask');
      expect(byName(g, 0, 'Mana Vault')!.tapped).toBe(true); // the untap step skipped it (502.3)
      g = run(g, no);
      g = passUntil(g, (x) => x.step === 'main1');
      expect(g.players[0].life).toBe(39);
      g = passUntil(g, (x) => x.active === 0 && x.turn > 5 && x.decision?.type === 'ask');
      g = run(g, yes);
      expect(byName(g, 0, 'Mana Vault')!.tapped).toBe(false);
    });

    it('rituals add mana; Cabal Ritual adds more with threshold', () => {
      let g = emptyGame((d) => {
        put(d, 0, 'Swamp', 'battlefield', 3);
        put(d, 0, 'Dark Ritual', 'hand');
        put(d, 0, 'Cabal Ritual', 'hand');
        for (let i = 0; i < 6; i++) put(d, 0, 'Plains', 'graveyard');
      });
      g = cast(g, 0, 'Dark Ritual');
      expect(g.players[0].pool.map((m) => m.sym)).toEqual(['B', 'B', 'B']);
      // Dark Ritual is the seventh card in the graveyard, so Cabal Ritual has threshold.
      g = cast(g, 0, 'Cabal Ritual');
      expect(g.players[0].pool).toHaveLength(1 + 5);
    });
  });

  describe('alternative costs and counterspells', () => {
    const duel = (answer: string, setup: (g: Game) => void = () => {}) =>
      emptyGame((d) => {
        put(d, 0, 'Mountain');
        put(d, 0, 'Lightning Bolt', 'hand');
        put(d, 1, answer, 'hand');
        setup(d);
      });

    it('Force of Will: 1 life and a blue card from the hand instead of mana (118.9)', () => {
      let g = duel('Force of Will', (d) => put(d, 1, 'Snapback', 'hand'));
      g = cast(g, 0, 'Lightning Bolt', { targets: [player(1)] });
      const fow = byName(g, 1, 'Force of Will', 'hand')!;
      expect(canCast(g, 1, fow)).toBe(true);
      expect(canCast(g, 1, fow, { alt: 0 })).toBe(false); // no card picked to exile
      const snapback = byName(g, 1, 'Snapback', 'hand')!;
      g = run(g, { type: 'cast', card: fow.id, alt: 0, exile: [snapback.id], targets: [top(g)] });
      expect(g.players[1].life).toBe(39);
      expect(byName(g, 1, 'Snapback', 'exile')).toBeDefined();
      expect(byName(g, 0, 'Lightning Bolt', 'graveyard')).toBeDefined();
    });

    it('Force of Will has no free cost without another blue card', () => {
      let g = duel('Force of Will');
      g = cast(g, 0, 'Lightning Bolt', { targets: [player(1)] });
      expect(canCast(g, 1, byName(g, 1, 'Force of Will', 'hand')!)).toBe(false);
    });

    it("Force of Negation is free only on an opponent's turn, and exiles what it counters", () => {
      let g = duel('Force of Negation', (d) => put(d, 1, 'Snapback', 'hand'));
      g = cast(g, 0, 'Lightning Bolt', { targets: [player(1)] });
      const fon = byName(g, 1, 'Force of Negation', 'hand')!;
      g = run(g, { type: 'cast', card: fon.id, alt: 0, exile: [byName(g, 1, 'Snapback', 'hand')!.id], targets: [top(g)] });
      expect(byName(g, 0, 'Lightning Bolt', 'exile')).toBeDefined();
      const own = emptyGame((d) => {
        put(d, 0, 'Force of Negation', 'hand');
        put(d, 0, 'Snapback', 'hand');
      });
      expect(canCast(own, 0, byName(own, 0, 'Force of Negation', 'hand')!, { alt: 0, exile: [byName(own, 0, 'Snapback', 'hand')!.id] })).toBe(false);
    });

    it('Fierce Guardianship is free while you control a commander', () => {
      const without = duel('Fierce Guardianship');
      const g0 = cast(without, 0, 'Lightning Bolt', { targets: [player(1)] });
      expect(canCast(g0, 1, byName(g0, 1, 'Fierce Guardianship', 'hand')!)).toBe(false);
      let g = duel('Fierce Guardianship', (d) => void (put(d, 1, 'Sheoldred, the Apocalypse').isCommander = true));
      g = cast(g, 0, 'Lightning Bolt', { targets: [player(1)] });
      g = run(g, { type: 'cast', card: byName(g, 1, 'Fierce Guardianship', 'hand')!.id, alt: 0, targets: [top(g)] });
      expect(g.players[1].life).toBe(40);
    });

    it('Pact of Negation: pay {3}{U}{U} at your next upkeep or lose the game', () => {
      let g = duel('Pact of Negation');
      g = cast(g, 0, 'Lightning Bolt', { targets: [player(1)] });
      g = cast(g, 1, 'Pact of Negation', { targets: [top(g)] });
      expect(g.delayed).toHaveLength(1);
      g = passUntil(g, (x) => x.decision?.type === 'ask');
      expect([g.active, g.step, asking(g)?.player]).toEqual([1, 'upkeep', 1]);
      // No mana: paying isn't possible.
      expect(applyAction(g, yes)).toBe(g);
      g = run(g, no);
      expect(g.players[1].lost).toBe(true);
    });

    it("Flusterstorm counters unless its controller pays {1}, and storm copies it (702.40a)", () => {
      let g = emptyGame((d) => {
        put(d, 0, 'Mountain', 'battlefield', 3);
        put(d, 0, 'Lightning Bolt', 'hand', 2);
        put(d, 1, 'Island');
        put(d, 1, 'Flusterstorm', 'hand');
      });
      const [b1, b2] = g.players[0].hand;
      g = run(g, { type: 'cast', card: b1.id, targets: [player(1)], hold: true });
      g = run(g, { type: 'cast', card: b2.id, targets: [player(1)] });
      const [first, second] = g.stack;
      g = cast(g, 1, 'Flusterstorm', { targets: [{ kind: 'stack', id: second.id }] });
      // Two spells were cast before it this turn: the storm trigger makes two copies, each asking for targets.
      expect(g.decision?.type).toBe('targets');
      g = run(g, { type: 'chooseTargets', targets: [{ kind: 'stack', id: first.id }] });
      g = run(g, { type: 'chooseTargets', targets: [{ kind: 'stack', id: first.id }] });
      // Player 0 pays {1} for the first copy and can't pay for the second.
      g = passUntil(g, (x) => x.decision?.type === 'ask');
      g = run(g, yes);
      g = passUntil(g, (x) => x.decision?.type === 'ask');
      expect(applyAction(g, yes)).toBe(g);
      g = run(g, no);
      g = passUntil(g, (x) => !x.stack.length);
      expect(g.players[1].life).toBe(40);
      expect(g.log.filter((l) => l.text === 'Lightning Bolt is countered.')).toHaveLength(2);
    });

    it('Brain Freeze mills three for itself and each copy', () => {
      let g = emptyGame((d) => {
        put(d, 0, 'Island', 'battlefield', 2);
        put(d, 0, 'Mountain', 'battlefield', 2);
        put(d, 0, 'Dark Ritual', 'hand'); // a spell cast before it, if it can be paid
        put(d, 0, 'Lightning Bolt', 'hand');
        put(d, 0, 'Brain Freeze', 'hand');
      });
      g = cast(g, 0, 'Lightning Bolt', { targets: [player(2)] });
      g = cast(g, 0, 'Brain Freeze', { targets: [player(1)] });
      // One spell before it: one copy, which may target someone else.
      g = run(g, { type: 'chooseTargets', targets: [player(3)] });
      g = passUntil(g, (x) => !x.stack.length);
      expect([g.players[1].graveyard.length, g.players[3].graveyard.length]).toEqual([3, 3]);
    });

    it('Mental Misstep counts X on the stack (202.3e); Swan Song gives the Bird to the countered spell\'s controller', () => {
      const start = emptyGame((d) => {
        put(d, 0, 'Mountain', 'battlefield', 2);
        put(d, 0, 'Blaze', 'hand');
        put(d, 1, 'Mental Misstep', 'hand');
        put(d, 1, 'Swan Song', 'hand');
        put(d, 1, 'Island');
      });
      const blaze = byName(start, 0, 'Blaze', 'hand')!;
      // {X}{R} with X = 1 has mana value 2 on the stack: Mental Misstep can't target it.
      let g = run(start, { type: 'cast', card: blaze.id, x: 1, targets: [player(1)] });
      expect(legalTargets(g, 1, { type: 'spell', label: '' }, byName(g, 1, 'Mental Misstep', 'hand')!)).toHaveLength(1);
      expect(canCast(g, 1, byName(g, 1, 'Mental Misstep', 'hand')!)).toBe(false);
      // With X = 0 it has mana value 1.
      g = run(start, { type: 'cast', card: blaze.id, x: 0, targets: [player(1)] });
      expect(canCast(g, 1, byName(g, 1, 'Mental Misstep', 'hand')!)).toBe(true);
      g = cast(g, 1, 'Swan Song', { targets: [top(g)] });
      expect(byName(g, 0, 'Bird 2/2 flying')).toBeDefined();
    });

    it("can't counter a spell that can't be countered (113.6g)", () => {
      let g = emptyGame((d) => {
        put(d, 0, 'Forest', 'battlefield', 6);
        put(d, 0, 'Carnage Tyrant', 'hand');
        put(d, 1, 'Island', 'battlefield', 2);
        put(d, 1, 'Counterspell', 'hand');
      });
      g = cast(g, 0, 'Carnage Tyrant');
      g = cast(g, 1, 'Counterspell', { targets: [top(g)] });
      expect(byName(g, 0, 'Carnage Tyrant')).toBeDefined();
    });
  });

  describe('taxes and draw triggers', () => {
    it('Rhystic Study: the caster may pay {1}; if not, its owner may draw (118.12a)', () => {
      let g = emptyGame((d) => {
        put(d, 0, 'Rhystic Study');
        put(d, 1, 'Mountain', 'battlefield', 3);
        put(d, 1, 'Lightning Bolt', 'hand', 2);
        d.active = 1;
        d.priority = 1;
      });
      const hand = g.players[0].hand.length;
      g = cast(g, 1, 'Lightning Bolt', { targets: [player(2)] });
      g = passUntil(g, (x) => x.decision?.type === 'ask');
      expect(asking(g)?.player).toBe(1);
      g = run(g, yes); // pays {1}
      expect(g.players[0].hand).toHaveLength(hand);
      g = passUntil(g, (x) => !x.stack.length);
      // The second time they can't pay; player 0 chooses to draw.
      g = cast(g, 1, 'Lightning Bolt', { targets: [player(2)] });
      g = passUntil(g, (x) => x.decision?.type === 'ask');
      expect(applyAction(g, yes)).toBe(g);
      g = run(g, no);
      expect(asking(g)).toMatchObject({ player: 0, kind: 'ask' });
      g = run(g, yes);
      expect(g.players[0].hand).toHaveLength(hand + 1);
    });

    it('Esper Sentinel triggers only on the first noncreature spell an opponent casts each turn', () => {
      let g = emptyGame((d) => {
        put(d, 0, 'Esper Sentinel');
        put(d, 1, 'Mountain', 'battlefield', 2);
        put(d, 1, 'Lightning Bolt', 'hand', 2);
        d.active = 1;
        d.priority = 1;
      });
      g = cast(g, 1, 'Lightning Bolt', { targets: [player(2)] });
      g = passUntil(g, (x) => x.decision?.type === 'ask');
      g = run(g, no);
      g = passUntil(g, (x) => !x.stack.length);
      const hand = g.players[0].hand.length;
      g = cast(g, 1, 'Lightning Bolt', { targets: [player(2)] });
      g = passUntil(g, (x) => !x.stack.length);
      expect(g.players[0].hand).toHaveLength(hand);
      expect(g.players[1].noncreatureSpellsCast).toBe(2);
    });

    it("Kraum draws on an opponent's second spell each turn; Lotho on anyone's", () => {
      let g = emptyGame((d) => {
        put(d, 0, "Kraum, Ludevic's Opus");
        put(d, 2, 'Lotho, Corrupt Shirriff');
        put(d, 1, 'Mountain', 'battlefield', 2);
        put(d, 1, 'Lightning Bolt', 'hand', 2);
        d.active = 1;
        d.priority = 1;
      });
      const hand = g.players[0].hand.length;
      g = cast(g, 1, 'Lightning Bolt', { targets: [player(3)] });
      g = passUntil(g, (x) => !x.stack.length);
      g = cast(g, 1, 'Lightning Bolt', { targets: [player(3)] });
      g = passUntil(g, (x) => !x.stack.length);
      expect(g.players[0].hand).toHaveLength(hand + 1);
      expect(g.players[2].life).toBe(39);
      expect(byName(g, 2, 'Treasure')).toBeDefined();
    });

    it('Smothering Tithe makes a Treasure for each draw an opponent doesn\'t pay {2} for; Wheel of Fortune draws seven each', () => {
      let g = emptyGame((d) => {
        put(d, 0, 'Smothering Tithe');
        put(d, 0, 'Mountain', 'battlefield', 3);
        put(d, 0, 'Wheel of Fortune', 'hand');
        for (const p of d.players) put(d, p.id, 'Plains', 'hand', 2);
      });
      g = cast(g, 0, 'Wheel of Fortune');
      expect(g.players.map((p) => p.hand.length)).toEqual([7, 7, 7, 7]);
      expect(g.players.map((p) => p.graveyard.length)).toEqual([3, 2, 2, 2]);
      g = passUntil(g, (x) => !x.stack.length && !x.decision && !x.triggers.length);
      expect(g.players[0].battlefield.filter((c) => c.name === 'Treasure')).toHaveLength(21);
    });

    it('Tymna draws for each opponent dealt combat damage, paying that much life', () => {
      let g = emptyGame((d) => {
        put(d, 0, 'Tymna the Weaver');
        put(d, 0, 'Raging Goblin');
      });
      g = run(g, pass); // to declare attackers
      g = run(
        g,
        { type: 'declareAttack', card: byName(g, 0, 'Tymna the Weaver')!.id, defender: 1 },
        { type: 'declareAttack', card: byName(g, 0, 'Raging Goblin')!.id, defender: 2 },
        pass,
      );
      g = passUntil(g, (x) => x.decision?.type === 'ask');
      expect([g.step, asking(g)?.kind === 'ask' && asking(g)]).toMatchObject(['main2', { life: 2 }]);
      const hand = g.players[0].hand.length;
      g = run(g, yes);
      expect(g.players[0].hand).toHaveLength(hand + 2);
      expect(g.players[0].life).toBe(40 + 2 - 2); // lifelink, then the payment
    });

    it('Tymna always triggers; with no opponent dealt combat damage there is nothing to pay or draw', () => {
      let g = emptyGame((d) => put(d, 0, 'Tymna the Weaver'));
      g = runWith({ autoPass: false }, g, pass, pass, pass, pass); // main1 -> beginning of combat
      g = passUntil(g, (x) => x.step === 'main2');
      expect(g.log.some((l) => l.text.includes('Tymna'))).toBe(false);
      expect(g.decision).toBeNull();
    });

    it("Command Tower makes no mana for a colourless commander (105.1)", () => {
      const g = emptyGame((d) => {
        d.players[0].colors = [];
        put(d, 0, 'Command Tower');
      });
      expect(manaOf(g, byName(g, 0, 'Command Tower')!)).toBeNull();
    });

    it('Mystic Remora: cumulative upkeep {1} per age counter, or it is sacrificed (702.24a)', () => {
      let g = emptyGame((d) => {
        put(d, 0, 'Mystic Remora');
        put(d, 0, 'Island');
      });
      g = passUntil(g, (x) => x.active === 0 && x.decision?.type === 'ask');
      expect(asking(g)).toMatchObject({ cost: '{1}' });
      g = run(g, yes);
      g = passUntil(g, (x) => x.active === 0 && x.turn > 5 && x.decision?.type === 'ask');
      expect(asking(g)).toMatchObject({ cost: '{2}' });
      g = run(g, no);
      expect(byName(g, 0, 'Mystic Remora', 'graveyard')).toBeDefined();
    });

    it('The Queen of Dale recruits: draw, discard, and a Human Soldier for a nonland card', () => {
      let g = emptyGame((d) => {
        put(d, 0, 'The Queen of Dale');
        put(d, 0, 'Lightning Bolt', 'hand');
        put(d, 1, 'Mountain');
        put(d, 1, 'Lightning Bolt', 'hand');
        d.active = 1;
        d.priority = 1;
      });
      g = cast(g, 1, 'Lightning Bolt', { targets: [player(2)] });
      g = passUntil(g, (x) => x.decision?.type === 'chooseCards');
      g = run(g, choose(byName(g, 0, 'Lightning Bolt', 'hand')!));
      expect(byName(g, 0, 'Human Soldier')).toBeDefined();
    });

    it("Tataru Taru: both draw, and a tapped Treasure when an opponent draws on someone else's turn, once a turn", () => {
      let g = emptyGame((d) => {
        put(d, 0, 'Plains', 'battlefield', 2);
        put(d, 0, 'Tataru Taru', 'hand');
      });
      g = cast(g, 0, 'Tataru Taru');
      g = run(g, { type: 'chooseTargets', targets: [player(1)] });
      g = passUntil(g, (x) => x.decision?.type === 'ask');
      g = run(g, yes);
      g = passUntil(g, (x) => !x.stack.length && !x.decision);
      const treasures = g.players[0].battlefield.filter((c) => c.name === 'Treasure');
      expect(treasures.map((t) => t.tapped)).toEqual([true]);
    });

    it('Gleaming Splendor needs two different players (115.3)', () => {
      const g = emptyGame((d) => {
        put(d, 0, 'Gleaming Splendor');
        put(d, 0, 'Plains', 'battlefield', 3);
      });
      const gs = byName(g, 0, 'Gleaming Splendor')!;
      expect(applyAction(g, { type: 'activate', card: gs.id, targets: [player(1), player(1)] })).toBe(g);
      expect(applyAction(g, { type: 'activate', card: gs.id, targets: [player(1), player(2)] })).not.toBe(g);
    });
  });

  describe("restrictions: can't cast, flash", () => {
    it("Silence: opponents can't cast spells this turn", () => {
      let g = emptyGame((d) => {
        put(d, 0, 'Plains');
        put(d, 0, 'Silence', 'hand');
        put(d, 1, 'Mountain');
        put(d, 1, 'Lightning Bolt', 'hand');
      });
      g = cast(g, 0, 'Silence');
      g = passUntil(g, (x) => !x.stack.length);
      expect(forbidden(g, 1, 'cast', byName(g, 1, 'Lightning Bolt', 'hand')!)).toBe(true);
      expect(forbidden(g, 0, 'cast', byName(g, 1, 'Lightning Bolt', 'hand')!)).toBe(false);
      g = passUntil(g, (x) => x.active === 1 && x.step === 'main1');
      expect(g.effects).toEqual([]);
    });

    it("Grand Abolisher: on your turn opponents can't cast spells or use artifacts' abilities, even mana ones", () => {
      const g = emptyGame((d) => {
        put(d, 0, 'Grand Abolisher');
        put(d, 1, 'Sol Ring');
        put(d, 1, 'Mountain');
        put(d, 1, 'Lightning Bolt', 'hand');
        d.priority = 1;
      });
      expect(canCast(g, 1, byName(g, 1, 'Lightning Bolt', 'hand')!)).toBe(false);
      expect(canTapForMana(g, 1, byName(g, 1, 'Sol Ring')!)).toBe(false);
      expect(canTapForMana(g, 1, byName(g, 1, 'Mountain')!)).toBe(true);
    });

    it('Borne Upon a Wind lets you cast spells as though they had flash this turn (702.8)', () => {
      const start = emptyGame((d) => {
        put(d, 0, 'Island', 'battlefield', 2);
        put(d, 0, 'Swamp', 'battlefield', 3);
        put(d, 0, 'Borne Upon a Wind', 'hand');
        put(d, 0, 'Dark Ritual', 'hand');
        put(d, 0, 'Demonic Tutor', 'hand');
      });
      // Without it, a sorcery can't be cast while a spell is on the stack (117.1a).
      let g = cast(start, 0, 'Dark Ritual', { hold: true });
      expect(canCast(g, 0, byName(g, 0, 'Demonic Tutor', 'hand')!)).toBe(false);
      g = cast(start, 0, 'Borne Upon a Wind');
      g = cast(g, 0, 'Dark Ritual', { hold: true });
      expect(g.stack).toHaveLength(1);
      expect(canCast(g, 0, byName(g, 0, 'Demonic Tutor', 'hand')!)).toBe(true);
    });

    it('Voice of Victory: mobilize 2 makes two attacking Warriors, sacrificed at the end step', () => {
      let g = emptyGame((d) => put(d, 0, 'Voice of Victory'));
      g = run(g, pass);
      g = run(g, { type: 'declareAttack', card: byName(g, 0, 'Voice of Victory')!.id, defender: 1 }, pass);
      g = passUntil(g, (x) => x.step === 'blockers' || x.step === 'damage' || x.step === 'main2');
      g = passUntil(g, (x) => x.step === 'main2');
      expect(g.players[1].life).toBe(40 - 1 - 1 - 1);
      g = passUntil(g, (x) => x.active === 1);
      expect(g.players[0].battlefield.filter((c) => c.name === 'Warrior')).toHaveLength(0);
    });
  });

  describe('winning and losing', () => {
    it("Thassa's Oracle wins with devotion at least the library size (104.2b)", () => {
      let g = emptyGame((d) => {
        put(d, 0, 'Island', 'battlefield', 2);
        put(d, 0, "Thassa's Oracle", 'hand');
        library(d, 0, ['Plains', 'Plains']);
      });
      g = cast(g, 0, "Thassa's Oracle");
      // Devotion 2 (its own {U}{U}): look at both, keep one on top.
      g = passUntil(g, (x) => x.decision?.type === 'chooseCards');
      g = run(g, choose(g.players[0].library[1]));
      expect(g.winner).toBe(0);
    });

    it("Demonic Consultation naming a card that isn't there exiles the whole library", () => {
      let g = emptyGame((d) => {
        put(d, 0, 'Swamp');
        put(d, 0, 'Demonic Consultation', 'hand');
        library(d, 0, ['Plains', 'Sol Ring', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Dark Ritual', 'Plains']);
      });
      g = cast(g, 0, 'Demonic Consultation');
      expect(g.decision?.type).toBe('name');
      expect(applyAction(g, { type: 'name', name: 'Not A Card' })).toBe(g);
      const named = run(g, { type: 'name', name: 'Dark Ritual' });
      expect(byName(named, 0, 'Dark Ritual', 'hand')).toBeDefined();
      expect([named.players[0].exile.length, named.players[0].library.length]).toEqual([7, 1]);
      const all = run(g, { type: 'name', name: "Thassa's Oracle" });
      expect(all.players[0].library).toEqual([]);
    });

    it('Tainted Pact stops at a repeated name, or when a card is taken', () => {
      let g = emptyGame((d) => {
        put(d, 0, 'Swamp', 'battlefield', 2);
        put(d, 0, 'Tainted Pact', 'hand');
        library(d, 0, ['Sol Ring', 'Plains', 'Dark Ritual', 'Plains', 'Island']);
      });
      g = cast(g, 0, 'Tainted Pact');
      g = run(g, no, no, no); // Sol Ring, Plains, Dark Ritual exiled
      // The second Plains has the same name as one exiled before: it stops.
      expect(g.decision).toBeNull();
      expect(g.players[0].library.map((c) => c.name)).toEqual(['Island']);
      let h = emptyGame((d) => {
        put(d, 0, 'Swamp', 'battlefield', 2);
        put(d, 0, 'Tainted Pact', 'hand');
        library(d, 0, ['Plains', 'Sol Ring', 'Island']);
      });
      h = cast(h, 0, 'Tainted Pact');
      h = run(h, no, yes);
      expect(byName(h, 0, 'Sol Ring', 'hand')).toBeDefined();
      expect(h.players[0].library.map((c) => c.name)).toEqual(['Island']);
    });

    it('Final Fortune: an extra turn, then its caster loses at its end step (500.7)', () => {
      let g = emptyGame((d) => {
        put(d, 0, 'Mountain', 'battlefield', 2);
        put(d, 0, 'Final Fortune', 'hand');
      });
      g = cast(g, 0, 'Final Fortune');
      g = passUntil(g, (x) => x.turn === 2 && x.step === 'main1');
      expect(g.active).toBe(0);
      g = passUntil(g, (x) => x.players[0].lost);
      expect(g.log.find((l) => l.text === 'Seraphine loses the game (Final Fortune).')?.turn).toBe(2);
    });
  });
});

describe('graveyard, exile and odd cards (session 7b)', () => {
  const player = (id: number) => ({ kind: 'player', id }) as const;
  const card = (c: { id: string }) => ({ kind: 'card', id: c.id }) as const;
  const top = (g: Game) => ({ kind: 'stack', id: g.stack[g.stack.length - 1].id }) as const;
  const cast = (g: Game, pid: number, name: string, extra: object = {}) => run(g, { type: 'cast', card: byName(g, pid, name, 'hand')!.id, ...extra } as Action);
  const yes = { type: 'answer', yes: true } as const;
  const no = { type: 'answer', yes: false } as const;
  const choose = (...cards: { id: string }[]) => ({ type: 'chooseCards', cards: cards.map((c) => c.id) }) as const;
  const asking = (g: Game) => (g.decision && 'choice' in g.decision ? g.decision.choice : undefined);
  /** Passes (declining anything asked, choosing nothing) until `done`. */
  const passUntil = (g: Game, done: (g: Game) => boolean) => {
    for (let i = 0; i < 500 && !done(g); i++) g = run(g, g.decision?.type === 'ask' || g.decision?.type === 'cast' ? no : g.decision?.type === 'chooseCards' ? choose() : pass);
    return g;
  };
  const library = (d: Game, pid: number, names: string[]) => {
    d.players[pid].library = [];
    for (const n of names) put(d, pid, n, 'library');
  };
  /** Puts player `pid`'s commander from the command zone onto the battlefield. */
  const commanderOut = (d: Game, pid: number) => {
    const c = d.players[pid].command.pop()!;
    c.zone = 'battlefield';
    d.players[pid].battlefield.push(c);
  };

  describe('control and the legend rule', () => {
    it('Wishclaw Talisman: three wish counters, only on your turn, then an opponent gains control (110.2)', () => {
      let g = emptyGame((d) => {
        put(d, 0, 'Swamp', 'battlefield', 3);
        put(d, 0, 'Wishclaw Talisman', 'hand');
        library(d, 0, ['Island', 'Sol Ring', 'Plains']);
        library(d, 1, ['Plains', 'Dark Ritual', 'Plains', 'Plains']);
      });
      g = cast(g, 0, 'Wishclaw Talisman');
      const claw = byName(g, 0, 'Wishclaw Talisman')!;
      expect(claw.counters.wish).toBe(3);
      g = run(g, { type: 'activate', card: claw.id });
      g = run(g, choose(byName(g, 0, 'Sol Ring', 'library')!));
      const choice = asking(g);
      if (choice?.kind !== 'player') throw new Error('no player choice');
      expect(choice.options).toEqual([1, 2, 3]);
      g = run(g, { type: 'choosePlayer', player: 1 });
      expect(byName(g, 0, 'Sol Ring', 'hand')).toBeDefined();
      const moved = byName(g, 1, 'Wishclaw Talisman')!;
      expect([moved.owner, moved.controller, moved.counters.wish]).toEqual([0, 1, 2]);
      // "Activate only during your turn": its new controller's turn.
      expect(canActivate(g, 1, moved)).toBe(false);
      g = passUntil(g, (x) => x.active === 1 && x.step === 'main1');
      g = produce(g, (d) => void put(d, 1, 'Swamp'));
      expect(canActivate(g, 1, byName(g, 1, 'Wishclaw Talisman')!)).toBe(true);
      // If its new controller leaves the game, control goes back (800.4a).
      g = produce(g, (d) => {
        d.players[1].life = 0;
        checkState(d);
      });
      expect(byName(g, 0, 'Wishclaw Talisman')!.controller).toBe(0);
    });

    it('the legend rule: a human keeps one of two legends with the same name, a bot keeps the ready one (704.5j)', () => {
      const setup = (human: boolean) =>
        emptyGame((d) => {
          d.players[0].isBot = !human;
          put(d, 0, 'Ragavan, Nimble Pilferer');
          put(d, 0, 'Island', 'battlefield', 2);
          put(d, 0, 'Mockingbird', 'hand');
        });
      let g = cast(setup(true), 0, 'Mockingbird', { x: 1 });
      const ragavan = byName(g, 0, 'Ragavan, Nimble Pilferer')!;
      g = run(g, choose(ragavan));
      expect(asking(g)?.kind).toBe('legend');
      g = run(g, choose(ragavan));
      expect(g.players[0].battlefield.filter((c) => label(c) === 'Ragavan, Nimble Pilferer').map((c) => c.id)).toEqual([ragavan.id]);
      expect(byName(g, 0, 'Mockingbird', 'graveyard')).toBeDefined();
      let b = cast(setup(false), 0, 'Mockingbird', { x: 1 });
      b = run(b, choose(byName(b, 0, 'Ragavan, Nimble Pilferer')!));
      // The bot keeps the one that isn't summoning sick.
      expect(b.players[0].battlefield.filter((c) => label(c) === 'Ragavan, Nimble Pilferer').map((c) => c.name)).toEqual(['Ragavan, Nimble Pilferer']);
    });
  });

  describe('entering the battlefield', () => {
    it('Mockingbird enters as a copy of a creature with mana value up to the mana spent, a Bird with flying (707.9b)', () => {
      let g = emptyGame((d) => {
        put(d, 0, 'Island', 'battlefield', 3);
        put(d, 0, 'Mockingbird', 'hand');
        put(d, 1, 'Serra Angel');
        put(d, 1, 'Goblin Piker');
        put(d, 2, 'Llanowar Elves');
      });
      g = cast(g, 0, 'Mockingbird', { x: 1 }); // {1}{U}: 2 mana spent
      const choice = asking(g);
      if (choice?.kind !== 'pick') throw new Error('no pick');
      expect(choice.cards.map((id) => label(findCard(g, id)!)).sort()).toEqual(['Goblin Piker', 'Llanowar Elves']);
      g = run(g, choose(byName(g, 1, 'Goblin Piker')!));
      const bird = byName(g, 0, 'Mockingbird')!;
      expect(label(bird)).toBe('Goblin Piker');
      expect(data(bird).typeLine).toBe('Creature — Goblin Warrior Bird');
      expect(stats(g, bird).power).toBe(2);
      expect(stats(g, bird).keywords.has('flying')).toBe(true);
      expect(manaValue(bird)).toBe(2);
    });

    it("a Mockingbird copy of Thassa's Oracle has its enters ability, and its mana cost counts for devotion (707.2)", () => {
      let g = emptyGame((d) => {
        put(d, 0, "Thassa's Oracle");
        put(d, 0, 'Island', 'battlefield', 3);
        put(d, 0, 'Mockingbird', 'hand');
        library(d, 0, ['Sol Ring', 'Plains', 'Island', 'Swamp']);
      });
      g = cast(g, 0, 'Mockingbird', { x: 2 });
      g = run(g, choose(byName(g, 0, "Thassa's Oracle")!));
      // Devotion {U}{U} + {U}{U} = 4: it looks at the top four and wins.
      g = run(g, choose());
      expect(g.winner).toBe(0);
    });

    it('Mox Diamond enters only if a land card is discarded instead; otherwise it goes to the graveyard', () => {
      const setup = (land: boolean) =>
        emptyGame((d) => {
          put(d, 0, 'Mox Diamond', 'hand');
          if (land) put(d, 0, 'Plains', 'hand');
        });
      let g = cast(setup(true), 0, 'Mox Diamond');
      g = run(g, choose(byName(g, 0, 'Plains', 'hand')!));
      expect(byName(g, 0, 'Mox Diamond')).toBeDefined();
      expect(byName(g, 0, 'Plains', 'graveyard')).toBeDefined();
      let h = cast(setup(true), 0, 'Mox Diamond');
      h = run(h, choose());
      expect(byName(h, 0, 'Mox Diamond', 'graveyard')).toBeDefined();
      expect(byName(h, 0, 'Plains', 'hand')).toBeDefined();
      const k = cast(setup(false), 0, 'Mox Diamond');
      expect(byName(k, 0, 'Mox Diamond', 'graveyard')).toBeDefined();
    });

    it('Chrome Mox taps for the colours of the card it exiled, and makes nothing without one (106.5)', () => {
      const setup = () =>
        emptyGame((d) => {
          put(d, 0, 'Chrome Mox', 'hand');
          put(d, 0, 'Lightning Bolt', 'hand');
          put(d, 0, 'Sol Ring', 'hand');
        });
      let g = cast(setup(), 0, 'Chrome Mox');
      const choice = asking(g);
      if (choice?.kind !== 'pick') throw new Error('no pick');
      // Only a nonartifact, nonland card.
      expect(choice.cards.map((id) => label(findCard(g, id)!))).toEqual(['Lightning Bolt']);
      g = run(g, choose(byName(g, 0, 'Lightning Bolt', 'hand')!));
      expect(manaOf(g, byName(g, 0, 'Chrome Mox')!)?.colors).toEqual(['R']);
      let h = cast(setup(), 0, 'Chrome Mox');
      h = run(h, choose());
      expect(canTapForMana(h, 0, byName(h, 0, 'Chrome Mox')!)).toBe(false);
    });

    it("Cavern of Souls: a creature type is chosen as it enters; its coloured mana casts only that type, which can't be countered (106.6)", () => {
      let g = emptyGame((d) => {
        put(d, 0, 'Cavern of Souls', 'hand');
        put(d, 0, 'Swamp');
        put(d, 0, 'Goblin Piker', 'hand');
        put(d, 0, 'Lightning Bolt', 'hand');
        put(d, 1, 'Island', 'battlefield', 5);
        put(d, 1, 'Force of Will', 'hand');
      });
      g = run(g, { type: 'playLand', card: byName(g, 0, 'Cavern of Souls', 'hand')!.id });
      expect(asking(g)?.kind).toBe('name');
      expect(applyAction(g, { type: 'name', name: 'Lightning Bolt' })).toBe(g); // not a creature type
      g = run(g, { type: 'name', name: 'Goblin' });
      expect(byName(g, 0, 'Cavern of Souls')!.chosen).toBe('Goblin');
      expect(canCast(g, 0, byName(g, 0, 'Lightning Bolt', 'hand')!)).toBe(false);
      g = cast(g, 0, 'Goblin Piker');
      expect(g.priority).toBe(1);
      g = run(g, { type: 'cast', card: byName(g, 1, 'Force of Will', 'hand')!.id, targets: [top(g)] });
      g = passUntil(g, (x) => !x.stack.length);
      expect(byName(g, 0, 'Goblin Piker')).toBeDefined();
      expect(g.log.some((l) => l.text === "Goblin Piker can't be countered.")).toBe(true);
    });

    it('Gemstone Caverns: a player who doesn\'t start may begin with it on the battlefield with a luck counter, exiling a card (103.6a)', () => {
      let g = produce(newGame({ seed: 5, humanDeck: null }), (d) => {
        for (const pid of [d.active, (d.active + 1) % 4]) d.players[pid].hand.push(makeCard(d, 'Gemstone Caverns', pid, 'hand'));
      });
      const later = (g.active + 1) % 4;
      while (g.decision?.type === 'mulligan') g = run(g, { type: 'keep' });
      // Only the player who isn't the starting player is asked.
      expect([asking(g)?.kind, g.priority]).toEqual(['ask', later]);
      g = run(g, yes);
      const exiled = g.players[later].hand.find((c) => c.name !== 'Gemstone Caverns')!;
      g = run(g, choose(exiled));
      const caverns = byName(g, later, 'Gemstone Caverns')!;
      expect(caverns.counters.luck).toBe(1);
      expect(manaOf(g, caverns)?.colors).toEqual(['W', 'U', 'B', 'R', 'G']);
      expect(byName(g, later, exiled.name, 'exile')).toBeDefined();
      expect([g.mulligan, g.turn]).toEqual([null, 1]);
      g = produce(g, (d) => void put(d, 0, 'Gemstone Caverns'));
      expect(manaOf(g, byName(g, 0, 'Gemstone Caverns')!)?.colors).toEqual(['C']);
    });
  });

  describe('casting from graveyards and exile', () => {
    it('Underworld Breach: escape pays the mana cost and exiles three other cards (702.138a); it is sacrificed at the end step', () => {
      let g = emptyGame((d) => {
        put(d, 0, 'Underworld Breach');
        put(d, 0, 'Mountain');
        for (const n of ['Lightning Bolt', 'Plains', 'Island', 'Swamp', 'Sol Ring']) put(d, 0, n, 'graveyard');
      });
      expect(canCast(g, 0, byName(g, 0, 'Plains', 'graveyard')!)).toBe(false); // lands don't get escape
      const bolt = byName(g, 0, 'Lightning Bolt', 'graveyard')!;
      const three = ['Plains', 'Island', 'Swamp'].map((n) => byName(g, 0, n, 'graveyard')!.id);
      expect(applyAction(g, { type: 'cast', card: bolt.id, targets: [player(1)], escape: three.slice(0, 2) })).toBe(g);
      g = run(g, { type: 'cast', card: bolt.id, targets: [player(1)], escape: three });
      expect(g.players[1].life).toBe(37);
      expect(g.players[0].exile.map((c) => c.name).sort()).toEqual(['Island', 'Plains', 'Swamp']);
      // An escaped instant goes to the graveyard as usual, ready to escape again.
      expect(byName(g, 0, 'Lightning Bolt', 'graveyard')).toBeDefined();
      expect(canCast(g, 0, byName(g, 0, 'Sol Ring', 'graveyard')!)).toBe(false); // only one other card left
      g = passUntil(g, (x) => !byName(x, 0, 'Underworld Breach'));
      expect(byName(g, 0, 'Underworld Breach', 'graveyard')).toBeDefined();
      expect(g.log.find((l) => l.text === 'Underworld Breach is sacrificed.')?.turn).toBe(1);
    });

    it("Mnemonic Betrayal: opponents' spells can be cast this turn with any mana; the rest go back at the end step; Betrayal is exiled", () => {
      let g = emptyGame((d) => {
        put(d, 0, 'Island');
        put(d, 0, 'Swamp', 'battlefield', 4);
        put(d, 0, 'Mnemonic Betrayal', 'hand');
        put(d, 1, 'Goblin Piker', 'graveyard');
        put(d, 1, 'Plains', 'graveyard');
        put(d, 2, 'Lightning Bolt', 'graveyard');
      });
      g = cast(g, 0, 'Mnemonic Betrayal');
      expect(byName(g, 0, 'Mnemonic Betrayal', 'exile')).toBeDefined();
      const piker = byName(g, 1, 'Goblin Piker', 'exile')!;
      expect(canPlayLand(g, 0, byName(g, 1, 'Plains', 'exile')!)).toBe(false); // spells only
      g = run(g, { type: 'cast', card: piker.id }); // {1}{R} paid with {B}{B}
      const stolen = byName(g, 0, 'Goblin Piker')!;
      expect([stolen.owner, stolen.controller]).toEqual([1, 0]);
      g = passUntil(g, (x) => !!byName(x, 1, 'Plains', 'graveyard'));
      expect(byName(g, 2, 'Lightning Bolt', 'graveyard')).toBeDefined();
      expect(byName(g, 0, 'Goblin Piker')).toBeDefined();
    });

    it("Ragavan: combat damage makes a Treasure and exiles that player's top card, which its controller may cast this turn", () => {
      let g = emptyGame((d) => {
        put(d, 0, 'Ragavan, Nimble Pilferer');
        put(d, 0, 'Mountain');
        library(d, 1, ['Lightning Bolt', 'Plains']);
      });
      g = passUntil(g, (x) => x.decision?.type === 'attackers');
      g = run(g, { type: 'declareAttack', card: byName(g, 0, 'Ragavan, Nimble Pilferer')!.id, defender: 1 }, pass);
      g = passUntil(g, (x) => !!byName(x, 1, 'Lightning Bolt', 'exile'));
      expect(byName(g, 0, 'Treasure')).toBeDefined();
      const bolt = byName(g, 1, 'Lightning Bolt', 'exile')!;
      g = passUntil(g, (x) => x.step === 'main2');
      expect(canCast(g, 0, bolt)).toBe(true);
      g = passUntil(g, (x) => x.turn === 2);
      expect(canCast(g, 0, byName(g, 1, 'Lightning Bolt', 'exile')!)).toBe(false);
    });

    it('Ragavan dashed has haste and returns to its owner\'s hand at the next end step (702.109a)', () => {
      let g = emptyGame((d) => {
        put(d, 0, 'Mountain', 'battlefield', 2);
        put(d, 0, 'Ragavan, Nimble Pilferer', 'hand');
      });
      g = cast(g, 0, 'Ragavan, Nimble Pilferer', { alt: 0 });
      const ragavan = byName(g, 0, 'Ragavan, Nimble Pilferer')!;
      expect(ragavan.sick).toBe(true);
      expect(canAttack(g, ragavan)).toBe(true);
      g = passUntil(g, (x) => !byName(x, 0, 'Ragavan, Nimble Pilferer'));
      expect(byName(g, 0, 'Ragavan, Nimble Pilferer', 'hand')).toBeDefined();
      expect(g.log.find((l) => l.text === "Ragavan, Nimble Pilferer returns to its owner's hand.")?.turn).toBe(1);
    });

    it('Beseech the Mirror: bargained, it may cast the found card free if its mana value is 4 or less; otherwise the card goes to hand', () => {
      const setup = () =>
        emptyGame((d) => {
          put(d, 0, 'Swamp', 'battlefield', 4);
          put(d, 0, 'Beseech the Mirror', 'hand');
          createToken(d, 0, 'Treasure');
          library(d, 0, ['Island', 'Sol Ring', 'Serra Angel', 'Plains']);
        });
      let g = setup();
      g = cast(g, 0, 'Beseech the Mirror', { sacrifice: [byName(g, 0, 'Treasure')!.id] });
      g = run(g, choose(byName(g, 0, 'Sol Ring', 'library')!));
      const ring = byName(g, 0, 'Sol Ring', 'exile')!;
      expect([ring.faceDown, ring.known]).toEqual([true, [0]]);
      expect(asking(g)?.kind).toBe('cast');
      g = run(g, { type: 'cast', card: ring.id });
      g = passUntil(g, (x) => !x.stack.length);
      expect(byName(g, 0, 'Sol Ring')).toBeDefined();
      // Mana value 5 can't be cast this way.
      let h = setup();
      h = cast(h, 0, 'Beseech the Mirror', { sacrifice: [byName(h, 0, 'Treasure')!.id] });
      h = run(h, choose(byName(h, 0, 'Serra Angel', 'library')!));
      expect(canCast(h, 0, byName(h, 0, 'Serra Angel', 'exile')!)).toBe(false);
      h = run(h, no);
      expect(byName(h, 0, 'Serra Angel', 'hand')).toBeDefined();
      // Not bargained: straight to hand.
      let k = cast(setup(), 0, 'Beseech the Mirror');
      k = run(k, choose(byName(k, 0, 'Sol Ring', 'library')!));
      expect(byName(k, 0, 'Sol Ring', 'hand')).toBeDefined();
    });

    it("Sevinne's Reclamation returns a permanent card; cast with flashback it may copy itself once (707.10)", () => {
      let g = emptyGame((d) => {
        put(d, 0, 'Plains', 'battlefield', 5);
        put(d, 0, "Sevinne's Reclamation", 'graveyard');
        put(d, 0, 'Sol Ring', 'graveyard');
        put(d, 0, 'Chrome Mox', 'graveyard');
        put(d, 0, 'Serra Angel', 'graveyard');
      });
      const sevinne = byName(g, 0, "Sevinne's Reclamation", 'graveyard')!;
      const angel = byName(g, 0, 'Serra Angel', 'graveyard')!;
      expect(legalTargets(g, 0, scriptOf("Sevinne's Reclamation").targets![0], sevinne).some((t) => t.id === angel.id)).toBe(false);
      g = run(g, { type: 'cast', card: sevinne.id, targets: [card(byName(g, 0, 'Sol Ring', 'graveyard')!)] });
      expect(byName(g, 0, 'Sol Ring')).toBeDefined();
      g = run(g, yes);
      expect(g.decision?.type).toBe('targets');
      g = run(g, { type: 'chooseTargets', targets: [card(byName(g, 0, 'Chrome Mox', 'graveyard')!)] });
      g = passUntil(g, (x) => !!byName(x, 0, 'Chrome Mox'));
      // The copy wasn't cast from a graveyard: no second copy.
      g = passUntil(g, (x) => !x.stack.length && !x.decision);
      expect(byName(g, 0, "Sevinne's Reclamation", 'exile')).toBeDefined();
    });

    it("Harnfel discards a card to exile the top two, which may be played this turn: a land counts as the turn's land (305.2a)", () => {
      let g = emptyGame((d) => {
        const birgi = put(d, 0, 'Birgi, God of Storytelling // Harnfel, Horn of Bounty');
        birgi.face = 1;
        put(d, 0, 'Swamp', 'hand');
        library(d, 0, ['Island', 'Lightning Bolt', 'Plains']);
      });
      const horn = g.players[0].battlefield[0];
      expect(label(horn)).toBe('Harnfel, Horn of Bounty');
      g = run(g, { type: 'activate', card: horn.id, discard: [byName(g, 0, 'Swamp', 'hand')!.id] });
      const island = byName(g, 0, 'Island', 'exile')!;
      expect(canPlayLand(g, 0, island)).toBe(true);
      g = run(g, { type: 'playLand', card: island.id });
      expect(byName(g, 0, 'Island')).toBeDefined();
      expect(g.players[0].landsPlayed).toBe(1);
      expect(canCast(g, 0, byName(g, 0, 'Lightning Bolt', 'exile')!)).toBe(false); // no red mana
    });

    it("Jeska's Will: both modes with a commander out, red mana for the opponent's hand and three cards to play", () => {
      let g = emptyGame((d) => {
        put(d, 0, 'Mountain', 'battlefield', 3);
        put(d, 0, "Jeska's Will", 'hand');
        library(d, 0, ['Plains', 'Sol Ring', 'Island', 'Swamp']);
        for (const n of ['Plains', 'Plains', 'Plains', 'Plains']) put(d, 1, n, 'hand');
      });
      const will = byName(g, 0, "Jeska's Will", 'hand')!;
      expect(maxModes(g, 0, will)).toBe(1);
      g = produce(g, (d) => commanderOut(d, 0));
      expect(maxModes(g, 0, byName(g, 0, "Jeska's Will", 'hand')!)).toBe(2);
      g = cast(g, 0, "Jeska's Will", { modes: [0, 1], targets: [player(1)] });
      expect(g.players[0].pool.map((m) => m.sym)).toEqual(['R', 'R', 'R', 'R']);
      expect(g.players[0].exile.map((c) => c.name)).toEqual(['Plains', 'Sol Ring', 'Island']);
      expect(canCast(g, 0, byName(g, 0, 'Sol Ring', 'exile')!)).toBe(true);
    });
  });

  describe('instants and their tricks', () => {
    it('Ad Nauseam reveals, draws and costs life until its caster stops', () => {
      let g = emptyGame((d) => {
        put(d, 0, 'Swamp', 'battlefield', 5);
        put(d, 0, 'Ad Nauseam', 'hand');
        library(d, 0, ['Sol Ring', 'Serra Angel', 'Plains']);
      });
      g = cast(g, 0, 'Ad Nauseam');
      g = run(g, yes, no);
      expect(g.players[0].hand.map((c) => c.name)).toEqual(['Sol Ring', 'Serra Angel']);
      expect(g.players[0].life).toBe(40 - 1 - 5);
    });

    it('Intuition: three cards are found and revealed, the target opponent chooses one for the hand, the rest go to the graveyard', () => {
      let g = emptyGame((d) => {
        put(d, 0, 'Island', 'battlefield', 3);
        put(d, 0, 'Intuition', 'hand');
        library(d, 0, ['Plains', 'Sol Ring', 'Lightning Bolt', 'Dark Ritual', 'Island']);
      });
      g = cast(g, 0, 'Intuition', { targets: [player(2)] });
      const found = ['Sol Ring', 'Lightning Bolt', 'Dark Ritual'].map((n) => byName(g, 0, n, 'library')!);
      expect(applyAction(g, choose(found[0], found[1]))).toBe(g); // three must be found
      g = run(g, choose(...found));
      expect([asking(g)?.kind, g.priority]).toEqual(['pick', 2]);
      g = run(g, choose(found[2]));
      expect(byName(g, 0, 'Dark Ritual', 'hand')).toBeDefined();
      expect(g.players[0].graveyard.map((c) => c.name).sort()).toEqual(['Intuition', 'Lightning Bolt', 'Sol Ring']);
    });

    it('Deflecting Swat is free with a commander out, and changes the targets of a spell (115.7d)', () => {
      let g = emptyGame((d) => {
        commanderOut(d, 0);
        put(d, 0, 'Mountain');
        put(d, 0, 'Lightning Bolt', 'hand');
        put(d, 0, 'Deflecting Swat', 'hand');
      });
      g = cast(g, 0, 'Lightning Bolt', { targets: [player(2)], hold: true });
      const bolt = top(g);
      g = cast(g, 0, 'Deflecting Swat', { alt: 0, targets: [bolt] });
      expect(g.decision?.type).toBe('retarget');
      // A creature card in a graveyard isn't a legal target for the Bolt.
      expect(applyAction(g, { type: 'chooseTargets', targets: [{ kind: 'card', id: 'nope' }] })).toBe(g);
      g = run(g, { type: 'chooseTargets', targets: [player(3)] });
      g = passUntil(g, (x) => !x.stack.length);
      expect([g.players[2].life, g.players[3].life]).toEqual([40, 37]);
    });

    it("Chain of Vapor: the bounced permanent's controller may sacrifice a land to copy it, with a new target", () => {
      let g = emptyGame((d) => {
        put(d, 0, 'Island');
        put(d, 0, 'Plains');
        put(d, 0, 'Chain of Vapor', 'hand');
        put(d, 0, 'Sol Ring');
        put(d, 1, 'Goblin Piker');
        put(d, 1, 'Mountain');
      });
      g = cast(g, 0, 'Chain of Vapor', { targets: [card(byName(g, 1, 'Goblin Piker')!)] });
      expect(byName(g, 1, 'Goblin Piker', 'hand')).toBeDefined();
      expect([asking(g)?.kind, g.priority]).toEqual(['pick', 1]);
      g = run(g, choose(byName(g, 1, 'Mountain')!), yes);
      expect(byName(g, 1, 'Mountain', 'graveyard')).toBeDefined();
      expect([g.decision?.type, g.priority]).toEqual(['targets', 1]);
      g = run(g, { type: 'chooseTargets', targets: [card(byName(g, 0, 'Sol Ring')!)] });
      g = passUntil(g, (x) => !!byName(x, 0, 'Sol Ring', 'hand'));
      // Now its controller may do the same; they decline.
      expect([asking(g)?.kind, g.priority]).toEqual(['pick', 0]);
      g = run(g, choose());
      expect(byName(g, 0, 'Plains')).toBeDefined();
    });

    it('Into the Flood Maw: without a gift it bounces a creature; with one, the chosen opponent gets a tapped Fish first and any nonland permanent can be bounced (702.174)', () => {
      let g = emptyGame((d) => {
        put(d, 0, 'Island');
        put(d, 0, 'Into the Flood Maw', 'hand');
        put(d, 1, 'Goblin Piker');
        put(d, 2, 'Sol Ring');
      });
      const maw = byName(g, 0, 'Into the Flood Maw', 'hand')!;
      const ring = card(byName(g, 2, 'Sol Ring')!);
      expect(applyAction(g, { type: 'cast', card: maw.id, targets: [ring] })).toBe(g);
      g = cast(g, 0, 'Into the Flood Maw', { gift: 3, targets: [ring] });
      expect(byName(g, 2, 'Sol Ring', 'hand')).toBeDefined();
      expect(byName(g, 3, 'Fish')!.tapped).toBe(true);
    });

    it('Flare of Duplication: sacrifice a nontoken red creature instead of its cost, and copy an instant with new targets', () => {
      let g = emptyGame((d) => {
        put(d, 0, 'Mountain');
        put(d, 0, 'Goblin Piker');
        put(d, 0, 'Lightning Bolt', 'hand');
        put(d, 0, 'Flare of Duplication', 'hand');
      });
      g = cast(g, 0, 'Lightning Bolt', { targets: [player(1)], hold: true });
      g = cast(g, 0, 'Flare of Duplication', { alt: 0, sacrifice: [byName(g, 0, 'Goblin Piker')!.id], targets: [top(g)] });
      expect(byName(g, 0, 'Goblin Piker', 'graveyard')).toBeDefined();
      expect(g.decision?.type).toBe('targets');
      g = run(g, { type: 'chooseTargets', targets: [player(2)] });
      g = passUntil(g, (x) => !x.stack.length);
      expect([g.players[1].life, g.players[2].life]).toEqual([37, 37]);
    });

    it("Hexing Squelcher: ward—pay 2 life for it and its controller's other creatures (702.21a); their spells can't be countered", () => {
      let g = emptyGame((d) => {
        d.active = 1;
        d.priority = 1;
        put(d, 0, 'Hexing Squelcher');
        put(d, 0, 'Goblin Piker');
        put(d, 1, 'Mountain', 'battlefield', 2);
        put(d, 1, 'Lightning Bolt', 'hand');
        put(d, 1, 'Shock', 'hand');
      });
      g = cast(g, 1, 'Lightning Bolt', { targets: [card(byName(g, 0, 'Goblin Piker')!)] });
      // Ward triggers: pay 2 life or the Bolt is countered.
      g = passUntil(g, (x) => asking(x)?.kind === 'ask');
      expect(g.priority).toBe(1);
      g = run(g, no);
      expect(byName(g, 0, 'Goblin Piker')).toBeDefined();
      g = cast(g, 1, 'Shock', { targets: [card(byName(g, 0, 'Goblin Piker')!)] });
      g = passUntil(g, (x) => asking(x)?.kind === 'ask');
      g = run(g, yes);
      expect(g.players[1].life).toBe(38);
      expect(byName(g, 0, 'Goblin Piker', 'graveyard')).toBeDefined();
    });

    it('Rain of Filth: the lands you control as it resolves gain "Sacrifice this land: Add {B}" until end of turn', () => {
      let g = emptyGame((d) => {
        put(d, 0, 'Swamp');
        put(d, 0, 'Plains');
        put(d, 0, 'Island', 'hand');
        put(d, 0, 'Rain of Filth', 'hand');
      });
      g = cast(g, 0, 'Rain of Filth');
      g = run(g, { type: 'playLand', card: byName(g, 0, 'Island', 'hand')!.id });
      const plains = byName(g, 0, 'Plains')!;
      expect(manaOf(g, plains)?.colors.sort()).toEqual(['B', 'W']);
      expect(manaOf(g, byName(g, 0, 'Island')!)?.colors).toEqual(['U']);
      g = run(g, { type: 'tapMana', card: plains.id });
      g = run(g, { type: 'tapMana', card: plains.id });
      expect(byName(g, 0, 'Plains', 'graveyard')).toBeDefined();
      expect(g.players[0].pool.map((m) => m.sym)).toEqual(['W', 'B']);
    });
  });

  describe('permanents', () => {
    it("Lion's Eye Diamond: discard your hand and sacrifice it for three mana of one colour; auto-pay never uses it", () => {
      let g = emptyGame((d) => {
        put(d, 0, "Lion's Eye Diamond");
        put(d, 0, 'Island', 'hand');
        put(d, 0, 'Plains', 'hand');
      });
      expect(planPayment(g, 0, parseCost('{1}'))).toBeNull();
      g = run(g, { type: 'tapMana', card: byName(g, 0, "Lion's Eye Diamond")!.id, color: 'B' });
      expect(g.players[0].pool.map((m) => m.sym)).toEqual(['B', 'B', 'B']);
      expect(g.players[0].hand).toEqual([]);
      expect(g.players[0].graveyard.map((c) => c.name).sort()).toEqual(['Island', "Lion's Eye Diamond", 'Plains']);
    });

    it('Necropotence: skip the draw step; pay 1 life to exile the top card face down until your end step; discards are exiled', () => {
      let g = emptyGame((d) => {
        put(d, 0, 'Necropotence');
        put(d, 0, "Lion's Eye Diamond");
        put(d, 0, 'Plains', 'hand');
        library(d, 0, ['Sol Ring', 'Island', 'Swamp', 'Mountain']);
      });
      g = run(g, { type: 'activate', card: byName(g, 0, 'Necropotence')!.id });
      expect(g.players[0].life).toBe(39);
      expect(byName(g, 0, 'Sol Ring', 'exile')!.faceDown).toBe(true);
      // Discarding the hand to Lion's Eye Diamond: the Plains is exiled.
      g = run(g, { type: 'tapMana', card: byName(g, 0, "Lion's Eye Diamond")!.id });
      g = passUntil(g, (x) => !!byName(x, 0, 'Plains', 'exile'));
      g = passUntil(g, (x) => !!byName(x, 0, 'Sol Ring', 'hand'));
      expect(g.log.find((l) => l.text.includes('exiled with Necropotence into their hand'))?.turn).toBe(1);
      g = passUntil(g, (x) => x.active === 0 && x.step === 'main1');
      expect(g.players[0].library.length).toBe(3);
      expect(g.log.some((l) => l.text.includes('skips their draw step'))).toBe(true);
    });

    it("Dragon's Rage Channeler: surveil 1 for each noncreature spell; with delirium it is 3/3, flies, and attacks each combat (508.1d)", () => {
      let g = emptyGame((d) => {
        put(d, 0, "Dragon's Rage Channeler");
        put(d, 0, 'Mountain');
        put(d, 0, 'Lightning Bolt', 'hand');
        library(d, 0, ['Sol Ring', 'Plains']);
        for (const n of ['Goblin Piker', 'Plains']) put(d, 0, n, 'graveyard');
      });
      g = cast(g, 0, 'Lightning Bolt', { targets: [player(1)] });
      expect(asking(g)?.kind).toBe('pick');
      g = run(g, choose(byName(g, 0, 'Sol Ring', 'library')!));
      // Creature, land, instant and artifact: delirium.
      const drc = byName(g, 0, "Dragon's Rage Channeler")!;
      expect(stats(g, drc).power).toBe(3);
      expect(stats(g, drc).keywords.has('flying')).toBe(true);
      g = passUntil(g, (x) => x.decision?.type === 'attackers');
      g = run(g, pass);
      expect(g.players[1].life).toBe(37 - 3);
    });

    it("Birgi: whenever you cast a spell, add {R} that stays until the end of the turn", () => {
      let g = emptyGame((d) => {
        put(d, 0, 'Birgi, God of Storytelling // Harnfel, Horn of Bounty');
        put(d, 0, 'Plains');
        put(d, 0, 'Sol Ring', 'hand');
      });
      g = cast(g, 0, 'Sol Ring');
      expect(g.players[0].pool.map((m) => m.sym)).toEqual(['R']);
      // Still there in a later step (Birgi can attack, so the game stops to declare attackers).
      g = passUntil(g, (x) => x.step === 'attackers');
      expect(g.players[0].pool.map((m) => m.sym)).toEqual(['R']);
      g = passUntil(g, (x) => x.turn === 2);
      expect(g.players[0].pool).toEqual([]);
    });

    it('Otawara is channelled from the hand, {1} less for each legendary creature you control', () => {
      let g = emptyGame((d) => {
        put(d, 0, 'Island', 'battlefield', 3);
        put(d, 0, 'Ragavan, Nimble Pilferer');
        put(d, 0, 'Otawara, Soaring City', 'hand');
        put(d, 1, 'Sol Ring');
      });
      const otawara = byName(g, 0, 'Otawara, Soaring City', 'hand')!;
      expect(abilityCost(scriptOf('Otawara, Soaring City').activated as ActivatedAbility, g, otawara)).toMatchObject({ generic: 2, pips: ['U'] });
      g = run(g, { type: 'activate', card: otawara.id, targets: [card(byName(g, 1, 'Sol Ring')!)] });
      expect(byName(g, 0, 'Otawara, Soaring City', 'graveyard')).toBeDefined();
      expect(byName(g, 1, 'Sol Ring', 'hand')).toBeDefined();
    });
  });

  describe('bots', () => {
    const playBots = (g: Game, until: (g: Game) => boolean) => {
      for (let i = 0; i < 300 && !until(g) && g.step !== 'gameOver'; i++) g = applyBotAction(g, botAction(g, g.priority));
      return g;
    };

    it("win with Thassa's Oracle and Demonic Consultation, naming a card that isn't in the library", () => {
      let g = emptyGame((d) => {
        put(d, 0, 'Island', 'battlefield', 2);
        put(d, 0, 'Swamp');
        put(d, 0, "Thassa's Oracle", 'hand');
        put(d, 0, 'Demonic Consultation', 'hand');
        library(d, 0, ['Plains', 'Sol Ring', 'Island', 'Swamp', 'Mountain', 'Plains', 'Island', 'Swamp', 'Mountain', 'Plains']);
      });
      g = playBots(g, (x) => x.winner !== null);
      expect(g.winner).toBe(0);
    });

    it("win with Thassa's Oracle and Tainted Pact, taking nothing", () => {
      let g = emptyGame((d) => {
        put(d, 0, 'Island', 'battlefield', 2);
        put(d, 0, 'Swamp', 'battlefield', 2);
        put(d, 0, "Thassa's Oracle", 'hand');
        put(d, 0, 'Tainted Pact', 'hand');
        library(d, 0, ['Plains', 'Sol Ring', 'Island', 'Swamp', 'Mountain']);
      });
      g = playBots(g, (x) => x.winner !== null);
      expect(g.winner).toBe(0);
    });

    it('cast a ritual when its mana lets them cast something bigger', () => {
      let g = emptyGame((d) => {
        put(d, 0, 'Swamp', 'battlefield', 3);
        put(d, 0, 'Dark Ritual', 'hand');
        put(d, 0, 'Gray Merchant of Asphodel', 'hand');
      });
      g = playBots(g, (x) => !!byName(x, 0, 'Gray Merchant of Asphodel') || x.turn > 1);
      expect(byName(g, 0, 'Gray Merchant of Asphodel')).toBeDefined();
      expect(byName(g, 0, 'Dark Ritual', 'graveyard')).toBeDefined();
    });

    it('cast Final Fortune only when the extra turn can win the game', () => {
      const setup = (power: string) =>
        emptyGame((d) => {
          d.step = 'main2';
          for (const pid of [2, 3]) d.players[pid].lost = true;
          d.players[1].life = 5;
          put(d, 0, 'Mountain', 'battlefield', 2);
          put(d, 0, 'Final Fortune', 'hand');
          put(d, 0, power);
        });
      const strong = setup('Shivan Dragon');
      expect(botAction(strong, 0)).toMatchObject({ type: 'cast', card: byName(strong, 0, 'Final Fortune', 'hand')!.id });
      const weak = setup('Goblin Piker');
      expect(botAction(weak, 0)).not.toMatchObject({ type: 'cast', card: byName(weak, 0, 'Final Fortune', 'hand')!.id });
    });
  });
});

describe('the two-colour starter decks (session 8a)', () => {
  const player = (id: number) => ({ kind: 'player', id }) as const;
  const card = (c: { id: string }) => ({ kind: 'card', id: c.id }) as const;
  const cast = (g: Game, pid: number, name: string, extra: object = {}) => run(g, { type: 'cast', card: byName(g, pid, name, 'hand')!.id, ...extra } as Action);
  const yes = { type: 'answer', yes: true } as const;
  const no = { type: 'answer', yes: false } as const;
  const choose = (...cards: { id: string }[]) => ({ type: 'chooseCards', cards: cards.map((c) => c.id) }) as const;
  const asking = (g: Game) => (g.decision && 'choice' in g.decision ? g.decision.choice : undefined);
  const settle = (g: Game, done: (g: Game) => boolean) => {
    for (let i = 0; i < 200 && !done(g); i++) g = run(g, pass);
    return g;
  };

  it('Karlov: two +1/+1 counters whenever you gain life; remove six to exile a creature', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Karlov of the Ghost Council');
      put(d, 0, 'Plains', 'battlefield', 4);
      put(d, 0, 'Swamp', 'battlefield', 2);
      put(d, 0, 'Revitalize', 'hand');
      put(d, 1, 'Serra Angel');
    });
    const karlov = byName(g, 0, 'Karlov of the Ghost Council')!;
    expect(canActivate(g, 0, karlov)).toBe(false);
    g = produce(g, (d) => void addCounters(d, byName(d, 0, 'Karlov of the Ghost Council'), 4));
    g = cast(g, 0, 'Revitalize');
    expect(byName(g, 0, 'Karlov of the Ghost Council')!.counters['+1/+1']).toBe(6);
    g = run(g, { type: 'activate', card: karlov.id, targets: [card(byName(g, 1, 'Serra Angel')!)] });
    expect(byName(g, 1, 'Serra Angel', 'exile')).toBeDefined();
    expect(byName(g, 0, 'Karlov of the Ghost Council')!.counters['+1/+1']).toBeUndefined();
  });

  it('Vito: whenever you gain life, the target opponent loses that much', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Vito, Thorn of the Dusk Rose');
      put(d, 0, 'Plains', 'battlefield', 2);
      put(d, 0, 'Revitalize', 'hand');
    });
    g = cast(g, 0, 'Revitalize');
    expect(g.decision?.type).toBe('targets');
    g = run(g, { type: 'chooseTargets', targets: [player(2)] });
    expect([g.players[0].life, g.players[2].life]).toEqual([43, 37]);
  });

  it('Righteous Valkyrie: life from Angels and Clerics entering; +2/+2 at 47 life or more', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Righteous Valkyrie');
      put(d, 0, 'Plains', 'battlefield', 4);
      put(d, 0, 'Seraph of Dawn', 'hand');
      d.players[0].life = 44;
    });
    const valkyrie = byName(g, 0, 'Righteous Valkyrie')!;
    expect(stats(g, valkyrie).power).toBe(2);
    g = cast(g, 0, 'Seraph of Dawn');
    expect(g.players[0].life).toBe(48);
    expect(stats(g, byName(g, 0, 'Righteous Valkyrie')!).power).toBe(4);
    expect(stats(g, byName(g, 0, 'Seraph of Dawn')!).power).toBe(4);
  });

  it('Judith: other creatures get +1/+0; a nontoken creature of yours dying deals 1 damage', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Judith, the Scourge Diva');
      put(d, 0, 'Goblin Piker');
      put(d, 0, 'Swamp');
      put(d, 0, 'Village Rites', 'hand');
    });
    const judith = byName(g, 0, 'Judith, the Scourge Diva')!;
    expect([stats(g, judith).power, stats(g, byName(g, 0, 'Goblin Piker')!).power]).toEqual([2, 3]);
    g = cast(g, 0, 'Village Rites', { sacrifice: [byName(g, 0, 'Goblin Piker')!.id] });
    expect(g.decision?.type).toBe('targets');
    g = run(g, { type: 'chooseTargets', targets: [player(1)] });
    g = settle(g, (x) => !x.stack.length);
    expect(g.players[1].life).toBe(39);
  });

  it('Fling deals the sacrificed creature\'s power as it was sacrificed (608.2h)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Judith, the Scourge Diva');
      put(d, 0, 'Shivan Dragon');
      put(d, 0, 'Mountain', 'battlefield', 2);
      put(d, 0, 'Fling', 'hand');
    });
    g = cast(g, 0, 'Fling', { sacrifice: [byName(g, 0, 'Shivan Dragon')!.id], targets: [player(2)] });
    // Judith's trigger targets player 3.
    g = run(g, { type: 'chooseTargets', targets: [player(3)] });
    g = settle(g, (x) => !x.stack.length);
    expect([g.players[2].life, g.players[3].life]).toEqual([40 - 6, 39]);
  });

  it('Goblin Bombardment sacrifices a creature as a cost, and Mayhem Devil sees every sacrifice', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Goblin Bombardment');
      put(d, 0, 'Mayhem Devil');
      put(d, 0, 'Goblin Piker');
    });
    const bombardment = byName(g, 0, 'Goblin Bombardment')!;
    expect(applyAction(g, { type: 'activate', card: bombardment.id, targets: [player(1)] })).toBe(g); // the sacrifice is required
    g = run(g, { type: 'activate', card: bombardment.id, targets: [player(1)], sacrifice: [byName(g, 0, 'Goblin Piker')!.id] });
    expect(byName(g, 0, 'Goblin Piker', 'graveyard')).toBeDefined();
    // Mayhem Devil's trigger goes on the stack above the ability.
    expect(g.decision?.type).toBe('targets');
    g = run(g, { type: 'chooseTargets', targets: [player(2)] });
    g = settle(g, (x) => !x.stack.length);
    expect([g.players[1].life, g.players[2].life]).toEqual([39, 39]);
  });

  it('Falkenrath Aristocrat gains indestructible, and a +1/+1 counter for a Human', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Falkenrath Aristocrat');
      put(d, 0, 'Elite Vanguard');
    });
    const aristocrat = byName(g, 0, 'Falkenrath Aristocrat')!;
    g = run(g, { type: 'activate', card: aristocrat.id, sacrifice: [byName(g, 0, 'Elite Vanguard')!.id] });
    const after = byName(g, 0, 'Falkenrath Aristocrat')!;
    expect(stats(g, after).keywords.has('indestructible')).toBe(true);
    expect(after.counters['+1/+1']).toBe(1);
  });

  it('Butcher of Malakir: each opponent sacrifices a creature of their choice, in turn order', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Butcher of Malakir');
      put(d, 0, 'Goblin Piker');
      put(d, 0, 'Swamp');
      put(d, 0, 'Village Rites', 'hand');
      put(d, 1, 'Serra Angel');
      put(d, 1, 'Elite Vanguard');
      put(d, 3, 'Llanowar Elves');
    });
    g = cast(g, 0, 'Village Rites', { sacrifice: [byName(g, 0, 'Goblin Piker')!.id] });
    g = settle(g, (x) => asking(x)?.kind === 'pick');
    expect(g.priority).toBe(1);
    g = run(g, choose(byName(g, 1, 'Elite Vanguard')!));
    expect(g.priority).toBe(3); // player 2 has no creature
    g = run(g, choose(byName(g, 3, 'Llanowar Elves')!));
    expect(byName(g, 1, 'Serra Angel')).toBeDefined();
    expect(byName(g, 3, 'Llanowar Elves', 'graveyard')).toBeDefined();
  });

  it("Blood Artist and Cruel Celebrant drain when creatures die; Ministrant leaves two Spirits", () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Cruel Celebrant');
      put(d, 0, 'Blood Artist');
      put(d, 0, 'Ministrant of Obligation');
      put(d, 0, 'Swamp');
      put(d, 0, 'Village Rites', 'hand');
    });
    g = cast(g, 0, 'Village Rites', { sacrifice: [byName(g, 0, 'Ministrant of Obligation')!.id] });
    g = settle(g, (x) => x.decision?.type === 'targets');
    g = run(g, { type: 'chooseTargets', targets: [player(1)] });
    g = settle(g, (x) => !x.stack.length);
    expect(g.players.map((p) => p.life)).toEqual([42, 38, 39, 39]);
    expect(g.players[0].battlefield.filter((c) => c.name === 'Spirit 1/1 flying WB')).toHaveLength(2);
  });

  it("Kolaghan's Command and Blightning make the player discard cards of their choice (701.9a)", () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Swamp', 'battlefield', 3);
      put(d, 0, 'Mountain', 'battlefield', 3);
      put(d, 0, 'Blightning', 'hand');
      put(d, 0, "Kolaghan's Command", 'hand');
      put(d, 0, 'Goblin Piker', 'graveyard');
      for (const n of ['Plains', 'Island', 'Swamp']) put(d, 1, n, 'hand');
    });
    g = cast(g, 0, 'Blightning', { targets: [player(1)] });
    expect([asking(g)?.kind, g.priority]).toEqual(['pick', 1]);
    g = run(g, choose(byName(g, 1, 'Plains', 'hand')!, byName(g, 1, 'Island', 'hand')!));
    expect(g.players[1].hand.map((c) => c.name)).toEqual(['Swamp']);
    expect(g.players[1].life).toBe(37);
    g = cast(g, 0, "Kolaghan's Command", { modes: [0, 1], targets: [card(byName(g, 0, 'Goblin Piker', 'graveyard')!), player(1)] });
    g = run(g, choose(byName(g, 1, 'Swamp', 'hand')!));
    expect(byName(g, 0, 'Goblin Piker', 'hand')).toBeDefined();
    expect(g.players[1].hand).toEqual([]);
  });

  it('Debt to the Deathless: each opponent loses 2X, you gain it all', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Plains', 'battlefield', 4);
      put(d, 0, 'Swamp', 'battlefield', 4);
      put(d, 0, 'Debt to the Deathless', 'hand');
    });
    g = cast(g, 0, 'Debt to the Deathless', { x: 3 });
    expect(g.players.map((p) => p.life)).toEqual([58, 34, 34, 34]);
  });

  it('dual lands: gain lands, pain lands, check lands and shock lands', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Scoured Barrens', 'hand');
      put(d, 0, 'Isolated Chapel', 'hand');
      put(d, 0, 'Godless Shrine', 'hand');
      put(d, 0, 'Caves of Koilos');
    });
    g = run(g, { type: 'playLand', card: byName(g, 0, 'Scoured Barrens', 'hand')!.id });
    expect([byName(g, 0, 'Scoured Barrens')!.tapped, g.players[0].life]).toEqual([true, 41]);
    // Pain land: colourless is free, a colour costs 1 damage.
    expect(manaOf(g, byName(g, 0, 'Caves of Koilos')!)?.colors.sort()).toEqual(['B', 'C', 'W']);
    g = run(g, { type: 'tapMana', card: byName(g, 0, 'Caves of Koilos')!.id, ability: 1, color: 'B' });
    expect(g.players[0].life).toBe(40);
    // Check land: no Plains or Swamp yet, so it enters tapped.
    let h = produce(g, (d) => void (d.players[0].landsPlayed = 0));
    h = run(h, { type: 'playLand', card: byName(h, 0, 'Isolated Chapel', 'hand')!.id });
    expect(byName(h, 0, 'Isolated Chapel')!.tapped).toBe(true);
    // Shock land: pay 2 life or it enters tapped. It has the types Plains and Swamp.
    let k = produce(g, (d) => void (d.players[0].landsPlayed = 0));
    k = run(k, { type: 'playLand', card: byName(k, 0, 'Godless Shrine', 'hand')!.id });
    expect(asking(k)?.kind).toBe('ask');
    k = run(k, yes);
    expect([byName(k, 0, 'Godless Shrine')!.tapped, k.players[0].life]).toEqual([false, 38]);
    let m = produce(g, (d) => void (d.players[0].landsPlayed = 0));
    m = run(m, { type: 'playLand', card: byName(m, 0, 'Godless Shrine', 'hand')!.id }, no);
    expect(byName(m, 0, 'Godless Shrine')!.tapped).toBe(true);
    // Now a check land sees a Plains and enters untapped.
    m = produce(m, (d) => void (d.players[0].landsPlayed = 0));
    m = run(m, { type: 'playLand', card: byName(m, 0, 'Isolated Chapel', 'hand')!.id });
    expect(byName(m, 0, 'Isolated Chapel')!.tapped).toBe(false);
  });

  it("a permanent sacrificed for a spell's cost can't also make mana for it (Deadly Dispute and a Treasure)", () => {
    const g = emptyGame((d) => {
      put(d, 0, 'Swamp');
      put(d, 0, 'Deadly Dispute', 'hand');
      createToken(d, 0, 'Treasure');
    });
    const dispute = byName(g, 0, 'Deadly Dispute', 'hand')!;
    const treasure = byName(g, 0, 'Treasure')!;
    expect(canCast(g, 0, dispute, { sacrifice: [treasure.id] })).toBe(false);
    const h = produce(g, (d) => void put(d, 0, 'Swamp'));
    const after = run(h, { type: 'cast', card: dispute.id, sacrifice: [treasure.id] });
    expect(after.players[0].hand).toHaveLength(2);
  });

  it('Carrier Thrall leaves an Eldrazi Scion that sacrifices itself for {C}', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Carrier Thrall');
      put(d, 0, 'Swamp');
      put(d, 0, 'Village Rites', 'hand');
    });
    g = cast(g, 0, 'Village Rites', { sacrifice: [byName(g, 0, 'Carrier Thrall')!.id] });
    const scion = byName(g, 0, 'Eldrazi Scion')!;
    expect(scion.sick).toBe(true);
    g = run(g, { type: 'tapMana', card: scion.id });
    expect(g.players[0].pool.map((m) => m.sym)).toEqual(['C']);
    expect(byName(g, 0, 'Eldrazi Scion')).toBeUndefined();
  });

  it('Zealous Persecution and Lingering Souls with flashback', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Plains', 'battlefield', 4);
      put(d, 0, 'Swamp', 'battlefield', 2);
      put(d, 0, 'Lingering Souls', 'graveyard');
      put(d, 0, 'Zealous Persecution', 'hand');
      put(d, 1, 'Llanowar Elves');
    });
    g = run(g, { type: 'cast', card: byName(g, 0, 'Lingering Souls', 'graveyard')!.id });
    expect(g.players[0].battlefield.filter((c) => c.name === 'Spirit 1/1 flying')).toHaveLength(2);
    expect(byName(g, 0, 'Lingering Souls', 'exile')).toBeDefined();
    g = cast(g, 0, 'Zealous Persecution');
    expect(byName(g, 1, 'Llanowar Elves', 'graveyard')).toBeDefined();
    expect(stats(g, byName(g, 0, 'Spirit 1/1 flying')!).power).toBe(2);
  });
});

describe('the red-green and green-white starter decks (session 8b)', () => {
  const player = (id: number) => ({ kind: 'player', id }) as const;
  const card = (c: { id: string }) => ({ kind: 'card', id: c.id }) as const;
  const cast = (g: Game, pid: number, name: string, extra: object = {}) => run(g, { type: 'cast', card: byName(g, pid, name, 'hand')!.id, ...extra } as Action);
  const choose = (...cards: { id: string }[]) => ({ type: 'chooseCards', cards: cards.map((c) => c.id) }) as const;
  const asking = (g: Game) => (g.decision && 'choice' in g.decision ? g.decision.choice : undefined);
  const tokens = (g: Game, pid: number, name: string) => g.players[pid].battlefield.filter((c) => c.name === name);
  const attack = (g: Game, ...names: string[]) =>
    run(g, ...names.map((n) => ({ type: 'declareAttack', card: byName(g, 0, n)!.id, defender: 1 }) as Action));

  it('Halana and Alena: at the beginning of combat on your turn, X counters and haste for another creature (507)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Halana and Alena, Partners');
      put(d, 0, 'Raging Goblin').sick = true;
    });
    g = run(g, pass);
    expect([g.step, g.decision?.type]).toEqual(['beginCombat', 'targets']);
    // "Another" target creature: not Halana and Alena themselves.
    expect(applyAction(g, { type: 'chooseTargets', targets: [card(byName(g, 0, 'Halana and Alena, Partners')!)] })).toBe(g);
    g = run(g, { type: 'chooseTargets', targets: [card(byName(g, 0, 'Raging Goblin')!)] });
    const goblin = byName(g, 0, 'Raging Goblin')!;
    expect(goblin.counters['+1/+1']).toBe(2);
    expect(stats(g, goblin).keywords.has('haste')).toBe(true);
    expect(canAttack(g, goblin)).toBe(true);
  });

  it("Halana and Alena don't trigger on an opponent's turn", () => {
    let g = emptyGame((d) => {
      d.active = 1;
      d.priority = 1;
      put(d, 0, 'Halana and Alena, Partners');
      put(d, 0, 'Raging Goblin');
    });
    g = run(g, pass);
    expect(g.stack).toEqual([]);
    expect(byName(g, 0, 'Raging Goblin')!.counters['+1/+1']).toBeUndefined();
  });

  it('Savage Ventmaw adds mana that lasts the turn; Atarka gives attacking Dragons double strike; Utvara makes a Dragon', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Savage Ventmaw');
      put(d, 0, 'Atarka, World Render');
      put(d, 0, 'Utvara Hellkite');
    });
    g = run(g, pass);
    g = attack(g, 'Savage Ventmaw');
    // Pass by hand, so the turn stops in the second main phase.
    for (let i = 0; i < 100 && g.step !== 'main2'; i++) g = runWith({ autoPass: false }, g, g.decision?.type === 'orderTriggers' ? { type: 'orderTriggers', order: g.triggers.map((t) => t.id) } : pass);
    expect(stats(g, byName(g, 0, 'Savage Ventmaw')!).keywords.has('double strike')).toBe(true);
    expect(tokens(g, 0, 'Dragon 6/6 flying')).toHaveLength(1);
    expect(g.players[1].life).toBe(32); // 4 first-strike damage, then 4 regular
    // The mana stays as steps and phases end, until the end of the turn.
    expect(g.players[0].pool.map((m) => m.sym).sort()).toEqual(['G', 'G', 'G', 'R', 'R', 'R']);
  });

  it('Emmara makes a Soldier whenever she becomes tapped, by attacking too', () => {
    let g = emptyGame((d) => void put(d, 0, 'Emmara, Soul of the Accord'));
    g = run(g, pass);
    g = attack(g, 'Emmara, Soul of the Accord');
    g = run(g, pass);
    for (let i = 0; i < 10 && g.stack.length; i++) g = run(g, pass);
    expect(tokens(g, 0, 'Soldier 1/1 lifelink')).toHaveLength(1);
  });

  it('Ghor-Clan Rampager: bloodrush from the hand on an attacking creature', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Goblin Piker');
      put(d, 0, 'Mountain');
      put(d, 0, 'Forest');
      put(d, 0, 'Ghor-Clan Rampager', 'hand');
    });
    const rampager = byName(g, 0, 'Ghor-Clan Rampager', 'hand')!;
    const piker = byName(g, 0, 'Goblin Piker')!;
    expect(canActivate(g, 0, rampager)).toBe(false); // nothing is attacking
    g = run(g, pass);
    g = attack(g, 'Goblin Piker');
    g = runWith({ autoPass: false }, g, pass);
    expect([g.step, g.priority]).toEqual(['attackers', 0]);
    g = runWith({ autoPass: false }, g, { type: 'activate', card: rampager.id, targets: [card(piker)] });
    expect(byName(g, 0, 'Ghor-Clan Rampager', 'graveyard')).toBeDefined();
    for (let i = 0; i < 10 && g.stack.length; i++) g = runWith({ autoPass: false }, g, pass);
    const after = stats(g, byName(g, 0, 'Goblin Piker')!);
    expect([after.power, after.toughness, after.keywords.has('trample')]).toEqual([6, 5, true]);
  });

  it("Domri's Ambush: a counter, then damage equal to the creature's power", () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Goblin Piker');
      put(d, 0, 'Mountain');
      put(d, 0, 'Forest');
      put(d, 0, "Domri's Ambush", 'hand');
      put(d, 1, 'Serra Angel');
    });
    g = cast(g, 0, "Domri's Ambush", { targets: [card(byName(g, 0, 'Goblin Piker')!), card(byName(g, 1, 'Serra Angel')!)] });
    expect(byName(g, 0, 'Goblin Piker')!.counters['+1/+1']).toBe(1);
    expect(byName(g, 1, 'Serra Angel')!.damage).toBe(3); // the Piker is 3/2 now
  });

  it('Decimate needs all four targets, and one object may be two of them (115.3)', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Mountain', 'battlefield', 2);
      put(d, 0, 'Forest', 'battlefield', 2);
      put(d, 0, 'Decimate', 'hand');
      put(d, 1, 'Solemn Simulacrum');
    });
    const decimate = byName(g, 0, 'Decimate', 'hand')!;
    const golem = byName(g, 1, 'Solemn Simulacrum')!;
    expect(canCast(g, 0, decimate)).toBe(false); // no enchantment to target
    g = produce(g, (d) => {
      put(d, 1, 'Glorious Anthem');
      put(d, 1, 'Plains');
    });
    const anthem = byName(g, 1, 'Glorious Anthem')!;
    const land = byName(g, 1, 'Plains')!;
    expect(canCast(g, 0, decimate)).toBe(true);
    g = cast(g, 0, 'Decimate', { targets: [card(golem), card(golem), card(anthem), card(land)] });
    expect([byName(g, 1, 'Solemn Simulacrum', 'graveyard'), byName(g, 1, 'Glorious Anthem', 'graveyard'), byName(g, 1, 'Plains', 'graveyard')].every(Boolean)).toBe(true);
  });

  it("ferocious: Crater's Claws deals X plus 2, Temur Battle Rage adds trample, Shamanic Revelation gains life", () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Mountain', 'battlefield', 6);
      put(d, 0, 'Forest', 'battlefield', 5);
      put(d, 0, 'Goblin Piker');
      put(d, 0, "Crater's Claws", 'hand');
      put(d, 0, 'Temur Battle Rage', 'hand');
      put(d, 0, 'Shamanic Revelation', 'hand');
    });
    g = cast(g, 0, "Crater's Claws", { x: 2, targets: [player(1)] });
    expect(g.players[1].life).toBe(38);
    g = cast(g, 0, 'Temur Battle Rage', { targets: [card(byName(g, 0, 'Goblin Piker')!)] });
    expect([...stats(g, byName(g, 0, 'Goblin Piker')!).keywords].sort()).toEqual(['double strike']);
    g = produce(g, (d) => void put(d, 0, 'Colossal Dreadmaw'));
    g = cast(g, 0, 'Shamanic Revelation');
    expect(g.players[0].hand).toHaveLength(2);
    expect(g.players[0].life).toBe(44);
  });

  it('Dragonmaster Outcast: a Dragon each upkeep only with six or more lands (603.4)', () => {
    const upkeep = (lands: number) => {
      let g = emptyGame((d) => {
        put(d, 0, 'Dragonmaster Outcast');
        put(d, 0, 'Mountain', 'battlefield', lands);
        d.step = 'end';
      });
      for (let i = 0; i < 40 && !(g.active === 0 && g.step === 'main1' && g.turn > 1); i++) g = run(g, pass);
      return tokens(g, 0, 'Dragon 5/5 flying').length;
    };
    expect(upkeep(5)).toBe(0);
    expect(upkeep(6)).toBe(1);
  });

  it('Verix Bladewing makes Karox only if kicked; Dragonlord\'s Servant makes Dragons cheaper', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Mountain', 'battlefield', 6);
      put(d, 0, "Dragonlord's Servant");
      put(d, 0, 'Verix Bladewing', 'hand');
    });
    expect(castCost(g, byName(g, 0, 'Verix Bladewing', 'hand')!).generic).toBe(1);
    g = cast(g, 0, 'Verix Bladewing', { kicked: 1 });
    expect(tokens(g, 0, 'Karox Bladewing')).toHaveLength(1);
    let h = emptyGame((d) => {
      put(d, 0, 'Mountain', 'battlefield', 4);
      put(d, 0, 'Verix Bladewing', 'hand');
    });
    h = cast(h, 0, 'Verix Bladewing');
    expect(tokens(h, 0, 'Karox Bladewing')).toHaveLength(0);
  });

  it('Raging Swordtooth deals 1 damage to each other creature', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Mountain', 'battlefield', 3);
      put(d, 0, 'Forest', 'battlefield', 2);
      put(d, 0, 'Raging Swordtooth', 'hand');
      put(d, 0, 'Llanowar Elves');
      put(d, 1, 'Serra Angel');
    });
    g = cast(g, 0, 'Raging Swordtooth');
    expect(byName(g, 0, 'Llanowar Elves', 'graveyard')).toBeDefined();
    expect(byName(g, 1, 'Serra Angel')!.damage).toBe(1);
    expect(byName(g, 0, 'Raging Swordtooth')!.damage).toBe(0);
  });

  it('Return of the Wildspeaker counts only non-Human creatures', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Forest', 'battlefield', 5);
      put(d, 0, 'Goblin Piker'); // a Goblin Warrior: 2/1
      put(d, 0, 'Halana and Alena, Partners'); // Humans: not counted
      put(d, 0, 'Return of the Wildspeaker', 'hand');
    });
    g = cast(g, 0, 'Return of the Wildspeaker', { modes: [0] });
    expect(g.players[0].hand).toHaveLength(2);
  });

  it("Trostani, Selesnya's Voice: life equal to toughness; populate copies the token you choose (701.36)", () => {
    let g = emptyGame((d) => {
      put(d, 0, "Trostani, Selesnya's Voice");
      put(d, 0, 'Forest', 'battlefield', 5);
      put(d, 0, 'Plains', 'battlefield', 4);
      put(d, 0, 'Call of the Conclave', 'hand');
      put(d, 0, 'Advent of the Wurm', 'hand');
    });
    const trostani = byName(g, 0, "Trostani, Selesnya's Voice")!;
    expect(canActivate(g, 0, trostani)).toBe(true); // with no token, populate does nothing (701.36b)
    g = cast(g, 0, 'Call of the Conclave');
    expect(g.players[0].life).toBe(43);
    g = cast(g, 0, 'Advent of the Wurm');
    expect(g.players[0].life).toBe(48);
    g = run(g, { type: 'activate', card: trostani.id });
    expect(asking(g)?.kind).toBe('pick');
    g = run(g, choose(tokens(g, 0, 'Wurm 5/5 trample')[0]));
    expect(tokens(g, 0, 'Wurm 5/5 trample')).toHaveLength(2);
    expect(g.players[0].life).toBe(53);
  });

  it('populate copies a token that is itself a copy, and needs no choice when the tokens are alike', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Plains', 'battlefield', 3);
      put(d, 0, 'Rootborn Defenses', 'hand');
      createToken(d, 0, 'Soldier', 2);
    });
    g = cast(g, 0, 'Rootborn Defenses');
    expect(tokens(g, 0, 'Soldier')).toHaveLength(3);
    // Every creature, the new token too, is indestructible (populate comes first).
    expect(tokens(g, 0, 'Soldier').every((c) => stats(g, c).keywords.has('indestructible'))).toBe(true);
    // Two kinds of token: the player chooses, then the rest of the spell happens.
    let h = emptyGame((d) => {
      put(d, 0, 'Plains', 'battlefield', 3);
      put(d, 0, 'Rootborn Defenses', 'hand');
      createToken(d, 0, 'Soldier');
      createToken(d, 0, 'Centaur')[0].copy = { name: 'Serra Angel', face: 0, subtypes: [], keywords: [] };
    });
    h = cast(h, 0, 'Rootborn Defenses');
    const copy = h.players[0].battlefield.find((c) => c.copy?.name === 'Serra Angel')!;
    h = run(h, choose(copy));
    const angels = h.players[0].battlefield.filter((c) => c.copy?.name === 'Serra Angel');
    expect(angels).toHaveLength(2);
    expect(stats(h, angels[1]).keywords.has('flying')).toBe(true);
    expect(stats(h, angels[1]).keywords.has('indestructible')).toBe(true);
  });

  it('Scion of Vitu-Ghazi: a Bird and populate only when cast from the hand', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Plains', 'battlefield', 5);
      put(d, 0, 'Scion of Vitu-Ghazi', 'hand');
    });
    g = cast(g, 0, 'Scion of Vitu-Ghazi');
    expect(tokens(g, 0, 'Bird 1/1 flying')).toHaveLength(2);
    const h = produce(emptyGame(), (d) => {
      const c = put(d, 0, 'Scion of Vitu-Ghazi', 'hand');
      moveCard(d, c, 'battlefield');
    });
    expect(tokens(h, 0, 'Bird 1/1 flying')).toHaveLength(0);
  });

  it('Trostani Discordant: +1/+1 to others, two Soldiers, and creatures go home at your end step', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Forest', 'battlefield', 3);
      put(d, 0, 'Plains', 'battlefield', 2);
      put(d, 0, 'Trostani Discordant', 'hand');
      const borrowed = put(d, 1, 'Serra Angel');
      d.players[1].battlefield.pop();
      borrowed.controller = 0;
      d.players[0].battlefield.push(borrowed);
    });
    g = cast(g, 0, 'Trostani Discordant');
    const soldiers = tokens(g, 0, 'Soldier 1/1 lifelink');
    expect(soldiers.map((c) => stats(g, c).power)).toEqual([2, 2]);
    expect(stats(g, byName(g, 0, 'Trostani Discordant')!).power).toBe(1);
    for (let i = 0; i < 20 && g.step !== 'cleanup' && g.active === 0; i++) g = run(g, pass);
    expect(byName(g, 1, 'Serra Angel')).toBeDefined();
  });

  it('Selesnya Charm exiles only a creature with power 5 or greater; Unflinching Courage', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Forest', 'battlefield', 3);
      put(d, 0, 'Plains', 'battlefield', 2);
      put(d, 0, 'Selesnya Charm', 'hand');
      put(d, 0, 'Unflinching Courage', 'hand');
      put(d, 0, 'Llanowar Elves');
      put(d, 1, 'Serra Angel');
      put(d, 1, 'Colossal Dreadmaw');
    });
    const charm = byName(g, 0, 'Selesnya Charm', 'hand')!;
    expect(applyAction(g, { type: 'cast', card: charm.id, modes: [1], targets: [card(byName(g, 1, 'Serra Angel')!)] })).toBe(g);
    g = cast(g, 0, 'Selesnya Charm', { modes: [1], targets: [card(byName(g, 1, 'Colossal Dreadmaw')!)] });
    expect(byName(g, 1, 'Colossal Dreadmaw', 'exile')).toBeDefined();
    g = cast(g, 0, 'Unflinching Courage', { targets: [card(byName(g, 0, 'Llanowar Elves')!)] });
    const elves = stats(g, byName(g, 0, 'Llanowar Elves')!);
    expect([elves.power, elves.toughness, elves.keywords.has('trample'), elves.keywords.has('lifelink')]).toEqual([3, 3, true, true]);
  });

  it('Growing Ranks populates at the beginning of your upkeep', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Growing Ranks');
      createToken(d, 0, 'Centaur');
      d.step = 'end';
    });
    for (let i = 0; i < 40 && !(g.active === 0 && g.step === 'main1' && g.turn > 1); i++) g = run(g, pass);
    expect(tokens(g, 0, 'Centaur')).toHaveLength(2);
  });

  it('a bot sacrifices its least valuable creature and discards the card it wants least', () => {
    let g = emptyGame((d) => {
      put(d, 0, 'Butcher of Malakir');
      put(d, 0, 'Goblin Piker');
      put(d, 0, 'Swamp');
      put(d, 0, 'Village Rites', 'hand');
      put(d, 1, 'Serra Angel');
      put(d, 1, 'Llanowar Elves');
    });
    g = cast(g, 0, 'Village Rites', { sacrifice: [byName(g, 0, 'Goblin Piker')!.id] });
    for (let i = 0; i < 20 && asking(g)?.kind === 'pick' && g.priority === 1; i++) g = applyBotAction(g, botAction(g, 1));
    expect(byName(g, 1, 'Serra Angel')).toBeDefined();
    expect(byName(g, 1, 'Llanowar Elves', 'graveyard')).toBeDefined();
  });
});

describe('several triggered abilities for one event (603.2)', () => {
  const byHand = { autoPass: false };
  const tempest = (creature: string, setup: (d: Game) => void = () => {}) =>
    emptyGame((d) => {
      d.players[0].isBot = false;
      d.players[0].you = true;
      put(d, 0, 'Dragon Tempest');
      put(d, 0, 'Mountain', 'battlefield', 6);
      put(d, 0, creature, 'hand');
      setup(d);
    });
  const castIt = (g: Game, name: string) =>
    runWith(byHand, g, { type: 'cast', card: byName(g, 0, name, 'hand')!.id }, pass, pass, pass, pass);

  it('Dragon Tempest: a Dragon with flying triggers both abilities, each its own stack item', () => {
    let g = castIt(tempest('Shivan Dragon', (d) => void put(d, 0, 'Furnace Whelp')), 'Shivan Dragon');
    // Both triggered at once, so their controller orders them (603.3b).
    expect([g.decision?.type, g.priority]).toEqual(['orderTriggers', 0]);
    const [haste, damage] = g.triggers;
    expect([haste.trigger, damage.trigger]).toEqual([0, 1]);
    expect([triggerText(haste), triggerText(damage)]).toEqual(['A creature with flying gains haste', 'The Dragon deals damage equal to your Dragons']);
    // The damage ability goes on the stack last, so it resolves first. Only it has a target.
    g = runWith(byHand, g, { type: 'orderTriggers', order: [haste.id, damage.id] });
    expect(g.decision?.type).toBe('targets');
    g = runWith(byHand, g, { type: 'chooseTargets', targets: [{ kind: 'player', id: 1 }] });
    expect(g.stack.map((x) => x.trigger)).toEqual([0, 1]);
    expect(g.stack[0].targets).toEqual([]);
    g = runWith(byHand, g, pass, pass, pass, pass);
    // X is the number of Dragons you control: Shivan Dragon and Furnace Whelp.
    expect(g.players[1].life).toBe(38);
    expect(stats(g, byName(g, 0, 'Shivan Dragon')!).keywords.has('haste')).toBe(false);
    g = runWith(byHand, g, pass, pass, pass, pass);
    expect(g.stack).toEqual([]);
    expect(stats(g, byName(g, 0, 'Shivan Dragon')!).keywords.has('haste')).toBe(true);
  });

  it('Dragon Tempest: a flier that is not a Dragon triggers only the haste ability', () => {
    let g = castIt(tempest('Serra Angel', (d) => void put(d, 0, 'Plains', 'battlefield', 2)), 'Serra Angel');
    expect(g.decision).toBe(null);
    expect(g.stack.map((x) => [x.card.name, x.trigger])).toEqual([['Dragon Tempest', 0]]);
    g = runWith(byHand, g, pass, pass, pass, pass);
    expect(stats(g, byName(g, 0, 'Serra Angel')!).keywords.has('haste')).toBe(true);
    expect(g.players.map((p) => p.life)).toEqual([40, 40, 40, 40]);
  });

  it("Dragon Tempest ignores an opponent's Dragon, and a bot's two triggers both resolve", () => {
    let g = emptyGame((d) => {
      d.active = 1;
      d.priority = 1;
      put(d, 0, 'Dragon Tempest');
      put(d, 1, 'Dragon Tempest');
      put(d, 1, 'Mountain', 'battlefield', 6);
      put(d, 1, 'Shivan Dragon', 'hand');
    });
    g = run(g, { type: 'cast', card: byName(g, 1, 'Shivan Dragon', 'hand')!.id });
    for (let i = 0; i < 20 && (g.stack.length || g.triggers.length || g.decision); i++) g = applyBotAction(g, botAction(g, g.priority));
    // Only player 1's Tempest triggered: one Dragon, so 1 damage in all, and haste.
    const lost = g.players.reduce((n, p) => n + 40 - p.life, 0);
    expect(lost).toBe(1);
    expect(stats(g, byName(g, 1, 'Shivan Dragon')!).keywords.has('haste')).toBe(true);
  });
});

describe('several activated abilities on one card (602)', () => {
  const byHand = { autoPass: false };
  const card = (c: { id: string }) => ({ kind: 'card', id: c.id }) as const;
  const shaman = (setup: (d: Game) => void = () => {}) =>
    emptyGame((d) => {
      d.players[0].isBot = false;
      d.players[0].you = true;
      put(d, 0, 'Deathrite Shaman');
      put(d, 0, 'Swamp');
      put(d, 0, 'Forest');
      put(d, 1, 'Forest', 'graveyard');
      put(d, 1, 'Lightning Bolt', 'graveyard');
      put(d, 1, 'Llanowar Elves', 'graveyard');
      setup(d);
    });

  it('Deathrite Shaman: each ability can be activated, and each has its own targets', () => {
    const g = shaman();
    const dr = byName(g, 0, 'Deathrite Shaman')!;
    expect(activatable(g, 0, dr)).toEqual([{ activated: 0 }, { activated: 1 }, { activated: 2 }]);
    // An instant or sorcery card can't be the target of the creature-card ability.
    expect(applyAction(g, { type: 'activate', card: dr.id, activated: 2, targets: [card(byName(g, 1, 'Lightning Bolt', 'graveyard')!)] })).toBe(g);
    // "{B}, {T}: Exile target instant or sorcery card from a graveyard. Each opponent loses 2 life."
    let h = runWith(byHand, g, { type: 'activate', card: dr.id, activated: 1, targets: [card(byName(g, 1, 'Lightning Bolt', 'graveyard')!)] });
    expect(h.stack.map((x) => [x.kind, x.activated])).toEqual([['activated', 1]]);
    expect(activatable(h, 0, byName(h, 0, 'Deathrite Shaman')!)).toEqual([]); // it is tapped now
    h = runWith(byHand, h, pass, pass, pass, pass);
    expect(h.players.map((p) => p.life)).toEqual([40, 38, 38, 38]);
    expect(byName(h, 1, 'Lightning Bolt', 'exile')).toBeDefined();
    // "{G}, {T}: Exile target creature card from a graveyard. You gain 2 life."
    let k = runWith(byHand, g, { type: 'activate', card: dr.id, activated: 2, targets: [card(byName(g, 1, 'Llanowar Elves', 'graveyard')!)] }, pass, pass, pass, pass);
    expect(k.players[0].life).toBe(42);
    expect(byName(k, 1, 'Llanowar Elves', 'exile')).toBeDefined();
  });

  it('Deathrite Shaman: the mana ability with a target uses the stack and asks for a colour (605.1a)', () => {
    let g = shaman();
    const dr = byName(g, 0, 'Deathrite Shaman')!;
    g = runWith(byHand, g, { type: 'activate', card: dr.id, targets: [card(byName(g, 1, 'Forest', 'graveyard')!)] });
    expect(g.stack).toHaveLength(1); // not a mana ability: it waits on the stack
    expect(g.players[0].pool).toEqual([]);
    g = runWith(byHand, g, pass, pass, pass, pass);
    expect(g.decision?.type).toBe('name');
    expect(applyAction(g, { type: 'name', name: 'Purple' })).toBe(g);
    g = runWith(byHand, g, { type: 'name', name: 'R' });
    expect(g.players[0].pool.map((m) => m.sym)).toEqual(['R']);
    expect(byName(g, 1, 'Forest', 'exile')).toBeDefined();
  });

  it('Deathrite Shaman: with its target gone, the ability does nothing at all and adds no mana (608.2b)', () => {
    let g = shaman();
    const dr = byName(g, 0, 'Deathrite Shaman')!;
    g = runWith(byHand, g, { type: 'activate', card: dr.id, targets: [card(byName(g, 1, 'Forest', 'graveyard')!)] });
    g = produce(g, (d) => void moveCard(d, d.players[1].graveyard.find((c) => c.name === 'Forest')!, 'exile'));
    g = runWith(byHand, g, pass, pass, pass, pass);
    expect([g.decision, g.stack.length, g.players[0].pool.length]).toEqual([null, 0, 0]);
  });

  it('Cranial Plating: {B}{B} attaches it at instant speed; equip waits for a sorcery-speed moment', () => {
    let g = emptyGame((d) => {
      d.active = 1;
      d.priority = 0;
      d.players[0].isBot = false;
      d.players[0].you = true;
      put(d, 0, 'Cranial Plating');
      put(d, 0, 'Sol Ring');
      put(d, 0, 'Swamp', 'battlefield', 3);
      put(d, 0, 'Llanowar Elves');
    });
    const plating = byName(g, 0, 'Cranial Plating')!;
    const elves = byName(g, 0, 'Llanowar Elves')!;
    // On an opponent's turn only the {B}{B} ability can be activated, not equip (702.6a).
    expect(activatable(g, 0, plating)).toEqual([{ activated: 0 }]);
    expect(applyAction(g, { type: 'activate', card: plating.id, activated: 1, targets: [card(elves)] })).toBe(g);
    g = runWith(byHand, g, { type: 'activate', card: plating.id, activated: 0, targets: [card(elves)] }, pass, pass, pass, pass);
    expect(byName(g, 0, 'Cranial Plating')!.attachedTo).toBe(elves.id);
    // "+1/+0 for each artifact you control": the Plating and Sol Ring.
    expect(stats(g, byName(g, 0, 'Llanowar Elves')!).power).toBe(3);
  });

  it('a bot can use any of a card\'s activated abilities', () => {
    const g = emptyGame((d) => {
      put(d, 0, 'Deathrite Shaman');
      put(d, 0, 'Swamp');
      put(d, 1, 'Lightning Bolt', 'graveyard');
    });
    // Only the instant-or-sorcery ability has both a target and the mana: each opponent loses 2.
    expect(botAction(g, 0)).toMatchObject({ type: 'activate', activated: 1 });
  });
});

describe('X in activated and loyalty ability costs (107.3a)', () => {
  const byHand = { autoPass: false };
  const card = (c: { id: string }) => ({ kind: 'card', id: c.id }) as const;
  const rats = () =>
    emptyGame((d) => {
      d.players[0].isBot = false;
      d.players[0].you = true;
      put(d, 0, 'Crypt Rats');
      put(d, 0, 'Swamp', 'battlefield', 2);
      put(d, 0, 'Mountain');
      put(d, 1, 'Llanowar Elves');
      put(d, 1, 'Shivan Dragon');
    });

  it('Crypt Rats: X is paid with black mana only, so the Mountain can\'t pay for it', () => {
    const g = rats();
    const ratsCard = byName(g, 0, 'Crypt Rats')!;
    expect(costText(abilityCost(scriptOf('Crypt Rats').activated as ActivatedAbility, g, ratsCard, 3))).toBe('{B}{B}{B}');
    expect(maxAbilityX(g, 0, ratsCard, { activated: 0 })).toBe(2);
    expect(canActivate(g, 0, ratsCard, undefined, 0, 2)).toBe(true);
    expect(applyAction(g, { type: 'activate', card: ratsCard.id, x: 3 })).toBe(g);
    expect(applyAction(g, { type: 'activate', card: ratsCard.id, x: -1 })).toBe(g);
  });

  it('Crypt Rats: the X announced stays with the ability and deals that much to each creature and player', () => {
    let g = rats();
    g = runWith(byHand, g, { type: 'activate', card: byName(g, 0, 'Crypt Rats')!.id, x: 2 });
    expect(g.stack.map((s) => s.x)).toEqual([2]);
    expect(g.players[0].battlefield.filter((c) => c.name === 'Swamp' && c.tapped)).toHaveLength(2);
    expect(g.log.some((l) => l.text.includes('activate Crypt Rats (X = 2)'))).toBe(true);
    g = runWith(byHand, g, pass, pass, pass, pass);
    expect(g.players.map((p) => p.life)).toEqual([38, 38, 38, 38]);
    expect(byName(g, 0, 'Crypt Rats', 'graveyard')).toBeDefined();
    expect(byName(g, 1, 'Llanowar Elves', 'graveyard')).toBeDefined();
    expect(byName(g, 1, 'Shivan Dragon')!.damage).toBe(2);
  });

  it('X can be 0, and an ability without X in its cost takes no X', () => {
    let g = rats();
    g = runWith(byHand, g, { type: 'activate', card: byName(g, 0, 'Crypt Rats')!.id, x: 0 }, pass, pass, pass, pass);
    expect(g.players.map((p) => p.life)).toEqual([40, 40, 40, 40]);
    const shaman = emptyGame((d) => {
      put(d, 0, 'Deathrite Shaman');
      put(d, 0, 'Swamp');
      put(d, 1, 'Lightning Bolt', 'graveyard');
    });
    const dr = byName(shaman, 0, 'Deathrite Shaman')!;
    expect(maxAbilityX(shaman, 0, dr, { activated: 1 })).toBe(0);
    expect(applyAction(shaman, { type: 'activate', card: dr.id, activated: 1, x: 1, targets: [card(byName(shaman, 1, 'Lightning Bolt', 'graveyard')!)] })).toBe(shaman);
  });

  const chandra = (loyalty = 6, setup: (d: Game) => void = () => {}) =>
    emptyGame((d) => {
      d.players[0].isBot = false;
      d.players[0].you = true;
      put(d, 0, 'Chandra Nalaar').counters.loyalty = loyalty;
      put(d, 1, 'Shivan Dragon');
      setup(d);
    });

  it('Chandra Nalaar: −X removes X loyalty counters, and X can\'t be more than her loyalty (606.4, 606.6)', () => {
    let g = chandra();
    const c = byName(g, 0, 'Chandra Nalaar')!;
    const dragon = byName(g, 1, 'Shivan Dragon')!;
    expect(maxAbilityX(g, 0, c, { ability: 1 })).toBe(6);
    expect(canActivate(g, 0, c, 1, 0, 7)).toBe(false);
    expect(applyAction(g, { type: 'activate', card: c.id, ability: 1, x: 7, targets: [card(dragon)] })).toBe(g);
    // Her +1 and −8 have no X.
    expect(canActivate(g, 0, c, 0, 0, 1)).toBe(false);
    g = runWith(byHand, g, { type: 'activate', card: c.id, ability: 1, x: 4, targets: [card(dragon)] });
    expect(byName(g, 0, 'Chandra Nalaar')!.counters.loyalty).toBe(2);
    expect(g.log.some((l) => l.text.includes("activate Chandra Nalaar's −X (X = 4) targeting Shivan Dragon"))).toBe(true);
    g = runWith(byHand, g, pass, pass, pass, pass);
    expect(byName(g, 1, 'Shivan Dragon')!.damage).toBe(4);
  });

  it('Chandra Nalaar: with X equal to her loyalty she dies, and the ability still deals X damage (704.5i, 113.7a)', () => {
    let g = chandra(5);
    g = runWith(byHand, g, { type: 'activate', card: byName(g, 0, 'Chandra Nalaar')!.id, ability: 1, x: 5, targets: [card(byName(g, 1, 'Shivan Dragon')!)] });
    expect(byName(g, 0, 'Chandra Nalaar', 'graveyard')).toBeDefined();
    g = runWith(byHand, g, pass, pass, pass, pass);
    expect(byName(g, 1, 'Shivan Dragon', 'graveyard')).toBeDefined();
  });

  it('Chandra Nalaar: −8 deals 10 to the target player and each creature they control', () => {
    let g = chandra(8, (d) => void put(d, 0, 'Llanowar Elves'));
    g = runWith(byHand, g, { type: 'activate', card: byName(g, 0, 'Chandra Nalaar')!.id, ability: 2, targets: [{ kind: 'player', id: 1 }] }, pass, pass, pass, pass);
    expect(g.players.map((p) => p.life)).toEqual([40, 30, 40, 40]);
    expect(byName(g, 1, 'Shivan Dragon', 'graveyard')).toBeDefined();
    expect(byName(g, 0, 'Llanowar Elves')).toBeDefined(); // not that player's
  });

  it('a bot announces an X it can pay for an X ability', () => {
    const g = emptyGame((d) => {
      put(d, 0, 'Crypt Rats');
      put(d, 0, 'Swamp', 'battlefield', 3);
      for (const pid of [1, 2, 3]) put(d, pid, 'Llanowar Elves', 'battlefield', 2);
    });
    const a = botAction(g, 0);
    expect(a).toMatchObject({ type: 'activate', card: byName(g, 0, 'Crypt Rats')!.id });
    const x = (a as { x: number }).x;
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThanOrEqual(3);
    expect(applyAction(g, a)).not.toBe(g);
  });
});

describe('dividing combat damage by hand (510.1c, 702.19b)', () => {
  /** Player 0 is a human who assigns damage by hand; `setup` adds the creatures. */
  const table = (setup: (d: Game) => void, manualDamage = true) =>
    emptyGame((d) => {
      d.players[0].isBot = false;
      d.players[0].you = true;
      d.players[0].manualDamage = manualDamage;
      setup(d);
    });
  /** Attacks player 1 with `attackers`, has player 1 make `blocks` ([blocker, attacker] names), and plays on to combat damage. */
  const fight = (g: Game, attackers: string[], blocks: [string, string][]) => {
    g = run(g, pass, ...attackers.map((n) => ({ type: 'declareAttack', card: byName(g, 0, n)!.id, defender: 1 }) as const), pass);
    g = run(g, ...blocks.map(([b, a]) => ({ type: 'declareBlock', blocker: byName(g, 1, b)!.id, attacker: byName(g, 0, a)!.id }) as const));
    return toDamage(g);
  };
  /** Passes until the game asks for a damage assignment, or combat is over. */
  const toDamage = (g: Game) => {
    for (let i = 0; i < 20 && g.decision?.type !== 'assignDamage' && g.step !== 'main2'; i++) g = run(g, pass);
    return g;
  };
  const asg = (g: Game, attacker: string, blockers: [string, number][], through = 0) => ({
    attacker: byName(g, 0, attacker)!.id,
    blockers: Object.fromEntries(blockers.map(([n, x]) => [byName(g, 1, n)!.id, x])),
    through,
  });

  it('is automatic unless the setting is on: lethal to each blocker in turn, the rest past them with trample', () => {
    let g = table((d) => {
      put(d, 0, 'Colossal Dreadmaw'); // 6/6 trample
      put(d, 1, 'Walking Corpse'); // 2/2
      put(d, 1, 'Goblin Piker'); // 2/1
    }, false);
    g = fight(g, ['Colossal Dreadmaw'], [['Walking Corpse', 'Colossal Dreadmaw'], ['Goblin Piker', 'Colossal Dreadmaw']]);
    expect(g.step).toBe('main2');
    // 2 to the Corpse, 1 to the Piker, 3 tramples over.
    expect(g.players[1].life).toBe(37);
  });

  it('asks only about attackers with a choice: two or more blockers, or trample', () => {
    let g = table((d) => {
      put(d, 0, 'Kalonian Tusker'); // 3/3, blocked by two
      put(d, 0, 'Child of Night'); // 2/1, blocked by one: no choice
      put(d, 0, 'Youthful Knight'); // 2/1 first strike, unblocked
      put(d, 1, 'Walking Corpse');
      put(d, 1, 'Goblin Piker');
      put(d, 1, 'Typhoid Rats');
    });
    g = fight(g, ['Kalonian Tusker', 'Child of Night', 'Youthful Knight'], [
      ['Walking Corpse', 'Kalonian Tusker'],
      ['Goblin Piker', 'Kalonian Tusker'],
      ['Typhoid Rats', 'Child of Night'],
    ]);
    // The first-strike step had nothing to ask: only the Knight dealt damage, unblocked (510.4).
    expect(g.players[1].life).toBe(38);
    expect(g.decision).toEqual({ type: 'assignDamage', attackers: [byName(g, 0, 'Kalonian Tusker')!.id], firstStrike: false });
    // Without trample, all of it may go to one blocker: there is no damage assignment order (510.1c).
    g = run(g, { type: 'assignDamage', assignments: [asg(g, 'Kalonian Tusker', [['Goblin Piker', 3]])] });
    expect(byName(g, 1, 'Goblin Piker', 'graveyard')).toBeDefined();
    expect(byName(g, 1, 'Walking Corpse')).toBeDefined();
    expect(byName(g, 1, 'Typhoid Rats', 'graveyard')).toBeDefined(); // the Child's lone blocker: no choice, dealt automatically
    expect(g.log.some((l) => /assigns? Kalonian Tusker's damage: 3 to Goblin Piker\./.test(l.text))).toBe(true);
  });

  it('refuses an assignment that breaks the rules, and the whole of it is checked (510.1e)', () => {
    let g = table((d) => {
      put(d, 0, 'Colossal Dreadmaw'); // 6/6 trample
      put(d, 0, 'Kalonian Tusker'); // 3/3
      put(d, 1, 'Walking Corpse'); // 2/2
      put(d, 1, 'Goblin Piker'); // 2/1
      put(d, 1, 'Typhoid Rats'); // 1/1
    });
    g = fight(g, ['Colossal Dreadmaw', 'Kalonian Tusker'], [
      ['Walking Corpse', 'Colossal Dreadmaw'],
      ['Goblin Piker', 'Kalonian Tusker'],
      ['Typhoid Rats', 'Kalonian Tusker'],
    ]);
    expect(g.decision?.type).toBe('assignDamage');
    const tusker = asg(g, 'Kalonian Tusker', [['Goblin Piker', 1], ['Typhoid Rats', 2]]);
    const maw = asg(g, 'Colossal Dreadmaw', [['Walking Corpse', 6]]);
    const bad = [
      // Less than its power (510.1a).
      [asg(g, 'Colossal Dreadmaw', [['Walking Corpse', 2]], 3), tusker],
      // Past the blocker before it has lethal damage (702.19b).
      [asg(g, 'Colossal Dreadmaw', [['Walking Corpse', 1]], 5), tusker],
      // Past its blockers without trample.
      [maw, asg(g, 'Kalonian Tusker', [['Goblin Piker', 1]], 2)],
      // To a creature that isn't blocking it.
      [maw, asg(g, 'Kalonian Tusker', [['Goblin Piker', 1], ['Walking Corpse', 2]])],
      // One attacker left out.
      [maw],
      // A negative amount.
      [asg(g, 'Colossal Dreadmaw', [['Walking Corpse', 7]], -1), tusker],
    ];
    for (const assignments of bad) expect(applyAction(g, { type: 'assignDamage', assignments })).toBe(g);
    // Lethal to the Corpse, then 4 tramples over.
    g = run(g, { type: 'assignDamage', assignments: [asg(g, 'Colossal Dreadmaw', [['Walking Corpse', 2]], 4), tusker] });
    expect(g.players[1].life).toBe(36);
    expect(g.players[1].battlefield.filter((c) => isCreature(c))).toEqual([]);
  });

  it('lets a trampler put more than lethal damage on its blocker', () => {
    let g = table((d) => {
      put(d, 0, 'Colossal Dreadmaw');
      put(d, 1, 'Walking Corpse');
    });
    g = fight(g, ['Colossal Dreadmaw'], [['Walking Corpse', 'Colossal Dreadmaw']]);
    expect(damageRooms(g)).toMatchObject([{ power: 6, trample: true, canThrough: true, choice: true, blockers: [{ lethal: 2 }] }]);
    g = run(g, { type: 'assignDamage', assignments: [asg(g, 'Colossal Dreadmaw', [['Walking Corpse', 6]])] });
    expect(g.players[1].life).toBe(40);
  });

  it('counts damage already marked, and any damage from deathtouch, toward lethal (702.19b, 702.2c)', () => {
    let g = table((d) => {
      put(d, 0, 'Colossal Dreadmaw');
      put(d, 0, 'Harvester of Souls'); // 5/5 deathtouch
      put(d, 1, 'Walking Corpse').damage = 1;
      put(d, 1, 'Serra Angel');
    });
    g = produce(g, (d) => void pump(d, byName(d, 0, 'Harvester of Souls')!, 0, 0, ['trample']));
    g = fight(g, ['Colossal Dreadmaw', 'Harvester of Souls'], [['Walking Corpse', 'Colossal Dreadmaw'], ['Serra Angel', 'Harvester of Souls']]);
    expect(damageRooms(g).map((r) => r.blockers[0].lethal)).toEqual([1, 1]);
    g = run(g, {
      type: 'assignDamage',
      assignments: [asg(g, 'Colossal Dreadmaw', [['Walking Corpse', 1]], 5), asg(g, 'Harvester of Souls', [['Serra Angel', 1]], 4)],
    });
    expect(g.players[1].life).toBe(31);
    expect(byName(g, 1, 'Serra Angel', 'graveyard')).toBeDefined();
  });

  it('asks in each of the two damage steps first strike makes (510.4)', () => {
    let g = table((d) => {
      put(d, 0, 'Fencing Ace'); // 1/1 double strike, pumped to 3/1
      put(d, 1, 'Serra Angel'); // 4/4
      put(d, 1, 'Walking Corpse'); // 2/2
    });
    g = produce(g, (d) => void pump(d, byName(d, 0, 'Fencing Ace')!, 2, 0));
    g = fight(g, ['Fencing Ace'], [['Serra Angel', 'Fencing Ace'], ['Walking Corpse', 'Fencing Ace']]);
    expect(g.decision).toMatchObject({ type: 'assignDamage', firstStrike: true });
    g = run(g, { type: 'assignDamage', assignments: [asg(g, 'Fencing Ace', [['Serra Angel', 3]])] });
    // Both blockers live through the first step, so the regular one asks again.
    g = toDamage(g);
    expect(g.decision).toMatchObject({ type: 'assignDamage', firstStrike: false });
    g = run(g, { type: 'assignDamage', assignments: [asg(g, 'Fencing Ace', [['Serra Angel', 1], ['Walking Corpse', 2]])] });
    expect(byName(g, 1, 'Serra Angel', 'graveyard')).toBeDefined();
    expect(byName(g, 1, 'Walking Corpse', 'graveyard')).toBeDefined();
  });

  it("doesn't wait on a bot, even one with the setting", () => {
    let g = emptyGame((d) => {
      d.players[0].manualDamage = true;
      put(d, 0, 'Kalonian Tusker');
      put(d, 1, 'Walking Corpse');
      put(d, 1, 'Goblin Piker');
    });
    g = run(g, pass, { type: 'declareAttack', card: byName(g, 0, 'Kalonian Tusker')!.id, defender: 1 }, pass);
    g = run(
      g,
      { type: 'declareBlock', blocker: byName(g, 1, 'Walking Corpse')!.id, attacker: byName(g, 0, 'Kalonian Tusker')!.id },
      { type: 'declareBlock', blocker: byName(g, 1, 'Goblin Piker')!.id, attacker: byName(g, 0, 'Kalonian Tusker')!.id },
      pass,
    );
    // Dealt automatically: 2 to the Corpse, 1 to the Piker.
    expect(byName(g, 1, 'Walking Corpse', 'graveyard')).toBeDefined();
    expect(byName(g, 1, 'Goblin Piker', 'graveyard')).toBeDefined();
  });

  it('a bot answering for a human splits the damage automatically', () => {
    let g = table((d) => {
      put(d, 0, 'Kalonian Tusker');
      put(d, 1, 'Walking Corpse');
      put(d, 1, 'Goblin Piker');
    });
    g = fight(g, ['Kalonian Tusker'], [['Walking Corpse', 'Kalonian Tusker'], ['Goblin Piker', 'Kalonian Tusker']]);
    expect(botAction(g, 0)).toEqual({ type: 'assignDamage', assignments: [asg(g, 'Kalonian Tusker', [['Walking Corpse', 2], ['Goblin Piker', 1]])] });
  });
});
