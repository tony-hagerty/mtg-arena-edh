/**
 * Replacement and prevention effects (614, 615), and how they interact (616).
 *
 * Code about to carry out an event that such effects can change (damage, a card changing
 * zones, a draw, creating tokens, putting counters on a permanent, gaining life, a permanent
 * entering, beginning an extra turn or a draw step) describes it as a `ReplaceEvent` and asks
 * `replace` what happens instead. `replace` collects every effect that would apply:
 *  - the static abilities of permanents on the battlefield (`CardScript.replaces` and the
 *    shorthand hooks for one kind of event, like `changesDamage`);
 *  - rules that work as replacement effects: protection (702.16e), a finality counter
 *    (122.1h), flashback's and aftermath's exile (702.34a, 702.127a), a commander going to
 *    the command zone (903.9b), and what a permanent enters with (306.5b, 310.4b, 714.3a);
 *  - effects of resolved spells and abilities kept with the game: "If that spell would be put
 *    into your graveyard, exile it instead" (Emet-Selch), protection from everything.
 * It applies them one at a time, each at most once (614.5), seeing the event as changed so
 * far each time (616.1f, 616.2). When more than one could apply next, the affected player
 * chooses which (616.1), after any that must come first (616.1a-d). A person is asked only
 * when the choice changes what happens; a bot takes what is best for it.
 *
 * Asking a person partway through an action works by replaying it: `replace` throws
 * `NeedsChoice`, `applyAction` stores the question as a `replacement` decision, and once it is
 * answered applies the same action again from the same state with the answer. The game is
 * deterministic, so it gets back to the same question and uses the answer there.
 */
import { abilitiesOf, battlefield, counterCount, dredgeOf, isBattle, isPlaneswalker, isSaga, label, log, num, playerProtected, protectedFrom, says, data } from './rules';
import { hasOwnAbilities, withoutStatics } from './layers';
import type { Card, CardScript, Game, PlayerId, ReplaceEvent, Replacement, ReplacementChoice, Zone } from './types';

/**
 * Thrown out of `applyAction` when a person must make a choice about replacement effects
 * (616.1) partway through an action. The action is applied again, from the start, once they
 * answer.
 */
export class NeedsChoice {
  constructor(public choice: ReplacementChoice) {}
}

/** The answers to `NeedsChoice` questions for the action being applied, in the order they come up. Null: nobody can be asked (a bot's look-ahead). */
let answers: { list: number[]; used: number } | null = null;

/** Runs `fn` with these answers to replacement questions (`NeedsChoice`), or with nobody asked if null. */
export function withReplacementAnswers<T>(list: number[] | null, fn: () => T): T {
  const was = answers;
  answers = list ? { list, used: 0 } : null;
  try {
    return fn();
  } finally {
    answers = was;
  }
}

/**
 * Permanents being put onto the battlefield right now. The effects of one don't apply to
 * another's entering, or to its own if they are general (614.12): only effects that already
 * exist do.
 */
let arriving: Set<string> | null = null;

/** Runs `fn`, which sets up permanents `ids` as they enter the battlefield together (614.12). */
export function whileArriving<T>(ids: string[], fn: () => T): T {
  const was = arriving;
  arriving = new Set([...(was ?? []), ...ids]);
  try {
    return fn();
  } finally {
    arriving = was;
  }
}

/** Does this script have a static ability that is a replacement or prevention effect? */
const replacing = (s: CardScript) => !!(s.replaces || s.changesDamage || s.preventsDamage || s.entersTappedFor || s.skipDrawStep || s.skipsExtraTurn);

/** One effect that would apply to the event now: `id` tells it apart from the rest for 614.5. */
interface Found {
  id: string;
  name: string;
  r: Replacement;
}

const listOf = <T>(x: T | T[] | null | undefined): T[] => (Array.isArray(x) ? x : x ? [x] : []);

/** Is this event about a permanent as it enters (614.12)? */
const entering = (ev: ReplaceEvent) => ev.kind === 'enter' || (ev.kind === 'counters' && !!ev.entering);

/** Every replacement and prevention effect that would apply to `ev` as it is now. `from`: the permanents with such static abilities. */
function collect(g: Game, ev: ReplaceEvent, from: Card[]): Found[] {
  const out: Found[] = [];
  const add = (id: string, name: string, rs: Replacement | Replacement[] | null | undefined) =>
    listOf(rs).forEach((r, i) => out.push({ id: `${id}:${i}`, name: r.name ?? name, r }));
  for (const x of from) {
    if (entering(ev) && (arriving?.has(x.id) || (ev as { card: Card }).card.id === x.id)) continue;
    const s = abilitiesOf(g, x);
    const name = label(x);
    if (s.replaces) add(`${x.id}`, name, s.replaces(g, x, ev));
    if (ev.kind === 'damage') {
      const to = { player: ev.player, card: ev.card };
      const change = s.changesDamage?.(g, x, ev.source, to, ev.combat);
      if (change) add(`${x.id}~change`, name, { instead: { ...ev, amount: change.times !== undefined ? ev.amount * change.times : ev.amount + (change.plus ?? 0) } });
      if (s.preventsDamage?.(g, x, ev.source, to)) add(`${x.id}~prevent`, name, { instead: { ...ev, amount: 0 } });
    } else if (ev.kind === 'enter') {
      if (!ev.tapped && s.entersTappedFor?.(g, x, ev.card)) add(`${x.id}~tapped`, name, { instead: { ...ev, tapped: true } });
    } else if (ev.kind === 'begin') {
      // "Skip your draw step" (614.1b, 614.10).
      if (ev.what === 'drawStep' && s.skipDrawStep && x.controller === ev.player) {
        add(`${x.id}~skip`, name, { instead: { kind: 'none', was: ev }, log: { text: `${says(g.players[ev.player], 'skips')} ${g.players[ev.player].you ? 'your' : 'their'} draw step (${name}).`, player: ev.player, cards: [x] } });
      }
      if (ev.what === 'extraTurn' && s.skipsExtraTurn?.(g, x, ev.player)) {
        add(`${x.id}~skip`, name, { instead: { kind: 'none', was: ev }, log: { text: `${says(g.players[ev.player], 'skips')} an extra turn (${name}).`, player: ev.player, cards: [x] } });
      }
    }
  }
  builtIn(g, ev, add);
  return out;
}

/** Rules and resolved effects that replace or prevent events, besides permanents' static abilities. */
function builtIn(g: Game, ev: ReplaceEvent, add: (id: string, name: string, r: Replacement | null) => void) {
  switch (ev.kind) {
    case 'damage': {
      // Protection prevents damage from sources with the quality (702.16e). Protection from
      // everything on a player prevents all damage to them (702.16j).
      if (ev.card && protectedFrom(g, ev.card, ev.source)) add(`${ev.card.id}~protection`, `${label(ev.card)}'s protection`, { instead: { ...ev, amount: 0 } });
      if (ev.player !== undefined && playerProtected(g, ev.player)) add(`p${ev.player}~protection`, 'protection from everything', { instead: { ...ev, amount: 0 } });
      // Protection a permanent gives a player, like Serra's Emissary's "You ... have protection from the chosen card type" (702.16e).
      const pid = ev.player;
      if (pid !== undefined) for (const x of battlefield(g)) if (abilitiesOf(g, x).protectsPlayer?.(g, x, pid, ev.source)) add(`p${pid}~protection~${x.id}`, `protection from ${label(x)}`, { instead: { ...ev, amount: 0 } });
      return;
    }
    case 'move': {
      const c = ev.card;
      // "If this permanent would be put into a graveyard from the battlefield, exile it instead" (122.1h).
      if (c.zone === 'battlefield' && ev.to === 'graveyard' && counterCount(c, 'finality') > 0) {
        add(`${c.id}~finality`, 'its finality counter', { instead: { ...ev, to: 'exile' }, log: { text: `${label(c)} is exiled instead (finality counter).`, player: c.controller, cards: [c] } });
      }
      // A spell cast with flashback, or an aftermath half cast from a graveyard, is exiled
      // instead of going anywhere else as it leaves the stack (702.34a, 702.127a).
      if (c.zone === 'stack' && ev.to !== 'exile' && (c.cast?.flashback || c.cast?.exileOnLeave)) {
        add(`${c.id}~flashback`, c.cast.flashback ? 'flashback' : 'aftermath', { instead: { ...ev, to: 'exile' } });
      }
      // "If that spell would be put into your graveyard, exile it instead" (Emet-Selch, Vohar).
      if (c.zone === 'stack' && ev.to === 'graveyard' && c.cast?.graveyardToExile) {
        add(`${c.id}~toExile`, 'exiling it instead', { instead: { ...ev, to: 'exile' } });
      }
      // "If a commander would be put into its owner's hand or library from anywhere, its owner
      // may put it into the command zone instead" (903.9b). It may apply again to the same
      // event, an exception to 614.5.
      if (c.isCommander && (ev.to === 'hand' || ev.to === 'library')) {
        const owner = g.players[c.owner];
        add(`${c.id}~commander`, 'the command zone', {
          instead: { ...ev, to: 'command' },
          again: true,
          optional: {
            player: c.owner,
            text: `${label(c)} would be put into ${owner.you ? 'your' : `${owner.name}'s`} ${ev.to}. Put it into the command zone instead (903.9b)?`,
            yes: 'Command Zone',
            no: ev.to === 'hand' ? 'Hand' : 'Library',
          },
          log: { text: `${label(c)} goes to the command zone instead.`, player: c.owner, cards: [c] },
        });
      }
      return;
    }
    case 'draw': {
      // Dredge (702.52a): "As long as you have at least N cards in your library, if you would draw a
      // card, you may instead mill N cards and return this card from your graveyard to your hand."
      // Each card with dredge is its own effect, and its player chooses whether to apply it. With
      // fewer than N cards in the library it can't be used at all (702.52b).
      const p = g.players[ev.player];
      for (const c of p.graveyard) {
        const n = dredgeOf(g, c);
        if (n === null || p.library.length < n) continue;
        add(`${c.id}~dredge`, `${label(c)} (dredge ${n})`, {
          instead: { kind: 'dredge', player: ev.player, card: c, n },
          optional: { player: ev.player, text: `Dredge ${n}: mill ${n} cards and return ${label(c)} to your hand instead of drawing?`, yes: `Dredge ${label(c)}`, no: 'Draw', bot: false },
        });
      }
      return;
    }
    case 'enter': {
      const c = ev.card;
      // Its own abilities count only if it has them as it enters (614.12): it is on the
      // battlefield by now, so the effect of a Humility already there applies to it.
      // Static abilities of permanents entering with it don't exist yet as it enters.
      const [s, own] = withoutStatics([...(arriving ?? [])].filter((id) => id !== c.id), () => [abilitiesOf(g, c), hasOwnAbilities(g, c)] as const);
      // "This enters tapped" (614.1c), or "... unless ...", as it would be on the battlefield (614.12).
      const tapped = typeof s.entersTapped === 'function' ? s.entersTapped(g, c, c.controller) : !!s.entersTapped;
      if (tapped && !ev.tapped) add(`${c.id}~tapped`, label(c), { instead: { ...ev, tapped: true } });
      const more = (counters: Record<string, number>): ReplaceEvent => {
        const now = { ...ev.counters };
        for (const [kind, n] of Object.entries(counters)) now[kind] = (now[kind] ?? 0) + n;
        return { ...ev, counters: now };
      };
      // "This enters with [counters]" (614.1c).
      if (s.entersWith) add(`${c.id}~with`, label(c), { instead: more(s.entersWith) });
      // A planeswalker enters with its printed loyalty (306.5b), a battle with its printed
      // defense (310.4b), a Saga with a lore counter (714.3a): each an intrinsic ability that
      // is a replacement effect.
      if (own && isPlaneswalker(g, c)) add(`${c.id}~loyalty`, label(c), { instead: more({ loyalty: num(data(c).loyalty) }) });
      if (own && isBattle(g, c)) add(`${c.id}~defense`, label(c), { instead: more({ defense: num(data(c).defense) }) });
      if (isSaga(g, c) && s.chapters?.length) add(`${c.id}~lore`, label(c), { instead: more({ lore: 1 }) });
      return;
    }
    default:
      return;
  }
}

/** The player who chooses the order of the effects that would change `ev` (616.1): the affected player, or the affected object's controller. */
function affected(ev: ReplaceEvent): PlayerId {
  switch (ev.kind) {
    case 'damage':
      return ev.player ?? ev.card!.controller;
    case 'move':
    case 'counters':
    case 'enter':
      return ev.card.controller;
    case 'none':
      return affected(ev.was);
    default:
      return ev.player;
  }
}

/** The event that happens: damage, tokens, counters or life that comes to 0 doesn't happen at all (614.7a, 119.10). */
function settle(ev: ReplaceEvent): ReplaceEvent {
  switch (ev.kind) {
    case 'damage':
      return ev.amount > 0 ? ev : { kind: 'none', was: ev };
    case 'tokens': {
      const tokens = ev.tokens.filter((t) => t.count > 0);
      return tokens.length ? { ...ev, tokens } : { kind: 'none', was: ev };
    }
    case 'counters':
      return ev.n > 0 ? ev : { kind: 'none', was: ev };
    case 'gainLife':
      return ev.amount > 0 ? ev : { kind: 'none', was: ev };
    default:
      return ev;
  }
}

/** A key for what an event does, to tell apart outcomes that differ. */
const sig = (ev: ReplaceEvent): string =>
  ev.kind === 'none' ? 'none' : JSON.stringify(ev, (_k, v) => (v && typeof v === 'object' && 'owner' in v && 'zone' in v ? (v as Card).id : v));

/** How good an outcome is for player `pid`, for a bot choosing (and the order options are shown in). */
function worth(ev: ReplaceEvent, pid: PlayerId): number {
  const mine = (p: PlayerId) => (p === pid ? 1 : -1);
  switch (ev.kind) {
    case 'damage':
      return -ev.amount;
    case 'move':
      return ev.to === 'command' ? 1 : 0;
    case 'draw':
      return mine(ev.player);
    case 'tokens':
      return mine(ev.player) * ev.tokens.reduce((n, t) => n + t.count, 0);
    case 'counters':
      return mine(ev.card.controller) * (ev.counter === '-1/-1' || ev.counter === 'stun' ? -ev.n : ev.n);
    case 'gainLife':
      return mine(ev.player) * ev.amount;
    case 'enter':
      return (ev.tapped ? -1 : 0) + Object.values(ev.counters).reduce((n, k) => n + k, 0) / 100;
    case 'begin':
      return 1;
    // Dredging is the player's own choice (702.52a): a bot never takes it (`optional.bot`), so it counts as a draw.
    case 'dredge':
      return mine(ev.player);
    case 'none':
      return 0;
  }
}

/** Where a card would go, for a person reading about it. */
function zoneText(g: Game, c: Card, to: Zone, viewer: PlayerId): string {
  const owner = g.players[c.owner];
  const theirs = c.owner === viewer ? 'your' : `${owner.name}'s`;
  return to === 'command' ? 'the command zone' : to === 'battlefield' ? 'the battlefield' : to === 'exile' ? 'exile' : `${theirs} ${to}`;
}

/** What an event would do, for a question to `viewer`. */
function describe(g: Game, ev: ReplaceEvent, viewer: PlayerId): string {
  const who = (pid: PlayerId) => (pid === viewer ? 'you' : g.players[pid].name);
  switch (ev.kind) {
    case 'damage':
      return `${label(ev.source)} would deal ${ev.amount} damage to ${ev.player !== undefined ? who(ev.player) : label(ev.card!)}`;
    case 'move':
      return `${label(ev.card)} would be put into ${zoneText(g, ev.card, ev.to, viewer)}`;
    case 'draw':
      return `${who(ev.player)} would draw a card`;
    case 'tokens':
      return `${ev.tokens.map((t) => `${t.count} ${t.copy?.name ?? t.key}`).join(' and ')} token${ev.tokens.reduce((n, t) => n + t.count, 0) === 1 ? '' : 's'} would be created for ${who(ev.player)}`;
    case 'counters':
      return `${ev.n} ${ev.counter} counter${ev.n === 1 ? '' : 's'} would be put on ${label(ev.card)}`;
    case 'gainLife':
      return `${who(ev.player)} would gain ${ev.amount} life`;
    case 'enter':
      return `${label(ev.card)} would enter the battlefield`;
    case 'begin':
      return `${who(ev.player)} would begin ${ev.what === 'extraTurn' ? 'an extra turn' : `${ev.player === viewer ? 'your' : 'their'} draw step`}`;
    case 'dredge':
      return `${who(ev.player)} would mill ${ev.n} and return ${label(ev.card)} to ${ev.player === viewer ? 'your' : 'their'} hand`;
    case 'none':
      return describe(g, ev.was, viewer);
  }
}

/** What an outcome comes to, in a few words, for an option's label. */
function outcome(g: Game, ev: ReplaceEvent, viewer: PlayerId): string {
  switch (ev.kind) {
    case 'damage':
      return `${ev.amount} damage`;
    case 'move':
      return zoneText(g, ev.card, ev.to, viewer);
    case 'draw':
      return `${ev.player === viewer ? 'you draw' : `${g.players[ev.player].name} draws`}`;
    case 'tokens':
      return ev.tokens.map((t) => `${t.count} ${t.copy?.name ?? t.key}`).join(', ');
    case 'counters':
      return `${ev.n} ${ev.counter} counter${ev.n === 1 ? '' : 's'}`;
    case 'gainLife':
      return `${ev.amount} life`;
    case 'enter': {
      const counters = Object.entries(ev.counters).map(([k, n]) => `${n} ${k}`);
      return [ev.tapped ? 'tapped' : 'untapped', ...(counters.length ? [`with ${counters.join(', ')}`] : [])].join(' ');
    }
    case 'begin':
      return 'it happens';
    case 'dredge':
      return `dredge ${label(ev.card)}: mill ${ev.n}, it returns to hand`;
    case 'none':
      return ev.was.kind === 'damage' ? 'no damage' : ev.was.kind === 'begin' ? 'skipped' : 'nothing';
  }
}

/**
 * Asks player `pid` a question about replacement effects (616.1). A bot, or anyone when
 * nobody can be asked, takes `botPick`. A person's answer comes from the answers the action is
 * being replayed with; with none left, the action stops to ask them (`NeedsChoice`).
 */
function choose(g: Game, choice: ReplacementChoice, botPick: number): { pick: number; asked: boolean } {
  if (g.players[choice.player].isBot || !answers) return { pick: botPick, asked: false };
  const a = answers.list[answers.used];
  if (a === undefined) throw new NeedsChoice(choice);
  answers.used++;
  return { pick: choice.options[a] ? a : botPick, asked: true };
}

/** A way to go on from an event: apply effect `f` (`apply` true), turn it down (false), or let its own player decide (undefined, 616.1). */
interface Branch {
  f: Found;
  apply: boolean | undefined;
}

/**
 * Applies to `ev` every replacement and prevention effect that applies to it (614, 615), in
 * the order 616.1 says, and returns the event that happens instead: the same kind with
 * different details, another kind (Notion Thief makes another player draw), or `none`.
 */
export function replace(g: Game, ev: ReplaceEvent): ReplaceEvent {
  const from = battlefield(g).filter((x) => replacing(abilitiesOf(g, x)));
  const used = new Set<string>();
  const memo = new Map<string, Map<string, ReplaceEvent>>();

  /** The effects that may be applied next: those not applied yet, the first of 616.1a-d's kinds there are. */
  const next = (e: ReplaceEvent, done: Set<string>): Found[] => {
    if (e.kind === 'none') return [];
    const all = collect(g, e, from).filter((f) => !done.has(f.id));
    const tier = Math.min(...all.map((f) => f.r.tier ?? 4));
    return all.filter((f) => (f.r.tier ?? 4) === tier);
  };
  const after = (e: ReplaceEvent, f: Found, apply: boolean, done: Set<string>) => ({
    e: apply ? settle(f.r.instead) : e,
    done: apply && f.r.again ? done : new Set([...done, f.id]),
  });
  /** Every event `e` can end as, by its key. */
  const results = (e: ReplaceEvent, done: Set<string>, depth = 0): Map<string, ReplaceEvent> => {
    const key = `${sig(e)}|${[...done].sort().join(',')}`;
    const known = memo.get(key);
    if (known) return known;
    const out = new Map<string, ReplaceEvent>();
    const now = depth < 30 ? next(e, done) : [];
    if (!now.length) out.set(sig(e), e);
    for (const f of now) {
      for (const apply of f.r.optional ? [true, false] : [true]) {
        const n = after(e, f, apply, done);
        for (const [k, v] of results(n.e, n.done, depth + 1)) out.set(k, v);
      }
    }
    memo.set(key, out);
    return out;
  };
  const ends = (e: ReplaceEvent, b: Branch, done: Set<string>) => {
    const out = new Map<string, ReplaceEvent>();
    for (const apply of b.apply === undefined ? [true, false] : [b.apply]) {
      const n = after(e, b.f, apply, done);
      for (const [k, v] of results(n.e, n.done)) out.set(k, v);
    }
    return out;
  };

  for (let step = 0; step < 30; step++) {
    const now = next(ev, used);
    if (!now.length) return ev;
    const chooser = affected(ev);
    const branches: Branch[] = now.flatMap((f): Branch[] =>
      !f.r.optional ? [{ f, apply: true }] : f.r.optional.player === chooser ? [{ f, apply: true }, { f, apply: false }] : [{ f, apply: undefined }],
    );
    // Branches that lead to the same outcomes are the same choice.
    const groups: { branch: Branch; ends: Map<string, ReplaceEvent> }[] = [];
    const seen = new Set<string>();
    for (const branch of branches) {
      const e = ends(ev, branch, used);
      const key = [...e.keys()].sort().join('\n');
      if (seen.has(key)) continue;
      seen.add(key);
      groups.push({ branch, ends: e });
    }
    let pick = groups[0].branch;
    if (groups.length > 1) {
      // Best for the chooser first: that's what a bot takes.
      const best = (x: (typeof groups)[number]) => Math.max(...[...x.ends.values()].map((e) => worth(e, chooser)));
      groups.sort((a, b) => best(b) - best(a));
      const single = new Set(branches.map((b) => b.f.id)).size === 1;
      const text = single && now[0].r.optional ? now[0].r.optional.text : `${describe(g, ev, chooser)}. Choose which replacement effect applies first (616.1).`;
      const options = groups.map(({ branch: { f, apply }, ends: e }) => ({
        label: !f.r.optional || apply === undefined ? f.name : apply ? f.r.optional.yes : f.r.optional.no,
        sub: [...new Set([...e.values()].map((x) => outcome(g, x, chooser)))].join(' or '),
      }));
      const { pick: i, asked } = choose(g, { player: chooser, text, options }, 0);
      pick = groups[i].branch;
      if (asked && !single) log(g, `${says(g.players[chooser], 'applies')} ${options[i].label} first.`, chooser);
    }
    let apply = pick.apply;
    if (apply === undefined) {
      // "You may": the effect's own player decides (an owner whose commander someone else controls).
      const opt = pick.f.r.optional!;
      const yes = ends(ev, { f: pick.f, apply: true }, used);
      const no = ends(ev, { f: pick.f, apply: false }, used);
      const same = [...yes.keys()].sort().join('\n') === [...no.keys()].sort().join('\n');
      if (same) apply = true;
      else {
        const sub = (m: Map<string, ReplaceEvent>) => [...new Set([...m.values()].map((x) => outcome(g, x, opt.player)))].join(' or ');
        const options = [
          { label: opt.yes, sub: sub(yes) },
          { label: opt.no, sub: sub(no) },
        ];
        apply = choose(g, { player: opt.player, text: opt.text, options }, opt.bot === false ? 1 : 0).pick === 0;
      }
    }
    if (apply && pick.f.r.log) log(g, pick.f.r.log.text, pick.f.r.log.player, pick.f.r.log.cards ?? []);
    const n = after(ev, pick.f, apply, used);
    ev = n.e;
    used.clear();
    for (const id of n.done) used.add(id);
  }
  return ev;
}
