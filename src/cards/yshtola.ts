// Card behaviour for the Y'shtola deck. Each script follows the card's Oracle text clause by
// clause (docs/card-scripting.md); comments quote the clauses that need care.
import { registerScripts } from '../engine/registry';
import {
  addCounters,
  addEffect,
  addMana,
  allCreatures,
  ask,
  bounce,
  chooseToDiscard,
  counterCount,
  createToken,
  damagePlayer,
  data,
  destroyMany,
  didThisTurn,
  dieMany,
  discard,
  draw,
  enterBattlefield,
  equip,
  extort,
  finishEnter,
  gainLife,
  hasType,
  isColor,
  isCreature,
  isPlaneswalker,
  jobSelect,
  label,
  living,
  log,
  loseLife,
  manaValue,
  markDid,
  moveCard,
  nameCard,
  offerCast,
  opponentsOf,
  permanent,
  pickCards,
  protectionFrom,
  pump,
  putOnBottomInAnyOrder,
  putOnBottomRandomly,
  refCard,
  refGraveyard,
  refPlayer,
  removeCounters,
  sacrifice,
  sameCard,
  says,
  search,
  simultaneously,
  stats,
  subtypesOf,
  their,
  turnOrder,
} from '../engine/rules';
import { cardWant, threat } from '../engine/ai';
import type { Action, Card, CardScript, Color, Game, GrantedTrigger, PlayerId, TargetSpec, Trigger, TriggerEvents, TriggerHook } from '../engine/types';
import { favouriteType } from './kraum-tymna';

// ---------- conditions and pieces ----------

const isOpponent = (g: Game, a: PlayerId, b: PlayerId | null) => b !== null && a !== b && !g.players[b].lost;

/** "Whenever you cast a noncreature spell" (the permanent's controller casts it). */
const youCastNoncreature = (_g: Game, e: { self: Card; card: Card; caster: PlayerId }) => e.caster === e.self.controller && !isCreature(e.card);

/** `source` deals `n` damage to each opponent of `you`, all at once (120.3, 510.2's "at the same time"). */
const damageEachOpponent = (g: Game, source: Card, you: PlayerId, n: number) =>
  simultaneously(g, () => {
    for (const o of opponentsOf(g, you)) damagePlayer(g, source, o.id, n);
  });

/** "Whenever you cast a noncreature spell, this [creature] deals 1 damage to each opponent." The Wizard tokens' and Black Mage's Rod's. */
const wizardPing: Trigger<TriggerEvents['onCast']> = {
  when: youCastNoncreature,
  resolve: (g, { self, you }) => damageEachOpponent(g, self, you, 1),
  text: 'Whenever you cast a noncreature spell, this creature deals 1 damage to each opponent.',
};

/** A triggered ability one card gives another (613.1f), typed by its hook. */
const granted = <H extends TriggerHook>(hook: H, trigger: Trigger<TriggerEvents[H]>, applies?: GrantedTrigger['applies']): GrantedTrigger => ({
  hook,
  trigger: trigger as Trigger<never>,
  ...(applies ? { applies } : {}),
});

/** "Enchant creature" (702.5a): the Aura spell targets the creature it will enchant (303.4a). */
const enchantCreature: TargetSpec = { type: 'creature', label: 'target creature' };

/** "Whenever enchanted creature deals damage to an opponent, you may draw a card." (Curiosity, Ophidian Eye) */
const curiosity: Pick<CardScript, 'enchant' | 'onDamage' | 'then' | 'botChoice'> = {
  enchant: enchantCreature,
  onDamage: {
    // "An opponent" is an opponent of the Aura's controller, "you".
    when: (g, { self, source, player }) => source.id === self.attachedTo && isOpponent(g, self.controller, player),
    resolve: (g, { you }) => ask(g, you, { text: 'You may draw a card.', yes: 'Draw', no: "Don't Draw", then: 'draw' }),
    text: 'Whenever enchanted creature deals damage to an opponent, you may draw a card.',
  },
  then: { draw: (g, { you, yes }) => yes && draw(g, you) },
  botChoice: { draw: (g, pid) => ({ type: 'answer', yes: g.players[pid].library.length > 2 }) },
};

/**
 * "Look at the top N cards of your library. Put K of them into your hand and the rest on the
 * bottom of your library in any order." (Dig Through Time, Stock Up)
 */
function lookAndKeep(g: Game, you: PlayerId, n: number, keep: number) {
  const top = g.players[you].library.slice(0, n);
  if (!top.length) return;
  const k = Math.min(keep, top.length);
  pickCards(g, you, top, { min: k, max: k, text: `put ${k === 1 ? 'one' : k === 2 ? 'two' : k} of them into your hand`, button: 'Put in Hand', then: 'kept', data: { top: top.map((c) => c.id) } });
}
const keptThen: NonNullable<CardScript['then']> = {
  kept: (g, { you, picked, data: d }) => {
    const p = g.players[you];
    const kept = picked.filter((c) => c.zone === 'library');
    for (const c of kept) moveCard(g, c, 'hand');
    if (kept.length) log(g, `${says(p, 'puts')} ${kept.length} card${kept.length === 1 ? '' : 's'} into ${their(p)} hand.`, you, [], { players: [you], text: `${says(p, 'puts')} ${kept.map(label).join(', ')} into ${their(p)} hand.`, cards: kept });
    const rest = (d.top as string[]).map((id) => p.library.find((c) => c.id === id)).filter((c): c is Card => !!c);
    putOnBottomInAnyOrder(g, you, rest);
  },
};

/** "Target creature you control gains protection from the color of your choice until end of turn": the colour is chosen as it resolves. */
function chooseProtection(g: Game, you: PlayerId, target: Card | undefined) {
  if (!target) return;
  nameCard(g, you, { text: `Choose a colour: ${label(target)} gains protection from it until end of turn.`, of: 'color', then: 'protect', data: { id: target.id, moves: target.moves } });
}
const protectThen: NonNullable<CardScript['then']> = {
  protect: (g, { name, data: d }) => {
    const c = permanent(g, d.id as string);
    if (!c || c.moves !== d.moves) return;
    pump(g, c, 0, 0, [protectionFrom(name as Color)]);
    log(g, `${label(c)} gains ${protectionFrom(name as Color)} until end of turn.`, c.controller, [c]);
  },
};

/**
 * A bot protects its creature from the colour that threatens it: the opponent's spell or
 * ability on top of the stack, else the commonest colour among opponents' creatures.
 */
function protectionColor(g: Game, pid: PlayerId): Action {
  const top = [...g.stack].reverse().find((x) => x.controller !== pid);
  const fromStack = top ? data(top.card).colors[0] : undefined;
  if (fromStack) return { type: 'name', name: fromStack };
  const counts = new Map<Color, number>();
  for (const o of opponentsOf(g, pid)) for (const c of o.battlefield) for (const x of data(c).colors) counts.set(x, (counts.get(x) ?? 0) + 1);
  const best = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  return { type: 'name', name: best ?? 'B' };
}

/** Is an opponent's spell or ability on the stack aimed at a creature `pid` controls? A bot protects it then. */
const underFire = (g: Game, pid: PlayerId) =>
  g.stack.some((x) => x.controller !== pid && x.targets.some((t) => t?.kind === 'card' && permanent(g, t.id)?.controller === pid));

/** The modal double-faced cards' land faces: "This land enters tapped. {T}: Add {C}." */
const tappedLand = (colors: Color[]): CardScript => ({ entersTapped: true, mana: { amount: 1, colors } });

/**
 * "Each player chooses ..., then sacrifices the rest" and "each opponent ... sacrifices a
 * creature ...": the players choose in turn order from the active player (101.4), and the
 * permanents are sacrificed together once all have chosen. `options` lists what a player
 * may choose from; with one option or none there is nothing to ask.
 */
function chooseInTurn(g: Game, order: PlayerId[], i: number, chosen: string[], optionsFor: (pid: PlayerId) => Card[], text: string, button: string, then: string, extra: Record<string, unknown> = {}): string[] | null {
  for (; i < order.length; i++) {
    const pid = order[i];
    if (g.players[pid].lost) continue;
    const options = optionsFor(pid);
    if (options.length > 1) {
      pickCards(g, pid, options, { min: 1, max: 1, text, button, then, data: { ...extra, order, i, chosen } });
      return null;
    }
    chosen.push(...options.map((c) => c.id));
  }
  return chosen;
}

// ---------- Single Combat and Papalymo Totolymo ----------

const keepers = (g: Game, pid: PlayerId) => g.players[pid].battlefield.filter((c) => isCreature(c) || isPlaneswalker(c));

/** Single Combat, once each player has chosen what to keep. */
function singleCombat(g: Game, you: PlayerId, order: PlayerId[], i: number, kept: string[]) {
  const done = chooseInTurn(g, order, i, kept, (pid) => keepers(g, pid), 'choose a creature or planeswalker to keep; you sacrifice the rest', 'Keep', 'kept');
  if (!done) return;
  const rest = living(g).flatMap((p) => keepers(g, p.id)).filter((c) => !done.includes(c.id));
  dieMany(g, rest, 'is sacrificed');
  // "Players can't cast creature or planeswalker spells until the end of your next turn."
  for (const p of living(g)) addEffect(g, { kind: 'cantCast', player: p.id, types: ['Creature', 'Planeswalker'], until: { player: you, turn: g.turn + 1 } });
  log(g, "Players can't cast creature or planeswalker spells until the end of " + `${their(g.players[you])} next turn.`, you);
}

/** "A creature with the greatest power among creatures they control" (ties: any of them). */
function strongest(g: Game, pid: PlayerId): Card[] {
  const mine = g.players[pid].battlefield.filter(isCreature);
  const most = Math.max(...mine.map((c) => stats(g, c).power));
  return mine.filter((c) => stats(g, c).power === most);
}

function papalymo(g: Game, order: PlayerId[], i: number, chosen: string[]) {
  const done = chooseInTurn(g, order, i, chosen, (pid) => strongest(g, pid), 'sacrifice a creature with the greatest power among creatures you control', 'Sacrifice', 'sacrificed');
  if (!done) return;
  dieMany(g, done.map((id) => permanent(g, id)).filter((c): c is Card => !!c), 'is sacrificed');
}

// ---------- the cards ----------

registerScripts({
  // ===== Commander =====
  "Y'shtola, Night's Blessed": {
    // "At the beginning of each end step, if a player lost 4 or more life this turn, you draw
    // a card." An intervening "if": checked as it triggers and as it resolves (603.4).
    onEndStep: {
      when: (g) => living(g).some((p) => p.lifeLost >= 4),
      resolve: (g, { you }) => {
        if (living(g).some((p) => p.lifeLost >= 4)) draw(g, you);
      },
      text: 'At the beginning of each end step, if a player lost 4 or more life this turn, you draw a card.',
    },
    // "Whenever you cast a noncreature spell with mana value 3 or greater, Y'shtola deals 2
    // damage to each opponent and you gain 2 life." Mana value counts X on the stack (202.3e).
    onCast: {
      when: (g, e) => youCastNoncreature(g, e) && manaValue(e.card) >= 3,
      resolve: (g, { self, you }) => {
        damageEachOpponent(g, self, you, 2);
        gainLife(g, you, 2);
      },
      text: "Whenever you cast a noncreature spell with mana value 3 or greater, Y'shtola deals 2 damage to each opponent and you gain 2 life.",
    },
  },

  // ===== Creatures =====
  "G'raha Tia, Scion Reborn": {
    // "Throw Wide the Gates — Whenever you cast a noncreature spell, you may pay X life, where
    // X is that spell's mana value. If you do, create a 1/1 colorless Hero creature token and
    // put X +1/+1 counters on it. Do this only once each turn." It triggers only while its
    // controller hasn't paid this turn (603.2h).
    onCast: {
      when: (g, e) => youCastNoncreature(g, e) && !didThisTurn(g, e.self.controller, "G'raha Tia"),
      resolve: (g, { you, card }) => {
        if (didThisTurn(g, you, "G'raha Tia")) return;
        const x = manaValue(card);
        ask(g, you, { text: `Throw Wide the Gates: pay ${x} life to create a 1/1 Hero with ${x} +1/+1 counter${x === 1 ? '' : 's'}?`, life: x, yes: `Pay ${x} Life`, no: "Don't Pay", then: 'gates', data: { x } });
      },
      text: 'Throw Wide the Gates',
    },
    then: {
      gates: (g, { you, yes, data: d }) => {
        if (!yes) return;
        markDid(g, you, "G'raha Tia");
        const [hero] = createToken(g, you, 'Hero');
        addCounters(g, hero, d.x as number);
      },
    },
    // A bot pays while it keeps a healthy life total.
    botChoice: { gates: (g, pid, choice) => ({ type: 'answer', yes: g.players[pid].life - ((choice as { data?: { x?: number } }).data?.x ?? 0) >= 15 }) },
  },
  'Emet-Selch of the Third Seat': {
    // "Spells you cast from your graveyard cost {2} less to cast." (601.2f)
    costModifier: (_g, self, _spell, caster, from) => (caster === self.controller && from === 'graveyard' ? -2 : 0),
    // "Whenever one or more opponents lose life, you may cast target instant or sorcery card
    // from your graveyard. If that spell would be put into your graveyard, exile it instead.
    // Do this only once each turn." Casting it pays its costs (608.2g); once cast this way,
    // it doesn't trigger again that turn (603.2h).
    onLifeLossTogether: {
      when: (g, { self, losses }) => losses.some((l) => isOpponent(g, self.controller, l.player)) && !didThisTurn(g, self.controller, 'Emet-Selch'),
      targets: [{ type: 'graveyard card', who: 'you', label: 'target instant or sorcery card in your graveyard', filter: (_g, c) => hasType(c, 'Instant') || hasType(c, 'Sorcery') }],
      resolve: (g, { you, targets }) => {
        const card = refGraveyard(g, targets[0]);
        if (!card || didThisTurn(g, you, 'Emet-Selch')) return;
        offerCast(g, you, card, { free: false, graveyardToExile: true, text: `You may cast ${label(card)} from your graveyard. If it would go to your graveyard, it is exiled instead.`, then: 'cast' });
      },
      text: 'Whenever one or more opponents lose life, you may cast target instant or sorcery card from your graveyard.',
    },
    then: { cast: (g, { you, yes }) => yes && markDid(g, you, 'Emet-Selch') },
  },
  'Mother of Runes': {
    // "{T}: Target creature you control gains protection from the color of your choice until end of turn."
    activated: {
      cost: { tap: true },
      targets: [{ type: 'creature', who: 'you', label: 'target creature you control' }],
      text: 'Protection from a colour',
      resolve: (g, { you, targets }) => chooseProtection(g, you, refCard(g, targets[0])),
    },
    then: protectThen,
    botChoice: { protect: (g, pid) => protectionColor(g, pid) },
    botActivate: (g, pid) => underFire(g, pid),
  },
  'Papalymo Totolymo': {
    // "Whenever you cast a noncreature spell, Papalymo Totolymo deals 1 damage to each opponent and you gain 1 life."
    onCast: {
      when: youCastNoncreature,
      resolve: (g, { self, you }) => {
        damageEachOpponent(g, self, you, 1);
        gainLife(g, you, 1);
      },
      text: 'Whenever you cast a noncreature spell, Papalymo Totolymo deals 1 damage to each opponent and you gain 1 life.',
    },
    // "{4}, {T}, Sacrifice Papalymo Totolymo: Each opponent who lost life this turn sacrifices
    // a creature with the greatest power among creatures they control." Who lost life is
    // checked as it resolves.
    activated: {
      cost: { mana: '{4}', tap: true, sacrifice: true },
      text: 'Each opponent who lost life this turn sacrifices their most powerful creature',
      resolve: (g, { you }) =>
        papalymo(
          g,
          turnOrder(g, g.active).filter((o) => o !== you && g.players[o].lifeLost > 0),
          0,
          [],
        ),
    },
    then: {
      sacrificed: (g, { picked, data: d }) => papalymo(g, d.order as PlayerId[], (d.i as number) + 1, [...(d.chosen as string[]), ...picked.map((c) => c.id)]),
    },
    botChoice: { sacrificed: (g, _pid, choice) => ({ type: 'chooseCards', cards: [leastThreat(g, choice)] }) },
    // A bot uses it when it takes something worth more than Papalymo from someone.
    botActivate: (g, pid) => opponentsOf(g, pid).some((o) => o.lifeLost > 0 && strongest(g, o.id).some((c) => threat(g, c) >= 4)),
  },
  'Roaming Throne': {
    // "As this creature enters, choose a creature type." (614.1c, 614.12a)
    replaceEnter: (g, c, controller) => {
      nameCard(g, controller, { text: 'Choose a creature type.', of: 'creature type', then: 'type', script: c.id });
      return true;
    },
    then: { type: (g, { self, name, data: d }) => finishEnter(g, self, d, { chosen: name }) },
    botChoice: { type: (g, pid) => ({ type: 'name', name: favouriteType(g, pid) }) },
    // "This creature is the chosen type in addition to its other types."
    grantsSubtypes: (_g, self, c) => (c.id === self.id && self.chosen ? [self.chosen] : []),
    // "If a triggered ability of another creature you control of the chosen type triggers, it
    // triggers an additional time." (603.2d)
    doublesTriggers: (_g, self, source) =>
      !!self.chosen && source.id !== self.id && source.controller === self.controller && isCreature(source) && subtypesOf(source).includes(self.chosen),
  },

  // ===== Artifacts =====
  "Bender's Waterskin": {
    // "Untap this artifact during each other player's untap step." (502.3)
    untapsOthersTurn: (_g, self, c, active) => c.id === self.id && active !== self.controller,
    mana: { amount: 1, colors: 'any' },
  },
  "Black Mage's Rod": {
    // "Job select" (702.182a).
    onEnter: jobSelect,
    // "Equipped creature gets +1/+0, has 'Whenever you cast a noncreature spell, this creature
    // deals 1 damage to each opponent,' and is a Wizard in addition to its other types."
    static: (_g, self, c) => (self.attachedTo === c.id ? { power: 1 } : null),
    grants: [granted('onCast', wizardPing, (_g, self, c) => self.attachedTo === c.id)],
    grantsSubtypes: (_g, self, c) => (self.attachedTo === c.id ? ['Wizard'] : []),
    activated: equip('{3}'),
  },
  'Coalition Relic': {
    mana: { amount: 1, colors: 'any' },
    // "{T}: Put a charge counter on this artifact."
    activated: {
      cost: { tap: true },
      text: 'Put a charge counter on this artifact',
      resolve: (g, { self }) => {
        const me = permanent(g, self.id);
        if (sameCard(me, self)) addCounters(g, me, 1, 'charge');
      },
    },
    // "At the beginning of your first main phase, remove all charge counters from this
    // artifact. Add one mana of any color for each charge counter removed this way." Not a
    // mana ability: it triggers on a phase, so it uses the stack (605.5a).
    onPrecombatMain: {
      when: (_g, { self, player }) => player === self.controller,
      resolve: (g, { you, self }) => {
        const me = permanent(g, self.id);
        if (!me || !sameCard(me, self)) return;
        const n = counterCount(me, 'charge');
        if (!n) return;
        removeCounters(me, n, 'charge');
        nameCard(g, you, { text: `Coalition Relic: choose the colour of mana 1 of ${n}.`, of: 'color', then: 'color', data: { left: n, of: n } });
      },
      text: 'Remove all charge counters and add that much mana',
    },
    then: {
      color: (g, { you, self, name, data: d }) => {
        addMana(g, you, [name as Color], self);
        const left = (d.left as number) - 1;
        if (left > 0) nameCard(g, you, { text: `Coalition Relic: choose the colour of mana ${(d.of as number) - left + 1} of ${d.of}.`, of: 'color', then: 'color', data: { left, of: d.of } });
      },
    },
    // A bot stores mana at the end of an opponent's turn, when its mana would go unused.
    botActivate: (g, pid) => g.active !== pid && g.step === 'end' && !g.stack.length,
  },
  'Relic of Legends': {
    // "{T}: Add one mana of any color." "Tap an untapped legendary creature you control: Add
    // one mana of any color." The second isn't a {T} ability of the creature, so a creature
    // that just arrived can pay it (302.6). It is used by hand only.
    mana: [
      { amount: 1, colors: 'any' },
      { amount: 1, colors: 'any', noTap: true, manual: true, tapCreature: { legendary: true } },
    ],
  },
  'Unwinding Clock': {
    // "Untap all artifacts you control during each other player's untap step." (502.3)
    untapsOthersTurn: (_g, self, c, active) => active !== self.controller && c.controller === self.controller && hasType(c, 'Artifact'),
  },

  // ===== Enchantments =====
  'Blind Obedience': {
    // "Extort" (702.101a).
    ...extort,
    // "Artifacts and creatures your opponents control enter tapped." (614.1c)
    entersTappedFor: (_g, self, c) => c.controller !== self.controller && (hasType(c, 'Artifact') || isCreature(c)),
  },
  'Bloodchief Ascension': {
    // "At the beginning of each end step, if an opponent lost 2 or more life this turn, you may
    // put a quest counter on this enchantment." (603.4: checked again as it resolves)
    onEndStep: {
      when: (g, { self }) => opponentsOf(g, self.controller).some((o) => o.lifeLost >= 2),
      resolve: (g, { you }) => {
        if (opponentsOf(g, you).some((o) => o.lifeLost >= 2)) ask(g, you, { text: 'You may put a quest counter on Bloodchief Ascension.', yes: 'Add Counter', no: "Don't", then: 'quest' });
      },
      text: 'At the beginning of each end step, if an opponent lost 2 or more life this turn, you may put a quest counter on this enchantment.',
    },
    // "Whenever a card is put into an opponent's graveyard from anywhere, if this enchantment
    // has three or more quest counters on it, you may have that player lose 2 life. If you do,
    // you gain 2 life."
    onCardToGraveyard: {
      when: (g, { self, player }) => isOpponent(g, self.controller, player) && counterCount(self, 'quest') >= 3,
      resolve: (g, { you, self, player }) => {
        const me = permanent(g, self.id);
        if (!sameCard(me, self) || counterCount(me!, 'quest') < 3 || g.players[player].lost) return;
        ask(g, you, { text: `You may have ${g.players[player].name} lose 2 life. If you do, you gain 2 life.`, yes: 'Drain 2', no: "Don't", then: 'drain', data: { player } });
      },
      text: "Whenever a card is put into an opponent's graveyard from anywhere, you may have that player lose 2 life and gain 2 life.",
    },
    then: {
      quest: (g, { you, self, yes }) => {
        const me = permanent(g, self.id);
        if (yes && sameCard(me, self)) {
          addCounters(g, me, 1, 'quest');
          log(g, `${says(g.players[you], 'puts')} a quest counter on Bloodchief Ascension (${counterCount(me!, 'quest')}).`, you, [me!]);
        }
      },
      drain: (g, { you, yes, data: d }) => {
        if (!yes) return;
        loseLife(g, d.player as PlayerId, 2);
        gainLife(g, you, 2);
      },
    },
    botChoice: { quest: () => ({ type: 'answer', yes: true }), drain: () => ({ type: 'answer', yes: true }) },
  },
  Curiosity: curiosity,
  'Ophidian Eye': curiosity,
  'Helm of the Ghastlord': {
    enchant: enchantCreature,
    // "As long as enchanted creature is blue, it gets +1/+1 and has 'Whenever this creature
    // deals damage to an opponent, draw a card.' As long as enchanted creature is black, it
    // gets +1/+1 and has 'Whenever this creature deals damage to an opponent, that player
    // discards a card.'" Both apply to a blue and black creature.
    static: (_g, self, c) => {
      if (self.attachedTo !== c.id) return null;
      const n = (isColor(c, 'U') ? 1 : 0) + (isColor(c, 'B') ? 1 : 0);
      return n ? { power: n, toughness: n } : null;
    },
    grants: [
      granted(
        'onDamage',
        {
          when: (g, { self, source, player }) => source.id === self.id && isOpponent(g, self.controller, player),
          resolve: (g, { you }) => draw(g, you),
          text: 'Whenever this creature deals damage to an opponent, draw a card.',
        },
        (_g, self, c) => self.attachedTo === c.id && isColor(c, 'U'),
      ),
      granted(
        'onDamage',
        {
          when: (g, { self, source, player }) => source.id === self.id && isOpponent(g, self.controller, player),
          resolve: (g, { player }) => player !== null && chooseToDiscard(g, player, 1),
          text: 'Whenever this creature deals damage to an opponent, that player discards a card.',
        },
        (_g, self, c) => self.attachedTo === c.id && isColor(c, 'B'),
      ),
    ],
  },
  Propaganda: {
    // "Creatures can't attack you unless their controller pays {2} for each creature they
    // control that's attacking you." Attacking your planeswalker isn't attacking you (506.3).
    attackTax: (_g, self, _attacker, defender, target) => (defender === self.controller && target === null ? '{2}' : null),
  },
  'Sigil of Sleep': {
    enchant: enchantCreature,
    // "Whenever enchanted creature deals damage to a player, return target creature that
    // player controls to its owner's hand."
    onDamage: {
      when: (_g, { self, source, player }) => source.id === self.attachedTo && player !== null,
      targets: [{ type: 'creature', label: 'target creature that player controls', filter: (_g, c, source) => c.controller === source.triggeredBy?.player }],
      resolve: (g, { targets }) => bounce(g, refCard(g, targets[0])),
      text: 'Whenever enchanted creature deals damage to a player, return target creature that player controls to its owner’s hand.',
    },
  },
  'Solitary Confinement': {
    // "At the beginning of your upkeep, sacrifice this enchantment unless you discard a card."
    // You choose whether to discard (118.12a); with no cards in hand, you can't.
    onUpkeep: {
      when: (_g, { self, player }) => player === self.controller,
      resolve: (g, { you, self }) => {
        if (g.players[you].hand.length) ask(g, you, { text: 'Discard a card, or sacrifice Solitary Confinement.', yes: 'Discard', no: 'Sacrifice', then: 'upkeep' });
        else sacrificeSelf(g, self);
      },
      text: 'At the beginning of your upkeep, sacrifice this enchantment unless you discard a card.',
    },
    then: {
      upkeep: (g, { you, self, yes }) => {
        if (yes) chooseToDiscard(g, you, 1);
        else sacrificeSelf(g, self);
      },
    },
    botChoice: { upkeep: (g, pid) => ({ type: 'answer', yes: g.players[pid].hand.some((c) => cardWant(g, pid, c) < 4) }) },
    // "Skip your draw step." (614.1b) "You have shroud." (702.18a) "Prevent all damage that would be dealt to you." (615)
    skipDrawStep: true,
    givesShroud: (_g, self, pid) => pid === self.controller,
    preventsDamage: (_g, self, _source, to) => to.player === self.controller,
  },

  // ===== Instants and sorceries =====
  'Circle of Power': {
    // "You draw two cards and you lose 2 life. Create a 0/1 black Wizard creature token with
    // 'Whenever you cast a noncreature spell, this token deals 1 damage to each opponent.'
    // Wizards you control get +1/+0 and gain lifelink until end of turn." Which Wizards is
    // decided as it resolves, the new token among them (611.2c).
    onResolve: (g, { you }) => {
      draw(g, you, 2);
      loseLife(g, you, 2);
      createToken(g, you, 'Wizard 0/1 ping');
      for (const c of g.players[you].battlefield.filter((x) => isCreature(x) && subtypesOf(x).includes('Wizard'))) pump(g, c, 1, 0, ['lifelink']);
    },
  },
  'Decorum Dissertation': {
    // "Target player draws two cards and loses 2 life." Paradigm (702.192a) is the engine's.
    targets: [{ type: 'player', label: 'target player' }],
    onResolve: (g, { targets }) => {
      const p = refPlayer(g, targets[0]);
      if (!p) return;
      draw(g, p.id, 2);
      loseLife(g, p.id, 2);
    },
  },
  'Dig Through Time': {
    // "Look at the top seven cards of your library. Put two of them into your hand and the
    // rest on the bottom of your library in any order." Delve (702.66a) is the engine's.
    onResolve: (g, { you }) => lookAndKeep(g, you, 7, 2),
    then: keptThen,
  },
  Dusk: {
    // "Destroy all creatures with power 3 or greater."
    onResolve: (g) => destroyMany(g, allCreatures(g).filter((c) => stats(g, c).power >= 3)),
  },
  Dawn: {
    // "Return all creature cards with power 2 or less from your graveyard to your hand."
    // Aftermath (702.127a) is the engine's.
    onResolve: (g, { you }) => {
      const p = g.players[you];
      const back = p.graveyard.filter((c) => hasType(c, 'Creature') && stats(g, c).power <= 2);
      for (const c of back) moveCard(g, c, 'hand');
      if (back.length) log(g, `${says(p, 'returns')} ${back.map(label).join(', ')} to ${their(p)} hand.`, you, back);
    },
  },
  'Faith & Grief': {
    // "Return up to two target artifact and/or enchantment cards from your graveyard to your
    // hand." Then the card is exiled, and its owner may play the land later (715.3d).
    targets: [0, 1].map(
      (i): TargetSpec => ({
        type: 'graveyard card',
        who: 'you',
        optional: true,
        label: 'up to two target artifact and/or enchantment cards in your graveyard',
        filter: (_g, c) => hasType(c, 'Artifact') || hasType(c, 'Enchantment'),
        ...(i ? { distinctFrom: 0 } : {}),
      }),
    ),
    onResolve: (g, { you, targets }) => {
      const back = targets.map((t) => refGraveyard(g, t)).filter((c): c is Card => !!c);
      for (const c of back) moveCard(g, c, 'hand');
      if (back.length) log(g, `${says(g.players[you], 'returns')} ${back.map(label).join(' and ')} to ${their(g.players[you])} hand.`, you, back);
    },
  },
  'Ishgard, the Holy See': tappedLand(['W']),
  'Malakir Rebirth': {
    // "Choose target creature. You lose 2 life. Until end of turn, that creature gains 'When
    // this creature dies, return it to the battlefield tapped under its owner's control.'"
    targets: [{ type: 'creature', label: 'target creature' }],
    onResolve: (g, { you, targets }) => {
      loseLife(g, you, 2);
      const c = refCard(g, targets[0]);
      if (c) c.mods.push({ power: 0, toughness: 0, keywords: [], grant: { from: 'Malakir Rebirth', index: 0 } });
    },
    grants: [
      granted('onDies', {
        // It returns only if it is still the card that died (400.7): a token ceases to exist.
        resolve: (g, { self }) => {
          const card = g.players[self.owner].graveyard.find((x) => x.id === self.id && x.moves === self.moves + 1);
          if (card) enterBattlefield(g, card, { tapped: true, controller: card.owner });
        },
        text: "When this creature dies, return it to the battlefield tapped under its owner's control.",
      }),
    ],
  },
  'Malakir Mire': tappedLand(['B']),
  'Sejiri Shelter': {
    // "Target creature you control gains protection from the color of your choice until end of turn."
    targets: [{ type: 'creature', who: 'you', label: 'target creature you control' }],
    onResolve: (g, { you, targets }) => chooseProtection(g, you, refCard(g, targets[0])),
    then: protectThen,
    botChoice: { protect: (g, pid) => protectionColor(g, pid) },
  },
  'Sejiri Glacier': tappedLand(['W']),
  'Silundi Vision': {
    // "Look at the top six cards of your library. You may reveal an instant or sorcery card
    // from among them and put it into your hand. Put the rest on the bottom of your library in
    // a random order."
    onResolve: (g, { you }) => {
      const top = g.players[you].library.slice(0, 6);
      if (!top.length) return;
      const pickable = top.filter((c) => hasType(c, 'Instant') || hasType(c, 'Sorcery'));
      pickCards(g, you, top, { min: 0, max: 1, pickable, text: 'you may reveal an instant or sorcery card and put it into your hand', button: 'Reveal', then: 'vision', data: { top: top.map((c) => c.id) } });
    },
    then: {
      vision: (g, { you, picked, data: d }) => {
        const p = g.players[you];
        const [card] = picked.filter((c) => c.zone === 'library');
        if (card) {
          log(g, `${says(p, 'reveals')} ${label(card)} and ${p.you ? 'put' : 'puts'} it into ${their(p)} hand.`, you, [card]);
          moveCard(g, card, 'hand');
        }
        putOnBottomRandomly(g, (d.top as string[]).map((id) => p.library.find((c) => c.id === id)).filter((c): c is Card => !!c));
      },
    },
  },
  'Silundi Isle': tappedLand(['U']),
  'Single Combat': {
    // "Each player chooses a creature or planeswalker they control, then sacrifices the rest.
    // Players can't cast creature or planeswalker spells until the end of your next turn."
    onResolve: (g, { you }) => singleCombat(g, you, turnOrder(g, g.active), 0, []),
    then: {
      kept: (g, { you, picked, data: d }) => singleCombat(g, you, d.order as PlayerId[], (d.i as number) + 1, [...(d.chosen as string[]), ...picked.map((c) => c.id)]),
    },
    // A bot keeps its biggest threat.
    botChoice: { kept: (g, _pid, choice) => ({ type: 'chooseCards', cards: [mostThreat(g, choice)] }) },
  },
  'Stock Up': {
    // "Look at the top five cards of your library. Put two of them into your hand and the rest
    // on the bottom of your library in any order."
    onResolve: (g, { you }) => lookAndKeep(g, you, 5, 2),
    then: keptThen,
  },
  Transpose: {
    // "Draw a card, then discard a card. You lose 1 life. If this spell was cast from your
    // hand, create a 0/1 black Wizard creature token with 'Whenever you cast a noncreature
    // spell, this token deals 1 damage to each opponent.'" Rebound (702.88a) is the engine's;
    // cast again from exile, it makes no Wizard.
    onResolve: (g, ctx) => {
      draw(g, ctx.you);
      const hand = g.players[ctx.you].hand;
      if (hand.length) pickCards(g, ctx.you, hand, { min: 1, max: 1, text: 'discard a card', button: 'Discard', then: 'discarded' });
      else transposeRest(g, ctx.you, ctx.self);
    },
    then: {
      discarded: (g, { you, self, picked }) => {
        for (const c of picked) discard(g, c);
        transposeRest(g, you, self);
      },
    },
    botChoice: { discarded: (g, pid, choice) => ({ type: 'chooseCards', cards: [leastWanted(g, pid, choice)] }) },
  },
  'Waterlogged Teachings': {
    // "Search your library for an instant card or a card with flash, reveal it, put it into
    // your hand, then shuffle."
    ai: 'tutor',
    onResolve: (g, { you }) => search(g, you, 'hand', { types: ['Instant'], keywords: ['flash'], label: 'an instant card or a card with flash' }, { reveal: true }),
  },
  'Inundated Archive': tappedLand(['U', 'B']),

  // ===== Lands =====
  'Urborg, Tomb of Yawgmoth': {
    // "Each land is a Swamp in addition to its other land types." So each can tap for {B} (305.6).
    grantsSubtypes: (_g, _self, c) => (hasType(c, 'Land') && !subtypesOf(c).includes('Swamp') ? ['Swamp'] : []),
  },

  // ===== Tokens =====
  'Wizard 0/1 ping': { onCast: wizardPing },
});

function sacrificeSelf(g: Game, self: Card) {
  const me = permanent(g, self.id);
  if (me && sameCard(me, self)) sacrifice(g, me);
}

function transposeRest(g: Game, you: PlayerId, self: Card) {
  loseLife(g, you, 1);
  if (self.cast?.from === 'hand') createToken(g, you, 'Wizard 0/1 ping');
}

const pickOptions = (choice: unknown) => ((choice as { cards?: string[] }).cards ?? []);
function mostThreat(g: Game, choice: unknown): string {
  const cards = pickOptions(choice).map((id) => permanent(g, id)).filter((c): c is Card => !!c);
  return cards.sort((a, b) => threat(g, b) - threat(g, a))[0]?.id ?? pickOptions(choice)[0];
}
function leastThreat(g: Game, choice: unknown): string {
  const cards = pickOptions(choice).map((id) => permanent(g, id)).filter((c): c is Card => !!c);
  return cards.sort((a, b) => threat(g, a) - threat(g, b))[0]?.id ?? pickOptions(choice)[0];
}
function leastWanted(g: Game, pid: PlayerId, choice: unknown): string {
  const hand = g.players[pid].hand.filter((c) => pickOptions(choice).includes(c.id));
  return hand.sort((a, b) => cardWant(g, pid, a) - cardWant(g, pid, b))[0]?.id ?? pickOptions(choice)[0];
}
