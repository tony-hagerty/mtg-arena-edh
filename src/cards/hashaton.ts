// Card behaviour for the Hashaton deck. Each script follows the card's Oracle text clause by
// clause (docs/card-scripting.md); comments quote the clauses that need care.
import { registerScripts } from '../engine/registry';
import {
  abilitySource,
  addCounters,
  CANT_BE_BLOCKED,
  ask,
  chooseToDiscard,
  chooseToSacrifice,
  connive,
  copyOf,
  copySpell,
  counter,
  createToken,
  creaturesOf,
  cycling,
  destroyMany,
  destroy,
  dieMany,
  discard,
  draw,
  enterBattlefield,
  enterTogether,
  exile,
  gainLife,
  hasType,
  impending,
  isCreature,
  isLand,
  isPlaneswalker,
  label,
  log,
  loseLife,
  manaValue,
  mill,
  moveCard,
  opponentsOf,
  permanent,
  pickCards,
  populate,
  prowess,
  pump,
  refCard,
  refGraveyard,
  refPlayer,
  refStack,
  sameCard,
  says,
  simultaneously,
  stats,
  subtypesOf,
  their,
  turnOrder,
  typecycling,
  untilEndOfTurn,
  becomeCopy,
  bounce,
  addEffect,
  addLasting,
  copyItem,
  finishEnter,
  landColors,
  nameCard,
  protectionFromType,
  firstDrawInDrawStep,
  transform,
  monstrosity,
  madness,
  miracle,
  hasSuspend,
  offerCast,
  rand,
  ENTERING_HOOKS,
} from '../engine/rules';
import type { Card, CardScript, Game, Mode, PlayerId, TargetRef, TargetSpec, TokenSpec } from '../engine/types';
import { cardData } from './db';
import { exileTop } from './kraum-tymna';
import { payThreeLand } from './ketramose';
import { damageEachOpponent, isOpponent } from './yshtola';

// ---------- pieces ----------

/** The permanent `ref` still is, if it hasn't left the battlefield since (400.7). */
const still = (g: Game, ref: { id: string; moves: number }) => {
  const c = permanent(g, ref.id);
  return sameCard(c, ref) ? c : undefined;
};

/** "Creature tokens" about to be created: a creature as the effect creating them describes them (a copy as what it copies). */
const isCreatureToken = (t: TokenSpec) => {
  const d = cardData(t.copy?.name ?? t.key);
  return (d.faces?.[t.copy?.face ?? 0]?.typeLine ?? d.typeLine).includes('Creature');
};

const isInstantOrSorcery = (g: Game, c: Card) => hasType(g, c, 'Instant') || hasType(g, c, 'Sorcery');
const artifactInstantOrSorcery = (g: Game, c: Card) => hasType(g, c, 'Artifact') || isInstantOrSorcery(g, c);

/** "Target creature card in your graveyard." */
const creatureCardInYourGraveyard = (label = 'target creature card in your graveyard'): TargetSpec => ({
  type: 'graveyard card',
  who: 'you',
  label,
  filter: (g, c) => hasType(g, c, 'Creature'),
});

/** "Draw a card, then discard a card." The player chooses the card as the effect resolves. */
function loot(g: Game, pid: PlayerId) {
  draw(g, pid);
  chooseToDiscard(g, pid, 1);
}

/** Asks `pid` to sacrifice one of `options`; the script's continuation `then` sacrifices it and goes on. */
const pickToSacrifice = (g: Game, pid: PlayerId, options: Card[], text: string, then: string, data: Record<string, unknown> = {}) =>
  pickCards(g, pid, options, { min: 1, max: 1, text, button: 'Sacrifice', then, data: { ...data, bot: 'sacrifice' } });

/** Asks `pid` to discard `n` cards; the script's continuation `then` discards them and goes on. False if their hand is empty. */
function pickToDiscard(g: Game, pid: PlayerId, n: number, then: string, data: Record<string, unknown> = {}): boolean {
  const hand = g.players[pid].hand;
  if (!hand.length) return false;
  const count = Math.min(n, hand.length);
  pickCards(g, pid, hand, { min: count, max: count, text: `discard ${count === 1 ? 'a card' : `${count} cards`}`, button: 'Discard', then, data: { ...data, bot: 'discard' } });
  return true;
}

/** The creatures attacking now. */
const attackers = (g: Game) => (g.combat?.attacks ?? []).map((a) => permanent(g, a.id)).filter((c): c is Card => !!c);

/**
 * Puts permanent or card `c` into its owner's library third from the top (Riptide Gearhulk):
 * on the bottom if the library has fewer than two cards.
 */
function putThirdFromTop(g: Game, c: Card) {
  moveCard(g, c, 'library');
  const lib = g.players[c.owner].library;
  const i = lib.findIndex((x) => x.id === c.id);
  if (i < 0) return;
  const [card] = lib.splice(i, 1);
  lib.splice(Math.min(2, lib.length), 0, card);
}

// ---------- Archon of Cruelty ----------

/**
 * "Target opponent sacrifices a creature or planeswalker of their choice, discards a card, and
 * loses 3 life. You draw a card and gain 3 life." In that order: the permanent is gone before
 * they discard, and the card before they lose life (608.2c).
 */
function archonSacrifice(g: Game, you: PlayerId, targets: (TargetRef | null)[]) {
  const opp = refPlayer(g, targets[0]);
  if (!opp) return;
  const options = opp.battlefield.filter((c) => isCreature(g, c) || isPlaneswalker(g, c));
  if (options.length) pickToSacrifice(g, opp.id, options, 'sacrifice a creature or planeswalker (Archon of Cruelty)', 'archonSac', { opp: opp.id });
  else archonDiscard(g, you, opp.id);
}
function archonDiscard(g: Game, you: PlayerId, opp: PlayerId) {
  if (!pickToDiscard(g, opp, 1, 'archonDiscard', { opp })) archonRest(g, you, opp);
}
function archonRest(g: Game, you: PlayerId, opp: PlayerId) {
  loseLife(g, opp, 3);
  draw(g, you);
  gainLife(g, you, 3);
}
const archon: Pick<CardScript, 'then'> = {
  then: {
    archonSac: (g, { you, picked, data }) => {
      const c = picked[0] && permanent(g, picked[0].id);
      if (c) dieMany(g, [c], 'is sacrificed');
      archonDiscard(g, you, data.opp as PlayerId);
    },
    archonDiscard: (g, { you, picked, data }) => {
      for (const c of picked) discard(g, c);
      archonRest(g, you, data.opp as PlayerId);
    },
  },
};

// ---------- Living Death ----------

/**
 * "Each player exiles all creature cards from their graveyard, then sacrifices all creatures
 * they control, then puts all cards they exiled this way onto the battlefield." Each step
 * happens to every player at once; only the cards exiled by the first step return, as the
 * objects they became in exile (400.7).
 */
function livingDeath(g: Game) {
  const exiled: Card[] = [];
  simultaneously(g, () => {
    for (const p of g.players.filter((x) => !x.lost)) {
      for (const c of p.graveyard.filter((x) => hasType(g, x, 'Creature'))) {
        moveCard(g, c, 'exile');
        const there = g.players[c.owner].exile.find((x) => x.id === c.id);
        if (there) exiled.push(there);
      }
    }
  });
  if (exiled.length) log(g, `Every creature card in a graveyard is exiled: ${exiled.map(label).join(', ')}.`, undefined, exiled);
  dieMany(g, g.players.filter((p) => !p.lost).flatMap((p) => creaturesOf(g, p.id)), 'is sacrificed');
  const back = exiled.filter((c) => c.zone === 'exile');
  // Each player puts the cards they exiled, which are their own, onto the battlefield.
  enterTogether(g, back.map((c) => ({ card: c, opts: { controller: c.owner } })));
}

// ---------- Victimize ----------

const victimize: Pick<CardScript, 'then'> = {
  then: {
    // "Sacrifice a creature. If you do, return the chosen cards to the battlefield tapped."
    victimize: (g, { you, picked, targets }) => {
      const c = picked[0] && permanent(g, picked[0].id);
      if (!c) return;
      dieMany(g, [c], 'is sacrificed');
      if (c.zone === 'battlefield') return;
      const cards = targets.map((t) => refGraveyard(g, t)).filter((x): x is Card => !!x);
      enterTogether(g, cards.map((card) => ({ card, opts: { tapped: true, controller: you } })));
    },
  },
};

// ---------- Monument to Endurance ----------

const MONUMENT_MODES: Mode[] = [
  { text: 'Draw a card.', resolve: (g, { you }) => draw(g, you) },
  { text: 'Create a Treasure token.', resolve: (g, { you }) => void createToken(g, you, 'Treasure') },
  {
    text: 'Each opponent loses 3 life.',
    resolve: (g, { you }) =>
      simultaneously(g, () => {
        for (const o of opponentsOf(g, you)) loseLife(g, o.id, 3);
      }),
  },
];

// ---------- Giggling Skitterspike ----------

const SKITTER = 'Whenever this creature attacks, blocks, or becomes the target of a spell, it deals damage equal to its power to each opponent.';
/** Giggling Skitterspike deals damage equal to its power to each opponent: the permanent, or as it last was. */
const skitter = (g: Game, self: Card, you: PlayerId) => {
  const c = still(g, self) ?? self;
  damageEachOpponent(g, c, you, stats(g, c).power);
};

// ---------- Hashaton ----------

/** Hashaton's token: a copy of the discarded card, "except it's a 4/4 black Zombie" (707.9b). */
const zombieCopy = (c: Card) => copyOf(c, { power: 4, toughness: 4, creatureTypes: ['Zombie'], colors: ['B'] });

registerScripts({
  // ===== Commander =====
  "Hashaton, Scarab's Fist": {
    // "Whenever you discard a creature card, you may pay {2}{U}. If you do, create a tapped token
    // that's a copy of that card, except it's a 4/4 black Zombie." The token copies the card as
    // it was discarded (its printed values, 707.2), even if it has left the graveyard since.
    onDiscard: {
      when: (g, { self, player, card }) => player === self.controller && hasType(g, card, 'Creature'),
      resolve: (g, { you, card }) =>
        ask(g, you, {
          text: `You may pay {2}{U} to create a tapped 4/4 black Zombie token that's a copy of ${label(card)}.`,
          cost: '{2}{U}',
          yes: 'Pay {2}{U}',
          no: "Don't Pay",
          then: 'zombie',
          data: { copy: zombieCopy(card), name: label(card) },
        }),
      text: "Whenever you discard a creature card, you may pay {2}{U}. If you do, create a tapped token that's a copy of that card, except it's a 4/4 black Zombie.",
    },
    then: {
      zombie: (g, { you, yes, data }) => {
        if (!yes) return;
        const copy = data.copy as ReturnType<typeof zombieCopy>;
        const [made] = createToken(g, you, copy.name, 1, { tapped: true, copy });
        if (made) log(g, `${says(g.players[you], 'creates')} a 4/4 black Zombie token copy of ${data.name}.`, you, [made]);
      },
    },
    botChoice: { zombie: () => ({ type: 'answer', yes: true }) },
  },

  // ===== Creatures =====
  'Angel of the Ruins': {
    // "When this creature enters, exile up to two target artifacts and/or enchantments."
    targets: [
      { type: 'permanent', optional: true, label: 'up to two target artifacts and/or enchantments', filter: (g, c) => hasType(g, c, 'Artifact') || hasType(g, c, 'Enchantment') },
      { type: 'permanent', optional: true, distinctFrom: 0, label: 'a second target artifact or enchantment', filter: (g, c) => hasType(g, c, 'Artifact') || hasType(g, c, 'Enchantment') },
    ],
    onEnter: (g, { targets }) => {
      simultaneously(g, () => {
        for (const t of targets) exile(g, refCard(g, t));
      });
    },
    // "Plainscycling {2}" (702.29e).
    activated: typecycling('Plains', '{2}'),
  },
  'Archfiend of Ifnir': {
    // "Whenever you cycle or discard another card, put a -1/-1 counter on each creature your
    // opponents control." Cycling is discarding, so cycling triggers it once (702.29d).
    onDiscard: {
      when: (_g, { self, player, card }) => player === self.controller && card.id !== self.id,
      resolve: (g, { you }) => {
        for (const o of opponentsOf(g, you)) for (const c of creaturesOf(g, o.id)) addCounters(g, c, 1, '-1/-1');
      },
      text: 'Whenever you cycle or discard another card, put a -1/-1 counter on each creature your opponents control.',
    },
    // "Cycling {2}" (702.29a).
    activated: cycling('{2}'),
  },
  'Archon of Cruelty': {
    // "Whenever this creature enters or attacks, target opponent sacrifices a creature or
    // planeswalker of their choice, discards a card, and loses 3 life. You draw a card and gain 3 life."
    targets: [{ type: 'player', who: 'opponent', label: 'target opponent' }],
    onEnter: (g, { you, targets }) => archonSacrifice(g, you, targets),
    onAttack: {
      targets: [{ type: 'player', who: 'opponent', label: 'target opponent' }],
      resolve: (g, { you, targets }) => archonSacrifice(g, you, targets),
      text: 'Whenever this creature attacks, target opponent sacrifices a creature or planeswalker, discards a card, and loses 3 life. You draw a card and gain 3 life.',
    },
    ...archon,
  },
  'Ashen Rider': {
    // "When this creature enters or dies, exile target permanent."
    targets: [{ type: 'permanent', label: 'target permanent' }],
    onEnter: (g, { targets }) => exile(g, refCard(g, targets[0])),
    onDies: {
      targets: [{ type: 'permanent', label: 'target permanent' }],
      resolve: (g, { targets }) => exile(g, refCard(g, targets[0])),
      text: 'When this creature dies, exile target permanent.',
    },
  },
  'Curious Colossus': {
    // "When this creature enters, each creature target opponent controls loses all abilities,
    // becomes a Coward in addition to its other types, and has base power and toughness 1/1."
    // One effect with no duration on the creatures that player controls as it resolves (611.2c),
    // applied in layers 4, 6 and 7b (613.1d, 613.1f, 613.4b).
    targets: [{ type: 'player', who: 'opponent', label: 'target opponent' }],
    onEnter: (g, { targets }) => {
      const opp = refPlayer(g, targets[0]);
      if (opp) for (const c of creaturesOf(g, opp.id)) addLasting(g, c, { loseAll: true, subtypes: ['Coward'], setPower: 1, setToughness: 1 });
    },
  },
  'Avacyn, Angel of Hope': {
    // "Other permanents you control have indestructible." Every permanent, not only creatures.
    static: (_g, self, c) => (c.id !== self.id && c.controller === self.controller ? { keywords: ['indestructible'] } : null),
  },
  'Elesh Norn, Grand Cenobite': {
    // "Other creatures you control get +2/+2." "Creatures your opponents control get -2/-2." Two abilities, two effects (613.7a).
    static: (g, self, c) => [
      c.id !== self.id && c.controller === self.controller && isCreature(g, c) ? { power: 2, toughness: 2 } : null,
      isOpponent(g, self.controller, c.controller) && isCreature(g, c) ? { power: -2, toughness: -2 } : null,
    ],
  },
  'Giggling Skitterspike': {
    // Indestructible is the engine's. "Whenever this creature attacks, blocks, or becomes the
    // target of a spell, it deals damage equal to its power to each opponent." Its power as the
    // ability resolves, or as it last was on the battlefield (608.2h). It blocks once a combat
    // however many it blocks (509.3a); an ability targeting it doesn't count.
    onAttack: { resolve: (g, ctx) => skitter(g, ctx.self, ctx.you), text: SKITTER },
    onBlock: { resolve: (g, ctx) => skitter(g, ctx.self, ctx.you), text: SKITTER },
    onBecomesTarget: {
      when: (g, { self, target, item }) => target.id === self.id && g.stack.find((x) => x.id === item)?.kind === 'spell',
      resolve: (g, ctx) => skitter(g, ctx.self, ctx.you),
      text: SKITTER,
    },
    // "{5}: Monstrosity 5." (701.37a)
    activated: monstrosity(5, '{5}'),
  },
  'Elesh Norn, Mother of Machines': {
    // Vigilance is the engine's. "If a permanent entering causes a triggered ability of a
    // permanent you control to trigger, that ability triggers an additional time." "Permanents
    // entering don't cause abilities of permanents your opponents control to trigger." Whoever
    // controls the permanent entering; it counts permanents entering with it, itself included.
    doublesTriggers: (_g, self, source, hook) => ENTERING_HOOKS.includes(hook) && source.controller === self.controller,
    suppressesTriggers: (g, self, source, hook) => ENTERING_HOOKS.includes(hook) && isOpponent(g, self.controller, source.controller),
  },
  'Kitsa, Otterball Elite': {
    onCast: prowess,
    activated: [
      // "{T}: Draw a card, then discard a card."
      { cost: { tap: true }, text: 'Draw a card, then discard a card.', resolve: (g, { you }) => loot(g, you) },
      // "{2}, {T}: Copy target instant or sorcery spell you control. You may choose new targets
      // for the copy. Activate only if Kitsa's power is 3 or greater."
      {
        cost: { mana: '{2}', tap: true },
        when: (g, self) => stats(g, self).power >= 3,
        targets: [{ type: 'spell', who: 'you', label: 'target instant or sorcery spell you control', filter: (g, c) => isInstantOrSorcery(g, c) }],
        text: 'Copy target instant or sorcery spell you control. You may choose new targets for the copy.',
        resolve: (g, { you, targets }) => copySpell(g, targets[0], you),
      },
    ],
  },
  'Ledger Shredder': {
    // "Whenever a player casts their second spell each turn, this creature connives." It connives
    // even if it has left the battlefield, as it last was (701.50b).
    onCast: {
      when: (g, { caster }) => g.players[caster].spellsCast === 2,
      resolve: (g, { self }) => connive(g, still(g, self) ?? self),
      text: 'Whenever a player casts their second spell each turn, this creature connives.',
    },
  },
  'Likeness Looter': {
    activated: [
      // "{T}: Draw a card, then discard a card."
      { cost: { tap: true }, text: 'Draw a card, then discard a card', resolve: (g, { you }) => loot(g, you) },
      // "{X}: This creature becomes a copy of target creature card in your graveyard with mana
      // value X, except it has flying and this ability. Activate only as a sorcery." The
      // exceptions are part of what it copies (707.9a), so a copy of it has them too.
      {
        cost: { mana: '{X}' },
        sorcery: true,
        targets: [
          {
            type: 'graveyard card',
            who: 'you',
            label: 'target creature card in your graveyard with mana value X',
            filter: (g, c, _self, x) => !c.isToken && hasType(g, c, 'Creature') && manaValue(c) === x,
          },
        ],
        text: 'Become a copy of a creature card in your graveyard with mana value X',
        resolve: (g, { targets }) => {
          // "This creature": the permanent the ability came from, if it is still the same object (400.7).
          const it = abilitySource(g);
          const card = refGraveyard(g, targets[0]);
          if (!it || !card) return;
          becomeCopy(g, it, copyOf(card, { keywords: ['Flying'], activated: [{ from: 'Likeness Looter', index: 1 }] }));
        },
      },
    ],
  },
  'Looter il-Kor': {
    // "Whenever this creature deals damage to an opponent, draw a card, then discard a card." Shadow is the engine's (702.28).
    onDamage: {
      when: (g, { self, source, player }) => sameCard(source, self) && isOpponent(g, self.controller, player),
      resolve: (g, { you }) => loot(g, you),
      text: 'Whenever this creature deals damage to an opponent, draw a card, then discard a card.',
    },
  },
  'Metamorphosis Fanatic': {
    // Lifelink is the engine's. "When this creature enters, return up to one target creature
    // card from your graveyard to the battlefield with a lifelink counter on it." It enters with
    // the counter (122.6).
    targets: [{ ...creatureCardInYourGraveyard('up to one target creature card from your graveyard'), optional: true }],
    onEnter: (g, { you, targets }) => {
      const c = refGraveyard(g, targets[0]);
      if (c) enterBattlefield(g, c, { controller: you, counters: { lifelink: 1 } });
    },
    // "Miracle {1}{B}" (702.94a)
    alternativeCosts: [miracle('{1}{B}')],
  },
  'Mondrak, Glory Dominus': {
    // "If one or more tokens would be created under your control, twice that many of those
    // tokens are created instead." (614.1a) Whatever the effect says about them, like
    // "tapped", is true of the extra ones too.
    replaces: (_g, self, ev) => (ev.kind === 'tokens' && ev.player === self.controller ? { instead: { ...ev, tokens: ev.tokens.map((t) => ({ ...t, count: t.count * 2 })) } } : null),
    // "{1}{W/P}{W/P}, Sacrifice two other artifacts and/or creatures: Put an indestructible
    // counter on Mondrak." (107.4f, 122.1b)
    activated: {
      cost: { mana: '{1}{W/P}{W/P}', sacrificeOne: { type: 'permanent', who: 'you', label: 'two other artifacts and/or creatures', filter: (g, c, self) => c.id !== self.id && (hasType(g, c, 'Artifact') || isCreature(g, c)) }, sacrificeCount: 2 },
      text: 'Put an indestructible counter on Mondrak.',
      resolve: (g, { self }) => {
        const me = still(g, self);
        if (me) addCounters(g, me, 1, 'indestructible');
      },
    },
  },
  'Moonshaker Cavalry': {
    // "When this creature enters, creatures you control gain flying and get +X/+X until end of
    // turn, where X is the number of creatures you control." X and the creatures are fixed as it resolves (611.2c).
    onEnter: (g, { you }) => {
      const mine = creaturesOf(g, you);
      for (const c of mine) pump(g, c, mine.length, mine.length, ['flying']);
    },
  },
  'Nesting Dovehawk': {
    // "At the beginning of combat on your turn, populate."
    onBeginCombat: {
      when: (_g, { self, player }) => player === self.controller,
      resolve: (g, { you }) => void populate(g, you),
      text: 'At the beginning of combat on your turn, populate.',
    },
    // "Whenever a creature token you control enters, put a +1/+1 counter on this creature."
    onCreatureEnters: {
      when: (_g, { self, entered }) => entered.isToken && entered.controller === self.controller,
      resolve: (g, { self }) => addCounters(g, still(g, self)),
      text: 'Whenever a creature token you control enters, put a +1/+1 counter on this creature.',
    },
  },
  'Notion Thief': {
    // Flash is the engine's. "If an opponent would draw a card except the first one they draw
    // in each of their draw steps, instead that player skips that draw and you draw a card." (614.11)
    replaces: (g, self, ev) =>
      ev.kind === 'draw' && isOpponent(g, self.controller, ev.player) && !ev.firstInDrawStep
        ? { instead: { kind: 'draw', player: self.controller, firstInDrawStep: firstDrawInDrawStep(g, self.controller) } }
        : null,
  },
  'Ob Nixilis, the Ascended': {
    // "When Ob Nixilis enters, destroy all tapped creatures your opponents control. You gain 1
    // life for each creature destroyed this way." Only those that went to the graveyard were destroyed.
    onEnter: (g, { you }) => {
      const tapped = opponentsOf(g, you).flatMap((o) => creaturesOf(g, o.id).filter((c) => c.tapped));
      destroyMany(g, tapped);
      gainLife(g, you, tapped.filter((c) => c.zone === 'graveyard').length);
    },
    // "At the beginning of each end step, if you gained life this turn, create a 4/4 white Angel
    // creature token with flying." An intervening "if" (603.4): checked again as it resolves.
    onEndStep: {
      when: (g, { self }) => (g.players[self.controller].lifeGained ?? 0) > 0,
      resolve: (g, { you }) => {
        if ((g.players[you].lifeGained ?? 0) > 0) createToken(g, you, 'Angel 4/4 flying');
      },
      text: 'At the beginning of each end step, if you gained life this turn, create a 4/4 white Angel creature token with flying.',
    },
  },
  'Ojer Taq, Deepest Foundation': {
    // "If one or more creature tokens would be created under your control, three times that
    // many of those tokens are created instead." Creature tokens as the effect creating them
    // describes them, a copy's by what it copies.
    replaces: (_g, self, ev) =>
      ev.kind === 'tokens' && ev.player === self.controller && ev.tokens.some(isCreatureToken)
        ? { instead: { ...ev, tokens: ev.tokens.map((t) => (isCreatureToken(t) ? { ...t, count: t.count * 3 } : t)) } }
        : null,
    // "When Ojer Taq dies, return it to the battlefield tapped and transformed under its
    // owner's control." A card that isn't a transforming double-faced card, like a Clone
    // copying it, stays in the graveyard (712.14a); a token ceases to exist (111.7).
    onDies: {
      resolve: (g, { self }) => {
        const card = g.players[self.owner].graveyard.find((x) => x.id === self.id && x.moves === self.moves + 1);
        if (card && cardData(card.name).layout === 'transform') enterBattlefield(g, card, { controller: card.owner, face: 1, tapped: true });
      },
      text: "When Ojer Taq dies, return it to the battlefield tapped and transformed under its owner's control.",
    },
  },
  'Temple of Civilization': {
    // "{T}: Add {W}." "{2}{W}, {T}: Transform this land. Activate only if you attacked with
    // three or more creatures this turn and only as a sorcery."
    mana: { amount: 1, colors: ['W'] },
    activated: {
      cost: { mana: '{2}{W}', tap: true },
      sorcery: true,
      when: (g, self) => (g.players[self.controller].attackedWith ?? []).length >= 3,
      text: 'Transform this land.',
      resolve: (g, { self }) => transform(g, permanent(g, self.id), self),
    },
  },
  'Overlord of the Balemurk': {
    // "Impending 5—{1}{B}" (702.176a).
    ...impending(5, '{1}{B}'),
    // "Whenever this permanent enters or attacks, mill four cards, then you may return a
    // non-Avatar creature card or a planeswalker card from your graveyard to your hand." Any
    // such card, not only one milled now.
    onEnter: (g, { you }) => balemurk(g, you),
    onAttack: { resolve: (g, { you }) => balemurk(g, you), text: 'Whenever this permanent attacks, mill four cards, then you may return a non-Avatar creature card or a planeswalker card from your graveyard to your hand.' },
    then: {
      balemurk: (g, { you, picked }) => {
        const c = picked[0] && g.players[you].graveyard.find((x) => x.id === picked[0].id);
        if (!c) return;
        moveCard(g, c, 'hand');
        log(g, `${says(g.players[you], 'returns')} ${label(c)} to ${their(g.players[you])} hand.`, you, [c]);
      },
    },
  },
  'Overlord of the Floodpits': {
    // "Impending 4—{1}{U}{U}" (702.176a).
    ...impending(4, '{1}{U}{U}'),
    // "Whenever this permanent enters or attacks, draw two cards, then discard a card."
    onEnter: (g, { you }) => {
      draw(g, you, 2);
      chooseToDiscard(g, you, 1);
    },
    onAttack: {
      resolve: (g, { you }) => {
        draw(g, you, 2);
        chooseToDiscard(g, you, 1);
      },
      text: 'Whenever this permanent attacks, draw two cards, then discard a card.',
    },
  },
  'Psychic Frog': {
    // "Whenever this creature deals combat damage to a player or planeswalker, draw a card." Once
    // for each combat damage event, however many it damaged then.
    onSourceDamage: {
      when: (g, { self, source, dealt, combat }) => combat && sameCard(source, self) && dealt.some((d) => d.amount > 0 && (d.player !== null || (d.card && isPlaneswalker(g, d.card)))),
      resolve: (g, { you }) => draw(g, you),
      text: 'Whenever this creature deals combat damage to a player or planeswalker, draw a card.',
    },
    activated: [
      // "Discard a card: Put a +1/+1 counter on this creature."
      { cost: { discard: 1 }, text: 'Put a +1/+1 counter on this creature.', resolve: (g) => addCounters(g, abilitySource(g)) },
      // "Exile three cards from your graveyard: This creature gains flying until end of turn."
      { cost: { exileGraveyard: 3 }, text: 'This creature gains flying until end of turn.', resolve: (g) => untilEndOfTurn(g, abilitySource(g), { keywords: ['flying'] }) },
    ],
  },
  'Raffine, Scheming Seer': {
    ward: { mana: '{1}' },
    // "Whenever you attack, target attacking creature connives X, where X is the number of
    // attacking creatures." X is counted as it resolves.
    onAttackersDeclared: {
      when: (_g, { self, player }) => player === self.controller,
      targets: [{ type: 'creature', label: 'target attacking creature', filter: (g, c) => !!g.combat?.attacks.some((a) => a.id === c.id) }],
      resolve: (g, { targets }) => {
        const c = refCard(g, targets[0]);
        if (c) connive(g, c, attackers(g).length);
      },
      text: 'Whenever you attack, target attacking creature connives X, where X is the number of attacking creatures.',
    },
  },
  'Riptide Gearhulk': {
    onCast: prowess,
    // "When this creature enters, for each opponent, put up to one target nonland permanent that
    // player controls into its owner's library third from the top." One target for each opponent,
    // in turn order from you.
    targets: [0, 1, 2].map(
      (i): TargetSpec => ({
        type: 'permanent',
        optional: true,
        label: `up to one target nonland permanent your ${['next', 'second', 'third'][i]} opponent in turn order controls`,
        filter: (g, c, source) => !isLand(g, c) && turnOrder(g, source.controller).filter((p) => p !== source.controller)[i] === c.controller,
      }),
    ),
    onEnter: (g, { targets }) => {
      for (const t of targets) {
        const c = refCard(g, t);
        if (!c) continue;
        log(g, `${label(c)} is put into its owner's library third from the top.`, c.owner, [c]);
        putThirdFromTop(g, c);
      }
    },
  },
  'Rona, Herald of Invasion': {
    // "Whenever you cast a legendary spell, untap Rona."
    onCast: {
      when: (g, { self, card, caster }) => caster === self.controller && hasType(g, card, 'Legendary'),
      resolve: (g, { self }) => {
        const me = still(g, self);
        if (me) me.tapped = false;
      },
      text: 'Whenever you cast a legendary spell, untap Rona.',
    },
    activated: [
      // "{T}: Draw a card, then discard a card."
      { cost: { tap: true }, text: 'Draw a card, then discard a card.', resolve: (g, { you }) => loot(g, you) },
      // "{5}{B/P}: Transform Rona. Activate only as a sorcery." Only if it hasn't transformed since (701.27f).
      { cost: { mana: '{5}{B/P}' }, sorcery: true, text: 'Transform Rona.', resolve: (g, { self }) => transform(g, permanent(g, self.id), self) },
    ],
  },
  'Rona, Tolarian Obliterator': {
    // Trample is the engine's. "Whenever a source deals damage to Rona, that source's controller
    // exiles a card from their hand at random. If it's a land card, you may put it onto the
    // battlefield under your control. Otherwise, you may cast it without paying its mana cost."
    // The source's controller as it dealt the damage; the spell is cast as this resolves (608.2g).
    onDamage: {
      when: (_g, { self, card }) => card?.id === self.id,
      resolve: (g, { you, source }) => {
        const hand = g.players[source.controller].hand;
        if (g.players[source.controller].lost || !hand.length) return;
        const c = hand[Math.floor(rand(g) * hand.length)];
        log(g, `${says(g.players[source.controller], 'exiles')} ${label(c)} from ${their(g.players[source.controller])} hand at random.`, source.controller, [c]);
        moveCard(g, c, 'exile');
        if (c.zone !== 'exile') return;
        if (isLand(g, c)) ask(g, you, { text: `Put ${label(c)} onto the battlefield under your control?`, yes: 'Put It Onto the Battlefield', no: "Don't", then: 'ronaLand', data: { id: c.id, moves: c.moves } });
        else offerCast(g, you, c, { free: true, text: `You may cast ${label(c)} without paying its mana cost.` });
      },
      text: "Whenever a source deals damage to Rona, that source's controller exiles a card from their hand at random. If it's a land card, you may put it onto the battlefield under your control. Otherwise, you may cast it without paying its mana cost.",
    },
    then: {
      ronaLand: (g, { you, yes, data: d }) => {
        const c = g.players.flatMap((p) => p.exile).find((x) => x.id === d.id && x.moves === d.moves);
        if (yes && c) enterBattlefield(g, c, { controller: you });
      },
    },
  },
  "Serra's Emissary": {
    // "As this creature enters, choose a card type." A replacement effect (614.12a): the
    // choice is made before it is on the battlefield, so nothing can respond in between.
    replaceEnter: (g, c, controller) => {
      nameCard(g, controller, { text: 'Choose a card type.', of: 'card type', then: 'type', script: c.id });
      return true;
    },
    then: { type: (g, { self, name, data }) => finishEnter(g, self, data, { chosen: name }) },
    // "You and creatures you control have protection from the chosen card type." (702.16a, 702.16j)
    static: (g, self, c) => (self.chosen && c.controller === self.controller && isCreature(g, c) ? { keywords: [protectionFromType(self.chosen)] } : null),
    protectsPlayer: (g, self, pid, source) => !!self.chosen && pid === self.controller && hasType(g, source, self.chosen),
    botChoice: { type: () => ({ type: 'name', name: 'Creature' }) },
  },
  'Shadowgrange Archfiend': {
    // "When this creature enters, each opponent sacrifices a creature with the greatest power
    // among creatures they control. You gain life equal to the greatest power among creatures
    // sacrificed this way." Each chooses in turn order, then they are sacrificed at once (101.4,
    // 701.21a); the powers are as they last were.
    onEnter: (g, { you }) => shadowgrange(g, you, turnOrder(g, you).filter((o) => isOpponent(g, you, o)), 0, []),
    then: { shadowgrange: (g, { you, picked, data: d }) => shadowgrange(g, you, d.order as PlayerId[], (d.i as number) + 1, [...(d.chosen as string[]), ...picked.map((c) => c.id)]) },
    // "Madness—{2}{B}, Pay 8 life." (702.35a)
    alternativeCosts: [madness('{2}{B}', 8)],
  },
  "Sheoldred, Whispering One": {
    // Swampwalk is the engine's (702.14c).
    onUpkeep: [
      // "At the beginning of your upkeep, return target creature card from your graveyard to the battlefield."
      {
        when: (_g, { self, player }) => player === self.controller,
        targets: [creatureCardInYourGraveyard()],
        resolve: (g, { you, targets }) => {
          const c = refGraveyard(g, targets[0]);
          if (c) enterBattlefield(g, c, { controller: you });
        },
        text: 'At the beginning of your upkeep, return target creature card from your graveyard to the battlefield.',
      },
      // "At the beginning of each opponent's upkeep, that player sacrifices a creature of their choice."
      {
        when: (g, { self, player }) => isOpponent(g, self.controller, player),
        resolve: (g, { self, player }) => chooseToSacrifice(g, player, { type: 'creature', label: 'a creature' }, self),
        text: "At the beginning of each opponent's upkeep, that player sacrifices a creature of their choice.",
      },
    ],
  },
  'Shoreline Looter': {
    // "This creature can't be blocked."
    static: (_g, self, c) => (c.id === self.id ? { keywords: [CANT_BE_BLOCKED] } : null),
    // "Threshold — Whenever this creature deals combat damage to a player, draw a card. Then
    // discard a card unless there are seven or more cards in your graveyard." Counted after the draw.
    onCombatDamageToPlayer: (g, { you }) => {
      draw(g, you);
      if (g.players[you].graveyard.length < 7) chooseToDiscard(g, you, 1);
    },
  },
  'Sire of Stagnation': {
    // "Whenever a land an opponent controls enters, that player exiles the top two cards of their library and you draw two cards." Devoid is the engine's.
    onLandfall: {
      when: (g, { self, land }) => isOpponent(g, self.controller, land.controller),
      resolve: (g, { you, land }) => {
        exileTop(g, land.controller, 2);
        draw(g, you, 2);
      },
      text: 'Whenever a land an opponent controls enters, that player exiles the top two cards of their library and you draw two cards.',
    },
  },
  'Sister Hospitaller': {
    // "Medicus Ministorum — When this creature enters, return target creature card from your
    // graveyard to the battlefield. You gain life equal to its mana value." Its mana value as it
    // last was in the graveyard.
    targets: [creatureCardInYourGraveyard()],
    onEnter: (g, { you, targets }) => {
      const c = refGraveyard(g, targets[0]);
      if (!c) return;
      const mv = manaValue(c);
      enterBattlefield(g, c, { controller: you });
      gainLife(g, you, mv);
    },
  },

  'Sphinx of the Second Sun': {
    // Flying is the engine's. "At the beginning of each of your postcombat main phases, there is
    // an additional beginning phase after this phase." Its untap, upkeep and draw steps, then the
    // ending phase (500.8).
    onPostcombatMain: {
      when: (_g, { self, player }) => player === self.controller,
      resolve: (g) => {
        g.extraBeginnings = (g.extraBeginnings ?? 0) + 1;
      },
      text: 'At the beginning of each of your postcombat main phases, there is an additional beginning phase after this phase.',
    },
  },
  'Vohar, Vodalian Desecrator': {
    activated: [
      // "{T}: Draw a card, then discard a card. If you discarded an instant or sorcery card this
      // way, each opponent loses 1 life and you gain 1 life."
      {
        cost: { tap: true },
        text: 'Draw a card, then discard a card. If you discarded an instant or sorcery card this way, each opponent loses 1 life and you gain 1 life.',
        resolve: (g, { you }) => {
          draw(g, you);
          pickToDiscard(g, you, 1, 'vohar');
        },
      },
      // "{2}, Sacrifice Vohar: You may cast target instant or sorcery card from your graveyard
      // this turn. If that spell would be put into your graveyard, exile it instead. Activate
      // only as a sorcery." Casting it follows the usual timing and costs.
      {
        cost: { mana: '{2}', sacrifice: true },
        sorcery: true,
        targets: [{ type: 'graveyard card', who: 'you', label: 'target instant or sorcery card in your graveyard', filter: (g, c) => isInstantOrSorcery(g, c) }],
        text: 'You may cast target instant or sorcery card from your graveyard this turn. If that spell would be put into your graveyard, exile it instead.',
        resolve: (g, { you, targets }) => {
          const c = refGraveyard(g, targets[0]);
          if (c) addEffect(g, { kind: 'mayCast', player: you, card: c.id, moves: c.moves, graveyardToExile: true });
        },
      },
    ],
    then: {
      vohar: (g, { you, picked }) => {
        const c = picked[0] && g.players[you].hand.find((x) => x.id === picked[0].id);
        if (!c) return;
        const spell = isInstantOrSorcery(g, c);
        discard(g, c);
        if (!spell) return;
        simultaneously(g, () => {
          for (const o of opponentsOf(g, you)) loseLife(g, o.id, 1);
        });
        gainLife(g, you, 1);
      },
    },
  },
  'Hostage Taker': {
    // "When this creature enters, exile another target creature or artifact until this creature
    // leaves the battlefield. You may cast that card for as long as it remains exiled, and mana
    // of any type can be spent to cast that spell." If it has already left, nothing is exiled
    // (610.3b); when it leaves, the card returns under its owner's control (610.3c). A token
    // exiled ceases to exist (111.7). The spell cast is a new object, so it stays (400.7).
    targets: [{ type: 'permanent', label: 'another target creature or artifact', filter: (g, c, self) => c.id !== self.id && (isCreature(g, c) || hasType(g, c, 'Artifact')) }],
    onEnter: (g, { self, you, targets }) => {
      const me = still(g, self);
      const c = refCard(g, targets[0]);
      if (!me || !c) return;
      exile(g, c);
      if (c.zone !== 'exile' || c.isToken) return;
      me.holds = [...(me.holds ?? []), { id: c.id, moves: c.moves }];
      addEffect(g, { kind: 'mayCast', player: you, card: c.id, moves: c.moves, anyMana: true, lasting: true });
    },
  },
  'Jin-Gitaxias, Progress Tyrant': {
    onCast: [
      // "Whenever you cast an artifact, instant, or sorcery spell, copy that spell. You may choose
      // new targets for the copy. This ability triggers only once each turn." The copy is made
      // even if the spell has left the stack, as it last was (707.10); a copy of an artifact
      // spell becomes a token (707.10f).
      {
        when: (g, { self, card, caster }) => {
          if (caster !== self.controller || !artifactInstantOrSorcery(g, card) || self.once.jinCopy === g.turn) return false;
          self.once.jinCopy = g.turn;
          return true;
        },
        resolve: (g, { you, item }) => copyItem(g, g.stack.find((x) => x.id === item.id) ?? item, you),
        text: 'Whenever you cast an artifact, instant, or sorcery spell, copy that spell. You may choose new targets for the copy. This ability triggers only once each turn.',
      },
      // "Whenever an opponent casts an artifact, instant, or sorcery spell, counter that spell.
      // This ability triggers only once each turn." Once a turn, not once for each opponent.
      {
        when: (g, { self, card, caster }) => {
          if (!isOpponent(g, self.controller, caster) || !artifactInstantOrSorcery(g, card) || self.once.jinCounter === g.turn) return false;
          self.once.jinCounter = g.turn;
          return true;
        },
        resolve: (g, { item }) => void counter(g, { kind: 'stack', id: item.id }),
        text: 'Whenever an opponent casts an artifact, instant, or sorcery spell, counter that spell. This ability triggers only once each turn.',
      },
    ],
  },
  'Jin-Gitaxias, Core Augur': {
    // "At the beginning of your end step, draw seven cards."
    onEndStep: {
      when: (_g, { self, player }) => player === self.controller,
      resolve: (g, { you }) => draw(g, you, 7),
      text: 'At the beginning of your end step, draw seven cards.',
    },
    // "Each opponent's maximum hand size is reduced by seven." (402.2)
    handSize: (g, self, pid) => (isOpponent(g, self.controller, pid) ? -7 : 0),
  },

  // ===== Instants and sorceries =====
  'Bitter Triumph': {
    // "As an additional cost to cast this spell, discard a card or pay 3 life." (118.8)
    additionalCost: {
      oneOf: [
        { label: 'Discard a card', discard: 1 },
        { label: 'Pay 3 life', life: 3 },
      ],
    },
    // "Destroy target creature or planeswalker."
    targets: [{ type: 'creature or planeswalker', label: 'target creature or planeswalker' }],
    onResolve: (g, { targets }) => destroy(g, refCard(g, targets[0])),
  },
  Delay: {
    // "Counter target spell. If the spell is countered this way, exile it with three time
    // counters on it instead of putting it into its owner's graveyard. If it doesn't have
    // suspend, it gains suspend." (702.62a) A copy of a spell ceases to exist (704.5e).
    targets: [{ type: 'spell', label: 'target spell' }],
    onResolve: (g, { targets }) => {
      const item = refStack(g, targets[0]);
      if (item?.kind !== 'spell' || !counter(g, targets[0], { exile: true })) return;
      const c = item.card;
      if (c.zone !== 'exile' || c.isToken) return;
      c.counters.time = 3;
      if (!hasSuspend(c)) c.suspend = true;
      log(g, `${label(c)} is exiled with three time counters on it and has suspend.`, c.owner, [c]);
    },
  },
  'Fell the Profane': {
    // "Destroy target creature or planeswalker."
    targets: [{ type: 'creature or planeswalker', label: 'target creature or planeswalker' }],
    onResolve: (g, { targets }) => destroy(g, refCard(g, targets[0])),
  },
  // "As this land enters, you may pay 3 life. If you don't, it enters tapped." "{T}: Add {B}."
  'Fell Mire': payThreeLand('B'),
  'Sink into Stupor': {
    // "Return target spell or nonland permanent an opponent controls to its owner's hand." A
    // spell returned isn't countered, so one that can't be countered goes too; a copy of a
    // spell ceases to exist (704.5e).
    targets: [{ type: 'spell or permanent', who: 'opponent', label: 'target spell or nonland permanent an opponent controls', filter: (g, c) => c.zone === 'stack' || !isLand(g, c) }],
    onResolve: (g, { targets }) => {
      const item = refStack(g, targets[0]);
      if (item?.kind === 'spell') {
        log(g, `${label(item.card)} returns to its owner's hand.`, item.card.owner, [item.card]);
        moveCard(g, item.card, 'hand');
      } else bounce(g, refCard(g, targets[0]));
    },
  },
  // "As this land enters, you may pay 3 life. If you don't, it enters tapped." "{T}: Add {U}."
  'Soporific Springs': payThreeLand('U'),
  'Living Death': { onResolve: (g) => livingDeath(g) },
  'Stubborn Denial': {
    // "Counter target noncreature spell unless its controller pays {1}. Ferocious — If you control
    // a creature with power 4 or greater, counter that spell instead." Checked as it resolves.
    targets: [{ type: 'spell', label: 'target noncreature spell', filter: (g, c) => !isCreature(g, c) }],
    onResolve: (g, { self, you, targets }) => {
      const item = refStack(g, targets[0]);
      if (!item) return;
      if (creaturesOf(g, you).some((c) => stats(g, c).power >= 4)) return void counter(g, targets[0]);
      ask(g, item.controller, { text: `Pay {1}, or ${label(item.card)} is countered (${label(self)}).`, cost: '{1}', yes: 'Pay {1}', no: "Don't Pay", then: 'unpaid' });
    },
    then: { unpaid: (g, { yes, targets }) => !yes && void counter(g, targets[0]) },
  },
  Victimize: {
    // "Choose two target creature cards in your graveyard. Sacrifice a creature. If you do,
    // return the chosen cards to the battlefield tapped." The creature is chosen as it resolves.
    targets: [creatureCardInYourGraveyard('two target creature cards in your graveyard'), { ...creatureCardInYourGraveyard('a second target creature card in your graveyard'), distinctFrom: 0 }],
    onResolve: (g, { you }) => {
      const mine = creaturesOf(g, you);
      if (mine.length) pickToSacrifice(g, you, mine, 'sacrifice a creature (Victimize)', 'victimize');
    },
    ...victimize,
  },

  // ===== Artifacts and enchantments =====
  'Monument to Endurance': {
    // "Whenever you discard a card, choose one that hasn't been chosen this turn — Draw a card;
    // Create a Treasure token; Each opponent loses 3 life." With all three chosen this turn, it
    // is removed from the stack (603.3c).
    onDiscard: {
      when: (_g, { self, player }) => player === self.controller,
      modes: { min: 1, max: 1, oncePerTurn: true, modes: MONUMENT_MODES, bot: () => [2, 0, 1] },
      resolve: (g, ctx) => {
        for (const i of ctx.modes ?? []) MONUMENT_MODES[i].resolve(g, ctx);
      },
      text: "Whenever you discard a card, choose one that hasn't been chosen this turn.",
    },
  },
  'Tortured Existence': {
    // "{B}, Discard a creature card: Return target creature card from your graveyard to your
    // hand." The target is chosen before the cost is paid, so it can't be the card discarded (602.2b).
    activated: {
      cost: { mana: '{B}', discard: 1, discardFilter: (g, c) => hasType(g, c, 'Creature') },
      targets: [creatureCardInYourGraveyard()],
      text: 'Return target creature card from your graveyard to your hand.',
      resolve: (g, { you, targets }) => {
        const c = refGraveyard(g, targets[0]);
        if (!c) return;
        moveCard(g, c, 'hand');
        log(g, `${says(g.players[you], 'returns')} ${label(c)} to ${their(g.players[you])} hand.`, you, [c]);
      },
    },
  },

  // ===== Lands =====
  'Cephalid Coliseum': {
    // "{T}: Add {U}. This land deals 1 damage to you."
    mana: { amount: 1, colors: ['U'], damage: 1 },
    // "Threshold — {U}, {T}, Sacrifice this land: Target player draws three cards, then discards
    // three cards. Activate only if there are seven or more cards in your graveyard."
    activated: {
      cost: { mana: '{U}', tap: true, sacrifice: true },
      when: (g, self) => g.players[self.controller].graveyard.length >= 7,
      targets: [{ type: 'player', label: 'target player' }],
      text: 'Target player draws three cards, then discards three cards.',
      resolve: (g, { targets }) => {
        const p = refPlayer(g, targets[0]);
        if (!p) return;
        draw(g, p.id, 3);
        chooseToDiscard(g, p.id, 3);
      },
    },
  },
  'Reflecting Pool': {
    // "{T}: Add one mana of any type that a land you control could produce." Itself included,
    // so it adds nothing when it is your only source (106.7). Colourless is a type of mana.
    mana: {
      amount: 1,
      colors: (g, self) => {
        const all = new Set(g.players[self.controller].battlefield.filter((c) => isLand(g, c)).flatMap((c) => landColors(g, c)));
        return (['W', 'U', 'B', 'R', 'G', 'C'] as const).filter((x) => all.has(x));
      },
    },
  },
});

/** Overlord of the Balemurk: mill four, then may return a non-Avatar creature card or a planeswalker card. */
function balemurk(g: Game, you: PlayerId) {
  mill(g, you, 4);
  const yard = g.players[you].graveyard;
  const fits = yard.filter((c) => (hasType(g, c, 'Creature') && !subtypesOf(g, c).includes('Avatar')) || hasType(g, c, 'Planeswalker'));
  if (fits.length)
    pickCards(g, you, yard, { min: 0, max: 1, pickable: fits, text: 'You may return a non-Avatar creature card or a planeswalker card from your graveyard to your hand.', button: 'Return', then: 'balemurk' });
}

/** Shadowgrange Archfiend: the next opponent chooses a creature with the greatest power they control; once all have, they are sacrificed. */
function shadowgrange(g: Game, you: PlayerId, order: PlayerId[], i: number, chosen: string[]) {
  for (; i < order.length; i++) {
    const mine = creaturesOf(g, order[i]);
    if (!mine.length) continue;
    const top = Math.max(...mine.map((c) => stats(g, c).power));
    const options = mine.filter((c) => stats(g, c).power === top);
    return void pickCards(g, order[i], options, { min: 1, max: 1, text: 'sacrifice a creature with the greatest power among creatures you control', button: 'Sacrifice', then: 'shadowgrange', data: { order, i, chosen, bot: 'sacrifice' } });
  }
  const cards = chosen.map((id) => permanent(g, id)).filter((c): c is Card => !!c);
  if (!cards.length) return;
  const most = Math.max(...cards.map((c) => stats(g, c).power));
  dieMany(g, cards, 'is sacrificed');
  if (most > 0) gainLife(g, you, most);
}
