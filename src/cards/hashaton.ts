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
  copyItem,
} from '../engine/rules';
import type { Card, CardScript, Game, Mode, PlayerId, TargetRef, TargetSpec } from '../engine/types';
import { exileTop } from './kraum-tymna';
import { payThreeLand } from './ketramose';
import { isOpponent } from './yshtola';

// ---------- pieces ----------

/** The permanent `ref` still is, if it hasn't left the battlefield since (400.7). */
const still = (g: Game, ref: { id: string; moves: number }) => {
  const c = permanent(g, ref.id);
  return sameCard(c, ref) ? c : undefined;
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
});

/** Overlord of the Balemurk: mill four, then may return a non-Avatar creature card or a planeswalker card. */
function balemurk(g: Game, you: PlayerId) {
  mill(g, you, 4);
  const yard = g.players[you].graveyard;
  const fits = yard.filter((c) => (hasType(g, c, 'Creature') && !subtypesOf(g, c).includes('Avatar')) || hasType(g, c, 'Planeswalker'));
  if (fits.length)
    pickCards(g, you, yard, { min: 0, max: 1, pickable: fits, text: 'You may return a non-Avatar creature card or a planeswalker card from your graveyard to your hand.', button: 'Return', then: 'balemurk' });
}
