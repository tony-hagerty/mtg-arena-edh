export type Color = 'W' | 'U' | 'B' | 'R' | 'G';
export type ManaSym = Color | 'C';
/** One mana floating in a pool. `source` is the permanent that made it, so tapping it can be undone. */
export interface Mana {
  sym: ManaSym;
  source: string;
  /** Which of the source's mana abilities made it, by index into `manaAbilities`. */
  ability?: number;
  /** "Until end of turn, you don't lose this mana as steps and phases end" (Birgi): the turn it lasts until (500.5). */
  keep?: number;
  /** "Spend this mana only to cast a creature spell of the chosen type" (106.6): that creature type. */
  only?: string;
  /** "... and that spell can't be countered" (106.6): the spell it is spent on can't be countered. */
  uncounterable?: boolean;
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
  /** A mana ability it gains until end of turn (Rain of Filth). */
  mana?: ManaAbility;
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
  /** The zone it was cast from ("if this spell was cast from a graveyard"). */
  from?: Zone;
  /** Which alternative cost was paid, by index into the script's `alternativeCosts` (118.9). */
  alt?: number;
  /** Cast for its dash cost (702.109a). */
  dash?: boolean;
  /** Cast with escape (702.138b). */
  escaped?: boolean;
  /** Cast without paying its mana cost (Beseech the Mirror). */
  free?: boolean;
  /** Bargained (702.166b): the optional sacrifice was paid. */
  bargained?: boolean;
  /** The opponent promised its gift (702.174a, 702.174k), if it was promised. */
  gift?: PlayerId;
  /** How much mana was spent to cast it (Mockingbird). */
  spent?: number;
  /** Mana spent on it said the spell can't be countered (Cavern of Souls, 106.6). */
  uncounterable?: boolean;
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
  /** Cards exiled from the caster's hand for an alternative cost that asks for it, like Force of Will's (118.9). */
  exile?: string[];
  /** A modal spell's modes, as indexes into its script's `modal.modes` (700.2a). */
  modes?: number[];
  /**
   * A battle's protector (310.9a): an opponent for a Siege (310.12a). The rules choose it
   * as the battle enters; here it is announced with the spell. Left out, the engine picks.
   */
  protector?: PlayerId;
  /**
   * Escape (702.138a): the three other cards in the caster's graveyard exiled to pay the
   * escape cost. Set only when a card is cast from a graveyard with escape.
   */
  escape?: string[];
  /** The opponent a gift is promised to (702.174a). Left out, no gift is promised. */
  gift?: PlayerId;
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
  /** The turn each "only once each turn" ability of it last triggered, by name. */
  once: Record<string, number>;
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
  /**
   * Who controls it (110.2). The owner everywhere but the battlefield and the stack: a
   * permanent enters under the control of whoever put it there (110.2a), and a spell is
   * controlled by whoever cast it (601.2a).
   */
  controller: PlayerId;
  /**
   * Players an effect gave control of this permanent, oldest first, after the player who
   * controlled it before the first of them. Empty if control never changed (Wishclaw).
   */
  gained: PlayerId[];
  /** How many times it has changed zones. Each zone change makes a new object (400.7). */
  moves: number;
  /** What this permanent entered as a copy of (707), or null. */
  copy: CopyInfo | null;
  /** Exiled face down (406.3): nobody may look at it but the players in `known`. */
  faceDown: boolean;
  /** Players who may look at it while it is face down in exile (406.3). */
  known: PlayerId[];
  /** A choice made as it entered, such as Cavern of Souls's creature type (614.12a). */
  chosen: string | null;
  /** Cards an ability of it exiled, for the ability linked to it (607), like Chrome Mox's. */
  linked: { id: string; moves: number }[];
}

/**
 * A copy effect (707): the copiable values of card `name` with face `face` up, plus the
 * exceptions the copy effect adds (707.9b): extra subtypes and keywords.
 */
export interface CopyInfo {
  name: string;
  face: number;
  subtypes: string[];
  keywords: string[];
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
  /** Set when an effect says this player loses the game (104.3e). The next state-based check removes them. */
  loses: string | null;
  /** Set when an effect says this player wins the game (104.2b). The next state-based check ends the game. */
  wins: boolean;
  /** Spells this player has cast this turn, and how many of them were noncreature spells. */
  spellsCast: number;
  noncreatureSpellsCast: number;
  /** Cards this player has drawn this turn (121.1). */
  drawn: number;
}

/** An effect that lasts until end of turn (514.2) and isn't attached to a permanent. */
export type TurnEffect =
  /** The player can't cast spells, or only noncreature spells, this turn (Silence). */
  | { kind: 'cantCast'; player: PlayerId; noncreature?: boolean }
  /**
   * The player may cast card `card` (while it is the same object, `moves`) this turn, or
   * also play it if it is a land (`play`). `anyMana`: mana of any type can be spent to cast it.
   */
  | { kind: 'mayCast'; player: PlayerId; card: string; moves: number; play?: boolean; anyMana?: boolean }
  /** The player may cast spells as though they had flash this turn (Borne Upon a Wind). */
  | { kind: 'flash'; player: PlayerId };

/**
 * A delayed triggered ability (603.7): it triggers once, at the beginning of the next
 * `step` of a turn that fits (603.7b), and then the script's `delayed[key]` runs from the stack.
 */
export interface Delayed {
  id: string;
  controller: PlayerId;
  /** The spell or ability that made it, as it was then. */
  card: Card;
  key: string;
  step: 'upkeep' | 'end';
  /** Only in this turn. Left out: the next such step of `player`'s turn, or of anyone's turn without `player`. */
  turn?: number;
  player?: PlayerId;
  data?: Record<string, unknown>;
}

/** An extra turn waiting to be taken (500.7). `loseAtEnd`: the card that makes its player lose the game at that turn's end step. */
export interface ExtraTurn {
  player: PlayerId;
  loseAtEnd?: Card;
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
  /** Permanents sacrificed to pay its costs, as they last were on the battlefield, and their power then. */
  sacrificed?: Card[];
  sacrificedPower?: number[];
}

/**
 * What a search can find (701.23). Each list matches any one of its entries: `types`
 * against card types ("Artifact"), `subtypes` against subtypes ("Island"). Nothing set
 * means any card.
 */
export interface Find {
  basic?: boolean;
  types?: string[];
  subtypes?: string[];
  /** Mana value at most this. */
  maxMv?: number;
  /** "a Mountain or Plains card", for the prompt. */
  label: string;
}

/**
 * What happens once a choice made partway through resolving is made: the resolving spell
 * or ability's script `then[key]` runs with the answer (608.2d). `data` is passed along.
 */
interface Then {
  then?: string;
  data?: Record<string, unknown>;
  /**
   * The card whose script `then` runs, instead of the resolving spell or ability's: a card
   * entering the battlefield (614.12a) or acting from an opening hand (103.6).
   */
  script?: string;
}

/**
 * Cards a player picks from a list. `choiceOptions` in engine.ts says which cards are
 * shown, which can be picked, and how many.
 *  search - look through your library for a card (701.23) and put it onto the
 *           battlefield, into your hand or on top. `source` names the spell or ability.
 *  bottom - put `count` cards from your hand on the bottom of your library after a mulligan (103.5)
 *  pick   - pick `min` to `max` of some particular cards, such as the top few of a library
 */
export type CardChoice =
  | ({
      kind: 'search';
      player: PlayerId;
      source: string;
      /** 'none': the cards stay in the library for the continuation to move. */
      to: 'battlefield' | 'hand' | 'top' | 'none';
      tapped: boolean;
      find?: Find;
      reveal?: boolean;
      /** How many cards to find. Left out, one. */
      count?: number;
    } & Then)
  | { kind: 'bottom'; player: PlayerId; count: number }
  | ({ kind: 'pick'; player: PlayerId; source: string; cards: string[]; min: number; max: number; text: string; button: string } & Then)
  /** The legend rule (704.5j): the player keeps one of these legendary permanents. `resume` gets priority afterwards. */
  | { kind: 'legend'; player: PlayerId; cards: string[]; resume: PlayerId };

/**
 * A yes/no question to a player partway through resolving (608.2d): "you may ...", or
 * "... unless that player pays {2}" (118.12a). `cost` and `life` are what saying yes costs.
 */
export interface AskChoice extends Then {
  kind: 'ask';
  player: PlayerId;
  source: string;
  text: string;
  cost?: string;
  life?: number;
  yes: string;
  no: string;
}

/** A player names a card (201.3), as Demonic Consultation asks, or chooses a creature type (Cavern of Souls). */
export interface NameChoice extends Then {
  kind: 'name';
  player: PlayerId;
  source: string;
  text: string;
  /** What is named. Left out, a card. */
  of?: 'creature type';
}

/** A player chooses a player, such as "an opponent" (Wishclaw Talisman). */
export interface PlayerChoice extends Then {
  kind: 'player';
  player: PlayerId;
  source: string;
  text: string;
  options: PlayerId[];
}

/**
 * A player may cast `card` while a spell resolves (608.2g), without paying its mana cost
 * if `free`. Answered by a `cast` action for that card, or `answer` no.
 */
export interface CastChoice extends Then {
  kind: 'cast';
  player: PlayerId;
  source: string;
  text: string;
  card: string;
  free: boolean;
  /** "If that spell's mana value is N or less" (Beseech the Mirror). */
  maxMv?: number;
}

/** A player may choose new targets for spell or ability `item` (115.7d). Answered by `chooseTargets`. */
export interface RetargetChoice extends Then {
  kind: 'retarget';
  player: PlayerId;
  source: string;
  item: string;
}

export type Choice = CardChoice | AskChoice | NameChoice | PlayerChoice | CastChoice | RetargetChoice;

/** The mulligan process before the first turn (103.5). `active` is the starting player meanwhile. */
export interface Mulligans {
  /** Mulligans taken so far, by player id. */
  taken: number[];
  /** Players still to declare this round, in turn order from the starting player. */
  waiting: PlayerId[];
  /** Players who declared a mulligan this round. They all take it once everyone has declared. */
  taking: PlayerId[];
  /** Opening-hand actions (103.6) have been offered. */
  opened?: boolean;
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
 *  ask           - a player answers yes or no (see `AskChoice`)
 *  name          - a player names a card (see `NameChoice`)
 *  player        - a player chooses a player (see `PlayerChoice`)
 *  cast          - a player may cast a card while a spell resolves (see `CastChoice`)
 *  retarget      - a player may choose new targets for a spell or ability (see `RetargetChoice`)
 *  commanderZone - a player's commander was put into their graveyard, exile, hand or
 *                  library, and they choose whether it goes to the command zone (903.9).
 *                  `resume` is the player who gets priority afterwards.
 */
export type Decision =
  | { type: 'mulligan' | 'attackers' | 'blockers' | 'discard' }
  | { type: 'targets'; item: StackItem; resume: PlayerId }
  | { type: 'orderTriggers'; resume: PlayerId }
  | { type: 'chooseCards'; choice: CardChoice }
  | { type: 'ask'; choice: AskChoice }
  | { type: 'name'; choice: NameChoice }
  | { type: 'player'; choice: PlayerChoice }
  | { type: 'cast'; choice: CastChoice }
  | { type: 'retarget'; choice: RetargetChoice }
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
  /** Choices waiting to be asked, in order. The first becomes a `chooseCards`, `ask` or `name` decision. */
  choices: Choice[];
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
  /** Spells cast this turn by every player, for storm (702.40a). */
  spellsCast: number;
  /** Players dealt combat damage this turn. */
  combatDamaged: PlayerId[];
  /** Effects that last until end of turn (514.2). */
  effects: TurnEffect[];
  /** Delayed triggered abilities waiting for their moment (603.7). */
  delayed: Delayed[];
  /** Extra turns to take after this one. The last is taken first (500.7). */
  extraTurns: ExtraTurn[];
}

export type Action =
  /** `face`: the land face of a modal double-faced card to put onto the battlefield (712.12). */
  | { type: 'playLand'; card: string; face?: number }
  /** `hold`: keep priority afterwards instead of letting auto-pass pass it (117.3c). */
  | ({ type: 'cast'; card: string; targets?: (TargetRef | null)[]; hold?: boolean } & CastChoices)
  /** `crew`: the creatures tapped to pay a crew cost (702.122a). */
  /** `ability`: which loyalty ability (606), by index into the script's `loyalty`. Left out, the `activated` ability. */
  /** `discard`: the cards discarded to pay a "Discard a card" cost. `sacrifice`: the permanent for a "Sacrifice a creature" cost. */
  | { type: 'activate'; card: string; ability?: number; targets?: (TargetRef | null)[]; hold?: boolean; crew?: string[]; discard?: string[]; sacrifice?: string[] }
  /**
   * `ability`: which of its mana abilities (`manaAbilities`). Left out, the one that suits
   * the player best. `color`: the colour to make, for an ability with a choice.
   */
  | { type: 'tapMana'; card: string; ability?: number; color?: ManaSym }
  | { type: 'untapMana'; card: string }
  /** `target`: a planeswalker or battle to attack instead of the player; `defender` is then its controller or protector (508.1b). */
  | { type: 'declareAttack'; card: string; defender: PlayerId; target?: string }
  | { type: 'undeclareAttack'; card: string }
  | { type: 'declareBlock'; blocker: string; attacker: string }
  | { type: 'undeclareBlock'; blocker: string }
  | { type: 'discard'; card: string }
  /** Answers a `targets` decision, or a `retarget` one with the new set of targets (115.7d). */
  | { type: 'chooseTargets'; targets: (TargetRef | null)[] }
  /** Answers a `mulligan` decision. */
  | { type: 'keep' }
  | { type: 'mulligan' }
  /** Answers a `chooseCards` decision. For `bottom`, they go down in this order, so the last is the very bottom card. */
  | { type: 'chooseCards'; cards: string[] }
  /** Answers `orderTriggers`: every waiting trigger of yours, in the order they go on the stack (the last resolves first). */
  | { type: 'orderTriggers'; order: string[] }
  /** Answers an `ask` decision, or declines a `cast` decision with `yes: false`. */
  | { type: 'answer'; yes: boolean }
  /** Answers a `name` decision with a card name (or a creature type). */
  | { type: 'name'; name: string }
  /** Answers a `player` decision. */
  | { type: 'choosePlayer'; player: PlayerId }
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
    | 'player or planeswalker'
    | 'spell or ability'
    /** A card in a graveyard (Sevinne's Reclamation). */
    | 'graveyard card';
  who?: 'you' | 'opponent' | 'any'; // whose permanent / which player
  filter?: (g: Game, c: Card, source: Card) => boolean;
  optional?: boolean; // "you may" / "up to one"
  /** Can't be the same as the target chosen for the spec at this index: "two target players" (115.3). */
  distinctFrom?: number;
  label: string;
}

export interface Ctx {
  /** The spell, or the ability's source (a copy of it if it has left the battlefield). */
  self: Card;
  you: PlayerId;
  /** Chosen targets. One that is no longer legal on resolution becomes null (608.2b). */
  targets: (TargetRef | null)[];
  /** Permanents sacrificed to pay its costs, as they last were (Fling, Falkenrath Aristocrat). */
  sacrificed?: Card[];
  /** Their power as they were sacrificed (608.2h: last known information). */
  sacrificedPower?: number[];
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
  /** A planeswalker that isn't also a creature dies (Cruel Celebrant). */
  onPlaneswalkerDies: { dead: Card };
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
  /** Storm's copy trigger (702.40a). The engine puts it on the stack and resolves it. */
  onStorm: { count: number; item: StackItem };
  /** A delayed triggered ability (603.7): the script's `delayed[key]` runs. */
  onDelayed: { key: string; data: Record<string, unknown> };
  /** "Whenever this becomes tapped." */
  onTapped: object;
  /** "At the beginning of combat on your turn" (507): `player` is the active player. */
  onBeginCombat: { player: PlayerId };
  /** "At the beginning of each of your postcombat main phases" (505.1). */
  onPostcombatMain: { player: PlayerId };
  /** "At the beginning of your draw step", after the draw (504.2). */
  onDrawStep: { player: PlayerId };
  /** "Whenever you discard a card." `card` is the discarded card, now in its owner's graveyard. */
  onDiscard: { card: Card; player: PlayerId };
  /** "Whenever a player sacrifices a permanent." `card` is the permanent as it last was; `player` sacrificed it. */
  onSacrifice: { card: Card; player: PlayerId };
  /** Ward (702.21a), which the engine resolves. `item` is the spell or ability to counter unless its controller pays. */
  onWard: { item: string; cost: WardCost };
}

/** What ward costs (702.21a): mana, life, or both. */
export interface WardCost {
  mana?: string;
  life?: number;
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

/**
 * A mana ability (605). `{T}` is part of its cost unless `noTap`. `life` is paid as part of
 * the cost (119.4); `damage` is dealt to its controller as part of the effect.
 */
export interface ManaAbility {
  amount: number;
  /** The colours it can make, one chosen each time: a list, the commanders' colour identity, any colour, or worked out now. */
  colors: ManaSym[] | 'identity' | 'any' | ((g: Game, self: Card) => ManaSym[]);
  noTap?: boolean;
  sacrifice?: boolean;
  life?: number;
  damage?: number;
  /** "Activate only if ..." */
  when?: (g: Game, self: Card) => boolean;
  /** Activated from its owner's hand, by exiling the card (Simian Spirit Guide). */
  fromHand?: boolean;
  /** Auto-pay never uses it: the player activates it on purpose. */
  manual?: boolean;
  /** "Discard your hand" is part of the cost (Lion's Eye Diamond). */
  discardHand?: boolean;
  /** "Activate only as an instant": only while its controller has priority. */
  instant?: boolean;
  /** "Spend this mana only to cast a creature spell of the chosen type" (the permanent's `chosen`). */
  chosenType?: boolean;
  /** "... and that spell can't be countered." */
  uncounterable?: boolean;
}

/** What a continuation (`CardScript.then`) is told: the answer to the choice it waited on. */
export interface ThenCtx extends Ctx {
  /** The player who made the choice. */
  chooser: PlayerId;
  picked: Card[];
  yes: boolean;
  name: string;
  /** The player chosen, for a `player` choice. */
  player: PlayerId | null;
  data: Record<string, unknown>;
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
  /** Its mana abilities (605): "{T}: Add ...". `sacrifice`: the source is sacrificed as part of the cost, like a Treasure (111.10a). */
  mana?: ManaAbility | ManaAbility[];
  /** "This enters tapped", or "... unless you control a Plains or a Swamp" as a function of who will control it (614.1c). */
  entersTapped?: boolean | ((g: Game, c: Card, controller: PlayerId) => boolean);
  /** Targets of an instant or sorcery, or of a permanent's `onEnter` ability. */
  targets?: TargetSpec[];
  /**
   * A modal instant or sorcery, "Choose one —" (700.2): the caster picks `min` to `max`
   * modes, the same one more than once only if `repeat` (700.2d). Each mode has its own
   * targets (700.2c), and the chosen ones run in printed order. Use instead of
   * `targets` and `onResolve`.
   */
  modal?: { min: number; max: number | ((g: Game, self: Card) => number); repeat?: boolean; modes: Mode[] };
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
  /**
   * "As an additional cost to cast this spell, sacrifice a ..." (118.8). The spec says what
   * can be sacrificed. `optional`: the caster may sacrifice one, as bargain says (702.166a).
   */
  additionalCost?: { sacrifice: TargetSpec; optional?: boolean };
  /**
   * Gift (702.174): "Gift a [token]". The caster may promise an opponent a gift as they
   * cast it; that player then creates the token before the spell's other effects
   * (702.174j). `targets`: the spell's targets when the gift was promised (702.174m).
   */
  gift?: { token: string; tapped?: boolean; targets?: TargetSpec[] };
  /**
   * Costs the caster may pay rather than the mana cost (118.9), such as "you may cast this
   * spell without paying its mana cost" (`mana: ''`). `when` says if it is available now.
   */
  alternativeCosts?: {
    label: string;
    mana: string;
    life?: number;
    when?: (g: Game, self: Card) => boolean;
    /** Exile another card from your hand that fits, like Force of Will's blue card. */
    exile?: { label: string; filter: (g: Game, c: Card, self: Card) => boolean };
    /** Sacrifice a permanent that fits, like Flare of Duplication's red creature. */
    sacrifice?: TargetSpec;
    /** Dash (702.109a): the permanent has haste and returns to its owner's hand at the next end step. */
    dash?: boolean;
  }[];
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
    /**
     * `life`: life paid as part of the cost (119.4), like a fetch land's. `discard`: cards
     * discarded from the hand, chosen by the player. `discardSelf`: this card is discarded
     * (channel, activated from the hand). `counters`: counters removed from it.
     */
    cost: {
      tap?: boolean;
      mana?: string;
      sacrifice?: boolean;
      crew?: number;
      life?: number;
      discard?: number;
      discardSelf?: boolean;
      counters?: { kind: string; n: number };
      /** "Sacrifice a creature:": one permanent its controller controls that fits, chosen as it is activated. */
      sacrificeOne?: TargetSpec;
    };
    sorcery?: boolean;
    /** Activated from its owner's hand rather than the battlefield, like channel. */
    fromHand?: boolean;
    /** "Activate only if ..." / "Activate only during your turn." */
    when?: (g: Game, self: Card) => boolean;
    /** Generic mana its cost is reduced by. */
    reduction?: (g: Game, self: Card) => number;
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
  /**
   * Continuations: what happens after a choice made partway through resolving (608.2d).
   * A choice names one with `then`; the resolving spell or ability's script runs it.
   */
  then?: Record<string, (g: Game, ctx: ThenCtx) => void>;
  /** Delayed triggered abilities this card creates (603.7), by key. See `Delayed`. */
  delayed?: Record<string, (g: Game, ctx: Ctx & { data: Record<string, unknown> }) => void>;
  /** An intervening "if" of a delayed triggered ability (603.4): it triggers only if this is true. Its `delayed` checks again as it resolves. */
  delayedIf?: Record<string, (g: Game, data: Record<string, unknown>) => boolean>;
  /**
   * While this permanent is on the battlefield: does it stop `pid` casting a spell or
   * activating an ability of `card`? "Can't" wins over "can" (101.2).
   */
  forbids?: (g: Game, self: Card, pid: PlayerId, act: { kind: 'cast' | 'activate'; card: Card }) => boolean;
  /** While this permanent is on the battlefield: may `pid` cast `spell` as though it had flash? */
  grantsFlash?: (g: Game, self: Card, pid: PlayerId, spell: Card) => boolean;
  /** "This spell can't be countered" (113.6g). */
  uncounterable?: boolean;
  /** While this permanent is on the battlefield: can't `spell`, cast by `caster`, be countered? */
  protectsSpell?: (g: Game, self: Card, spell: Card, caster: PlayerId) => boolean;
  /** "This doesn't untap during your untap step" (502.3). */
  noUntap?: boolean;
  /** "Skip your draw step" (614.1b, 614.10). */
  skipDrawStep?: boolean;
  /**
   * A replacement effect that modifies how this permanent enters (614.1c, 614.12) and needs
   * a choice, like Mox Diamond's or Cavern of Souls's. It queues the choice (with `script`
   * set to the card) and returns true; the continuation puts the card onto the battlefield
   * with `finishEnter`, or elsewhere. Returning false lets it enter as usual.
   */
  replaceEnter?: (g: Game, c: Card, controller: PlayerId) => boolean;
  /** "This enters with [counters]" (614.1c). */
  entersWith?: Record<string, number>;
  /**
   * While this permanent is on the battlefield: does card `c` in a graveyard have escape
   * (702.138)? Its escape cost is then its mana cost plus exiling three other cards from
   * that graveyard.
   */
  grantsEscape?: (g: Game, self: Card, c: Card) => boolean;
  /** Ward (702.21). */
  ward?: WardCost;
  /** While this permanent is on the battlefield: the ward it gives permanent `c`, or null. */
  grantsWard?: (g: Game, self: Card, c: Card) => WardCost | null;
  /** An action from an opening hand (103.6), like Gemstone Caverns's. It queues its own choices. */
  openingHand?: (g: Game, self: Card, pid: PlayerId) => void;
  /**
   * How a bot answers a choice this card asks partway through resolving, by the choice's
   * `then` key. Without one, bots use a general rule (see ai.ts).
   */
  botChoice?: Record<string, (g: Game, pid: PlayerId, choice: Choice) => Action>;
  /**
   * Bot hint: may a bot cast this now? For a card whose cost comes later, which the
   * look-ahead can't see (Pact of Negation's upkeep payment).
   */
  botCast?: (g: Game, pid: PlayerId, self: Card) => boolean;
  /**
   * Bot hint: 'alpha' = cast before attacking with a wide board. 'tutor' = a search for a
   * card, cast in the second main phase with mana to spare (the look-ahead can't see what
   * it finds is worth). 'ritual' = it makes mana: cast it when the mana lets the bot cast
   * something it couldn't otherwise. 'extraTurn' = an extra turn that loses the game at its
   * end: cast only when the bot could win in that turn.
   */
  ai?: 'alpha' | 'tutor' | 'ritual' | 'extraTurn';
  /** Bot hint: should a bot activate this permanent's `activated` ability now? The look-ahead can't see what it is worth. */
  botActivate?: (g: Game, pid: PlayerId, self: Card) => boolean;
}

/** Hooks that every permanent on the battlefield hears, not only the card the event is about. */
export type BroadcastHook = Exclude<
  TriggerHook,
  'onEnter' | 'onDies' | 'onAttack' | 'onCombatDamageToPlayer' | 'onDefeat' | 'onChapter' | 'onLevel' | 'onStorm' | 'onDelayed' | 'onTapped' | 'onWard'
>;
