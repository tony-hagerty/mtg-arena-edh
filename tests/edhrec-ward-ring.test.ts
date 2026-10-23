// The ward-ring group of EDHREC's most-played cards (src/cards/edhrec/ward-ring.ts and the
// parser templates they share): ward with a sacrifice cost, ward among other keywords, amass,
// the Ring tempts you, partner with, types and an ability given by a static ability, activated
// abilities costing less, protection from colours, and the clauses that could go wrong.
import { describe, expect, it } from 'vitest';
import { cardData } from '../src/cards/db';
import type { DeckDef } from '../src/cards/db';
import { deckProblems } from '../src/cards/db';
import { parseCard, scriptCards } from '../src/cards/oracle';
import { problemsOf } from '../src/cards/support';
import {
  activatedAbilities,
  activationCost,
  amass,
  applyAction,
  applyBotAction,
  botAction,
  canBlock,
  castCost,
  counterCount,
  createToken,
  has,
  hasType,
  isRingBearer,
  makeCard,
  manaAbilities,
  scriptFor,
  stats,
  subtypesOf,
  temptWithRing,
  timesTempted,
} from '../src/engine';
import type { Action, Card, Game, PlayerId, TargetRef } from '../src/engine';
import { produce } from 'immer';
import { byName, emptyGame, put, run } from './helpers';
import './fixtures';

const GROUP = [
  'Sauron, the Dark Lord',
  'Frodo, Adventurous Hobbit',
  'Sam, Loyal Attendant',
  'Ygra, Eater of All',
  'Ragost, Deft Gastronaut',
  'Valgavoth, Harrower of Souls',
  'Miirym, Sentinel Wyrm',
  'Voja, Jaws of the Conclave',
  'Ghyrson Starn, Kelermorph',
  'Animar, Soul of Elements',
];
// The ones without a hand script are read by the Oracle text parser, as a fetched card would be.
const refused = scriptCards(GROUP);

const pass = { type: 'pass' } as const;
const player = (id: PlayerId): TargetRef => ({ kind: 'player', id });
const card = (c: { id: string }): TargetRef => ({ kind: 'card', id: c.id });
const pick = (...ids: string[]): Action => ({ type: 'chooseCards', cards: ids });
/** The choice waiting now, if any. */
const asked = (g: Game) => (g.decision && 'choice' in g.decision ? (g.decision.choice as { kind: string; text?: string; cards?: string[]; then?: string; min?: number }) : null);

/** Passes priority (bots answering anything they are asked) until the stack is empty, or `stop` holds. */
function settle(g: Game, stop?: (g: Game) => boolean): Game {
  for (let i = 0; i < 200 && (g.decision || g.stack.length || g.triggers.length) && !stop?.(g); i++) g = g.decision ? applyBotAction(g, botAction(g, g.priority)) : applyAction(g, pass);
  return g;
}
/** Passes, bots acting as they like, until `stop` holds. */
function until(g: Game, stop: (g: Game) => boolean): Game {
  for (let i = 0; i < 800 && !stop(g); i++) g = g.decision ? applyBotAction(g, botAction(g, g.priority)) : applyAction(g, pass);
  return g;
}
/** Player 0 is a person, so the tests answer their choices. */
const humanGame = (setup: (g: Game) => void) =>
  emptyGame((d) => {
    d.players[0].isBot = false;
    setup(d);
  });
/** Replaces a player's library with these cards, the first on top. */
function top(g: Game, pid: PlayerId, names: string[]) {
  g.players[pid].library = names.map((n) => makeCard(g, n, pid, 'library'));
}
/** Makes it `pid`'s main phase with priority. */
const turnOf = (g: Game, pid: PlayerId) => {
  g.active = pid;
  g.priority = pid;
};

describe('the ward-ring group can be played', () => {
  it('reads or scripts every card, and the engine plays each', () => {
    expect(refused).toEqual([]);
    for (const n of GROUP) expect(problemsOf(n), n).toEqual([]);
  });
});
