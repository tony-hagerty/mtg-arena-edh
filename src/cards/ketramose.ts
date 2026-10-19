// Card behaviour for the Ketramose deck. Each script follows the card's Oracle text clause by
// clause (docs/card-scripting.md); comments quote the clauses that need care.
import { registerScripts } from '../engine/registry';
import {
  addCounters,
  grantOf,
  addEffect,
  addLasting,
  adapt,
  airbend,
  allCreatures,
  ask,
  attachedBonus,
  battlefield,
  counterCount,
  createToken,
  data,
  delay,
  destroy,
  destroyMany,
  dieMany,
  draw,
  enterBattlefield,
  enterTogether,
  equip,
  exile,
  exileLinked,
  finishEnter,
  gainLife,
  hasFlag,
  hasType,
  isColor,
  isCreature,
  isLand,
  label,
  linkedCards,
  log,
  loseLife,
  manaValue,
  moveCard,
  opponentsOf,
  permanent,
  phaseOut,
  pickCards,
  protectionFrom,
  pump,
  reconfigure,
  persist,
  refCard,
  refGraveyard,
  refPlayer,
  refStack,
  reflexive,
  sacrifice,
  sameCard,
  says,
  search,
  shuffleSearched,
  simultaneously,
  snapshot,
  stats,
  their,
  turnOrder,
  transform,
  colorsOf,
} from '../engine/rules';
import { cardWant, threat } from '../engine/ai';
import type { Action, Card, CardScript, Choice, Color, Game, GrantedTrigger, PlayerId, TargetRef, TargetSpec, Trigger, TriggerEvents, TriggerHook } from '../engine/types';

// ---------- pieces ----------

const isOpponent = (g: Game, a: PlayerId, b: PlayerId | null) => b !== null && a !== b && !g.players[b].lost;

/** A triggered ability one card gives another (613.1f), typed by its hook. */
const granted = <H extends TriggerHook>(hook: H, trigger: Trigger<TriggerEvents[H]>): GrantedTrigger => ({ hook, trigger: trigger as Trigger<never> });

/** "Target card from a graveyard": any graveyard (Cling to Dust, Ghost Vacuum, Lion Sash). */
const graveyardCard: TargetSpec = { type: 'graveyard card', label: 'target card from a graveyard' };

/** Is `self` still the permanent that `ref` remembers (400.7)? Returns it if so. */
const still = (g: Game, ref: { id: string; moves: number }) => {
  const c = permanent(g, ref.id);
  return sameCard(c, ref) ? c : undefined;
};

/** A card still in exile as the object `ref` remembers (400.7). */
const inExile = (g: Game, ref: { id: string; moves: number }) => g.players.flatMap((p) => p.exile).find((x) => sameCard(x, ref));

/** Exiles a card from a graveyard (406.3). Returns it as it is in exile. */
function exileFromGraveyard(g: Game, c: Card | undefined): Card | undefined {
  if (!c || c.zone !== 'graveyard') return undefined;
  log(g, `${label(c)} is exiled from ${their(g.players[c.owner])} graveyard.`, c.owner, [c]);
  moveCard(g, c, 'exile');
  return c;
}

/**
 * Exiles a permanent, then returns that card to the battlefield under its owner's control
 * (Ephemerate, The Mind Stone). It comes back as a new object (400.7); a token that leaves
 * the battlefield ceases to exist and doesn't come back (111.7).
 */
function blink(g: Game, c: Card | undefined) {
  if (!c || c.zone !== 'battlefield') return;
  exile(g, c);
  // exile() moved it, which TypeScript's narrowing above can't see.
  if ((c.zone as Card['zone']) !== 'exile' || c.isToken) return;
  enterBattlefield(g, c, { controller: c.owner });
}

/**
 * Exiles a permanent until a delayed trigger returns it at the next end step (Eerie
 * Interlude, Phelia, The Eternal Wanderer). Returns what the delayed trigger needs to find it.
 */
function exileForNow(g: Game, cards: Card[]): { id: string; moves: number }[] {
  const out: { id: string; moves: number }[] = [];
  simultaneously(g, () => {
    for (const c of cards) {
      if (c.zone !== 'battlefield') continue;
      exile(g, c);
      if (c.zone === ('exile' as Card['zone']) && !c.isToken) out.push({ id: c.id, moves: c.moves });
    }
  });
  return out;
}

/** "As this land enters, you may pay 3 life. If you don't, it enters tapped." (614.12a, 119.4) */
export const payThreeLand = (color: Color): CardScript => ({
  replaceEnter: (g, c, controller) => {
    ask(g, controller, { text: `Pay 3 life, or ${label(c)} enters tapped.`, life: 3, yes: 'Pay 3 Life', no: 'Enter Tapped', then: 'pay3', script: c.id });
    return true;
  },
  then: { pay3: (g, { self, yes, data: d }) => finishEnter(g, self, d, { tapped: !yes }) },
  botChoice: { pay3: (g, pid) => ({ type: 'answer', yes: g.active === pid && g.players[pid].life > 15 }) },
  mana: { amount: 1, colors: [color] },
});

/** "Harness [this permanent]" (701.64a): it becomes harnessed, which lasts until it leaves the battlefield (701.64b). */
function harness(g: Game, self: Card) {
  const me = still(g, self);
  if (!me || hasFlag(g, me, 'harnessed')) return;
  addLasting(g, me, { flags: ['harnessed'] });
  log(g, `${label(me)} is harnessed.`, me.controller, [me]);
}

/** A choice's card ids, for bot answers. */
const options = (choice: Choice) => ((choice as { cards?: string[] }).cards ?? []);
const pickable = (choice: Choice) => ((choice as { pickable?: string[] }).pickable ?? options(choice));

/** A bot's pick of the opponents' permanent it most wants gone. */
function biggestThreat(g: Game, pid: PlayerId, choice: Choice): Action {
  const cards = pickable(choice).map((id) => permanent(g, id)).filter((c): c is Card => !!c && c.controller !== pid);
  const best = cards.sort((a, b) => threat(g, b) - threat(g, a))[0];
  return { type: 'chooseCards', cards: best ? [best.id] : [] };
}

// ---------- Avatar's Wrath, Aven Interrupter, Winds of Abandon ----------

/** Exiles a spell from the stack; it becomes plotted (702.170d, Aven Interrupter). A copy of a spell ceases to exist (707.10a). */
function exileSpellPlotted(g: Game, ref: TargetRef | null | undefined) {
  const item = refStack(g, ref);
  if (!item || item.kind !== 'spell') return;
  if (item.copy) {
    log(g, `${label(item.card)} is exiled.`, item.controller, [item.card]);
    g.stack = g.stack.filter((x) => x !== item);
    return;
  }
  const c = item.card;
  log(g, `${label(c)} is exiled and becomes plotted.`, item.controller, [c]);
  moveCard(g, c, 'exile');
  const card = g.players[c.owner].exile.find((x) => x.id === c.id);
  if (card) card.plotted = g.turn;
}

/**
 * Winds of Abandon, once the creatures are exiled: each player who controlled any searches
 * for that many basic land cards, in turn order (101.4). The lands all enter together, tapped,
 * once every search is done.
 */
function windsSearch(g: Game, order: { pid: PlayerId; n: number }[], i: number, found: string[]) {
  const next = order[i];
  if (!next) {
    const cards = found.map((id) => g.players.flatMap((p) => p.library).find((x) => x.id === id)).filter((c): c is Card => !!c);
    enterTogether(g, cards.map((card) => ({ card, opts: { tapped: true, controller: card.owner } })));
    return;
  }
  search(g, next.pid, 'none', { basic: true, label: next.n === 1 ? 'a basic land card' : `${next.n} basic land cards` }, { count: next.n, then: 'winds', data: { order, i, found } });
}

// ---------- The Eternal Wanderer, The Legend of Yangchen ----------

/** "For each player, choose a creature that player controls": the Wanderer's controller chooses, one player at a time. */
function wandererChoose(g: Game, you: PlayerId, order: PlayerId[], i: number, kept: string[]) {
  for (; i < order.length; i++) {
    const mine = g.players[order[i]].battlefield.filter((x) => isCreature(g, x));
    if (mine.length > 1) {
      pickCards(g, you, mine, { min: 1, max: 1, text: `choose a creature ${g.players[order[i]].name} controls; they sacrifice the rest`, button: 'Choose', then: 'wanderer', data: { order, i, kept } });
      return;
    }
    kept.push(...mine.map((c) => c.id));
  }
  // "Each player sacrifices all creatures they control not chosen this way." All at once.
  dieMany(g, allCreatures(g).filter((c) => !kept.includes(c.id)), 'is sacrificed');
}

/** Yangchen chapter I: starting with you, each player chooses up to one permanent with mana value 3 or greater among your opponents' permanents. */
function yangchenChoose(g: Game, you: PlayerId, order: PlayerId[], i: number, chosen: string[]) {
  const options = () => opponentsOf(g, you).flatMap((o) => o.battlefield).filter((c) => manaValue(c) >= 3);
  for (; i < order.length; i++) {
    if (g.players[order[i]].lost) continue;
    if (!options().length) break;
    pickCards(g, order[i], options(), {
      min: 0,
      max: 1,
      text: `choose up to one permanent with mana value 3 or greater ${order[i] === you ? 'your opponents control' : `${g.players[you].name}'s opponents control`}; the chosen ones are exiled`,
      button: 'Choose',
      then: 'yangchen',
      data: { order, i, chosen },
    });
    return;
  }
  // "Exile those permanents." Together.
  const cards = [...new Set(chosen)].map((id) => permanent(g, id)).filter((c): c is Card => !!c);
  simultaneously(g, () => cards.forEach((c) => exile(g, c)));
}

// ---------- Lively Dirge ----------

const dirgeCreatures = (g: Game, you: PlayerId, room: number, not: string[] = []) =>
  g.players[you].graveyard.filter((c) => hasType(g, c, 'Creature') && manaValue(c) <= room && !not.includes(c.id));

/** "Return up to two creature cards with total mana value 4 or less from your graveyard to the battlefield." Chosen one at a time, as it resolves. */
function dirgeReturn(g: Game, you: PlayerId) {
  const first = dirgeCreatures(g, you, 4);
  if (!first.length) return;
  pickCards(g, you, g.players[you].graveyard, { min: 0, max: 1, pickable: first, text: 'return up to two creature cards with total mana value 4 or less: choose the first', button: 'Choose', then: 'dirgeFirst' });
}

// ---------- the cards ----------

registerScripts({
  // ===== Commander =====
  'Ketramose, the New Dawn': {
    // "Ketramose can't attack or block unless there are seven or more cards in exile."
    static: (g, self, c) => (c.id === self.id && g.players.reduce((n, p) => n + p.exile.length, 0) < 7 ? { keywords: ["can't attack", "can't block"] } : null),
    // "Whenever one or more cards are put into exile from graveyards and/or the battlefield
    // during your turn, you draw a card and lose 1 life." Once for each such event.
    onExiled: {
      when: (g, { self }) => g.active === self.controller,
      resolve: (g, { you }) => {
        draw(g, you);
        loseLife(g, you, 1);
      },
      text: 'Whenever one or more cards are put into exile from graveyards and/or the battlefield during your turn, you draw a card and lose 1 life.',
    },
  },

  // ===== Creatures =====
  'Appa, Steadfast Guardian': {
    // "When Appa enters, airbend any number of other target nonland permanents you control." (701.65a)
    targets: [{ type: 'permanent', who: 'you', any: true, label: 'other target nonland permanents you control', filter: (g, c, self) => c.id !== self.id && !isLand(g, c) }],
    onEnter: (g, { targets }) => {
      airbend(g, targets.map((t) => refCard(g, t)).filter((c): c is Card => !!c));
    },
    // "Whenever you cast a spell from exile, create a 1/1 white Ally creature token."
    onCast: {
      when: (_g, { self, card, caster }) => caster === self.controller && card.cast?.from === 'exile',
      resolve: (g, { you }) => createToken(g, you, 'Ally'),
      text: 'Whenever you cast a spell from exile, create a 1/1 white Ally creature token.',
    },
  },
  'Archivist of Oghma': {
    // "Whenever an opponent searches their library, you gain 1 life and draw a card."
    onSearch: {
      when: (g, { self, player }) => isOpponent(g, self.controller, player),
      resolve: (g, { you }) => {
        gainLife(g, you, 1);
        draw(g, you);
      },
      text: 'Whenever an opponent searches their library, you gain 1 life and draw a card.',
    },
  },
  'Boggart Trawler': {
    // "When this creature enters, exile target player's graveyard." All of it at once.
    targets: [{ type: 'player', label: 'target player' }],
    onEnter: (g, { targets }) => {
      const p = refPlayer(g, targets[0]);
      if (!p || !p.graveyard.length) return;
      const cards = [...p.graveyard];
      log(g, `${says(p, 'exiles')} ${their(p)} graveyard.`, p.id, cards);
      simultaneously(g, () => cards.forEach((c) => moveCard(g, c, 'exile')));
    },
  },
  'Boggart Bog': payThreeLand('B'),
  'Delivery Moogle': {
    // "When this creature enters, search your library and/or graveyard for an artifact card
    // with mana value 2 or less, reveal it, and put it into your hand. If you search your
    // library this way, shuffle." Searching both finds everything searching one would.
    onEnter: (g, { you }) =>
      ask(g, you, { text: 'Delivery Moogle: search your library as well as your graveyard? Searching your library shuffles it.', yes: 'Library and Graveyard', no: 'Graveyard Only', then: 'where' }),
    then: {
      where: (g, { you, yes }) => {
        const p = g.players[you];
        const fits = (c: Card) => hasType(g, c, 'Artifact') && manaValue(c) <= 2;
        const pool = yes ? [...p.library, ...p.graveyard] : p.graveyard;
        // A search for a card with a stated quality may find nothing (701.23b).
        pickCards(g, you, pool, { min: 0, max: 1, pickable: pool.filter(fits), text: 'find an artifact card with mana value 2 or less to reveal and put into your hand', button: 'Put in Hand', then: 'found', data: { library: yes } });
      },
      found: (g, { you, picked, data: d }) => {
        const p = g.players[you];
        const card = picked.find((c) => c.zone === 'library' || c.zone === 'graveyard');
        if (card) {
          log(g, `${says(p, 'reveals')} ${label(card)} and ${p.you ? 'put' : 'puts'} it into ${their(p)} hand.`, you, [card]);
          moveCard(g, card, 'hand');
        } else log(g, `${says(p, 'finds')} nothing.`, you);
        if (d.library) shuffleSearched(g, you);
      },
    },
    botChoice: { where: () => ({ type: 'answer', yes: true }) },
  },
  'Eirdu, Carrier of Dawn': {
    // "Creature spells you cast have convoke." (702.51a)
    grantsConvoke: (g, self, spell, caster) => caster === self.controller && isCreature(g, spell),
    // "At the beginning of your first main phase, you may pay {B}. If you do, transform Eirdu."
    onPrecombatMain: {
      when: (_g, { self, player }) => player === self.controller,
      resolve: (g, { you }) => ask(g, you, { text: 'You may pay {B} to transform Eirdu.', cost: '{B}', yes: 'Pay {B}', no: "Don't Pay", then: 'turn' }),
      text: 'At the beginning of your first main phase, you may pay {B}. If you do, transform Eirdu.',
    },
    then: { turn: (g, { self, yes }) => yes && transform(g, still(g, self)) },
    botChoice: { turn: (g, pid) => ({ type: 'answer', yes: g.players[pid].battlefield.filter((c) => isCreature(g, c) && !c.isToken).length >= 3 }) },
  },
  'Isilu, Carrier of Twilight': {
    // "Each other nontoken creature you control has persist." (702.79a)
    static: (g, self, c) => (c.id !== self.id && c.controller === self.controller && isCreature(g, c) && !c.isToken ? grantOf(self) : null),
    grants: [granted('onDies', persist)],
    // "At the beginning of your first main phase, you may pay {W}. If you do, transform Isilu."
    onPrecombatMain: {
      when: (_g, { self, player }) => player === self.controller,
      resolve: (g, { you }) => ask(g, you, { text: 'You may pay {W} to transform Isilu.', cost: '{W}', yes: 'Pay {W}', no: "Don't Pay", then: 'turn' }),
      text: 'At the beginning of your first main phase, you may pay {W}. If you do, transform Isilu.',
    },
    then: { turn: (g, { self, yes }) => yes && transform(g, still(g, self)) },
    botChoice: { turn: () => ({ type: 'answer', yes: false }) },
  },
  'Emperor of Bones': {
    // "At the beginning of combat on your turn, exile up to one target card from a graveyard."
    onBeginCombat: {
      when: (_g, { self, player }) => player === self.controller,
      targets: [{ ...graveyardCard, optional: true, label: 'up to one target card from a graveyard' }],
      resolve: (g, { self, targets }) => {
        const c = refGraveyard(g, targets[0]);
        if (c) exileLinked(g, self, c);
      },
      text: 'At the beginning of combat on your turn, exile up to one target card from a graveyard.',
    },
    // "{1}{B}: Adapt 2." (701.46a)
    activated: { cost: { mana: '{1}{B}' }, text: 'Adapt 2', resolve: (g) => adapt(g, abilityPermanent(g), 2) },
    // "Whenever one or more +1/+1 counters are put on this creature, put a creature card exiled
    // with this creature onto the battlefield under your control with a finality counter on it.
    // It gains haste. Sacrifice it at the beginning of the next end step."
    onCounters: {
      when: (_g, { kind }) => kind === '+1/+1',
      resolve: (g, { self, you }) => {
        const cards = linkedCards(g, self).filter((c) => hasType(g, c, 'Creature'));
        if (cards.length > 1) pickCards(g, you, cards, { min: 1, max: 1, text: 'put a creature card exiled with Emperor of Bones onto the battlefield', button: 'Put Onto Battlefield', then: 'reanimate' });
        else if (cards.length) emperorReturn(g, self, you, cards[0]);
      },
      text: 'Whenever one or more +1/+1 counters are put on this creature, put a creature card exiled with it onto the battlefield.',
    },
    then: {
      reanimate: (g, { self, you, picked }) => picked[0] && emperorReturn(g, self, you, picked[0]),
      // "Sacrifice it at the beginning of the next end step": set up once it is there.
      returned: (g, { self, you, picked }) => picked[0] && delay(g, self, you, { key: 'sacrifice', step: 'end', data: { id: picked[0].id, moves: picked[0].moves } }),
    },
    delayed: { sacrifice: (g, { you, data: d }) => sacrificeIfYours(g, you, d as { id: string; moves: number }) },
    botChoice: { reanimate: (g, pid, choice) => ({ type: 'chooseCards', cards: [bestBy(g, choice, (c) => cardWant(g, pid, c))] }) },
  },
  'Haliya, Guided by Light': {
    // "Whenever Haliya or another creature or artifact you control enters, you gain 1 life."
    onPermanentEnters: {
      when: (g, { self, entered }) => entered.controller === self.controller && (entered.id === self.id || isCreature(g, entered) || hasType(g, entered, 'Artifact')),
      resolve: (g, { you }) => gainLife(g, you, 1),
      text: 'Whenever Haliya or another creature or artifact you control enters, you gain 1 life.',
    },
    // "At the beginning of your end step, draw a card if you've gained 3 or more life this
    // turn." Not an intervening "if": it is checked only as it resolves.
    onEndStep: {
      when: (_g, { self, player }) => player === self.controller,
      resolve: (g, { you }) => {
        if ((g.players[you].lifeGained ?? 0) >= 3) draw(g, you);
      },
      text: "At the beginning of your end step, draw a card if you've gained 3 or more life this turn.",
    },
    // "Warp {W}" (702.185a).
    alternativeCosts: [{ label: 'Warp {W}', mana: '{W}', warp: true }],
  },
  'Monk Gyatso': {
    // "Whenever another creature you control becomes the target of a spell or ability, you may airbend that creature."
    onBecomesTarget: {
      when: (g, { self, target }) => target.id !== self.id && target.controller === self.controller && isCreature(g, target),
      resolve: (g, { you, target }) => {
        const c = still(g, target);
        if (c) ask(g, you, { text: `You may airbend ${label(c)}.`, yes: 'Airbend', no: "Don't", then: 'airbend', data: { id: c.id, moves: c.moves } });
      },
      text: 'Whenever another creature you control becomes the target of a spell or ability, you may airbend that creature.',
    },
    then: {
      airbend: (g, { yes, data: d }) => {
        const c = yes ? still(g, d as { id: string; moves: number }) : undefined;
        if (c) airbend(g, [c]);
      },
    },
    // A bot saves its creature from an opponent's spell or ability.
    botChoice: { airbend: (g, pid) => ({ type: 'answer', yes: g.stack.some((x) => x.controller !== pid) }) },
  },
  'Phelia, Exuberant Shepherd': {
    // "Whenever Phelia attacks, exile up to one other target nonland permanent. At the beginning
    // of the next end step, return that card to the battlefield under its owner's control. If it
    // entered under your control, put a +1/+1 counter on Phelia."
    onAttack: {
      targets: [{ type: 'permanent', optional: true, label: 'up to one other target nonland permanent', filter: (g, c, self) => c.id !== self.id && !isLand(g, c) }],
      resolve: (g, { self, you, targets }) => {
        const [gone] = exileForNow(g, [refCard(g, targets[0])].filter((c): c is Card => !!c));
        if (gone) delay(g, self, you, { key: 'phelia', step: 'end', data: { card: gone, phelia: { id: self.id, moves: self.moves } } });
      },
      text: 'Whenever Phelia attacks, exile up to one other target nonland permanent.',
    },
    delayed: {
      phelia: (g, { self, you, data: d }) => {
        const card = inExile(g, d.card as { id: string; moves: number });
        // The counter is checked once it has entered, after any choice its replacement effect asks (614.12a).
        if (card) enterBattlefield(g, card, { controller: card.owner, after: { source: snapshot(self), key: 'returned', you, data: { phelia: d.phelia } } });
      },
    },
    then: {
      returned: (g, { you, picked, data: d }) => {
        if (picked[0]?.controller === you) addCounters(g, still(g, d.phelia as { id: string; moves: number }), 1);
      },
    },
  },
  'Skirge Familiar': {
    // "Discard a card: Add {B}." Auto-pay never uses it: it costs a card.
    mana: { amount: 1, colors: ['B'], noTap: true, discard: 1 },
  },
  'Skyclave Apparition': {
    // "When this creature enters, exile up to one target nonland, nontoken permanent you don't
    // control with mana value 4 or less."
    targets: [
      {
        type: 'permanent',
        who: 'opponent',
        optional: true,
        label: "up to one target nonland, nontoken permanent you don't control with mana value 4 or less",
        filter: (g, c) => !isLand(g, c) && !c.isToken && manaValue(c) <= 4,
      },
    ],
    onEnter: (g, { self, targets }) => void exileLinked(g, self, refCard(g, targets[0])),
    // "When this creature leaves the battlefield, the exiled card's owner creates an X/X blue
    // Illusion creature token, where X is the mana value of the exiled card." The card it
    // exiled, even if it has since left exile.
    onLeave: (g, { self }) => {
      for (const l of self.linked) {
        const card = g.players.flatMap((p) => [...p.exile, ...p.graveyard, ...p.hand, ...p.library, ...p.battlefield, ...p.command]).find((x) => x.id === l.id);
        if (!card) continue;
        const x = data({ ...card, face: 0 }).cmc;
        createToken(g, card.owner, `Illusion ${x}/${x}`);
      }
    },
  },
  Solitude: {
    // "When this creature enters, exile up to one other target creature. That creature's
    // controller gains life equal to its power." Its power as it last was (608.2h).
    targets: [{ type: 'creature', optional: true, label: 'up to one other target creature', filter: (_g, c, self) => c.id !== self.id }],
    onEnter: (g, { targets }) => {
      const c = refCard(g, targets[0]);
      if (!c) return;
      const power = stats(g, c).power;
      const controller = c.controller;
      exile(g, c);
      gainLife(g, controller, power);
    },
    // "Evoke—Exile a white card from your hand." (702.74a, 118.9)
    alternativeCosts: [{ label: 'Evoke: exile a white card', mana: '', evoke: true, exile: { label: 'a white card', filter: (g, c, self) => c.id !== self.id && isColor(g, c, 'W') } }],
  },
  'Summon: Yojimbo': {
    chapters: [
      {
        // "I — Exile target artifact, enchantment, or tapped creature an opponent controls."
        text: 'Exile target artifact, enchantment, or tapped creature an opponent controls.',
        targets: [{ type: 'permanent', who: 'opponent', label: 'target artifact, enchantment, or tapped creature an opponent controls', filter: (g, c) => hasType(g, c, 'Artifact') || hasType(g, c, 'Enchantment') || (isCreature(g, c) && c.tapped) }],
        resolve: (g, { targets }) => exile(g, refCard(g, targets[0])),
      },
      // "II, III — Until your next turn, creatures can't attack you unless their controller pays {2} for each of those creatures." (508.1g)
      ...[0, 1].map(() => ({
        text: "Until your next turn, creatures can't attack you unless their controller pays {2} for each of those creatures.",
        resolve: (g: Game, { you }: { you: PlayerId }) => {
          addEffect(g, { kind: 'attackTax', player: you, mana: '{2}', ends: { nextTurnOf: you } });
          log(g, `Until ${their(g.players[you])} next turn, attacking ${g.players[you].you ? 'you' : g.players[you].name} costs {2} for each creature.`, you);
        },
      })),
      {
        // "IV — Create X Treasure tokens, where X is the number of opponents who control a creature with power 4 or greater."
        text: 'Create X Treasure tokens, where X is the number of opponents who control a creature with power 4 or greater.',
        resolve: (g, { you }) => {
          const x = opponentsOf(g, you).filter((o) => o.battlefield.some((c) => isCreature(g, c) && stats(g, c).power >= 4)).length;
          if (x) createToken(g, you, 'Treasure', x);
        },
      },
    ],
  },
  'Witch Enchanter': {
    // "When this creature enters, destroy target artifact or enchantment an opponent controls."
    targets: [{ type: 'permanent', who: 'opponent', label: 'target artifact or enchantment an opponent controls', filter: (g, c) => hasType(g, c, 'Artifact') || hasType(g, c, 'Enchantment') }],
    onEnter: (g, { targets }) => destroy(g, refCard(g, targets[0])),
  },
  'Witch-Blessed Meadow': payThreeLand('W'),
  'Aven Interrupter': {
    // "When this creature enters, exile target spell. It becomes plotted." (702.170d) Exiling
    // isn't countering, so a spell that can't be countered is exiled too.
    targets: [{ type: 'spell', label: 'target spell' }],
    onEnter: (g, { targets }) => exileSpellPlotted(g, targets[0]),
    // "Spells your opponents cast from graveyards or from exile cost {2} more to cast." (601.2f)
    costModifier: (_g, self, _spell, caster, from) => (caster !== self.controller && (from === 'graveyard' || from === 'exile') ? 2 : 0),
  },

  // ===== Artifacts =====
  "Agatha's Soul Cauldron": {
    // "You may spend mana as though it were mana of any color to activate abilities of creatures you control."
    anyColorFor: (g, self, pid, source) => pid === self.controller && source.controller === pid && isCreature(g, source),
    // "Creatures you control with +1/+1 counters on them have all activated abilities of all
    // creature cards exiled with Agatha's Soul Cauldron." (607.2a)
    static: (g, self, c) => {
      if (c.controller !== self.controller || !isCreature(g, c) || counterCount(c) === 0) return null;
      const lent = linkedCards(g, self).filter((x) => hasType(g, x, 'Creature')).map((x) => x.name);
      return lent.length ? { activatedOf: lent } : null;
    },
    // "{T}: Exile target card from a graveyard. When a creature card is exiled this way, put a
    // +1/+1 counter on target creature you control." A reflexive trigger (603.12).
    activated: {
      cost: { tap: true },
      targets: [graveyardCard],
      text: 'Exile target card from a graveyard',
      resolve: (g, { self, you, targets }) => {
        const c = exileLinked(g, self, refGraveyard(g, targets[0]));
        // A reflexive trigger (603.12).
        if (c && hasType(g, c, 'Creature')) reflexive(g, self, you, 'counter');
      },
    },
    reflexive: {
      counter: {
        targets: [{ type: 'creature', who: 'you', label: 'target creature you control' }],
        text: 'Put a +1/+1 counter on target creature you control.',
        resolve: (g, { targets }) => addCounters(g, refCard(g, targets[0]), 1),
      },
    },
    botActivate: (g, pid) => g.players.some((p) => p.graveyard.some((c) => hasType(g, c, 'Creature'))) && g.active !== pid,
  },
  'Argent Dais': {
    // "This artifact enters with two oil counters on it." (614.1c)
    entersWith: { oil: 2 },
    // "Whenever two or more creatures attack, put an oil counter on this artifact."
    onAttackersDeclared: {
      when: (_g, { attacks }) => attacks.length >= 2,
      resolve: (g, { self }) => addCounters(g, still(g, self), 1, 'oil'),
      text: 'Whenever two or more creatures attack, put an oil counter on this artifact.',
    },
    // "{2}, {T}, Remove two oil counters from this artifact: Exile another target nonland
    // permanent. Its controller draws two cards."
    activated: {
      cost: { mana: '{2}', tap: true, counters: { kind: 'oil', n: 2 } },
      targets: [{ type: 'permanent', label: 'another target nonland permanent', filter: (g, c, self) => c.id !== self.id && !isLand(g, c) }],
      text: 'Exile another target nonland permanent; its controller draws two cards',
      resolve: (g, { targets }) => {
        const c = refCard(g, targets[0]);
        if (!c) return;
        const controller = c.controller;
        exile(g, c);
        draw(g, controller, 2);
      },
    },
    botActivate: (g, pid) => opponentsOf(g, pid).some((o) => o.battlefield.some((c) => !isLand(g, c) && threat(g, c) >= 5)),
  },
  'Currency Converter': {
    // "Whenever you discard a card, you may exile that card from your graveyard."
    onDiscard: {
      when: (_g, { self, player }) => player === self.controller,
      resolve: (g, { you, card }) => {
        const c = g.players[card.owner].graveyard.find((x) => sameCard(x, card));
        if (c) ask(g, you, { text: `You may exile ${label(c)} from your graveyard with Currency Converter.`, yes: 'Exile', no: "Don't", then: 'store', data: { id: c.id, moves: c.moves } });
      },
      text: 'Whenever you discard a card, you may exile that card from your graveyard.',
    },
    activated: [
      // "{2}, {T}: Draw a card, then discard a card."
      {
        cost: { mana: '{2}', tap: true },
        text: 'Draw a card, then discard a card',
        resolve: (g, { you }) => {
          draw(g, you);
          const hand = g.players[you].hand;
          if (hand.length) pickCards(g, you, hand, { min: 1, max: 1, text: 'discard a card', button: 'Discard', then: '@discard' });
        },
      },
      // "{T}: Put a card exiled with this artifact into its owner's graveyard. If it's a land
      // card, create a Treasure token. If it's a nonland card, create a 2/2 black Rogue creature token."
      {
        cost: { tap: true },
        text: 'Put a card exiled with it into its graveyard; make a Treasure or a Rogue',
        resolve: (g, { self, you }) => {
          const cards = linkedCards(g, self);
          if (cards.length > 1) pickCards(g, you, cards, { min: 1, max: 1, text: 'put a card exiled with Currency Converter into its owner’s graveyard', button: 'Choose', then: 'convert' });
          else if (cards.length) convert(g, you, cards[0]);
        },
      },
    ],
    then: {
      store: (g, { self, yes, data: d }) => {
        if (!yes) return;
        const c = g.players.flatMap((p) => p.graveyard).find((x) => sameCard(x, d as { id: string; moves: number }));
        if (c) exileLinked(g, self, c);
      },
      convert: (g, { you, picked }) => picked[0] && convert(g, you, picked[0]),
    },
    botChoice: {
      store: () => ({ type: 'answer', yes: true }),
      convert: (g, _pid, choice) => ({ type: 'chooseCards', cards: [bestBy(g, choice, (c) => (isLand(g, c) ? 0 : 1))] }),
    },
    botActivate: (g, pid, self, activated) => (activated === 1 ? linkedCards(g, self).length > 0 : g.active !== pid && g.step === 'end'),
  },
  'Ghost Vacuum': {
    activated: [
      // "{T}: Exile target card from a graveyard."
      {
        cost: { tap: true },
        targets: [graveyardCard],
        text: 'Exile target card from a graveyard',
        resolve: (g, { self, targets }) => void exileLinked(g, self, refGraveyard(g, targets[0])),
      },
      // "{6}, {T}, Sacrifice this artifact: Put each creature card exiled with this artifact onto
      // the battlefield under your control with a flying counter on it. Each of them is a 1/1
      // Spirit in addition to its other types. Activate only as a sorcery."
      {
        cost: { mana: '{6}', tap: true, sacrifice: true },
        sorcery: true,
        text: 'Put each creature card exiled with it onto the battlefield as 1/1 Spirits with flying counters',
        resolve: (g, { self, you }) => {
          const cards = linkedCards(g, self).filter((c) => hasType(g, c, 'Creature'));
          // A new base power and toughness (613.4b) and an extra subtype, for as long as each stays (611.2a).
          const lasting = { setPower: 1, setToughness: 1, subtypes: ['Spirit'] };
          enterTogether(g, cards.map((card) => ({ card, opts: { controller: you, counters: { flying: 1 }, lasting } })));
        },
      },
    ],
    botActivate: (g, _pid, self, activated) =>
      activated === 0 ? g.players.some((p) => p.graveyard.some((c) => hasType(g, c, 'Creature'))) : linkedCards(g, self).filter((c) => hasType(g, c, 'Creature')).length >= 3,
  },
  'Lion Sash': {
    activated: [
      // "{W}: Exile target card from a graveyard. If it was a permanent card, put a +1/+1 counter on this permanent."
      {
        cost: { mana: '{W}' },
        targets: [graveyardCard],
        text: 'Exile target card from a graveyard',
        resolve: (g, { targets }) => {
          const c = exileFromGraveyard(g, refGraveyard(g, targets[0]));
          if (c && ['Artifact', 'Creature', 'Enchantment', 'Land', 'Planeswalker', 'Battle'].some((t) => hasType(g, c, t))) addCounters(g, abilityPermanent(g), 1);
        },
      },
      // "Reconfigure {2}" (702.151a).
      ...reconfigure('{2}'),
    ],
    // "Equipped creature gets +1/+1 for each +1/+1 counter on this Equipment."
    static: (_g, self, c) => (self.attachedTo === c.id && counterCount(self) > 0 ? { power: counterCount(self), toughness: counterCount(self) } : null),
    botActivate: (g, pid, _self, activated) => activated === 0 && g.active !== pid && g.players.some((p) => p.graveyard.length > 0),
  },
  'Relic of Progenitus': {
    activated: [
      // "{T}: Target player exiles a card from their graveyard." That player chooses which.
      {
        cost: { tap: true },
        targets: [{ type: 'player', label: 'target player' }],
        text: 'Target player exiles a card from their graveyard',
        resolve: (g, { targets }) => {
          const p = refPlayer(g, targets[0]);
          if (p?.graveyard.length) pickCards(g, p.id, p.graveyard, { min: 1, max: 1, text: 'exile a card from your graveyard', button: 'Exile', then: 'relic' });
        },
      },
      // "{1}, Exile this artifact: Exile all graveyards. Draw a card."
      {
        cost: { mana: '{1}', exileSelf: true },
        text: 'Exile all graveyards, then draw a card',
        resolve: (g, { you }) => {
          const cards = g.players.flatMap((p) => p.graveyard);
          if (cards.length) log(g, 'All graveyards are exiled.', you, cards);
          simultaneously(g, () => cards.forEach((c) => moveCard(g, c, 'exile')));
          draw(g, you);
        },
      },
    ],
    then: { relic: (g, { picked }) => picked[0] && exileFromGraveyard(g, picked[0]) },
    botChoice: { relic: (g, pid, choice) => ({ type: 'chooseCards', cards: [bestBy(g, choice, (c) => -cardWant(g, pid, c))] }) },
    botActivate: (g, pid, _self, activated) => activated === 0 && g.active !== pid && opponentsOf(g, pid).some((o) => o.graveyard.length > 0),
  },
  'Springleaf Drum': {
    // "{T}, Tap an untapped creature you control: Add one mana of any color." Summoning
    // sickness doesn't stop the creature: it isn't its own {T} ability (302.6).
    mana: { amount: 1, colors: 'any', tapCreature: {} },
  },
  'Sword of Hearth and Home': {
    // "Equipped creature gets +2/+2 and has protection from green and from white."
    static: attachedBonus({ power: 2, toughness: 2, keywords: [protectionFrom('G'), protectionFrom('W')] }),
    // "Whenever equipped creature deals combat damage to a player, exile up to one target
    // creature you own, then search your library for a basic land card. Put both cards onto
    // the battlefield under your control, then shuffle."
    onDamage: {
      when: (_g, { self, source, player, combat }) => combat && player !== null && source.id === self.attachedTo,
      targets: [{ type: 'creature', optional: true, label: 'up to one target creature you own', filter: (_g, c, self) => c.owner === self.controller }],
      resolve: (g, { you, targets }) => {
        const c = refCard(g, targets[0]);
        let exiled: { id: string; moves: number } | null = null;
        if (c) {
          exile(g, c);
          if (c.zone === ('exile' as Card['zone']) && !c.isToken) exiled = { id: c.id, moves: c.moves };
        }
        search(g, you, 'none', { basic: true, label: 'a basic land card' }, { then: 'hearth', data: { exiled } });
      },
      text: 'Whenever equipped creature deals combat damage to a player, exile up to one target creature you own and search for a basic land.',
    },
    then: {
      hearth: (g, { you, picked, data: d }) => {
        const card = d.exiled ? inExile(g, d.exiled as { id: string; moves: number }) : undefined;
        const land = picked[0] && g.players[you].library.find((x) => x.id === picked[0].id);
        enterTogether(g, [card, land].filter((c): c is Card => !!c).map((c) => ({ card: c, opts: { controller: you } })));
      },
    },
    activated: equip('{2}'),
  },
  'The Mind Stone': {
    mana: { amount: 1, colors: ['W'] },
    // "{5}{W}, {T}: Harness The Mind Stone." (701.64a)
    activated: { cost: { mana: '{5}{W}', tap: true }, text: 'Harness The Mind Stone', resolve: (g, { self }) => harness(g, self) },
    // "∞ — At the beginning of your end step, exile up to one other target nonland permanent
    // you control, then return that card to the battlefield under its owner's control." Only
    // while harnessed.
    onEndStep: {
      when: (g, { self, player }) => player === self.controller && hasFlag(g, self, 'harnessed'),
      targets: [{ type: 'permanent', who: 'you', optional: true, label: 'up to one other target nonland permanent you control', filter: (g, c, self) => c.id !== self.id && !isLand(g, c) }],
      resolve: (g, { targets }) => blink(g, refCard(g, targets[0])),
      text: 'At the beginning of your end step, exile up to one other target nonland permanent you control, then return it.',
    },
    botActivate: (g, pid) => g.active !== pid && g.step === 'end',
  },
  'The Ooze': {
    // "Whenever a creature you control with a +1/+1 counter on it leaves the battlefield, create
    // a Mutagen token for each +1/+1 counter on it." It looks back in time (603.10a).
    onPermanentLeaves: {
      when: (g, { self, left }) => left.controller === self.controller && isCreature(g, left) && counterCount(left) > 0,
      resolve: (g, { you, left }) => createToken(g, you, 'Mutagen', counterCount(left)),
      text: 'Whenever a creature you control with a +1/+1 counter on it leaves the battlefield, create a Mutagen token for each +1/+1 counter on it.',
    },
    // "{T}: Exile target card from a graveyard. Create a Mutagen token."
    activated: {
      cost: { tap: true },
      targets: [graveyardCard],
      text: 'Exile target card from a graveyard and create a Mutagen token',
      resolve: (g, { you, targets }) => {
        exileFromGraveyard(g, refGraveyard(g, targets[0]));
        createToken(g, you, 'Mutagen');
      },
    },
    botActivate: (g, pid) => g.active !== pid && g.step === 'end',
  },
  'The Soul Stone': {
    mana: { amount: 1, colors: ['B'] },
    // "{6}{B}, {T}, Exile a creature you control: Harness The Soul Stone." (701.64a)
    activated: {
      cost: { mana: '{6}{B}', tap: true, exileOne: { type: 'creature', who: 'you', label: 'a creature you control' } },
      text: 'Harness The Soul Stone',
      resolve: (g, { self }) => harness(g, self),
    },
    // "∞ — At the beginning of your upkeep, return target creature card from your graveyard to the battlefield." Only while harnessed.
    onUpkeep: {
      when: (g, { self, player }) => player === self.controller && hasFlag(g, self, 'harnessed'),
      targets: [{ type: 'graveyard card', who: 'you', label: 'target creature card in your graveyard', filter: (g, c) => hasType(g, c, 'Creature') }],
      resolve: (g, { you, targets }) => {
        const c = refGraveyard(g, targets[0]);
        if (c) enterBattlefield(g, c, { controller: you });
      },
      text: 'At the beginning of your upkeep, return target creature card from your graveyard to the battlefield.',
    },
    botActivate: (g, pid) => g.players[pid].graveyard.some((c) => hasType(g, c, 'Creature')),
  },
  'Plaza of Heroes': {
    mana: [
      { amount: 1, colors: ['C'] },
      // "{T}: Add one mana of any color. Spend this mana only to cast a legendary spell."
      { amount: 1, colors: 'any', legendary: true },
      // "{T}: Add one mana of any color among legendary permanents you control."
      {
        amount: 1,
        colors: (g, self) => [...new Set(g.players[self.controller].battlefield.filter((c) => hasType(g, c, 'Legendary')).flatMap((c) => colorsOf(g, c)))],
      },
    ],
    // "{3}, {T}, Exile this land: Target legendary creature gains hexproof and indestructible until end of turn."
    activated: {
      cost: { mana: '{3}', tap: true, exileSelf: true },
      targets: [{ type: 'creature', label: 'target legendary creature', filter: (g, c) => hasType(g, c, 'Legendary') }],
      text: 'Target legendary creature gains hexproof and indestructible until end of turn',
      resolve: (g, { targets }) => pump(g, refCard(g, targets[0]), 0, 0, ['hexproof', 'indestructible']),
    },
    botActivate: () => false,
  },
  'Talon Gates of Madara': {
    // "When this land enters, up to one target creature phases out." (702.26b)
    targets: [{ type: 'creature', optional: true, label: 'up to one target creature' }],
    onEnter: (g, { targets }) => {
      const c = refCard(g, targets[0]);
      if (c) phaseOut(g, [c]);
    },
    mana: [
      { amount: 1, colors: ['C'] },
      // "{1}, {T}: Add one mana of any color." (605.1a)
      { amount: 1, colors: 'any', cost: '{1}' },
    ],
    // "{4}: Put this card from your hand onto the battlefield." Not playing a land (305.4).
    activated: {
      cost: { mana: '{4}' },
      fromHand: true,
      text: 'Put this card from your hand onto the battlefield',
      resolve: (g, { self, you }) => {
        const c = g.players[you].hand.find((x) => sameCard(x, self));
        if (c) enterBattlefield(g, c, { controller: you });
      },
    },
    botActivate: () => false,
  },
  "Urza's Saga": urzasSaga(),

  // ===== Planeswalker =====
  'The Eternal Wanderer': {
    // "No more than one creature can attack The Eternal Wanderer each combat." (508.1c)
    maxAttackers: 1,
    loyalty: [
      {
        // "+1: Exile up to one target artifact or creature. Return that card to the battlefield
        // under its owner's control at the beginning of that player's next end step."
        cost: 1,
        text: 'Exile up to one target artifact or creature until its owner’s next end step',
        targets: [{ type: 'permanent', optional: true, label: 'up to one target artifact or creature', filter: (g, c) => hasType(g, c, 'Artifact') || isCreature(g, c) }],
        resolve: (g, { self, you, targets }) => {
          const c = refCard(g, targets[0]);
          if (!c) return;
          const owner = c.owner;
          const [gone] = exileForNow(g, [c]);
          if (gone) delay(g, self, you, { key: 'wanderer', step: 'end', player: owner, data: { card: gone } });
        },
      },
      // "0: Create a 2/2 white Samurai creature token with double strike."
      { cost: 0, text: 'Create a 2/2 white Samurai creature token with double strike', resolve: (g, { you }) => createToken(g, you, 'Samurai 2/2 double strike') },
      {
        // "−4: For each player, choose a creature that player controls. Each player sacrifices
        // all creatures they control not chosen this way."
        cost: -4,
        text: 'For each player, choose a creature they control; each player sacrifices the rest',
        resolve: (g, { you }) => wandererChoose(g, you, turnOrder(g, g.active).filter((p) => !g.players[p].lost), 0, []),
      },
    ],
    delayed: {
      wanderer: (g, { data: d }) => {
        const card = inExile(g, d.card as { id: string; moves: number });
        if (card) enterBattlefield(g, card, { controller: card.owner });
      },
    },
    then: { wanderer: (g, { you, picked, data: d }) => wandererChoose(g, you, d.order as PlayerId[], (d.i as number) + 1, [...(d.kept as string[]), ...picked.map((c) => c.id)]) },
    // A bot keeps its own best creature and each opponent's weakest.
    botChoice: {
      wanderer: (g, pid, choice) => {
        const cards = options(choice).map((id) => permanent(g, id)).filter((c): c is Card => !!c);
        const mine = cards[0]?.controller === pid;
        return { type: 'chooseCards', cards: [bestBy(g, choice, (c) => (mine ? threat(g, c) : -threat(g, c)))] };
      },
    },
  },

  // ===== Enchantments =====
  'The Legend of Yangchen': {
    chapters: [
      {
        // "I — Starting with you, each player chooses up to one permanent with mana value 3 or
        // greater from among permanents your opponents control. Exile those permanents."
        text: 'Starting with you, each player chooses up to one permanent with mana value 3 or greater from among permanents your opponents control. Exile those permanents.',
        resolve: (g, { you }) => yangchenChoose(g, you, turnOrder(g, you), 0, []),
      },
      {
        // "II — You may have target opponent draw three cards. If you do, draw three cards."
        text: 'You may have target opponent draw three cards. If you do, draw three cards.',
        targets: [{ type: 'player', who: 'opponent', label: 'target opponent' }],
        resolve: (g, { you, targets }) => {
          const o = refPlayer(g, targets[0]);
          if (o) ask(g, you, { text: `You may have ${o.name} draw three cards. If you do, you draw three cards.`, yes: 'Both Draw', no: "Don't", then: 'draw', data: { o: o.id } });
        },
      },
      {
        // "III — Exile this Saga, then return it to the battlefield transformed under your control."
        text: 'Exile this Saga, then return it to the battlefield transformed under your control.',
        resolve: (g, { self, you }) => {
          const me = still(g, self);
          if (!me) return;
          exile(g, me);
          if (me.zone === ('exile' as Card['zone'])) enterBattlefield(g, me, { controller: you, face: 1 });
        },
      },
    ],
    then: {
      yangchen: (g, { you, picked, data: d }) => yangchenChoose(g, you, d.order as PlayerId[], (d.i as number) + 1, [...(d.chosen as string[]), ...picked.map((c) => c.id)]),
      draw: (g, { you, yes, data: d }) => {
        if (!yes) return;
        draw(g, d.o as PlayerId, 3);
        draw(g, you, 3);
      },
    },
    botChoice: {
      yangchen: (g, pid, choice) => biggestThreat(g, pid, choice),
      draw: (g, pid) => ({ type: 'answer', yes: g.players[pid].hand.length <= 3 }),
    },
  },
  'Avatar Yangchen': {
    // "Whenever you cast your second spell each turn, airbend up to one other target nonland permanent."
    onCast: {
      when: (g, { self, caster }) => caster === self.controller && g.players[caster].spellsCast === 2,
      targets: [{ type: 'permanent', optional: true, label: 'up to one other target nonland permanent', filter: (g, c, self) => c.id !== self.id && !isLand(g, c) }],
      resolve: (g, { targets }) => {
        const c = refCard(g, targets[0]);
        if (c) airbend(g, [c]);
      },
      text: 'Whenever you cast your second spell each turn, airbend up to one other target nonland permanent.',
    },
  },
  'Trouble in Pairs': {
    // "If an opponent would begin an extra turn, that player skips that turn instead." (614.10)
    skipsExtraTurn: (_g, self, pid) => pid !== self.controller,
    // "Whenever an opponent attacks you with two or more creatures, draws their second card each
    // turn, or casts their second spell each turn, you draw a card." Three trigger events.
    onAttackersDeclared: {
      when: (g, { self, player, attacks }) => isOpponent(g, self.controller, player) && attacks.filter((a) => a.defender === self.controller && a.target === null).length >= 2,
      resolve: (g, { you }) => draw(g, you),
      text: 'Whenever an opponent attacks you with two or more creatures, you draw a card.',
    },
    onDraw: {
      when: (g, { self, player }) => isOpponent(g, self.controller, player) && g.players[player].drawn === 2,
      resolve: (g, { you }) => draw(g, you),
      text: 'Whenever an opponent draws their second card each turn, you draw a card.',
    },
    onCast: {
      when: (g, { self, caster }) => isOpponent(g, self.controller, caster) && g.players[caster].spellsCast === 2,
      resolve: (g, { you }) => draw(g, you),
      text: 'Whenever an opponent casts their second spell each turn, you draw a card.',
    },
  },

  // ===== Instants and sorceries =====
  "Avatar's Wrath": {
    // "Choose up to one target creature, then airbend all other creatures." If the target has
    // become illegal, the spell does nothing at all (608.2b).
    targets: [{ type: 'creature', optional: true, label: 'up to one target creature' }],
    onResolve: (g, { you, targets }) => {
      const kept = refCard(g, targets[0]);
      airbend(g, allCreatures(g).filter((c) => c.id !== kept?.id));
      // "Until your next turn, your opponents can't cast spells from anywhere other than their hands."
      for (const o of opponentsOf(g, you)) addEffect(g, { kind: 'cantCast', player: o.id, notFromHand: true, ends: { nextTurnOf: you } });
      log(g, `Until ${their(g.players[you])} next turn, ${g.players[you].you ? 'your' : `${g.players[you].name}'s`} opponents can't cast spells from anywhere but their hands.`, you);
    },
    // "Exile Avatar's Wrath." (608.2n)
    exilesItself: true,
  },
  'Cling to Dust': {
    // "Exile target card from a graveyard. If it was a creature card, you gain 3 life. Otherwise, you draw a card."
    targets: [graveyardCard],
    onResolve: (g, { you, targets }) => {
      const c = exileFromGraveyard(g, refGraveyard(g, targets[0]));
      if (!c) return;
      if (hasType(g, c, 'Creature')) gainLife(g, you, 3);
      else draw(g, you);
    },
    // "Escape—{3}{B}, Exile five other cards from your graveyard." (702.138a)
    escape: { mana: '{3}{B}', exile: 5 },
  },
  'Eerie Interlude': {
    // "Exile any number of target creatures you control. Return those cards to the battlefield
    // under their owner's control at the beginning of the next end step."
    targets: [{ type: 'creature', who: 'you', any: true, label: 'target creatures you control' }],
    onResolve: (g, { self, you, targets }) => {
      const gone = exileForNow(g, targets.map((t) => refCard(g, t)).filter((c): c is Card => !!c));
      if (gone.length) delay(g, self, you, { key: 'interlude', step: 'end', data: { cards: gone } });
    },
    delayed: {
      interlude: (g, { data: d }) => {
        const cards = (d.cards as { id: string; moves: number }[]).map((r) => inExile(g, r)).filter((c): c is Card => !!c);
        enterTogether(g, cards.map((card) => ({ card, opts: { controller: card.owner } })));
      },
    },
  },
  Ephemerate: {
    // "Exile target creature you control, then return it to the battlefield under its owner's
    // control." Rebound (702.88a) is the engine's.
    targets: [{ type: 'creature', who: 'you', label: 'target creature you control' }],
    onResolve: (g, { targets }) => blink(g, refCard(g, targets[0])),
  },
  'Flare of Fortitude': {
    // "You may sacrifice a nontoken white creature rather than pay this spell's mana cost." (118.9)
    alternativeCosts: [
      {
        label: 'Sacrifice a nontoken white creature',
        mana: '',
        sacrifice: { type: 'creature', who: 'you', label: 'a nontoken white creature', filter: (g, c) => !c.isToken && isColor(g, c, 'W') },
      },
    ],
    // "Until end of turn, your life total can't change, and permanents you control gain hexproof
    // and indestructible." The permanents are the ones you control as it resolves (611.2c).
    onResolve: (g, { you }) => {
      addEffect(g, { kind: 'lifeLocked', player: you });
      for (const c of g.players[you].battlefield) pump(g, c, 0, 0, ['hexproof', 'indestructible']);
      log(g, `Until end of turn, ${their(g.players[you])} life total can't change, and ${their(g.players[you])} permanents have hexproof and indestructible.`, you);
    },
  },
  'Insatiable Avarice': {
    // "Spree" (702.172a): each mode chosen adds its cost.
    modal: {
      min: 1,
      max: 2,
      modes: [
        {
          // "+ {2} — Search your library for a card, then shuffle and put that card on top."
          text: 'Search your library for a card, then shuffle and put that card on top.',
          cost: '{2}',
          resolve: (g, { you }) => search(g, you, 'top'),
        },
        {
          // "+ {B}{B} — Target player draws three cards and loses 3 life."
          text: 'Target player draws three cards and loses 3 life.',
          cost: '{B}{B}',
          targets: [{ type: 'player', label: 'target player' }],
          resolve: (g, { targets }) => {
            const p = refPlayer(g, targets[0]);
            if (!p) return;
            draw(g, p.id, 3);
            loseLife(g, p.id, 3);
          },
        },
      ],
    },
  },
  'Lively Dirge': {
    modal: {
      min: 1,
      max: 2,
      modes: [
        {
          // "+ {1} — Search your library for a card, put it into your graveyard, then shuffle."
          text: 'Search your library for a card, put it into your graveyard, then shuffle.',
          cost: '{1}',
          resolve: (g, { you }) => search(g, you, 'none', undefined, { then: 'dirgeSearch' }),
        },
        {
          // "+ {2} — Return up to two creature cards with total mana value 4 or less from your
          // graveyard to the battlefield." With the first mode too, it waits for that card.
          text: 'Return up to two creature cards with total mana value 4 or less from your graveyard to the battlefield.',
          cost: '{2}',
          resolve: (g, { self, you }) => {
            if (!self.cast?.modes.includes(0)) dirgeReturn(g, you);
          },
        },
      ],
    },
    then: {
      dirgeSearch: (g, { self, you, picked }) => {
        const card = picked[0] && g.players[you].library.find((x) => x.id === picked[0].id);
        if (card) {
          log(g, `${says(g.players[you], 'puts')} ${label(card)} into ${their(g.players[you])} graveyard.`, you, [card]);
          moveCard(g, card, 'graveyard');
        }
        if (self.cast?.modes.includes(1)) dirgeReturn(g, you);
      },
      dirgeFirst: (g, { you, picked }) => {
        const first = picked[0];
        if (!first) return;
        const rest = dirgeCreatures(g, you, 4 - manaValue(first), [first.id]);
        if (!rest.length) return dirgeEnter(g, you, [first.id]);
        pickCards(g, you, g.players[you].graveyard, { min: 0, max: 1, pickable: rest, text: `choose up to one more creature card with mana value ${4 - manaValue(first)} or less`, button: 'Choose', then: 'dirgeSecond', data: { first: first.id } });
      },
      dirgeSecond: (g, { you, picked, data: d }) => dirgeEnter(g, you, [d.first as string, ...picked.map((c) => c.id)]),
    },
    botChoice: {
      dirgeFirst: (g, pid, choice) => ({ type: 'chooseCards', cards: [bestBy(g, { ...choice, cards: pickable(choice) } as Choice, (c) => cardWant(g, pid, c))] }),
      dirgeSecond: (g, pid, choice) => ({ type: 'chooseCards', cards: [bestBy(g, { ...choice, cards: pickable(choice) } as Choice, (c) => cardWant(g, pid, c))] }),
    },
  },
  'Ondu Inversion': {
    // "Destroy all nonland permanents."
    onResolve: (g) => destroyMany(g, battlefield(g).filter((c) => !isLand(g, c))),
  },
  'Ondu Skyruins': { entersTapped: true, mana: { amount: 1, colors: ['W'] } },
  "Teferi's Protection": {
    // "Until your next turn, your life total can't change and you gain protection from
    // everything. All permanents you control phase out." (119.7, 702.16j, 702.26b)
    onResolve: (g, { you }) => {
      addEffect(g, { kind: 'lifeLocked', player: you, ends: { nextTurnOf: you } });
      addEffect(g, { kind: 'protection', player: you, ends: { nextTurnOf: you } });
      log(g, `Until ${their(g.players[you])} next turn, ${their(g.players[you])} life total can't change and ${g.players[you].you ? 'you have' : `${g.players[you].name} has`} protection from everything.`, you);
      phaseOut(g, [...g.players[you].battlefield]);
    },
    // "Exile Teferi's Protection." (608.2n)
    exilesItself: true,
  },
  'Winds of Abandon': {
    // "Exile target creature you don't control. For each creature exiled this way, its controller
    // searches their library for a basic land card. Those players put those cards onto the
    // battlefield tapped, then shuffle." Overloaded, "target" becomes "each" (702.96b).
    targets: [{ type: 'creature', who: 'opponent', label: "target creature you don't control" }],
    alternativeCosts: [{ label: 'Overload {4}{W}{W}', mana: '{4}{W}{W}', overload: true }],
    onResolve: (g, { self, you, targets }) => {
      const overloaded = self.cast?.alt === 0;
      const victims = overloaded ? allCreatures(g).filter((c) => c.controller !== you) : [refCard(g, targets[0])].filter((c): c is Card => !!c);
      const count = new Map<PlayerId, number>();
      simultaneously(g, () => {
        for (const c of victims) {
          const controller = c.controller;
          exile(g, c);
          if (c.zone === ('exile' as Card['zone']) || c.isToken) count.set(controller, (count.get(controller) ?? 0) + 1);
        }
      });
      const order = turnOrder(g, g.active)
        .filter((pid) => count.has(pid) && !g.players[pid].lost)
        .map((pid) => ({ pid, n: count.get(pid)! }));
      windsSearch(g, order, 0, []);
    },
    then: {
      winds: (g, { picked, data: d }) => windsSearch(g, d.order as { pid: PlayerId; n: number }[], (d.i as number) + 1, [...(d.found as string[]), ...picked.map((c) => c.id)]),
    },
  },

  // ===== Tokens =====
  'Construct 0/0 artifacts': {
    // "This token gets +1/+1 for each artifact you control."
    static: (g, self, c) => {
      if (c.id !== self.id) return null;
      const n = g.players[self.controller].battlefield.filter((x) => hasType(g, x, 'Artifact')).length;
      return { power: n, toughness: n };
    },
  },
  Mutagen: {
    // "{1}, {T}, Sacrifice this token: Put a +1/+1 counter on target creature. Activate only as a sorcery."
    activated: {
      cost: { mana: '{1}', tap: true, sacrifice: true },
      sorcery: true,
      targets: [{ type: 'creature', label: 'target creature' }],
      text: 'Put a +1/+1 counter on target creature',
      resolve: (g, { targets }) => addCounters(g, refCard(g, targets[0]), 1),
    },
  },
});

// ---------- helpers the scripts above use ----------

/** The permanent whose ability is resolving, if it is still that object (400.7). */
function abilityPermanent(g: Game): Card | undefined {
  const item = g.stack.find((x) => x.id === g.resolving);
  return item ? still(g, item.card) : undefined;
}

/** Emperor of Bones: the creature card enters under your control with a finality counter, gains haste, and is sacrificed at the next end step. */
function emperorReturn(g: Game, self: Card, you: PlayerId, card: Card) {
  if (card.zone !== 'exile') return;
  // "It gains haste." No duration: for as long as it stays (611.2a).
  enterBattlefield(g, card, { controller: you, counters: { finality: 1 }, lasting: { keywords: ['haste'] }, after: { source: snapshot(self), key: 'returned', you } });
}

/** "Sacrifice it": only a permanent you still control can be (701.21a). */
function sacrificeIfYours(g: Game, you: PlayerId, ref: { id: string; moves: number }) {
  const c = still(g, ref);
  if (c && c.controller === you) sacrifice(g, c);
}

/** Currency Converter: the card goes to its owner's graveyard, and you get a Treasure for a land card or a Rogue for any other. */
function convert(g: Game, you: PlayerId, card: Card) {
  if (card.zone !== 'exile') return;
  log(g, `${says(g.players[you], 'puts')} ${label(card)} into ${their(g.players[card.owner])} graveyard.`, you, [card]);
  moveCard(g, card, 'graveyard');
  createToken(g, you, isLand(g, card) ? 'Treasure' : 'Rogue 2/2');
}

/** Lively Dirge: the creature cards chosen return together (603.6a). */
function dirgeEnter(g: Game, you: PlayerId, ids: string[]) {
  const cards = ids.map((id) => g.players[you].graveyard.find((x) => x.id === id)).filter((c): c is Card => !!c);
  enterTogether(g, cards.map((card) => ({ card, opts: { controller: you } })));
}

/** The card among a choice's options that scores highest. */
function bestBy(g: Game, choice: Choice, score: (c: Card) => number): string {
  const ids = pickable(choice);
  const cards = ids.map((id) => g.players.flatMap((p) => [...p.battlefield, ...p.graveyard, ...p.exile, ...p.library, ...p.hand]).find((x) => x.id === id)).filter((c): c is Card => !!c);
  return cards.sort((a, b) => score(b) - score(a))[0]?.id ?? ids[0];
}

/** Urza's Saga: its chapters give it abilities that last as long as it stays (611.2a). */
function urzasSaga(): CardScript {
  return {
    chapters: [
      {
        // "I — This Saga gains '{T}: Add {C}.'"
        text: 'This Saga gains "{T}: Add {C}."',
        resolve: (g, { self }) => void addLasting(g, still(g, self), { flags: ['urza mana'] }),
      },
      {
        // "II — This Saga gains '{2}, {T}: Create a 0/0 colorless Construct artifact creature token
        // with "This token gets +1/+1 for each artifact you control."'"
        text: 'This Saga gains "{2}, {T}: Create a 0/0 colorless Construct artifact creature token."',
        resolve: (g, { self }) => void addLasting(g, still(g, self), { flags: ['urza construct'] }),
      },
      {
        // "III — Search your library for an artifact card with mana cost {0} or {1}, put it onto
        // the battlefield, then shuffle." A card with no mana cost doesn't have {0} (202.1b).
        text: 'Search your library for an artifact card with mana cost {0} or {1}, put it onto the battlefield, then shuffle.',
        resolve: (g, { you }) => search(g, you, 'battlefield', { types: ['Artifact'], costs: ['{0}', '{1}'], label: 'an artifact card with mana cost {0} or {1}' }),
      },
    ],
    mana: { amount: 1, colors: ['C'], when: (g, self) => hasFlag(g, self, 'urza mana') },
    activated: {
      cost: { mana: '{2}', tap: true },
      when: (g, self) => hasFlag(g, self, 'urza construct'),
      text: 'Create a 0/0 Construct artifact creature token',
      resolve: (g, { you }) => createToken(g, you, 'Construct 0/0 artifacts'),
    },
    botActivate: (g, pid) => g.active !== pid && g.step === 'end',
  };
}
