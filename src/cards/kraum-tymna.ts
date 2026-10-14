// Card behaviour for the Kraum and Tymna deck (session 7a: the engine features its combo
// turns need). Cards that are still to come in session 7b have no entry yet; see
// docs/plans/commander-decks.md.
import { registerScripts } from '../engine/registry';
import {
  addEffect,
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
  search,
  stats,
  turnOrder,
  winGame,
} from '../engine/rules';
import { canPayLater, cardWant } from '../engine/ai';
import { canSayYes } from '../engine/engine';
import type { AskChoice, Card, CardScript, Choice, Ctx, Find, Game, ManaSym, PlayerId, TargetSpec } from '../engine/types';

// ---------- target specs and conditions ----------

const spell = (label: string, filter?: TargetSpec['filter']): TargetSpec => ({ type: 'spell', label, filter });
const anySpell = spell('target spell');
const noncreatureSpell = spell('target noncreature spell', (_g, c) => !isCreature(c));
const blueCard = { label: 'a blue card', filter: (_g: Game, c: Card) => isColor(c, 'U') };
const isOpponent = (g: Game, a: PlayerId, b: PlayerId) => a !== b && !g.players[b].lost;
const controlsCommander = (g: Game, self: Card) => g.players[self.owner].battlefield.some((c) => c.isCommander);
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
  const all = new Set(opponentsOf(g, self.owner).flatMap((o) => o.battlefield.filter((c) => hasType(c, 'Land')).flatMap((c) => landColors(g, c))));
  return WUBRG.filter((x) => all.has(x));
};

/**
 * "[Player] may draw a card unless that player pays {N}" (Rhystic Study, Mystic Remora):
 * the player who cast the spell decides whether to pay (118.12a), then if they don't, the
 * ability's controller decides whether to draw.
 */
function drawUnlessPays(g: Game, you: PlayerId, payer: PlayerId, cost: string, source: Card) {
  ask(g, payer, {
    text: `Pay ${cost}, or ${g.players[you].name === 'You' ? 'you' : g.players[you].name} may draw a card (${label(source)}).`,
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
    text: `Pay ${cost}, or ${g.players[you].name === 'You' ? 'you draw' : `${g.players[you].name} draws`} a card (${label(source)}).`,
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
    isOpponent(g, e.self.owner, e.caster) && (!noncreature || !isCreature(e.card));

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
      { amount: 1, colors: 'any', life: 1, when: (g, self) => g.players[self.owner].battlefield.some((c) => hasType(c, 'Artifact')) },
    ],
  },
  'Command Tower': { mana: { amount: 1, colors: 'identity' } },
  'Exotic Orchard': { mana: { amount: 1, colors: opponentLandColors } },

  // ===== Fast mana =====
  'Fellwar Stone': { mana: { amount: 1, colors: opponentLandColors } },
  'Lotus Petal': { mana: { amount: 1, colors: 'any', sacrifice: true } },
  'Mox Opal': {
    // Metalcraft: only while you control three or more artifacts.
    mana: { amount: 1, colors: 'any', when: (g, self) => g.players[self.owner].battlefield.filter((c) => hasType(c, 'Artifact')).length >= 3 },
  },
  'Mox Amber': {
    mana: {
      amount: 1,
      colors: (g, self) => {
        const legends = g.players[self.owner].battlefield.filter((c) => hasType(c, 'Legendary') && (isCreature(c) || hasType(c, 'Planeswalker')));
        return WUBRG.filter((x) => legends.some((c) => isColor(c, x as never)));
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
      when: (_g, { self, player }) => player === self.owner,
      resolve: (g, { you, self }) => {
        const vault = permanent(g, self.id);
        if (vault?.tapped) ask(g, you, { text: `Pay {4} to untap ${label(vault)}?`, cost: '{4}', yes: 'Pay {4}', no: "Don't Pay", then: 'untap' });
      },
    },
    // "At the beginning of your draw step, if this artifact is tapped" checks again as it resolves (603.4).
    onDrawStep: {
      when: (_g, { self, player }) => player === self.owner && self.tapped,
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
      alternativeCosts: [{ label: 'Exile a blue card', mana: '', exile: blueCard, when: (g, self) => g.active !== self.owner }],
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
    spell('target enchantment, instant, or sorcery spell', (_g, c) => ['Enchantment', 'Instant', 'Sorcery'].some((x) => hasType(c, x))),
    // "Its controller creates a 2/2 blue Bird creature token with flying."
    (g, _ctx, controller) => void createToken(g, controller, 'Bird 2/2 flying'),
  ),
  // X counts while the spell is on the stack (202.3e).
  'Mental Misstep': counterspell(spell('target spell with mana value 1', (_g, c) => manaValue(c) === 1)),
  // "Its controller creates two Treasure tokens."
  "An Offer You Can't Refuse": counterspell(noncreatureSpell, (g, _ctx, controller) => void createToken(g, controller, 'Treasure', 2)),
  Flusterstorm: {
    targets: [spell('target instant or sorcery spell', (_g, c) => hasType(c, 'Instant') || hasType(c, 'Sorcery'))],
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
        { text: 'Counter target blue spell', targets: [spell('target blue spell', (_g, c) => isColor(c, 'U'))], resolve: (g, { targets }) => void counter(g, targets[0]) },
        {
          text: 'Destroy target blue permanent',
          targets: [{ type: 'permanent', label: 'target blue permanent', filter: (_g, c) => isColor(c, 'U') }],
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
      log(g, `${g.players[you].isBot ? `${g.players[you].name}'s` : 'Your'} opponents can't cast spells this turn.`, you);
    },
  },
  'Grand Abolisher': {
    // During your turn, opponents can't cast spells or activate abilities of artifacts, creatures, or enchantments.
    forbids: (g, self, pid, act) =>
      g.active === self.owner && pid !== self.owner && (act.kind === 'cast' || ['Artifact', 'Creature', 'Enchantment'].some((x) => hasType(act.card, x))),
  },
  'Voice of Victory': {
    forbids: (g, self, pid, act) => g.active === self.owner && pid !== self.owner && act.kind === 'cast',
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
    grantsFlash: (_g, self, pid, spell) => pid === self.owner && !isCreature(spell),
    onCast: {
      when: (_g, { self, card, caster }) => caster === self.owner && !isCreature(card),
      resolve: (g, { you }) => {
        for (const c of creaturesOf(g, you)) {
          if (!['Bird', 'Frog', 'Otter', 'Rat'].some((x) => hasType(c, x))) continue;
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
      when: (_g, { self, player }) => player === self.owner,
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
      when: (g, { self, player }) => isOpponent(g, self.owner, player),
      resolve: (g, { self, player }) => payOr(g, player, '{2}', `Pay {2}, or ${g.players[self.owner].name === 'You' ? 'you create' : `${g.players[self.owner].name} creates`} a Treasure (${label(self)}).`),
    },
    then: { unpaid: (g, { you, yes }) => !yes && void createToken(g, you, 'Treasure') },
  },
  'Gleaming Splendor': {
    onDraw: {
      when: (g, { self, player }) => isOpponent(g, self.owner, player) && g.players[player].drawn === 2,
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
        if (!isOpponent(g, self.owner, player) || g.active === player || self.once.secretary === g.turn) return false;
        self.once.secretary = g.turn;
        return true;
      },
      resolve: (g, { you, player }) => g.active !== player && void createToken(g, you, 'Treasure', 1, { tapped: true }),
    },
    botChoice: { draw: botDraws },
  },
  "Kraum, Ludevic's Opus": {
    onCast: {
      when: (g, e) => isOpponent(g, e.self.owner, e.caster) && g.players[e.caster].spellsCast === 2,
      resolve: (g, { you }) => draw(g, you),
    },
  },
  'Tymna the Weaver': {
    // "At the beginning of each of your postcombat main phases, you may pay X life, where X
    // is the number of opponents that were dealt combat damage this turn. If you do, draw X
    // cards." It always triggers; X is worked out as it resolves, counting combat damage from
    // any source. With X = 0 there is nothing to pay or draw, so nobody is asked.
    onPostcombatMain: {
      when: (_g, { self, player }) => player === self.owner,
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
        if (!hasType(c, 'Land')) createToken(g, you, 'Human Soldier');
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
            log(g, `${says(g.players[you], 'reveals')} ${label(c)} and puts it into ${g.players[you].isBot ? 'their' : 'your'} hand.`, you, [c]);
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
          log(g, `${says(g.players[you], 'puts')} ${label(card)} into ${g.players[you].isBot ? 'their' : 'your'} hand.`, you, [card]);
          moveCard(g, card, 'hand');
        } else taintedPact(g, you, data.names as string[]);
      },
    },
    botChoice: {
      take: (g, pid) => {
        const card = g.players[pid].exile.find((c) => c.id === (choiceData(g)?.card as string));
        return { type: 'answer', yes: !!card && wants(g, pid, card) };
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
  'Final Fortune': { onResolve: (g, { self, you }) => extraTurn(g, you, { loseAtEnd: self }) },
  'Last Chance': { onResolve: (g, { self, you }) => extraTurn(g, you, { loseAtEnd: self }) },
});

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
