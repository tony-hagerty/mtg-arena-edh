// Card behaviour for the Kuja deck. Each script follows the card's Oracle text clause by
// clause (docs/card-scripting.md); comments quote the clauses that need care.
import { registerScripts } from '../engine/registry';
import {
  addEffect,
  addMana,
  ask,
  attachedBonus,
  availableMana,
  CANT_BLOCK,
  chooseNumber,
  copyItem,
  counter,
  createToken,
  dealDamage,
  destroy,
  discard,
  draw,
  enterBattlefield,
  equip,
  finishEnter,
  hasType,
  isCreature,
  isLand,
  isPlaneswalker,
  label,
  log,
  loseLife,
  makeCard,
  manaValue,
  mill,
  moveCard,
  nameCard,
  offerCast,
  offerRetarget,
  opponentsOf,
  permanent,
  pickCards,
  prowess,
  pump,
  putOnBottomRandomly,
  rand,
  refCard,
  refGraveyard,
  reflexive,
  refPlayer,
  refStack,
  sacrifice,
  sameCard,
  says,
  shuffle,
  simultaneously,
  snapshot,
  stats,
  subtypesOf,
  their,
  tokenCopy,
  transform,
  turnOrder,
} from '../engine/rules';
import { cardWant } from '../engine/ai';
import type { Card, CardScript, Game, Mode, PlayerId, StackItem, TargetRef, TargetSpec, Zone } from '../engine/types';
import { exileTop, favouriteType, mayCast } from './kraum-tymna';
import { damageEachOpponent, enchantCreature, granted, isOpponent, tappedLand, wizardPing, youCastNoncreature } from './yshtola';

// ---------- pieces ----------

/** The permanent `ref` still is, if it hasn't left the battlefield since (400.7). */
const still = (g: Game, ref: { id: string; moves: number }) => {
  const c = permanent(g, ref.id);
  return sameCard(c, ref) ? c : undefined;
};

/** Is `c` a Wizard (205.3m)? Changelings are every creature type (702.73a). */
const isWizard = (c: Card) => subtypesOf(c).includes('Wizard');

/** The card a permanent became as it went to `zone` (400.7), if it is still there. Tokens cease to exist (111.7). */
const wentTo = (g: Game, left: Card, zone: Zone) => g.players[left.owner][zone].find((x) => x.id === left.id && x.moves === left.moves + 1);

/** "You may pay {N}. If you do, return this card from your graveyard to your hand" (Vivi's Persistence, Asgardian Inspiration). */
const payToReturn: Pick<CardScript, 'then' | 'botChoice'> = {
  then: {
    back: (g, { self, you, yes }) => {
      if (!yes) return;
      // Only the card that triggered, if it is still in the graveyard (400.7).
      const card = g.players[self.owner].graveyard.find((x) => sameCard(x, self));
      if (!card) return;
      moveCard(g, card, 'hand');
      log(g, `${says(g.players[you], 'returns')} ${label(card)} to ${their(g.players[you])} hand.`, you, [card]);
    },
  },
  botChoice: { back: () => ({ type: 'answer', yes: true }) },
};

const askPayToReturn = (g: Game, you: PlayerId, self: Card, cost: string) =>
  ask(g, you, { text: `You may pay ${cost} to return ${label(self)} from your graveyard to your hand.`, cost, yes: `Pay ${cost}`, no: "Don't Pay", then: 'back' });

registerScripts({
  // ===== Commander =====
  'Kuja, Genome Sorcerer': {
    // "At the beginning of your end step, create a tapped 0/1 black Wizard creature token with
    // 'Whenever you cast a noncreature spell, this token deals 1 damage to each opponent.' Then
    // if you control four or more Wizards, transform Kuja." The count is made as the ability
    // resolves (it isn't an intervening "if", 603.4), and Kuja transforms only if it hasn't
    // transformed since the ability was put on the stack (701.27f).
    onEndStep: {
      when: (_g, { self, player }) => player === self.controller,
      resolve: (g, { self, you }) => {
        createToken(g, you, 'Wizard 0/1 ping', 1, { tapped: true });
        if (g.players[you].battlefield.filter(isWizard).length >= 4) transform(g, still(g, self), self);
      },
      text: 'At the beginning of your end step, create a tapped 0/1 Wizard token. Then if you control four or more Wizards, transform Kuja.',
    },
  },
  'Trance Kuja, Fate Defied': {
    // "Flare Star — If a Wizard you control would deal damage to a permanent or player, it
    // deals double that damage instead." (614.1a) The damage is still dealt by the Wizard.
    changesDamage: (_g, self, source) => (source.controller === self.controller && isWizard(source) ? { times: 2 } : null),
  },

  // ===== Creatures =====
  'Coruscation Mage': {
    // "Offspring {2}" (702.175a), then "Whenever you cast a noncreature spell, this creature
    // deals 1 damage to each opponent." The 1/1 token copy has the ability too.
    offspring: '{2}',
    onCast: wizardPing,
  },
  "Gandalf, Goblins' Bane": {
    // "Whenever you cast a noncreature spell, Gandalf gets +1/+1 until end of turn and deals 1
    // damage to each opponent." Gandalf deals the damage even if he has left the battlefield,
    // as he last was (608.2h); only the same permanent gets +1/+1 (400.7).
    onCast: {
      when: youCastNoncreature,
      resolve: (g, { self, you }) => {
        pump(g, still(g, self), 1, 1);
        damageEachOpponent(g, self, you, 1);
      },
      text: 'Whenever you cast a noncreature spell, Gandalf gets +1/+1 until end of turn and deals 1 damage to each opponent.',
    },
  },
  Flameshape: {
    // "Look at the top two cards of your library and exile them face down. For as long as they
    // remain exiled, you may play them if you control a Wizard." Its caster may look at them
    // (406.3); the permission lasts while each stays the same object in exile (400.7).
    onResolve: (g, { you }) => {
      const top = g.players[you].library.slice(0, 2);
      for (const c of top) {
        moveCard(g, c, 'exile');
        const exiled = g.players[c.owner].exile.find((x) => x.id === c.id)!;
        exiled.faceDown = true;
        exiled.known = [you];
      }
      if (top.length) log(g, `${says(g.players[you], 'exiles')} the top ${top.length === 1 ? 'card' : 'two cards'} of ${their(g.players[you])} library face down.`, you);
      const exiled = top.map((c) => g.players[c.owner].exile.find((x) => x.id === c.id)!);
      for (const c of exiled) addEffect(g, { kind: 'mayCast', player: you, card: c.id, moves: c.moves, play: true, lasting: true, ifSubtype: 'Wizard' });
    },
  },
  'Harmonic Prodigy': {
    onCast: prowess,
    // "If a triggered ability of a Shaman or another Wizard you control triggers, that ability
    // triggers an additional time." (603.2d) Only permanents have a controller to count (108.4).
    doublesTriggers: (_g, self, source) =>
      source.zone === 'battlefield' && source.controller === self.controller && (subtypesOf(source).includes('Shaman') || (source.id !== self.id && isWizard(source))),
  },
  'Slickshot Show-Off': {
    // "Whenever you cast a noncreature spell, this creature gets +2/+0 until end of turn." Plot {1}{R} (702.170a).
    onCast: {
      when: youCastNoncreature,
      resolve: (g, { self }) => pump(g, still(g, self), 2, 0),
      text: 'Whenever you cast a noncreature spell, this creature gets +2/+0 until end of turn.',
    },
    plot: '{1}{R}',
  },
  'Storm-Kiln Artist': {
    // "This creature gets +1/+0 for each artifact you control."
    static: (g, self, c) => (c.id === self.id ? { power: g.players[self.controller].battlefield.filter((x) => hasType(x, 'Artifact')).length } : null),
    // "Magecraft — Whenever you cast or copy an instant or sorcery spell, create a Treasure token." (207.2c)
    onCast: {
      when: (_g, { self, card, caster }) => caster === self.controller && (hasType(card, 'Instant') || hasType(card, 'Sorcery')),
      resolve: (g, { you }) => createToken(g, you, 'Treasure'),
      text: 'Magecraft — Whenever you cast or copy an instant or sorcery spell, create a Treasure token.',
    },
    onCopy: {
      when: (_g, { self, card, controller }) => controller === self.controller && (hasType(card, 'Instant') || hasType(card, 'Sorcery')),
      resolve: (g, { you }) => createToken(g, you, 'Treasure'),
      text: 'Magecraft — Whenever you cast or copy an instant or sorcery spell, create a Treasure token.',
    },
  },
  'Tomik, Izzet Sparkmage': {
    onCast: prowess,
    // "If a source you control would deal noncombat damage to an opponent or a permanent an
    // opponent controls, it deals that much damage plus 1 instead." (614.1a)
    changesDamage: (g, self, source, to, combat) =>
      !combat && source.controller === self.controller && isOpponent(g, self.controller, to.player ?? to.card!.controller) ? { plus: 1 } : null,
  },
  'Electro, Assaulting Battery': {
    // "You don't lose unspent red mana as steps and phases end." (500.5)
    keepsMana: (_g, self, pid, m) => pid === self.controller && m.sym === 'R',
    // "Whenever you cast an instant or sorcery spell, add {R}." A triggered ability, so it uses the stack (605.1b).
    onCast: {
      when: (_g, { self, card, caster }) => caster === self.controller && (hasType(card, 'Instant') || hasType(card, 'Sorcery')),
      resolve: (g, { self, you }) => addMana(g, you, ['R'], self),
      text: 'Whenever you cast an instant or sorcery spell, add {R}.',
    },
    // "When Electro leaves the battlefield, you may pay {X}. When you do, he deals X damage to
    // target player." X is chosen as the cost is paid; the target is chosen for the reflexive
    // trigger after paying (603.12).
    onLeave: (g, { you }) =>
      chooseNumber(g, you, { text: 'You may pay {X}. When you do, Electro deals X damage to target player. Choose X.', min: 0, max: availableMana(g, you), decline: "Don't Pay", then: 'x' }),
    then: {
      x: (g, { you, yes, n }) => yes && ask(g, you, { text: `Pay {${n}}: Electro deals ${n} damage to target player.`, cost: `{${n}}`, yes: `Pay {${n}}`, no: "Don't Pay", then: 'paid', data: { x: n } }),
      paid: (g, { self, you, yes, data }) => yes && reflexive(g, self, you, 'zap', data),
    },
    reflexive: {
      zap: {
        targets: [{ type: 'player', label: 'target player' }],
        text: 'Electro deals X damage to target player.',
        resolve: (g, { self, targets, data }) => void dealDamage(g, self, targets[0], data.x as number),
      },
    },
    botChoice: {
      x: (g, pid) => {
        const n = availableMana(g, pid);
        return { type: 'chooseNumber', n: n > 0 && opponentsOf(g, pid).length ? n : null };
      },
      paid: () => ({ type: 'answer', yes: true }),
    },
  },

  // ===== Instants and sorceries =====
  'Mage Siege': {
    // "Create a 0/1 black Wizard creature token with '...'." Then the card is exiled, and its owner may play the land later (715.4).
    onResolve: (g, { you }) => void createToken(g, you, 'Wizard 0/1 ping'),
  },
  'Reactor Raid': {
    // "You may sacrifice an artifact or creature. If you do, draw two cards."
    onResolve: (g, { you }) => {
      const options = g.players[you].battlefield.filter((c) => hasType(c, 'Artifact') || isCreature(c));
      if (options.length) pickCards(g, you, options, { min: 0, max: 1, text: 'You may sacrifice an artifact or creature. If you do, draw two cards.', button: 'Sacrifice', then: 'sac' });
    },
    then: {
      sac: (g, { you, picked }) => {
        const c = picked[0] && permanent(g, picked[0].id);
        if (!c) return;
        sacrifice(g, c);
        draw(g, you, 2);
      },
    },
    botChoice: {
      sac: (g, _pid, choice) => {
        // A Treasure, Clue or Food, or else a token creature.
        const cards = ((choice as { cards: string[] }).cards ?? []).map((id) => permanent(g, id)!).filter(Boolean);
        const spare = cards.find((c) => c.isToken && !isCreature(c)) ?? cards.find((c) => c.isToken);
        return { type: 'chooseCards', cards: spare ? [spare.id] : [] };
      },
    },
  },
  Overmaster: {
    // "The next instant or sorcery spell you cast this turn can't be countered. Draw a card."
    onResolve: (g, { you }) => {
      addEffect(g, { kind: 'uncounterableNext', player: you });
      draw(g, you);
    },
  },
  "Vivi's Persistence": {
    // "Create a 0/1 black Wizard creature token with '...'."
    onResolve: (g, { you }) => void createToken(g, you, 'Wizard 0/1 ping'),
    // "Whenever your commander enters or attacks, you may pay {2}. If you do, return this card
    // from your graveyard to your hand." It triggers only while the card is in its owner's
    // graveyard; "your commander" is one its owner owns (903.3, 903.3d).
    fromGraveyard: ['onPermanentEnters', 'onCreatureAttacks'],
    onPermanentEnters: {
      when: (_g, { self, entered }) => self.zone === 'graveyard' && entered.isCommander && entered.owner === self.owner,
      resolve: (g, { self, you }) => askPayToReturn(g, you, self, '{2}'),
      text: 'Whenever your commander enters, you may pay {2}. If you do, return this card from your graveyard to your hand.',
    },
    onCreatureAttacks: {
      when: (_g, { self, attacker }) => self.zone === 'graveyard' && attacker.isCommander && attacker.owner === self.owner,
      resolve: (g, { self, you }) => askPayToReturn(g, you, self, '{2}'),
      text: 'Whenever your commander attacks, you may pay {2}. If you do, return this card from your graveyard to your hand.',
    },
    ...payToReturn,
  },

  // ===== Artifacts and enchantments =====
  'Furnace of Rath': {
    // "If a source would deal damage to a permanent or player, it deals double that damage to that permanent or player instead." (614.1a)
    changesDamage: () => ({ times: 2 }),
  },
  'Collective Inferno': {
    // Convoke is the engine's (702.51a). "As this enchantment enters, choose a creature type." (614.1c, 614.12a)
    replaceEnter: (g, c, controller) => {
      nameCard(g, controller, { text: 'Choose a creature type.', of: 'creature type', then: 'type', script: c.id });
      return true;
    },
    then: { type: (g, { self, name, data }) => finishEnter(g, self, data, { chosen: name }) },
    // "Double all damage that sources you control of the chosen type would deal." (614.1a)
    changesDamage: (_g, self, source) => (self.chosen && source.controller === self.controller && subtypesOf(source).includes(self.chosen) ? { times: 2 } : null),
    botChoice: { type: (g, pid) => ({ type: 'name', name: favouriteType(g, pid) }) },
  },
  'Lightning Greaves': {
    // "Equipped creature has haste and shroud." "Equip {0}"
    static: attachedBonus({ keywords: ['haste', 'shroud'] }),
    activated: equip('{0}'),
  },
  'Tablet of Discovery': {
    // "When this artifact enters, mill a card. You may play that card this turn."
    onEnter: (g, { you }) => mayCast(g, you, mill(g, you, 1), { play: true }),
    // "{T}: Add {R}." "{T}: Add {R}{R}. Spend this mana only to cast instant and sorcery spells." (106.6)
    mana: [
      { amount: 1, colors: ['R'] },
      { amount: 2, colors: ['R'], types: ['Instant', 'Sorcery'] },
    ],
  },
  "Kaya's Ghostform": {
    // "Enchant creature or planeswalker you control"
    enchant: { type: 'creature or planeswalker', who: 'you', label: 'target creature or planeswalker you control', filter: (_g, c) => isCreature(c) || isPlaneswalker(c) },
    // "When enchanted permanent dies or is put into exile, return that card to the battlefield
    // under your control." A leaves-the-battlefield ability, so it looks back in time (603.10a):
    // it triggers even if Ghostform leaves at the same time. It returns only the card that went
    // there, if it is still there (400.7); a token ceases to exist (111.7).
    onPermanentLeaves: {
      when: (_g, { self, left, to }) => left.id === self.attachedTo && (to === 'graveyard' || to === 'exile'),
      resolve: (g, { you, left, to }) => {
        const card = wentTo(g, left, to);
        if (card) enterBattlefield(g, card, { controller: you });
      },
      text: 'When enchanted permanent dies or is put into exile, return that card to the battlefield under your control.',
    },
  },
  'Wicked Role': {
    // 111.10q: "Enchant creature", "Enchanted creature gets +1/+1," and "When this token is put
    // into a graveyard from the battlefield, each opponent loses 1 life."
    enchant: enchantCreature,
    static: attachedBonus({ power: 1, toughness: 1 }),
    onLeave: {
      when: (_g, { to }) => to === 'graveyard',
      resolve: (g, { you }) => {
        for (const o of opponentsOf(g, you)) loseLife(g, o.id, 1);
      },
      text: 'When this token is put into a graveyard from the battlefield, each opponent loses 1 life.',
    },
  },
  'Not Dead After All': {
    // "Until end of turn, target creature you control gains 'When this creature dies, return it
    // to the battlefield tapped under its owner's control, then create a Wicked Role token
    // attached to it.'" The ability's controller (the creature's as it died) creates the Role,
    // and only if the card came back as a creature (as its rulings say).
    targets: [{ type: 'creature', who: 'you', label: 'target creature you control' }],
    onResolve: (g, { targets }) => {
      const c = refCard(g, targets[0]);
      if (c) c.mods.push({ power: 0, toughness: 0, keywords: [], grant: { from: 'Not Dead After All', index: 0 } });
    },
    grants: [
      granted('onDies', {
        resolve: (g, { self, you }) => {
          const card = wentTo(g, self, 'graveyard');
          if (card) enterBattlefield(g, card, { tapped: true, controller: card.owner, after: { source: snapshot(self), key: 'role', you, script: 'Not Dead After All' } });
        },
        text: "When this creature dies, return it to the battlefield tapped under its owner's control, then create a Wicked Role token attached to it.",
      }),
    ],
    then: {
      role: (g, { you, picked }) => {
        const c = picked[0] && permanent(g, picked[0].id);
        if (c && isCreature(c)) createToken(g, you, 'Wicked Role', 1, { attachTo: c.id });
      },
    },
  },

  // ===== Lands =====
  'Dark Fortress': {
    // "{T}: Add {C}." "{T}: Add {B} or {R}. Activate only if this land entered this turn or if you control a basic land."
    mana: [
      { amount: 1, colors: ['C'] },
      { amount: 1, colors: ['B', 'R'], when: (g, self) => self.entered === g.turn || g.players[self.controller].battlefield.some((c) => isLand(c) && hasType(c, 'Basic')) },
    ],
  },
  'Phyrexian Tower': {
    // "{T}: Add {C}." "{T}, Sacrifice a creature: Add {B}{B}." Auto-pay never sacrifices a creature.
    mana: [
      { amount: 1, colors: ['C'] },
      { amount: 2, colors: ['B'], sacrificeCreature: true },
    ],
  },
  'Lindblum, Industrial Regency': tappedLand(['R']),
  'Midgar, City of Mako': tappedLand(['B']),
  'Sanguine Morass': tappedLand(['B', 'R']),
  'Valakut Stoneforge': tappedLand(['R']),
});

// ---------- spells that choose as they resolve ----------

const isInstantOrSorcery = (c: Card) => hasType(c, 'Instant') || hasType(c, 'Sorcery');

/** "Target instant or sorcery card in your graveyard" (Flashback, Stingcaster Mage). */
const instantOrSorceryInGraveyard: TargetSpec = { type: 'graveyard card', who: 'you', label: 'target instant or sorcery card in your graveyard', filter: (_g, c) => isInstantOrSorcery(c) };

/** "[It] gains flashback until end of turn. The flashback cost is equal to its mana cost." (702.34a) */
function giveFlashback(g: Game, card: Card | undefined) {
  if (!card) return;
  addEffect(g, { kind: 'flashback', card: card.id, moves: card.moves });
  log(g, `${label(card)} gains flashback until end of turn.`, card.owner, [card]);
}

/** "A spell or ability with a single target" (115.10): it targets exactly one object or player, once. */
const singleTarget = (_g: Game, item: StackItem) => item.targets.filter(Boolean).length === 1 && item.targets.length === 1;

/** "Change the target of target spell or ability with a single target." It must change if it can (115.7a). */
const changeTarget: Mode = {
  text: 'Change the target of target spell or ability with a single target.',
  targets: [{ type: 'spell or ability', label: 'target spell or ability with a single target', item: singleTarget }],
  resolve: (g, { you, targets }) => {
    const item = refStack(g, targets[0]);
    if (item) offerRetarget(g, you, item, true);
  },
};

/** "You may play those cards until the end of your next turn" (Light Up the Stage, Hex Magic, Matoc). */
function mayPlayUntilNextTurn(g: Game, pid: PlayerId, cards: Card[], anyMana = false) {
  for (const c of cards) addEffect(g, { kind: 'mayCast', player: pid, card: c.id, moves: c.moves, play: true, until: { player: pid, turn: g.turn + 1 }, ...(anyMana ? { anyMana } : {}) });
}

/** Total mana value of cards (202.3). */
const totalMv = (cards: Card[]) => cards.reduce((n, c) => n + manaValue(c), 0);

/** Cards still in exile as the objects `refs` remember (400.7). */
const stillExiled = (g: Game, refs: { id: string; moves: number }[]) =>
  refs.map((r) => g.players.flatMap((p) => p.exile).find((x) => sameCard(x, r))).filter((c): c is Card => !!c);

const refsOf = (cards: Card[]) => cards.map((c) => ({ id: c.id, moves: c.moves }));

// Dance with Calamity: exile one card at a time, as many times as the caster chooses.
function danceAsk(g: Game, you: PlayerId, exiled: { id: string; moves: number }[]) {
  const total = totalMv(stillExiled(g, exiled));
  if (!g.players[you].library.length) return danceCast(g, you, exiled);
  ask(g, you, {
    text: `You may exile the top card of your library. Total mana value exiled: ${total}. With 13 or less, you may cast spells from among them for free.`,
    yes: 'Exile Top Card',
    no: 'Stop',
    then: 'dance',
    data: { exiled },
  });
}

/** "If the total mana value of the cards exiled this way is 13 or less, you may cast any number of spells from among those cards without paying their mana costs." */
function danceCast(g: Game, you: PlayerId, exiled: { id: string; moves: number }[]) {
  const cards = stillExiled(g, exiled);
  if (totalMv(cards) > 13) return log(g, `The total mana value is ${totalMv(cards)}, more than 13.`, you);
  const spells = cards.filter((c) => !isLand(c));
  if (spells.length) pickCards(g, you, spells, { min: 0, max: 1, text: 'You may cast a spell from among the exiled cards without paying its mana cost.', button: 'Cast', then: 'dancePick', data: { exiled } });
}

// Ensnared by the Mara: each opponent faces the villainous choice in APNAP order, one at a time (701.55d).
function ensnare(g: Game, you: PlayerId, order: PlayerId[], i: number) {
  for (; i < order.length; i++) {
    const o = order[i];
    if (g.players[o].lost) continue;
    ask(g, o, {
      text: `Villainous choice: exile cards from the top of your library until you exile a nonland card, which ${g.players[you].name} may cast for free, or exile the top four cards and be dealt damage equal to their total mana value.`,
      yes: 'Exile Until Nonland',
      no: 'Exile Four',
      then: 'mara',
      data: { order, i },
    });
    return;
  }
}

/** Exiles cards from the top of `pid`'s library until a nonland card that fits (701.17-style "until"); returns them all, that card last. */
function exileUntil(g: Game, pid: PlayerId, fits: (c: Card) => boolean): Card[] {
  const p = g.players[pid];
  const out: Card[] = [];
  while (p.library.length) {
    const c = p.library[0];
    moveCard(g, c, 'exile');
    const stored = p.exile.find((x) => x.id === c.id)!;
    out.push(stored);
    if (fits(stored)) break;
  }
  if (out.length) log(g, `${says(p, 'exiles')} ${out.map(label).join(', ')} from the top of ${their(p)} library.`, pid, out);
  return out;
}

// Mages' Contest: the two bidders alternate until the high bid stands.
interface Contest {
  target: TargetRef;
  bidders: PlayerId[];
  high: number;
  leader: PlayerId;
  you: PlayerId;
}

function bid(g: Game, item: Contest) {
  const next = item.bidders.find((p) => p !== item.leader && !g.players[p].lost);
  if (next === undefined) return contestEnds(g, item);
  chooseNumber(g, next, {
    text: `Mages' Contest: the high bid is ${item.high} life (${g.players[item.leader].name}). You may top it.`,
    min: item.high + 1,
    // A player may bid more life than they have.
    max: Number.MAX_SAFE_INTEGER,
    decline: 'Pass',
    then: 'bid',
    data: { ...item },
  });
}

/** "The high bidder loses life equal to the high bid. If you win the bidding, counter that spell." */
function contestEnds(g: Game, item: Contest) {
  log(g, `${g.players[item.leader].name} wins the bidding with ${item.high} life.`, item.leader);
  loseLife(g, item.leader, item.high);
  if (item.leader === item.you) counter(g, item.target);
}

/** Black Market Connections's modes, in printed order. */
const blackMarket: Mode[] = [
  {
    text: 'Sell Contraband — Create a Treasure token. You lose 1 life.',
    resolve: (g, { you }) => {
      createToken(g, you, 'Treasure');
      loseLife(g, you, 1);
    },
  },
  {
    text: 'Buy Information — Draw a card. You lose 2 life.',
    resolve: (g, { you }) => {
      draw(g, you);
      loseLife(g, you, 2);
    },
  },
  {
    text: 'Hire a Mercenary — Create a 3/2 colorless Shapeshifter creature token with changeling. You lose 3 life.',
    resolve: (g, { you }) => {
      createToken(g, you, 'Shapeshifter 3/2 changeling');
      loseLife(g, you, 3);
    },
  },
];

registerScripts({
  'Asgardian Inspiration': {
    // "Exile the top card of your library. You may play it this turn."
    onResolve: (g, { you }) => mayCast(g, you, exileTop(g, you, 1), { play: true }),
    // "Whenever a source you control deals noncombat damage to an opponent, you may pay {2}. If
    // you do, return this card from your graveyard to your hand." It triggers only from the
    // graveyard; "you" is its owner there (108.4a).
    fromGraveyard: ['onDamage'],
    onDamage: {
      when: (g, { self, source, player, combat }) => self.zone === 'graveyard' && !combat && source.controller === self.owner && isOpponent(g, self.owner, player),
      resolve: (g, { self, you }) => askPayToReturn(g, you, self, '{2}'),
      text: 'Whenever a source you control deals noncombat damage to an opponent, you may pay {2}. If you do, return this card from your graveyard to your hand.',
    },
    ...payToReturn,
  },
  'Black Market Connections': {
    // "At the beginning of your first main phase, choose one or more —" (603.3c, 505.1)
    onPrecombatMain: {
      when: (_g, { self, player }) => player === self.controller,
      modes: {
        min: 1,
        max: 3,
        modes: blackMarket,
        // A bot pays the life it can spare.
        bot: (g, pid) => {
          const life = g.players[pid].life;
          return life > 20 ? [0, 1, 2] : life > 12 ? [0, 1] : [0];
        },
      },
      resolve: (g, ctx) => {
        for (const i of ctx.modes ?? []) blackMarket[i].resolve(g, ctx);
      },
      text: 'At the beginning of your first main phase, choose one or more —',
    },
  },
  'Bloodsoaked Insight': {
    // "This spell costs {1} less to cast for each 1 life your opponents have lost this turn." (601.2f: generic mana only)
    costReduction: (g, self) => opponentsOf(g, self.controller).reduce((n, o) => n + o.lifeLost, 0),
    // "Target opponent exiles the top three cards of their library. Until the end of your next
    // turn, you may play those cards. If you cast a spell this way, mana of any type can be
    // spent to cast it."
    targets: [{ type: 'player', who: 'opponent', label: 'target opponent' }],
    onResolve: (g, { you, targets }) => {
      const o = refPlayer(g, targets[0]);
      if (o) mayPlayUntilNextTurn(g, you, exileTop(g, o.id, 3), true);
    },
  },
  'Dance with Calamity': {
    // "Shuffle your library. As many times as you choose, you may exile the top card of your library."
    onResolve: (g, { you }) => {
      shuffle(g, g.players[you].library);
      log(g, `${says(g.players[you], 'shuffles')} ${their(g.players[you])} library.`, you);
      danceAsk(g, you, []);
    },
    then: {
      dance: (g, { you, yes, data }) => {
        const exiled = data.exiled as { id: string; moves: number }[];
        if (!yes) return danceCast(g, you, exiled);
        const top = exileTop(g, you, 1);
        danceAsk(g, you, [...exiled, ...refsOf(top)]);
      },
      // "You may cast any number of spells from among those cards": one at a time, in any order (608.2g).
      dancePick: (g, { you, picked, data }) => {
        const c = picked[0];
        // Each card is offered once: cast or not, it isn't offered again.
        if (c) offerCast(g, you, c, { free: true, text: `Cast ${label(c)} without paying its mana cost?`, then: 'danceNext', data: { ...data, done: [...((data.done as string[]) ?? []), c.id] } });
      },
      danceNext: (g, { you, data }) => {
        const done = (data.done as string[]) ?? [];
        const spells = stillExiled(g, data.exiled as { id: string; moves: number }[]).filter((c) => !isLand(c) && !done.includes(c.id));
        if (spells.length) pickCards(g, you, spells, { min: 0, max: 1, text: 'You may cast another spell from among the exiled cards without paying its mana cost.', button: 'Cast', then: 'dancePick', data });
      },
    },
    botChoice: {
      // A bot stops while the total leaves room under 13.
      dance: (g, _pid, choice) => {
        const exiled = ((choice as { data?: { exiled?: { id: string; moves: number }[] } }).data?.exiled ?? []) as { id: string; moves: number }[];
        return { type: 'answer', yes: totalMv(stillExiled(g, exiled)) < 8 };
      },
      dancePick: (g, pid, choice) => {
        const ids = (choice as { cards: string[] }).cards;
        const best = ids
          .map((id) => g.players.flatMap((p) => p.exile).find((x) => x.id === id)!)
          .filter(Boolean)
          .sort((a, b) => manaValue(b) - manaValue(a))[0];
        return { type: 'chooseCards', cards: best && cardWant(g, pid, best) > 0 ? [best.id] : [] };
      },
    },
  },
  'Ensnared by the Mara': {
    // "Each opponent faces a villainous choice — They exile cards from the top of their library
    // until they exile a nonland card, then you may cast that card without paying its mana
    // cost, or that player exiles the top four cards of their library and Ensnared by the Mara
    // deals damage equal to the total mana value of those exiled cards to that player."
    onResolve: (g, { you }) =>
      ensnare(
        g,
        you,
        turnOrder(g, g.active).filter((p) => p !== you),
        0,
      ),
    then: {
      mara: (g, { self, you, chooser, yes, data }) => {
        const { order, i } = data as { order: PlayerId[]; i: number };
        if (yes) {
          const exiled = exileUntil(g, chooser, (c) => !isLand(c));
          const card = exiled[exiled.length - 1];
          if (card && !isLand(card)) {
            offerCast(g, you, card, { free: true, text: `Cast ${label(card)} without paying its mana cost?`, then: 'maraNext', data: { order, i } });
            return;
          }
        } else {
          const four = exileTop(g, chooser, 4);
          dealDamage(g, self, { kind: 'player', id: chooser }, totalMv(four));
        }
        ensnare(g, you, order, i + 1);
      },
      maraNext: (g, { you, data }) => {
        const { order, i } = data as { order: PlayerId[]; i: number };
        ensnare(g, you, order, i + 1);
      },
    },
    // A bot takes the damage while it has life to spare.
    botChoice: { mara: (g, pid) => ({ type: 'answer', yes: g.players[pid].life < 20 }) },
  },
  'Fire Covenant': {
    // "As an additional cost to cast this spell, pay X life." "Fire Covenant deals X damage
    // divided as you choose among any number of target creatures." The division is made as it
    // is cast (601.2d), and the damage is dealt at once.
    additionalCost: { life: 'x' },
    divide: 'x',
    targets: [{ type: 'creature', any: true, label: 'any number of target creatures' }],
    onResolve: (g, { self, targets }) =>
      simultaneously(g, () => {
        targets.forEach((t, i) => t && dealDamage(g, self, t, self.cast?.divide?.[i] ?? 0));
      }),
  },
  Flashback: {
    // "Target instant or sorcery card in your graveyard gains flashback until end of turn. The flashback cost is equal to its mana cost."
    targets: [instantOrSorceryInGraveyard],
    onResolve: (g, { targets }) => giveFlashback(g, refGraveyard(g, targets[0])),
  },
  'Stingcaster Mage': {
    // "When this creature enters, target instant or sorcery card in your graveyard gains flashback until end of turn. ..."
    targets: [instantOrSorceryInGraveyard],
    onEnter: (g, { targets }) => giveFlashback(g, refGraveyard(g, targets[0])),
  },
  'Hex Magic': {
    // "Exile all the cards from your hand, then draw that many cards. Until the end of your next
    // turn, you may play cards exiled this way."
    onResolve: (g, { you }) => {
      const p = g.players[you];
      const hand = [...p.hand];
      for (const c of hand) moveCard(g, c, 'exile');
      if (hand.length) log(g, `${says(p, 'exiles')} ${their(p)} hand: ${hand.map(label).join(', ')}.`, you, hand);
      const exiled = stillExiled(g, refsOf(hand.map((c) => p.exile.find((x) => x.id === c.id)!).filter(Boolean)));
      draw(g, you, hand.length);
      mayPlayUntilNextTurn(g, you, exiled);
    },
  },
  'Highway Robbery': {
    // "You may discard a card or sacrifice a land. If you do, draw two cards." Plot {1}{R}.
    onResolve: (g, { you }) => {
      const p = g.players[you];
      const options = [...p.hand, ...p.battlefield.filter(isLand)];
      if (options.length) pickCards(g, you, options, { min: 0, max: 1, text: 'You may discard a card or sacrifice a land. If you do, draw two cards.', button: 'Choose', then: 'rob' });
    },
    then: {
      rob: (g, { you, picked }) => {
        const c = picked[0];
        if (!c) return;
        const p = g.players[you];
        if (p.hand.some((x) => x.id === c.id)) discard(g, p.hand.find((x) => x.id === c.id)!);
        else {
          const land = permanent(g, c.id);
          if (!land) return;
          sacrifice(g, land);
        }
        draw(g, you, 2);
      },
    },
    plot: '{1}{R}',
    botChoice: {
      rob: (g, pid) => {
        const p = g.players[pid];
        // The hand card it wants least, if it has one it doesn't want; else nothing.
        const worst = [...p.hand].sort((a, b) => cardWant(g, pid, a) - cardWant(g, pid, b))[0];
        return { type: 'chooseCards', cards: worst && (isLand(worst) ? p.battlefield.filter(isLand).length >= 4 : cardWant(g, pid, worst) <= 0) ? [worst.id] : [] };
      },
    },
  },
  'Light Up the Stage': {
    // "Spectacle {R}" (702.137a): only if an opponent lost life this turn.
    alternativeCosts: [{ label: 'Spectacle {R}', mana: '{R}', when: (g, self) => opponentsOf(g, self.controller).some((o) => o.lifeLost > 0) }],
    // "Exile the top two cards of your library. Until the end of your next turn, you may play those cards."
    onResolve: (g, { you }) => mayPlayUntilNextTurn(g, you, exileTop(g, you, 2)),
  },
  "Mages' Contest": {
    // "You and target spell's controller bid life. You start the bidding with a bid of 1. In turn
    // order, each player may top the high bid. The bidding ends if the high bid stands."
    targets: [{ type: 'spell', label: 'target spell' }],
    onResolve: (g, { you, targets }) => {
      const item = refStack(g, targets[0]);
      if (!item) return;
      log(g, `${says(g.players[you], 'bids')} 1 life.`, you);
      bid(g, { target: targets[0]!, bidders: [you, item.controller], high: 1, leader: you, you });
    },
    then: {
      bid: (g, { chooser, yes, n, data }) => {
        const item = data as unknown as Contest;
        if (!yes) return contestEnds(g, item);
        log(g, `${says(g.players[chooser], 'bids')} ${n} life.`, chooser);
        bid(g, { ...item, high: n, leader: chooser });
      },
    },
    botChoice: {
      // A bot bids up to a third of its life, and less for a cheap spell.
      bid: (g, pid, choice) => {
        const c = choice as { min: number; data?: { target?: TargetRef } };
        const item = c.data?.target ? refStack(g, c.data.target) : undefined;
        const limit = Math.min(Math.floor(g.players[pid].life / 3), 2 + (item ? manaValue(item.card) : 0));
        return { type: 'chooseNumber', n: c.min <= limit ? c.min : null };
      },
    },
  },
  'Matoc, Lavamancer': {
    // "Whenever a source you control deals damage, if at least one permanent or player was dealt
    // exactly 2 of that damage, exile the top card of your library. You may play it until the
    // end of your next turn."
    onSourceDamage: {
      when: (_g, { self, source, dealt }) => source.controller === self.controller && dealt.some((d) => d.amount === 2),
      resolve: (g, { you }) => mayPlayUntilNextTurn(g, you, exileTop(g, you, 1)),
      text: 'Whenever a source you control deals damage, if a permanent or player was dealt exactly 2 of it, exile the top card of your library. You may play it until the end of your next turn.',
    },
    // "{R}, {T}, Exile two cards from your graveyard: Matoc deals 2 damage to any other target."
    activated: {
      cost: { mana: '{R}', tap: true, exileGraveyard: 2 },
      targets: [{ type: 'any', label: 'any other target', filter: (_g, c, self) => c.id !== self.id }],
      text: '{R}, {T}, Exile two cards from your graveyard: Matoc deals 2 damage to any other target.',
      resolve: (g, { self, targets }) => void dealDamage(g, self, targets[0], 2),
    },
  },
  "Mizzix's Mastery": {
    // "Exile target card that's an instant or sorcery from your graveyard. For each card exiled
    // this way, copy it, and you may cast the copy without paying its mana cost. Exile Mizzix's
    // Mastery." Overload: "target" becomes "each" (702.96a-b).
    targets: [{ type: 'graveyard card', who: 'you', label: "target card that's an instant or sorcery from your graveyard", filter: (_g, c) => isInstantOrSorcery(c) }],
    alternativeCosts: [{ label: 'Overload {5}{R}{R}{R}', mana: '{5}{R}{R}{R}', overload: true }],
    exilesItself: true,
    onResolve: (g, { self, you, targets }) => {
      const p = g.players[you];
      const cards = self.cast?.alt === 0 ? p.graveyard.filter(isInstantOrSorcery) : [refGraveyard(g, targets[0])].filter((c): c is Card => !!c);
      const exiled: Card[] = [];
      for (const c of cards) {
        const owner = g.players[c.owner];
        moveCard(g, c, 'exile');
        const there = owner.exile.find((x) => x.id === c.id);
        if (there) exiled.push(there);
      }
      if (!exiled.length) return;
      log(g, `${says(p, 'exiles')} ${exiled.map(label).join(', ')}.`, you, exiled);
      // A copy of each card, in exile, which may be cast (707.12). One not cast ceases to exist (704.5e).
      const copies = exiled.map((c) => {
        const copy = makeCard(g, c.name, you, 'exile', { isToken: true, face: 0 });
        p.exile.push(copy);
        return p.exile[p.exile.length - 1];
      });
      log(g, `${says(p, 'copies')} ${exiled.map(label).join(', ')}.`, you, exiled);
      mizzixPick(g, you, copies.map((c) => c.id));
    },
    then: {
      mizzixPick: (g, { you, picked, data }) => {
        const left = (data.copies as string[]).filter((id) => g.players[you].exile.some((x) => x.id === id));
        const c = picked[0];
        if (!c) return endCopies(g, you, left);
        offerCast(g, you, c, { free: true, text: `Cast the copy of ${label(c)} without paying its mana cost?`, then: 'mizzixNext', data: { copies: left.filter((id) => id !== c.id), tried: c.id } });
      },
      mizzixNext: (g, { you, data }) => {
        // A copy that wasn't cast ceases to exist (704.5e).
        endCopies(g, you, [data.tried as string]);
        mizzixPick(g, you, data.copies as string[]);
      },
    },
    botChoice: { mizzixPick: (_g, _pid, choice) => ({ type: 'chooseCards', cards: (choice as { cards: string[] }).cards.slice(0, 1) }) },
  },
  'Redirect Lightning': {
    // "As an additional cost to cast this spell, pay 5 life or pay {2}." (118.8)
    additionalCost: {
      oneOf: [
        { label: 'Pay 5 life', life: 5 },
        { label: 'Pay {2}', mana: '{2}' },
      ],
    },
    // "Change the target of target spell or ability with a single target."
    targets: changeTarget.targets,
    onResolve: changeTarget.resolve,
  },
  'Return the Favor': {
    // Spree (702.172a): "+ {1} — Copy target instant spell, sorcery spell, activated ability, or
    // triggered ability. You may choose new targets for the copy." "+ {1} — Change the target of
    // target spell or ability with a single target."
    modal: {
      min: 1,
      max: 2,
      modes: [
        {
          text: 'Copy target instant spell, sorcery spell, activated ability, or triggered ability. You may choose new targets for the copy.',
          cost: '{1}',
          targets: [{ type: 'spell or ability', label: 'target instant spell, sorcery spell, activated ability, or triggered ability', item: (_g, item) => item.kind !== 'spell' || isInstantOrSorcery(item.card) }],
          resolve: (g, { you, targets }) => {
            const item = refStack(g, targets[0]);
            if (item) copyItem(g, item, you);
          },
        },
        { ...changeTarget, cost: '{1}' },
      ],
    },
  },
  'Saw in Half': {
    // "Destroy target creature. If that creature dies this way, its controller creates two tokens
    // that are copies of that creature, except their power is half that creature's power and
    // their toughness is half that creature's toughness. Round up each time." As it last
    // existed on the battlefield (608.2h); the halves are its copiable P/T (707.9b).
    targets: [{ type: 'creature', label: 'target creature' }],
    onResolve: (g, { targets }) => {
      const c = refCard(g, targets[0]);
      if (!c) return;
      const last = snapshot(c);
      const s = stats(g, c);
      destroy(g, c);
      if (c.zone !== 'graveyard') return; // indestructible, or put somewhere else instead
      const half = (n: number) => Math.ceil(n / 2) || 0;
      for (let i = 0; i < 2; i++) tokenCopy(g, last.controller, last, { power: half(s.power), toughness: half(s.toughness) });
    },
  },
  'Stingerquill Charm': {
    // "Choose one —"
    modal: {
      min: 1,
      max: 1,
      modes: [
        {
          text: 'Stingerquill Charm deals 3 damage to any target.',
          targets: [{ type: 'any', label: 'any target' }],
          resolve: (g, { self, targets }) => void dealDamage(g, self, targets[0], 3),
        },
        {
          text: 'Target creature gains first strike and deathtouch until end of turn.',
          targets: [{ type: 'creature', label: 'target creature' }],
          resolve: (g, { targets }) => pump(g, refCard(g, targets[0]), 0, 0, ['first strike', 'deathtouch']),
        },
        {
          text: 'Create a 2/2 colorless Wizard Soldier creature token named Cadet. It gains haste until end of turn.',
          resolve: (g, { you }) => {
            for (const t of createToken(g, you, 'Cadet')) pump(g, t, 0, 0, ['haste']);
          },
        },
      ],
    },
  },
  "Tibalt's Trickery": {
    // "Counter target spell. Choose 1, 2, or 3 at random. Its controller mills that many cards,
    // then exiles cards from the top of their library until they exile a nonland card with a
    // different name than that spell. They may cast that card without paying its mana cost.
    // Then they put the exiled cards on the bottom of their library in a random order." The rest
    // happens even if the spell can't be countered.
    targets: [{ type: 'spell', label: 'target spell' }],
    onResolve: (g, { targets }) => {
      const item = refStack(g, targets[0]);
      if (!item) return;
      const pid = item.controller;
      const name = label(item.card);
      counter(g, targets[0]);
      const n = 1 + Math.floor(rand(g) * 3);
      log(g, `${n} is chosen at random.`, pid);
      mill(g, pid, n);
      const exiled = exileUntil(g, pid, (c) => !isLand(c) && label(c) !== name);
      const last = exiled[exiled.length - 1];
      const data = { exiled: refsOf(exiled) };
      if (last && !isLand(last) && label(last) !== name) offerCast(g, pid, last, { free: true, text: `Cast ${label(last)} without paying its mana cost?`, then: 'bottom', data });
      else putOnBottomRandomly(g, exiled);
    },
    then: { bottom: (g, { data }) => putOnBottomRandomly(g, stillExiled(g, data.exiled as { id: string; moves: number }[])) },
  },
  'Untimely Malfunction': {
    // "Choose one —"
    modal: {
      min: 1,
      max: 1,
      modes: [
        {
          text: 'Destroy target artifact.',
          targets: [{ type: 'permanent', label: 'target artifact', filter: (_g, c) => hasType(c, 'Artifact') }],
          resolve: (g, { targets }) => destroy(g, refCard(g, targets[0])),
        },
        changeTarget,
        {
          text: "One or two target creatures can't block this turn.",
          targets: [
            { type: 'creature', label: 'target creature' },
            { type: 'creature', optional: true, distinctFrom: 0, label: 'a second target creature' },
          ],
          resolve: (g, { targets }) => {
            for (const t of targets) pump(g, refCard(g, t), 0, 0, [CANT_BLOCK]);
          },
        },
      ],
    },
  },
  'Valakut Awakening': {
    // "Put any number of cards from your hand on the bottom of your library, then draw that many
    // cards plus one." Its owner chooses their order on the bottom (401.4).
    onResolve: (g, { you }) => {
      const hand = g.players[you].hand;
      if (!hand.length) return void draw(g, you, 1);
      pickCards(g, you, hand, { min: 0, max: hand.length, text: 'Put any number of cards from your hand on the bottom of your library, then draw that many plus one.', button: 'Put on Bottom', then: 'which' });
    },
    then: {
      which: (g, { you, picked }) => {
        if (picked.length > 1)
          pickCards(g, you, picked, { min: picked.length, max: picked.length, text: 'put these on the bottom of your library in any order', button: 'Put on Bottom', then: 'bottom', ordered: true });
        else valakut(g, you, picked);
      },
      bottom: (g, { you, picked }) => valakut(g, you, picked),
    },
    botChoice: {
      which: (g, pid) => {
        // Lands beyond what it needs, and cards it can't use.
        const hand = g.players[pid].hand;
        const lands = g.players[pid].battlefield.filter(isLand).length;
        return { type: 'chooseCards', cards: hand.filter((c) => (isLand(c) && lands >= 5) || cardWant(g, pid, c) <= 0).map((c) => c.id) };
      },
    },
  },
});

/** Valakut Awakening: the cards go on the bottom in the order picked, then their owner draws that many plus one. */
function valakut(g: Game, you: PlayerId, picked: Card[]) {
  const p = g.players[you];
  const cards = picked.map((c) => p.hand.find((x) => x.id === c.id)).filter((c): c is Card => !!c);
  for (const c of cards) moveCard(g, c, 'library');
  if (cards.length) log(g, `${says(p, 'puts')} ${cards.length} ${cards.length === 1 ? 'card' : 'cards'} on the bottom of ${their(p)} library.`, you);
  draw(g, you, cards.length + 1);
}

/** Mizzix's Mastery: offer the copies left, one at a time. */
function mizzixPick(g: Game, you: PlayerId, copies: string[]) {
  const cards = copies.map((id) => g.players[you].exile.find((x) => x.id === id)).filter((c): c is Card => !!c);
  if (cards.length) pickCards(g, you, cards, { min: 0, max: 1, text: 'You may cast a copy without paying its mana cost.', button: 'Cast', then: 'mizzixPick', data: { copies } });
}

/** Copies of cards left in exile cease to exist (704.5e). */
function endCopies(g: Game, you: PlayerId, ids: string[]) {
  g.players[you].exile = g.players[you].exile.filter((x) => !(x.isToken && ids.includes(x.id)));
}
