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
  /** "Until end of combat, you don't lose this mana as steps and phases end" (firebending, 702.189a): the turn whose combat phase it lasts through (500.5a). */
  combat?: number;
  /** The name of the source that made it, for "mana from Treasures spent to activate this ability" (Mr. House). */
  name?: string;
  /** "Spend this mana only to cast a creature spell of the chosen type" (106.6): that creature type. */
  only?: string;
  /** "Spend this mana only to cast a legendary spell" (106.6, Plaza of Heroes). */
  legendary?: boolean;
  /** "Spend this mana only to cast instant and sorcery spells" (106.6, Tablet of Discovery): spells with one of these card types. */
  types?: string[];
  /** "... and that spell can't be countered" (106.6): the spell it is spent on can't be countered. */
  uncounterable?: boolean;
  /** Made by a mana ability used by hand that can be taken back: what taking it back undoes (`canUntapMana`). */
  undo?: ManaUndo;
  /** Left over from paying the mana cost of this permanent's mana ability by hand: taking that back takes this too. */
  along?: string;
}
/** A mana ability used by hand, which can be taken back (`Game.manaRewind`). */
export interface ManaRewind {
  pid: PlayerId;
  /** The source. */
  card: string;
  /** What clicking takes it back: the source, if using it tapped it or took it away (a Lotus Petal), and a creature tapped for its cost (Relic of Legends). */
  tapped: string[];
  /** The action, and the game before it: the server's own; a player's view leaves them out. */
  action?: Extract<Action, { type: 'tapMana' }>;
  before?: Game;
}

/**
 * How to take back a mana ability a player used by hand. Only one that changed nothing but
 * which permanents are tapped and what is in the pool gets one.
 */
export interface ManaUndo {
  /** How much mana it made. */
  made: number;
  /** Every permanent it tapped: the source, a creature tapped for its cost (Relic of Legends), and sources tapped to pay its mana cost. */
  tapped: string[];
  /** Mana spent from the pool to pay its mana cost (a Signet's {1}), to put back. */
  spent: Mana[];
  /** How much mana was left over in the pool from paying that cost (marked `along`). */
  left: number;
  /** The creature tapped for its cost instead of {T} (Relic of Legends): clicking it takes the mana back. */
  creature?: string;
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

/**
 * What a continuous effect does to an object's characteristics, by layer (613.1). Each part
 * applies in its own layer, to the same set of objects (613.6). Parts left out change nothing.
 * Layer 1 (copy effects) is `Card.copy`, and layer 2 (control) is `Card.controller`; no card
 * changes text (layer 3) yet.
 */
export interface LayerParts {
  /** Layer 4 (613.1d): card types it adds, "in addition to its other types" (205.1b), like a crewed Vehicle's artifact creature (702.122a). */
  types?: string[];
  /**
   * Layer 4: card types it removes, like a reconfigured Equipment's creature type (702.151b).
   * A permanent that stops being a creature loses its creature types too.
   */
  notTypes?: string[];
  /** Layer 4: subtypes it adds (205.1b), like Urborg's Swamp. */
  subtypes?: string[];
  /**
   * Layer 5 (613.1e): its new colours, which replace all the ones it had (105.3), like
   * Aphotic Wisps' "becomes black". Empty makes it colorless.
   */
  colors?: Color[];
  /**
   * Layer 6 (613.1f): keyword abilities it adds, in lower case ("flying", "protection from
   * white"), and restrictions carried the same way (`CANT_ATTACK`).
   */
  keywords?: string[];
  /**
   * Layer 6: "loses all abilities" (113.10). It loses every ability it has at this point in
   * layer 6: its own, and those that effects with earlier timestamps gave it (613.7). Effects
   * with later ones can give it new abilities. Restrictions like `CANT_ATTACK` (113.12) and
   * designations like harnessed (701.64b) aren't abilities, so they stay.
   */
  loseAll?: boolean;
  /**
   * Layer 6: "loses [ability]" (113.10b): these keyword abilities, in lower case, every
   * instance of each. `'ward'` takes its ward abilities too, its own and given ones (702.21),
   * and `'enchant'` its own enchant ability (702.5).
   */
  lose?: string[];
  /** Layer 6: a ward ability it adds (702.21a): "have 'Ward—Pay 2 life'" (Hexing Squelcher). */
  ward?: WardCost;
  /** Layer 6: a mana ability it adds (Rain of Filth). */
  mana?: ManaAbility;
  /**
   * Layer 6: a triggered ability it adds, entry `index` of card `from`'s `grants`: Malakir
   * Rebirth's until end of turn, or Isilu's "each other nontoken creature you control has
   * persist" from a static ability (`grantOf`).
   */
  grant?: { from: string; index: number };
  /** Layer 6: the activated abilities of these cards, by name (Agatha's Soul Cauldron). */
  activatedOf?: string[];
  /**
   * Layer 6: an enchant ability it gains (702.5a), card `enchantOf`'s `givesEnchant`: Animate
   * Dead's "enchant creature put onto the battlefield with this Aura".
   */
  enchantOf?: string;
  /**
   * Layer 6: abilities its script reads by name instead of the engine, like harnessed
   * (701.64b) or an ability a Saga's chapter gave it (`hasFlag`).
   */
  flags?: string[];
  /** Layer 7b (613.4b): sets its base power and/or toughness, like Ghost Vacuum's "is a 1/1". */
  setPower?: number;
  setToughness?: number;
  /** Layer 7c (613.4c): adds to its power and/or toughness. */
  power?: number;
  toughness?: number;
  /** Layer 7d (613.4d): switches its power and toughness. */
  switchPT?: boolean;
}

/**
 * A continuous effect from a resolved spell or ability (611.2), kept on the one permanent it
 * affects: its set of objects was locked in as it began (611.2c). It goes away when the
 * permanent leaves the battlefield (400.7), or sooner if `until` or `while` says so.
 */
export interface ContinuousEffect extends LayerParts {
  /** Its timestamp (613.7b): applied after effects with earlier ones in the same layer. */
  ts: number;
  /**
   * How long it lasts (611.2a): until end of turn, gone in the cleanup step (514.2); until
   * that player's next turn begins; or with no duration, for as long as the permanent stays.
   */
  until: 'turn' | 'leaves' | { nextTurnOf: PlayerId };
  /** "For as long as" that object stays on the battlefield (611.2b): the object, which stops being it when it moves (400.7). */
  while?: { id: string; moves: number };
}

/**
 * An object's characteristics after every continuous effect is applied (613), as far as the
 * layer that was asked for. `keywords` are in lower case. A permanent's power and toughness are
 * worked out even while it isn't a creature, so they are there if it becomes one.
 */
export interface Characteristics {
  typeLine: string;
  colors: Color[];
  keywords: string[];
  power: number;
  toughness: number;
  /**
   * Does it have the abilities of its copiable values (layer 6), the ones its script and
   * printed keywords give it? False once it loses all abilities (`LayerParts.loseAll`).
   */
  own: boolean;
  /** Abilities of its script it has lost one by one (`LayerParts.lose`), by script key: `'enchant'`, `'ward'`. */
  lost: string[];
  /** Ward abilities effects gave it (layer 6). */
  wards: WardCost[];
  /** Mana abilities effects gave it (layer 6). */
  mana: ManaAbility[];
  /** Triggered abilities effects gave it (layer 6). */
  grants: { from: string; index: number }[];
  /** Cards whose activated abilities it has from effects (layer 6). */
  activatedOf: string[];
  /** The cards whose `givesEnchant` it has as an enchant ability from effects (layer 6), by name. */
  enchantOf: string[];
  /** Abilities its script reads by name (`LayerParts.flags`). */
  flags: string[];
}

/**
 * A triggered ability one card gives another (613.1f): "Equipped creature has 'Whenever
 * ...'". The ability is the creature's own, so "this creature" means it. An effect gives it
 * with a `LayerParts.grant` naming it: a static ability (`grantOf`), or a resolved spell or
 * ability until end of turn.
 */
export interface GrantedTrigger {
  hook: TriggerHook;
  trigger: Trigger<never>;
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
  /** It is exiled whenever it would leave the stack: an aftermath half cast from a graveyard (702.127a). */
  exileOnLeave?: boolean;
  /** "If that spell would be put into your graveyard, exile it instead" (Emet-Selch). */
  graveyardToExile?: boolean;
  /** Cards exiled from the graveyard for delve (702.66a). */
  delved?: number;
  /** The zone it was cast from ("if this spell was cast from a graveyard"). */
  from?: Zone;
  /** Which alternative cost was paid, by index into the script's `alternativeCosts` (118.9). */
  alt?: number;
  /** Cast for its dash cost (702.109a). */
  dash?: boolean;
  /** Cast with suspend (702.62a): a creature spell has haste until its caster loses control of it. */
  suspend?: boolean;
  /** Cast for its impending cost (702.176a): "this permanent's impending cost was paid". */
  impending?: boolean;
  /** Cast with escape (702.138b). */
  escaped?: boolean;
  /** Cast without paying its mana cost (Beseech the Mirror). */
  free?: boolean;
  /** Bargained (702.166b): the optional sacrifice was paid. */
  bargained?: boolean;
  /** The cards discarded to cast it, as they last were in the hand ("if the discarded card wasn't a land card"). */
  discarded?: Card[];
  /** The opponent promised its gift (702.174a, 702.174k), if it was promised. */
  gift?: PlayerId;
  /** How much mana was spent to cast it (Mockingbird). */
  spent?: number;
  /** Mana spent on it said the spell can't be countered (Cavern of Souls, 106.6). */
  uncounterable?: boolean;
  /** Cast from exile for {2} after being airbent (701.65a). */
  airbent?: boolean;
  /** Cast from exile as a plotted card, without paying its mana cost (702.170d). */
  plotted?: boolean;
  /** Its offspring cost was paid (702.175a). */
  offspring?: boolean;
  /** How its damage is divided among its targets, by target index (601.2d). */
  divide?: number[];
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
  /** Cards discarded from the caster's hand for the script's `additionalCost` (118.8). */
  discard?: string[];
  /** Cards exiled from the caster's hand for an alternative cost that asks for it, like Force of Will's (118.9). */
  exile?: string[];
  /** A modal spell's modes, as indexes into its script's `modal.modes` (700.2a). */
  modes?: number[];
  /** Pay the offspring cost (702.175a). */
  offspring?: boolean;
  /** Which of the additional costs it offers to pay ("pay 5 life or pay {2}"), by index into `additionalCost.oneOf`. */
  extra?: number;
  /**
   * How a spell that divides damage among its targets divides it (601.2d): so much to each
   * target, by index into the targets. Each target gets at least 1, and it adds up to the total.
   */
  divide?: number[];
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
  /** Delve (702.66a): cards in the caster's graveyard exiled to pay for generic mana, one each. */
  delve?: string[];
  /**
   * Convoke (702.51a): the creatures the caster chose to tap, each paying for {1} or one mana
   * of its colour. Left out, auto-pay decides which creatures, if any, convoke.
   */
  convoke?: string[];
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
  /** How many times it has transformed since it became this object (701.27f). */
  transformed?: number;
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
  /** Continuous effects from resolved spells and abilities on this permanent (611.2), oldest first. */
  continuous: ContinuousEffect[];
  /**
   * Its timestamp (613.7): given as it enters a zone (613.7d), and again as an Aura or
   * Equipment becomes attached (613.7e) and as a double-faced permanent transforms (613.7g).
   * Effects from its static abilities share it (613.7a).
   */
  ts: number;
  /** The timestamp of each kind of counter on it (613.7c): when the last one of that kind was put on. */
  counterTs?: Record<string, number>;
  /**
   * On a copy that remembers a permanent as it last was on the battlefield (`lastKnown`,
   * 603.10a, 608.2h): its characteristics then, every effect applied.
   */
  lki?: Characteristics;
  /**
   * How this card was cast: the X chosen (107.3) and how many times it was kicked
   * (702.33d). Kept while it is a spell and when it enters the battlefield from the stack,
   * so its enters ability can read them (107.3m, 702.33e). Null anywhere else.
   */
  cast: CastInfo | null;
  /**
   * A commander that may still go to the command zone: put into a graveyard or exile since
   * state-based actions were last checked (903.9a).
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
  /**
   * What this permanent is a copy of (707), or null: the copy effect it entered with (707.5),
   * or the one it became a copy with on the battlefield (707.4). Each copy effect overwrites
   * every copiable value (707.2), and none has a duration, so the latest is all of layer 1
   * (613.2a): an earlier one can't apply again.
   */
  copy: CopyInfo | null;
  /**
   * The timestamp of the copy effect it became a copy with on the battlefield (613.7b, 707.4).
   * Static abilities it has from that effect take this one if it is later than its own
   * (613.7a). Unset for a permanent that entered as a copy: that effect began as it entered.
   */
  copyTs?: number;
  /** Exiled face down (406.3): nobody may look at it but the players in `known`. */
  faceDown: boolean;
  /** Players who may look at it while it is face down in exile (406.3). */
  known: PlayerId[];
  /** A choice made as it entered, such as Cavern of Souls's creature type (614.12a). */
  chosen: string | null;
  /**
   * Played without its rules text, by its owner's choice on the paste screen (a card the
   * game can't read yet): its script is ignored, so it is a vanilla card with its printed
   * name, cost, types, P/T and keywords (see "Known simplifications").
   */
  textless?: boolean;
  /** The log has said once that its rules text doesn't work here (the first time it was cast or played). */
  textlessNoted?: boolean;
  /** Monstrous (701.37b): a designation, kept until it leaves the battlefield. */
  monstrous?: boolean;
  /** It has suspend from an effect, like Delay's "it gains suspend" (702.62a). */
  suspend?: boolean;
  /** Cards it exiled "until this leaves the battlefield" (Hostage Taker): they return when it does (610.3). */
  holds?: { id: string; moves: number }[];
  /** Cards an ability of it exiled, for the ability linked to it (607), like Chrome Mox's. */
  linked: { id: string; moves: number }[];
  /**
   * On a triggered ability's remembered source only: the event it triggered on, so a target
   * spec can name something from it, like "target creature that player controls".
   */
  triggeredBy?: Record<string, unknown>;
  /** On the battlefield: the turn it entered ("if this land entered this turn", Dark Fortress). */
  entered?: number;
  /** In exile: the turn it became plotted (702.170d). Its owner may cast it free on a later turn. */
  plotted?: number;
  /** In exile: it was airbent, so its owner may cast it for {2} while it stays exiled (701.65a). */
  airbent?: boolean;
  /** In exile: the turn warp exiled it (702.185a). Its owner may cast it after that turn. */
  warped?: number;
  /** Phased out indirectly with the permanent it is attached to (702.26g): it phases in with that one. */
  phasedWith?: string;
  /**
   * Goaded (701.15b): a designation, not an ability, so it stays when the creature loses its
   * abilities. One entry for each player who goaded it (701.15c), each lasting until that
   * player's next turn (701.15a); the same player goading it again adds nothing (701.15d).
   */
  goaded?: { by: PlayerId }[];
  /**
   * Earthbent (701.66a): the players whose earthbend made this land a creature, each with a
   * delayed triggered ability waiting: "When that land dies or is put into exile, return it to
   * the battlefield tapped under your control" (603.7).
   */
  earthbent?: PlayerId[];
}

/**
 * A copy effect (707): the copiable values of card `name` with face `face` up, plus the
 * exceptions the copy effect adds, which become copiable values too (707.9a-b): extra
 * subtypes, keywords and activated abilities.
 */
export interface CopyInfo {
  name: string;
  face: number;
  subtypes: string[];
  keywords: string[];
  /**
   * Activated abilities the copy has besides the copied card's (707.9a): ability `index` of
   * card `from`'s script, in that order after its own. Likeness Looter's "except it has ...
   * this ability".
   */
  activated?: { from: string; index: number }[];
  /** A base power and toughness the copy effect sets (707.9b): offspring's 1/1, Saw in Half's halves. */
  power?: number;
  toughness?: number;
  /** Creature types the copy effect sets, replacing the copied ones (707.9b, 205.1a): Hashaton's "it's a ... Zombie". */
  creatureTypes?: string[];
  /** Colours the copy effect sets, replacing the copied ones (707.9b, 105.3): Hashaton's "black". */
  colors?: Color[];
}

export interface Player {
  id: PlayerId;
  name: string;
  isBot: boolean;
  /**
   * The log and prompts speak to this player as "you" ("You cast", "your library"). Set
   * for the only person in a game against bots; with several people at the table, every
   * line names its player.
   */
  you?: boolean;
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
  /** `drawn` as their latest draw step began, so the first card drawn in it can be told apart (504.1, Notion Thief). */
  drawnBeforeDrawStep?: number;
  /** Life this player has lost this turn, from damage (119.2), paying life (119.4) or an effect (119.3). */
  lifeLost: number;
  /** Life this player has gained this turn (119.3). */
  lifeGained?: number;
  /** The creatures this player has attacked with this turn, in any combat (Temple of Civilization). */
  attackedWith?: string[];
  /**
   * Permanents that phased out while this player controlled them (702.26). They are treated as
   * though they don't exist, so they aren't on the battlefield list, and phase back in during
   * this player's untap step (502.1). Ones attached to them came along (`Card.phasedWith`).
   */
  phasedOut?: Card[];
  /**
   * A setting: this (human) player divides their attackers' combat damage by hand when
   * there is a choice (510.1c, 702.19b). Off, it is split automatically.
   */
  manualDamage?: boolean;
  /** The bending keyword actions this player has done this turn (Avatar Aang's "if you've done all four this turn"). */
  bent?: Bend[];
  /** Additional lands this player may play this turn from one-shot effects ("You may play an additional land this turn", 305.2b). */
  extraLands?: number;
}

/** The bending keyword actions and abilities: waterbend (701.67), earthbend (701.66), firebending (702.189) and airbend (701.65). */
export type Bend = 'waterbend' | 'earthbend' | 'firebend' | 'airbend';

/** An effect that lasts until end of turn (514.2) and isn't attached to a permanent. */
export type TurnEffect =
  /** The player can't cast spells, or only noncreature spells, this turn (Silence). */
  /**
   * `types`: only spells with one of these card types ("Players can't cast creature or
   * planeswalker spells"). `until`: it lasts until the end of that player's turn numbered
   * `turn` or later (Single Combat's "until the end of your next turn"), not just this turn.
   * `notFromHand`: only spells cast from anywhere other than their hand (Avatar's Wrath).
   */
  | { kind: 'cantCast'; player: PlayerId; noncreature?: boolean; types?: string[]; notFromHand?: boolean; until?: { player: PlayerId; turn: number }; ends?: Ends }
  /** The player's life total can't change (119.7, 119.8): they can't gain or lose life, or pay life. */
  | { kind: 'lifeLocked'; player: PlayerId; ends?: Ends }
  /** The player has protection from everything (702.16j). */
  | { kind: 'protection'; player: PlayerId; ends?: Ends }
  /** Creatures can't attack the player unless their controller pays `mana` for each of them (508.1g, Summon: Yojimbo). */
  | { kind: 'attackTax'; player: PlayerId; mana: string; ends?: Ends }
  /**
   * The player may cast card `card` (while it is the same object, `moves`) this turn, or
   * also play it if it is a land (`play`). `anyMana`: mana of any type can be spent to cast it.
   * `until`: it lasts until the end of that player's turn numbered `turn` or later ("until the
   * end of your next turn"). `lasting`: for as long as the card stays where it is (Flameshape),
   * and `ifSubtype` only while the player controls a permanent with that subtype ("if you
   * control a Wizard").
   */
  | {
      kind: 'mayCast';
      player: PlayerId;
      card: string;
      moves: number;
      play?: boolean;
      anyMana?: boolean;
      until?: { player: PlayerId; turn: number };
      lasting?: boolean;
      ifSubtype?: string;
      /** "If that spell would be put into your graveyard, exile it instead" (Vohar): a spell cast with this permission. */
      graveyardToExile?: boolean;
    }
  /** Card `card` in a graveyard has flashback this turn, its flashback cost its mana cost (Flashback, Stingcaster Mage). */
  | { kind: 'flashback'; card: string; moves: number }
  /** "The next instant or sorcery spell you cast this turn can't be countered" (Overmaster): used up by that spell. */
  | { kind: 'uncounterableNext'; player: PlayerId }
  /** The player may cast spells as though they had flash this turn (Borne Upon a Wind). */
  | { kind: 'flash'; player: PlayerId };

/**
 * When an effect that doesn't last just until end of turn ends: "until your next turn" ends
 * as `nextTurnOf`'s next turn begins (611.2a, 500.1).
 */
export interface Ends {
  nextTurnOf: PlayerId;
}

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
  /** `main1`: "at the beginning of [your] precombat main phase" (505.1). */
  step: 'upkeep' | 'main1' | 'end';
  /** It triggers each time, not once: "at the beginning of each of your precombat main phases for the rest of the game" (paradigm, 702.192a). */
  repeat?: boolean;
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

/**
 * How one attacker assigns its combat damage (510.1): so much to each creature blocking it,
 * by id, and `through` to the player, planeswalker or battle it is attacking (trample, 702.19b).
 * Together they add up to its power (510.1a).
 */
export interface DamageAssignment {
  attacker: string;
  blockers: Record<string, number>;
  through: number;
}

/**
 * What an attacker can do with its combat damage this step: its power, the creatures
 * blocking it with the damage that is lethal to each (702.19b, 702.2c), and whether any can
 * go to what it attacked. `choice`: its controller decides how to divide it (510.1c, 702.19b).
 */
export interface DamageRoom {
  attacker: string;
  power: number;
  blocked: boolean;
  blockers: { id: string; lethal: number }[];
  trample: boolean;
  /** Damage can go to what it attacked: unblocked, or with trample, and that is still there (510.1b). */
  canThrough: boolean;
  choice: boolean;
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
  /** The line as everyone sees it. */
  text: string;
  player?: PlayerId;
  /** Names of the cards the text mentions, exactly as written in it, so the UI can link them. */
  cards?: string[];
  /**
   * The line as `players` see it, when it shows them something hidden from the others,
   * like the card they found searching their library (701.23e).
   */
  private?: { players: PlayerId[]; text: string; cards?: string[] };
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
  /** Which of the hook's triggered abilities it is, when the hook holds a list. */
  trigger?: number;
  /** An activated ability: which of the script's `activated` list, when it has several. */
  activated?: number;
  /** A loyalty ability: its index in the script's `loyalty` list (606). */
  ability?: number;
  /** An activated ability with X in its cost: the X announced as it was activated (107.3a). */
  x?: number;
  event?: object;
  targets: (TargetRef | null)[];
  /** A waiting triggered ability whose controller has already chosen its place in the order (603.3b). */
  ordered?: boolean;
  /** A modal triggered ability: the modes chosen as it was put on the stack (603.3c), in printed order. */
  modes?: number[];
  /**
   * A copy of a spell (707.10). It isn't cast, and its card is a token, so it ceases to
   * exist once it leaves the stack (707.10a), or becomes a token permanent.
   */
  copy?: boolean;
  /** A triggered ability another card gave its source: entry `index` of card `from`'s `grants`. */
  granted?: { from: string; index: number };
  /** An activated ability its source has from another card (Agatha's Soul Cauldron): that card's name, whose script it runs. */
  borrowed?: string;
  /**
   * An activated ability's index in the list of the script it comes from: its source's own, or
   * `borrowed`'s. It is that ability whatever its source loses or gains later (113.7a).
   */
  scriptIndex?: number;
  /** Permanents exiled to pay its costs (The Soul Stone), as they last were on the battlefield. */
  exiled?: Card[];
  /** Permanents sacrificed to pay its costs, as they last were on the battlefield, and their power then. */
  sacrificed?: Card[];
  sacrificedPower?: number[];
  /** The creature tapped to pay a station cost (702.184a), as it was then: its power as the ability resolves, or as it last was (608.2h). */
  stationed?: Card;
  /** The mana spent to activate it, by source: for "each mana from Treasures spent to activate this ability" (Mr. House). */
  spentFrom?: { source: string; name?: string }[];
}

/**
 * What a search can find (701.23). Each list matches any one of its entries: `types`
 * against card types ("Artifact"), `subtypes` against subtypes ("Island"). Nothing set
 * means any card.
 */
export interface Find {
  basic?: boolean;
  types?: string[];
  /** Keywords, lower case: a card with one of them is found too, as with "an instant card or a card with flash". */
  keywords?: string[];
  subtypes?: string[];
  /** Mana value at most this. */
  maxMv?: number;
  /** A mana cost exactly one of these ("an artifact card with mana cost {0} or {1}", 202.1). */
  costs?: string[];
  /** Toughness at most this, as the card has it in the library (208.2a). */
  maxToughness?: number;
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
  /** `ordered`: the order the cards are picked in matters, as when they go on the bottom of a library (401.4). */
  /** `pickable`: the cards that can be picked, when the player sees more than that (Silundi Vision's six). Left out, all of them. */
  | ({ kind: 'pick'; player: PlayerId; source: string; cards: string[]; min: number; max: number; text: string; button: string; ordered?: boolean; pickable?: string[] } & Then)
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
  /** What is named. Left out, a card. A colour is named by its mana symbol: W, U, B, R or G. A card type by its name (`CARD_TYPES`). */
  of?: 'creature type' | 'color' | 'card type';
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
/** Keyword abilities whose trigger lets a card be cast: for its madness or miracle cost (702.35a, 702.94a), or free with suspend (702.62a). */
export type CastVia = 'madness' | 'miracle' | 'suspend';

export interface CastChoice extends Then {
  kind: 'cast';
  player: PlayerId;
  source: string;
  text: string;
  card: string;
  free: boolean;
  /** "If that spell's mana value is N or less" (Beseech the Mirror). */
  maxMv?: number;
  /** "If that spell would be put into your graveyard, exile it instead" (Emet-Selch). */
  graveyardToExile?: boolean;
  /** Cast "by paying [its madness or miracle cost] rather than paying its mana cost" (702.35a, 702.94a). */
  via?: CastVia;
}

/**
 * A player may choose new targets for spell or ability `item` (115.7d). Answered by
 * `chooseTargets`. With `change`, they change its targets instead (115.7a): each to another
 * legal target. It is only asked when every target can be changed; otherwise none is.
 */
export interface RetargetChoice extends Then {
  kind: 'retarget';
  player: PlayerId;
  source: string;
  item: string;
  change?: boolean;
}

/**
 * A player chooses a whole number from `min` to `max` (a bid of life, Mages' Contest), or
 * with `decline`, may choose none: that button's label. The continuation reads `n`, and
 * `yes` is false if they chose none.
 */
export interface NumberChoice extends Then {
  kind: 'number';
  player: PlayerId;
  source: string;
  text: string;
  min: number;
  max: number;
  decline?: string;
}

export type Choice = CardChoice | AskChoice | NameChoice | PlayerChoice | CastChoice | RetargetChoice | NumberChoice;

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

/** How a replacement effect changes an amount of damage (614.1a): doubled, or plus N. */
export interface DamageChange {
  times?: number;
  plus?: number;
}

/** Tokens of one kind an event would create (111.2): `count` of token `key`, or of a copy of something (`copy`, 707.2). */
export interface TokenSpec {
  key: string;
  count: number;
  copy?: CopyInfo | null;
}

/**
 * An event that replacement and prevention effects can change (614, 615), as it would
 * happen. `replace` in replace.ts applies every effect that applies to it and returns the
 * event that happens instead, which the caller carries out.
 *  damage   - `source` would deal `amount` damage to player `player` or permanent `card` (120).
 *  move     - card `card` would be put from its zone into `to` (400.6), a commander maybe into the command zone.
 *  draw     - `player` would draw a card (121.1). `firstInDrawStep`: it would be the first
 *             card they draw in their own draw step (Notion Thief's exception).
 *  tokens   - tokens would be created under `player`'s control (111.2).
 *  counters - `n` counters of kind `counter` would be put on permanent `card` (122.6), by an
 *             effect, as it enters (`entering`), or not by an effect (`by`): as a cost (a loyalty
 *             ability's, 606.4) or by a turn-based action (a Saga's lore counter, 714.3b).
 *  gainLife - `player` would gain `amount` life (119.10).
 *  enter    - permanent `card` would enter the battlefield (614.1c-d, 614.12), tapped or not,
 *             with these counters. Counters it enters with are then put on it as a `counters` event (616.1g).
 *  begin    - `player` would begin an extra turn (500.7) or their draw step (614.10).
 *  none     - replaced with nothing: skipped (614.10), or all the damage prevented (615.6).
 *             `was` is the event it replaced.
 */
export type ReplaceEvent =
  | { kind: 'damage'; source: Card; player?: PlayerId; card?: Card; amount: number; combat: boolean }
  | { kind: 'move'; card: Card; to: Zone }
  | { kind: 'draw'; player: PlayerId; firstInDrawStep: boolean }
  | { kind: 'tokens'; player: PlayerId; tokens: TokenSpec[] }
  | { kind: 'counters'; card: Card; counter: string; n: number; entering?: boolean; by?: 'cost' | 'rule' }
  | { kind: 'gainLife'; player: PlayerId; amount: number }
  | { kind: 'enter'; card: Card; tapped: boolean; counters: Record<string, number> }
  | { kind: 'begin'; player: PlayerId; what: 'extraTurn' | 'drawStep' }
  | { kind: 'none'; was: ReplaceEvent };

/**
 * One replacement or prevention effect that would apply to an event: the event that happens
 * `instead` (614.1). Each applies at most once to an event and to whatever replaces it (614.5).
 */
export interface Replacement {
  instead: ReplaceEvent;
  /** What to call it when a player is asked, or in the log. Left out, its permanent's name. */
  name?: string;
  /**
   * Its place in the order of 616.1a-d: 0 a self-replacement effect (614.15), 1 one that
   * changes under whose control an object enters, 2 one that makes it enter as a copy, 3 one
   * that makes it enter with its back face up. One of the lowest there is must be applied
   * first. Left out, any order (616.1e).
   */
  tier?: 0 | 1 | 2 | 3;
  /**
   * "You may": `player` decides whether it is applied. `yes` and `no` label the choice, and
   * `text` asks it. A bot applies it unless `bot` is false.
   */
  optional?: { player: PlayerId; text: string; yes: string; no: string; bot?: boolean };
  /** It may apply again to the event it made (903.9b, an exception to 614.5). */
  again?: boolean;
  /** Logged when it is applied. */
  log?: { text: string; player: PlayerId; cards?: Card[] };
}

/**
 * A person chooses which of the replacement and prevention effects that would change an
 * event applies next (616.1), or whether to apply an optional one. Each option says what it
 * leads to. The action that was being carried out is done again with the answer once it is
 * given (`Game.replay`).
 */
export interface ReplacementChoice {
  player: PlayerId;
  text: string;
  options: { label: string; sub: string }[];
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
 *  number        - a player chooses a number (see `NumberChoice`)
 *  cast          - a player may cast a card while a spell resolves (see `CastChoice`)
 *  retarget      - a player may choose new targets for a spell or ability (see `RetargetChoice`)
 *  replacement   - a player chooses which replacement effect applies next, or whether an
 *                  optional one does (see `ReplacementChoice`)
 *  commanderZone - a player's commander was put into their graveyard or exile, and they
 *                  choose whether it goes to the command zone (903.9a).
 *                  `resume` is the player who gets priority afterwards.
 */
export type Decision =
  | { type: 'mulligan' | 'attackers' | 'blockers' | 'discard' }
  | { type: 'replacement'; ask: ReplacementChoice }
  | { type: 'targets'; item: StackItem; resume: PlayerId }
  /** A player chooses the modes of their modal triggered ability as it goes on the stack (603.3c). */
  | { type: 'triggerModes'; item: StackItem; resume: PlayerId }
  | { type: 'orderTriggers'; resume: PlayerId }
  | { type: 'chooseCards'; choice: CardChoice }
  | { type: 'ask'; choice: AskChoice }
  | { type: 'name'; choice: NameChoice }
  | { type: 'player'; choice: PlayerChoice }
  | { type: 'number'; choice: NumberChoice }
  | { type: 'cast'; choice: CastChoice }
  | { type: 'retarget'; choice: RetargetChoice }
  | { type: 'commanderZone'; card: string; resume: PlayerId }
  /** The active player divides combat damage for these attackers (510.1), in the first-strike step or the regular one (510.4). */
  | { type: 'assignDamage'; attackers: string[]; firstStrike: boolean };

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
  /** Set once a resolved spell or ability gives a permanent an effect that takes abilities away (`LayerParts.loseAll`, `lose`). */
  abilitiesLost?: true;
  /** A player who cast or activated with `hold`: auto-pass leaves them priority until they act again (117.3c). */
  holding: PlayerId | null;
  combat: Combat | null;
  winner: PlayerId | 'draw' | null;
  log: LogEntry[];
  rng: number;
  nextId: number;
  /**
   * The last spell cast, or ability activated or triggered (not a mana ability, which
   * doesn't use the stack, 605.3a), so the UI can flash its source on screen.
   */
  lastSpell: { seq: number; name: string; caster: PlayerId; ability?: 'triggered' | 'activated' } | null;
  /** Spells cast this turn by every player, for storm (702.40a). */
  spellsCast: number;
  /** Players dealt combat damage this turn. */
  combatDamaged: PlayerId[];
  /**
   * Additional beginning phases still to come after this turn's postcombat main phase (Sphinx
   * of the Second Sun, 500.8), and whether one is under way now: after it the turn goes on to
   * the next of them, or to the ending phase.
   */
  extraBeginnings?: number;
  inExtraBeginning?: boolean;
  /** Effects that last until end of turn (514.2). */
  effects: TurnEffect[];
  /** Delayed triggered abilities waiting for their moment (603.7). */
  delayed: Delayed[];
  /**
   * Cards an effect puts onto the battlefield at the same time, waiting for the choices their
   * own replacement effects ask for before any of them enters (614.12a, `enterTogether`).
   * `ready` are the cards whose way of entering is settled; `waiting` are the ids still asked.
   */
  /**
   * An action stopped partway to ask a person about replacement effects (616.1): which applies
   * next, or whether to apply an optional one. It is applied again from this state with
   * `answers`, plus the new one, once they answer. The decision and priority it stopped from
   * are restored first.
   */
  replay?: { action: Action; autoPass: boolean; stops?: unknown; fullControl?: PlayerId[]; answers: number[]; decision: Decision | null; priority: PlayerId };
  /**
   * The mana abilities (605.1a) the player with priority has used by hand since they last did
   * anything else, oldest first, each with the game as it was just before: so one can be
   * taken back whatever else it did (life paid, damage, a sacrifice, a discard, what it
   * triggered), with the ones used after it used again (`applyAction`'s `rewindMana`). A
   * convenience, not a rule (see docs/rules-coverage.md). A player's view keeps only which
   * cards can be taken back: the games before hold hidden cards.
   */
  manaRewind?: ManaRewind[];
  entering?: {
    id: string;
    ready: { id: string; moves: number; opts: object }[];
    /** Card ids whose choices are still asked, and `@order<player>` for a player choosing the timestamp order (613.7m). */
    waiting: string[];
    /** The players have been asked for the timestamp order already (613.7m). */
    ordered?: boolean;
  }[];
  /** Extra turns to take after this one. The last is taken first (500.7). */
  extraTurns: ExtraTurn[];
  /**
   * "Do this only once each turn" (603.2h): the turn each player last took an ability's
   * action, keyed by `did` in rules.ts. The ability doesn't trigger again that turn.
   */
  did?: Record<string, number>;
  /** Paradigm spells that have resolved, by player and name: only the first gives the copies (702.192a). */
  paradigms?: { player: PlayerId; name: string }[];
  /** The monarch (725.1), once an effect has made a player the monarch; null while there is none. */
  monarch?: PlayerId | null;
}

export type Action =
  /** `face`: the land face of a modal double-faced card to put onto the battlefield (712.12). */
  | { type: 'playLand'; card: string; face?: number }
  /** Plot (702.170a): a special action, paying the card's plot cost and exiling it from the hand. */
  | { type: 'plot'; card: string }
  /** `hold`: keep priority afterwards instead of letting auto-pass pass it (117.3c). */
  | ({ type: 'cast'; card: string; targets?: (TargetRef | null)[]; hold?: boolean } & CastChoices)
  /** `crew`: the creatures tapped to pay a crew cost (702.122a). */
  /**
   * `ability`: which loyalty ability (606) or Class level bar, by index. Left out, one of
   * the `activated` abilities: `activated` is its index in the list (left out, the first).
   */
  /** `discard`: the cards discarded to pay a "Discard a card" cost. `sacrifice`: the permanent for a "Sacrifice a creature" cost. */
  /** `x`: the value of X, for an ability with {X} or −X in its cost (107.3a). */
  /** `exile`: the permanent for an "Exile a creature you control" cost (The Soul Stone). */
  /** `graveyard`: the cards in its controller's graveyard exiled for an "Exile two cards from your graveyard" cost (Matoc). */
  /** `station`: the other creature tapped to pay a station cost (702.184a). */
  | { type: 'activate'; card: string; ability?: number; activated?: number; x?: number; targets?: (TargetRef | null)[]; hold?: boolean; crew?: string[]; discard?: string[]; sacrifice?: string[]; exile?: string[]; graveyard?: string[]; station?: string }
  /**
   * `ability`: which of its mana abilities (`manaAbilities`). Left out, the one that suits
   * the player best. `color`: the colour to make, for an ability with a choice. `mana`: the
   * exact mana to make, one of the ability's choices (a filter land's {U}{B}); it wins over `color`.
   */
  /** `tap`: the creature tapped to pay an ability's "Tap an untapped creature you control" cost (Relic of Legends). */
  /** `discard`: the card discarded to pay a "Discard a card" cost (Skirge Familiar). */
  /** `sacrifice`: the creature sacrificed to pay a "Sacrifice a creature" cost (Phyrexian Tower). */
  | { type: 'tapMana'; card: string; ability?: number; color?: ManaSym; mana?: ManaSym[]; tap?: string; discard?: string; sacrifice?: string }
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
  /** Answers a `replacement` decision: the index of the option chosen. */
  | { type: 'replacement'; option: number }
  /** Answers a `triggerModes` decision: the modes, as indexes in printed order (700.2). */
  | { type: 'chooseModes'; modes: number[] }
  /** Answers a `number` decision: the number, or null to choose none if it allows that. */
  | { type: 'chooseNumber'; n: number | null }
  /** Answers a `player` decision. */
  | { type: 'choosePlayer'; player: PlayerId }
  /** Answers `commanderZone`: true moves the commander to the command zone, false leaves it where it is. */
  | { type: 'commanderZone'; toCommand: boolean }
  /** Answers `assignDamage`: one assignment for each attacker it lists (510.1, 510.1e). */
  | { type: 'assignDamage'; assignments: DamageAssignment[] }
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
    /** A spell on the stack or a permanent (Sink into Stupor): `who` and `filter` apply to both. */
    | 'spell or permanent'
    /** A card in a graveyard (Sevinne's Reclamation). */
    | 'graveyard card';
  who?: 'you' | 'opponent' | 'any'; // whose permanent / which player
  /**
   * `x`: the X announced for the activated ability choosing the target (107.3a, 601.2b-c via
   * 602.2b), 0 for one without X, as in "target creature card with mana value X". A spell's
   * X is `source.cast.x`.
   */
  filter?: (g: Game, c: Card, source: Card, x: number) => boolean;
  /** For a spell or ability on the stack: whether `item` fits, like "with a single target" or "instant spell". */
  item?: (g: Game, item: StackItem, source: Card) => boolean;
  optional?: boolean; // "you may" / "up to one"
  /** Can't be the same as the target chosen for the spec at this index: "two target players" (115.3). */
  distinctFrom?: number;
  /**
   * "Any number of target ..." (115.1d): this spec, which must be the last, is repeated once for
   * each target chosen, none at all included, and each is a different object (115.3).
   */
  any?: boolean;
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
  /**
   * An activated ability's X, announced as it was activated (107.3a): its own, apart from
   * any other X of its source (107.3k). 0 for one without X. A spell reads `self.cast.x`.
   */
  x?: number;
  /** A modal triggered ability's chosen modes (603.3c), in printed order. */
  modes?: number[];
  /** A station ability's tapped creature (702.184a), as it was when the ability was activated (`StackItem.stationed`). */
  stationed?: Card;
  /** The mana spent to activate the ability, by source (`StackItem.spentFrom`). */
  spentFrom?: { source: string; name?: string }[];
}

/** What a static ability does to an object it applies to (611.3), by layer. */
export type StaticBonus = LayerParts;

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
  /** "Whenever this creature blocks": once each combat, however many it blocks (509.3a). */
  onBlock: object;
  onCombatDamageToPlayer: { player: PlayerId; amount: number };
  // Table-wide triggers: every permanent on the battlefield that defines one is asked.
  onCreatureEnters: { entered: Card };
  onCreatureDies: { dead: Card };
  /** A planeswalker that isn't also a creature dies (Cruel Celebrant). */
  onPlaneswalkerDies: { dead: Card };
  onCreatureAttacks: { attacker: Card; defender: PlayerId; target: string | null };
  /** `item`: the spell as it was cast, for "copy that spell" after it may have left the stack (707.10). */
  onCast: { card: Card; caster: PlayerId; item: StackItem };
  /** A spell is copied (707.10): magecraft's "whenever you cast or copy an instant or sorcery spell" (207.2c). `controller` controls the copy. */
  onCopy: { card: Card; controller: PlayerId };
  onDraw: { player: PlayerId };
  onLifeGain: { player: PlayerId; amount: number };
  /** A player loses life: from damage (119.2), paying it (119.4), or an effect (119.3). */
  onLifeLoss: { player: PlayerId; amount: number };
  /**
   * A source deals damage (120): to a player, or to a permanent (`card`, as it was then).
   * `source` is as it was as it dealt the damage. Prevented damage isn't dealt (615).
   */
  onDamage: { source: Card; player: PlayerId | null; card: Card | null; amount: number; combat: boolean };
  /**
   * "Whenever a source deals damage": once for each source in each event (Matoc), with every
   * player and permanent it dealt damage to then and how much. `source` is as it dealt it.
   */
  onSourceDamage: { source: Card; dealt: { player: PlayerId | null; card: Card | null; amount: number }[]; combat: boolean };
  /** "Whenever one or more players lose life": once for each event, with everyone who lost life in it. */
  onLifeLossTogether: { losses: { player: PlayerId; amount: number }[] };
  /**
   * A card (not a token or a copy of a spell) is put into its owner's graveyard from
   * anywhere. Not a leaves-the-battlefield ability, so it doesn't look back in time (603.6c).
   */
  onCardToGraveyard: { card: Card; player: PlayerId };
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
  /** "At the beginning of your precombat main phase" (505.1), also called your first main phase. */
  onPrecombatMain: { player: PlayerId };
  /** "At the beginning of your draw step", after the draw (504.2). */
  onDrawStep: { player: PlayerId };
  /** "Whenever you discard a card." `card` is the discarded card, now in its owner's graveyard. */
  onDiscard: { card: Card; player: PlayerId };
  /** "Whenever a player sacrifices a permanent." `card` is the permanent as it last was; `player` sacrificed it. */
  onSacrifice: { card: Card; player: PlayerId };
  /** Ward (702.21a), which the engine resolves. `item` is the spell or ability to counter unless its controller pays. */
  onWard: { item: string; cost: WardCost };
  /** Madness's "When this card is exiled this way" (702.35a): the card in exile. */
  onMadness: object;
  /** Miracle's "When you reveal this card this way" (702.94a): the card in hand. */
  onMiracle: object;
  /** Suspend's "At the beginning of your upkeep, if this card is suspended, remove a time counter from it" (702.62a). */
  onSuspendUpkeep: object;
  /** Suspend's "When the last time counter is removed from this card, if it's exiled, you may play it" (702.62a). */
  onSuspendCast: object;
  /** "Whenever [a permanent] enters": every permanent, creature or not, as it was as it entered. */
  onPermanentEnters: { entered: Card };
  /**
   * "Whenever one or more cards are put into exile from graveyards and/or the battlefield"
   * (Ketramose): once for each event, with the cards (not tokens, 108.2b) as they are in exile.
   * It looks back in time for permanents that left the battlefield (603.10a).
   */
  onExiled: { cards: Card[] };
  /** "When this leaves the battlefield" (603.6c): it looks back in time (603.10a). `to`: the zone it went to. */
  onLeave: { to: Zone };
  /** "Whenever [a permanent] leaves the battlefield": `left` is as it last was there (603.10a). */
  onPermanentLeaves: { left: Card; to: Zone };
  /** "Whenever a player searches their library" (701.23): once for each search, however many cards it finds. */
  onSearch: { player: PlayerId };
  /** "Whenever [creatures] attack": once, after attackers are declared (508.1m), with every attack. */
  onAttackersDeclared: { player: PlayerId; attacks: { attacker: Card; defender: PlayerId; target: string | null }[] };
  /** "Whenever [a permanent] becomes the target of a spell or ability" (Monk Gyatso). `item` is that spell or ability. */
  onBecomesTarget: { target: Card; item: string };
  /** "Whenever one or more [kind] counters are put on this" (122.6): `n` of them at once. */
  onCounters: { kind: string; n: number };
  /** A reflexive triggered ability (603.12): the script's `reflexive[key]` runs. */
  onReflexive: { key: string; data: Record<string, unknown> };
  /** Evoke's "When this permanent enters, if its evoke cost was paid, its controller sacrifices it" (702.74a). */
  onEvoked: object;
  /** Offspring's "When this permanent enters, if its offspring cost was paid, create a 1/1 token copy of it" (702.175a). */
  onOffspring: object;
  /**
   * "Whenever you waterbend, earthbend, firebend, or airbend" (Avatar Aang): a player bent, as
   * each keyword says it triggers (701.65b, 701.66b, 701.67c, 702.189b).
   */
  onBend: { player: PlayerId; kind: Bend };
  /** "Whenever you roll a 4 or higher" (706): one die rolled by `player`, its natural result and its result after modifiers (706.2). */
  onRoll: { player: PlayerId; sides: number; natural: number; result: number };
  /**
   * "Whenever one or more [creatures] deal combat damage to a player": once for each player dealt
   * combat damage in a combat damage step (510.2, 603.2c), with the creatures that dealt it, as they were.
   */
  onPlayerCombatDamaged: { player: PlayerId; sources: Card[]; amount: number };
  /**
   * The monarch's inherent triggered abilities (725.2), which have no source: `draw` is "At the
   * beginning of the monarch's end step, that player draws a card"; `take` is "Whenever a creature
   * deals combat damage to the monarch, its controller becomes the monarch", with that creature.
   */
  onMonarch: { what: 'draw' } | { what: 'take'; creature: Card };
  /**
   * Earthbend's delayed triggered ability (701.66a, 603.7): "When that land dies or is put into
   * exile, return it to the battlefield tapped under your control". `id` and `moves` name the card as it is now.
   */
  onEarthbent: { id: string; moves: number };
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
 * are chosen as it goes on the stack (603.3d); a lone `onEnter` ability uses `CardScript.targets`.
 * `text` names the ability on the stack and when ordering triggers; left out, `when` means
 * it triggers on every event.
 */
export type Trigger<E> =
  | ((g: Game, e: Ctx & E) => void)
  | {
      when?: (g: Game, e: { self: Card } & E) => boolean;
      resolve: (g: Game, e: Ctx & E) => void;
      targets?: TargetSpec[];
      text?: string;
      /**
       * A modal triggered ability, "choose one or more —" (700.2): `min` to `max` modes,
       * chosen as it goes on the stack (603.3c), each with its own targets. `resolve` reads
       * `ctx.modes`. `bot`: the modes a bot chooses.
       */
      modes?: {
        min: number;
        max: number;
        modes: Mode[];
        bot?: (g: Game, pid: PlayerId, self: Card) => number[];
        /** "Choose one that hasn't been chosen this turn" (Monument to Endurance): a mode its source chose this turn can't be chosen again. */
        oncePerTurn?: boolean;
      };
    };

/**
 * A hook holds one triggered ability, or a list when the card has several for the same
 * kind of event (Dragon Tempest's two "enters" abilities). Each triggers on its own (603.2).
 * In a list, every ability names its own `targets`, `onEnter` ones too.
 */
type Triggers = { [H in TriggerHook]?: Trigger<TriggerEvents[H]> | Trigger<TriggerEvents[H]>[] };

/** One mode of a modal spell (700.2). */
export interface Mode {
  text: string;
  /** Spree (702.172a): the additional cost of choosing this mode. */
  cost?: string;
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
  /**
   * "Tap an untapped [legendary] creature you control" is its cost instead of {T} (Relic of
   * Legends). Summoning sickness doesn't matter: the creature's own {T} isn't used (302.6).
   */
  tapCreature?: { legendary?: boolean };
  /** "Discard your hand" is part of the cost (Lion's Eye Diamond). */
  discardHand?: boolean;
  /** "Activate only as an instant": only while its controller has priority. */
  instant?: boolean;
  /** "Spend this mana only to cast a creature spell of the chosen type" (the permanent's `chosen`). */
  chosenType?: boolean;
  /** "... and that spell can't be countered." */
  uncounterable?: boolean;
  /** "Spend this mana only to cast a legendary spell" (Plaza of Heroes). */
  legendary?: boolean;
  /** "Spend this mana only to cast instant and sorcery spells" (Tablet of Discovery): spells with one of these card types. */
  types?: string[];
  /** "Discard a card" is its cost (Skirge Familiar). Auto-pay never uses it: it costs a card. */
  discard?: number;
  /** "Sacrifice a creature" is part of its cost (Phyrexian Tower). Auto-pay never uses it: it costs a creature. */
  sacrificeCreature?: boolean;
  /**
   * Mana paid as part of its cost, like a Signet's "{1}, {T}" or a filter land's "{W/B}, {T}"
   * (605.1a: it is still a mana ability). That mana can't come from this ability itself.
   */
  cost?: string;
  /**
   * The exact mana it adds, when that isn't `amount` of one colour: one list, or a choice of
   * lists ("Add {W}{W}, {W}{B}, or {B}{B}"). `amount` and `colors` then describe it for display.
   */
  produces?: ManaSym[][];
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
  /** The number chosen, for a `number` choice (0 if none). */
  n: number;
  data: Record<string, unknown>;
}

/**
 * A planeswalker's loyalty ability (606): `cost` loyalty counters added (+) or removed (-).
 * `'-X'` removes X, chosen as it is activated (107.3a); the resolve reads `ctx.x`.
 */
export interface LoyaltyAbility {
  cost: number | '-X';
  text: string;
  targets?: TargetSpec[];
  resolve: (g: Game, ctx: Ctx) => void;
}

/**
 * An activated ability (602): "[cost]: [effect]". Build equip with `equip(cost)` and crew
 * with `crew(n)`. `crew` in the cost means tapping other untapped creatures with that much
 * total power (702.122a). `sorcery` limits it to sorcery timing, like equip (702.6a).
 * {X} in `cost.mana` is announced as it is activated and paid as generic mana (107.3a,
 * 107.4b); the resolve reads `ctx.x`.
 */
export interface ActivatedAbility {
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
    /** "Discard a creature card" (Tortured Existence): only cards that fit can be discarded for `discard`. */
    discardFilter?: (g: Game, c: Card) => boolean;
    discardSelf?: boolean;
    counters?: { kind: string; n: number };
    /** "Sacrifice a creature:": one permanent its controller controls that fits, chosen as it is activated. */
    sacrificeOne?: TargetSpec;
    /** "Sacrifice two other artifacts and/or creatures" (Mondrak): how many different ones fit `sacrificeOne`. One if left out. */
    sacrificeCount?: number;
    /** "Spend only black mana on X" (Crypt Rats): each X in `mana` is paid with mana of this colour. */
    xColor?: ManaSym;
    /** "Exile this [permanent]" (Relic of Progenitus). */
    exileSelf?: boolean;
    /** "Exile a creature you control:": one permanent its controller controls that fits, chosen as it is activated. */
    exileOne?: TargetSpec;
    /** "Exile two cards from your graveyard" (Matoc): that many cards from its controller's graveyard, chosen as it is activated. */
    exileGraveyard?: number;
    /** Station (702.184a): "Tap another untapped creature you control", chosen as it is activated; the resolve reads it as `ctx.stationed`. */
    station?: boolean;
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
}

/** Names one of a card's activated abilities: a loyalty ability or Class level bar (`ability`), or one of its `activated` list. */
export interface AbilityRef {
  ability?: number;
  activated?: number;
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
  /**
   * The continuous effects this permanent's static abilities have on permanent `c` (611.3),
   * which may be itself: null where they don't apply. A list holds one entry for each
   * ability, in printed order, each its own effect. They share the permanent's timestamp
   * (613.7a). The engine asks again in each layer until an effect starts to apply, with `c` as
   * it is at that point, then keeps the same set of objects for the effect's later layers
   * (613.6): "creatures you control get +1/+1" checks `isCreature` after layer 4's effects.
   */
  static?: (g: Game, self: Card, c: Card) => StaticBonus | (StaticBonus | null)[] | null;
  /** A characteristic-defining ability that defines power and toughness (604.3, 613.4a), e.g. Nightmare's. */
  basePT?: (g: Game, self: Card) => { power: number; toughness: number };
  /** Generic mana this spell costs less. */
  costReduction?: (g: Game, self: Card) => number;
  /**
   * While this permanent is on the battlefield, generic mana that `spell` costs more
   * (positive) or less (negative), e.g. "noncreature spells cost {1} more" (601.2f).
   */
  costModifier?: (g: Game, self: Card, spell: Card, caster: PlayerId, from: Zone | 'stack') => number;
  /**
   * While this permanent is on the battlefield: coloured or colourless mana `spell` costs less,
   * as a mana string ("{W}{U}{B}{R}{G}", Aang, Master of Elements), or null. Each symbol takes
   * off one mana of its type from the cost, or one generic mana if the cost has none of that
   * type left (118.7b-d).
   */
  reducesCost?: (g: Game, self: Card, spell: Card, caster: PlayerId, from: Zone | 'stack') => string | null;
  /**
   * While this permanent is on the battlefield: how many more lands `pid` may play on each of
   * their turns (305.2b): Exploration's "You may play an additional land on each of your turns".
   */
  extraLands?: (g: Game, self: Card, pid: PlayerId) => number;
  /** "This token crews Vehicles as though its power were 2 greater" (Pilot tokens): how much more power it crews with (702.122a). */
  crewBonus?: (g: Game, self: Card, vehicle: Card) => number;
  /** Kicker (702.33): an optional additional cost. `multi` is multikicker, paid any number of times (702.33c). */
  kicker?: { mana: string; multi?: boolean };
  /**
   * Offspring (702.175a): the optional additional cost. If it was paid, when the permanent
   * enters, its controller creates a 1/1 token copy of it.
   */
  offspring?: string;
  /**
   * "Deals [N] damage divided as you choose among [targets]" (601.2d): the amount divided, a
   * number or X. The division is announced as it is cast (`CastChoices.divide`); the script
   * reads `self.cast.divide`.
   */
  divide?: number | 'x';
  /**
   * "As an additional cost to cast this spell, ..." (118.8), paid with the mana cost.
   * `sacrifice`: a permanent that fits the spec; `optional`, the caster may sacrifice one,
   * as bargain says (702.166a). `discard`: that many other cards from the caster's hand.
   * `life`: that much life (119.4), or `'x'` for "pay X life", X announced as it is cast
   * (601.2b, 107.3a) and kept in `CastInfo.x`.
   */
  additionalCost?: {
    sacrifice?: TargetSpec;
    optional?: boolean;
    discard?: number;
    life?: number | 'x';
    /**
     * "Pay 5 life or pay {2}" (Redirect Lightning), "discard a card or pay 3 life" (Bitter
     * Triumph): the caster pays one of these, chosen as it is cast (`CastChoices.extra`).
     */
    oneOf?: { label: string; mana?: string; life?: number; discard?: number }[];
  };
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
    /** Overload (702.96a): "target" becomes "each", so the spell has no targets (702.96b). */
    overload?: boolean;
    /** Evoke (702.74a): its controller sacrifices the permanent when it enters. */
    evoke?: boolean;
    /** Warp (702.185a): only from the hand; the permanent is exiled at the next end step. */
    warp?: boolean;
    /** Impending N (702.176a): the permanent enters with N time counters and isn't a creature while it has one. See `impending`. */
    impending?: number;
    /** Madness or miracle (702.35a, 702.94a): only when that ability's trigger lets its owner cast it. See `madness`, `miracle`. */
    via?: CastVia;
  }[];
  /**
   * While this permanent is on the battlefield: a replacement effect that changes how much
   * damage `source` would deal to a player or permanent (614.1a): it deals double (`times: 2`,
   * Furnace of Rath) or that much plus N (`plus`, Torbran). Null if it doesn't apply. Like
   * every replacement effect, it is applied by `replace` (replace.ts): when several apply, the
   * player being dealt damage, or the permanent's controller, chooses the order (616.1).
   */
  changesDamage?: (g: Game, self: Card, source: Card, to: { player?: PlayerId; card?: Card }, combat: boolean) => DamageChange | null;
  /**
   * An Aura's enchant ability (702.5): what it can be attached to. It is also the Aura
   * spell's target (303.4a). Its `who` is from the Aura's controller's side. A `'graveyard
   * card'` one enchants a card in a graveyard (Animate Dead).
   */
  enchant?: TargetSpec;
  /**
   * An enchant ability one of its effects gives it (`LayerParts.enchantOf`), like Animate
   * Dead's "enchant creature put onto the battlefield with this Aura". Its `filter` gets the Aura as `source`.
   */
  givesEnchant?: TargetSpec;
  /**
   * Its activated abilities (602): one, or a list in printed order when it has several
   * (Deathrite Shaman). An action or stack item names one by its index (`activated`).
   */
  activated?: ActivatedAbility | ActivatedAbility[];
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
  /** While this permanent is on the battlefield: how much it changes `pid`'s maximum hand size (402.2), like "Each opponent's maximum hand size is reduced by seven". */
  handSize?: (g: Game, self: Card, pid: PlayerId) => number;
  /**
   * Continuations: what happens after a choice made partway through resolving (608.2d).
   * A choice names one with `then`; the resolving spell or ability's script runs it.
   */
  then?: Record<string, (g: Game, ctx: ThenCtx) => void>;
  /** Reflexive triggered abilities this card creates (603.12), by key: their targets and what they do. */
  reflexive?: Record<string, { targets?: TargetSpec[]; text?: string; resolve: (g: Game, ctx: Ctx & { data: Record<string, unknown> }) => void }>;
  /** Plot (702.170a): its plot cost. Its owner may pay it and exile the card from their hand, as a sorcery; it becomes plotted. */
  plot?: string;
  /** Escape (702.138a) printed on the card: cast from its owner's graveyard for `mana` plus exiling `exile` other cards from there. */
  escape?: { mana: string; exile: number };
  /** While this permanent is on the battlefield: does creature spell `spell` cast by `caster` have convoke (702.51a)? */
  grantsConvoke?: (g: Game, self: Card, spell: Card, caster: PlayerId) => boolean;
  /** While this permanent is on the battlefield: may `pid` spend mana as though it were mana of any colour to activate an ability of `source` (Agatha's Soul Cauldron)? */
  anyColorFor?: (g: Game, self: Card, pid: PlayerId, source: Card) => boolean;
  /**
   * While this permanent is on the battlefield: the replacement and prevention effects of its
   * static abilities (614, 615) that would apply to event `ev`, as the event that happens
   * instead (`Replacement.instead`), or null. Asked again as other effects change the event,
   * so it sees the event as changed so far (616.1f); each applies once (614.5). A general
   * effect doesn't apply to its own permanent entering (614.12). The hooks below for one kind
   * of event (`changesDamage`, `preventsDamage`, `entersTappedFor`, `skipDrawStep`,
   * `skipsExtraTurn`) are shorthand for this.
   * "If one or more tokens would be created under your control, twice that many of those tokens are created instead":
   *   replaces: (g, self, ev) => ev.kind === 'tokens' && ev.player === self.controller
   *     ? { instead: { ...ev, tokens: ev.tokens.map((t) => ({ ...t, count: t.count * 2 })) } } : null
   */
  replaces?: (g: Game, self: Card, ev: ReplaceEvent) => Replacement | Replacement[] | null;
  /** While this permanent is on the battlefield: does `pid` skip the extra turn they would begin (614.10, Trouble in Pairs)? */
  skipsExtraTurn?: (g: Game, self: Card, pid: PlayerId) => boolean;
  /** "No more than N creatures can attack this permanent each combat": a restriction on declaring attackers (508.1c). */
  maxAttackers?: number;
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
  /** "Exile [this spell]" as the last part of its resolving, instead of going to the graveyard (608.2n): Teferi's Protection. */
  exilesItself?: boolean;
  /** While this permanent is on the battlefield: can't `spell`, cast by `caster`, be countered? */
  protectsSpell?: (g: Game, self: Card, spell: Card, caster: PlayerId) => boolean;
  /** While this permanent is on the battlefield: does `pid` keep mana `m` as steps and phases end (500.5)? "You don't lose unspent red mana" (Electro). */
  keepsMana?: (g: Game, self: Card, pid: PlayerId, m: Mana) => boolean;
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
  /**
   * While this permanent is on the battlefield: is damage `source` would deal to this
   * player or permanent prevented (615)? "Prevent all damage that would be dealt to you."
   */
  preventsDamage?: (g: Game, self: Card, source: Card, to: { player?: PlayerId; card?: Card }) => boolean;
  /**
   * While this permanent is on the battlefield: does permanent `c` untap during another
   * player's untap step (502.3)? "Untap all artifacts you control during each other
   * player's untap step." `active` is the player whose untap step it is.
   */
  untapsOthersTurn?: (g: Game, self: Card, c: Card, active: PlayerId) => boolean;
  /** While this permanent is on the battlefield: does permanent `c` enter tapped (614.1c)? "Artifacts and creatures your opponents control enter tapped." */
  entersTappedFor?: (g: Game, self: Card, c: Card) => boolean;
  /** Triggered abilities this card gives other permanents (see `GrantedTrigger`). */
  grants?: GrantedTrigger[];
  /**
   * One of its static abilities can make permanents lose abilities (`LayerParts.loseAll` or
   * `lose`), like Humility's. The engine skips working out who lost what while no permanent
   * on the battlefield has such an ability or effect, so it must say so: the layer system
   * throws if a static ability without it removes abilities.
   */
  removesAbilities?: boolean;
  /**
   * While this permanent is on the battlefield: is it a Roaming Throne for `source`'s ability
   * on `hook`? "If a triggered ability of [a permanent] triggers, it triggers an additional time" (603.2d).
   */
  doublesTriggers?: (g: Game, self: Card, source: Card, hook: TriggerHook) => boolean;
  /** While this permanent is on the battlefield: does `source`'s ability on `hook` not trigger at all? "Permanents entering don't cause abilities of permanents your opponents control to trigger." */
  suppressesTriggers?: (g: Game, self: Card, source: Card, hook: TriggerHook) => boolean;
  /** While this permanent is on the battlefield: does player `pid` have protection from `source` (702.16)? "You ... have protection from the chosen card type." */
  protectsPlayer?: (g: Game, self: Card, pid: PlayerId, source: Card) => boolean;
  /** While this permanent is on the battlefield: does player `pid` have shroud (702.18a)? "You have shroud." */
  givesShroud?: (g: Game, self: Card, pid: PlayerId) => boolean;
  /**
   * While this permanent is on the battlefield: the cost, if any, of `attacker` attacking
   * `defender` (or the planeswalker or battle `target`), like Propaganda's "{2} for each
   * creature ... attacking you" (508.1g). Null if it costs nothing.
   */
  attackTax?: (g: Game, self: Card, attacker: Card, defender: PlayerId, target: string | null) => string | null;
  /** Ward (702.21). */
  ward?: WardCost;
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
  /** Abilities that trigger while the card is in its owner's graveyard (Vivi's Persistence, Asgardian Inspiration), by hook. */
  fromGraveyard?: BroadcastHook[];
  /** Bot hint: should a bot activate this permanent's `activated` ability now? The look-ahead can't see what it is worth. */
  botActivate?: (g: Game, pid: PlayerId, self: Card, activated: number) => boolean;
}

/** Hooks that every permanent on the battlefield hears, not only the card the event is about. */
export type BroadcastHook = Exclude<
  TriggerHook,
  'onEnter' | 'onDies' | 'onAttack' | 'onBlock' | 'onCombatDamageToPlayer' | 'onDefeat' | 'onChapter' | 'onLevel' | 'onStorm' | 'onDelayed' | 'onTapped' | 'onWard' | 'onMadness' | 'onMiracle' | 'onSuspendUpkeep' | 'onSuspendCast' | 'onLeave' | 'onCounters' | 'onReflexive' | 'onEvoked' | 'onOffspring' | 'onMonarch' | 'onEarthbent'
>;
