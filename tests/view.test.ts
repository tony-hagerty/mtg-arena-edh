// The human's casting flow in the UI: announce X/kicker/cost, choose targets, choose a
// sacrifice, pay. Drives the real store and view code without rendering anything.
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import './fixtures';
import { useStore } from '../src/ui/store';
import { buildView, clickPermanent, clickPlayer, playHandCard, setChoices } from '../src/ui/view';
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
