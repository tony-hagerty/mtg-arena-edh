export type Color = 'W' | 'U' | 'B' | 'R' | 'G';
export type ManaSym = Color | 'C';
/** One mana floating in a pool. `source` is the permanent that made it, so tapping it can be undone. */
export interface Mana {
  sym: ManaSym;
  source: string;
}
export type PlayerId = number;
/** A player's own zones. The stack is shared, so it lives on `Game` instead (405). */
export type Zone = 'library' | 'hand' | 'battlefield' | 'graveyard' | 'exile' | 'command';

/** Static card info. Real cards come from Scryfall; tokens are defined in decklists.json. */
export interface CardData {
  name: string;
  manaCost: string; // "{2}{B}{B}", "" for lands and tokens
  cmc: number;
  colors: Color[];
  colorIdentity: Color[];
  typeLine: string;
  oracleText: string;
  power?: string;
  toughness?: string;
  keywords: string[];
  image: string; // full card image
  art: string; // art crop, used for battlefield tiles
}

/** Until-end-of-turn modifier. */
export interface Mod {
  power: number;
  toughness: number;
  keywords: string[];
}

/** One physical card (or token) in a game. `name` is the key into the card database. */
export interface Card {
  id: string;
  name: string;
  owner: PlayerId;
  zone: Zone | 'stack';
  isCommander: boolean;
  isToken: boolean;
  tapped: boolean;
  sick: boolean; // summoning sickness
  damage: number;
  deathtouched: boolean; // damaged by a deathtouch source this turn
  counters: number; // +1/+1 counters
  mods: Mod[];
}

export interface Player {
  id: PlayerId;
  name: string;
  isBot: boolean;
  deckId: string;
  commander: string; // card name
  life: number;
  library: Card[];
  hand: Card[];
  battlefield: Card[];
  graveyard: Card[];
  exile: Card[];
  command: Card[];
  commanderCasts: number; // times cast from the command zone (commander tax = 2 per cast)
  commanderDamage: number[]; // combat damage taken from each player's commander, by owner id
  landsPlayed: number;
  pool: Mana[]; // unspent mana, emptied as each step and phase ends (500.5)
  lost: boolean;
  drewFromEmpty: boolean;
}

/**
 * The steps and phases of a turn, in order (500.1). The two main phases have no steps.
 * `damage` happens twice in a combat with first strike or double strike (510.4).
 */
export type Step =
  | 'untap'
  | 'upkeep'
  | 'draw'
  | 'main1'
  | 'beginCombat'
  | 'attackers'
  | 'blockers'
  | 'damage'
  | 'endCombat'
  | 'main2'
  | 'end'
  | 'cleanup'
  | 'gameOver';

export interface Attack {
  id: string; // attacking creature
  defender: PlayerId;
  blockers: string[];
  blocked: boolean; // set once blocks are locked in; stays true even if the blockers leave
}

export interface Combat {
  attacks: Attack[];
  toBlock: PlayerId[]; // defenders who still have to declare blocks
  /** Creatures that dealt damage in the first-strike damage step, or null before any damage (510.4). */
  struckFirst: string[] | null;
  /** True after the first-strike damage step: a second combat damage step follows. */
  moreDamage: boolean;
}

export type TargetRef = { kind: 'card'; id: string } | { kind: 'player'; id: PlayerId };

export interface LogEntry {
  turn: number;
  text: string;
  player?: PlayerId;
  /** Names of the cards the text mentions, exactly as written in it, so the UI can link them. */
  cards?: string[];
}

/**
 * A spell or ability on the stack (405). A spell is the card itself (601.2a). An ability
 * is not a card: `card` is a copy of its source from when it was activated or triggered,
 * so it still works after the source has left the battlefield (113.7a).
 */
export interface StackItem {
  id: string;
  kind: 'spell' | 'activated' | 'triggered';
  controller: PlayerId;
  card: Card;
  /** Triggered abilities: the script hook that resolves it, and what it was told about the event. */
  hook?: TriggerHook;
  event?: object;
  targets: (TargetRef | null)[];
  /** A waiting triggered ability whose controller has already chosen its place in the order (603.3b). */
  ordered?: boolean;
}

/**
 * Cards a player picks from a list. `choiceOptions` in engine.ts says which cards are
 * shown, which can be picked, and how many.
 *  search - look through your library for a basic land (701.23) and put it onto the
 *           battlefield or into your hand. `source` names the spell or ability.
 *  bottom - put `count` cards from your hand on the bottom of your library after a mulligan (103.5)
 */
export type CardChoice =
  | { kind: 'search'; player: PlayerId; source: string; to: 'battlefield' | 'hand'; tapped: boolean; subtype?: string }
  | { kind: 'bottom'; player: PlayerId; count: number };

/** The mulligan process before the first turn (103.5). `active` is the starting player meanwhile. */
export interface Mulligans {
  /** Mulligans taken so far, by player id. */
  taken: number[];
  /** Players still to declare this round, in turn order from the starting player. */
  waiting: PlayerId[];
  /** Players who declared a mulligan this round. They all take it once everyone has declared. */
  taking: PlayerId[];
}

/**
 * A choice the game is waiting on that isn't a player using priority. `Game.priority`
 * names the player who makes it.
 *  mulligan      - before the game, a player declares whether they keep their hand (103.5)
 *  attackers     - the active player declares attackers (508.1)
 *  blockers      - a defending player declares blockers (509.1)
 *  discard       - the active player discards down to seven in the cleanup step (514.1)
 *  targets       - a player chooses targets for a triggered ability going on the stack (603.3d).
 *                  `resume` is the player who gets priority afterwards.
 *  orderTriggers - a player puts several of their triggered abilities on the stack in the
 *                  order they choose (603.3b). Their waiting ones are in `Game.triggers`.
 *  chooseCards   - a player picks cards from a list (see `CardChoice`)
 */
export type Decision =
  | { type: 'mulligan' | 'attackers' | 'blockers' | 'discard' }
  | { type: 'targets'; item: StackItem; resume: PlayerId }
  | { type: 'orderTriggers'; resume: PlayerId }
  | { type: 'chooseCards'; choice: CardChoice };

export interface Game {
  players: Player[];
  active: PlayerId;
  /** The player the game is waiting on: who has priority (117), or who is making `decision`. */
  priority: PlayerId;
  turn: number;
  step: Step;
  decision: Decision | null;
  /** Spells and abilities waiting to resolve. The last one is the top (405.2). */
  stack: StackItem[];
  /** Abilities that have triggered but aren't on the stack yet (603.3). */
  triggers: StackItem[];
  /** Mulligans in progress before the first turn (103.5), or null once the game has begun. */
  mulligan: Mulligans | null;
  /** Card choices waiting to be asked, in order. The first becomes a `chooseCards` decision. */
  choices: CardChoice[];
  /** The stack item that is partway through resolving while its controller makes a choice (608.2). */
  resolving: string | null;
  /** How many players have passed priority in a row (117.4). */
  passes: number;
  combat: Combat | null;
  winner: PlayerId | 'draw' | null;
  log: LogEntry[];
  rng: number;
  nextId: number;
  /** Last spell cast, so the UI can flash it on screen. */
  lastSpell: { seq: number; name: string; caster: PlayerId } | null;
}

export type Action =
  | { type: 'playLand'; card: string }
  | { type: 'cast'; card: string; targets?: (TargetRef | null)[] }
  | { type: 'activate'; card: string; targets?: (TargetRef | null)[] }
  | { type: 'tapMana'; card: string }
  | { type: 'untapMana'; card: string }
  | { type: 'declareAttack'; card: string; defender: PlayerId }
  | { type: 'undeclareAttack'; card: string }
  | { type: 'declareBlock'; blocker: string; attacker: string }
  | { type: 'undeclareBlock'; blocker: string }
  | { type: 'discard'; card: string }
  | { type: 'chooseTargets'; targets: (TargetRef | null)[] }
  /** Answers a `mulligan` decision. */
  | { type: 'keep' }
  | { type: 'mulligan' }
  /** Answers a `chooseCards` decision. For `bottom`, they go down in this order, so the last is the very bottom card. */
  | { type: 'chooseCards'; cards: string[] }
  /** Answers `orderTriggers`: every waiting trigger of yours, in the order they go on the stack (the last resolves first). */
  | { type: 'orderTriggers'; order: string[] }
  /** Pass priority, or finish declaring attackers or blockers. */
  | { type: 'pass' };

// ---------- card scripts ----------

export interface TargetSpec {
  type: 'creature' | 'permanent' | 'player' | 'any'; // any = creature or player
  who?: 'you' | 'opponent' | 'any'; // whose permanent / which player
  filter?: (g: Game, c: Card, source: Card) => boolean;
  optional?: boolean; // "you may" / "up to one"
  label: string;
}

export interface Ctx {
  /** The spell, or the ability's source (a copy of it if it has left the battlefield). */
  self: Card;
  you: PlayerId;
  /** Chosen targets. One that is no longer legal on resolution becomes null (608.2b). */
  targets: (TargetRef | null)[];
}

export interface StaticBonus {
  power?: number;
  toughness?: number;
  keywords?: string[];
}

/**
 * Every triggered-ability hook, with what it is told about the event that set it off.
 * Cards in an event are copies from the moment it happened, so an ability can still read
 * a creature that has since died (603.10a).
 */
export interface TriggerEvents {
  /** "When this enters". Its targets are `CardScript.targets`. */
  onEnter: object;
  onDies: object;
  onAttack: { defender: PlayerId };
  onCombatDamageToPlayer: { player: PlayerId; amount: number };
  // Table-wide triggers: every permanent on the battlefield that defines one is asked.
  onCreatureEnters: { entered: Card };
  onCreatureDies: { dead: Card };
  onCreatureAttacks: { attacker: Card; defender: PlayerId };
  onCast: { card: Card; caster: PlayerId };
  onDraw: { player: PlayerId };
  onLifeGain: { player: PlayerId; amount: number };
  onLandfall: { land: Card };
  onUpkeep: { player: PlayerId };
  onEndStep: { player: PlayerId };
}

export type TriggerHook = keyof TriggerEvents;

/**
 * A triggered ability. A plain function triggers on every event of its kind and runs when
 * the ability resolves. Use `{ when, resolve }` to trigger on only some events: `when` is
 * checked as the event happens (603.2), `resolve` runs later, from the stack.
 */
export type Trigger<E> =
  | ((g: Game, e: Ctx & E) => void)
  | { when: (g: Game, e: { self: Card } & E) => boolean; resolve: (g: Game, e: Ctx & E) => void };

type Triggers = { [H in TriggerHook]?: Trigger<TriggerEvents[H]> };

/** Behaviour for one card name. Anything a card does beyond its printed keywords lives here. */
export interface CardScript extends Triggers {
  /** "{T}: Add ..." */
  mana?: { amount: number; colors: ManaSym[] | 'identity' | 'any' };
  entersTapped?: boolean;
  /** Targets of an instant or sorcery, or of a permanent's `onEnter` ability. */
  targets?: TargetSpec[];
  /** Instants and sorceries. */
  onResolve?: (g: Game, ctx: Ctx) => void;
  /** Continuous effect this permanent grants to creature `c` (may be itself). */
  static?: (g: Game, self: Card, c: Card) => StaticBonus | null;
  /** Characteristic-defining power/toughness (e.g. Nightmare). */
  basePT?: (g: Game, self: Card) => { power: number; toughness: number };
  /** Generic mana this spell costs less. */
  costReduction?: (g: Game, self: Card) => number;
  /** Extra damage added when `source` (controlled by self's owner) damages `targetOwner` or their permanent. */
  damageBonus?: (g: Game, self: Card, source: Card, targetOwner: PlayerId) => number;
  activated?: {
    cost: { tap?: boolean; mana?: string; sacrifice?: boolean };
    targets?: TargetSpec[];
    text: string;
    resolve: (g: Game, ctx: Ctx) => void;
  };
  /** Bot hint: 'alpha' = cast before attacking with a wide board. */
  ai?: 'alpha';
}

/** Hooks that every permanent on the battlefield hears, not only the card the event is about. */
export type BroadcastHook = Exclude<TriggerHook, 'onEnter' | 'onDies' | 'onAttack' | 'onCombatDamageToPlayer'>;
