// The human's casting flow in the UI: announce X/kicker/cost, choose targets, choose a
// sacrifice, pay. Drives the real store and view code without rendering anything.
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import './fixtures';
import { useStore } from '../src/ui/store';
import { buildView, clickPermanent, clickPlayer, clickStackItem, pickMode, playHandCard, setChoices } from '../src/ui/view';
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
