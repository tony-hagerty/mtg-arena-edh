import { describe, expect, it } from 'vitest';
import { applyAction, availableMana, canCast, stats } from '../src/engine';
import { byName, emptyGame, onBattlefield, put, run } from './helpers';

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
    expect(g.step).toBe('main2');
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
    // To combat, declare no attackers, end turn: player 1 then draws for their turn.
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
