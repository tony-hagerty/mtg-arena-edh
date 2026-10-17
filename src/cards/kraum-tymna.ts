// Card behaviour for the Kraum and Tymna deck. Each script follows the card's Oracle text
// clause by clause (docs/card-scripting.md); comments quote the clauses that need care.
import { registerScripts } from '../engine/registry';
import {
  MUST_ATTACK,
  abilitySource,
  addEffect,
  choosePlayer,
  copyItem,
  copyOf,
  copySpell,
  data,
  enterBattlefield,
  findCard,
  shuffle,
  finishEnter,
  gainControl,
  isLand,
  untilEndOfTurn,
  isPermanentCard,
  offerCast,
  offerRetarget,
  refGraveyard,
  resolvingItem,
  sameCard,
  surveil,
  addMana,
  ask,
  bounce,
  counter,
  createToken,
  creaturesOf,
  damagePlayer,
  manaValue,
  delay,
  destroy,
  devotion,
  discard,
  discardAtRandom,
  draw,
  extraTurn,
  hasName,
  hasType,
  isColor,
  isCreature,
  label,
  landColors,
  log,
  loseGame,
  loseLife,
  mill,
  moveCard,
  nameCard,
  opponentsOf,
  permanent,
  pickCards,
  pump,
  putOnBottomRandomly,
  refCard,
  refPlayer,
  refStack,
  sacrifice,
  says,
  their,
  verbFor,
  whose,
  search,
  stats,
  turnOrder,
  winGame,
} from '../engine/rules';
import { canPayLater, cardWant, oracleOnStack, threat } from '../engine/ai';
import { canSayYes } from '../engine/engine';
import type { AskChoice, Card, CardScript, Choice, Ctx, Find, Game, ManaSym, PlayerId, TargetSpec } from '../engine/types';
import { CREATURE_TYPES } from './db';

// ---------- target specs and conditions ----------

const spell = (label: string, filter?: TargetSpec['filter']): TargetSpec => ({ type: 'spell', label, filter });
const anySpell = spell('target spell');
const noncreatureSpell = spell('target noncreature spell', (g, c) => !isCreature(g, c));
const blueCard = { label: 'a blue card', filter: (g: Game, c: Card) => isColor(g, c, 'U') };
const isOpponent = (g: Game, a: PlayerId, b: PlayerId) => a !== b && !g.players[b].lost;
const controlsCommander = (g: Game, self: Card) => g.players[self.controller].battlefield.some((c) => c.isCommander);
const WUBRG: ManaSym[] = ['W', 'U', 'B', 'R', 'G'];

// ---------- reusable pieces ----------

/** "{T}, Pay 1 life, Sacrifice this land: Search your library for a [A] or [B] card, put it onto the battlefield, then shuffle." */
const fetchland = (a: string, b: string): CardScript => ({
  activated: {
    cost: { tap: true, life: 1, sacrifice: true },
    text: `Search for a ${a} or ${b} card`,
    resolve: (g, { you }) => search(g, you, 'battlefield', { subtypes: [a, b], label: `a ${a} or ${b} card` }, { tapped: false }),
  },
});

/** A tutor: search for a card (that fits `find`) and put it into your hand, or on top after shuffling. */
const tutor = (to: 'hand' | 'top', find?: Find, extra: Partial<CardScript> = {}): CardScript => ({
  ai: 'tutor',
  onResolve: (g, { you }) => search(g, you, to, find, { reveal: !!find }),
  ...extra,
});

/** "Add {B}{B}{B}" and other rituals: the mana goes straight into the caster's pool. */
const ritual = (syms: (g: Game, ctx: Ctx) => ManaSym[]): CardScript => ({
  ai: 'ritual',
  onResolve: (g, ctx) => addMana(g, ctx.you, syms(g, ctx), ctx.self),
});

/**
 * "Counter target [spec]", plus what the card says happens next. `after` runs whether or
 * not the spell could be countered: "Its controller creates ..." is a separate instruction.
 * It gets the targeted spell's controller, the player "its controller" means.
 */
const counterspell = (target: TargetSpec, after?: (g: Game, ctx: Ctx, controller: PlayerId) => void, extra: Partial<CardScript> = {}): CardScript => ({
  targets: [target],
  onResolve: (g, ctx) => {
    const item = refStack(g, ctx.targets[0]);
    if (!item) return;
    counter(g, ctx.targets[0]);
    after?.(g, ctx, item.controller);
  },
  ...extra,
});

/** The colours of mana the lands an opponent controls could produce (Fellwar Stone, Exotic Orchard). */
const opponentLandColors = (g: Game, self: Card): ManaSym[] => {
  const all = new Set(opponentsOf(g, self.controller).flatMap((o) => o.battlefield.filter((c) => hasType(g, c, 'Land')).flatMap((c) => landColors(g, c))));
  return WUBRG.filter((x) => all.has(x));
};

/**
 * "[Player] may draw a card unless that player pays {N}" (Rhystic Study, Mystic Remora):
 * the player who cast the spell decides whether to pay (118.12a), then if they don't, the
 * ability's controller decides whether to draw.
 */
function drawUnlessPays(g: Game, you: PlayerId, payer: PlayerId, cost: string, source: Card) {
  ask(g, payer, {
    text: `Pay ${cost}, or ${g.players[you].you ? 'you' : g.players[you].name} may draw a card (${label(source)}).`,
    cost,
    yes: `Pay ${cost}`,
    no: "Don't Pay",
    then: 'taxed',
  });
}
const mayDrawUnlessPaid: CardScript['then'] = {
  taxed: (g, { you, yes }) => {
    if (yes) return;
    ask(g, you, { text: 'You may draw a card.', yes: 'Draw', no: "Don't Draw", then: 'draw' });
  },
  draw: (g, { you, yes }) => yes && draw(g, you),
};
/** Bots draw unless that would leave them nearly decked. */
const botDraws = (g: Game, pid: PlayerId) => ({ type: 'answer' as const, yes: g.players[pid].library.length > 2 });

/** "Draw a card unless that player pays {N}" (Esper Sentinel): the draw isn't optional. */
function drawsUnlessPays(g: Game, you: PlayerId, payer: PlayerId, cost: string, source: Card) {
  ask(g, payer, {
    text: `Pay ${cost}, or ${g.players[you].you ? 'you draw' : `${g.players[you].name} draws`} a card (${label(source)}).`,
    cost,
    yes: `Pay ${cost}`,
    no: "Don't Pay",
    then: 'taxedDraw',
  });
}

/** "An opponent casts a spell" (or a noncreature spell): the trigger condition, from the permanent's side. */
const opponentCasts =
  (noncreature = false) =>
  (g: Game, e: { self: Card; card: Card; caster: PlayerId }) =>
    isOpponent(g, e.self.controller, e.caster) && (!noncreature || !isCreature(g, e.card));

/** Recruit (701.70a): draw a card, then discard a card. If it was a nonland card, create a 1/1 white Human Soldier. */
function recruit(g: Game, pid: PlayerId) {
  draw(g, pid);
  const hand = g.players[pid].hand;
  if (hand.length) pickCards(g, pid, hand, { min: 1, max: 1, text: 'discard a card', button: 'Discard', then: 'recruited' });
}

/** "That player may pay {N}. If they don't, [effect]" with the effect as `then.unpaid`. */
const payOr = (g: Game, payer: PlayerId, cost: string, text: string) =>
  ask(g, payer, { text, cost, yes: `Pay ${cost}`, no: "Don't Pay", then: 'unpaid' });

/** A bot keeps a card from Tainted Pact or an Oracle look that it wants enough. */
const wants = (g: Game, pid: PlayerId, c: Card) => cardWant(g, pid, c) >= 4;

registerScripts({
  // ===== Lands =====
  'Arid Mesa': fetchland('Mountain', 'Plains'),
  'Bloodstained Mire': fetchland('Swamp', 'Mountain'),
  'Flooded Strand': fetchland('Plains', 'Island'),
  'Marsh Flats': fetchland('Plains', 'Swamp'),
  'Misty Rainforest': fetchland('Forest', 'Island'),
  'Polluted Delta': fetchland('Island', 'Swamp'),
  'Scalding Tarn': fetchland('Island', 'Mountain'),
  'Verdant Catacombs': fetchland('Swamp', 'Forest'),
  'Windswept Heath': fetchland('Forest', 'Plains'),
  'Ancient Tomb': { mana: { amount: 2, colors: ['C'], damage: 2 } },
  'City of Brass': {
    mana: { amount: 1, colors: 'any' },
    // "Whenever this land becomes tapped, it deals 1 damage to you."
    onTapped: (g, { self, you }) => void damagePlayer(g, self, you, 1),
  },
  'Mana Confluence': { mana: { amount: 1, colors: 'any', life: 1 } },
  'Tarnished Citadel': { mana: [{ amount: 1, colors: ['C'] }, { amount: 1, colors: 'any', damage: 3 }] },
  'Spire of Industry': {
    mana: [
      { amount: 1, colors: ['C'] },
      { amount: 1, colors: 'any', life: 1, when: (g, self) => g.players[self.controller].battlefield.some((c) => hasType(g, c, 'Artifact')) },
    ],
  },
  'Command Tower': { mana: { amount: 1, colors: 'identity' } },
  'Exotic Orchard': { mana: { amount: 1, colors: opponentLandColors } },

  // ===== Fast mana =====
  'Fellwar Stone': { mana: { amount: 1, colors: opponentLandColors } },
  'Lotus Petal': { mana: { amount: 1, colors: 'any', sacrifice: true } },
  'Mox Opal': {
    // Metalcraft: only while you control three or more artifacts.
    mana: { amount: 1, colors: 'any', when: (g, self) => g.players[self.controller].battlefield.filter((c) => hasType(g, c, 'Artifact')).length >= 3 },
  },
  'Mox Amber': {
    mana: {
      amount: 1,
      colors: (g, self) => {
        const legends = g.players[self.controller].battlefield.filter((c) => hasType(g, c, 'Legendary') && (isCreature(g, c) || hasType(g, c, 'Planeswalker')));
        return WUBRG.filter((x) => legends.some((c) => isColor(g, c, x as never)));
      },
    },
  },
  'Mana Vault': {
    noUntap: true,
    mana: { amount: 3, colors: ['C'] },
    // "At the beginning of your upkeep, you may pay {4}. If you do, untap this artifact."
    // It has no "if", so it always triggers. While it is untapped, paying would do nothing,
    // so nobody is asked.
    onUpkeep: {
      when: (_g, { self, player }) => player === self.controller,
      resolve: (g, { you, self }) => {
        const vault = permanent(g, self.id);
        if (vault?.tapped) ask(g, you, { text: `Pay {4} to untap ${label(vault)}?`, cost: '{4}', yes: 'Pay {4}', no: "Don't Pay", then: 'untap' });
      },
    },
    // "At the beginning of your draw step, if this artifact is tapped" checks again as it resolves (603.4).
    onDrawStep: {
      when: (_g, { self, player }) => player === self.controller && self.tapped,
      resolve: (g, { self, you }) => {
        const vault = permanent(g, self.id);
        if (vault?.tapped) damagePlayer(g, vault, you, 1);
      },
    },
    then: {
      untap: (g, { self, yes }) => {
        const vault = permanent(g, self.id);
        if (yes && vault) vault.tapped = false;
      },
    },
  },
  'Simian Spirit Guide': { mana: { amount: 1, colors: ['R'], fromHand: true } },
  'Dark Ritual': ritual(() => ['B', 'B', 'B']),
  // Threshold: seven or more cards in your graveyard as it resolves.
  'Cabal Ritual': ritual((g, { you }) => Array<ManaSym>(g.players[you].graveyard.length >= 7 ? 5 : 3).fill('B')),
  'Rite of Flame': ritual((g) => Array<ManaSym>(2 + g.players.reduce((n, p) => n + p.graveyard.filter((c) => c.name === 'Rite of Flame').length, 0)).fill('R')),
  'Culling the Weak': {
    additionalCost: { sacrifice: { type: 'creature', who: 'you', label: 'a creature to sacrifice' } },
    ...ritual(() => ['B', 'B', 'B', 'B']),
  },

  // ===== Tutors =====
  'Demonic Tutor': tutor('hand'),
  'Diabolic Intent': tutor('hand', undefined, { additionalCost: { sacrifice: { type: 'creature', who: 'you', label: 'a creature to sacrifice' } } }),
  Gamble: tutor('hand', undefined, {
    // "Put that card into your hand, discard a card at random, then shuffle."
    onResolve: (g, { you }) => search(g, you, 'hand', undefined, { then: 'discard' }),
    then: { discard: (g, { you }) => discardAtRandom(g, you) },
  }),
  'Vampiric Tutor': tutor('top', undefined, {
    onResolve: (g, { you }) => search(g, you, 'top', undefined, { then: 'pay' }),
    then: { pay: (g, { you }) => void loseLife(g, you, 2) },
  }),
  'Imperial Seal': tutor('top', undefined, {
    onResolve: (g, { you }) => search(g, you, 'top', undefined, { then: 'pay' }),
    then: { pay: (g, { you }) => void loseLife(g, you, 2) },
  }),
  'Enlightened Tutor': tutor('top', { types: ['Artifact', 'Enchantment'], label: 'an artifact or enchantment card' }),
  'Mystical Tutor': tutor('top', { types: ['Instant', 'Sorcery'], label: 'an instant or sorcery card' }),
  'Ranger-Captain of Eos': {
    // "You may search": finding nothing is always allowed (701.23b).
    onEnter: (g, { you }) => search(g, you, 'hand', { types: ['Creature'], maxMv: 1, label: 'a creature card with mana value 1 or less' }, { reveal: true }),
    activated: {
      cost: { sacrifice: true },
      text: "Sacrifice: your opponents can't cast noncreature spells this turn",
      resolve: (g, { you }) => {
        for (const o of opponentsOf(g, you)) addEffect(g, { kind: 'cantCast', player: o.id, noncreature: true });
      },
    },
  },

  // ===== Counterspells =====
  'Force of Will': counterspell(anySpell, undefined, {
    alternativeCosts: [{ label: 'Pay 1 life, exile a blue card', mana: '', life: 1, exile: blueCard }],
  }),
  'Force of Negation': counterspell(
    noncreatureSpell,
    undefined,
    {
      alternativeCosts: [{ label: 'Exile a blue card', mana: '', exile: blueCard, when: (g, self) => g.active !== self.controller }],
      // "If that spell is countered this way, exile it instead of putting it into its owner's graveyard."
      onResolve: (g, { targets }) => void counter(g, targets[0], { exile: true }),
    },
  ),
  'Pact of Negation': counterspell(anySpell, (g, { self, you }) => delay(g, self, you, { key: 'pay', step: 'upkeep', player: you }), {
    delayed: {
      pay: (g, { you }) => ask(g, you, { text: 'Pay {3}{U}{U}, or you lose the game.', cost: '{3}{U}{U}', yes: 'Pay {3}{U}{U}', no: 'Lose the Game', then: 'paid' }),
    },
    then: { paid: (g, { you, yes }) => !yes && loseGame(g, you, 'Pact of Negation') },
    botChoice: { paid: (g, pid, choice) => ({ type: 'answer', yes: choice.kind === 'ask' && canPay(g, pid, choice) }) },
    // A bot casts it only if it could pay {3}{U}{U} once its permanents untap.
    botCast: (g, pid) => canPayLater(g, pid, '{3}{U}{U}'),
  }),
  'Fierce Guardianship': counterspell(noncreatureSpell, undefined, {
    alternativeCosts: [{ label: 'Free (you control a commander)', mana: '', when: controlsCommander }],
  }),
  'Swan Song': counterspell(
    spell('target enchantment, instant, or sorcery spell', (g, c) => ['Enchantment', 'Instant', 'Sorcery'].some((x) => hasType(g, c, x))),
    // "Its controller creates a 2/2 blue Bird creature token with flying."
    (g, _ctx, controller) => void createToken(g, controller, 'Bird 2/2 flying'),
  ),
  // X counts while the spell is on the stack (202.3e).
  'Mental Misstep': counterspell(spell('target spell with mana value 1', (_g, c) => manaValue(c) === 1)),
  // "Its controller creates two Treasure tokens."
  "An Offer You Can't Refuse": counterspell(noncreatureSpell, (g, _ctx, controller) => void createToken(g, controller, 'Treasure', 2)),
  Flusterstorm: {
    targets: [spell('target instant or sorcery spell', (g, c) => hasType(g, c, 'Instant') || hasType(g, c, 'Sorcery'))],
    onResolve: (g, { self, targets }) => {
      const item = refStack(g, targets[0]);
      if (item) payOr(g, item.controller, '{1}', `Pay {1}, or ${label(item.card)} is countered (${label(self)}).`);
    },
    then: { unpaid: (g, { yes, targets }) => !yes && void counter(g, targets[0]) },
  },
  'Red Elemental Blast': {
    modal: {
      min: 1,
      max: 1,
      modes: [
        { text: 'Counter target blue spell', targets: [spell('target blue spell', (g, c) => isColor(g, c, 'U'))], resolve: (g, { targets }) => void counter(g, targets[0]) },
        {
          text: 'Destroy target blue permanent',
          targets: [{ type: 'permanent', label: 'target blue permanent', filter: (g, c) => isColor(g, c, 'U') }],
          resolve: (g, { targets }) => void destroy(g, refCard(g, targets[0])),
        },
      ],
    },
  },
  Snapback: {
    alternativeCosts: [{ label: 'Exile a blue card', mana: '', exile: blueCard }],
    targets: [{ type: 'creature', label: 'target creature' }],
    onResolve: (g, { targets }) => bounce(g, refCard(g, targets[0])),
  },

  // ===== Stax and speed =====
  Silence: {
    onResolve: (g, { you }) => {
      // The opponents it affects are the ones in the game as it resolves (611.2c).
      for (const o of opponentsOf(g, you)) addEffect(g, { kind: 'cantCast', player: o.id });
      log(g, `${whose(g.players[you])} opponents can't cast spells this turn.`, you);
    },
  },
  'Grand Abolisher': {
    // During your turn, opponents can't cast spells or activate abilities of artifacts, creatures, or enchantments.
    forbids: (g, self, pid, act) =>
      g.active === self.controller && pid !== self.controller && (act.kind === 'cast' || ['Artifact', 'Creature', 'Enchantment'].some((x) => hasType(g, act.card, x))),
  },
  'Voice of Victory': {
    forbids: (g, self, pid, act) => g.active === self.controller && pid !== self.controller && act.kind === 'cast',
    // Mobilize 2 (702.181a): two tapped and attacking 1/1 red Warriors, sacrificed at the beginning of the next end step.
    onAttack: (g, { self, you, defender, target }) => {
      const tokens = createToken(g, you, 'Warrior', 2, { tapped: true });
      for (const t of tokens) g.combat?.attacks.push({ id: t.id, defender, target, blockers: [], blocked: false });
      if (tokens.length) delay(g, self, you, { key: 'sacrifice', step: 'end', data: { ids: tokens.map((t) => t.id) } });
    },
    delayed: {
      sacrifice: (g, { data }) => {
        for (const id of data.ids as string[]) {
          const t = permanent(g, id);
          if (t) sacrifice(g, t);
        }
      },
    },
  },
  'Valley Floodcaller': {
    grantsFlash: (g, self, pid, spell) => pid === self.controller && !isCreature(g, spell),
    onCast: {
      when: (g, { self, card, caster }) => caster === self.controller && !isCreature(g, card),
      resolve: (g, { you }) => {
        for (const c of creaturesOf(g, you)) {
          if (!['Bird', 'Frog', 'Otter', 'Rat'].some((x) => hasType(g, c, x))) continue;
          pump(g, c, 1, 1);
          c.tapped = false;
        }
      },
    },
  },
  'Borne Upon a Wind': {
    onResolve: (g, { you }) => {
      addEffect(g, { kind: 'flash', player: you });
      draw(g, you);
    },
  },

  // ===== Card draw =====
  'Rhystic Study': {
    onCast: { when: opponentCasts(), resolve: (g, { self, you, caster }) => drawUnlessPays(g, you, caster, '{1}', self) },
    then: mayDrawUnlessPaid,
    botChoice: { draw: botDraws },
  },
  'Mystic Remora': {
    // Cumulative upkeep {1} (702.24a): an age counter, then pay {1} for each or sacrifice it.
    onUpkeep: {
      when: (_g, { self, player }) => player === self.controller,
      resolve: (g, { self, you }) => {
        const remora = permanent(g, self.id);
        if (!remora) return;
        remora.counters.age = (remora.counters.age ?? 0) + 1;
        const cost = `{${remora.counters.age}}`;
        ask(g, you, { text: `Pay ${cost} to keep ${label(remora)}, or sacrifice it.`, cost, yes: `Pay ${cost}`, no: 'Sacrifice It', then: 'upkeep' });
      },
    },
    onCast: { when: opponentCasts(true), resolve: (g, { self, you, caster }) => drawUnlessPays(g, you, caster, '{4}', self) },
    then: {
      ...mayDrawUnlessPaid,
      upkeep: (g, { self, yes }) => {
        const remora = permanent(g, self.id);
        if (!yes && remora) sacrifice(g, remora);
      },
    },
    botChoice: {
      draw: botDraws,
      // Keep it while it is cheap.
      upkeep: (g, pid, choice) => ({ type: 'answer', yes: choice.kind === 'ask' && canPay(g, pid, choice) && (permanent(g, resolvingSelf(g))?.counters.age ?? 0) <= 3 }),
    },
  },
  'Esper Sentinel': {
    // "Whenever an opponent casts their first noncreature spell each turn, draw a card unless that player pays {X}, where X is this creature's power."
    onCast: {
      when: (g, e) => opponentCasts(true)(g, e) && g.players[e.caster].noncreatureSpellsCast === 1,
      resolve: (g, { self, you, caster }) => drawsUnlessPays(g, you, caster, `{${Math.max(0, stats(g, permanent(g, self.id) ?? self).power)}}`, self),
    },
    then: { taxedDraw: (g, { you, yes }) => !yes && draw(g, you) },
  },
  'Smothering Tithe': {
    onDraw: {
      when: (g, { self, player }) => isOpponent(g, self.controller, player),
      resolve: (g, { self, player }) => payOr(g, player, '{2}', `Pay {2}, or ${g.players[self.controller].you ? 'you create' : `${g.players[self.controller].name} creates`} a Treasure (${label(self)}).`),
    },
    then: { unpaid: (g, { you, yes }) => !yes && void createToken(g, you, 'Treasure') },
  },
  'Gleaming Splendor': {
    onDraw: {
      when: (g, { self, player }) => isOpponent(g, self.controller, player) && g.players[player].drawn === 2,
      resolve: (g, { you }) => void createToken(g, you, 'Treasure'),
    },
    activated: {
      cost: { mana: '{2}{W}' },
      targets: [
        { type: 'player', label: 'target player' },
        { type: 'player', label: 'another target player', distinctFrom: 0 },
      ],
      text: '{2}{W}: Two target players each draw a card',
      resolve: (g, { targets }) => {
        for (const t of targets) {
          const p = refPlayer(g, t);
          if (p) draw(g, p.id);
        }
      },
    },
  },
  'Tataru Taru': {
    targets: [{ type: 'player', who: 'opponent', label: 'target opponent' }],
    onEnter: (g, { you, targets }) => {
      draw(g, you);
      const o = refPlayer(g, targets[0]);
      if (o) ask(g, o.id, { text: 'You may draw a card (Tataru Taru).', yes: 'Draw', no: "Don't Draw", then: 'draw' });
    },
    then: { draw: (g, { chooser, yes }) => yes && draw(g, chooser) },
    // Scions' Secretary: "Whenever an opponent draws a card, if it isn't that player's turn,
    // create a tapped Treasure token. This ability triggers only once each turn." The "if" is
    // checked again as it resolves (603.4).
    onDraw: {
      when: (g, { self, player }) => {
        if (!isOpponent(g, self.controller, player) || g.active === player || self.once.secretary === g.turn) return false;
        self.once.secretary = g.turn;
        return true;
      },
      resolve: (g, { you, player }) => g.active !== player && void createToken(g, you, 'Treasure', 1, { tapped: true }),
    },
    botChoice: { draw: botDraws },
  },
  "Kraum, Ludevic's Opus": {
    onCast: {
      when: (g, e) => isOpponent(g, e.self.controller, e.caster) && g.players[e.caster].spellsCast === 2,
      resolve: (g, { you }) => draw(g, you),
    },
  },
  'Tymna the Weaver': {
    // "At the beginning of each of your postcombat main phases, you may pay X life, where X
    // is the number of opponents that were dealt combat damage this turn. If you do, draw X
    // cards." It always triggers; X is worked out as it resolves, counting combat damage from
    // any source. With X = 0 there is nothing to pay or draw, so nobody is asked.
    onPostcombatMain: {
      when: (_g, { self, player }) => player === self.controller,
      resolve: (g, { you }) => {
        const x = g.combatDamaged.filter((p) => isOpponent(g, you, p)).length;
        if (x) ask(g, you, { text: `Pay ${x} life to draw ${x} card${x === 1 ? '' : 's'}?`, life: x, yes: `Pay ${x} Life`, no: "Don't Pay", then: 'draw', data: { x } });
      },
    },
    then: { draw: (g, { you, yes, data }) => yes && draw(g, you, data.x as number) },
  },
  'Lotho, Corrupt Shirriff': {
    onCast: {
      when: (g, e) => g.players[e.caster].spellsCast === 2,
      resolve: (g, { you }) => {
        loseLife(g, you, 1);
        createToken(g, you, 'Treasure');
      },
    },
  },
  'The Queen of Dale': {
    onCast: {
      when: (g, e) => opponentCasts(true)(g, e) && g.players[e.caster].noncreatureSpellsCast === 1,
      resolve: (g, { you }) => recruit(g, you),
    },
    then: {
      recruited: (g, { you, picked }) => {
        const [c] = picked;
        if (!c) return;
        discard(g, c);
        if (!hasType(g, c, 'Land')) createToken(g, you, 'Human Soldier');
      },
    },
    // A bot discards the card it wants least.
    botChoice: { recruited: (g, pid, choice) => ({ type: 'chooseCards', cards: leastWanted(g, pid, choice) }) },
  },
  'Wheel of Fortune': {
    // Each player discards their hand, then each draws seven, the active player first (121.2c).
    onResolve: (g) => {
      for (const pid of turnOrder(g, g.active)) for (const c of [...g.players[pid].hand]) discard(g, c);
      for (const pid of turnOrder(g, g.active)) draw(g, pid, 7);
    },
  },

  // ===== Winning =====
  "Thassa's Oracle": {
    // Look at the top X (devotion to blue), keep up to one on top, the rest on the bottom in a
    // random order. Then, if X is at least the cards left in the library, you win.
    onEnter: (g, { you }) => {
      const x = devotion(g, you, 'U');
      const top = g.players[you].library.slice(0, x);
      if (top.length) pickCards(g, you, top, { max: 1, text: 'keep up to one card on top', button: 'Done', then: 'arrange', data: { x } });
      else oracleCheck(g, you, x);
    },
    then: {
      arrange: (g, { you, picked, data }) => {
        const x = data.x as number;
        const top = g.players[you].library.slice(0, x);
        putOnBottomRandomly(g, top.filter((c) => !picked.some((p) => p.id === c.id)));
        oracleCheck(g, you, x);
      },
    },
  },
  'Demonic Consultation': {
    // With its own Thassa's Oracle on the stack, a bot names a card that can't be in its
    // library, its commander, to exile the whole library. Otherwise the card it wants most.
    botChoice: {
      named: (g, pid) => {
        if (oracleOnStack(g, pid)) return { type: 'name', name: g.players[pid].commanders[0] };
        const lib = [...g.players[pid].library].sort((a, b) => cardWant(g, pid, b) - cardWant(g, pid, a));
        return { type: 'name', name: lib.length ? data(lib[0]).name : 'Island' };
      },
    },
    onResolve: (g, { you }) =>
      nameCard(g, you, { text: 'Name a card. The top six cards are exiled, then cards until the named one, which goes to your hand.', then: 'named' }),
    then: {
      named: (g, { you, name }) => {
        const lib = g.players[you].library;
        const exiled = lib.slice(0, 6);
        for (const c of exiled) moveCard(g, c, 'exile');
        if (exiled.length) log(g, `${says(g.players[you], 'exiles')} ${exiled.map(label).join(', ')}.`, you, exiled);
        const rest: Card[] = [];
        while (lib.length) {
          const c = lib[0];
          if (hasName(c, name)) {
            log(g, `${says(g.players[you], 'reveals')} ${label(c)} and puts it into ${their(g.players[you])} hand.`, you, [c]);
            moveCard(g, c, 'hand');
            break;
          }
          rest.push(c);
          moveCard(g, c, 'exile');
        }
        if (rest.length) log(g, `${says(g.players[you], 'exiles')} ${rest.length} more card${rest.length === 1 ? '' : 's'}.`, you);
      },
    },
  },
  'Tainted Pact': {
    onResolve: (g, ctx) => taintedPact(g, ctx.you, []),
    then: {
      take: (g, { you, yes, data }) => {
        const card = g.players[you].exile.find((c) => c.id === data.card);
        if (yes && card) {
          log(g, `${says(g.players[you], 'puts')} ${label(card)} into ${their(g.players[you])} hand.`, you, [card]);
          moveCard(g, card, 'hand');
        } else taintedPact(g, you, data.names as string[]);
      },
    },
    botChoice: {
      take: (g, pid) => {
        const card = g.players[pid].exile.find((c) => c.id === (choiceData(g)?.card as string));
        // With its own Thassa's Oracle on the stack, a bot takes nothing: the library is to be emptied.
        return { type: 'answer', yes: !!card && !oracleOnStack(g, pid) && wants(g, pid, card) };
      },
    },
  },
  'Brain Freeze': {
    targets: [{ type: 'player', label: 'target player' }],
    onResolve: (g, { targets }) => {
      const p = refPlayer(g, targets[0]);
      if (p) mill(g, p.id, 3);
    },
  },
  'Final Fortune': { ai: 'extraTurn', onResolve: (g, { self, you }) => extraTurn(g, you, { loseAtEnd: self }) },
  'Last Chance': { ai: 'extraTurn', onResolve: (g, { self, you }) => extraTurn(g, you, { loseAtEnd: self }) },
});

// ---------- session 7b: graveyard, exile and odd cards ----------

/** The card types among cards in a player's graveyard (205.2a), for delirium. */
const CARD_TYPES = ['Artifact', 'Battle', 'Creature', 'Enchantment', 'Instant', 'Kindred', 'Land', 'Planeswalker', 'Sorcery'];
const delirium = (g: Game, pid: PlayerId) => CARD_TYPES.filter((t) => g.players[pid].graveyard.some((c) => hasType(g, c, t))).length >= 4;

/** "You may play / cast [cards] this turn": a permission for each card, while it stays the same object. */
export function mayCast(g: Game, pid: PlayerId, cards: Card[], opts: { play?: boolean; anyMana?: boolean } = {}) {
  for (const c of cards) addEffect(g, { kind: 'mayCast', player: pid, card: c.id, moves: c.moves, ...opts });
}

/** Exiles the top `n` cards of a player's library face up, and returns them. */
export function exileTop(g: Game, pid: PlayerId, n: number): Card[] {
  const cards = g.players[pid].library.slice(0, n);
  for (const c of cards) moveCard(g, c, 'exile');
  if (cards.length) log(g, `${says(g.players[pid], 'exiles')} ${cards.map(label).join(', ')} from the top of ${their(g.players[pid])} library.`, pid, cards);
  return cards;
}

/** A player's name as the subject of a log line about them: "You" or "Ludevic". */
const who = (g: Game, pid: PlayerId) => g.players[pid].name;

/** One step of Ad Nauseam: "Reveal the top card of your library and put that card into your hand. You lose life equal to its mana value." */
function adNauseam(g: Game, pid: PlayerId) {
  const top = g.players[pid].library[0];
  if (!top) return;
  log(g, `${says(g.players[pid], 'reveals')} ${label(top)} and ${verbFor(g.players[pid], 'puts')} it into ${their(g.players[pid])} hand.`, pid, [top]);
  moveCard(g, top, 'hand');
  loseLife(g, pid, manaValue(top));
  // "You may repeat this process any number of times."
  if (g.players[pid].library.length) ask(g, pid, { text: `Reveal another card? You have ${g.players[pid].life} life.`, yes: 'Reveal Another', no: 'Stop', then: 'again' });
}

/** The creature type a bot picks: the one most common among the creatures in its deck that it hasn't played yet. */
export function favouriteType(g: Game, pid: PlayerId): string {
  const p = g.players[pid];
  const counts = new Map<string, number>();
  for (const c of [...p.library, ...p.hand, ...p.command]) {
    if (!isCreature(g, c)) continue;
    for (const t of data(c).typeLine.split(' — ')[1]?.split(' ') ?? []) if (CREATURE_TYPES.includes(t)) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Human';
}

/** A bot's answer to a card choice. */
const pickCard = (cards: string[]) => ({ type: 'chooseCards' as const, cards });

registerScripts({
  'Underworld Breach': {
    // "Each nonland card in your graveyard has escape. The escape cost is equal to the card's
    // mana cost plus exile three other cards from your graveyard." (702.138a)
    grantsEscape: (_g, self, c) => c.owner === self.controller,
    // "At the beginning of the end step, sacrifice this enchantment." Every end step, anyone's.
    onEndStep: (g) => {
      const breach = abilitySource(g);
      if (breach) sacrifice(g, breach);
    },
  },
  'Mnemonic Betrayal': {
    onResolve: (g, { self, you }) => {
      // "Exile all opponents' graveyards."
      const exiled: Card[] = [];
      for (const o of opponentsOf(g, you)) {
        const cards = [...o.graveyard];
        for (const c of cards) moveCard(g, c, 'exile');
        if (cards.length) log(g, `${o.name}'s graveyard is exiled: ${cards.map(label).join(', ')}.`, you, cards);
        exiled.push(...cards);
      }
      // "You may cast spells from among those cards this turn, and mana of any type can be spent to cast them."
      mayCast(g, you, exiled, { anyMana: true });
      // "At the beginning of the next end step, if any of those cards remain exiled, return them to their owners' graveyards."
      if (exiled.length) delay(g, self, you, { key: 'return', step: 'end', data: { cards: exiled.map((c) => ({ id: c.id, moves: c.moves })) } });
      // "Exile Mnemonic Betrayal." Instead of its owner's graveyard (608.2n). A copy just ceases to exist.
      if (!self.isToken) {
        log(g, `${label(self)} is exiled.`, you, [self]);
        moveCard(g, self, 'exile');
      }
    },
    delayedIf: { return: (g, data) => betrayed(g, data).length > 0 },
    delayed: {
      return: (g, { data }) => {
        const cards = betrayed(g, data);
        for (const c of cards) moveCard(g, c, 'graveyard');
        if (cards.length) log(g, `${cards.map(label).join(', ')} ${cards.length === 1 ? 'returns' : 'return'} to ${cards.length === 1 ? "its owner's graveyard" : "their owners' graveyards"}.`, undefined, cards);
      },
    },
  },
  Necropotence: {
    // "Skip your draw step." (614.1b)
    skipDrawStep: true,
    // "Whenever you discard a card, exile that card from your graveyard."
    onDiscard: {
      when: (_g, { self, player }) => player === self.controller,
      resolve: (g, { card }) => {
        const c = g.players[card.owner].graveyard.find((x) => sameCard(x, card));
        if (!c) return;
        log(g, `${label(c)} is exiled from ${g.players[c.owner].you ? 'your' : `${g.players[c.owner].name}'s`} graveyard (Necropotence).`, c.owner, [c]);
        moveCard(g, c, 'exile');
      },
    },
    // "Pay 1 life: Exile the top card of your library face down. Put that card into your hand at the beginning of your next end step."
    activated: {
      cost: { life: 1 },
      text: 'Pay 1 life: exile the top card of your library face down; it goes to your hand at your next end step',
      resolve: (g, { self, you }) => {
        const top = g.players[you].library[0];
        if (!top) return;
        moveCard(g, top, 'exile');
        top.faceDown = true; // nobody may look at it, its owner included (406.3)
        log(g, `${says(g.players[you], 'exiles')} the top card of ${their(g.players[you])} library face down.`, you);
        delay(g, self, you, { key: 'hand', step: 'end', player: you, data: { id: top.id, moves: top.moves } });
      },
    },
    delayed: {
      hand: (g, { you, data }) => {
        const c = g.players[you].exile.find((x) => sameCard(x, data as { id: string; moves: number }));
        if (!c) return;
        moveCard(g, c, 'hand');
        log(g, `${says(g.players[you], 'puts')} a card exiled with Necropotence into ${their(g.players[you])} hand.`, you);
      },
    },
    // Bots pay a life a card in their second main phase while they have plenty, up to a full hand.
    botActivate: (g, pid) => {
      const p = g.players[pid];
      const coming = g.delayed.filter((d) => d.controller === pid && d.key === 'hand').length;
      return g.active === pid && g.step === 'main2' && p.life > 16 && p.hand.length + coming < 7 && p.library.length > 5;
    },
  },
  'Ad Nauseam': {
    onResolve: (g, { you }) => adNauseam(g, you),
    then: { again: (g, { you, yes }) => yes && adNauseam(g, you) },
    // Bots keep going while they stay at a safe life total.
    botChoice: { again: (g, pid) => ({ type: 'answer', yes: g.players[pid].life > 12 && g.players[pid].library.length > 5 }) },
  },
  Intuition: {
    targets: [{ type: 'player', who: 'opponent', label: 'target opponent' }],
    // "Search your library for three cards and reveal them." They must be found if they can be (701.23d).
    onResolve: (g, { you }) => search(g, you, 'none', undefined, { count: 3, reveal: true, then: 'found' }),
    then: {
      // "Target opponent chooses one."
      found: (g, { you, targets, picked }) => {
        const o = refPlayer(g, targets[0]);
        if (!o || !picked.length) return;
        pickCards(g, o.id, picked, { min: 1, max: 1, text: `choose the card ${g.players[you].you ? 'you put into your' : `${who(g, you)} puts into their`} hand`, button: 'Choose', then: 'chosen', data: { cards: picked.map((c) => c.id) } });
      },
      // "Put that card into your hand and the rest into your graveyard. Then shuffle."
      chosen: (g, { you, picked, data }) => {
        const lib = g.players[you].library;
        for (const id of data.cards as string[]) {
          const c = lib.find((x) => x.id === id);
          if (!c) continue;
          const toHand = picked.some((x) => x.id === id);
          moveCard(g, c, toHand ? 'hand' : 'graveyard');
          log(g, `${label(c)} goes to ${who(g, you)}'s ${toHand ? 'hand' : 'graveyard'}.`, you, [c]);
        }
        shuffle(g, lib);
      },
    },
    // The opponent gives the caster the card it would want least.
    botChoice: {
      chosen: (g, _pid, choice) => {
        const caster = resolvingItem(g)!.controller;
        const cards = choice.kind === 'pick' ? choice.cards.map((id) => findCard(g, id)!) : [];
        return pickCard([...cards].sort((a, b) => cardWant(g, caster, a) - cardWant(g, caster, b)).slice(0, 1).map((c) => c.id));
      },
    },
  },
  Mockingbird: {
    // "You may have this creature enter as a copy of any creature on the battlefield with mana
    // value less than or equal to the amount of mana spent to cast this creature, except it's a
    // Bird in addition to its other types and it has flying." A replacement effect (614.1c):
    // the choice is made before it enters (614.12a). Not cast, no mana was spent.
    replaceEnter: (g, c, controller) => {
      const spent = c.zone === 'stack' ? (c.cast?.spent ?? 0) : 0;
      const options = g.players.flatMap((p) => (p.lost ? [] : p.battlefield)).filter((x) => isCreature(g, x) && manaValue(x) <= spent);
      if (!options.length) return false;
      pickCards(g, controller, options, { min: 0, max: 1, text: `you may have it enter as a copy of a creature with mana value ${spent} or less`, button: 'Copy', then: 'copy', script: c.id });
      return true;
    },
    then: {
      copy: (g, { self, picked, data }) => finishEnter(g, self, data, picked[0] ? { copy: copyOf(picked[0], { subtypes: ['Bird'], keywords: ['Flying'] }) } : {}),
    },
    // Bots copy the best creature, if it beats a 1/1 flier.
    botChoice: {
      copy: (g, _pid, choice) => {
        const cards = choice.kind === 'pick' ? choice.cards.map((id) => permanent(g, id)!).filter(Boolean) : [];
        const best = [...cards].sort((a, b) => threat(g, b) - threat(g, a))[0];
        return pickCard(best && threat(g, best) > 3 ? [best.id] : []);
      },
    },
  },
  'Deflecting Swat': {
    // "If you control a commander, you may cast this spell without paying its mana cost."
    alternativeCosts: [{ label: 'Free (you control a commander)', mana: '', when: controlsCommander }],
    // "You may choose new targets for target spell or ability." (115.7d)
    targets: [{ type: 'spell or ability', label: 'target spell or ability' }],
    onResolve: (g, { you, targets }) => {
      const item = refStack(g, targets[0]);
      if (item) offerRetarget(g, you, item);
    },
  },
  'Chain of Vapor': {
    // "Return target nonland permanent to its owner's hand."
    targets: [{ type: 'permanent', label: 'target nonland permanent', filter: (g, c) => !isLand(g, c) }],
    onResolve: (g, { targets }) => {
      const c = refCard(g, targets[0]);
      if (!c) return;
      const controller = c.controller;
      bounce(g, c);
      // "Then that permanent's controller may sacrifice a land of their choice."
      const lands = g.players[controller].battlefield.filter((x) => isLand(g, x));
      if (lands.length) pickCards(g, controller, lands, { min: 0, max: 1, text: 'you may sacrifice a land to copy Chain of Vapor', button: 'Sacrifice', then: 'sacrificed' });
    },
    then: {
      // "If the player does, they may copy this spell and may choose a new target for that copy."
      sacrificed: (g, { chooser, picked }) => {
        const land = picked[0] && permanent(g, picked[0].id);
        if (!land) return;
        sacrifice(g, land);
        ask(g, chooser, { text: 'Copy Chain of Vapor? You may choose a new target for the copy.', yes: 'Copy', no: "Don't Copy", then: 'copy' });
      },
      copy: (g, { chooser, yes }) => {
        const item = resolvingItem(g);
        if (yes && item) copyItem(g, item, chooser);
      },
    },
    // Bots keep their lands.
    botChoice: { sacrificed: () => pickCard([]) },
  },
  'Wishclaw Talisman': {
    // "This artifact enters with three wish counters on it." (614.1c)
    entersWith: { wish: 3 },
    // "{1}, {T}, Remove a wish counter from this artifact: Search your library for a card, put it
    // into your hand, then shuffle. An opponent gains control of this artifact. Activate only
    // during your turn."
    activated: {
      cost: { mana: '{1}', tap: true, counters: { kind: 'wish', n: 1 } },
      when: (g, self) => g.active === self.controller,
      text: '{1}, {T}, remove a wish counter: search for a card; an opponent gains control of this',
      resolve: (g, { you }) => {
        search(g, you, 'hand');
        // The ability's controller chooses which opponent (109.5).
        choosePlayer(g, you, { text: 'Choose an opponent to gain control of Wishclaw Talisman.', options: opponentsOf(g, you).map((o) => o.id), then: 'give' });
      },
    },
    then: {
      give: (g, { player }) => {
        const talisman = abilitySource(g);
        if (talisman && player !== null) gainControl(g, talisman, player);
      },
    },
    // Bots give it to the opponent whose turn comes last. They use one an opponent gave them, and their own only to find a missing combo piece.
    botChoice: {
      give: (g, pid, choice) => {
        const options = choice.kind === 'player' ? choice.options : [];
        const order = turnOrder(g, pid).filter((x) => options.includes(x));
        return { type: 'choosePlayer', player: order[order.length - 1] ?? options[0] };
      },
    },
    botActivate: (g, pid, self) => self.owner !== pid || comboMissing(g, pid),
  },
  'Gemstone Caverns': {
    // "If this card is in your opening hand and you're not the starting player, you may begin the
    // game with Gemstone Caverns on the battlefield with a luck counter on it. If you do, exile a
    // card from your hand." (103.6a)
    openingHand: (g, self, pid) => {
      if (g.active === pid) return;
      ask(g, pid, {
        text: 'Begin the game with Gemstone Caverns on the battlefield with a luck counter on it? If you do, exile a card from your hand.',
        yes: 'Begin with It',
        no: 'Keep in Hand',
        then: 'begin',
        script: self.id,
      });
    },
    // "{T}: Add {C}. If Gemstone Caverns has a luck counter on it, instead add one mana of any color."
    mana: [
      { amount: 1, colors: ['C'], when: (_g, self) => !self.counters.luck },
      { amount: 1, colors: 'any', when: (_g, self) => !!self.counters.luck },
    ],
    then: {
      begin: (g, { self, you, yes }) => {
        if (!yes || self.zone !== 'hand') return;
        log(g, `${says(g.players[you], 'begins')} the game with Gemstone Caverns on the battlefield.`, you, [self]);
        enterBattlefield(g, self, { controller: you });
        const caverns = permanent(g, self.id);
        if (caverns) caverns.counters.luck = 1;
        const hand = g.players[you].hand;
        if (hand.length) pickCards(g, you, hand, { min: 1, max: 1, text: 'exile a card from your hand', button: 'Exile', then: 'exile', script: self.id });
      },
      exile: (g, { you, picked }) => {
        const c = picked[0];
        if (!c || c.zone !== 'hand') return;
        log(g, `${says(g.players[you], 'exiles')} ${label(c)} from ${their(g.players[you])} hand.`, you, [c]);
        moveCard(g, c, 'exile');
      },
    },
    botChoice: {
      begin: () => ({ type: 'answer', yes: true }),
      exile: (g, pid, choice) => pickCard(leastWanted(g, pid, choice)),
    },
  },
  'Cavern of Souls': {
    // "As this land enters, choose a creature type." (614.1c, 614.12a)
    replaceEnter: (g, c, controller) => {
      nameCard(g, controller, { text: 'Choose a creature type.', of: 'creature type', then: 'type', script: c.id });
      return true;
    },
    then: { type: (g, { self, name, data }) => finishEnter(g, self, data, { chosen: name }) },
    // "{T}: Add {C}." "{T}: Add one mana of any color. Spend this mana only to cast a creature
    // spell of the chosen type, and that spell can't be countered." (106.6)
    mana: [
      { amount: 1, colors: ['C'] },
      { amount: 1, colors: 'any', chosenType: true, uncounterable: true },
    ],
    botChoice: { type: (g, pid) => ({ type: 'name', name: favouriteType(g, pid) }) },
  },
  'Chrome Mox': {
    // "Imprint — When this artifact enters, you may exile a nonartifact, nonland card from your hand."
    onEnter: (g, { you }) => {
      const options = g.players[you].hand.filter((c) => !hasType(g, c, 'Artifact') && !isLand(g, c));
      if (options.length) pickCards(g, you, options, { min: 0, max: 1, text: 'you may exile a nonartifact, nonland card from your hand', button: 'Exile', then: 'imprint' });
    },
    then: {
      imprint: (g, { you, picked }) => {
        const c = picked[0];
        if (!c || c.zone !== 'hand') return;
        log(g, `${says(g.players[you], 'exiles')} ${label(c)} with Chrome Mox.`, you, [c]);
        moveCard(g, c, 'exile');
        // The mana ability is linked to the card exiled (607.2a), if the Mox is still the same object.
        const mox = abilitySource(g);
        if (mox) mox.linked = [{ id: c.id, moves: c.moves }];
      },
    },
    // "{T}: Add one mana of any of the exiled card's colors." No colour, no mana (106.5).
    mana: {
      amount: 1,
      colors: (g, self) => {
        const exiled = self.linked.map((l) => g.players.flatMap((p) => p.exile).find((x) => sameCard(x, l))).filter((x): x is Card => !!x);
        return WUBRG.filter((x) => exiled.some((c) => isColor(g, c, x as never)));
      },
    },
    // Bots exile the coloured card they want least, in one of their colours.
    botChoice: {
      imprint: (g, pid, choice) => {
        const cards = choice.kind === 'pick' ? choice.cards.map((id) => findCard(g, id)!) : [];
        const useful = cards.filter((c) => data(c).colors.some((x) => g.players[pid].colors.includes(x)));
        return pickCard([...useful].sort((a, b) => cardWant(g, pid, a) - cardWant(g, pid, b)).slice(0, 1).map((c) => c.id));
      },
    },
  },
  'Mox Diamond': {
    // "If this artifact would enter, you may discard a land card instead. If you do, put this
    // artifact onto the battlefield. If you don't, put it into its owner's graveyard."
    replaceEnter: (g, c, controller) => {
      const lands = g.players[controller].hand.filter((x) => isLand(g, x));
      if (!lands.length) {
        diamondToGraveyard(g, c);
        return true;
      }
      pickCards(g, controller, lands, { min: 0, max: 1, text: "you may discard a land card. If you don't, Mox Diamond goes to the graveyard", button: 'Discard', then: 'diamond', script: c.id });
      return true;
    },
    then: {
      diamond: (g, { self, picked, data }) => {
        const land = picked[0];
        if (land && land.zone === 'hand') {
          discard(g, land);
          finishEnter(g, self, data);
        } else diamondToGraveyard(g, self);
      },
    },
    // "{T}: Add one mana of any color."
    mana: { amount: 1, colors: 'any' },
    botChoice: { diamond: (g, pid, choice) => pickCard(leastWanted(g, pid, choice)) },
  },
  "Lion's Eye Diamond": {
    // "Discard your hand, Sacrifice this artifact: Add three mana of any one color. Activate only
    // as an instant." No {T} in the cost. Auto-pay never uses it.
    mana: { amount: 3, colors: 'any', noTap: true, sacrifice: true, discardHand: true, instant: true, manual: true },
  },
  'Ragavan, Nimble Pilferer': {
    // "Whenever Ragavan deals combat damage to a player, create a Treasure token and exile the top
    // card of that player's library. Until end of turn, you may cast that card."
    onCombatDamageToPlayer: (g, { you, player }) => {
      createToken(g, you, 'Treasure');
      const [top] = exileTop(g, player, 1);
      if (top) mayCast(g, you, [top]);
    },
    // "Dash {1}{R}" (702.109a): the engine gives haste and returns it at the next end step.
    alternativeCosts: [{ label: 'Dash {1}{R}', mana: '{1}{R}', dash: true }],
  },
  'Into the Flood Maw': {
    // "Return target creature an opponent controls to its owner's hand. If the gift was promised,
    // instead return target nonland permanent an opponent controls to its owner's hand."
    targets: [{ type: 'creature', who: 'opponent', label: 'target creature an opponent controls' }],
    // "Gift a tapped Fish" (702.174f): the promised player creates a tapped 1/1 blue Fish first (702.174j).
    gift: { token: 'Fish', tapped: true, targets: [{ type: 'permanent', who: 'opponent', label: 'target nonland permanent an opponent controls', filter: (g, c) => !isLand(g, c) }] },
    onResolve: (g, { targets }) => bounce(g, refCard(g, targets[0])),
  },
  'Beseech the Mirror': {
    // "Bargain" (702.166a): as an additional cost, you may sacrifice an artifact, enchantment, or token.
    additionalCost: {
      optional: true,
      sacrifice: { type: 'permanent', who: 'you', label: 'an artifact, enchantment, or token to sacrifice (bargain)', filter: (g, c) => c.isToken || hasType(g, c, 'Artifact') || hasType(g, c, 'Enchantment') },
    },
    ai: 'tutor',
    // "Search your library for a card, exile it face down, then shuffle."
    onResolve: (g, { you }) => search(g, you, 'none', undefined, { then: 'found' }),
    then: {
      found: (g, { self, you, picked }) => {
        const c = picked[0];
        if (!c) return;
        moveCard(g, c, 'exile');
        c.faceDown = true;
        c.known = [you]; // the player who searched saw it, and may still look (406.3)
        log(g, `${says(g.players[you], 'exiles')} a card face down.`, you);
        // "If this spell was bargained, you may cast the exiled card without paying its mana cost
        // if that spell's mana value is 4 or less. Put the exiled card into your hand if it wasn't cast this way."
        const ref = { id: c.id, moves: c.moves };
        if (self.cast?.bargained) {
          offerCast(g, you, c, { free: true, maxMv: 4, text: `You may cast ${label(c)} without paying its mana cost (mana value 4 or less). If you don't, it goes to your hand.`, then: 'cast', data: ref });
        } else toHand(g, you, ref);
      },
      cast: (g, { you, yes, data }) => !yes && toHand(g, you, data as { id: string; moves: number }),
    },
  },
  "Dragon's Rage Channeler": {
    // "Whenever you cast a noncreature spell, surveil 1." (701.25a)
    onCast: {
      when: (g, { self, card, caster }) => caster === self.controller && !isCreature(g, card),
      resolve: (g, { you }) => surveil(g, you, 1),
    },
    // "Delirium — As long as there are four or more card types among cards in your graveyard,
    // this creature gets +2/+2, has flying, and attacks each combat if able."
    static: (g, self, c) => (c.id === self.id && delirium(g, self.controller) ? { power: 2, toughness: 2, keywords: ['flying', MUST_ATTACK] } : null),
  },
  'Birgi, God of Storytelling': {
    // "Whenever you cast a spell, add {R}. Until end of turn, you don't lose this mana as steps and phases end."
    onCast: {
      when: (_g, { self, caster }) => caster === self.controller,
      resolve: (g, { self, you }) => addMana(g, you, ['R'], self, { keep: true }),
    },
    // "Creatures you control can boast twice during each of your turns rather than once."
    // No card in the game has boast, so there is nothing for this to change.
  },
  'Harnfel, Horn of Bounty': {
    // "Discard a card: Exile the top two cards of your library. You may play those cards this turn."
    activated: {
      cost: { discard: 1 },
      text: 'Discard a card: exile the top two cards of your library; you may play them this turn',
      resolve: (g, { you }) => mayCast(g, you, exileTop(g, you, 2), { play: true }),
    },
    // Bots trade a card they don't want for two new ones, in their main phase.
    botActivate: (g, pid) => g.active === pid && g.step === 'main1' && g.players[pid].hand.some((c) => cardWant(g, pid, c) <= 2) && g.players[pid].library.length > 4,
  },
  "Jeska's Will": {
    ai: 'ritual',
    modal: {
      min: 1,
      // "Choose one. If you control a commander as you cast this spell, you may choose both instead."
      max: (g, self) => (controlsCommander(g, self) ? 2 : 1),
      modes: [
        {
          // "Add {R} for each card in target opponent's hand."
          text: "Add {R} for each card in target opponent's hand",
          targets: [{ type: 'player', who: 'opponent', label: 'target opponent' }],
          resolve: (g, { self, you, targets }) => {
            const o = refPlayer(g, targets[0]);
            if (o) addMana(g, you, Array<ManaSym>(o.hand.length).fill('R'), self);
          },
        },
        {
          // "Exile the top three cards of your library. You may play them this turn."
          text: 'Exile the top three cards of your library. You may play them this turn',
          resolve: (g, { you }) => mayCast(g, you, exileTop(g, you, 3), { play: true }),
        },
      ],
    },
  },
  'Otawara, Soaring City': {
    // "{T}: Add {U}."
    mana: { amount: 1, colors: ['U'] },
    // "Channel — {3}{U}, Discard this card: Return target artifact, creature, enchantment, or
    // planeswalker to its owner's hand. This ability costs {1} less to activate for each
    // legendary creature you control."
    activated: {
      fromHand: true,
      cost: { mana: '{3}{U}', discardSelf: true },
      reduction: (g, self) => g.players[self.owner].battlefield.filter((c) => hasType(g, c, 'Legendary') && isCreature(g, c)).length,
      targets: [
        {
          type: 'permanent',
          label: 'target artifact, creature, enchantment, or planeswalker',
          filter: (g, c) => ['Artifact', 'Creature', 'Enchantment', 'Planeswalker'].some((t) => hasType(g, c, t)),
        },
      ],
      text: 'Channel: return target artifact, creature, enchantment, or planeswalker to its owner’s hand',
      resolve: (g, { targets }) => bounce(g, refCard(g, targets[0])),
    },
  },
  "Sevinne's Reclamation": {
    // "Return target permanent card with mana value 3 or less from your graveyard to the battlefield."
    targets: [
      {
        type: 'graveyard card',
        who: 'you',
        label: 'target permanent card with mana value 3 or less in your graveyard',
        filter: (g, c) => isPermanentCard(g, c) && manaValue(c) <= 3,
      },
    ],
    onResolve: (g, { self, you, targets }) => {
      const c = refGraveyard(g, targets[0]);
      if (c) {
        log(g, `${label(c)} returns to the battlefield.`, you, [c]);
        enterBattlefield(g, c, { controller: you });
      }
      // "If this spell was cast from a graveyard, you may copy this spell and may choose a new
      // target for the copy." A copy wasn't cast (707.10), so it can't copy itself again.
      if (self.cast?.from === 'graveyard') ask(g, you, { text: "Copy Sevinne's Reclamation? You may choose a new target for the copy.", yes: 'Copy', no: "Don't Copy", then: 'copy' });
    },
    then: {
      copy: (g, { you, yes }) => {
        const item = resolvingItem(g);
        if (yes && item) copyItem(g, item, you);
      },
    },
    // "Flashback {4}{W}"
    flashback: '{4}{W}',
  },
  'Flare of Duplication': {
    // "You may sacrifice a nontoken red creature rather than pay this spell's mana cost."
    alternativeCosts: [
      {
        label: 'Sacrifice a nontoken red creature',
        mana: '',
        sacrifice: { type: 'creature', who: 'you', label: 'a nontoken red creature to sacrifice', filter: (g, c) => !c.isToken && isColor(g, c, 'R') },
      },
    ],
    // "Copy target instant or sorcery spell. You may choose new targets for the copy." (707.10c)
    targets: [spell('target instant or sorcery spell', (g, c) => hasType(g, c, 'Instant') || hasType(g, c, 'Sorcery'))],
    onResolve: (g, { you, targets }) => copySpell(g, targets[0], you),
  },
  'Hexing Squelcher': {
    // "This spell can't be countered."
    uncounterable: true,
    // "Ward—Pay 2 life." (702.21a)
    ward: { life: 2 },
    // "Spells you control can't be countered."
    protectsSpell: (_g, self, _spell, caster) => caster === self.controller,
    // "Other creatures you control have 'Ward—Pay 2 life.'"
    grantsWard: (g, self, c) => (c.id !== self.id && c.controller === self.controller && isCreature(g, c) ? { life: 2 } : null),
  },
  'Rain of Filth': {
    // "Until end of turn, lands you control gain 'Sacrifice this land: Add {B}.'" Only the lands
    // you control as it resolves (611.2c).
    onResolve: (g, { you }) => {
      for (const c of g.players[you].battlefield.filter((x) => isLand(g, x))) {
        untilEndOfTurn(g, c, { mana: { amount: 1, colors: ['B'], noTap: true, sacrifice: true } });
      }
      log(g, `${whose(g.players[you])} lands gain "Sacrifice this land: Add {B}" until end of turn.`, you);
    },
  },
});

/** Mnemonic Betrayal's cards that are still in exile, as the same objects (400.7). */
function betrayed(g: Game, data: Record<string, unknown>): Card[] {
  const refs = data.cards as { id: string; moves: number }[];
  return g.players.flatMap((p) => p.exile).filter((c) => refs.some((r) => sameCard(c, r)));
}

/** Mox Diamond, not entering: "put it into its owner's graveyard". */
function diamondToGraveyard(g: Game, c: Card) {
  log(g, `${label(c)} goes to its owner's graveyard instead.`, c.owner, [c]);
  moveCard(g, c, 'graveyard');
}

/** Beseech the Mirror: "Put the exiled card into your hand", if it is still the card it exiled. */
function toHand(g: Game, pid: PlayerId, ref: { id: string; moves: number }) {
  const c = g.players[pid].exile.find((x) => sameCard(x, ref));
  if (!c) return;
  log(g, `${says(g.players[pid], 'puts')} the card exiled with Beseech the Mirror into ${their(g.players[pid])} hand.`, pid);
  moveCard(g, c, 'hand');
}

/**
 * Is a piece of the deck's win missing? Thassa's Oracle wins with Demonic Consultation or
 * Tainted Pact: a bot holding one half wants the other.
 */
function comboMissing(g: Game, pid: PlayerId): boolean {
  const hand = g.players[pid].hand.map((c) => c.name);
  const oracle = hand.includes("Thassa's Oracle");
  const enabler = hand.includes('Demonic Consultation') || hand.includes('Tainted Pact');
  return oracle !== enabler;
}

/** Thassa's Oracle's last sentence: "If X is greater than or equal to the number of cards in your library, you win the game." */
function oracleCheck(g: Game, pid: PlayerId, x: number) {
  if (x < g.players[pid].library.length) return;
  log(g, `${says(g.players[pid], 'has')} devotion ${x} with ${g.players[pid].library.length} card${g.players[pid].library.length === 1 ? '' : 's'} left in the library.`, pid);
  winGame(g, pid);
}

/**
 * Tainted Pact: exile the top card. It may go to your hand unless a card with the same
 * name was exiled this way before. Repeat until a card goes to your hand or a name repeats.
 */
function taintedPact(g: Game, pid: PlayerId, names: string[]) {
  const top = g.players[pid].library[0];
  if (!top) return;
  moveCard(g, top, 'exile');
  log(g, `${says(g.players[pid], 'exiles')} ${label(top)}.`, pid, [top]);
  if (names.includes(top.name)) return;
  ask(g, pid, {
    text: `Put ${label(top)} into your hand? If not, the next card is exiled.`,
    yes: 'Put into Hand',
    no: 'Exile the Next Card',
    then: 'take',
    data: { card: top.id, names: [...names, top.name] },
  });
}

/** The card id of the spell or ability now resolving (for a bot rule that needs its source). */
function resolvingSelf(g: Game): string {
  return g.stack.find((x) => x.id === g.resolving)?.card.id ?? '';
}

/** The data of the choice the game is waiting on. */
function choiceData(g: Game): Record<string, unknown> | undefined {
  const d = g.decision;
  return d && 'choice' in d && 'data' in d.choice ? d.choice.data : undefined;
}

/** Can the player pay what saying yes to `choice` costs? */
const canPay = (g: Game, _pid: PlayerId, choice: AskChoice) => canSayYes(g, choice);

/** The cards in a pick the bot wants least. */
function leastWanted(g: Game, pid: PlayerId, choice: Choice): string[] {
  if (choice.kind !== 'pick') return [];
  const cards = choice.cards.map((id) => g.players[pid].hand.find((c) => c.id === id)).filter((c): c is Card => !!c);
  return cards
    .sort((a, b) => cardWant(g, pid, a) - cardWant(g, pid, b))
    .slice(0, Math.max(choice.min, 1))
    .map((c) => c.id);
}
