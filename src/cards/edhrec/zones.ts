// Hand scripts for EDHREC's most-played cards and commanders that the Oracle text parser
// can't read (zones group). Each script follows the card's Oracle text clause by clause
// (docs/card-scripting.md); comments quote the clauses that need care.
//
// Glarb, Calamity's Augur and The Necrobloom have no script here: the parser reads them with
// the templates added for them (looking at and playing from the top of the library, "lands
// with different names", "... instead", "land cards in your graveyard have dredge 2").
import { registerScripts } from '../../engine/registry';
import {
  CANT_BE_BLOCKED,
  addCounters,
  addExtraSteps,
  addLasting,
  addMana,
  ask,
  chooseNumber,
  chooseToDiscard,
  connive,
  data,
  delay,
  dieMany,
  draw,
  enterBattlefield,
  exileAll,
  hasType,
  isLand,
  isSaga,
  label,
  log,
  manaValue,
  mill,
  moveCard,
  num,
  offerCastAny,
  permanent,
  permanentTypesOf,
  permitUsed,
  pickCards,
  reflexive,
  sameCard,
  says,
  subtypesOf,
  their,
  tokenCopy,
  transform,
  untilEndOfTurn,
} from '../../engine/rules';
import type { Card, Game, Mode, PlayerId } from '../../engine/types';

/** The permanent `ref` still is, if it hasn't left the battlefield since (400.7). */
const still = (g: Game, ref: { id: string; moves: number }) => {
  const c = permanent(g, ref.id);
  return sameCard(c, ref) ? c : undefined;
};

/** Is `c` an Elf or a Faerie (205.3m)? Changelings are every creature type (702.73a). */
const elfOrFaerie = (g: Game, c: Card) => subtypesOf(g, c).includes('Elf') || subtypesOf(g, c).includes('Faerie');

/**
 * Esper Terra's chapters I, II and III: "Create a token that's a copy of target nonlegendary
 * enchantment you control. It gains haste. If it's a Saga, put up to three lore counters on it.
 * Sacrifice it at the beginning of your next end step." The token copies the enchantment's
 * copiable values (707.2); haste is an effect on it with no stated duration (611.2a), so it
 * lasts as long as the token does. The lore counters are the player's choice, 0 to 3, each put
 * on at once (122.6), so the chapters they reach trigger (714.2b). The sacrifice is a delayed
 * trigger at this player's next end step (603.7), for that token only (400.7).
 */
const esperChapter: Mode = {
  text: "Create a token that's a copy of target nonlegendary enchantment you control. It gains haste. If it's a Saga, put up to three lore counters on it. Sacrifice it at the beginning of your next end step.",
  targets: [{ type: 'permanent', who: 'you', filter: (g, c) => hasType(g, c, 'Enchantment') && !hasType(g, c, 'Legendary'), label: 'target nonlegendary enchantment you control' }],
  resolve: (g, { self, you, targets }) => {
    const target = targets[0]?.kind === 'card' ? permanent(g, targets[0].id) : undefined;
    if (!target) return;
    const token = tokenCopy(g, you, target);
    if (!token) return;
    addLasting(g, token, { keywords: ['haste'] });
    delay(g, self, you, { key: 'sacrificeToken', step: 'end', player: you, data: { id: token.id, moves: token.moves } });
    if (isSaga(g, token)) chooseNumber(g, you, { text: `Put up to three lore counters on ${label(token)}.`, min: 0, max: 3, then: 'lore', data: { id: token.id, moves: token.moves } });
  },
};

registerScripts({
  // ===== Muldrotha, the Gravetide =====
  'Muldrotha, the Gravetide': {
    // "During each of your turns, you may play a land and cast a permanent spell of each
    // permanent type from your graveyard. (If a card has multiple permanent types, choose one as
    // you play it.)" A permission (601.3, 305.1) that the engine's cast and play actions use,
    // one use per permanent type (110.4) each turn, each use spent by whichever of the card's
    // types the player names as they play it (`CastChoices.slot`). "Your graveyard": cards there
    // are their owner's. The card is played at its own timing and for its own costs (Muldrotha's
    // rulings: "You must follow the normal timing permissions and restrictions"). A new Muldrotha
    // is a new object with uses of its own (400.7, rulings).
    playPermission: (g, self, pid, c) => {
      if (pid !== self.controller || g.active !== pid || c.zone !== 'graveyard' || c.owner !== pid) return null;
      const types = permanentTypesOf(g, c).filter((t) => !permitUsed(g, self, t));
      if (!types.length) return null;
      const casts = types.filter((t) => t !== 'Land');
      return { ...(casts.length ? { cast: true } : {}), ...(types.includes('Land') ? { land: true } : {}), slots: types };
    },
  },

  // ===== Kotis, the Fangkeeper =====
  'Kotis, the Fangkeeper': {
    // "Whenever Kotis deals combat damage to a player, exile the top X cards of their library,
    // where X is the amount of damage dealt. You may cast any number of spells with mana value X
    // or less from among them without paying their mana costs." The cards are exiled as one
    // event (603.2c); the spells are cast while the ability resolves (608.2g, Kotis's rulings:
    // "You can't wait to cast them later in the turn. Timing restrictions based on the card's
    // type are ignored"), one at a time; an X in a mana cost counts as 0 for the mana value and
    // must be 0 when cast (rulings). Cards not cast stay in exile.
    onCombatDamageToPlayer: (g, { self, you, player, amount }) => {
      const victim = g.players[player];
      if (victim.lost || amount <= 0) return;
      const top = victim.library.slice(0, amount);
      if (!top.length) return;
      const exiled = exileAll(g, top, `${label(self)} exiles ${top.map(label).join(', ')} from the top of ${their(victim)} library.`, you);
      offerCastAny(g, you, exiled.filter((c) => manaValue(c) <= amount), { free: true, maxMv: amount, text: `${label(self)}: you may cast spells with mana value ${amount} or less from among the exiled cards without paying their mana costs.` });
    },
  },

  // ===== Maralen, Fae Ascendant =====
  'Maralen, Fae Ascendant': {
    // "Whenever Maralen or another Elf or Faerie you control enters, exile the top two cards of
    // target opponent's library." One ability for Maralen itself and for other Elves and Faeries
    // under its controller's control, creatures or not (an Elf is anything with the subtype,
    // 205.3m). Permanents entering together see each other (603.6a), so Maralen entering with
    // another Elf triggers twice (its rulings). The two cards are exiled as one event (603.2c)
    // and linked to this Maralen (607.2a, 400.7), with the turn, for the second ability.
    onPermanentEnters: {
      when: (g, { self, entered }) => entered.controller === self.controller && (entered.id === self.id || elfOrFaerie(g, entered)),
      targets: [{ type: 'player', who: 'opponent', label: 'target opponent' }],
      resolve: (g, { self, you, targets }) => {
        const opp = targets[0]?.kind === 'player' ? g.players[targets[0].id] : undefined;
        if (!opp || opp.lost) return;
        const top = opp.library.slice(0, 2);
        if (!top.length) return;
        const exiled = exileAll(g, top, `${label(self)} exiles ${top.map(label).join(', ')} from the top of ${their(opp)} library.`, you);
        const src = still(g, self);
        if (src) src.linked.push(...exiled.map((c) => ({ id: c.id, moves: c.moves, turn: g.turn })));
      },
      text: "Whenever Maralen or another Elf or Faerie you control enters, exile the top two cards of target opponent's library.",
    },
    // "Once each turn, you may cast a spell with mana value less than or equal to the number of
    // Elves and Faeries you control from among cards exiled with Maralen this turn without paying
    // its mana cost." A permission (601.3) with one use a turn (`slots`), for cards this Maralen
    // exiled this turn while it was this object (400.7); the spell is cast at its own timing, for
    // nothing (118.9), with X as 0 (rulings). The count is made as the spell is cast.
    playPermission: (g, self, pid, c) => {
      if (pid !== self.controller || c.zone !== 'exile' || isLand(g, c) || permitUsed(g, self, 'once')) return null;
      if (!self.linked.some((l) => sameCard(c, l) && l.turn === g.turn)) return null;
      const count = g.players[pid].battlefield.filter((x) => elfOrFaerie(g, x)).length;
      return manaValue(c) <= count ? { cast: true, free: true, slots: ['once'] } : null;
    },
  },

  // ===== Norman Osborn // Green Goblin =====
  'Norman Osborn': {
    // "Norman Osborn can't be blocked." A restriction carried like a keyword (509.1b).
    static: (_g, self, c) => (c.id === self.id ? { keywords: [CANT_BE_BLOCKED] } : null),
    // "Whenever Norman Osborn deals combat damage to a player, he connives." (701.50a) He
    // connives as he last was if he has left the battlefield (701.50b).
    onCombatDamageToPlayer: (g, { self }) => connive(g, still(g, self) ?? self),
    // "{1}{U}{B}{R}: Transform Norman Osborn. Activate only as a sorcery." His own ability
    // transforms him only if he hasn't transformed since it was activated (701.27f).
    activated: {
      cost: { mana: '{1}{U}{B}{R}' },
      sorcery: true,
      text: '{1}{U}{B}{R}: Transform Norman Osborn. Activate only as a sorcery.',
      resolve: (g, { self }) => transform(g, permanent(g, self.id), self),
    },
  },
  'Green Goblin': {
    // "Spells you cast from your graveyard cost {2} less to cast." (601.2f: generic mana only)
    costModifier: (_g, self, _spell, caster, from) => (caster === self.controller && from === 'graveyard' ? -2 : 0),
    // "Goblin Formula — Each nonland card in your graveyard has mayhem. The mayhem cost is equal
    // to its mana cost." Mayhem (702.187b): "As long as you discarded this card this turn, you may
    // cast it from your graveyard by paying [cost] rather than paying its mana cost", following the
    // rules for alternative costs (601.2b, 601.2f-h), so no other alternative cost goes with it
    // (118.9a). "Your graveyard": the cards there are their owner's.
    playPermission: (g, self, pid, c) =>
      pid === self.controller && c.zone === 'graveyard' && c.owner === pid && !isLand(g, c) && c.discarded === g.turn ? { cast: true, cost: data(c).manaCost } : null,
  },

  // ===== Flubs, the Fool =====
  'Flubs, the Fool': {
    // "You may play an additional land on each of your turns." (305.2)
    extraLands: (g, self, pid) => (pid === self.controller && g.active === pid ? 1 : 0),
    // "Whenever you play a land or cast a spell, draw a card if you have no cards in hand.
    // Otherwise, discard a card." One ability on two events (603.2); the hand is counted as it
    // resolves (608.2c), and the discard is the player's choice (701.9a).
    onLandPlayed: {
      when: (_g, { self, player }) => player === self.controller,
      resolve: (g, { you }) => flubs(g, you),
      text: 'Whenever you play a land or cast a spell, draw a card if you have no cards in hand. Otherwise, discard a card.',
    },
    onCast: {
      when: (_g, { self, caster }) => caster === self.controller,
      resolve: (g, { you }) => flubs(g, you),
      text: 'Whenever you play a land or cast a spell, draw a card if you have no cards in hand. Otherwise, discard a card.',
    },
  },

  // ===== Terra, Magical Adept // Esper Terra =====
  'Terra, Magical Adept': {
    // "When Terra enters, mill five cards. Put up to one enchantment card milled this way into
    // your hand." Only an enchantment card that was milled and is still in the graveyard (400.7).
    onEnter: (g, { you }) => {
      const milled = mill(g, you, 5);
      const enchantments = milled.filter((c) => c.zone === 'graveyard' && hasType(g, c, 'Enchantment'));
      if (!enchantments.length) return;
      pickCards(g, you, enchantments, { min: 0, max: 1, text: 'put up to one enchantment card milled this way into your hand', button: 'Put Into Hand', then: 'toHand' });
    },
    then: {
      toHand: (g, { you, picked }) => {
        const c = picked[0] && g.players[you].graveyard.find((x) => x.id === picked[0].id);
        if (!c) return;
        moveCard(g, c, 'hand');
        log(g, `${says(g.players[you], 'puts')} ${label(c)} into ${their(g.players[you])} hand.`, you, [c]);
      },
    },
    // "Trance — {4}{R}{G}, {T}: Exile Terra, then return it to the battlefield transformed under
    // its owner's control. Activate only as a sorcery." Trance is an ability word with no rules
    // meaning (207.2c). "It" is the card in exile, a new object (400.7): it enters with its back
    // face up (712.14a) under its owner's control (110.2a), so Esper Terra enters as a Saga with a
    // lore counter (714.3a) and chapter I triggers. Nothing happens if Terra has left already.
    activated: {
      cost: { mana: '{4}{R}{G}', tap: true },
      sorcery: true,
      text: '{4}{R}{G}, {T}: Exile Terra, then return it to the battlefield transformed under its owner\'s control. Activate only as a sorcery.',
      resolve: (g, { self }) => {
        const c = still(g, self);
        if (!c) return;
        log(g, `${label(c)} is exiled.`, c.controller, [c]);
        moveCard(g, c, 'exile');
        const exiled = g.players[c.owner].exile.find((x) => x.id === c.id);
        if (exiled) enterBattlefield(g, exiled, { face: 1, controller: exiled.owner });
      },
    },
    botActivate: (g, pid, self) => g.players[pid].battlefield.some((c) => c.id !== self.id && hasType(g, c, 'Enchantment') && !hasType(g, c, 'Legendary')),
  },
  'Esper Terra': {
    // A creature Saga (714.1a): its chapter abilities trigger as lore counters reach them (714.2b).
    chapters: [
      // "I, II, III — [the same effect]" is three chapter abilities (714.2c).
      esperChapter,
      esperChapter,
      esperChapter,
      {
        // "IV — Add {W}{W}, {U}{U}, {B}{B}, {R}{R}, and {G}{G}. Exile Esper Terra, then return it to
        // the battlefield (front face up)." Not a mana ability: it uses the stack (605.1b, its
        // rulings). The card returns as a new object with its front face up (712.14, 400.7), under
        // the control of the player whose ability put it there (110.2a). Nothing returns if it left first.
        text: 'Add {W}{W}, {U}{U}, {B}{B}, {R}{R}, and {G}{G}. Exile Esper Terra, then return it to the battlefield (front face up).',
        resolve: (g, { self, you }) => {
          addMana(g, you, ['W', 'W', 'U', 'U', 'B', 'B', 'R', 'R', 'G', 'G'], self);
          const c = still(g, self);
          if (!c) return;
          log(g, `${label(c)} is exiled.`, c.controller, [c]);
          moveCard(g, c, 'exile');
          const exiled = g.players[c.owner].exile.find((x) => x.id === c.id);
          if (exiled) enterBattlefield(g, exiled, { face: 0, controller: you });
        },
      },
    ],
    then: {
      // "If it's a Saga, put up to three lore counters on it": the token, if it is still there (400.7).
      lore: (g, { n, data: d }) => {
        const token = still(g, d as { id: string; moves: number });
        if (token && n > 0) addCounters(g, token, n, 'lore');
      },
    },
    delayed: {
      // "Sacrifice it at the beginning of your next end step": that token, if it is still there (400.7).
      sacrificeToken: (g, { data: d }) => {
        const token = still(g, d as { id: string; moves: number });
        if (token) dieMany(g, [token], 'is sacrificed');
      },
    },
    // The token's chapters go off at once, and it is sacrificed anyway: a bot takes all three.
    botChoice: { lore: () => ({ type: 'chooseNumber', n: 3 }) },
  },

  // ===== Terra, Herald of Hope =====
  'Terra, Herald of Hope': {
    // "Trance — At the beginning of combat on your turn, mill two cards. Terra gains flying until
    // end of turn." The ability word has no rules meaning (207.2c). Only this Terra gains flying,
    // if it is still on the battlefield (400.7); the mill happens either way.
    onBeginCombat: {
      when: (_g, { self, player }) => player === self.controller,
      resolve: (g, { self, you }) => {
        mill(g, you, 2);
        untilEndOfTurn(g, still(g, self), { keywords: ['flying'] });
      },
      text: 'At the beginning of combat on your turn, mill two cards. Terra gains flying until end of turn.',
    },
    // "Whenever Terra deals combat damage to a player, you may pay {2}. When you do, return
    // target creature card with power 3 or less from your graveyard to the battlefield tapped."
    // The payment is a choice as the ability resolves (608.2d, 118.12); "when you do" is a
    // reflexive triggered ability (603.12) that targets as it goes on the stack (603.3d).
    onCombatDamageToPlayer: (g, { you }) => ask(g, you, { text: 'Terra, Herald of Hope: pay {2}? When you do, return target creature card with power 3 or less from your graveyard to the battlefield tapped.', cost: '{2}', yes: 'Pay {2}', no: "Don't Pay", then: 'paid' }),
    then: {
      paid: (g, { self, you, yes }) => {
        if (yes) reflexive(g, self, you, 'return');
      },
    },
    reflexive: {
      return: {
        // "Power 3 or less" as the card is in the graveyard (its printed power).
        targets: [{ type: 'graveyard card', who: 'you', filter: (g, c) => hasType(g, c, 'Creature') && num(data(c).power) <= 3, label: 'target creature card with power 3 or less in your graveyard' }],
        text: 'When you do, return target creature card with power 3 or less from your graveyard to the battlefield tapped.',
        resolve: (g, { you, targets }) => {
          const ref = targets[0];
          const c = ref?.kind === 'card' ? g.players[you].graveyard.find((x) => x.id === ref.id) : undefined;
          if (c) enterBattlefield(g, c, { tapped: true, controller: you });
        },
      },
    },
    // A bot pays when it has a creature card to return.
    botChoice: { paid: (g, pid) => ({ type: 'answer', yes: g.players[pid].graveyard.some((c) => hasType(g, c, 'Creature') && num(data(c).power) <= 3) }) },
  },

  // ===== Obeka, Splitter of Seconds =====
  'Obeka, Splitter of Seconds': {
    // "Whenever Obeka deals combat damage to a player, you get that many additional upkeep steps
    // after this phase." Steps added to the turn directly after the phase the ability resolves in
    // (500.9; its rulings: each is a beginning phase with only an upkeep step, after the combat
    // phase), and "at the beginning of your upkeep" abilities trigger in each (503.1a).
    onCombatDamageToPlayer: (g, { amount }) => addExtraSteps(g, 'upkeep', amount),
  },
});

/** Flubs: "draw a card if you have no cards in hand. Otherwise, discard a card", as it resolves. */
function flubs(g: Game, you: PlayerId) {
  if (g.players[you].hand.length === 0) draw(g, you);
  else chooseToDiscard(g, you, 1);
}
