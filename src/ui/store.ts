import { produce } from 'immer';
import { create } from 'zustand';
import { applyAction, applyBotAction, defaultStops, newGame } from '../engine';
import type { Action, ApplyOptions, AttackOption, CastChoices, Game, ManaSym, PlayerId, Step, StopKind, Stops, TargetRef, TargetSpec, Zone } from '../engine';
import { DECKS } from '../cards/db';
import type { DeckDef } from '../cards/db';
import { savedDeckIssues } from '../cards/decklist';

/**
 * A spell or ability the human is part-way through. `cast` and `activate` are proposals
 * (601.2): X, kicker and the alternative cost are announced first, then targets are
 * chosen, then anything to sacrifice, then the cost is paid. Until it is paid nothing
 * has reached the game. `trigger` is a triggered ability the game is already waiting on
 * for targets (see `targetingOf` in view.ts).
 */
export interface Targeting {
  /** `retarget`: new targets for a spell or ability the game is waiting on (115.7d). */
  mode: 'cast' | 'activate' | 'trigger' | 'retarget';
  cardId: string;
  specs: TargetSpec[];
  chosen: (TargetRef | null)[];
  /** Mana sources tapped by hand while paying, so cancelling can untap them again (733.1). */
  tapped: string[];
  /** What the human has announced for a spell so far (601.2b). */
  choices: CastChoices;
  /** Still announcing X, kicker or the alternative cost: targets come next. */
  announcing: boolean;
  /** Creatures picked to crew a Vehicle (702.122a), and whether the human is done picking. */
  crew?: string[];
  crewDone?: boolean;
  /** The loyalty ability (606) or Class level bar being activated, by index, or undefined for one of the card's `activated` abilities. */
  ability?: number;
  /** Which of the card's `activated` abilities, by index (left out, the first). */
  activated?: number;
  /** Still choosing which ability: targets come next. */
  pickingAbility?: boolean;
  /** The X announced for an ability with {X} or −X in its cost (107.3a), and whether the human is still choosing it: targets come next. */
  x?: number;
  choosingX?: boolean;
  /** Cards picked to discard for a "Discard a card" cost. */
  discard?: string[];
  /** The human chose not to pay an optional sacrifice, like bargain (702.166a). */
  sacrificeDone?: boolean;
}

const STOPS_KEY = 'arena-edh.stops';

/** The human's stops from the last session, or the defaults. Storage can be missing or blocked. */
function loadStops(): Stops {
  try {
    const saved = JSON.parse(localStorage.getItem(STOPS_KEY) ?? 'null');
    if (Array.isArray(saved) && saved.length === 4) return saved;
  } catch {
    // fall through to the defaults
  }
  return defaultStops(0);
}

function saveStops(stops: Stops) {
  try {
    localStorage.setItem(STOPS_KEY, JSON.stringify(stops));
  } catch {
    // stops just won't outlast the page
  }
}

const SETTINGS_KEY = 'arena-edh.settings';

/** Choices the human makes once, not every game. Each defaults to the automatic way. */
export interface Settings {
  /** Divide combat damage by hand when an attacker has a choice (510.1c, 702.19b). Off: split automatically. */
  manualDamage: boolean;
  /** The deck each bot seat plays, by deck id, one per opponent; null picks one automatically (see `seatDecks`). */
  opponents: (string | null)[];
}

const DEFAULT_SETTINGS: Settings = { manualDamage: false, opponents: [null, null, null] };

/** The human's settings from the last session, or the defaults. Storage can be missing or blocked. */
function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null');
    if (saved && typeof saved === 'object') {
      const opponents = DEFAULT_SETTINGS.opponents.map((_, i) => (typeof saved.opponents?.[i] === 'string' ? (saved.opponents[i] as string) : null));
      return { ...DEFAULT_SETTINGS, manualDamage: saved.manualDamage === true, opponents };
    }
  } catch {
    // fall through to the defaults
  }
  return DEFAULT_SETTINGS;
}

function saveSettings(settings: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // settings just won't outlast the page
  }
}

const DECKS_KEY = 'arena-edh.decks';

/**
 * Decks the human pasted, from the last session. A saved deck is kept even if a newer card
 * pool lacks one of its cards; the menu shows why it can't be played (`savedDeckIssues`).
 */
function loadDecks(): DeckDef[] {
  try {
    const saved = JSON.parse(localStorage.getItem(DECKS_KEY) ?? '[]');
    if (Array.isArray(saved)) {
      return saved.filter(
        (d): d is DeckDef =>
          d && typeof d.id === 'string' && typeof d.title === 'string' && Array.isArray(d.commanders) && Array.isArray(d.cards) && typeof d.basics === 'object',
      );
    }
  } catch {
    // fall through to none
  }
  return [];
}

function saveDecks(decks: DeckDef[]) {
  try {
    localStorage.setItem(DECKS_KEY, JSON.stringify(decks));
  } catch {
    // pasted decks just won't outlast the page
  }
}

/**
 * The deck in each seat: the human's in seat 0 (or a bot's, when watching), then one per
 * opponent. A seat set to a deck id plays that deck, even one another seat plays too: it's
 * the player's choice. An automatic seat (null, or a deck that has since been deleted)
 * takes the first built-in deck no seat has yet.
 */
export function seatDecks(human: DeckDef | null, opponents: (string | null)[], saved: DeckDef[], playable = (_: DeckDef) => true): DeckDef[] {
  const all = [...DECKS, ...saved].filter(playable);
  const picked = [human, ...opponents.map((id) => all.find((d) => d.id === id) ?? null)];
  const used = new Set(picked.flatMap((d) => (d ? [d.id] : [])));
  return picked.map((d) => {
    if (d) return d;
    const next = DECKS.find((x) => !used.has(x.id)) ?? DECKS[0];
    used.add(next.id);
    return next;
  });
}

export interface Hover {
  name: string;
  el: HTMLElement;
}

interface Store {
  game: Game | null;
  /** Counts games started. The game screen is keyed on it, so a new game starts with fresh UI state. */
  gameNo: number;
  /** Seat the human controls, or null when watching four bots. */
  human: PlayerId | null;
  targeting: Targeting | null;
  /** Keep priority after the spell or ability being paid for, to respond to it yourself (117.3c). One use. */
  hold: boolean;
  /** What the human's attackers go after: an opponent, or a planeswalker or battle (508.1b). */
  attackTarget: AttackOption | null;
  /** Blockers the human picked that could block more than one attacker: the next attacker they click gets them all. */
  pickedBlockers: string[];
  hover: Hover | null;
  /** Card ids in the order the human arranged their hand. Display only: the engine never sees it. */
  handOrder: string[];
  viewer: { pid: PlayerId; zone: Zone } | null;
  /** A mana ability with a choice of colour that the human is about to use, like Lion's Eye Diamond's. */
  colorPick: { cardId: string; ability: number; colors: ManaSym[] } | null;
  showLog: boolean;
  /** The "leave this game?" dialog is open. */
  confirmExit: boolean;
  speed: number;
  /** Where the game stops for the human (seat 0), by whose turn it is. A UI preference passed to the engine. */
  stops: Stops;
  setStop: (turn: PlayerId, step: Step, kind: StopKind | undefined) => void;
  settings: Settings;
  /** Changes a setting, saves it, and applies it to the game in progress. */
  setSetting: (change: Partial<Settings>) => void;
  /** Starts a game with the human playing `deck`, or four bots when null. The opponents come from the settings. */
  start: (deck: DeckDef | null) => void;
  /** The deck the human played in the last game started, for Play Again. */
  deck: DeckDef | null;
  /** Decks the human pasted, saved in the browser. */
  savedDecks: DeckDef[];
  saveDeck: (deck: DeckDef) => void;
  deleteDeck: (id: string) => void;
  quit: () => void;
  act: (a: Action) => boolean;
  botAct: (a: Action) => void;
}

export const useStore = create<Store>()((set, get) => ({
  game: null,
  gameNo: 0,
  human: null,
  targeting: null,
  hold: false,
  attackTarget: null,
  pickedBlockers: [],
  hover: null,
  handOrder: [],
  viewer: null,
  colorPick: null,
  showLog: true,
  confirmExit: false,
  speed: 1,
  stops: loadStops(),
  settings: loadSettings(),
  deck: null,
  savedDecks: loadDecks(),

  setStop: (turn, step, kind) => {
    const stops = get().stops.map((t, i) => (i === turn ? { ...t, [step]: kind } : t));
    if (!kind) delete stops[turn][step];
    saveStops(stops);
    set({ stops });
  },

  setSetting: (change) => {
    const settings = { ...get().settings, ...change };
    saveSettings(settings);
    const { game, human } = get();
    // The game keeps the setting on the human's player, where the engine reads it.
    const next = game && human !== null ? produce(game, (d) => void (d.players[human].manualDamage = settings.manualDamage)) : game;
    set({ settings, game: next });
  },

  saveDeck: (deck) => {
    const savedDecks = [...get().savedDecks.filter((d) => d.id !== deck.id), deck];
    saveDecks(savedDecks);
    set({ savedDecks });
  },

  deleteDeck: (id) => {
    const savedDecks = get().savedDecks.filter((d) => d.id !== id);
    saveDecks(savedDecks);
    set({ savedDecks });
  },

  start: (deck) =>
    set({
      game: newGame({
        seed: (Math.random() * 2 ** 31) | 0,
        humanDeck: deck === null ? null : 0,
        decks: seatDecks(deck, get().settings.opponents, get().savedDecks, (d) => savedDeckIssues(d).length === 0),
        stops: deck === null ? {} : { 0: get().stops },
        manualDamage: get().settings.manualDamage,
      }),
      gameNo: get().gameNo + 1,
      human: deck === null ? null : 0,
      deck,
      targeting: null,
      attackTarget: null,
      pickedBlockers: [],
      hover: null,
      handOrder: [],
      viewer: null,
      colorPick: null,
      confirmExit: false,
    }),

  quit: () => set({ game: null, hover: null, targeting: null, viewer: null, confirmExit: false }),

  act: (a) => {
    const g = get().game;
    if (!g) return false;
    const next = applyAction(g, a, engineOptions());
    if (next === g) return false;
    // Declaring attackers/blockers and tapping for mana keep the current selection; anything else resets it.
    const mana = a.type === 'tapMana' || a.type === 'untapMana';
    const keep = mana || a.type.includes('declare');
    // A land is still under the pointer after it is tapped, so its preview stays up too.
    set({ game: next, ...(mana ? {} : { hover: null }), ...(keep ? {} : { targeting: null, pickedBlockers: [] }) });
    return true;
  },

  botAct: (a) => {
    const g = get().game;
    if (g) set({ game: applyBotAction(g, a, engineOptions()) });
  },
}));

/** The human's stops go to the engine with every action, bots' included: those decide when the human is asked too. */
function engineOptions(): ApplyOptions {
  const { human, stops } = useStore.getState();
  return { stops: human === null ? {} : { [human]: stops } };
}
