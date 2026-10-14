import { create } from 'zustand';
import { applyAction, applyBotAction, newGame } from '../engine';
import type { Action, Game, PlayerId, TargetRef, TargetSpec, Zone } from '../engine';

/**
 * A spell or ability the human is part-way through. `cast` and `activate` are proposals
 * (601.2): targets are chosen first, then the cost is paid, and until it is paid nothing
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
  attackTarget: PlayerId | null;
  pickedBlocker: string | null;
  hover: Hover | null;
  /** Card ids in the order the human arranged their hand. Display only: the engine never sees it. */
  handOrder: string[];
  viewer: { pid: PlayerId; zone: Zone } | null;
  showLog: boolean;
  /** The "leave this game?" dialog is open. */
  confirmExit: boolean;
  speed: number;
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
  attackTarget: null,
  pickedBlocker: null,
  hover: null,
  handOrder: [],
  viewer: null,
  showLog: true,
  confirmExit: false,
  speed: 1,

  start: (deck) =>
    set({
      game: newGame({ seed: (Math.random() * 2 ** 31) | 0, humanDeck: deck }),
      gameNo: get().gameNo + 1,
      human: deck === null ? null : 0,
      targeting: null,
      attackTarget: null,
      pickedBlocker: null,
      hover: null,
      handOrder: [],
      viewer: null,
      confirmExit: false,
    }),

  quit: () => set({ game: null, hover: null, targeting: null, viewer: null, confirmExit: false }),

  act: (a) => {
    const g = get().game;
    if (!g) return false;
    const next = applyAction(g, a);
    if (next === g) return false;
    // Declaring attackers/blockers and tapping for mana keep the current selection; anything else resets it.
    const mana = a.type === 'tapMana' || a.type === 'untapMana';
    const keep = mana || a.type.includes('declare');
    // A land is still under the pointer after it is tapped, so its preview stays up too.
    set({ game: next, ...(mana ? {} : { hover: null }), ...(keep ? {} : { targeting: null, pickedBlocker: null }) });
    return true;
  },

  botAct: (a) => {
    const g = get().game;
    if (g) set({ game: applyBotAction(g, a) });
  },
}));
