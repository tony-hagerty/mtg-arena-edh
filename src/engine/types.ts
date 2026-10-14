export type Color = 'W' | 'U' | 'B' | 'R' | 'G';
export type ManaSym = Color | 'C';
/** One mana floating in a pool. `source` is the permanent that made it, so tapping it can be undone. */
export interface Mana {
  sym: ManaSym;
  source: string;
}
export type PlayerId = number;
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
  zone: Zone;
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
  pool: Mana[]; // floating mana, emptied when the step changes
  lost: boolean;
  drewFromEmpty: boolean;
}

/**
 * Who acts is always `Game.priority`.
 *  main1/main2 - active player plays cards, then passes
 *  attackers   - active player declares attackers, then passes
 *  blockers    - each attacked player in turn order declares blockers, then passes
 *  damage      - active player's last chance for instants before combat damage
 *  discard     - active player discards down to seven
 */
export type Step = 'main1' | 'attackers' | 'blockers' | 'damage' | 'main2' | 'discard' | 'gameOver';

export interface Attack {
  id: string; // attacking creature
  defender: PlayerId;
  blockers: string[];
  blocked: boolean; // set once blocks are locked in; stays true even if the blockers leave
}

export interface Combat {
  attacks: Attack[];
  toBlock: PlayerId[]; // defenders who still have to declare blocks
}

export type TargetRef = { kind: 'card'; id: string } | { kind: 'player'; id: PlayerId };

export interface LogEntry {
  turn: number;
  text: string;
  player?: PlayerId;
}

export interface Game {
  players: Player[];
  active: PlayerId;
  priority: PlayerId;
  turn: number;
  step: Step;
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
  self: Card;
  you: PlayerId;
  targets: (TargetRef | null)[];
}

export interface StaticBonus {
  power?: number;
  toughness?: number;
  keywords?: string[];
}

/** Behaviour for one card name. Anything a card does beyond its printed keywords lives here. */
export interface CardScript {
  /** "{T}: Add ..." */
  mana?: { amount: number; colors: ManaSym[] | 'identity' | 'any' };
  entersTapped?: boolean;
  /** Targets of the spell, or of its enters-the-battlefield ability (chosen on cast). */
  targets?: TargetSpec[];
  /** Instants and sorceries. */
  onResolve?: (g: Game, ctx: Ctx) => void;
  /** Permanents: "When this enters". */
  onEnter?: (g: Game, ctx: Ctx) => void;
  onDies?: (g: Game, ctx: Ctx) => void;
  onAttack?: (g: Game, e: { self: Card; defender: PlayerId }) => void;
  onCombatDamageToPlayer?: (g: Game, e: { self: Card; player: PlayerId; amount: number }) => void;
  // Table-wide triggers: called for every permanent on the battlefield that defines them.
  onCreatureEnters?: (g: Game, e: { self: Card; entered: Card }) => void;
  onCreatureDies?: (g: Game, e: { self: Card; dead: Card }) => void;
  onCreatureAttacks?: (g: Game, e: { self: Card; attacker: Card; defender: PlayerId }) => void;
  onCast?: (g: Game, e: { self: Card; card: Card; caster: PlayerId }) => void;
  onDraw?: (g: Game, e: { self: Card; player: PlayerId }) => void;
  onLifeGain?: (g: Game, e: { self: Card; player: PlayerId; amount: number }) => void;
  onLandfall?: (g: Game, e: { self: Card; land: Card }) => void;
  onUpkeep?: (g: Game, e: { self: Card; player: PlayerId }) => void;
  onEndStep?: (g: Game, e: { self: Card; player: PlayerId }) => void;
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

export type BroadcastHook =
  | 'onCreatureEnters'
  | 'onCreatureDies'
  | 'onCreatureAttacks'
  | 'onCast'
  | 'onDraw'
  | 'onLifeGain'
  | 'onLandfall'
  | 'onUpkeep'
  | 'onEndStep';
