// Game setup, turn structure, priority, the stack and action handling. `applyAction` is
// the only way a game changes: it returns a new Game, or the same object if the action
// was illegal. Rule numbers in comments refer to docs/rules.
import { produce } from 'immer';
import { CREATURE_TYPES, DECKS, cardData, deckColors, deckLibrary, isCardName } from '../cards/db';
import type { DeckDef } from '../cards/db';
import {
  STARTING_LIFE,
  broadcast,
  canAttack,
  canBlock,
  canTapForMana,
  canUntapMana,
  altCostsOf,
  castCost,
  checkState,
  commanderIndex,
  creaturesOf,
  damageCard,
  data,
  dealDamage,
  damagePlayer,
  describeRef,
  dieMany,
  draw,
  enterBattlefield,
  has,
  canProtect,
  isBattle,
  isCreature,
  isInstantSpeed,
  isPlaneswalker,
  landFaces,
  layoutOf,
  isSaga,
  addCounters,
  maxHandSize,
  facesOf,
  asSpell,
  isLand,
  isPermanentCard,
  label,
  legalTargets,
  living,
  log,
  loyaltyOf,
  makeCard,
  removeCounters,
  moveCard,
  nextLiving,
  parseCost,
  pay,
  permanent,
  planPayment,
  rand,
  refCard,
  refCards,
  returnCommander,
  sameRef,
  says,
  searchable,
  shuffle,
  snapshot,
  abilityCost,
  copyItem,
  findCard,
  flashGranted,
  forbidden,
  loseGame,
  resolvingItem,
  spellTargets,
  checkWard,
  counter,
  counterCount,
  discard,
  fitsSpec,
  freeCast,
  hasEscape,
  manaValue,
  permission,
  ask,
  createToken,
  MUST_ATTACK,
  RETURN_TO_HAND,
  stats,
  tapForMana,
  targetSpecs,
  trigger,
  turnOrder,
  untapMana,
  scriptFor,
} from './rules';
import type {
  Action,
  AskChoice,
  Card,
  CardChoice,
  CastChoices,
  CastInfo,
  Choice,
  ExtraTurn,
  Game,
  Player,
  PlayerId,
  StackItem,
  Step,
  TargetRef,
  TargetSpec,
  RetargetChoice,
  ThenCtx,
  Trigger,
  TriggerEvents,
  Zone,
} from './types';

// ---------- setup ----------

export interface NewGameOptions {
  seed: number;
  /** Deck index the human plays in seat 0, or null for four bots. */
  humanDeck: number | null;
  /** Players' own stops, as in `ApplyOptions`. */
  stops?: ApplyOptions['stops'];
  /** The deck in each seat, instead of the menu's decks. For tests; every seat is a bot unless `humanDeck` is set. */
  decks?: DeckDef[];
}

export function newGame({ seed, humanDeck, stops, decks }: NewGameOptions): Game {
  const g: Game = {
    players: [],
    active: 0,
    priority: 0,
    turn: 0,
    step: 'untap',
    decision: null,
    stack: [],
    triggers: [],
    mulligan: null,
    choices: [],
    resolving: null,
    passes: 0,
    holding: null,
    combat: null,
    winner: null,
    log: [],
    rng: seed | 0,
    nextId: 1,
    lastSpell: null,
    spellsCast: 0,
    combatDamaged: [],
    effects: [],
    delayed: [],
    extraTurns: [],
  };
  // The human's deck goes in seat 0 and the bots take the next decks on the menu.
  const others = DECKS.filter((_, i) => i !== humanDeck);
  const seats = decks ?? (humanDeck === null ? others : [DECKS[humanDeck], ...others]).slice(0, 4);
  seats.forEach((deck, seat) => {
    const human = humanDeck !== null && seat === 0;
    const p: Player = {
      id: seat,
      name: human ? 'You' : deck.pilot,
      isBot: !human,
      deckId: deck.id,
      commanders: deck.commanders,
      colors: deckColors(deck),
      life: STARTING_LIFE,
      library: [],
      hand: [],
      battlefield: [],
      graveyard: [],
      exile: [],
      command: [],
      commanderCasts: deck.commanders.map(() => 0),
      commanderDamage: [], // filled in below, once every seat's commanders are known
      landsPlayed: 0,
      pool: [],
      lost: false,
      drewFromEmpty: false,
      loses: null,
      wins: false,
      spellsCast: 0,
      noncreatureSpellsCast: 0,
      drawn: 0,
    };
    // Every commander starts in the command zone, both partners included (903.6, 702.124b).
    for (const name of deck.commanders) p.command.push(makeCard(g, name, seat, 'command', { isCommander: true }));
    p.library = deckLibrary(deck).map((name) => makeCard(g, name, seat, 'library'));
    shuffle(g, p.library); // 103.3
    drawHand(p);
    g.players.push(p);
  });
  for (const p of g.players) p.commanderDamage = g.players.map((o) => o.commanders.map(() => 0));
  beginMulligans(g, Math.floor(rand(g) * 4));
  settle(g, true, stops);
  return g;
}

// ---------- mulligans ----------

const HAND_SIZE = 7;

/** Draws a starting hand (103.5). Not a draw for "whenever you draw" abilities: nothing is on the battlefield yet. */
function drawHand(p: Player) {
  for (const c of p.library.splice(0, HAND_SIZE)) {
    c.zone = 'hand';
    p.hand.push(c);
  }
}

/**
 * In a multiplayer game a player's first mulligan is free: it doesn't count toward the
 * cards they put on the bottom or the mulligans they may take (103.5c). Games always have
 * four players for now, but a two-player game would make this false.
 */
const freeMulligan = (g: Game) => g.players.length > 2;

/** Mulligans that count against the hand (103.5c). */
const countedMulligans = (g: Game, taken: number) => Math.max(0, taken - (freeMulligan(g) ? 1 : 0));

/** Can this player take another mulligan? Not once their hand would be zero cards (103.5). */
export function canMulligan(g: Game, pid: PlayerId): boolean {
  const m = g.mulligan;
  return !!m && countedMulligans(g, m.taken[pid]) < HAND_SIZE;
}

/** How many cards the player would put on the bottom if they took one more mulligan. */
export const nextMulliganBottom = (g: Game, pid: PlayerId) => countedMulligans(g, (g.mulligan?.taken[pid] ?? 0) + 1);

/** The starting player is chosen (103.1), then everyone declares in turn order from them (103.5). */
function beginMulligans(g: Game, starter: PlayerId) {
  g.active = starter;
  g.mulligan = { taken: g.players.map(() => 0), waiting: turnOrder(g, starter), taking: [] };
  continueMulligans(g);
}

/**
 * Moves the mulligan process on (103.5). Asks the next player to declare. Once everyone
 * has, all who chose to mulligan do so at the same time: they shuffle their hand back,
 * draw seven, and put cards on the bottom. Then those players declare again, until nobody
 * takes a mulligan and the starting player takes the first turn (103.8).
 */
function continueMulligans(g: Game) {
  const m = g.mulligan!;
  if (m.waiting.length) {
    g.decision = { type: 'mulligan' };
    g.priority = m.waiting[0];
    return;
  }
  if (!m.taking.length) {
    // Actions from opening hands, the starting player first, then the others in turn order (103.6).
    if (!m.opened) {
      m.opened = true;
      g.decision = null;
      for (const pid of turnOrder(g, g.active)) {
        for (const c of [...g.players[pid].hand]) scriptFor(c).openingHand?.(g, c, pid);
      }
      if (nextChoice(g)) return;
    }
    g.mulligan = null;
    g.decision = null;
    // In a multiplayer game nobody skips their first draw (103.8c).
    beginTurn(g, g.active);
    return;
  }
  const taking = m.taking;
  m.taking = [];
  for (const pid of taking) {
    const p = g.players[pid];
    m.taken[pid]++;
    for (const c of [...p.hand]) moveCard(g, c, 'library');
    shuffle(g, p.library);
    drawHand(p);
    const bottom = countedMulligans(g, m.taken[pid]);
    if (bottom > 0) g.choices.push({ kind: 'bottom', player: pid, count: Math.min(bottom, p.hand.length) });
  }
  // Those who just took a mulligan declare again, unless their hand is down to nothing.
  m.waiting = taking.filter((pid) => canMulligan(g, pid));
  if (!nextChoice(g)) continueMulligans(g);
}

// ---------- card choices ----------

/** What a card choice shows the player: the cards, which of them can be picked, and how many. */
export function choiceOptions(g: Game, choice: CardChoice): { cards: Card[]; valid: Set<string>; min: number; max: number } {
  const p = g.players[choice.player];
  if (choice.kind === 'bottom') {
    return { cards: p.hand, valid: new Set(p.hand.map((c) => c.id)), min: choice.count, max: choice.count };
  }
  if (choice.kind === 'pick' || choice.kind === 'legend') {
    const cards = choice.cards.map((id) => findCard(g, id)).filter((c): c is Card => !!c);
    // The legend rule keeps exactly one (704.5j).
    if (choice.kind === 'legend') return { cards, valid: new Set(cards.map((c) => c.id)), min: 1, max: 1 };
    return { cards, valid: new Set(cards.map((c) => c.id)), min: Math.min(choice.min, cards.length), max: choice.max };
  }
  // The whole library is looked at (701.23a). Sorted, so the order of the library stays hidden (401.2).
  const cards = [...p.library].sort((a, b) => label(a).localeCompare(label(b)));
  const valid = new Set(cards.filter((c) => searchable(c, choice.find)).map((c) => c.id));
  // A search for a card with a stated quality may find nothing, even if there is one
  // (701.23b). A search for just "a card", or "three cards", must find them if it can (701.23d).
  const count = choice.count ?? 1;
  return { cards, valid, min: choice.find ? 0 : Math.min(count, valid.size), max: count };
}

/** Asks the next waiting choice, if there is one. */
function nextChoice(g: Game): boolean {
  while (g.choices.length) {
    const choice = g.choices.shift()!;
    if (g.players[choice.player].lost) continue;
    // A spell or ability with no targets left to change has nothing to ask (115.7d).
    if (choice.kind === 'retarget' && !g.stack.some((x) => x.id === choice.item && x.targets.some(Boolean))) continue;
    switch (choice.kind) {
      case 'ask':
        g.decision = { type: 'ask', choice };
        break;
      case 'name':
        g.decision = { type: 'name', choice };
        break;
      case 'player':
        g.decision = { type: 'player', choice };
        break;
      case 'cast':
        g.decision = { type: 'cast', choice };
        break;
      case 'retarget':
        g.decision = { type: 'retarget', choice };
        break;
      default:
        g.decision = { type: 'chooseCards', choice };
    }
    g.priority = choice.player;
    return true;
  }
  return false;
}

/** After a choice is made: the next one, or the mulligans go on, or the spell or ability finishes resolving. */
function afterChoice(g: Game) {
  if (nextChoice(g)) return;
  if (g.mulligan) continueMulligans(g);
  else finishResolving(g);
}

/**
 * Runs the continuation a choice names (`CardScript.then`), with the answer. Choices it
 * asks come before any that were already waiting: they are the next step of the same effect.
 */
function runThen(g: Game, choice: Choice, answer: { picked?: Card[]; yes?: boolean; name?: string; player?: PlayerId }) {
  if (!('then' in choice) || !choice.then) return;
  const key = choice.then;
  // The card the continuation belongs to: one entering the battlefield or acting from an
  // opening hand (`script`), or else the spell or ability resolving.
  const item = resolvingItem(g);
  const card = choice.script ? findCard(g, choice.script) : item ? (permanent(g, item.card.id) ?? item.card) : undefined;
  const fn = key.startsWith('@') ? ENGINE_THEN[key] : card && (choice.script ? scriptFor(card, 'battlefield') : scriptFor(item!.card)).then?.[key];
  if (!card || !fn) return;
  const waiting = g.choices;
  g.choices = [];
  const data = choice.data ?? {};
  fn(g, {
    self: card,
    you: choice.script ? ((data.enter as { controller?: PlayerId } | undefined)?.controller ?? choice.player) : item!.controller,
    targets: choice.script ? [] : item!.targets,
    chooser: choice.player,
    picked: answer.picked ?? [],
    yes: !!answer.yes,
    name: answer.name ?? '',
    player: answer.player ?? null,
    data,
  });
  g.choices = [...g.choices, ...waiting];
}

/** Continuations the engine itself runs, for keyword actions and abilities (`then` keys starting with "@"). */
const ENGINE_THEN: Record<string, (g: Game, ctx: ThenCtx) => void> = {
  // Surveil (701.25a): the cards picked go to the graveyard; the rest stay on top.
  '@surveil': (g, { chooser, picked }) => {
    const p = g.players[chooser];
    for (const c of picked) moveCard(g, c, 'graveyard');
    log(g, picked.length ? `${says(p, 'surveils')} and ${p.isBot ? 'puts' : 'put'} ${picked.map(label).join(', ')} into ${p.isBot ? 'their' : 'your'} graveyard.` : `${says(p, 'surveils')}.`, chooser, picked);
  },
  // "Sacrifices a creature of their choice" (701.21a).
  '@sacrifice': (g, { picked }) => {
    const c = picked[0] && permanent(g, picked[0].id);
    if (c) dieMany(g, [c], 'is sacrificed');
  },
  // "Discards a card" (701.9a): the player chose which.
  '@discard': (g, { picked }) => {
    for (const c of picked) discard(g, c);
  },
  // Ward (702.21a): the spell or ability is countered unless its controller paid.
  '@ward': (g, { yes, data }) => {
    if (!yes) counter(g, { kind: 'stack', id: data.item as string });
  },
};

/** Carries out a card choice once the player has made it. */
function doChoice(g: Game, choice: CardChoice, cards: Card[]) {
  const p = g.players[choice.player];
  if (choice.kind === 'legend') return;
  if (choice.kind === 'bottom') {
    for (const c of cards) moveCard(g, c, 'library'); // onto the bottom, in the chosen order (103.5)
    log(g, `${says(p, 'puts')} ${cards.length} card${cards.length === 1 ? '' : 's'} on the bottom.`, p.id);
    return;
  }
  if (choice.kind === 'pick') return runThen(g, choice, { picked: cards });
  const [found] = cards;
  // A card found is shown only if the effect says to reveal it, or it goes onto the battlefield (701.23e).
  const shown = found && (choice.reveal || choice.to === 'battlefield' || !p.isBot);
  const many = cards.length > 1 ? `${cards.length} cards` : 'a card';
  if (found) log(g, `${says(p, 'searches')} ${p.isBot ? 'their' : 'your'} library for ${shown ? cards.map(label).join(', ') : many}.`, p.id, shown ? cards : []);
  else log(g, `${says(p, 'searches')} ${p.isBot ? 'their' : 'your'} library and ${p.isBot ? 'finds' : 'find'} nothing.`, p.id);
  if (found && choice.to === 'battlefield') enterBattlefield(g, found, { tapped: choice.tapped });
  else if (found && choice.to === 'hand') moveCard(g, found, 'hand');
  // Several searches of one library in a row are one search, and it is shuffled once (701.23h).
  const next = g.choices[0];
  if (choice.to === 'top' || !(next?.kind === 'search' && next.player === p.id)) {
    if (found && choice.to === 'top') p.library.splice(p.library.findIndex((c) => c.id === found.id), 1);
    shuffle(g, p.library);
    if (found && choice.to === 'top') p.library.unshift(found); // "then shuffle and put that card on top"
  }
  runThen(g, choice, { picked: cards });
}

/** Can the player say yes to `choice`: can they pay what it costs (118.3, 119.4)? */
export function canSayYes(g: Game, choice: AskChoice): boolean {
  if (!choice.cost && !choice.life) return true;
  const cost = parseCost(choice.cost ?? '');
  cost.life += choice.life ?? 0;
  return !!planPayment(g, choice.player, cost);
}

// ---------- legality helpers (also used by the UI and bots) ----------

const isMain = (step: Step) => step === 'main1' || step === 'main2';

/**
 * Can the player cast a spell or activate an ability now? They need priority (117.1).
 * Anything that isn't instant speed also needs their own main phase and an empty stack (117.1a).
 */
function timingOk(g: Game, pid: PlayerId, instantSpeed: boolean): boolean {
  if (g.priority !== pid || g.decision || g.step === 'gameOver') return false;
  if (instantSpeed) return true;
  return pid === g.active && isMain(g.step) && g.stack.length === 0;
}

/** Playing a land is a special action with sorcery timing, once a turn (305.1, 305.2). */
export function canPlayLand(g: Game, pid: PlayerId, c: Card, face?: number): boolean {
  const faces = landFaces(c);
  if (face !== undefined ? !faces.includes(face) : !faces.length) return false;
  // From a hand, or from exile with an effect that lets them play it (Jeska's Will). Either
  // way it counts as their land for the turn (305.2a).
  const from = c.zone === 'hand' ? c.owner === pid : c.zone === 'exile' && !!permission(g, pid, c)?.play;
  return from && g.players[pid].landsPlayed < 1 && timingOk(g, pid, false);
}

/**
 * Can `pid` cast `c` from the zone it's in? Their own from a hand or the command zone; from
 * their graveyard with flashback (702.34a) or escape (702.138a); from exile after its
 * Adventure resolved (715.3d); any card an effect lets them cast (Ragavan, Mnemonic
 * Betrayal), or the one they may cast while a spell resolves (608.2g).
 */
function castableFrom(g: Game, pid: PlayerId, c: Card): boolean {
  if (castingNow(g, pid, c)) return true;
  if (c.zone === 'hand' || c.zone === 'command') return c.owner === pid;
  if (c.zone === 'graveyard') return c.owner === pid && (!!scriptFor(c).flashback || hasEscape(g, c));
  return c.zone === 'exile' && ((c.owner === pid && c.adventure) || !!permission(g, pid, c));
}

/** Is `c` the card `pid` may cast while a spell resolves (608.2g)? */
const castingNow = (g: Game, pid: PlayerId, c: Card) => g.decision?.type === 'cast' && g.decision.choice.card === c.id && g.decision.choice.player === pid;

/** Every card `pid` might cast from where it is: their hand, command zone and graveyard, and every exile. */
export function castableCards(g: Game, pid: PlayerId): Card[] {
  const p = g.players[pid];
  return [...p.hand, ...p.command, ...p.graveyard, ...g.players.flatMap((o) => o.exile)].filter((c) => castableFrom(g, pid, c));
}

/** Other cards in the graveyard that could pay `c`'s escape cost (702.138a). */
export const escapeOptions = (g: Game, c: Card): Card[] => g.players[c.owner].graveyard.filter((x) => x.id !== c.id);

/**
 * The faces `c` could be cast as from where it is: either half of a split card (709.3),
 * an adventurer card normally or as its Adventure, but not as an Adventure again from
 * exile (715.3, 715.3d), a modal double-faced card's non-land faces (712.11b), and
 * otherwise its front face. Flashback casts only an instant or sorcery (702.34a).
 */
export function castFaces(c: Card): number[] {
  const layout = layoutOf(c);
  let faces = facesOf(c);
  if (layout === 'transform') faces = [0];
  if (layout === 'adventure' && c.zone === 'exile') faces = [0];
  return faces.filter((f) => !isLand(asSpell(c, f)));
}

/**
 * How `c` can be cast as `face` from its owner's graveyard: with flashback, only as an
 * instant or sorcery (702.34a); with escape, as anything but a land, if three other cards
 * can be exiled (702.138a).
 */
export function graveyardWays(g: Game, c: Card, face: number): { flashback: boolean; escape: boolean } {
  return {
    flashback: !!scriptFor(c).flashback && !isPermanentCard(asSpell(c, face)),
    escape: hasEscape(g, c) && escapeOptions(g, c).length >= 3,
  };
}

/**
 * Targets chosen as a spell is cast (601.2c). A permanent's `targets` are for its enters
 * ability instead. A spell whose gift was promised may have other targets (702.174m).
 */
export const castTargets = (c: Card, modes?: number[], face = 0, gift?: PlayerId): TargetSpec[] => spellTargets(asSpell(c, face), modes, gift);

/** Can mode `i` of modal spell `c` be chosen now? Not if a target it needs has no legal choice (700.2a). */
function modeOk(g: Game, pid: PlayerId, c: Card, i: number): boolean {
  const mode = scriptFor(c).modal?.modes[i];
  return !!mode && (mode.targets ?? []).every((spec) => spec.optional || legalTargets(g, pid, spec, c).length > 0);
}

/** The most modes `pid` may choose for modal spell `c` now: Jeska's Will allows both only "if you control a commander". */
export const maxModes = (g: Game, pid: PlayerId, c: Card): number => {
  const max = scriptFor(c).modal?.max ?? 0;
  return typeof max === 'function' ? max(g, { ...c, controller: pid }) : max;
};

/**
 * Every set of modes `pid` could choose for modal spell `c` (cast as `face`) now (700.2):
 * `min` to `max` of them, as sorted indexes, repeating one only if the spell allows it (700.2d).
 */
export function modeChoices(g: Game, pid: PlayerId, c: Card, face = 0): number[][] {
  const spell = asSpell(c, face);
  const modal = scriptFor(spell).modal;
  if (!modal) return [];
  const legal = modal.modes.map((_, i) => i).filter((i) => modeOk(g, pid, spell, i));
  const out: number[][] = [];
  const max = maxModes(g, pid, spell);
  const grow = (picked: number[], from: number) => {
    if (picked.length >= modal.min) out.push(picked);
    if (picked.length >= max) return;
    for (let k = from; k < legal.length; k++) grow([...picked, legal[k]], modal.repeat ? k : k + 1);
  };
  grow([], 0);
  return out;
}

/** Cards in `pid`'s hand that alternative cost `alt` of `c` could exile, like Force of Will's blue card. */
export function exileOptions(g: Game, pid: PlayerId, c: Card, face: number, alt: number): Card[] {
  const spec = scriptFor(asSpell(c, face)).alternativeCosts?.[alt]?.exile;
  return spec ? g.players[pid].hand.filter((x) => x.id !== c.id && spec.filter(g, x, c)) : [];
}

/**
 * Permanents `pid` could sacrifice to pay `c`'s additional cost (118.8), or [] if it has
 * none. With `alt`, the ones that alternative cost could sacrifice instead (Flare of Duplication).
 */
export function sacrificeOptions(g: Game, pid: PlayerId, c: Card, face = 0, alt?: number): Card[] {
  const script = scriptFor(asSpell(c, face));
  const spec = alt === undefined ? script.additionalCost?.sacrifice : script.alternativeCosts?.[alt]?.sacrifice;
  if (!spec) return [];
  const self = { ...c, controller: pid };
  return g.players[pid].battlefield.filter((p) => fitsSpec(g, p, spec, self));
}

/**
 * Are these choices legal for casting `c` (601.2b)? A face it can be cast as, X can't be
 * negative, kicker is paid at most once unless it is multikicker, the alternative cost
 * must be available, and a sacrifice cost names exactly one of the player's permanents
 * that fits it.
 */
function choicesOk(g: Game, pid: PlayerId, c: Card, ch: CastChoices): boolean {
  const face = ch.face ?? 0;
  if (!castFaces(c).includes(face)) return false;
  const spell = asSpell(c, face);
  const script = scriptFor(spell);
  const x = ch.x ?? 0;
  const kicked = ch.kicked ?? 0;
  if (!Number.isInteger(x) || x < 0 || !Number.isInteger(kicked) || kicked < 0) return false;
  if (kicked > (script.kicker ? (script.kicker.multi ? Infinity : 1) : 0)) return false;
  if (ch.alt !== undefined && !altCostsOf(g, c, face, pid).includes(ch.alt)) return false;
  if (ch.protector !== undefined && !(isBattle(spell) && canProtect(g, spell, ch.protector))) return false;
  // A gift is promised to an opponent (702.174a), and only by a spell with gift.
  if (ch.gift !== undefined && (!script.gift || ch.gift === pid || g.players[ch.gift]?.lost !== false)) return false;
  // From a graveyard: with escape, three other cards from it are exiled (702.138a); otherwise it needs flashback.
  const escape = ch.escape ?? [];
  if (c.zone === 'graveyard') {
    const ways = graveyardWays(g, c, face);
    if (ch.escape ? !ways.escape : !ways.flashback) return false;
    const options = new Set(escapeOptions(g, c).map((x) => x.id));
    if (ch.escape && (escape.length !== 3 || new Set(escape).size !== 3 || escape.some((id) => !options.has(id)))) return false;
  } else if (escape.length) return false;
  // Modes: a set the spell allows, in printed order (700.2).
  const modes = ch.modes ?? [];
  if (script.modal ? !modeChoices(g, pid, c, face).some((m) => m.join() === modes.join()) : modes.length) return false;
  // An alternative cost that exiles a card from the caster's hand names exactly one that fits it (118.9).
  const exile = ch.exile ?? [];
  const alt = ch.alt === undefined ? undefined : script.alternativeCosts?.[ch.alt];
  if (alt?.exile ? exile.length !== 1 || !exileOptions(g, pid, c, face, ch.alt!).some((x) => x.id === exile[0]) : exile.length) return false;
  // Sacrifices: one for an alternative cost that asks for it, then one for the additional
  // cost, which bargain makes optional (702.166a). Each names a different permanent that fits.
  const sacrifice = ch.sacrifice ?? [];
  const needs = [...(alt?.sacrifice ? [{ alt: ch.alt, optional: false }] : []), ...(script.additionalCost ? [{ alt: undefined, optional: !!script.additionalCost.optional }] : [])];
  if (sacrifice.length > needs.length || new Set(sacrifice).size !== sacrifice.length) return false;
  return needs.every((need, i) => {
    const id = sacrifice[i];
    if (id === undefined) return need.optional;
    return sacrificeOptions(g, pid, c, face, need.alt).some((p) => p.id === id);
  });
}

/**
 * Can `pid` cast `c` now? With `choices`, can they cast it that way. Without, is there
 * any way: any face it can be cast as, X = 0, not kicked, and the mana cost or one of its
 * alternative costs. Only the face being cast is checked (709.3a, 712.11c, 715.3a).
 */
export function canCast(g: Game, pid: PlayerId, c: Card, choices?: CastChoices): boolean {
  if (!castableFrom(g, pid, c)) return false;
  if (choices) return canCastAs(g, pid, c, choices.face ?? 0, choices);
  return castFaces(c).some((face) => canCastAs(g, pid, c, face));
}

/** Can `pid` cast `c` as `face` now: with these choices, or without them, any way at all? */
export function canCastAs(g: Game, pid: PlayerId, c: Card, face: number, choices?: CastChoices): boolean {
  if (!castableFrom(g, pid, c) || !castFaces(c).includes(face)) return false;
  const spell = asSpell(c, face, pid);
  // While a spell resolves, only the card it lets the player cast, ignoring timing (608.2g).
  // "If that spell's mana value is N or less" counts X as 0 (107.3b).
  const now = castingNow(g, pid, c);
  if (now ? manaValue(spell) > ((g.decision as { choice: { maxMv?: number } }).choice.maxMv ?? Infinity) : !timingOk(g, pid, isInstantSpeed(spell) || flashGranted(g, pid, spell))) return false;
  if (forbidden(g, pid, 'cast', spell)) return false;
  for (const spec of castTargets(c, choices?.modes, face, choices?.gift)) {
    if (!spec.optional && legalTargets(g, pid, spec, spell).length === 0) return false;
  }
  // A permanent being sacrificed for the cost can't also make mana for it.
  if (choices) return choicesOk(g, pid, c, choices) && !!planPayment(g, pid, castCost(g, c, choices, pid), spell, choices.sacrifice);
  const script = scriptFor(spell);
  if (script.additionalCost && !script.additionalCost.optional && !sacrificeOptions(g, pid, c, face).length) return false;
  if (script.modal && !modeChoices(g, pid, c, face).length) return false;
  if (c.zone === 'graveyard') {
    const ways = graveyardWays(g, c, face);
    const routes: CastChoices[] = [...(ways.flashback ? [{ face }] : []), ...(ways.escape ? [{ face, escape: ['', '', ''] }] : [])];
    return routes.some((r) => planPayment(g, pid, castCost(g, c, r, pid), spell));
  }
  return [undefined, ...altCostsOf(g, c, face, pid)].some((alt) => planPayment(g, pid, castCost(g, c, { alt, face }, pid), spell));
}

/** The highest X `pid` can pay for `c` with these other choices (107.3a), or -1 if it can't be cast at all. */
export function maxX(g: Game, pid: PlayerId, c: Card, choices: CastChoices = {}): number {
  // An alternative cost without X, like flashback or "without paying its mana cost", makes X 0 (107.3b).
  if (!parseCost(data(asSpell(c, choices.face ?? 0)).manaCost).x || choices.alt !== undefined || (c.zone === 'graveyard' && !choices.escape) || freeCast(g, c)) return 0;
  let x = -1;
  const spell = asSpell(c, choices.face ?? 0, pid);
  while (x < 99 && planPayment(g, pid, castCost(g, c, { ...choices, x: x + 1 }, pid), spell)) x++;
  return x;
}

/**
 * Can `pid` activate one of `c`'s abilities now? `ability` names a loyalty ability by its
 * index; left out, it means the card's `activated` ability.
 */
export function canActivate(g: Game, pid: PlayerId, c: Card, ability?: number): boolean {
  if (ability !== undefined) return scriptFor(c).levels ? canLevelUp(g, pid, c, ability) : canActivateLoyalty(g, pid, c, ability);
  const ab = scriptFor(c).activated;
  if (!ab) return false;
  // Its controller activates it from the battlefield; its owner from their hand, like channel.
  if (ab.fromHand ? c.zone !== 'hand' || c.owner !== pid : c.zone !== 'battlefield' || c.controller !== pid) return false;
  if (!timingOk(g, pid, !ab.sorcery) || forbidden(g, pid, 'activate', c) || (ab.when && !ab.when(g, c))) return false;
  // A summoning-sick creature can't pay a tap cost (302.6).
  if (ab.cost.tap && (c.tapped || (isCreature(c) && c.sick && !has(g, c, 'haste')))) return false;
  if (ab.cost.crew && crewPower(g, pid, c, crewOptions(g, pid, c)) < ab.cost.crew) return false;
  if (ab.cost.counters && counterCount(c, ab.cost.counters.kind) < ab.cost.counters.n) return false;
  if (ab.cost.discard && discardOptions(g, pid, c).length < ab.cost.discard) return false;
  if (ab.cost.sacrificeOne && !activationSacrificeOptions(g, pid, c).length) return false;
  // The source can't also make the mana if tapping or sacrificing it is part of the cost.
  if ((ab.cost.mana || ab.cost.life) && !planPayment(g, pid, abilityCost(ab, g, c), undefined, ab.cost.tap || ab.cost.sacrifice ? [c.id] : [])) return false;
  for (const spec of ab.targets ?? []) {
    if (!spec.optional && legalTargets(g, pid, spec, c).length === 0) return false;
  }
  return true;
}

/** Permanents `pid` could sacrifice to pay a "Sacrifice a creature" cost of `c`'s ability, itself included. */
export function activationSacrificeOptions(g: Game, pid: PlayerId, c: Card): Card[] {
  const spec = scriptFor(c).activated?.cost.sacrificeOne;
  return spec ? g.players[pid].battlefield.filter((p) => fitsSpec(g, p, spec, c)) : [];
}

/** Cards `pid` could discard to pay a "Discard a card" cost of `c`'s ability: any other card in their hand. */
export const discardOptions = (g: Game, pid: PlayerId, c: Card): Card[] => g.players[pid].hand.filter((x) => x.id !== c.id);

/**
 * A loyalty ability can be activated at sorcery speed, and only if none of that
 * permanent's loyalty abilities has been activated this turn (606.3). A minus ability
 * needs that much loyalty (606.6).
 */
function canActivateLoyalty(g: Game, pid: PlayerId, c: Card, i: number): boolean {
  const ab = scriptFor(c).loyalty?.[i];
  if (!ab || c.controller !== pid || c.zone !== 'battlefield' || !timingOk(g, pid, false) || forbidden(g, pid, 'activate', c)) return false;
  if (c.loyaltyTurn === g.turn || loyaltyOf(c) + ab.cost < 0) return false;
  return (ab.targets ?? []).every((spec) => spec.optional || legalTargets(g, pid, spec, c).length > 0);
}

/**
 * A Class's level bar `i` makes it level i + 2. It can be activated only as a sorcery, and
 * only while the Class is the level just below (716.2a).
 */
function canLevelUp(g: Game, pid: PlayerId, c: Card, i: number): boolean {
  const bar = scriptFor(c).levels?.[i];
  if (!bar || c.controller !== pid || c.zone !== 'battlefield' || !timingOk(g, pid, false) || forbidden(g, pid, 'activate', c)) return false;
  return c.level === i + 1 && !!planPayment(g, pid, parseCost(bar.cost));
}

/**
 * The abilities of `c` that `pid` could activate now: `undefined` for its `activated`
 * ability, and its loyalty abilities (606) or Class level bars (716.2) by index.
 */
export function activatable(g: Game, pid: PlayerId, c: Card): (number | undefined)[] {
  const script = scriptFor(c);
  const numbered = (script.loyalty ?? script.levels ?? []).map((_, i) => i);
  return [undefined, ...numbered].filter((i) => canActivate(g, pid, c, i));
}

/**
 * Creatures that could crew Vehicle `v`: other untapped creatures `pid` controls. Summoning
 * sickness doesn't stop a creature from crewing: crew taps it as a cost of the Vehicle's
 * ability, not its own {T} ability (702.122a).
 */
export const crewOptions = (g: Game, pid: PlayerId, v: Card) => creaturesOf(g, pid).filter((c) => c.id !== v.id && !c.tapped);

/** Total power of some crew. */
export const crewPower = (g: Game, _pid: PlayerId, _v: Card, cards: Card[]) => cards.reduce((n, c) => n + Math.max(0, stats(g, c).power), 0);

/** Every slot has a legal target, or is an optional one left empty, and none repeats one it must differ from (115.3). */
function targetsOk(g: Game, pid: PlayerId, c: Card, specs: TargetSpec[], targets: (TargetRef | null)[]) {
  return specs.every((spec, i) => {
    const t = targets[i];
    if (!t) return !!spec.optional;
    const other = spec.distinctFrom === undefined ? null : targets[spec.distinctFrom];
    if (other && sameRef(other, t)) return false;
    return legalTargets(g, pid, spec, c).some((x) => sameRef(x, t));
  });
}

export const attackCandidates = (g: Game, pid: PlayerId) => creaturesOf(g, pid).filter((c) => canAttack(g, c));

/** Something a creature can attack: a player, or a planeswalker or battle (`target`) and its defending player. */
export interface AttackOption {
  defender: PlayerId;
  target: string | null;
}

/**
 * What `pid`'s creatures can attack (506.3, 508.1b): each opponent, each planeswalker an
 * opponent controls, and each battle whose protector is an opponent. A battle's protector
 * can't attack it, but its controller can when that is someone else, as with a Siege (310.9b).
 */
export function attackOptions(g: Game, pid: PlayerId): AttackOption[] {
  const out: AttackOption[] = [];
  for (const o of living(g)) {
    if (o.id !== pid) out.push({ defender: o.id, target: null });
    for (const c of o.battlefield) {
      if (isPlaneswalker(c) && o.id !== pid) out.push({ defender: o.id, target: c.id });
      else if (isBattle(c) && c.protector !== null && c.protector !== pid && !g.players[c.protector].lost) {
        out.push({ defender: c.protector, target: c.id });
      }
    }
  }
  return out;
}

/** The defender's creatures that could block at least one creature attacking them. */
export function blockCandidates(g: Game, pid: PlayerId): Card[] {
  const attackers = (g.combat?.attacks ?? []).filter((a) => a.defender === pid).map((a) => permanent(g, a.id)!);
  return creaturesOf(g, pid).filter((b) => attackers.some((a) => a && canBlock(g, b, a)));
}

/** Blocks the rules don't allow as declared: a lone blocker on a creature with menace (702.111b). */
export function illegalBlocks(g: Game, pid: PlayerId): string[] {
  const out: string[] = [];
  for (const a of g.combat?.attacks ?? []) {
    const c = permanent(g, a.id);
    if (a.defender === pid && c && a.blockers.length === 1 && has(g, c, 'menace')) out.push(a.id);
  }
  return out;
}

/** Could the player with priority do anything other than pass? Mana abilities don't count. */
export function canAct(g: Game, pid: PlayerId): boolean {
  const p = g.players[pid];
  return (
    castableCards(g, pid).some((c) => canCast(g, pid, c)) ||
    [...p.hand, ...g.players.flatMap((o) => o.exile)].some((c) => canPlayLand(g, pid, c)) ||
    [...p.battlefield, ...p.hand].some((c) => activatable(g, pid, c).length > 0)
  );
}

// ---------- auto-pass ----------

/**
 * A stop: with the stack empty, the game stops for the player in that step instead of
 * passing for them. `ifAble` stops only if they could do something besides pass;
 * `always` stops even when passing is all they can do.
 */
export type StopKind = 'ifAble' | 'always';

/** One player's stops on one player's turn. */
export type TurnStops = Partial<Record<Step, StopKind>>;

/** One player's stops, indexed by whose turn it is: `stops[g.active]`. */
export type Stops = TurnStops[];

/** Stops on your own turn: both main phases, and after blockers are declared. */
export const OWN_TURN_STOPS: TurnStops = { main1: 'always', main2: 'ifAble', blockers: 'ifAble' };
/** Stops on another player's turn: after attackers and blockers are declared, and the end step. */
export const OTHER_TURN_STOPS: TurnStops = { attackers: 'ifAble', blockers: 'ifAble', end: 'ifAble' };

/** The stops every player has unless told otherwise. */
export const defaultStops = (pid: PlayerId, players = 4): Stops =>
  Array.from({ length: players }, (_, turn) => ({ ...(turn === pid ? OWN_TURN_STOPS : OTHER_TURN_STOPS) }));

/**
 * Should the game stop and ask this player, or pass priority for them?
 *
 * This is not a rule. Every player gets priority in every step (117.3), which in a
 * four-player game is dozens of passes a turn, so like Arena the engine passes for a
 * player unless they are likely to want to act:
 *  - with something on the stack: when the top object is someone else's and they could act
 *  - with the stack empty: at their stops (see `StopKind`), `defaultStops` unless given.
 *    A stop in declare attackers only counts once something attacks.
 *  - after casting or activating with `hold`: until they act again
 * `applyAction(g, a, { autoPass: false })` turns it off.
 */
export function wantsPriority(g: Game, pid: PlayerId, stops?: Stops): boolean {
  const top = g.stack[g.stack.length - 1];
  // A player holding priority keeps it, to respond to their own spell (117.3c).
  if (top && g.holding === pid) return true;
  if (top) return top.controller !== pid && canAct(g, pid);
  if (g.step === 'attackers' && !g.combat?.attacks.length) return false;
  const stop = (stops?.[g.active] ?? (g.active === pid ? OWN_TURN_STOPS : OTHER_TURN_STOPS))[g.step];
  return stop === 'always' || (stop === 'ifAble' && canAct(g, pid));
}

// ---------- turn structure ----------

const STEP_ORDER: Step[] = [
  'untap',
  'upkeep',
  'draw',
  'main1',
  'beginCombat',
  'attackers',
  'blockers',
  'damage',
  'endCombat',
  'main2',
  'end',
  'cleanup',
];

/** The active player gets priority first. If they have left the game, the next player does (800.4j). */
const firstPriority = (g: Game) => (g.players[g.active].lost ? nextLiving(g, g.active) : g.active);

/** Starts a turn. `extra`: an extra turn (500.7), which may end with its player losing the game. */
function beginTurn(g: Game, pid: PlayerId, extra?: ExtraTurn) {
  g.active = pid;
  g.turn++;
  g.combat = null;
  g.players[pid].landsPlayed = 0;
  // What happened "this turn" starts over.
  g.spellsCast = 0;
  g.combatDamaged = [];
  for (const p of g.players) {
    p.spellsCast = 0;
    p.noncreatureSpellsCast = 0;
    p.drawn = 0;
  }
  // Delayed abilities waiting for a turn that has passed never trigger.
  g.delayed = g.delayed.filter((d) => d.turn === undefined || d.turn >= g.turn);
  log(g, `Turn ${g.turn} — ${g.players[pid].name}${extra ? ' (extra turn)' : ''}`, pid);
  // "At the beginning of that turn's end step, you lose the game" (Final Fortune).
  if (extra?.loseAtEnd) g.delayed.push({ id: `d${g.nextId++}`, controller: pid, card: extra.loseAtEnd, key: LOSE_GAME, step: 'end', turn: g.turn });
  beginStep(g, 'untap');
}

/** The `Delayed.key` the engine itself resolves: its controller loses the game (104.3e). */
const LOSE_GAME = 'lose the game';


/** Delayed triggered abilities whose moment has come trigger, once each (603.7b). */
function fireDelayed(g: Game, step: 'upkeep' | 'end') {
  const due = g.delayed.filter((d) => d.step === step && (d.turn === undefined || d.turn === g.turn) && (d.player === undefined || d.player === g.active));
  g.delayed = g.delayed.filter((d) => !due.includes(d));
  for (const d of due) {
    if (g.players[d.controller].lost) continue;
    // An intervening "if" is checked as it would trigger, and again as it resolves (603.4).
    const check = scriptFor(d.card).delayedIf?.[d.key];
    if (check && !check(g, d.data ?? {})) continue;
    g.triggers.push({ id: `s${g.nextId++}`, kind: 'triggered', controller: d.controller, card: d.card, hook: 'onDelayed', event: { key: d.key, data: d.data ?? {} }, targets: [] });
  }
}

/**
 * Starts a step or phase and does its turn-based actions (703). Whoever calls this lets
 * `settle` run afterwards: it puts "at the beginning of" triggers on the stack and gives
 * out priority (117.3a).
 */
function beginStep(g: Game, step: Step) {
  const pid = g.active;
  const p = g.players[pid];
  g.step = step;
  g.passes = 0;
  g.priority = firstPriority(g);
  switch (step) {
    case 'untap':
      // 502.3. Summoning sickness ends too: these have been under control since the turn began (302.6).
      for (const c of p.battlefield) {
        if (!scriptFor(c).noUntap) c.tapped = false;
        c.sick = false;
      }
      // No player gets priority in the untap step (502.4).
      beginStep(g, 'upkeep');
      break;
    case 'upkeep':
      broadcast(g, 'onUpkeep', { player: pid }); // 503.1a
      fireDelayed(g, 'upkeep');
      break;
    case 'draw':
      draw(g, pid, 1); // 504.1
      broadcast(g, 'onDrawStep', { player: pid }); // 504.2
      break;
    case 'main1':
      // The active player puts a lore counter on each of their Sagas (714.3c).
      for (const c of p.battlefield) if (isSaga(c) && scriptFor(c).chapters?.length) addCounters(g, c, 1, 'lore');
      break;
    case 'beginCombat':
      g.combat = { attacks: [], toBlock: [], struckFirst: null, moreDamage: false };
      break;
    case 'attackers':
      if (attackCandidates(g, pid).length) g.decision = { type: 'attackers' }; // 508.1
      break;
    case 'blockers': {
      // Each defending player who is able to block declares blockers, in APNAP order (802.4).
      const combat = g.combat!;
      combat.toBlock = turnOrder(g, pid).filter((d) => d !== pid && blockCandidates(g, d).length > 0);
      if (combat.toBlock.length) {
        g.decision = { type: 'blockers' };
        g.priority = combat.toBlock[0];
      } else {
        blockersDeclared(g);
      }
      break;
    }
    case 'damage':
      combatDamage(g);
      break;
    case 'main2':
      broadcast(g, 'onPostcombatMain', { player: pid }); // 505.1a
      break;
    case 'end':
      broadcast(g, 'onEndStep', { player: pid }); // 513.1
      fireDelayed(g, 'end');
      break;
    case 'cleanup':
      if (p.hand.length > maxHandSize(g, pid)) g.decision = { type: 'discard' }; // 514.1
      else cleanup(g);
      break;
  }
}

/** Ends the current step or phase and begins the next. */
function nextStep(g: Game) {
  // Unspent mana empties (500.5), except mana an effect says isn't lost this turn (Birgi).
  for (const p of g.players) p.pool = p.pool.filter((m) => m.keep === g.turn);
  const combat = g.combat;
  switch (g.step) {
    case 'upkeep':
      // "Skip your draw step" (614.1b): the step doesn't happen at all (614.10).
      if (g.players[g.active].battlefield.some((c) => scriptFor(c).skipDrawStep)) {
        log(g, `${says(g.players[g.active], 'skips')} ${g.players[g.active].isBot ? 'their' : 'your'} draw step.`, g.active);
        return beginStep(g, 'main1');
      }
      return beginStep(g, 'draw');
    case 'attackers':
      // With no attackers, the declare blockers and combat damage steps are skipped (508.8).
      return beginStep(g, combat?.attacks.length ? 'blockers' : 'endCombat');
    case 'damage':
      // A first-strike damage step is followed by a second combat damage step (510.4).
      return beginStep(g, combat?.moreDamage ? 'damage' : 'endCombat');
    case 'endCombat':
      g.combat = null; // everything is removed from combat (511.3)
      return beginStep(g, 'main2');
    default:
      return beginStep(g, STEP_ORDER[STEP_ORDER.indexOf(g.step) + 1]);
  }
}

/**
 * The second half of the cleanup step, then the next turn: damage wears off and "until
 * end of turn" effects end, both at once (514.2). Players never get priority in this
 * step; an ability that triggers here waits for the next upkeep instead (514.3a).
 */
function cleanup(g: Game) {
  for (const p of g.players) {
    p.pool = []; // mana kept "until end of turn" is gone now (514.2)
    for (const c of p.battlefield) {
      c.damage = 0;
      c.deathtouched = false;
      c.mods = [];
    }
  }
  g.effects = [];
  // An extra turn comes next if there is one, the most recent first (500.7).
  while (g.extraTurns.length) {
    const extra = g.extraTurns.pop()!;
    if (!g.players[extra.player].lost) return beginTurn(g, extra.player, extra);
  }
  beginTurn(g, nextLiving(g, g.active));
}

// ---------- combat ----------

/** Locks in the chosen attackers: they tap, and "attacks" abilities trigger (508.1f, 508.1m). */
function attackersDeclared(g: Game) {
  const combat = g.combat!;
  g.decision = null;
  g.priority = firstPriority(g); // 508.2
  if (!combat.attacks.length) return;
  const names: string[] = [];
  const attackers: Card[] = [];
  for (const a of combat.attacks) {
    const c = permanent(g, a.id)!;
    if (!has(g, c, 'vigilance')) c.tapped = true;
    const target = a.target ? permanent(g, a.target) : undefined;
    names.push(`${label(c)} → ${target ? label(target) : g.players[a.defender].name}`);
    attackers.push(c, ...(target ? [target] : []));
  }
  log(g, `${says(g.players[g.active], 'attacks')}: ${names.join(', ')}.`, g.active, attackers);
  for (const a of combat.attacks) {
    const c = permanent(g, a.id)!;
    trigger(g, c, 'onAttack', { defender: a.defender, target: a.target });
    broadcast(g, 'onCreatureAttacks', { attacker: c, defender: a.defender, target: a.target });
  }
}

/**
 * A creature that "attacks each combat if able" and wasn't declared attacks anyway (508.1d):
 * it attacks the next opponent in turn order. Only a player can have been left out, so the
 * requirement is met however it attacks.
 */
function mustAttack(g: Game, pid: PlayerId) {
  const combat = g.combat!;
  const opponent = turnOrder(g, pid).find((o) => o !== pid);
  if (opponent === undefined) return;
  for (const c of attackCandidates(g, pid)) {
    if (!has(g, c, MUST_ATTACK) || combat.attacks.some((a) => a.id === c.id)) continue;
    combat.attacks.push({ id: c.id, defender: opponent, target: null, blockers: [], blocked: false });
  }
}

/** Locks in blocks: each attacker is now blocked or unblocked for the rest of combat (509.1h). */
function blockersDeclared(g: Game) {
  for (const a of g.combat!.attacks) {
    a.blocked = a.blockers.length > 0;
    const c = permanent(g, a.id);
    if (c && a.blocked) {
      const blockers = a.blockers.map((b) => permanent(g, b)!);
      log(g, `${label(c)} is blocked by ${blockers.map(label).join(', ')}.`, a.defender, [c, ...blockers]);
    }
  }
  g.decision = null;
  g.priority = firstPriority(g); // 509.2
}

/** The turn-based action of a combat damage step (510.1, 510.2). */
function combatDamage(g: Game) {
  const combat = g.combat!;
  const fighters = combat.attacks.flatMap((a) => [a.id, ...a.blockers]).map((id) => permanent(g, id));
  // Only first strikers and double strikers deal damage in the first of two damage steps (510.4).
  const firstStrike =
    combat.struckFirst === null && fighters.some((c) => c && (has(g, c, 'first strike') || has(g, c, 'double strike')));
  const struckFirst = new Set(combat.struckFirst ?? []);
  dealCombatDamage(g, firstStrike, struckFirst);
  combat.struckFirst = [...struckFirst];
  combat.moreDamage = firstStrike;
}

/**
 * All damage is worked out first, then dealt at the same time (510.2). The split between
 * several blockers is automatic: lethal damage to each in order, the rest to the last one,
 * or to the defending player with trample (702.19b).
 */
function dealCombatDamage(g: Game, firstStrike: boolean, struckFirst: Set<string>) {
  const hits: { src: Card; card?: Card; player?: PlayerId; n: number }[] = [];
  const deals = (c: Card) => {
    const kw = stats(g, c).keywords;
    if (firstStrike) return kw.has('first strike') || kw.has('double strike');
    return !struckFirst.has(c.id) || kw.has('double strike');
  };
  for (const a of g.combat!.attacks) {
    const atk = permanent(g, a.id);
    if (!atk) continue;
    // Damage that gets through goes to the player, planeswalker or battle attacked. If
    // that planeswalker or battle has gone, there is nothing to deal it to (506.4c, 510.1b).
    const attacked = a.target ? permanent(g, a.target) : undefined;
    const through = (n: number) => {
      if (!a.target) hits.push({ src: atk, player: a.defender, n });
      else if (attacked && (isPlaneswalker(attacked) || isBattle(attacked))) hits.push({ src: atk, card: attacked, n });
    };
    const s = stats(g, atk);
    const blockers = a.blockers.map((id) => permanent(g, id)).filter((b): b is Card => !!b);
    if (deals(atk) && s.power > 0) {
      if (firstStrike) struckFirst.add(atk.id);
      if (!a.blocked) {
        through(s.power);
      } else {
        let left = s.power;
        blockers.forEach((b, i) => {
          const lethal = s.keywords.has('deathtouch') ? 1 : Math.max(1, stats(g, b).toughness - b.damage);
          const last = i === blockers.length - 1 && !s.keywords.has('trample');
          const n = last ? left : Math.min(left, lethal);
          if (n > 0) hits.push({ src: atk, card: b, n });
          left -= n;
        });
        if (left > 0 && s.keywords.has('trample')) through(left);
      }
    }
    for (const b of blockers) {
      const bs = stats(g, b);
      if (!deals(b) || bs.power <= 0) continue;
      if (firstStrike) struckFirst.add(b.id);
      hits.push({ src: b, card: atk, n: bs.power });
    }
  }
  for (const h of hits) {
    if (h.card && !isCreature(h.card)) dealDamage(g, h.src, { kind: 'card', id: h.card.id }, h.n); // logged: a planeswalker or battle
    else if (h.card) damageCard(g, h.src, h.card, h.n);
    else damagePlayer(g, h.src, h.player!, h.n, true);
  }
}

// ---------- priority and the stack ----------

/**
 * The player with priority passes it on (117.3d). Once every player has passed in a row,
 * the top of the stack resolves, or the step ends if the stack is empty (117.4).
 */
function passPriority(g: Game) {
  g.holding = null;
  g.passes++;
  if (g.passes < living(g).length) {
    g.priority = nextLiving(g, g.priority);
  } else if (g.stack.length) {
    resolveTop(g);
  } else {
    nextStep(g);
  }
}

/**
 * Resolves the top spell or ability of the stack (608). It stays there until it has
 * finished, which waits if its effect asked a player to choose cards.
 */
function resolveTop(g: Game) {
  const item = g.stack[g.stack.length - 1];
  const { card, controller } = item;
  g.resolving = item.id;
  const script = scriptFor(card);
  // Targets are checked again. Illegal ones are left alone, and if every target has
  // become illegal the spell or ability does nothing at all (608.2b).
  const specs = targetSpecs(item);
  const targets = item.targets.map((t, i) =>
    t && legalTargets(g, controller, specs[i], card).some((x) => sameRef(x, t)) ? t : null,
  );
  const fizzled = item.targets.some(Boolean) && !targets.some(Boolean);
  if (fizzled) log(g, `${label(card)} has no legal target left and does nothing.`, controller, [card]);

  if (item.kind === 'spell') {
    // A gift happens before the spell's other effects, and only if it resolves (702.174j).
    if (!fizzled && !isPermanentCard(card) && card.cast?.gift !== undefined && script.gift) giveGift(g, card, controller);
    if (script.enchant) {
      // An Aura whose target has gone is put into its owner's graveyard (608.3b, 303.4g).
      const host = refCard(g, targets[0]);
      if (host) enterBattlefield(g, card, { attachTo: host.id });
      else moveCard(g, card, 'graveyard');
    } else if (isPermanentCard(card)) {
      // It enters under the control of the spell's controller (608.3a, 110.2a).
      enterBattlefield(g, card, { protector: card.cast?.protector, controller }); // 608.3
    } else if (!fizzled && script.modal) {
      // Each chosen mode in printed order, with its own share of the targets (700.2).
      let next = 0;
      for (const i of card.cast?.modes ?? []) {
        const mode = script.modal.modes[i];
        const n = mode.targets?.length ?? 0;
        mode.resolve(g, { self: card, you: controller, targets: targets.slice(next, next + n), sacrificed: item.sacrificed, sacrificedPower: item.sacrificedPower });
        next += n;
      }
    } else if (!fizzled) {
      script.onResolve?.(g, { self: card, you: controller, targets, sacrificed: item.sacrificed, sacrificedPower: item.sacrificedPower });
    }
  } else if (!fizzled) {
    // An ability uses its source as it is now, or as it last was if it has gone (113.7a).
    const ctx = { self: permanent(g, card.id) ?? card, you: controller, targets, sacrificed: item.sacrificed, sacrificedPower: item.sacrificedPower };
    if (item.kind === 'activated' && item.ability !== undefined && script.levels) {
      // The Class gains the level, and "when this Class becomes level N" triggers (716.2a).
      const cls = permanent(g, card.id);
      if (cls) {
        cls.level = item.ability + 2;
        log(g, `${label(cls)} is now level ${cls.level}.`, controller, [cls]);
        trigger(g, cls, 'onLevel', { level: cls.level });
      }
    } else if (item.kind === 'activated') {
      (item.ability === undefined ? script.activated! : script.loyalty![item.ability]).resolve(g, ctx);
    } else if (item.hook === 'onStorm') {
      // A copy for each other spell cast before it this turn (702.40a).
      const { count, item: spell } = item.event as TriggerEvents['onStorm'];
      for (let i = 0; i < count; i++) copyItem(g, spell, controller);
    } else if (item.hook === 'onWard') {
      // Ward (702.21a): counter the spell or ability unless its controller pays.
      const { item: id, cost } = item.event as TriggerEvents['onWard'];
      const target = g.stack.find((x) => x.id === id);
      if (target) {
        const what = [cost.mana, cost.life && `${cost.life} life`].filter(Boolean).join(' and ');
        ask(g, target.controller, {
          text: `Pay ${what}, or ${target.kind === 'spell' ? label(target.card) : `${label(target.card)}'s ability`} is countered (ward).`,
          cost: cost.mana,
          life: cost.life,
          yes: `Pay ${what}`,
          no: "Don't Pay",
          then: '@ward',
          data: { item: id },
        });
      }
    } else if (item.hook === 'onDelayed') {
      const { key, data: extra } = item.event as TriggerEvents['onDelayed'];
      if (key === LOSE_GAME) {
        log(g, `${says(g.players[controller], 'loses')} the game (${label(card)}).`, controller, [card]);
        loseGame(g, controller, label(card));
      } else if (key === RETURN_TO_HAND) {
        // Dash (702.109a): the permanent goes back to its owner's hand, if it is still the same object.
        const c = permanent(g, extra.id as string);
        if (c && c.moves === extra.moves) {
          log(g, `${label(c)} returns to its owner's hand.`, c.controller, [c]);
          moveCard(g, c, 'hand');
        }
      } else script.delayed?.[key]?.(g, { ...ctx, data: extra });
    } else if (item.hook === 'onChapter') {
      script.chapters?.[(item.event as { chapter: number }).chapter - 1]?.resolve(g, ctx);
    } else if (item.hook === 'onDefeat') {
      // A defeated Siege is exiled, then cast transformed without paying its mana cost
      // (310.12b). Casting it is optional, but always worth it, so it always happens.
      const battle = permanent(g, card.id);
      if (battle) {
        log(g, `${label(battle)} is exiled.`, battle.owner, [battle]);
        moveCard(g, battle, 'exile');
        castTransformed(g, controller, battle);
      }
      const t = script.onDefeat;
      if (t) (typeof t === 'function' ? t : t.resolve)(g, ctx);
    } else {
      const t = script[item.hook!] as Trigger<object>;
      (typeof t === 'function' ? t : t.resolve)(g, { ...item.event, ...ctx });
    }
  }
  if (!nextChoice(g)) finishResolving(g);
}

/** The chosen opponent gets the gift of spell `card` (702.174a-j). */
function giveGift(g: Game, card: Card, controller: PlayerId) {
  const to = card.cast!.gift!;
  const gift = scriptFor(card).gift!;
  if (g.players[to].lost) return;
  log(g, `${says(g.players[controller], 'gives')} ${g.players[to].name} a gift (${label(card)}).`, controller, [card]);
  createToken(g, to, gift.token, 1, { tapped: gift.tapped });
}

/**
 * Casts the back face of a double-faced card in exile without paying its mana cost, as a
 * defeated Siege does (310.12b, 712.11a). Its mana value is still its front face's
 * (712.8c). Targets, if it has any, are the first legal ones; with none it stays in exile.
 */
function castTransformed(g: Game, pid: PlayerId, c: Card) {
  const back = cardData(c.name).faces?.[1];
  if (!back || c.zone !== 'exile' || g.players[pid].lost) return;
  const spell = asSpell(c, 1);
  const specs = spellTargets(spell);
  const targets = specs.map((spec) => (spec.optional ? null : (legalTargets(g, pid, spec, spell)[0] ?? null)));
  if (specs.some((spec, i) => !spec.optional && !targets[i])) return;
  const exile = g.players[c.owner].exile;
  exile.splice(exile.findIndex((x) => x.id === c.id), 1);
  c.zone = 'stack';
  c.face = 1;
  c.controller = pid;
  c.cast = { x: 0, kicked: 0, modes: [], from: 'exile', free: true };
  const item: StackItem = { id: `s${g.nextId++}`, kind: 'spell', controller: pid, card: c, targets };
  g.stack.push(item);
  log(g, `${says(g.players[pid], 'casts')} ${label(c)} transformed, without paying its mana cost.`, pid, [c]);
  g.lastSpell = { seq: (g.lastSpell?.seq ?? 0) + 1, name: back.name, caster: pid };
  castDone(g, pid, item);
}

/**
 * A spell has just become cast (601.2i): it counts toward this turn's spells, "whenever
 * you cast" abilities trigger, and so does storm (702.40a).
 */
function castDone(g: Game, pid: PlayerId, item: StackItem) {
  const c = item.card;
  const p = g.players[pid];
  g.spellsCast++;
  p.spellsCast++;
  if (!isCreature(c)) p.noncreatureSpellsCast++;
  broadcast(g, 'onCast', { card: c, caster: pid });
  if (data(c).keywords.includes('Storm') && g.spellsCast > 1) {
    const remembered: StackItem = { ...item, card: snapshot(c), targets: [...item.targets] };
    g.triggers.push({ id: `s${g.nextId++}`, kind: 'triggered', controller: pid, card: snapshot(c), hook: 'onStorm', event: { count: g.spellsCast - 1, item: remembered }, targets: [] });
  }
}

/** The end of resolving: the item leaves the stack, and the active player gets priority (117.3b). */
function finishResolving(g: Game) {
  const item = g.stack.find((x) => x.id === g.resolving);
  g.resolving = null;
  // A permanent spell has already moved to the battlefield (608.3). An instant or sorcery
  // goes to the graveyard as the last part of resolving (608.2n), or into exile if it was
  // an Adventure, where its owner may cast it later (715.3d).
  if (item?.kind === 'spell' && layoutOf(item.card) === 'adventure' && item.card.face === 1 && !item.copy) {
    const c = item.card;
    moveCard(g, c, 'exile');
    c.adventure = true;
  } else if (item?.kind === 'spell') moveCard(g, item.card, 'graveyard');
  else if (item) g.stack = g.stack.filter((x) => x !== item);
  g.passes = 0;
  g.priority = firstPriority(g);
}

/**
 * Puts the next waiting triggered ability on the stack (603.3). The active player's go
 * on first, then each other player's in turn order, so they resolve in the reverse order.
 * Each player puts theirs on in the order they choose (603.3b). A human with two or more
 * is asked for it; bots keep the order they triggered in. Returns false if none are waiting.
 */
function putTriggerOnStack(g: Game): boolean {
  if (!g.triggers.length) return false;
  const order = turnOrder(g, firstPriority(g));
  let next = 0;
  g.triggers.forEach((t, i) => {
    if (order.indexOf(t.controller) < order.indexOf(g.triggers[next].controller)) next = i;
  });
  const pid = g.triggers[next].controller;
  const theirs = g.triggers.filter((t) => t.controller === pid);
  if (!g.players[pid].isBot && theirs.length > 1 && theirs.some((t) => !t.ordered)) {
    g.decision = { type: 'orderTriggers', resume: g.priority };
    g.priority = pid;
    return true;
  }
  const [item] = g.triggers.splice(next, 1);
  const specs = targetSpecs(item);
  const options = specs.map((spec) => legalTargets(g, item.controller, spec, item.card));
  if (specs.some((spec, i) => !spec.optional && options[i].length === 0)) {
    // A copy keeps the original's targets if there are no new ones (707.10c). An ability
    // that needs a target and has none is removed instead (603.3d).
    if (item.copy) {
      g.stack.push(item);
      checkWard(g, item);
    }
    return true;
  }
  if (options.some((o) => o.length)) {
    g.decision = { type: 'targets', item, resume: g.priority };
    g.priority = item.controller;
    return true;
  }
  item.targets = specs.map(() => null);
  g.stack.push(item);
  return true;
}

// ---------- actions ----------

/** Activates Class `c`'s level bar `i`: pay its cost, and it becomes level i + 2 when the ability resolves (716.2a). */
function activateLevel(g: Game, pid: PlayerId, c: Card, i: number, a: Extract<Action, { type: 'activate' }>): boolean {
  if (a.targets?.some(Boolean) || a.crew?.length) return false;
  pay(g, pid, parseCost(scriptFor(c).levels![i].cost));
  g.stack.push({ id: `s${g.nextId++}`, kind: 'activated', controller: pid, card: snapshot(c), targets: [], ability: i });
  log(g, `${says(g.players[pid], 'activates')} ${label(c)}: Level ${i + 2}.`, pid, [c]);
  g.passes = 0;
  g.holding = a.hold ? pid : null;
  return true;
}

/**
 * Activates loyalty ability `i` of planeswalker `c`. Its cost is putting on or removing
 * loyalty counters (606.4), and none of its other loyalty abilities can be activated
 * this turn (606.3).
 */
/**
 * Answers a `retarget` choice (115.7d): each target is left as it was, even if it is illegal
 * now, or changed to a legal one; together they must still be a legal set. Ward triggers for
 * the permanents it newly targets (702.21a).
 */
function retarget(g: Game, pid: PlayerId, choice: RetargetChoice, chosen: (TargetRef | null)[]): boolean {
  const item = g.stack.find((x) => x.id === choice.item);
  if (item) {
    const specs = targetSpecs(item);
    const targets = specs.map((_, i) => chosen[i] ?? null);
    const same = (a: TargetRef | null, b: TargetRef | null) => (!a && !b) || (!!a && !!b && sameRef(a, b));
    const ok = specs.every((spec, i) => {
      const t = targets[i];
      if (same(t, item.targets[i])) return true;
      if (!t) return false; // leaving a target out isn't choosing a new one
      const other = spec.distinctFrom === undefined ? null : targets[spec.distinctFrom];
      if (other && sameRef(other, t)) return false;
      // Legal for the spell or ability as its controller would choose it.
      return legalTargets(g, item.controller, spec, item.card).some((x) => sameRef(x, t));
    });
    if (!ok) return false;
    const changed = targets.filter((t, i) => !same(t, item.targets[i]));
    item.targets = targets;
    if (changed.length) {
      const names = targets.filter((t): t is TargetRef => !!t).map((t) => describeRef(g, t));
      log(g, `${says(g.players[pid], 'chooses')} new targets for ${describeRef(g, { kind: 'stack', id: item.id })}: ${names.join(' and ')}.`, pid, refCards(g, targets));
      checkWard(g, item, changed);
    }
  }
  g.decision = null;
  runThen(g, choice, {});
  afterChoice(g);
  return true;
}

function activateLoyalty(g: Game, pid: PlayerId, c: Card, i: number, a: Extract<Action, { type: 'activate' }>): boolean {
  const ab = scriptFor(c).loyalty![i];
  const specs = ab.targets ?? [];
  const targets = specs.map((_, k) => a.targets?.[k] ?? null);
  if (!targetsOk(g, pid, c, specs, targets) || a.crew?.length) return false;
  if (ab.cost > 0) c.counters.loyalty = loyaltyOf(c) + ab.cost;
  else removeCounters(c, -ab.cost, 'loyalty');
  c.loyaltyTurn = g.turn;
  const item: StackItem = { id: `s${g.nextId++}`, kind: 'activated', controller: pid, card: snapshot(c), targets, ability: i };
  const chosen = targets.filter((t): t is TargetRef => !!t).map((t) => describeRef(g, t));
  const cost = ab.cost > 0 ? `+${ab.cost}` : ab.cost === 0 ? '0' : `−${-ab.cost}`;
  log(g, `${says(g.players[pid], 'activates')} ${label(c)}'s ${cost}${chosen.length ? ` targeting ${chosen.join(' and ')}` : ''}.`, pid, [c, ...refCards(g, targets)]);
  g.stack.push(item);
  checkWard(g, item);
  g.passes = 0;
  g.holding = a.hold ? pid : null;
  return true;
}

function act(g: Game, a: Action): boolean {
  const pid = g.priority;
  const p = g.players[pid];
  const deciding = g.decision?.type;
  if (g.step === 'gameOver') return false;

  switch (a.type) {
    case 'playLand': {
      // From the hand, or from exile with an effect that lets them play it (Jeska's Will).
      const c = findCard(g, a.card);
      if (!c || !canPlayLand(g, pid, c, a.face)) return false;
      p.landsPlayed++;
      // A modal double-faced card is played as one of its land faces (712.12).
      const face = a.face ?? landFaces(c)[0];
      log(g, `${says(p, 'plays')} ${label(c)}.`, pid, [c]);
      enterBattlefield(g, c, { face, controller: pid });
      g.passes = 0; // the player keeps priority after a special action (117.3c)
      // A choice made as it enters, like Cavern of Souls's creature type (614.12a).
      nextChoice(g);
      return true;
    }

    // Casting is one action. The steps a player goes through to propose a spell (601.2:
    // choose targets, then pay) are collected by the UI first, so backing out of any of
    // them leaves the game as if the spell was never started (733.1).
    case 'cast': {
      const c = findCard(g, a.card);
      const choices: CastChoices = {
        x: a.x,
        kicked: a.kicked,
        alt: a.alt,
        sacrifice: a.sacrifice,
        exile: a.exile,
        modes: a.modes,
        protector: a.protector,
        face: a.face,
        escape: a.escape,
        gift: a.gift,
      };
      if (!c || !['hand', 'command', 'graveyard', 'exile'].includes(c.zone) || !canCast(g, pid, c, choices)) return false;
      const face = choices.face ?? 0;
      const specs = castTargets(c, choices.modes, face, choices.gift);
      const targets = specs.map((_, i) => a.targets?.[i] ?? null);
      if (!targetsOk(g, pid, { ...c, controller: pid }, specs, targets)) return false;
      const spell = asSpell(c, face, pid);
      const script = scriptFor(spell);
      const from = c.zone as Zone;
      // Cast while a spell resolves (608.2g): the choice that allowed it is answered.
      const during = g.decision?.type === 'cast' ? g.decision.choice : null;
      const free = freeCast(g, c);
      const escaped = from === 'graveyard' && !!choices.escape;
      const flashback = from === 'graveyard' && !escaped;
      const alt = choices.alt === undefined ? undefined : script.alternativeCosts![choices.alt];
      // X is chosen only if the cost being paid has {X}: an alternative cost without it makes X 0 (107.3b).
      const paying = free ? '' : flashback ? scriptFor(c).flashback! : alt ? alt.mana : data(spell).manaCost;
      const hasX = parseCost(paying).x > 0;
      const cost = castCost(g, c, choices, pid);
      // Costs are paid (601.2f-h): mana and life, then sacrifices and cards exiled.
      const paid = pay(g, pid, cost, spell, choices.sacrifice)!;
      const sacrificed = (choices.sacrifice ?? []).map((id) => permanent(g, id)!);
      const exiled = (choices.exile ?? []).map((id) => p.hand.find((x) => x.id === id)!);
      const escapedWith = (choices.escape ?? []).map((id) => g.players[c.owner].graveyard.find((x) => x.id === id)!);
      if (from === 'command') p.commanderCasts[commanderIndex(g, c)]++; // commander tax (903.8, 702.124d)
      const zone = g.players[c.owner][from as 'hand' | 'command' | 'graveyard' | 'exile'];
      zone.splice(zone.findIndex((x) => x.id === c.id), 1);
      c.zone = 'stack'; // 601.2a
      c.controller = pid; // its caster controls it (601.2a)
      c.moves++;
      c.faceDown = false; // a face-down card is turned face up to be cast (406.3a)
      c.known = [];
      c.face = face; // only the face being cast is on the stack (709.3b, 712.11c, 715.3b)
      c.adventure = false;
      const info: CastInfo = {
        x: hasX ? (choices.x ?? 0) : 0,
        kicked: choices.kicked ?? 0,
        modes: choices.modes ?? [],
        protector: choices.protector,
        flashback,
        from,
        alt: choices.alt,
        dash: !!alt?.dash,
        escaped,
        free,
        bargained: !!script.additionalCost?.optional && sacrificed.length > (alt?.sacrifice ? 1 : 0),
        gift: choices.gift,
        spent: paid.spent,
        uncounterable: paid.uncounterable,
      };
      c.cast = info;
      const item: StackItem = { id: `s${g.nextId++}`, kind: 'spell', controller: pid, card: c, targets };
      if (sacrificed.length) {
        item.sacrificed = sacrificed.map(snapshot);
        item.sacrificedPower = sacrificed.map((x) => stats(g, x).power);
      }
      g.stack.push(item);
      const chosen = targets.filter((t): t is TargetRef => !!t).map((t) => describeRef(g, t));
      const how = [
        hasX && `X = ${info.x}`,
        flashback && 'flashback',
        escaped && 'escape',
        from === 'exile' && 'from exile',
        free && 'without paying its mana cost',
        layoutOf(c) === 'adventure' && face === 1 && 'an Adventure',
        info.kicked && (info.kicked > 1 ? `kicked ${info.kicked} times` : 'kicked'),
        info.bargained && 'bargained',
        choices.gift !== undefined && `gift promised to ${g.players[choices.gift].name}`,
        alt?.label,
        info.modes.length > 0 &&
          [...new Set(info.modes)]
            .map((i) => {
              const times = info.modes.filter((m) => m === i).length;
              return `“${script.modal!.modes[i].text}”${times > 1 ? ` ×${times}` : ''}`;
            })
            .join(', '),
      ].filter(Boolean);
      const details = (how.length ? ` (${how.join(', ')})` : '') + (chosen.length ? ` targeting ${chosen.join(' and ')}` : '');
      log(g, `${says(p, 'casts')} ${label(c)}${details}.`, pid, [c, ...refCards(g, targets)]);
      g.lastSpell = { seq: (g.lastSpell?.seq ?? 0) + 1, name: data(c).name, caster: pid };
      if (sacrificed.length) dieMany(g, sacrificed, 'is sacrificed'); // an additional cost, paid with the rest (601.2h)
      for (const x of exiled) {
        log(g, `${says(p, 'exiles')} ${label(x)} to pay for it.`, pid, [x]);
        moveCard(g, x, 'exile');
      }
      if (escapedWith.length) {
        log(g, `${says(p, 'exiles')} ${escapedWith.map(label).join(', ')} from ${p.isBot ? 'their' : 'your'} graveyard to pay for it.`, pid, escapedWith);
        for (const x of escapedWith) moveCard(g, x, 'exile');
      }
      castDone(g, pid, item);
      checkWard(g, item); // 702.21a: it became the target of a spell
      g.passes = 0; // the caster keeps priority (117.3c)
      g.holding = a.hold ? pid : null;
      if (during) {
        g.decision = null;
        runThen(g, during, { yes: true, picked: [c] });
        afterChoice(g);
      }
      return true;
    }

    case 'activate': {
      const c = [...p.battlefield, ...p.hand].find((x) => x.id === a.card);
      if (!c || !canActivate(g, pid, c, a.ability)) return false;
      if (a.ability !== undefined && scriptFor(c).levels) return activateLevel(g, pid, c, a.ability, a);
      if (a.ability !== undefined) return activateLoyalty(g, pid, c, a.ability, a);
      const ab = scriptFor(c).activated!;
      const specs = ab.targets ?? [];
      const targets = specs.map((_, i) => a.targets?.[i] ?? null);
      if (!targetsOk(g, pid, c, specs, targets)) return false;
      // Crew: the chosen creatures must be able to crew and have enough power (702.122a).
      const crewing = (a.crew ?? []).map((id) => crewOptions(g, pid, c).find((x) => x.id === id));
      if (ab.cost.crew) {
        if (crewing.some((x) => !x) || new Set(a.crew).size !== crewing.length) return false;
        if (crewPower(g, pid, c, crewing as Card[]) < ab.cost.crew) return false;
      } else if (crewing.length) return false;
      // "Discard a card": exactly that many other cards from the hand.
      const discarding = (a.discard ?? []).map((id) => discardOptions(g, pid, c).find((x) => x.id === id));
      if (discarding.length !== (ab.cost.discard ?? 0) || discarding.some((x) => !x) || new Set(a.discard).size !== discarding.length) return false;
      // "Sacrifice a creature": exactly one that fits.
      const sacrificing = (a.sacrifice ?? []).map((id) => activationSacrificeOptions(g, pid, c).find((x) => x.id === id));
      if (sacrificing.length !== (ab.cost.sacrificeOne ? 1 : 0) || sacrificing.some((x) => !x)) return false;
      // The ability goes on the stack as its own object, apart from its source (602.2a).
      const item: StackItem = { id: `s${g.nextId++}`, kind: 'activated', controller: pid, card: snapshot(c), targets };
      if (sacrificing.length) {
        item.sacrificed = sacrificing.map((x) => snapshot(x!));
        item.sacrificedPower = sacrificing.map((x) => stats(g, x!).power);
      }
      // Nothing tapped or sacrificed for the rest of the cost makes mana for it.
      const busy = [...(ab.cost.tap || ab.cost.sacrifice ? [c.id] : []), ...(a.sacrifice ?? [])];
      if ((ab.cost.mana || ab.cost.life) && !pay(g, pid, abilityCost(ab, g, c), undefined, busy)) return false;
      if (ab.cost.tap) c.tapped = true;
      if (ab.cost.counters) removeCounters(c, ab.cost.counters.n, ab.cost.counters.kind);
      for (const x of crewing) x!.tapped = true;
      if (crewing.length) log(g, `${crewing.map((x) => label(x!)).join(' and ')} crew${crewing.length === 1 ? 's' : ''} ${label(c)}.`, pid, [...(crewing as Card[]), c]);
      const chosen = targets.filter((t): t is TargetRef => !!t).map((t) => describeRef(g, t));
      log(g, `${says(p, 'activates')} ${label(c)}${chosen.length ? ` targeting ${chosen.join(' and ')}` : ''}.`, pid, [c, ...refCards(g, targets)]);
      for (const x of discarding) discard(g, x!);
      if (ab.cost.discardSelf) discard(g, c);
      if (ab.cost.sacrifice) dieMany(g, [c], 'is sacrificed');
      const others = sacrificing.map((x) => permanent(g, x!.id)).filter((x): x is Card => !!x);
      if (others.length) dieMany(g, others, 'is sacrificed');
      g.stack.push(item);
      checkWard(g, item);
      g.passes = 0;
      g.holding = a.hold ? pid : null;
      return true;
    }

    // Mana abilities don't use the stack (605.3b). Tapping by hand isn't logged: it is the
    // one thing a player can undo.
    case 'tapMana': {
      // A mana ability from a hand, like Simian Spirit Guide's, is used from there.
      const c = [...p.battlefield, ...p.hand].find((x) => x.id === a.card);
      if (!c || (deciding && deciding !== 'cast') || !canTapForMana(g, pid, c, a.ability)) return false;
      tapForMana(g, pid, c, a.ability, a.color);
      return true;
    }

    case 'untapMana': {
      const c = p.battlefield.find((x) => x.id === a.card);
      if (!c || !canUntapMana(g, pid, c)) return false;
      untapMana(g, pid, c);
      return true;
    }

    case 'declareAttack': {
      const c = p.battlefield.find((x) => x.id === a.card);
      if (deciding !== 'attackers' || !g.combat || !c || !canAttack(g, c)) return false;
      const target = a.target ?? null;
      if (!attackOptions(g, pid).some((o) => o.defender === a.defender && o.target === target)) return false;
      const existing = g.combat.attacks.find((x) => x.id === c.id);
      if (existing) Object.assign(existing, { defender: a.defender, target });
      else g.combat.attacks.push({ id: c.id, defender: a.defender, target, blockers: [], blocked: false });
      return true;
    }

    case 'undeclareAttack': {
      if (deciding !== 'attackers' || !g.combat || !g.combat.attacks.some((x) => x.id === a.card)) return false;
      g.combat.attacks = g.combat.attacks.filter((x) => x.id !== a.card);
      return true;
    }

    case 'declareBlock': {
      if (deciding !== 'blockers' || !g.combat) return false;
      const blocker = p.battlefield.find((x) => x.id === a.blocker);
      const attack = g.combat.attacks.find((x) => x.id === a.attacker);
      const attacker = permanent(g, a.attacker);
      if (!blocker || !attack || !attacker || attack.defender !== pid || !canBlock(g, blocker, attacker)) return false;
      for (const x of g.combat.attacks) x.blockers = x.blockers.filter((b) => b !== blocker.id);
      attack.blockers.push(blocker.id);
      return true;
    }

    case 'undeclareBlock': {
      if (deciding !== 'blockers' || !g.combat) return false;
      const attack = g.combat.attacks.find((x) => x.defender === pid && x.blockers.includes(a.blocker));
      if (!attack) return false;
      attack.blockers = attack.blockers.filter((b) => b !== a.blocker);
      return true;
    }

    case 'discard': {
      const c = p.hand.find((x) => x.id === a.card);
      if (deciding !== 'discard' || !c) return false;
      discard(g, c);
      if (p.hand.length <= maxHandSize(g, pid)) {
        g.decision = null;
        cleanup(g);
      }
      return true;
    }

    case 'chooseTargets': {
      if (g.decision?.type === 'retarget') return retarget(g, pid, g.decision.choice, a.targets);
      if (g.decision?.type !== 'targets') return false;
      const { item, resume } = g.decision;
      const specs = targetSpecs(item);
      const targets = specs.map((_, i) => a.targets?.[i] ?? null);
      if (!targetsOk(g, pid, item.card, specs, targets)) return false;
      const chosen = targets.filter((t): t is TargetRef => !!t).map((t) => describeRef(g, t));
      if (chosen.length) log(g, `${label(item.card)} targets ${chosen.join(' and ')}.`, pid, [item.card, ...refCards(g, targets)]);
      item.targets = targets;
      g.stack.push(item);
      checkWard(g, item);
      g.decision = null;
      g.priority = resume;
      return true;
    }

    case 'keep':
    case 'mulligan': {
      const m = g.mulligan;
      if (deciding !== 'mulligan' || !m || (a.type === 'mulligan' && !canMulligan(g, pid))) return false;
      m.waiting.shift();
      if (a.type === 'mulligan') {
        m.taking.push(pid);
        log(g, `${says(p, 'mulligans')}.`, pid);
      } else {
        log(g, `${says(p, 'keeps')} ${p.hand.length} card${p.hand.length === 1 ? '' : 's'}.`, pid);
      }
      g.decision = null;
      continueMulligans(g);
      return true;
    }

    case 'chooseCards': {
      if (g.decision?.type !== 'chooseCards') return false;
      const { choice } = g.decision;
      const { cards, valid, min, max } = choiceOptions(g, choice);
      const picked = a.cards.map((id) => cards.find((c) => c.id === id));
      if (new Set(a.cards).size !== a.cards.length || picked.length < min || picked.length > max) return false;
      if (picked.some((c) => !c || !valid.has(c.id))) return false;
      g.decision = null;
      if (choice.kind === 'legend') {
        // The legend rule (704.5j): the rest go to their owners' graveyards. It is a
        // state-based action, so whoever was about to get priority still does.
        dieMany(g, cards.filter((c) => c.id !== picked[0]!.id), "is put into its owner's graveyard (legend rule)");
        g.priority = choice.resume;
        return true;
      }
      doChoice(g, choice, picked as Card[]);
      afterChoice(g);
      return true;
    }

    case 'answer': {
      if (g.decision?.type === 'cast' && !a.yes) {
        // Declines to cast it (608.2g).
        const { choice } = g.decision;
        g.decision = null;
        runThen(g, choice, { yes: false });
        afterChoice(g);
        return true;
      }
      if (g.decision?.type !== 'ask') return false;
      const { choice } = g.decision;
      if (a.yes && !canSayYes(g, choice)) return false;
      g.decision = null;
      if (choice.cost || choice.life) {
        // Paying a cost while an effect resolves (118.12).
        if (a.yes) {
          const cost = parseCost(choice.cost ?? '');
          cost.life += choice.life ?? 0;
          pay(g, pid, cost);
          if (choice.cost) log(g, `${says(p, 'pays')} ${choice.cost} for ${choice.source}.`, pid);
        } else log(g, `${says(p, 'declines')} to pay for ${choice.source}.`, pid);
      }
      runThen(g, choice, { yes: a.yes });
      afterChoice(g);
      return true;
    }

    case 'name': {
      if (g.decision?.type !== 'name') return false;
      const { choice } = g.decision;
      if (choice.of === 'creature type' ? !CREATURE_TYPES.includes(a.name) : !isCardName(a.name)) return false;
      g.decision = null;
      log(g, `${says(p, choice.of ? 'chooses' : 'names')} ${a.name}${choice.of ? ` (${choice.source})` : ''}.`, pid);
      runThen(g, choice, { name: a.name });
      afterChoice(g);
      return true;
    }

    case 'choosePlayer': {
      if (g.decision?.type !== 'player' || !g.decision.choice.options.includes(a.player)) return false;
      const { choice } = g.decision;
      g.decision = null;
      log(g, `${says(p, 'chooses')} ${g.players[a.player].name} (${choice.source}).`, pid);
      runThen(g, choice, { player: a.player });
      afterChoice(g);
      return true;
    }

    case 'orderTriggers': {
      if (g.decision?.type !== 'orderTriggers') return false;
      const theirs = g.triggers.filter((t) => t.controller === pid);
      const ordered = a.order.map((id) => theirs.find((t) => t.id === id));
      if (new Set(a.order).size !== a.order.length || ordered.length !== theirs.length || ordered.some((t) => !t)) return false;
      // Their triggers swap places among themselves, so they go on the stack in the chosen order.
      let i = 0;
      g.triggers = g.triggers.map((t) => (t.controller === pid ? ordered[i++]! : t));
      for (const t of theirs) t.ordered = true;
      g.priority = g.decision.resume;
      g.decision = null;
      return true;
    }

    case 'commanderZone': {
      if (g.decision?.type !== 'commanderZone') return false;
      const { card, resume } = g.decision;
      const c = [...p.graveyard, ...p.exile, ...p.hand, ...p.library].find((x) => x.id === card);
      g.priority = resume;
      g.decision = null;
      if (!c) return true;
      if (a.toCommand) {
        returnCommander(g, c);
      } else {
        c.mayReturn = false; // not asked again until it changes zones
        const where: Record<string, string> = { graveyard: 'the graveyard', exile: 'exile', hand: 'hand', library: 'the library' };
        log(g, `${says(p, 'leaves')} ${label(c)} in ${where[c.zone]}.`, pid, [c]);
      }
      return true;
    }

    case 'pass': {
      switch (deciding) {
        case undefined:
          passPriority(g);
          return true;
        case 'attackers':
          mustAttack(g, pid);
          attackersDeclared(g);
          return true;
        case 'blockers': {
          const combat = g.combat!;
          for (const id of illegalBlocks(g, pid)) {
            const attack = combat.attacks.find((x) => x.id === id)!;
            attack.blockers = [];
            const attacker = permanent(g, id)!;
            log(g, `${label(attacker)} has menace and can't be blocked by one creature.`, pid, [attacker]);
          }
          combat.toBlock = combat.toBlock.filter((x) => x !== pid);
          if (combat.toBlock.length) g.priority = combat.toBlock[0];
          else blockersDeclared(g);
          return true;
        }
        default:
          return false;
      }
    }
  }
}

/**
 * Runs the game forward until it needs a player. Each time a player would get priority,
 * state-based actions are checked and waiting triggered abilities go on the stack, until
 * neither does anything more (117.5). Then that player gets priority, or it is passed for
 * them (see `wantsPriority`).
 */
function settle(g: Game, autoPass: boolean, stops: ApplyOptions['stops'] = {}) {
  for (let guard = 0; guard < 5000; guard++) {
    // A spell or ability is waiting on a choice partway through resolving. Nothing else
    // happens until it has finished, not even state-based actions (608.2).
    if (g.resolving) return;
    checkState(g);
    if (g.winner !== null) {
      g.step = 'gameOver';
      g.combat = null;
      g.decision = null;
      return;
    }
    if (g.decision) return;
    if (putTriggerOnStack(g)) continue;
    if (g.players[g.priority].lost) g.priority = nextLiving(g, g.priority);
    if (!autoPass || wantsPriority(g, g.priority, stops[g.priority])) return;
    passPriority(g);
  }
}

export interface ApplyOptions {
  /** Pass priority for players who have nothing they'd want to do (default true). See `wantsPriority`. */
  autoPass?: boolean;
  /** Players' own stops, by player id. Anyone left out gets `defaultStops`. */
  stops?: Partial<Record<PlayerId, Stops>>;
}

export function applyAction(g: Game, a: Action, { autoPass = true, stops }: ApplyOptions = {}): Game {
  return produce(g, (draft) => {
    if (act(draft, a)) settle(draft, autoPass, stops);
  });
}
