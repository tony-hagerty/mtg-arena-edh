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
  choiceOptions,
  data,
  defaultStops,
  moveCard,
  newGame,
  stats,
  turnOrder,
} from '../src/engine';
import type { ApplyOptions, Game, TurnStops } from '../src/engine';
import { byName, emptyGame, onBattlefield, put, run, runWith } from './helpers';

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
    expect(g.players[0].commanderCasts).toBe(2);
  });

  // Player 0 is made human in these, since bots always send their commander home.
  it('asks a human whether their dead commander goes to the command zone (903.9a)', () => {
    let g = emptyGame((d) => {
      d.players[0].isBot = false;
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
      d.players[0].commanderCasts = 1;
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
      d.players[1].commanderDamage[0] = 10;
    });
    const ghalta = byName(g, 0, 'Ghalta, Primal Hunger')!;
    g = run(g, pass, { type: 'declareAttack', card: ghalta.id, defender: 1 }, pass);
    expect(g.players[1].life).toBe(28);
    expect(g.players[1].lost).toBe(true);
    expect(g.winner).toBe(null);
  });

  it('reduces Ghalta by the power you control', () => {
    // Seat 3 plays the green deck. {10}{G}{G} minus 10 power = {G}{G}.
    const setup = (withDino: boolean) =>
      emptyGame((d) => {
        d.active = 3;
        d.priority = 3;
        put(d, 3, 'Forest', 'battlefield', 2);
        if (withDino) put(d, 3, 'Gigantosaurus');
      });
    const ghalta = (g: ReturnType<typeof setup>) => g.players[3].command[0];
    expect(ghalta(setup(true)).name).toBe('Ghalta, Primal Hunger');
    expect(canCast(setup(false), 3, ghalta(setup(false)))).toBe(false);
    expect(canCast(setup(true), 3, ghalta(setup(true)))).toBe(true);
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
    // Nothing is left for player 0 to do, so the turn runs out and player 1's begins.
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
    // To combat, declare no attackers: the turn ends and player 1 draws in their draw step.
    g = run(g, pass, pass);
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
    g = run(g, pass);
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
    g = run(g, { type: 'cast', card: byName(g, 0, 'Shock', 'hand')!.id, targets: [{ kind: 'player', id: 1 }] }, pass);
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
    g = runWith(stopsFor1({ beginCombat: 'ifAble' }), g, pass);
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

  it('matches the defaults when no stops are given', () => {
    expect(defaultStops(0)[0]).toEqual({ main1: 'always', main2: 'ifAble', blockers: 'ifAble' });
    expect(defaultStops(0)[1]).toEqual({ attackers: 'ifAble', blockers: 'ifAble', end: 'ifAble' });
  });
});

describe('searching a library (701.23)', () => {
  /** Player 0 is the human, with a search spell to cast and a small library to search. */
  const searchGame = (spell: string) =>
    emptyGame((d) => {
      d.players[0].isBot = false;
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
    expect(g.players[first].library.length).toBe(52);
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
