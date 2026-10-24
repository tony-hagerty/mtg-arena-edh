// The human's casting flow in the UI: announce X/kicker/cost, choose targets, choose a
// sacrifice, pay. Drives the real store and view code without rendering anything.
import { produce } from 'immer';
import type { MouseEvent } from 'react';
import { describe, expect, it } from 'vitest';
import './fixtures';
import { hoverHandCard, leaveHandCard, useStore } from '../src/ui/store';
import { arrowsFrom, edgeToward, hoverProps, stackLoop } from '../src/ui/util';
import { activateFromHand, buildView, clickGroup, chooseEscape, chooseGraveyardTarget, clickPermanent, clickPlayer, clickStackItem, exileForMana, manaOptions, pickAbility, pickMana, pickManaSacrifice, pickFace, pickMode, playHandCard, setAbilityX, setChoices, stackTucked, undo, setPayLife } from '../src/ui/view';
import { applyAction, canCast, createToken, data, defaultStops, isCreature, isLand, makeCard, scriptOf } from '../src/engine';
import { registerScripts } from '../src/engine/registry';
import { parseCard, scriptCards } from '../src/cards/oracle';
import { cardData, registerCards } from '../src/cards/db';
import type { Game } from '../src/engine';
import { byName, emptyGame, put } from './helpers';
import { REFUSED_CARDS } from './refused-cards';
import { DECKS } from '../src/cards/db';
import type { DeckDef } from '../src/cards/db';
import { checkList, deckAsList, savedDeckIssues, savedDeckState } from '../src/cards/decklist';
import { playedDeck, playsWithoutText } from '../src/cards/support';
import { addCards } from '../src/cards/fetched';
import { tableOf } from '../src/ui/store';

/** Starts the store on a game where player 0 is the human. */
function play(setup: (g: Game) => void) {
  const g = produce(emptyGame(setup), (d) => {
    d.players[0].isBot = false;
    d.players[0].you = true;
  });
  useStore.setState({ game: g, human: 0, humans: [0], handoff: null, targeting: null, pickedBlockers: [], undoSteps: [], manaPick: null });
}
const game = () => useStore.getState().game!;
const press = () => buildView().primary!.onClick();

describe('casting with choices in the UI (601.2b)', () => {
  it('lets the payer choose how many Phyrexian or K\'rrik symbols to pay with life (601.2b, 107.4f)', () => {
    play((d) => {
      put(d, 0, 'Mountain');
      put(d, 0, 'Gut Shot', 'hand');
    });
    playHandCard(byName(game(), 0, 'Gut Shot', 'hand')!);
    clickPlayer(1);
    let v = buildView();
    // Paying: auto-pay would use the Mountain, so the stepper starts at 0 with life, on Auto.
    expect(v.payLife).toEqual({ n: 0, max: 1, auto: true });
    expect(v.prompt).toContain('Pay {R/P}');
    setPayLife(1);
    v = buildView();
    expect(v.payLife).toEqual({ n: 1, max: 1, auto: false });
    expect(v.prompt).toContain('paying 2 life');
    press(); // Pay: 2 life, the Mountain stays untapped.
    expect(game().players[0].life).toBe(38);
    expect(byName(game(), 0, 'Mountain')!.tapped).toBe(false);
    // K'rrik: Murder's two {B} may each be paid with life; the stepper goes up to two, Auto goes back to mana.
    play((d) => {
      put(d, 0, "K'rrik, Son of Yawgmoth");
      put(d, 0, 'Swamp', 'battlefield', 3);
      put(d, 0, 'Murder', 'hand');
      put(d, 1, 'Serra Angel');
    });
    playHandCard(byName(game(), 0, 'Murder', 'hand')!);
    clickPermanent(byName(game(), 1, 'Serra Angel')!);
    expect(buildView().payLife).toEqual({ n: 0, max: 2, auto: true });
    setPayLife(2);
    expect(buildView().payLife).toEqual({ n: 2, max: 2, auto: false });
    setPayLife(null);
    expect(buildView().payLife).toEqual({ n: 0, max: 2, auto: true });
    setPayLife(2);
    press();
    expect(game().players[0].life).toBe(36);
    expect(game().players[0].battlefield.filter((c) => c.name === 'Swamp' && c.tapped)).toHaveLength(1);
  });

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

describe('hiding the stack', () => {
  it('tucks the stack away until it empties, and shows it while it is needed', () => {
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
    useStore.setState({ stackHidden: true });
    expect(stackTucked(buildView(), true)).toBe(true);
    // Casting a counterspell: it is paid for and targets the stack, so the stack shows again.
    playHandCard(byName(game(), 0, 'Counterspell', 'hand')!);
    expect(buildView().targetStack.size).toBe(1);
    expect(stackTucked(buildView(), useStore.getState().stackHidden)).toBe(false);
    clickStackItem(game().stack[0].id);
    press(); // Pay: both resolve and the stack empties.
    expect(game().stack).toHaveLength(0);
    // The next spell shows the stack again.
    expect(useStore.getState().stackHidden).toBe(false);
  });

  it('starts every hand scrolled to its first card', () => {
    useStore.setState({ handStart: 5 });
    play(() => {});
    useStore.getState().start(null);
    expect(useStore.getState().handStart).toBe(0);
    useStore.getState().quit();
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

  it('picks the creature that stations a Spacecraft, which gets charge counters equal to its power (702.184a)', () => {
    play((d) => {
      put(d, 0, 'Hearthhull, the Worldseed');
      put(d, 0, 'Raging Goblin');
      put(d, 0, 'Serra Angel');
      put(d, 1, 'Serra Angel');
    });
    clickPermanent(byName(game(), 0, 'Hearthhull, the Worldseed')!);
    const v = buildView();
    expect(v.prompt).toContain('another untapped creature you control');
    expect(v.primary?.disabled).toBe(true);
    expect(v.glow.get(byName(game(), 0, 'Serra Angel')!.id)).toBe('target');
    expect(v.glow.get(byName(game(), 1, 'Serra Angel')!.id)).toBeUndefined();
    expect(v.glow.get(byName(game(), 0, 'Hearthhull, the Worldseed')!.id)).toBe('picked'); // never itself
    clickPermanent(byName(game(), 1, 'Serra Angel')!); // an opponent's creature: nothing happens
    expect(buildView().primary?.disabled).toBe(true);
    clickPermanent(byName(game(), 0, 'Serra Angel')!);
    expect(buildView().primary?.disabled).toBe(false);
    press(); // Tap: the cost is nothing but the tap, so it goes straight on the stack and resolves
    expect(byName(game(), 0, 'Serra Angel')!.tapped).toBe(true);
    expect(byName(game(), 0, 'Hearthhull, the Worldseed')!.counters.charge).toBe(4);
    expect(isCreature(game(), byName(game(), 0, 'Hearthhull, the Worldseed')!)).toBe(false);
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

describe('"Sacrifice X" in the UI (107.3a)', () => {
  it('Chatterfang: announce X, then the target, then X Squirrels to sacrifice', () => {
    play((d) => {
      put(d, 0, 'Chatterfang, Squirrel General');
      put(d, 0, 'Swamp');
      put(d, 1, 'Shivan Dragon');
    });
    // Two Squirrels come with a Treasure: Chatterfang's replacement effect (614.1a).
    useStore.setState({ game: produce(game(), (d) => void createToken(d, 0, 'Treasure', 2)) });
    clickPermanent(byName(game(), 0, 'Chatterfang, Squirrel General')!);
    // Chatterfang is a Squirrel too: three in all.
    expect(buildView().abilityX).toMatchObject({ x: 3, max: 3 });
    setAbilityX(2);
    press(); // Continue
    clickPermanent(byName(game(), 1, 'Shivan Dragon')!);
    const squirrels = game().players[0].battlefield.filter((c) => c.name === 'Squirrel 1/1 G');
    expect(buildView().glow.get(squirrels[0].id)).toBe('target');
    clickPermanent(squirrels[0]);
    clickPermanent(squirrels[1]);
    press(); // Pay {B}; the bots pass and it resolves
    expect(game().players[0].battlefield.filter((c) => c.name === 'Squirrel 1/1 G')).toHaveLength(0);
    expect(game().players[1].battlefield.some((c) => c.name === 'Shivan Dragon')).toBe(true);
    expect(game().log.some((l) => l.text.includes('Shivan Dragon gets +2/-2'))).toBe(true);
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

describe('stops and full control in the UI (117.3)', () => {
  const prompt = () => buildView().prompt;
  const next = () => buildView().primary?.sub;

  it('says what the human could do at an "ifAble" stop, and the Next button says where it stops (702.74)', () => {
    // Solitude's evoke cost is a white card from hand, so it can be cast in every step.
    play((d) => {
      put(d, 0, 'Solitude', 'hand');
      put(d, 0, 'Swords to Plowshares', 'hand');
    });
    expect(next()).toBe('To Combat');
    press();
    expect([game().step, game().priority]).toEqual(['beginCombat', 0]);
    expect(prompt()).toBe('Beginning of combat. You could cast Solitude, or go on to declare attackers.');
    expect(next()).toBe('To Main 2');
    press();
    expect(game().step).toBe('main2');
    press();
    expect([game().active, game().step, game().priority]).toEqual([1, 'upkeep', 0]);
    expect(prompt()).toBe(`${game().players[1].name}'s turn, upkeep. You could cast Solitude, or pass.`);
    expect(next()).toBe('To End Step');
  });

  it('full control stops at every step and says so, holds priority by default, and turns off again', () => {
    play((d) => {
      put(d, 0, 'Mountain');
      put(d, 0, 'Shock', 'hand');
    });
    try {
      useStore.getState().setFullControl(true);
      expect(useStore.getState().hold).toBe(true);
      // Main 1 is a stop anyway, so it isn't only full control.
      expect(prompt()).toBe(null);
      // Cast Shock: Hold is on, so the human keeps priority over their own spell (117.3c).
      playHandCard(byName(game(), 0, 'Shock', 'hand')!);
      clickPlayer(1);
      press();
      expect([game().stack.length, game().priority]).toEqual([1, 0]);
      expect(prompt()).toBe('Respond to your Shock, or let it resolve.');
      expect(useStore.getState().hold).toBe(true);
      press(); // Resolve
      expect([game().stack.length, game().step, game().priority, game().players[1].life]).toEqual([0, 'main1', 0, 38]);
      expect(next()).toBe('To Combat');
      press();
      expect([game().step, game().priority]).toEqual(['beginCombat', 0]);
      expect(prompt()).toBe('Full control. Beginning of combat. Cast instants, or go on to declare attackers.');
      expect(next()).toBe('To Attackers');
      press();
      expect(game().step).toBe('attackers');
      expect(prompt()).toBe('Full control. Your turn, declare attackers. Cast instants, or pass.');
      useStore.getState().setFullControl(false);
      expect(useStore.getState().hold).toBe(false);
      // Back to the saved stops: main 2 is the next one.
      expect(next()).toBe('To Main 2');
      press();
      expect([game().step, game().priority]).toEqual(['main2', 0]);
    } finally {
      useStore.getState().setFullControl(false);
    }
  });
});

describe('passing to the end of the turn (F6) and resetting the stops', () => {
  it('passes at once and through the turn, then the next turn stops as usual', () => {
    play((d) => {
      put(d, 0, 'Solitude', 'hand');
      put(d, 0, 'Swords to Plowshares', 'hand');
    });
    const turn = game().turn;
    useStore.getState().setPassTurn(true);
    expect(useStore.getState().passTurn).toEqual({ 0: turn });
    // Beginning of combat and main 2 would have stopped (Solitude can always be cast); the next player's upkeep does.
    expect([game().active, game().step, game().priority]).toEqual([1, 'upkeep', 0]);
    // Off again, it passes nothing by itself.
    useStore.getState().setPassTurn(false);
    expect(useStore.getState().passTurn).toEqual({});
    expect([game().active, game().step]).toEqual([1, 'upkeep']);
  });

  it('puts the stops back to the defaults', () => {
    const saved = useStore.getState().stops;
    try {
      useStore.getState().setStop(0, 'upkeep', 'always');
      expect(useStore.getState().stops[0].upkeep).toBe('always');
      useStore.getState().resetStops();
      expect(useStore.getState().stops).toEqual(defaultStops(0));
    } finally {
      useStore.setState({ stops: saved });
    }
  });
});

describe('a fetch land in the main phase (117.3b)', () => {
  it.each(['hand script', 'Oracle template'])('after the search the human still has priority in main 1 (%s)', (source) => {
    const hand = scriptOf('Polluted Delta');
    const parsed = parseCard(cardData('Polluted Delta'));
    if (!parsed.ok) throw new Error('Polluted Delta refused');
    try {
      // A pasted deck's fetch lands without a hand script are read by the Oracle parser.
      if (source === 'Oracle template') registerScripts({ 'Polluted Delta': parsed.script });
      play((d) => {
        put(d, 0, 'Polluted Delta');
        d.players[0].library = [];
        put(d, 0, 'Island', 'library');
        put(d, 0, 'Plains', 'library');
      });
      clickPermanent(byName(game(), 0, 'Polluted Delta')!);
      press(); // Pay 1 life
      expect(game().decision?.type).toBe('chooseCards');
      useStore.getState().act({ type: 'chooseCards', cards: [byName(game(), 0, 'Island', 'library')!.id] });
      expect([game().step, game().priority, game().decision]).toEqual(['main1', 0, null]);
      expect(buildView().primary?.label).toBe('Next');
    } finally {
      registerScripts({ 'Polluted Delta': hand });
    }
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

describe('hovering the hand (HandCard)', () => {
  // Two cards' resting places (`.hand-hit`); any objects stand in for the elements.
  const first = {} as HTMLElement;
  const next = {} as HTMLElement;
  const hoverOf = (name: string, el: HTMLElement) => ({ name, d: cardData(name), el, pinOnly: true });

  it('moving onto the next card hands the hover over, whichever event comes first', () => {
    play(() => {});
    expect(hoverHandCard(hoverOf('Blaze', first))).toBe(true);
    expect(hoverHandCard(hoverOf('Serra Angel', next))).toBe(true);
    // The first card's leave, after the next card took over, keeps the next card's hover.
    expect(leaveHandCard(first)).toBe(true);
    expect(useStore.getState().hover).toMatchObject({ name: 'Serra Angel', el: next });
    expect(leaveHandCard(next)).toBe(true);
    expect(useStore.getState().hover).toBeNull();
  });

  it('while a card is held, the cards it is dragged over don’t hover, and the held one keeps the hover', () => {
    play(() => {});
    hoverHandCard(hoverOf('Blaze', first));
    useStore.setState({ holding: 'blaze-id' });
    expect(hoverHandCard(hoverOf('Serra Angel', next))).toBe(false);
    expect(leaveHandCard(next)).toBe(false);
    expect(leaveHandCard(first)).toBe(false);
    expect(useStore.getState().hover).toMatchObject({ name: 'Blaze', el: first });
    // Let go: hovering works again.
    useStore.setState({ holding: null });
    expect(hoverHandCard(hoverOf('Serra Angel', next))).toBe(true);
    expect(useStore.getState().hover).toMatchObject({ name: 'Serra Angel', el: next });
  });

  it('a new game lets go of a held card', () => {
    useStore.setState({ holding: 'blaze-id' });
    play(() => {});
    useStore.getState().start(null);
    expect(useStore.getState().holding).toBeNull();
    useStore.getState().quit();
  });
});

describe('the error screen’s details (ErrorScreen.tsx)', () => {
  it('names the turn and step and the last log lines, and sends nothing without a program', async () => {
    const { crashDetails, reportError } = await import('../src/ui/crash');
    play((d) => {
      d.turn = 4;
      put(d, 0, 'Serra Angel');
    });
    useStore.setState({ server: null, game: produce(game(), (d) => void d.log.push({ text: 'Seraphine casts Kaya’s Ghostform.' } as Game['log'][number])) });
    const text = crashDetails(new Error('Unknown card: Wizard'), '\n    at SpellFlash', null);
    expect(text).toContain('Turn 4, main1');
    expect(text).toContain('Error: Unknown card: Wizard');
    expect(text).toContain('at SpellFlash');
    expect(text).toContain('Seraphine casts Kaya’s Ghostform.');
    // A page opened from disk has no program to write a log: the error screen is all there is.
    expect(await reportError('render', new Error('boom'))).toBe(null);
  });
});

describe('pasting a deck with cards the game can\'t read (the paste screen and the store)', () => {
  const black = DECKS.find((d) => d.id === 'black')!;
  const { hound, wisp, lord, ninja } = REFUSED_CARDS;
  /** The black deck as a list, with its last cards swapped for these. */
  const list = (swaps: string[], commander = black.commanders[0]) => {
    const cards = [...black.cards.slice(0, black.cards.length - swaps.length), ...swaps];
    const basics = Object.entries(black.basics).map(([n, k]) => `${k} ${n}`);
    return ['Commander', `1 ${commander}`, '', 'Deck', ...basics, ...cards.map((c) => `1 ${c}`)].join('\n');
  };

  it('lists a refused card with its clause and Oracle line, grouped with others that stumble on the same wording', () => {
    const check = checkList(list([hound.name, wisp.name, ninja.name]), null, '', 'pasted-t');
    expect(check.problems).toEqual([]);
    expect(check.refused.map((r) => r.name)).toEqual([hound.name, wisp.name, ninja.name]);
    const [h, w, n] = check.refused;
    expect(h.heading).toMatch(/^“Whenever this card becomes the target of a spell/);
    expect(h.line).toBe(hound.oracleText.split('\n')[1]);
    // The same wording on two cards is one group.
    expect(w.group).toBe(h.group);
    expect(n.group).not.toBe(h.group);
    // A keyword that changes how it is played: it can only be swapped.
    expect(h.noTextless).toBeNull();
    expect(n.noTextless).toBe('its keyword "ninjutsu" changes how it is played');
  });

  it('saves a deck with refused cards left over, marked, and it waits on the menu with them listed first', () => {
    const check = checkList(list([hound.name, wisp.name]), null, '', 'pasted-t');
    expect(check.deck).not.toBeNull();
    expect(check.ready).toBe(false);
    expect(check.leftover.map((r) => r.name)).toEqual([hound.name, wisp.name]);
    const deck = check.deck!;
    expect(deck.textless).toBeUndefined();
    expect(savedDeckState(deck)).toEqual({ issues: [], unplayable: [hound.name, wisp.name], textless: [] });
    expect(savedDeckIssues(deck)[0]).toMatch(/^Testing Gloom Hound: the game can't read/);
    // A deck that waits can't be seated, and doesn't fill an opponent's seat.
    expect(tableOf(null, { ...useStore.getState().settings, opponents: [deck.id, null, null] }, [deck]).map((s) => s.deck.id)).not.toContain(deck.id);
    // Reopened from the menu, the cards to swap are at the top of the deck.
    const text = deckAsList(deck, savedDeckState(deck).unplayable);
    expect(text.split('\n').slice(0, 6)).toEqual(['Commander', `1 ${black.commanders[0]}`, '', 'Deck', `1 ${hound.name}`, `1 ${wisp.name}`]);
    const again = checkList(text, null, deck.title, deck.id).deck!;
    expect({ ...again, cards: [...again.cards].sort() }).toEqual({ ...deck, cards: [...deck.cards].sort() });
  });

  it('plays a refused card without its rules text by choice: saved with the deck, played by the engine, reversible', () => {
    const check = checkList(list([hound.name, wisp.name]), null, '', 'pasted-t', undefined, [hound.name, wisp.name]);
    expect(check.ready).toBe(true);
    expect(check.refused.every((r) => r.textless)).toBe(true);
    const deck = check.deck!;
    expect(deck.textless).toEqual([hound.name, wisp.name]);
    expect(savedDeckState(deck)).toEqual({ issues: [], unplayable: [], textless: [hound.name, wisp.name] });
    expect(savedDeckIssues(deck)).toEqual([]);
    useStore.getState().saveDeck(deck);
    expect(useStore.getState().savedDecks.find((d) => d.id === deck.id)?.textless).toEqual([hound.name, wisp.name]);
    // The game starts with those cards flagged, and only those.
    useStore.getState().start(deck);
    const mine = [...game().players[0].library, ...game().players[0].hand];
    expect(mine.filter((c) => c.textless).map((c) => c.name).sort()).toEqual([hound.name, wisp.name]);
    expect(mine.filter((c) => !c.textless).every((c) => c.name !== hound.name)).toBe(true);
    useStore.getState().quit();
    // Undone on the paste screen: back to a card to swap.
    const undone = checkList(deckAsList(deck), null, deck.title, deck.id, undefined, [wisp.name]);
    expect(undone.leftover.map((r) => r.name)).toEqual([hound.name]);
    expect(undone.deck!.textless).toEqual([wisp.name]);
    useStore.getState().deleteDeck(deck.id);
  });

  it("never plays a commander without its text, nor a card the engine can't frame", () => {
    const blackNoJudith = list([lord.name, ninja.name], lord.name).replace(`1 ${black.commanders[0]}\n`, `1 ${lord.name}\n`);
    const check = checkList(blackNoJudith, null, '', 'pasted-t', undefined, [lord.name, ninja.name]);
    const byCard = Object.fromEntries(check.refused.map((r) => [r.name, r]));
    expect(byCard[lord.name]).toMatchObject({ commander: true, textless: false, noTextless: "it's the commander, and a commander's text is the deck" });
    expect(byCard[ninja.name]).toMatchObject({ textless: false });
    expect(check.deck?.textless).toBeUndefined();
    // Even a hand-edited saved deck can't do it.
    const forged: DeckDef = { ...black, id: 'forged', commanders: [lord.name], textless: [lord.name, ninja.name] };
    expect(playsWithoutText(forged, lord.name)).toBe(false);
    expect(playsWithoutText(forged, ninja.name)).toBe(false);
    expect(playedDeck(forged).textless).toBeUndefined();
  });

  it('plays the card with its own text again once the game can read it', () => {
    // A card of its own, since this test gives it a script for good.
    const later = { ...hound, name: 'Testing Gloom Later', oracleText: hound.oracleText.replaceAll(hound.name, 'Testing Gloom Later') };
    addCards([later], { [later.name]: 'legal' });
    const deck: DeckDef = { ...black, id: 'later', cards: [...black.cards.slice(1), later.name], textless: [later.name] };
    expect(playedDeck(deck).textless).toEqual([later.name]);
    // A newer parser, or a hand script, reads it.
    registerScripts({ [later.name]: {} });
    expect(playsWithoutText(deck, later.name)).toBe(false);
    expect(playedDeck(deck).textless).toBeUndefined();
    expect(savedDeckState(deck).textless).toEqual([]);
  });

  it('a textless card on the table shows its note in the hover preview, and the log says so once', () => {
    play((d) => {
      put(d, 0, 'Swamp', 'battlefield', 4);
      d.players[0].hand.push({ ...put(d, 0, hound.name, 'library'), zone: 'hand', textless: true });
      d.players[0].library.pop();
    });
    const c = byName(game(), 0, hound.name, 'hand')!;
    expect(c.textless).toBe(true);
    playHandCard(c);
    press(); // Pay
    const tile = byName(game(), 0, hound.name)!;
    expect(tile.textless).toBe(true);
    expect(game().log.filter((l) => l.text.includes("(its rules text doesn't work here)"))).toHaveLength(1);
    const el = {} as HTMLElement;
    hoverProps(data(tile), { textless: tile.textless }).onMouseEnter({ currentTarget: el } as MouseEvent<HTMLElement>);
    expect(useStore.getState().hover).toMatchObject({ name: hound.name, textless: true });
  });
});

describe('undo (Ctrl+Z)', () => {
  const pool = () => game().players[0].pool.map((m) => m.sym).sort().join('');
  const tapped = () => game().players[0].battlefield.filter((c) => c.tapped).map((c) => c.name).sort();
  const mountains = () => game().players[0].battlefield.filter((c) => c.name === 'Mountain');

  it('closes a mana choice left open, and nothing is used', () => {
    play((d) => put(d, 0, 'Talisman of Dominance'));
    clickPermanent(byName(game(), 0, 'Talisman of Dominance')!);
    expect(useStore.getState().manaPick).not.toBe(null);
    expect(undo()).toBe(true);
    expect(useStore.getState().manaPick).toBe(null);
    expect(tapped()).toEqual([]);
    expect(undo()).toBe(false);
  });

  it('steps back through a spell being cast, one choice a press, then cancels it like Esc', () => {
    play((d) => {
      put(d, 0, 'Mountain', 'battlefield', 4);
      put(d, 0, 'Blaze', 'hand');
    });
    playHandCard(byName(game(), 0, 'Blaze', 'hand')!);
    setChoices({ x: 2 });
    press(); // Continue
    clickPlayer(1);
    clickPermanent(mountains()[0]); // tapped by hand to pay
    expect(pool()).toBe('R');
    expect(buildView().paying).not.toBe(null);

    expect(undo()).toBe(true); // the Mountain untaps (733.1)
    expect(pool()).toBe('');
    expect(tapped()).toEqual([]);
    expect(buildView().paying).not.toBe(null);

    expect(undo()).toBe(true); // the target
    let v = buildView();
    expect(v.paying).toBe(null);
    expect(v.targetPlayers.has(1)).toBe(true);
    expect(useStore.getState().targeting!.chosen).toEqual([]);

    expect(undo()).toBe(true); // back to announcing, X as it was
    v = buildView();
    expect(v.announce?.choices.x).toBe(2);

    expect(undo()).toBe(true); // cancelled
    expect(useStore.getState().targeting).toBe(null);
    expect(byName(game(), 0, 'Blaze', 'hand')).toBeDefined();
    expect(undo()).toBe(false);
  });

  it('cancels a spell at its start, untapping what was tapped for it, as Esc does', () => {
    play((d) => {
      put(d, 0, 'Mountain', 'battlefield', 2);
      put(d, 0, 'Lightning Bolt', 'hand');
    });
    playHandCard(byName(game(), 0, 'Lightning Bolt', 'hand')!);
    expect(undo()).toBe(true);
    expect(useStore.getState().targeting).toBe(null);
    expect(byName(game(), 0, 'Lightning Bolt', 'hand')).toBeDefined();
    expect(tapped()).toEqual([]);
  });

  it('takes back the sacrifice, then the target (118.8)', () => {
    play((d) => {
      put(d, 0, 'Swamp');
      put(d, 0, 'Elite Vanguard');
      put(d, 1, 'Serra Angel');
      put(d, 0, 'Bone Splinters', 'hand');
    });
    playHandCard(byName(game(), 0, 'Bone Splinters', 'hand')!);
    clickPermanent(byName(game(), 1, 'Serra Angel')!);
    clickPermanent(byName(game(), 0, 'Elite Vanguard')!);
    expect(buildView().prompt).toContain('Pay {B}');
    undo();
    expect(buildView().prompt).toContain('a creature to sacrifice');
    expect(useStore.getState().targeting!.choices.sacrifice ?? []).toEqual([]);
    undo();
    expect(buildView().glow.get(byName(game(), 1, 'Serra Angel')!.id)).toBe('target');
    expect(useStore.getState().targeting!.chosen).toEqual([]);
  });

  it('takes back the card picked to discard (118.8)', () => {
    play((d) => {
      put(d, 0, 'Mountain', 'battlefield', 2);
      put(d, 0, 'Grab the Prize', 'hand');
      put(d, 0, 'Lightning Bolt', 'hand');
    });
    playHandCard(byName(game(), 0, 'Grab the Prize', 'hand')!);
    playHandCard(byName(game(), 0, 'Lightning Bolt', 'hand')!);
    expect(buildView().prompt).toContain('Pay {1}{R}');
    undo();
    expect(buildView().prompt).toContain('choose a card in your hand to discard');
    expect(byName(game(), 0, 'Lightning Bolt', 'hand')).toBeDefined();
  });

  it('takes back a pile tapped while paying in one press', () => {
    play((d) => {
      put(d, 0, 'Mountain', 'battlefield', 3);
      put(d, 0, 'Swamp');
      put(d, 0, 'Blaze', 'hand');
    });
    playHandCard(byName(game(), 0, 'Blaze', 'hand')!);
    setChoices({ x: 3 });
    press(); // Continue
    clickPlayer(1);
    clickGroup(mountains());
    expect(tapped()).toEqual(['Mountain', 'Mountain', 'Mountain']);
    expect(undo()).toBe(true);
    expect(tapped()).toEqual([]);
    expect(buildView().paying).not.toBe(null);
  });

  it('outside a spell, takes back the newest mana still in the pool, one source a press', () => {
    play((d) => {
      put(d, 0, 'Island');
      put(d, 0, 'Mountain');
      put(d, 0, 'Swamp');
    });
    clickPermanent(byName(game(), 0, 'Island')!);
    clickPermanent(byName(game(), 0, 'Mountain')!);
    clickPermanent(byName(game(), 0, 'Swamp')!);
    expect(pool()).toBe('BRU');
    clickPermanent(byName(game(), 0, 'Swamp')!); // taken back by a click: that step is gone
    expect(undo()).toBe(true);
    expect(pool()).toBe('U');
    expect(tapped()).toEqual(['Island']);
    expect(undo()).toBe(true);
    expect(pool()).toBe('');
    expect(undo()).toBe(false);
  });

  it('takes back a mana pick, and a Signet with the land that paid for it, a press each', () => {
    play((d) => {
      put(d, 0, 'Dimir Signet');
      put(d, 0, 'Island');
      put(d, 0, 'Watery Grave');
    });
    clickPermanent(byName(game(), 0, 'Watery Grave')!);
    pickMana(0, ['B']);
    clickPermanent(byName(game(), 0, 'Island')!);
    clickPermanent(byName(game(), 0, 'Dimir Signet')!); // pays its {1} from the pool
    expect(tapped()).toEqual(['Dimir Signet', 'Island', 'Watery Grave']);
    undo();
    expect(tapped()).toEqual(['Island', 'Watery Grave']);
    undo();
    expect(tapped()).toEqual(['Watery Grave']);
    expect(pool()).toBe('B');
    undo();
    expect(tapped()).toEqual([]);
  });

  it('never undoes a spell cast: casting ends what came before it', () => {
    play((d) => {
      put(d, 0, 'Mountain', 'battlefield', 2);
      put(d, 0, 'Lightning Bolt', 'hand');
    });
    clickPermanent(mountains()[0]);
    clickPermanent(mountains()[1]);
    expect(pool()).toBe('RR');
    playHandCard(byName(game(), 0, 'Lightning Bolt', 'hand')!);
    clickPlayer(1);
    press(); // Pay, from the pool
    expect(useStore.getState().targeting).toBe(null);
    expect(game().players[1].life).toBe(37);
    expect(pool()).toBe('R');
    // The other Mountain's {R} is unspent, but the step that made it went with the cast.
    expect(undo()).toBe(false);
    expect(byName(game(), 0, 'Lightning Bolt', 'graveyard')).toBeDefined();
    expect(pool()).toBe('R');
    expect(tapped()).toEqual(['Mountain', 'Mountain']);
  });

  it('takes back the last attackers declared, a click at a time (508.1)', () => {
    play((d) => {
      put(d, 0, 'Kalonian Tusker');
      put(d, 0, 'Goblin Piker');
    });
    press(); // to combat
    expect(game().decision?.type).toBe('attackers');
    const tusker = byName(game(), 0, 'Kalonian Tusker')!;
    const piker = byName(game(), 0, 'Goblin Piker')!;
    clickPermanent(tusker);
    clickPermanent(piker);
    expect(game().combat!.attacks.map((a) => a.id)).toEqual([tusker.id, piker.id]);
    expect(undo()).toBe(true);
    expect(game().combat!.attacks.map((a) => a.id)).toEqual([tusker.id]);
    expect(undo()).toBe(true);
    expect(game().combat!.attacks).toEqual([]);
    expect(undo()).toBe(false);
    press(); // All Attack: one click, so one press takes them all back
    expect(game().combat!.attacks).toHaveLength(2);
    expect(undo()).toBe(true);
    expect(game().combat!.attacks).toEqual([]);
  });

  it('moves an attack switched to a planeswalker back where it was (508.1b)', () => {
    play((d) => {
      put(d, 0, 'Kalonian Tusker');
      put(d, 1, 'Jace Beleren').counters.loyalty = 3;
    });
    press(); // to combat
    const tusker = byName(game(), 0, 'Kalonian Tusker')!;
    const jace = byName(game(), 1, 'Jace Beleren')!;
    clickPermanent(tusker); // at the player
    clickPermanent(jace); // attackers now go at Jace
    clickPermanent(tusker); // moved to Jace
    expect(game().combat!.attacks).toMatchObject([{ id: tusker.id, defender: 1, target: jace.id }]);
    undo();
    expect(game().combat!.attacks).toMatchObject([{ id: tusker.id, defender: 1, target: null }]);
  });

  it('takes back the last blocker declared, then the pick (509.1)', () => {
    play((d) => {
      put(d, 0, 'Kalonian Tusker');
      put(d, 0, 'Goblin Piker');
      put(d, 1, 'Walking Corpse');
    });
    let g = applyAction(game(), { type: 'pass' });
    for (const name of ['Kalonian Tusker', 'Goblin Piker']) g = applyAction(g, { type: 'declareAttack', card: byName(g, 0, name)!.id, defender: 1 });
    g = applyAction(g, { type: 'pass' });
    expect([g.decision?.type, g.priority]).toEqual(['blockers', 1]);
    g = produce(g, (d) => {
      d.players[1].isBot = false;
    });
    useStore.setState({ game: g, human: 1, humans: [1], undoSteps: [] });
    const corpse = byName(game(), 1, 'Walking Corpse')!;
    const piker = byName(game(), 0, 'Goblin Piker')!;
    clickPermanent(corpse); // two attackers it could block: picked
    expect(useStore.getState().pickedBlockers).toEqual([corpse.id]);
    clickPermanent(piker);
    expect(game().combat!.attacks.find((a) => a.id === piker.id)!.blockers).toEqual([corpse.id]);
    expect(undo()).toBe(true); // the block goes, and the Corpse is picked again
    expect(game().combat!.attacks.flatMap((a) => a.blockers)).toEqual([]);
    expect(useStore.getState().pickedBlockers).toEqual([corpse.id]);
    expect(undo()).toBe(true); // the pick goes
    expect(useStore.getState().pickedBlockers).toEqual([]);
    expect(undo()).toBe(false);
  });

  it('does nothing with nothing to take back, or after a pass', () => {
    play((d) => put(d, 0, 'Mountain'));
    expect(undo()).toBe(false);
    clickPermanent(byName(game(), 0, 'Mountain')!);
    useStore.getState().act({ type: 'pass' });
    useStore.setState({ game: produce(game(), (d) => void (d.priority = 0)) });
    expect(undo()).toBe(false);
    expect(tapped()).toEqual(['Mountain']);
  });
});

describe('playing from the top of the library and from the graveyard by permission (zones group)', () => {
  // Glarb is a fixture the parser reads, as it would a fetched card's.
  scriptCards(["Glarb, Calamity's Augur"]);
  it("casts the top card of the library from the pile with Glarb, and sees it (Glarb's rulings)", () => {
    play((d) => {
      put(d, 0, "Glarb, Calamity's Augur");
      put(d, 0, 'Plains', 'battlefield', 5);
      d.players[0].library.unshift(makeCard(d, 'Serra Angel', 0, 'library'));
    });
    const top = game().players[0].library[0];
    expect(buildView().glow.get(top.id)).toBe('play');
    playHandCard(top);
    expect(buildView().prompt).toContain('Pay {3}{W}{W}');
    press();
    expect(byName(game(), 0, 'Serra Angel')).toBeDefined();
  });

  it('asks which permission a land from the graveyard is played by when two apply (Muldrotha\'s rulings)', () => {
    registerScripts({ 'Test Crucible UI': { playPermission: (g, self, pid, c) => (pid === self.controller && c.zone === 'graveyard' && c.owner === pid && isLand(g, c) ? { land: true } : null) } });
    registerCards({ 'Test Crucible UI': { name: 'Test Crucible UI', manaCost: '{3}', cmc: 3, colors: [], colorIdentity: [], typeLine: 'Artifact', oracleText: 'You may play lands from your graveyard.', keywords: [], image: '', art: '' } });
    play((d) => {
      put(d, 0, 'Muldrotha, the Gravetide');
      put(d, 0, 'Test Crucible UI');
      put(d, 0, 'Forest', 'graveyard');
    });
    const forest = byName(game(), 0, 'Forest', 'graveyard')!;
    expect(buildView().glow.get(forest.id)).toBe('play');
    playHandCard(forest);
    const a = buildView().announce!;
    expect(a.costs.map((c) => c.label)).toEqual(['Muldrotha, the Gravetide', 'Test Crucible UI']);
    expect(a.choices.permit).toBe(byName(game(), 0, 'Muldrotha, the Gravetide')!.id);
    setChoices({ permit: a.costs[1].permit });
    expect(buildView().prompt).toContain('Play Forest as a land');
    press(); // Continue: the land is played by the Crucible's permission, leaving Muldrotha's land use free.
    expect(byName(game(), 0, 'Forest')).toBeDefined();
    expect(game().permits ?? {}).toEqual({});
  });

  it("offers Muldrotha's permanent types as cost chips for a card with two, and casts it as the one picked", () => {
    play((d) => {
      put(d, 0, 'Muldrotha, the Gravetide');
      put(d, 0, 'Plains', 'battlefield', 5);
      put(d, 0, 'Solemn Simulacrum', 'graveyard');
    });
    const golem = byName(game(), 0, 'Solemn Simulacrum', 'graveyard')!;
    expect(buildView().glow.get(golem.id)).toBe('play');
    playHandCard(golem);
    const a = buildView().announce!;
    expect(a.costs.map((c) => c.label)).toEqual(['Muldrotha, the Gravetide as an artifact: {4}', 'Muldrotha, the Gravetide as a creature: {4}']);
    expect(a.choices.slot).toBe('Artifact');
    setChoices({ permit: a.costs[1].permit, slot: a.costs[1].slot });
    expect(buildView().announce!.choices.slot).toBe('Creature');
    press(); // Continue
    expect(buildView().prompt).toContain('Pay {4}');
    press();
    expect(byName(game(), 0, 'Solemn Simulacrum')).toBeDefined();
    // The creature is spent for the turn: a creature card in the graveyard no longer glows.
    useStore.setState({ game: produce(game(), (d) => void put(d, 0, 'Elite Vanguard', 'graveyard')) });
    expect(buildView().glow.get(byName(game(), 0, 'Elite Vanguard', 'graveyard')!.id)).toBeUndefined();
  });
});

describe('tapping permanents for a cost, and proliferating, in the UI', () => {
  it('picks exactly three untapped Elves for High Perfect Morcant, then chooses what to proliferate, players too (701.34a)', () => {
    play((d) => {
      put(d, 0, 'High Perfect Morcant').sick = true;
      put(d, 0, 'Llanowar Elves');
      put(d, 0, 'Elvish Mystic').counters = { '+1/+1': 1 };
      put(d, 0, 'Walking Corpse');
      d.players[1].counters = { poison: 2 };
    });
    const morcant = byName(game(), 0, 'High Perfect Morcant')!;
    clickPermanent(morcant);
    let v = buildView();
    expect(v.prompt).toContain('three untapped Elves you control (0 of 3 chosen)');
    // A Zombie isn't an Elf.
    expect(v.glow.get(byName(game(), 0, 'Walking Corpse')!.id)).toBeUndefined();
    clickPermanent(byName(game(), 0, 'Walking Corpse')!);
    clickPermanent(morcant);
    clickPermanent(byName(game(), 0, 'Llanowar Elves')!);
    expect(buildView().primary?.disabled).toBe(true);
    clickPermanent(byName(game(), 0, 'Elvish Mystic')!);
    v = buildView();
    expect(v.prompt).toContain('(3 of 3 chosen)');
    press(); // Tap: no mana to pay, so it goes on the stack and resolves
    expect(game().players[0].battlefield.filter((c) => c.tapped).length).toBe(3);
    const d = game().decision;
    expect(d?.type).toBe('chooseCards');
    const choice = (d as { choice: { players?: number[]; cards: string[] } }).choice;
    expect(choice.players).toEqual([1]);
    useStore.getState().act({ type: 'chooseCards', cards: choice.cards, players: [1] });
    expect(byName(game(), 0, 'Elvish Mystic')!.counters['+1/+1']).toBe(2);
    expect(game().players[1].counters?.poison).toBe(3);
  });
});

describe("a stack item's target arrows", () => {
  it('come from the stack item the pointer is on, or else the top of the stack', () => {
    play((d) => {
      d.stack.push({ id: 's1', kind: 'spell', controller: 1, card: makeCard(d, 'Shock', 1, 'hand'), targets: [{ kind: 'player', id: 0 }] });
      d.stack.push({ id: 's2', kind: 'spell', controller: 2, card: makeCard(d, 'Shock', 2, 'hand'), targets: [{ kind: 'player', id: 1 }] });
    });
    expect(arrowsFrom(game(), null)).toBe('s2');
    expect(arrowsFrom(game(), 's1')).toBe('s1');
    // Something no longer on the stack: the top again.
    expect(arrowsFrom(game(), 'gone')).toBe('s2');
    play(() => {});
    expect(arrowsFrom(game(), null)).toBe(null);
  });

  it('start on the side of the card that faces the target', () => {
    const box = { left: 0, top: 0, width: 100, height: 140 };
    expect(edgeToward(box, 300, 70)).toEqual({ x: 100, y: 70 });
    expect(edgeToward(box, 50, -500)).toEqual({ x: 50, y: 0 });
    expect(edgeToward(box, 50 - 200, 70 + 200)).toEqual({ x: 0, y: 120 });
    // A target inside the card: from where it is.
    expect(edgeToward(box, 60, 80)).toEqual({ x: 60, y: 80 });
  });

  it("loop out of the stack's left side to a spell on the stack, into the part of it that shows", () => {
    // A counterspell (top) 40 px below the spell it targets, which shows 40 px of itself.
    const d = stackLoop({ left: 100, top: 140, width: 100, height: 140 }, { left: 100, top: 100, width: 100 }, 40);
    const [x1, y1, c1x, c1y, c2x, c2y, x2, y2] = d.match(/-?[\d.]+/g)!.map(Number);
    // From the middle of its left side to the left end of the strip, through controls out to the left.
    expect([x1, y1, x2, y2]).toEqual([100, 210, 100, 120]);
    expect(c1x).toBeLessThan(100);
    expect(c2x).toBeLessThan(100);
    expect([c1y, c2y]).toEqual([210, 120]);
  });
});
