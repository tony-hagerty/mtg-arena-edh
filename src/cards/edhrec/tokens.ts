// Hand scripts for EDHREC's most-played cards and commanders that the Oracle text parser
// can't read (tokens group). Each script follows the card's Oracle text clause by clause
// (docs/card-scripting.md); comments quote the clauses that need care.
//
// The others of the group (Ms. Bumbleflower, Omnath, Go-Shintai of Life's Origin, Rin and
// Seri, Aragorn, Kenrith, Magda, Marneus Calgar) are read by the parser (src/cards/oracle.ts).
import { registerScripts } from '../../engine/registry';
import {
  abilitySource,
  attachmentsOf,
  CARD_TYPES,
  createEmblem,
  creaturesOf,
  dieMany,
  discard,
  draw,
  gainLife,
  hasType,
  isAura,
  isCreature,
  isPlaneswalker,
  label,
  log,
  loseLife,
  opponentsOf,
  permanent,
  pickCards,
  pump,
  refCard,
  refPlayer,
  resolvingItem,
  sameCard,
  simultaneously,
  snapshot,
  timesResolved,
  transform,
  turnOrder,
} from '../../engine/rules';
import { threat } from '../../engine/ai';
import type { Action, Card, CardData, CardScript, Choice, Game, PlayerId, TargetSpec, ThenCtx } from '../../engine/types';
import { registerToken } from '../db';

// ---------- pieces ----------

const targetOpponent: TargetSpec = { type: 'player', who: 'opponent', label: 'target opponent' };

/** "Target opponent loses 1 life and you gain 1 life." */
function drain(g: Game, you: PlayerId, target: PlayerId | undefined) {
  if (target !== undefined) loseLife(g, target, 1);
  gainLife(g, you, 1);
}

/** The cards a pick's ids name, where they are now. */
const cardsIn = (g: Game, zone: 'hand' | 'battlefield', ids: string[]) =>
  ids.map((id) => g.players.flatMap((p) => p[zone]).find((c) => c.id === id)).filter((c): c is Card => !!c);

/** A bot sacrifices, for a card each, only creatures worth little: tokens and the like. */
const cheap = (g: Game, c: Card) => threat(g, c) <= 2.5;

/** A bot's answer to a pick of creatures to sacrifice for cards: the cheap ones, at most `max`. */
const sacrificeCheap = (g: Game, choice: Choice): Action => {
  if (choice.kind !== 'pick') return { type: 'chooseCards', cards: [] };
  const cards = choice.cards.map((id) => permanent(g, id)).filter((c): c is Card => !!c && cheap(g, c));
  return { type: 'chooseCards', cards: cards.sort((a, b) => threat(g, a) - threat(g, b)).slice(0, choice.max).map((c) => c.id) };
};

/**
 * "Each player discards a card" / "Each opponent sacrifices a permanent of their choice": each
 * of `order` in turn (APNAP order, 101.4) picks one, knowing what the others before them picked
 * (101.4b) but not seeing hidden cards (101.4a); then it all happens at once. Asks the next one
 * from `data.at`, or returns false once everyone has picked. `data.picked` collects the ids.
 */
function askNext(g: Game, data: { order: PlayerId[]; at: number; picked: string[] }, ask: (pid: PlayerId) => Card[], q: { text: string; button: string; then: string; bot: string }): boolean {
  for (let at = data.at; at < data.order.length; at++) {
    const pid = data.order[at];
    const options = g.players[pid].lost ? [] : ask(pid);
    if (!options.length) continue;
    pickCards(g, pid, options, { min: 1, max: 1, text: q.text, button: q.button, then: q.then, data: { ...data, at: at + 1, bot: q.bot } });
    return true;
  }
  return false;
}

/** A continuation's pick added to what the earlier players picked. */
const withPick = (c: ThenCtx) => ({ order: c.data.order as PlayerId[], at: c.data.at as number, picked: [...(c.data.picked as string[]), ...c.picked.map((x) => x.id)] });

// ---------- Sephiroth, Fabled SOLDIER // Sephiroth, One-Winged Angel ----------

/** The emblem Super Nova gives (114): its name keys its data and its script. */
const SEPHIROTH_EMBLEM = 'Sephiroth, One-Winged Angel Emblem';
const emblemData: CardData = {
  name: SEPHIROTH_EMBLEM,
  manaCost: '',
  cmc: 0,
  colors: [],
  colorIdentity: [],
  // An emblem has no types (114.3); the line only says what it is.
  typeLine: 'Emblem',
  oracleText: 'Whenever a creature dies, target opponent loses 1 life and you gain 1 life.',
  keywords: [],
  image: '',
  art: '',
};
registerToken(SEPHIROTH_EMBLEM, emblemData);

/**
 * "Whenever Sephiroth enters or attacks, you may sacrifice another creature. If you do, draw a
 * card." The creature is chosen as it resolves (608.2d): another one than this Sephiroth, the
 * object whose ability it is (400.7).
 */
const sacrificeAnother = (g: Game, ctx: { self: Card; you: PlayerId }) => {
  const item = resolvingItem(g);
  const options = creaturesOf(g, ctx.you).filter((c) => !(item && sameCard(c, item.card)));
  if (options.length) pickCards(g, ctx.you, options, { min: 0, max: 1, text: 'you may sacrifice another creature. If you do, draw a card', button: 'Sacrifice', then: 'sacrificeOne' });
};

const sephirothFront: CardScript = {
  onEnter: sacrificeAnother,
  onAttack: sacrificeAnother,
  // "Whenever another creature dies, target opponent loses 1 life and you gain 1 life. If this is
  // the fourth time this ability has resolved this turn, transform Sephiroth."
  onCreatureDies: {
    when: (_g, e) => !sameCard(e.dead, e.self),
    targets: [targetOpponent],
    resolve: (g, ctx) => {
      drain(g, ctx.you, refPlayer(g, ctx.targets[0])?.id);
      // Counted as it resolves (608.2), copies with it (707.10b). It transforms only if it hasn't since the ability triggered (701.27f).
      if (timesResolved(g) === 4) transform(g, abilitySource(g), resolvingItem(g)?.card);
    },
  },
  then: {
    sacrificeOne: (g, { picked, you }) => {
      const c = picked[0] && permanent(g, picked[0].id);
      if (!c || c.controller !== you || !isCreature(g, c)) return;
      dieMany(g, [c], 'is sacrificed');
      draw(g, you);
    },
  },
  botChoice: { sacrificeOne: (g, _pid, choice) => sacrificeCheap(g, choice) },
};

const sephirothBack: CardScript = {
  // "Super Nova — As this creature transforms into Sephiroth, One-Winged Angel, you get an emblem
  // with 'Whenever a creature dies, target opponent loses 1 life and you gain 1 life.'" Applied
  // while it transforms (712.20); "you" is its controller.
  asTransforms: (g, self) => void createEmblem(g, self.controller, SEPHIROTH_EMBLEM),
  // "Whenever Sephiroth attacks, you may sacrifice any number of other creatures. If you do, draw that many cards."
  onAttack: (g, ctx) => {
    const item = resolvingItem(g);
    const options = creaturesOf(g, ctx.you).filter((c) => !(item && sameCard(c, item.card)));
    if (options.length) pickCards(g, ctx.you, options, { min: 0, max: options.length, text: 'you may sacrifice any number of other creatures. If you do, draw that many cards', button: 'Sacrifice', then: 'sacrificeAny' });
  },
  then: {
    sacrificeAny: (g, { picked, you }) => {
      const cards = picked.map((x) => permanent(g, x.id)).filter((c): c is Card => !!c && c.controller === you && isCreature(g, c));
      if (!cards.length) return;
      // They are sacrificed at once, one event (701.21a); "that many" is how many were.
      dieMany(g, cards, 'is sacrificed');
      draw(g, you, cards.length);
    },
  },
  botChoice: { sacrificeAny: (g, _pid, choice) => sacrificeCheap(g, choice) },
};

/** The emblem's "Whenever a creature dies, target opponent loses 1 life and you gain 1 life" works in the command zone (114.4). */
const sephirothEmblem: CardScript = {
  onCreatureDies: { targets: [targetOpponent], resolve: (g, ctx) => drain(g, ctx.you, refPlayer(g, ctx.targets[0])?.id) },
};

// ---------- Kefka, Court Mage // Kefka, Ruler of Ruin ----------

/**
 * "Whenever Kefka enters or attacks, each player discards a card. Then you draw a card for each
 * card type among cards discarded this way." Each player picks in APNAP order (101.4), then the
 * cards are discarded at once.
 */
const kefkaDiscards = (g: Game) => {
  const data = { order: turnOrder(g, g.active), at: 0, picked: [] as string[] };
  kefkaNextDiscard(g, data);
};
const kefkaNextDiscard = (g: Game, data: { order: PlayerId[]; at: number; picked: string[] }) =>
  askNext(g, data, (pid) => g.players[pid].hand, { text: 'discard a card (each player discards a card)', button: 'Discard', then: 'kefkaDiscard', bot: 'discard' }) || kefkaDraws(g, data.picked);

function kefkaDraws(g: Game, picked: string[]): boolean {
  const item = resolvingItem(g);
  const cards = cardsIn(g, 'hand', picked);
  // The cards' types as they were discarded: in a hand, a card has its printed ones (712.8a).
  const was = cards.map((c) => snapshot(c));
  simultaneously(g, () => cards.forEach((c) => discard(g, c)));
  // Each card type among them (205.2a): an artifact creature counts two.
  const types = CARD_TYPES.filter((t) => was.some((c) => hasType(g, c, t)));
  if (item && types.length) draw(g, item.controller, types.length);
  return true;
}

const kefkaFront: CardScript = {
  onEnter: (g) => kefkaDiscards(g),
  onAttack: (g) => kefkaDiscards(g),
  // "{8}: Each opponent sacrifices a permanent of their choice. Transform Kefka. Activate only as a sorcery."
  activated: {
    cost: { mana: '{8}' },
    sorcery: true,
    text: '{8}: Each opponent sacrifices a permanent of their choice. Transform Kefka.',
    resolve: (g, ctx) => kefkaNextSacrifice(g, { order: turnOrder(g, g.active).filter((p) => p !== ctx.you), at: 0, picked: [] }),
  },
  then: {
    kefkaDiscard: (g, c) => void kefkaNextDiscard(g, withPick(c)),
    kefkaSacrifice: (g, c) => kefkaNextSacrifice(g, withPick(c)),
  },
};

/** Each opponent in APNAP order picks a permanent they control (101.4); they are sacrificed at once; then Kefka transforms. */
function kefkaNextSacrifice(g: Game, data: { order: PlayerId[]; at: number; picked: string[] }) {
  if (askNext(g, data, (pid) => g.players[pid].battlefield, { text: 'sacrifice a permanent', button: 'Sacrifice', then: 'kefkaSacrifice', bot: 'sacrifice' })) return;
  const chosen = cardsIn(g, 'battlefield', data.picked);
  if (chosen.length) dieMany(g, chosen, 'is sacrificed');
  // It transforms only if it hasn't since the ability was activated (701.27f), and only the same object (400.7).
  transform(g, abilitySource(g), resolvingItem(g)?.card);
}

const kefkaBack: CardScript = {
  // "Whenever an opponent loses life during your turn, you draw that many cards."
  onLifeLoss: {
    when: (g, e) => g.active === e.self.controller && e.player !== e.self.controller && !g.players[e.player].lost,
    resolve: (g, ctx) => draw(g, ctx.you, ctx.amount),
  },
};

// ---------- Eriette of the Charmed Apple ----------

/** "Each creature that's enchanted by an Aura you control": an Aura `you` control is attached to it. */
const enchantedByYours = (g: Game, c: Card, you: PlayerId) => attachmentsOf(g, c).some((a) => a.controller === you && isAura(g, a));

const eriette: CardScript = {
  // "Each creature that's enchanted by an Aura you control can't attack you or planeswalkers you
  // control." A restriction on declaring attackers (508.1c). A battle isn't a planeswalker.
  forbidsAttack: (g, self, attacker, defender, target) => {
    if (!enchantedByYours(g, attacker, self.controller)) return false;
    if (target === null) return defender === self.controller;
    const attacked = permanent(g, target);
    return !!attacked && attacked.controller === self.controller && isPlaneswalker(g, attacked);
  },
  // "At the beginning of your end step, each opponent loses X life and you gain X life, where X is
  // the number of Auras you control." X is counted as it resolves.
  onEndStep: {
    when: (_g, e) => e.player === e.self.controller,
    resolve: (g, ctx) => {
      const x = g.players[ctx.you].battlefield.filter((c) => isAura(g, c)).length;
      if (!x) return;
      // Each opponent loses it at once (one event, 101.4).
      simultaneously(g, () => opponentsOf(g, ctx.you).forEach((o) => loseLife(g, o.id, x)));
      gainLife(g, ctx.you, x);
    },
  },
};

// ---------- Chatterfang, Squirrel General ----------

/** "1/1 green Squirrel creature tokens", keyed as the parser keys the tokens it reads (111.4). */
const SQUIRREL = 'Squirrel 1/1 G';
registerToken(SQUIRREL, {
  name: 'Squirrel',
  manaCost: '',
  cmc: 0,
  colors: ['G'],
  colorIdentity: ['G'],
  typeLine: 'Token Creature — Squirrel',
  oracleText: '',
  power: '1',
  toughness: '1',
  keywords: [],
  image: '',
  art: '',
});

const chatterfang: CardScript = {
  // "If one or more tokens would be created under your control, those tokens plus that many 1/1
  // green Squirrel creature tokens are created instead." A replacement effect (614.1a) on the
  // whole event, tokens a replacement effect adds included (614.16); once only (614.5). With
  // others, the player the tokens are created for chooses the order (616.1).
  replaces: (_g, self, ev) => {
    if (ev.kind !== 'tokens' || ev.player !== self.controller) return null;
    const n = ev.tokens.reduce((sum, t) => sum + t.count, 0);
    return n > 0 ? { instead: { ...ev, tokens: [...ev.tokens, { key: SQUIRREL, count: n, copy: null }] } } : null;
  },
  // "{B}, Sacrifice X Squirrels: Target creature gets +X/-X until end of turn." X is announced as it
  // is activated (107.3a, 601.2b via 602.2b), and that many Squirrels are sacrificed for it.
  activated: {
    cost: { mana: '{B}', sacrificeOne: { type: 'permanent', who: 'you', label: 'a Squirrel', filter: (g, c) => hasType(g, c, 'Squirrel') }, sacrificeCount: 'x' },
    targets: [{ type: 'creature', label: 'target creature' }],
    text: '{B}, Sacrifice X Squirrels: Target creature gets +X/-X until end of turn.',
    resolve: (g, ctx) => {
      const c = refCard(g, ctx.targets[0]);
      const x = ctx.x ?? 0;
      if (!c) return;
      pump(g, c, x, -x);
      log(g, `${label(c)} gets +${x}/-${x} until end of turn.`, ctx.you, [c]);
    },
  },
};

registerScripts({
  'Sephiroth, Fabled SOLDIER': sephirothFront,
  'Sephiroth, One-Winged Angel': sephirothBack,
  [SEPHIROTH_EMBLEM]: sephirothEmblem,
  'Kefka, Court Mage': kefkaFront,
  'Kefka, Ruler of Ruin': kefkaBack,
  'Eriette of the Charmed Apple': eriette,
  'Chatterfang, Squirrel General': chatterfang,
});
