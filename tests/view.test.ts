// The human's casting flow in the UI: announce X/kicker/cost, choose targets, choose a
// sacrifice, pay. Drives the real store and view code without rendering anything.
import { produce } from 'immer';
import type { MouseEvent } from 'react';
import { describe, expect, it } from 'vitest';
import './fixtures';
import { useStore } from '../src/ui/store';
import { hoverProps } from '../src/ui/util';
import { activateFromHand, buildView, clickGroup, chooseEscape, chooseGraveyardTarget, clickPermanent, clickPlayer, clickStackItem, exileForMana, manaOptions, pickAbility, pickMana, pickManaSacrifice, pickFace, pickMode, playHandCard, setAbilityX, setChoices } from '../src/ui/view';
import { applyAction, canCast, data, isCreature } from '../src/engine';
import type { Game } from '../src/engine';
import { byName, emptyGame, put } from './helpers';

/** Starts the store on a game where player 0 is the human. */
function play(setup: (g: Game) => void) {
  const g = produce(emptyGame(setup), (d) => {
    d.players[0].isBot = false;
    d.players[0].you = true;
  });
  useStore.setState({ game: g, human: 0, humans: [0], handoff: null, targeting: null, pickedBlockers: [] });
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

  it('asks for the card to discard as an additional cost, then pays (118.8)', () => {
    play((d) => {
      put(d, 0, 'Mountain', 'battlefield', 2);
      put(d, 0, 'Grab the Prize', 'hand');
      put(d, 0, 'Lightning Bolt', 'hand');
    });
    const grab = byName(game(), 0, 'Grab the Prize', 'hand')!;
    playHandCard(grab);
    let v = buildView();
    expect(v.prompt).toContain('choose a card in your hand to discard');
    expect(v.glow.get(byName(game(), 0, 'Lightning Bolt', 'hand')!.id)).toBe('target');
    expect(v.glow.get(grab.id)).toBe('picked');
    playHandCard(byName(game(), 0, 'Lightning Bolt', 'hand')!);
    v = buildView();
    expect(v.prompt).toContain('Pay {1}{R}');
    press();
    expect(byName(game(), 0, 'Lightning Bolt', 'graveyard')).toBeDefined();
    expect(game().players[1].life).toBe(38);
  });

  it('announces X for "pay X life" starting at 0, up to the life total (119.4)', () => {
    play((d) => {
      put(d, 0, 'Swamp', 'battlefield', 3);
      put(d, 0, 'Toxic Deluge', 'hand');
      d.players[0].life = 7;
    });
    playHandCard(byName(game(), 0, 'Toxic Deluge', 'hand')!);
    let v = buildView();
    expect(v.announce?.maxX).toBe(7);
    expect(v.announce?.choices.x).toBe(0);
    expect(v.announce?.xLife).toBe(true);
    setChoices({ x: 3 });
    press(); // Continue
    v = buildView();
    expect(v.prompt).toContain('3 life');
    press(); // Pay
    expect(game().players[0].life).toBe(4);
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
    expect(isCreature(game(), byName(game(), 0, 'Untethered Express')!)).toBe(true);
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

describe('several activated abilities in the UI (602)', () => {
  it('opens a menu of the abilities, then targets the chosen one', () => {
    play((d) => {
      put(d, 0, 'Deathrite Shaman');
      put(d, 0, 'Swamp');
      put(d, 1, 'Forest', 'graveyard');
      put(d, 1, 'Lightning Bolt', 'graveyard');
    });
    clickPermanent(byName(game(), 0, 'Deathrite Shaman')!);
    const v = buildView();
    expect(v.prompt).toContain('choose an ability');
    // No creature card in any graveyard, and no {G}: the third ability can't be used.
    expect(v.loyalty?.options.map((o) => [o.text.slice(0, 7), o.ok])).toEqual([
      ['{T}: Ex', true],
      ['{B}, {T', true],
      ['{G}, {T', false],
    ]);
    pickAbility({ activated: 2 }); // not usable: nothing happens
    expect(useStore.getState().targeting?.pickingAbility).toBe(true);
    pickAbility({ activated: 1 });
    const w = buildView();
    expect(w.graveTargets?.options.map((c) => c.name)).toEqual(['Lightning Bolt']);
    chooseGraveyardTarget(w.graveTargets!.options[0].id);
    press(); // Pay {B}; the bots pass and it resolves
    expect(game().players.map((p) => p.life)).toEqual([40, 38, 38, 38]);
  });

  it('goes straight to the targets when only one of the abilities can be used now', () => {
    play((d) => {
      d.active = 1;
      d.priority = 0;
      put(d, 0, 'Cranial Plating');
      put(d, 0, 'Swamp', 'battlefield', 2);
      put(d, 0, 'Llanowar Elves');
    });
    clickPermanent(byName(game(), 0, 'Cranial Plating')!);
    expect(buildView().loyalty).toBe(null);
    expect(useStore.getState().targeting?.activated ?? 0).toBe(0);
    clickPermanent(byName(game(), 0, 'Llanowar Elves')!);
    press(); // Pay {B}{B}
    expect(byName(game(), 0, 'Cranial Plating')!.attachedTo).toBe(byName(game(), 0, 'Llanowar Elves')!.id);
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
    pickAbility({ ability: 1 });
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
    pickAbility({ ability: 0 });
    expect(buildView().prompt).toContain('Pay the cost');
    press();
    expect(byName(game(), 0, 'Wizard Class')!.level).toBe(2);
  });
});

describe('session 7a in the UI: pitch costs, mana from the hand, questions', () => {
  /** Player 1 has cast Lightning Bolt at the human, who now has priority. */
  const boltAtMe = (setup: (g: Game) => void) =>
    play((d) => {
      put(d, 1, 'Mountain');
      put(d, 1, 'Lightning Bolt', 'hand');
      setup(d);
      d.active = 1;
      d.priority = 1;
      const bolt = byName(d, 1, 'Lightning Bolt', 'hand')!;
      Object.assign(d, applyAction(d, { type: 'cast', card: bolt.id, targets: [{ kind: 'player', id: 0 }] }));
    });

  it('Force of Will: choose the free cost, the target, then the blue card to exile (118.9)', () => {
    boltAtMe((d) => {
      put(d, 0, 'Force of Will', 'hand');
      put(d, 0, 'Snapback', 'hand');
    });
    expect([game().priority, game().stack.length]).toEqual([0, 1]);
    playHandCard(byName(game(), 0, 'Force of Will', 'hand')!);
    expect(buildView().announce?.choices.alt).toBe(0); // the mana cost can't be paid
    press(); // Continue
    clickStackItem(game().stack[0].id);
    const snapback = byName(game(), 0, 'Snapback', 'hand')!;
    let v = buildView();
    expect(v.prompt).toContain('a blue card');
    expect(v.glow.get(snapback.id)).toBe('target');
    playHandCard(snapback); // nothing left to pay: it is cast
    v = buildView();
    expect(byName(game(), 0, 'Snapback', 'exile')).toBeDefined();
    expect(game().players[0].life).toBe(39);
    expect(byName(game(), 1, 'Lightning Bolt', 'graveyard')).toBeDefined();
  });

  it('exiles Simian Spirit Guide from the hand for {R}', () => {
    play((d) => {
      put(d, 0, 'Simian Spirit Guide', 'hand');
      put(d, 0, 'Lightning Bolt', 'hand');
    });
    const ssg = byName(game(), 0, 'Simian Spirit Guide', 'hand')!;
    expect(buildView().glow.get(ssg.id)).toBe('play');
    playHandCard(ssg); // it can't be cast, so it makes mana
    expect(game().players[0].pool.map((m) => m.sym)).toEqual(['R']);
    expect(canCast(game(), 0, byName(game(), 0, 'Lightning Bolt', 'hand')!)).toBe(true);
  });

  it('offers "exile it for mana" beside casting it when both are possible', () => {
    play((d) => {
      put(d, 0, 'Mountain', 'battlefield', 3);
      put(d, 0, 'Simian Spirit Guide', 'hand');
    });
    playHandCard(byName(game(), 0, 'Simian Spirit Guide', 'hand')!);
    expect(buildView().announce?.handMana).toBe(true);
    exileForMana();
    expect(game().players[0].pool).toHaveLength(1);
    expect(useStore.getState().targeting).toBeNull();
  });

  it('asks the human a yes/no question and waits for the answer', () => {
    play((d) => {
      put(d, 1, 'Rhystic Study');
      put(d, 0, 'Mountain', 'battlefield', 2);
      put(d, 0, 'Lightning Bolt', 'hand');
    });
    playHandCard(byName(game(), 0, 'Lightning Bolt', 'hand')!);
    clickPlayer(2);
    press(); // Pay
    expect(game().decision?.type).toBe('ask');
    expect(buildView().mine).toBe(true);
    useStore.getState().act({ type: 'answer', yes: true });
    // The human's seat keeps the bot's name in tests; "pay" is the human's form of the verb.
    expect(game().log.some((l) => l.text.endsWith(' pay {1} for Rhystic Study.'))).toBe(true);
  });
});

describe('the Kraum and Tymna deck in the UI (session 7b)', () => {
  it('escapes a card with Underworld Breach: pick the cost, then the three cards to exile (702.138a)', () => {
    play((d) => {
      put(d, 0, 'Underworld Breach');
      put(d, 0, 'Mountain');
      for (const n of ['Lightning Bolt', 'Plains', 'Island', 'Swamp']) put(d, 0, n, 'graveyard');
    });
    const bolt = byName(game(), 0, 'Lightning Bolt', 'graveyard')!;
    expect(buildView().glow.get(bolt.id)).toBe('play');
    playHandCard(bolt);
    clickPlayer(1);
    const v = buildView();
    expect(v.escape?.options.map((c) => c.name).sort()).toEqual(['Island', 'Plains', 'Swamp']);
    chooseEscape(v.escape!.options.map((c) => c.id));
    expect(buildView().prompt).toContain('Pay {R}');
    press(); // Pay
    expect(game().players[1].life).toBe(37);
    expect(game().players[0].exile).toHaveLength(3);
  });

  it('keeps or changes the targets of a spell for Deflecting Swat (115.7d)', () => {
    play((d) => {
      d.players[0].command[0].zone = 'battlefield';
      d.players[0].battlefield.push(d.players[0].command.pop()!);
      put(d, 0, 'Mountain');
      put(d, 0, 'Lightning Bolt', 'hand');
      put(d, 0, 'Deflecting Swat', 'hand');
    });
    useStore.setState({ hold: true });
    playHandCard(byName(game(), 0, 'Lightning Bolt', 'hand')!);
    clickPlayer(2);
    press(); // Pay, holding priority
    const bolt = game().stack[0].id;
    playHandCard(byName(game(), 0, 'Deflecting Swat', 'hand')!);
    setChoices({ alt: 0 });
    press(); // Continue
    clickStackItem(bolt);
    press(); // Pay: it's free
    expect(game().decision?.type).toBe('retarget');
    expect(buildView().primary?.label).toBe('Keep Target');
    clickPlayer(3);
    expect(game().players[3].life).toBe(37);
  });

  it("asks for the colour before Lion's Eye Diamond is used", () => {
    play((d) => {
      put(d, 0, "Lion's Eye Diamond");
    });
    clickPermanent(byName(game(), 0, "Lion's Eye Diamond")!);
    expect(useStore.getState().manaPick?.options[0].mana).toHaveLength(5);
    pickMana(0, ['U', 'U', 'U']);
    expect(game().players[0].pool.map((m) => m.sym)).toEqual(['U', 'U', 'U']);
  });

  it('offers channel beside playing Otawara as a land', () => {
    play((d) => {
      put(d, 0, 'Island', 'battlefield', 4);
      put(d, 0, 'Otawara, Soaring City', 'hand');
      put(d, 1, 'Sol Ring');
    });
    playHandCard(byName(game(), 0, 'Otawara, Soaring City', 'hand')!);
    expect(buildView().announce?.handAbility).toContain('Channel');
    activateFromHand();
    clickPermanent(byName(game(), 1, 'Sol Ring')!);
    press(); // Pay
    expect(byName(game(), 1, 'Sol Ring', 'hand')).toBeDefined();
    expect(byName(game(), 0, 'Otawara, Soaring City', 'graveyard')).toBeDefined();
  });

  it("targets a card in a graveyard from a window (Sevinne's Reclamation)", () => {
    play((d) => {
      put(d, 0, 'Plains', 'battlefield', 3);
      put(d, 0, "Sevinne's Reclamation", 'hand');
      put(d, 0, 'Sol Ring', 'graveyard');
    });
    playHandCard(byName(game(), 0, "Sevinne's Reclamation", 'hand')!);
    const v = buildView();
    expect(v.graveTargets?.options.map((c) => c.name)).toEqual(['Sol Ring']);
    chooseGraveyardTarget(v.graveTargets!.options[0].id);
    press(); // Pay
    expect(byName(game(), 0, 'Sol Ring')).toBeDefined();
  });

  it('casts the card Beseech the Mirror found, without paying for it (608.2g)', () => {
    play((d) => {
      put(d, 0, 'Swamp', 'battlefield', 4);
      put(d, 0, 'Beseech the Mirror', 'hand');
      put(d, 0, 'Sol Ring');
      d.players[0].library = [];
      put(d, 0, 'Chrome Mox', 'library');
    });
    playHandCard(byName(game(), 0, 'Beseech the Mirror', 'hand')!);
    // Bargain: sacrifice Sol Ring.
    clickPermanent(byName(game(), 0, 'Sol Ring')!);
    press(); // Pay
    useStore.getState().act({ type: 'chooseCards', cards: [byName(game(), 0, 'Chrome Mox', 'library')!.id] });
    expect(game().decision?.type).toBe('cast');
    playHandCard(byName(game(), 0, 'Chrome Mox', 'exile')!);
    press(); // Pay: nothing to pay
    expect(game().stack.length + game().players[0].battlefield.filter((c) => c.name === 'Chrome Mox').length).toBeGreaterThan(0);
  });
});

describe('the two-colour decks in the UI (session 8a)', () => {
  it('Goblin Bombardment: choose the target, then the creature to sacrifice', () => {
    play((d) => {
      put(d, 0, 'Goblin Bombardment');
      put(d, 0, 'Goblin Piker');
    });
    clickPermanent(byName(game(), 0, 'Goblin Bombardment')!);
    clickPlayer(1);
    const piker = byName(game(), 0, 'Goblin Piker')!;
    expect(buildView().glow.get(piker.id)).toBe('target');
    clickPermanent(piker);
    expect(game().players[1].life).toBe(39);
  });

  it('asks whether to pay 2 life for a shock land', () => {
    play((d) => {
      put(d, 0, 'Blood Crypt', 'hand');
    });
    playHandCard(byName(game(), 0, 'Blood Crypt', 'hand')!);
    expect(game().decision?.type).toBe('ask');
    useStore.getState().act({ type: 'answer', yes: false });
    expect(byName(game(), 0, 'Blood Crypt')!.tapped).toBe(true);
  });
});

describe('X in ability costs in the UI (107.3a)', () => {
  it('announces X before paying for an ability with {X}', () => {
    play((d) => {
      put(d, 0, 'Crypt Rats');
      put(d, 0, 'Swamp', 'battlefield', 3);
      put(d, 0, 'Mountain');
    });
    clickPermanent(byName(game(), 0, 'Crypt Rats')!);
    let v = buildView();
    expect(v.abilityX).toMatchObject({ x: 3, max: 3 }); // starts at the most it can pay; the Mountain can't help
    setAbilityX(9);
    expect(buildView().abilityX?.x).toBe(3);
    setAbilityX(1);
    v = buildView();
    expect(v.prompt).toContain('{B}');
    press(); // Continue
    expect(buildView().prompt).toContain('Pay the cost');
    press(); // Pay {B}; the bots pass and it resolves
    expect(game().players.map((p) => p.life)).toEqual([39, 39, 39, 39]);
  });

  it('X comes before the targets it decides: "target creature card ... with mana value X" (601.2b-c)', () => {
    play((d) => {
      put(d, 0, 'Likeness Looter');
      put(d, 0, 'Island', 'battlefield', 6);
      put(d, 0, 'Elite Vanguard', 'graveyard');
      put(d, 0, 'Shivan Dragon', 'graveyard');
    });
    clickPermanent(byName(game(), 0, 'Likeness Looter')!);
    pickAbility({ activated: 1 });
    expect(buildView().abilityX).toMatchObject({ x: 6, max: 6 });
    setAbilityX(3); // no creature card with mana value 3
    expect(buildView().primary?.disabled).toBe(true);
    setAbilityX(1);
    press(); // Continue
    const v = buildView();
    expect(v.graveTargets?.options.map((c) => c.name)).toEqual(['Elite Vanguard']);
    chooseGraveyardTarget(v.graveTargets!.options[0].id);
    press(); // Pay {1}; the bots pass and it resolves
    expect(game().players[0].battlefield.find((c) => c.name === 'Likeness Looter')?.copy?.name).toBe('Elite Vanguard');
  });

  it('announces X for a −X loyalty ability, then its target', () => {
    play((d) => {
      put(d, 0, 'Chandra Nalaar').counters.loyalty = 6;
      put(d, 1, 'Shivan Dragon');
    });
    clickPermanent(byName(game(), 0, 'Chandra Nalaar')!);
    expect(buildView().loyalty?.options.map((o) => o.cost)).toEqual(['+1', '−X', '−8']);
    pickAbility({ ability: 1 });
    expect(buildView().abilityX).toMatchObject({ x: 6, max: 6 });
    expect(buildView().prompt).toContain('no loyalty left');
    setAbilityX(2);
    press(); // Continue
    clickPermanent(byName(game(), 1, 'Shivan Dragon')!);
    expect(useStore.getState().targeting).toBe(null);
    expect(byName(game(), 0, 'Chandra Nalaar')!.counters.loyalty).toBe(4);
    expect(byName(game(), 1, 'Shivan Dragon')!.damage).toBe(2);
  });
});

describe('the combat damage setting (510.1c)', () => {
  it('applies to the game in progress, and the human is asked once it is on', () => {
    play((d) => {
      put(d, 0, 'Kalonian Tusker');
      put(d, 1, 'Walking Corpse');
      put(d, 1, 'Goblin Piker');
    });
    useStore.getState().setSetting({ manualDamage: true });
    expect(game().players[0].manualDamage).toBe(true);
    const tusker = byName(game(), 0, 'Kalonian Tusker')!;
    let g = applyAction(game(), { type: 'pass' });
    g = applyAction(g, { type: 'declareAttack', card: tusker.id, defender: 1 });
    g = applyAction(g, { type: 'pass' });
    for (const b of ['Walking Corpse', 'Goblin Piker']) g = applyAction(g, { type: 'declareBlock', blocker: byName(g, 1, b)!.id, attacker: tusker.id });
    for (let i = 0; i < 10 && g.decision?.type !== 'assignDamage'; i++) g = applyAction(g, { type: 'pass' });
    useStore.setState({ game: g });
    expect(buildView().prompt).toContain('combat damage');
    useStore.getState().setSetting({ manualDamage: false });
    expect(game().players[0].manualDamage).toBe(false);
  });
});

describe('choosing the mana by hand (605, 106.1)', () => {
  const pool = () => game().players[0].pool.map((m) => m.sym).sort().join('');

  it("asks which of Sunken Ruins's abilities, and which mana, then pays", () => {
    play((d) => {
      put(d, 0, 'Sunken Ruins');
      put(d, 0, 'Swamp');
      put(d, 0, 'Island');
      put(d, 0, 'Stock Up', 'hand'); // {2}{U}
    });
    playHandCard(byName(game(), 0, 'Stock Up', 'hand')!);
    clickPermanent(byName(game(), 0, 'Swamp')!);
    clickPermanent(byName(game(), 0, 'Sunken Ruins')!);
    const pick = useStore.getState().manaPick!;
    expect(pick.options.map((o) => [o.text, o.mana.map((m) => m.join(''))])).toEqual([
      ['{T}', ['C']],
      ['{U/B}, {T}', ['UU', 'UB', 'BB']],
    ]);
    expect(byName(game(), 0, 'Sunken Ruins')!.tapped).toBe(false); // nothing is used until a pick
    pickMana(1, ['U', 'B']); // its {U/B} is paid with the Swamp's {B}
    expect(pool()).toBe('BU');
    clickPermanent(byName(game(), 0, 'Island')!);
    expect(game().stack.map((x) => x.card.name)).toEqual(['Stock Up']);
  });

  it('asks which mana a Talisman makes, and a dual land', () => {
    play((d) => {
      put(d, 0, 'Talisman of Dominance');
      put(d, 0, 'Watery Grave');
    });
    clickPermanent(byName(game(), 0, 'Talisman of Dominance')!);
    expect(useStore.getState().manaPick!.options.map((o) => [o.text, o.mana.map((m) => m.join(''))])).toEqual([
      ['{T}', ['C']],
      ['{T} · 1 damage to you', ['U', 'B']],
    ]);
    pickMana(1, ['U']);
    expect(pool()).toBe('U');
    expect(game().players[0].life).toBe(39);
    clickPermanent(byName(game(), 0, 'Watery Grave')!);
    expect(manaOptions(game(), 0, byName(game(), 0, 'Watery Grave')!).map((o) => o.mana.map((m) => m.join('')))).toEqual([['U', 'B']]);
    pickMana(0, ['B']);
    expect(pool()).toBe('BU');
  });

  it('uses a pile of dual lands the way picked once', () => {
    play((d) => put(d, 0, 'Watery Grave', 'battlefield', 2));
    clickGroup(game().players[0].battlefield);
    expect(useStore.getState().manaPick?.group).toHaveLength(1);
    pickMana(0, ['B']);
    expect(pool()).toBe('BB');
  });

  it('asks which creature Phyrexian Tower sacrifices', () => {
    play((d) => {
      put(d, 0, 'Phyrexian Tower');
      put(d, 0, 'Walking Corpse');
      put(d, 0, 'Goblin Piker');
    });
    clickPermanent(byName(game(), 0, 'Phyrexian Tower')!);
    const pick = useStore.getState().manaPick!;
    expect(pick.options.map((o) => o.text)).toEqual(['{T}', '{T}, Sacrifice a creature']);
    pickManaSacrifice(byName(game(), 0, 'Goblin Piker')!.id);
    pickMana(1, ['B', 'B']);
    expect(pool()).toBe('BB');
    expect(byName(game(), 0, 'Goblin Piker')).toBeUndefined();
    expect(byName(game(), 0, 'Walking Corpse')).toBeDefined();
  });

  it('a click takes back a Signet, and the land that paid for it', () => {
    play((d) => {
      put(d, 0, 'Dimir Signet');
      put(d, 0, 'Island');
    });
    clickPermanent(byName(game(), 0, 'Dimir Signet')!);
    expect(pool()).toBe('BU');
    expect(byName(game(), 0, 'Island')!.tapped).toBe(true);
    clickPermanent(byName(game(), 0, 'Dimir Signet')!);
    expect(pool()).toBe('');
    expect(game().players[0].battlefield.filter((c) => c.tapped)).toEqual([]);
  });
});

describe('the card preview (right-click)', () => {
  // No DOM here: the handlers only keep the element, so any object stands in for it.
  const el = {} as HTMLElement;
  const enter = (props: ReturnType<typeof hoverProps>) => props.onMouseEnter({ currentTarget: el } as MouseEvent<HTMLElement>);

  it('a graveyard card in the viewer can be right-clicked, but shows no hover preview', () => {
    play((d) => {
      put(d, 0, 'Curiosity', 'graveyard');
    });
    const c = byName(game(), 0, 'Curiosity', 'graveyard')!;
    enter(hoverProps(data(c), { pinOnly: true }));
    // Right-click pins whatever `hover` holds; `pinOnly` keeps the floating preview off.
    expect(useStore.getState().hover).toMatchObject({ name: 'Curiosity', d: data(c), el, pinOnly: true });
    hoverProps(data(c)).onMouseLeave();
    expect(useStore.getState().hover).toBeNull();
  });

  it('a card on the table or on top of a pile gets the hover preview too', () => {
    play((d) => {
      put(d, 0, 'Serra Angel', 'graveyard');
    });
    enter(hoverProps(data(byName(game(), 0, 'Serra Angel', 'graveyard')!)));
    expect(useStore.getState().hover).toMatchObject({ name: 'Serra Angel', el });
    expect(useStore.getState().hover!.pinOnly).toBeUndefined();
  });
});
