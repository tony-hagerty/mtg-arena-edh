// The human's casting flow in the UI: announce X/kicker/cost, choose targets, choose a
// sacrifice, pay. Drives the real store and view code without rendering anything.
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import './fixtures';
import { useStore } from '../src/ui/store';
import { buildView, clickPermanent, clickPlayer, clickStackItem, pickAbility, pickFace, pickMode, playHandCard, setChoices } from '../src/ui/view';
import type { Game } from '../src/engine';
import { byName, emptyGame, put } from './helpers';

/** Starts the store on a game where player 0 is the human. */
function play(setup: (g: Game) => void) {
  const g = produce(emptyGame(setup), (d) => {
    d.players[0].isBot = false;
  });
  useStore.setState({ game: g, human: 0, targeting: null, pickedBlockers: [] });
}
const game = () => useStore.getState().game!;
const press = () => buildView().primary!.onClick();

describe('casting with choices in the UI (601.2b)', () => {
  it('announces X, then targets, then pays', () => {
    play((d) => {
      put(d, 0, 'Mountain', 'battlefield', 4);
      put(d, 0, 'Blaze', 'hand');
    });
    playHandCard(byName(game(), 0, 'Blaze', 'hand')!);
    let v = buildView();
    expect(v.announce?.maxX).toBe(3);
    expect(v.announce?.choices.x).toBe(3); // starts at the most it can pay
    setChoices({ x: 9 });
    expect(buildView().announce?.choices.x).toBe(3); // kept within what can be paid
    setChoices({ x: 2 });
    press(); // Continue
    v = buildView();
    expect(v.announce).toBe(null);
    expect(v.targetPlayers.has(1)).toBe(true);
    clickPlayer(1);
    expect(buildView().prompt).toContain('Pay {2}{R}');
    press(); // Pay. Everyone else passes, so it resolves.
    expect(game().log.some((l) => l.text.endsWith('cast Blaze (X = 2) targeting Mortis.'))).toBe(true);
    expect(game().players[1].life).toBe(38);
  });

  it('offers kicker only when it can be paid', () => {
    play((d) => {
      put(d, 0, 'Mountain', 'battlefield', 4);
      put(d, 0, 'Burst Lightning', 'hand');
    });
    playHandCard(byName(game(), 0, 'Burst Lightning', 'hand')!);
    expect(buildView().announce?.kicker).toEqual({ text: '{4}', most: 0 });
  });

  it('starts on an alternative cost when the mana cost can\'t be paid (118.9)', () => {
    play((d) => {
      put(d, 0, 'Lyra Dawnbringer').isCommander = true;
      put(d, 0, 'Flawless Maneuver', 'hand');
    });
    playHandCard(byName(game(), 0, 'Flawless Maneuver', 'hand')!);
    const a = buildView().announce!;
    expect(a.choices.alt).toBe(0);
    expect(a.costs.map((c) => c.payable)).toEqual([false, true]);
    press(); // Continue: no targets, so on to paying {0}
    press(); // Pay
    expect(game().log.some((l) => l.text.includes('cast Flawless Maneuver (free'))).toBe(true);
  });

  it('asks for the sacrifice after the targets (118.8)', () => {
    play((d) => {
      put(d, 0, 'Swamp');
      put(d, 0, 'Elite Vanguard');
      put(d, 1, 'Serra Angel');
      put(d, 0, 'Bone Splinters', 'hand');
    });
    playHandCard(byName(game(), 0, 'Bone Splinters', 'hand')!);
    const angel = byName(game(), 1, 'Serra Angel')!;
    clickPermanent(angel); // target
    let v = buildView();
    expect(v.prompt).toContain('a creature to sacrifice');
    const vanguard = byName(game(), 0, 'Elite Vanguard')!;
    expect(v.glow.get(vanguard.id)).toBe('target');
    clickPermanent(angel); // not one of yours: ignored
    expect(buildView().prompt).toContain('a creature to sacrifice');
    clickPermanent(vanguard);
    v = buildView();
    expect(v.prompt).toContain('Pay {B}');
    press();
    expect(byName(game(), 0, 'Elite Vanguard', 'graveyard')).toBeDefined();
    expect(byName(game(), 1, 'Serra Angel', 'graveyard')).toBeDefined();
  });
});

describe('modes, stack targets and holding priority in the UI', () => {
  it('picks a mode, then its targets (700.2)', () => {
    play((d) => {
      put(d, 0, 'Mountain');
      put(d, 0, 'Plains');
      put(d, 0, 'Boros Charm', 'hand');
    });
    playHandCard(byName(game(), 0, 'Boros Charm', 'hand')!);
    let v = buildView();
    expect(v.announce?.modal?.modes.map((m) => m.ok)).toEqual([true, true, false]); // no creature for double strike
    expect(v.primary?.disabled).toBe(true); // no mode yet
    pickMode(1);
    pickMode(0); // choose one: replaces the first pick
    v = buildView();
    expect(v.announce?.choices.modes).toEqual([0]);
    press(); // Continue
    clickPlayer(1);
    press(); // Pay
    expect(game().players[1].life).toBe(36);
  });

  it('holds priority, then targets its own spell on the stack', () => {
    play((d) => {
      put(d, 0, 'Mountain');
      put(d, 0, 'Island', 'battlefield', 2);
      put(d, 0, 'Lightning Bolt', 'hand');
      put(d, 0, 'Counterspell', 'hand');
    });
    playHandCard(byName(game(), 0, 'Lightning Bolt', 'hand')!);
    clickPlayer(1);
    useStore.setState({ hold: true });
    press(); // Pay, and keep priority
    expect(game().stack).toHaveLength(1);
    expect(game().priority).toBe(0);
    expect(useStore.getState().hold).toBe(false); // one use only
    playHandCard(byName(game(), 0, 'Counterspell', 'hand')!);
    const bolt = game().stack[0].id;
    expect(buildView().targetStack.has(bolt)).toBe(true);
    clickStackItem(bolt);
    press(); // Pay
    expect(game().stack).toHaveLength(0);
    expect(game().players[1].life).toBe(40);
    expect(game().log.some((l) => l.text === 'Lightning Bolt is countered.')).toBe(true);
  });
});

describe('Auras, Equipment and crew in the UI', () => {
  it('picks the crew, then the Vehicle becomes a creature (702.122)', () => {
    play((d) => {
      put(d, 0, 'Untethered Express');
      put(d, 0, 'Raging Goblin');
      put(d, 0, 'Angelic Wall'); // 0 power
    });
    clickPermanent(byName(game(), 0, 'Untethered Express')!);
    let v = buildView();
    expect(v.prompt).toContain('Crew 1');
    expect(v.primary?.disabled).toBe(true);
    clickPermanent(byName(game(), 0, 'Angelic Wall')!);
    expect(buildView().primary?.disabled).toBe(true); // 0 power isn't enough
    clickPermanent(byName(game(), 0, 'Angelic Wall')!); // a second click takes it back out
    clickPermanent(byName(game(), 0, 'Raging Goblin')!);
    v = buildView();
    expect(v.prompt).toContain('(1 so far)');
    press(); // Crew: costs no mana, so it goes straight on the stack and resolves
    expect(byName(game(), 0, 'Raging Goblin')!.tapped).toBe(true);
    expect(byName(game(), 0, 'Angelic Wall')!.tapped).toBe(false);
    expect(byName(game(), 0, 'Untethered Express')!.mods.some((m) => m.creature)).toBe(true);
  });

  it('casts an Aura on a target, and equips from the attached Equipment', () => {
    play((d) => {
      put(d, 0, 'Plains', 'battlefield', 3);
      put(d, 0, 'Elite Vanguard');
      put(d, 0, 'Raging Goblin');
      put(d, 0, 'Bonesplitter').attachedTo = d.players[0].battlefield[1].id;
      put(d, 0, 'Holy Strength', 'hand');
    });
    playHandCard(byName(game(), 0, 'Holy Strength', 'hand')!);
    const goblin = byName(game(), 0, 'Raging Goblin')!;
    expect(buildView().glow.get(goblin.id)).toBe('target');
    clickPermanent(goblin);
    press(); // Pay
    expect(byName(game(), 0, 'Holy Strength')!.attachedTo).toBe(goblin.id);
    // Move the Bonesplitter from the Vanguard to the Goblin.
    clickPermanent(byName(game(), 0, 'Bonesplitter')!);
    clickPermanent(byName(game(), 0, 'Raging Goblin')!);
    press(); // Pay {1}
    expect(byName(game(), 0, 'Bonesplitter')!.attachedTo).toBe(goblin.id);
  });
});

describe('planeswalkers and battles in the UI (306, 310, 606)', () => {
  it('picks a loyalty ability, then its target, and activates it without paying mana', () => {
    play((d) => {
      put(d, 0, 'Jace Beleren').counters.loyalty = 3;
    });
    const jace = byName(game(), 0, 'Jace Beleren')!;
    expect(buildView().glow.get(jace.id)).toBe('play');
    clickPermanent(jace);
    const v = buildView();
    expect(v.loyalty?.options.map((o) => [o.cost, o.ok])).toEqual([
      ['+2', true],
      ['−1', true],
      ['−10', false],
    ]);
    pickAbility(1);
    expect(buildView().targetPlayers.has(0)).toBe(true);
    clickPlayer(0);
    expect(useStore.getState().targeting).toBe(null);
    expect(byName(game(), 0, 'Jace Beleren')!.counters.loyalty).toBe(2);
    expect(game().players[0].hand).toHaveLength(1);
  });

  it('sends attackers at a planeswalker picked by clicking it (508.1b)', () => {
    play((d) => {
      put(d, 0, 'Kalonian Tusker');
      put(d, 1, 'Jace Beleren').counters.loyalty = 3;
    });
    press(); // to combat
    expect(game().decision?.type).toBe('attackers');
    const jace = byName(game(), 1, 'Jace Beleren')!;
    expect(buildView().glow.get(jace.id)).toBe('target');
    clickPermanent(jace);
    expect(buildView().attackTarget).toEqual({ defender: 1, target: jace.id });
    clickPermanent(byName(game(), 0, 'Kalonian Tusker')!);
    expect(game().combat!.attacks).toMatchObject([{ defender: 1, target: jace.id }]);
    press(); // attack
    expect(byName(game(), 1, 'Jace Beleren', 'graveyard')).toBeDefined();
  });

  it("chooses a Siege's protector while announcing it (310.12a)", () => {
    play((d) => {
      put(d, 0, 'Plains', 'battlefield', 3);
      put(d, 0, 'Invasion of Dominaria', 'hand');
    });
    playHandCard(byName(game(), 0, 'Invasion of Dominaria', 'hand')!);
    expect(buildView().announce?.protectors?.map((o) => o.id)).toEqual([1, 2, 3]);
    setChoices({ protector: 3 });
    press(); // Continue
    press(); // Pay
    expect(byName(game(), 0, 'Invasion of Dominaria')!.protector).toBe(3);
  });
});

describe('card faces, Classes and graveyard casting in the UI (709, 712, 715, 716, 702.34)', () => {
  it('chooses which half of a split card to cast (709.3)', () => {
    play((d) => {
      put(d, 0, 'Mountain', 'battlefield', 3);
      put(d, 0, 'Dead', 'hand');
      put(d, 1, 'Walking Corpse');
    });
    playHandCard(byName(game(), 0, 'Dead', 'hand')!);
    expect(buildView().announce?.faces?.map((f) => f.name)).toEqual(['Dead', 'Gone']);
    pickFace(1);
    expect(buildView().prompt).toBe('Choose how to cast Gone: {2}{R}.');
    press(); // Continue
    clickPermanent(byName(game(), 1, 'Walking Corpse')!);
    press(); // Pay
    expect(byName(game(), 1, 'Walking Corpse', 'hand')).toBeDefined();
  });

  it("plays a modal double-faced card's land face from the cast panel (712.12)", () => {
    play((d) => {
      put(d, 0, 'Forest', 'battlefield', 3);
      put(d, 0, 'Kazandu Mammoth', 'hand');
    });
    playHandCard(byName(game(), 0, 'Kazandu Mammoth', 'hand')!);
    expect(buildView().announce?.faces).toEqual([
      { face: 0, name: 'Kazandu Mammoth', land: false, ok: true },
      { face: 1, name: 'Kazandu Valley', land: true, ok: true },
    ]);
    pickFace(1);
    press(); // Continue: plays it
    expect(useStore.getState().targeting).toBe(null);
    expect(game().players[0].landsPlayed).toBe(1);
  });

  it('casts a flashback card from the graveyard (702.34a)', () => {
    play((d) => {
      put(d, 0, 'Island', 'battlefield', 3);
      put(d, 0, 'Think Twice', 'graveyard');
    });
    const card = byName(game(), 0, 'Think Twice', 'graveyard')!;
    expect(buildView().glow.get(card.id)).toBe('play');
    playHandCard(card);
    expect(buildView().prompt).toContain('Pay {2}{U}');
    press();
    expect(byName(game(), 0, 'Think Twice', 'exile')).toBeDefined();
  });

  it('gains a Class level from the ability panel, then pays for it (716.2a)', () => {
    play((d) => {
      put(d, 0, 'Island', 'battlefield', 3);
      put(d, 0, 'Wizard Class');
    });
    clickPermanent(byName(game(), 0, 'Wizard Class')!);
    expect(buildView().loyalty?.options.map((o) => [o.cost, o.ok])).toEqual([
      ['{2}{U}', true],
      ['{4}{U}', false],
    ]);
    pickAbility(0);
    expect(buildView().prompt).toContain('Pay the cost');
    press();
    expect(byName(game(), 0, 'Wizard Class')!.level).toBe(2);
  });
});
