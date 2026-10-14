import { create } from 'zustand';
import { applyAction, applyBotAction, defaultStops, newGame } from '../engine';
import type { Action, ApplyOptions, AttackOption, CastChoices, Game, PlayerId, Step, StopKind, Stops, TargetRef, TargetSpec, Zone } from '../engine';

/**
 * A spell or ability the human is part-way through. `cast` and `activate` are proposals
 * (601.2): X, kicker and the alternative cost are announced first, then targets are
 * chosen, then anything to sacrifice, then the cost is paid. Until it is paid nothing
 * has reached the game. `trigger` is a triggered ability the game is already waiting on
 * for targets (see `targetingOf` in view.ts).
 */
export interface Targeting {
  mode: 'cast' | 'activate' | 'trigger';
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
  /** The loyalty ability being activated (606), by index, or undefined for the card's `activated` ability. */
  ability?: number;
  /** Still choosing which loyalty ability: targets come next. */
  pickingAbility?: boolean;
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
  showLog: boolean;
  /** The "leave this game?" dialog is open. */
  confirmExit: boolean;
  speed: number;
  /** Where the game stops for the human (seat 0), by whose turn it is. A UI preference passed to the engine. */
  stops: Stops;
  setStop: (turn: PlayerId, step: Step, kind: StopKind | undefined) => void;
  start: (deck: number | null) => void;
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
  showLog: true,
  confirmExit: false,
  speed: 1,
  stops: loadStops(),

  setStop: (turn, step, kind) => {
    const stops = get().stops.map((t, i) => (i === turn ? { ...t, [step]: kind } : t));
    if (!kind) delete stops[turn][step];
    saveStops(stops);
    set({ stops });
  },

  start: (deck) =>
    set({
      game: newGame({ seed: (Math.random() * 2 ** 31) | 0, humanDeck: deck, stops: deck === null ? {} : { 0: get().stops } }),
      gameNo: get().gameNo + 1,
      human: deck === null ? null : 0,
      targeting: null,
      attackTarget: null,
      pickedBlockers: [],
      hover: null,
      handOrder: [],
      viewer: null,
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
