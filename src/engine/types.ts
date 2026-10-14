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
  /** A planeswalker's printed loyalty (306.5a). */
  loyalty?: string;
  /** A battle's printed defense (310.4a). */
  defense?: string;
  keywords: string[];
  image: string; // full card image
  art: string; // art crop, used for battlefield tiles
  /**
   * A card with more than one face: double-faced (712: `transform` or `modal_dfc`), split
   * (709) or adventurer (715). Its own fields are what it has outside the stack and
   * battlefield: the front face's, a split card's two halves combined (709.4), or an
   * adventurer's normal ones (715.4). `faces` has each face's own.
   */
  layout?: 'transform' | 'modal_dfc' | 'split' | 'adventure';
  faces?: CardData[];
}

/** Until-end-of-turn modifier. */
export interface Mod {
  power: number;
  toughness: number;
  keywords: string[];
  /** Makes the permanent an artifact creature too, e.g. a crewed Vehicle (702.122a). */
  creature?: boolean;
}

/** What was chosen for a spell as it was cast (601.2b). */
export interface CastInfo {
  x: number;
  kicked: number;
  /** A modal spell's chosen modes, as indexes into its script's `modal.modes`, in printed order (700.2). */
  modes: number[];
  /** A battle spell's protector, chosen as it is cast (see `CastChoices.protector`). */
  protector?: PlayerId;
  /** Cast for its flashback cost: it is exiled whenever it would leave the stack (702.34a). */
  flashback?: boolean;
}

/**
 * The choices a player announces before paying for a spell (601.2b): X, kicker, which
 * alternative cost, and which permanents pay a sacrifice cost (118.8).
 */
export interface CastChoices {
  /** The value of X, for a spell with {X} in the cost it is paying (107.3a). */
  x?: number;
  /** Times the kicker cost is paid: 0 or 1, or any number for multikicker (702.33c-d). */
  kicked?: number;
  /** Index into the script's `alternativeCosts`, or undefined to pay the mana cost (118.9). */
  alt?: number;
  /** Permanents sacrificed for the script's `additionalCost` (118.8). */
  sacrifice?: string[];
  /** A modal spell's modes, as indexes into its script's `modal.modes` (700.2a). */
  modes?: number[];
  /**
   * A battle's protector (310.9a): an opponent for a Siege (310.12a). The rules choose it
   * as the battle enters; here it is announced with the spell. Left out, the engine picks.
   */
  protector?: PlayerId;
  /**
   * Which face to cast, by index into `CardData.faces`: a split card's half (709.3), an
   * adventurer's Adventure (1, 715.3), or a modal double-faced card's face (712.11b).
   * Left out, the front face or normal characteristics.
   */
  face?: number;
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
  /**
   * Counters on it, by kind (122): '+1/+1', '-1/-1', 'charge', ... A keyword counter such
   * as 'flying' gives it that keyword (122.1b).
   */
  counters: Record<string, number>;
  /** The permanent this Aura or Equipment is attached to (303.4b, 301.5a), or null. */
  attachedTo: string | null;
  /** The turn one of its loyalty abilities was last activated, or 0 (606.3). */
  loyaltyTurn: number;
  /** A battle's protector (310.9), or null for anything else. */
  protector: PlayerId | null;
  /**
   * Which face is up, by index into `CardData.faces`: a transformed permanent's back face
   * (701.27), a modal double-faced card's face (712.8f), or the half or Adventure being cast
   * (709.3b, 715.3b). 0 everywhere but the stack and battlefield (712.8a).
   */
  face: number;
  /** A Class's level (716.2). 1 for anything else (716.2d). */
  level: number;
  /** An adventurer card exiled after its Adventure resolved: its owner may cast it from exile (715.3d). */
  adventure: boolean;
  mods: Mod[];
  /**
   * How this card was cast: the X chosen (107.3) and how many times it was kicked
   * (702.33d). Kept while it is a spell and when it enters the battlefield from the stack,
   * so its enters ability can read them (107.3m, 702.33e). Null anywhere else.
   */
  cast: CastInfo | null;
  /**
   * A commander that may still go to the command zone: put into a graveyard or exile since
   * state-based actions were last checked (903.9a), or a human's just put into a hand or
   * library (903.9b).
   */
  mayReturn: boolean;
}

export interface Player {
  id: PlayerId;
  name: string;
  isBot: boolean;
  deckId: string;
  /** Commander card names: one, or two partners (702.124). Indexes into `commanderCasts` and `commanderDamage`. */
  commanders: string[];
  /** The commanders' combined colour identity (903.4, 702.124c), in WUBRG order. */
  colors: Color[];
  life: number;
  library: Card[];
  hand: Card[];
  battlefield: Card[];
  graveyard: Card[];
  exile: Card[];
  command: Card[];
  /** Times each commander was cast from the command zone. Each has its own tax (903.8, 702.124d). */
  commanderCasts: number[];
  /**
   * Combat damage taken from each commander: `[owner id][commander index]`. Each partner
   * counts separately toward 21 (903.10a, 702.124d).
   */
  commanderDamage: number[][];
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
  /**
   * The defending player (508.5): the player attacked, or the controller of the
   * planeswalker or the protector of the battle attacked. They are the one who may block.
   */
  defender: PlayerId;
  /** The planeswalker or battle attacked (506.3, 508.1b), or null when attacking a player. */
  target: string | null;
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

/** A target: a permanent, a player, or a spell or ability on the stack (by its `StackItem` id). */
export type TargetRef = { kind: 'card'; id: string } | { kind: 'player'; id: PlayerId } | { kind: 'stack'; id: string };

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
  /** A loyalty ability: its index in the script's `loyalty` list (606). */
  ability?: number;
  event?: object;
  targets: (TargetRef | null)[];
  /** A waiting triggered ability whose controller has already chosen its place in the order (603.3b). */
  ordered?: boolean;
  /**
   * A copy of a spell (707.10). It isn't cast, and its card is a token, so it ceases to
   * exist once it leaves the stack (707.10a), or becomes a token permanent.
   */
  copy?: boolean;
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
 *  commanderZone - a player's commander was put into their graveyard, exile, hand or
 *                  library, and they choose whether it goes to the command zone (903.9).
 *                  `resume` is the player who gets priority afterwards.
 */
export type Decision =
  | { type: 'mulligan' | 'attackers' | 'blockers' | 'discard' }
  | { type: 'targets'; item: StackItem; resume: PlayerId }
  | { type: 'orderTriggers'; resume: PlayerId }
  | { type: 'chooseCards'; choice: CardChoice }
  | { type: 'commanderZone'; card: string; resume: PlayerId };

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
  /**
   * Abilities that have triggered but aren't on the stack yet (603.3), and copies of
   * spells waiting for new targets (707.10c). They go on the next time a player would
   * get priority.
   */
  triggers: StackItem[];
  /** Mulligans in progress before the first turn (103.5), or null once the game has begun. */
  mulligan: Mulligans | null;
  /** Card choices waiting to be asked, in order. The first becomes a `chooseCards` decision. */
  choices: CardChoice[];
  /** The stack item that is partway through resolving while its controller makes a choice (608.2). */
  resolving: string | null;
  /** How many players have passed priority in a row (117.4). */
  passes: number;
  /** A player who cast or activated with `hold`: auto-pass leaves them priority until they act again (117.3c). */
  holding: PlayerId | null;
  combat: Combat | null;
  winner: PlayerId | 'draw' | null;
  log: LogEntry[];
  rng: number;
  nextId: number;
  /** Last spell cast, so the UI can flash it on screen. */
  lastSpell: { seq: number; name: string; caster: PlayerId } | null;
}

export type Action =
  /** `face`: the land face of a modal double-faced card to put onto the battlefield (712.12). */
  | { type: 'playLand'; card: string; face?: number }
  /** `hold`: keep priority afterwards instead of letting auto-pass pass it (117.3c). */
  | ({ type: 'cast'; card: string; targets?: (TargetRef | null)[]; hold?: boolean } & CastChoices)
  /** `crew`: the creatures tapped to pay a crew cost (702.122a). */
  /** `ability`: which loyalty ability (606), by index into the script's `loyalty`. Left out, the `activated` ability. */
  | { type: 'activate'; card: string; ability?: number; targets?: (TargetRef | null)[]; hold?: boolean; crew?: string[] }
  | { type: 'tapMana'; card: string }
  | { type: 'untapMana'; card: string }
  /** `target`: a planeswalker or battle to attack instead of the player; `defender` is then its controller or protector (508.1b). */
  | { type: 'declareAttack'; card: string; defender: PlayerId; target?: string }
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
  /** Answers `commanderZone`: true moves the commander to the command zone, false leaves it where it is. */
  | { type: 'commanderZone'; toCommand: boolean }
  /** Pass priority, or finish declaring attackers or blockers. */
  | { type: 'pass' };

// ---------- card scripts ----------

export interface TargetSpec {
  /**
   * any = creature, player, planeswalker or battle (115.4). spell and ability are on the
   * stack (ability = activated or triggered).
   */
  type:
    | 'creature'
    | 'permanent'
    | 'player'
    | 'any'
    | 'spell'
    | 'ability'
    | 'creature or planeswalker'
    | 'player or planeswalker';
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
  onAttack: { defender: PlayerId; target: string | null };
  onCombatDamageToPlayer: { player: PlayerId; amount: number };
  // Table-wide triggers: every permanent on the battlefield that defines one is asked.
  onCreatureEnters: { entered: Card };
  onCreatureDies: { dead: Card };
  onCreatureAttacks: { attacker: Card; defender: PlayerId; target: string | null };
  onCast: { card: Card; caster: PlayerId };
  onDraw: { player: PlayerId };
  onLifeGain: { player: PlayerId; amount: number };
  onLandfall: { land: Card };
  onUpkeep: { player: PlayerId };
  onEndStep: { player: PlayerId };
  /**
   * A Siege's "When the last defense counter is removed from this permanent" (310.12b).
   * The engine exiles it first; this hook is anything more. Casting it transformed needs
   * double-faced cards, which aren't supported yet.
   */
  onDefeat: object;
  /** A Saga's chapter ability (714.2b). The engine triggers it; the script's `chapters` say what it does. */
  onChapter: { chapter: number };
  /** "When this Class becomes level N" (716.2a). */
  onLevel: { level: number };
}

export type TriggerHook = keyof TriggerEvents;

/**
 * A triggered ability. A plain function triggers on every event of its kind and runs when
 * the ability resolves. Use `{ when, resolve }` to trigger on only some events: `when` is
 * checked as the event happens (603.2), `resolve` runs later, from the stack. `targets`
 * are chosen as it goes on the stack (603.3d); an `onEnter` ability uses `CardScript.targets`.
 */
export type Trigger<E> =
  | ((g: Game, e: Ctx & E) => void)
  | { when: (g: Game, e: { self: Card } & E) => boolean; resolve: (g: Game, e: Ctx & E) => void; targets?: TargetSpec[] };

type Triggers = { [H in TriggerHook]?: Trigger<TriggerEvents[H]> };

/** One mode of a modal spell (700.2). */
export interface Mode {
  text: string;
  targets?: TargetSpec[];
  resolve: (g: Game, ctx: Ctx) => void;
}

/** A planeswalker's loyalty ability (606): `cost` loyalty counters added (+) or removed (-). */
export interface LoyaltyAbility {
  cost: number;
  text: string;
  targets?: TargetSpec[];
  resolve: (g: Game, ctx: Ctx) => void;
}

/** Behaviour for one card name. Anything a card does beyond its printed keywords lives here. */
export interface CardScript extends Triggers {
  /** "{T}: Add ...". `sacrifice`: the source is sacrificed as part of the cost, like a Treasure (111.10a). */
  mana?: { amount: number; colors: ManaSym[] | 'identity' | 'any'; sacrifice?: boolean };
  entersTapped?: boolean;
  /** Targets of an instant or sorcery, or of a permanent's `onEnter` ability. */
  targets?: TargetSpec[];
  /**
   * A modal instant or sorcery, "Choose one —" (700.2): the caster picks `min` to `max`
   * modes, the same one more than once only if `repeat` (700.2d). Each mode has its own
   * targets (700.2c), and the chosen ones run in printed order. Use instead of
   * `targets` and `onResolve`.
   */
  modal?: { min: number; max: number; repeat?: boolean; modes: Mode[] };
  /** Instants and sorceries. */
  onResolve?: (g: Game, ctx: Ctx) => void;
  /** Continuous effect this permanent grants to creature `c` (may be itself). */
  static?: (g: Game, self: Card, c: Card) => StaticBonus | null;
  /** Characteristic-defining power/toughness (e.g. Nightmare). */
  basePT?: (g: Game, self: Card) => { power: number; toughness: number };
  /** Generic mana this spell costs less. */
  costReduction?: (g: Game, self: Card) => number;
  /**
   * While this permanent is on the battlefield, generic mana that `spell` costs more
   * (positive) or less (negative), e.g. "noncreature spells cost {1} more" (601.2f).
   */
  costModifier?: (g: Game, self: Card, spell: Card, caster: PlayerId) => number;
  /** Kicker (702.33): an optional additional cost. `multi` is multikicker, paid any number of times (702.33c). */
  kicker?: { mana: string; multi?: boolean };
  /** "As an additional cost to cast this spell, sacrifice a ..." (118.8). The spec says what can be sacrificed. */
  additionalCost?: { sacrifice: TargetSpec };
  /**
   * Costs the caster may pay rather than the mana cost (118.9), such as "you may cast this
   * spell without paying its mana cost" (`mana: ''`). `when` says if it is available now.
   */
  alternativeCosts?: { label: string; mana: string; life?: number; when?: (g: Game, self: Card) => boolean }[];
  /** Extra damage added when `source` (controlled by self's owner) damages `targetOwner` or their permanent. */
  damageBonus?: (g: Game, self: Card, source: Card, targetOwner: PlayerId) => number;
  /**
   * An Aura's enchant ability (702.5): what it can be attached to. It is also the Aura
   * spell's target (303.4a). Its `who` is from the Aura's controller's side.
   */
  enchant?: TargetSpec;
  /**
   * One activated ability. Build equip with `equip(cost)` and crew with `crew(n)`.
   * `crew` in the cost means tapping other untapped creatures with that much total power
   * (702.122a). `sorcery` limits it to sorcery timing, like equip (702.6a).
   */
  activated?: {
    cost: { tap?: boolean; mana?: string; sacrifice?: boolean; crew?: number };
    sorcery?: boolean;
    targets?: TargetSpec[];
    text: string;
    resolve: (g: Game, ctx: Ctx) => void;
  };
  /** A planeswalker's loyalty abilities, in printed order (606). */
  loyalty?: LoyaltyAbility[];
  /** Flashback [cost]: it may be cast from its owner's graveyard for this cost (702.34a). */
  flashback?: string;
  /** A Saga's chapter abilities, chapter I first (714.2). */
  chapters?: Mode[];
  /** A Class's level bars (716.2a): `levels[0]` is "[cost]: Level 2", and so on. Scripts read `self.level`. */
  levels?: { cost: string; text: string }[];
  /** "You have no maximum hand size" (402.2). */
  noMaxHandSize?: boolean;
  /** Bot hint: 'alpha' = cast before attacking with a wide board. */
  ai?: 'alpha';
}

/** Hooks that every permanent on the battlefield hears, not only the card the event is about. */
export type BroadcastHook = Exclude<TriggerHook, 'onEnter' | 'onDies' | 'onAttack' | 'onCombatDamageToPlayer' | 'onDefeat' | 'onChapter' | 'onLevel'>;
