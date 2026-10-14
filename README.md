# Arena EDH — 4-player prototype

A browser prototype of what an MTG Arena game session could look like with four
players (Commander / EDH). You play one deck; bots play the other three.

```bash
npm install
npm run dev      # http://localhost:5180
npm test         # rules tests + full bot-vs-bot games
npm run build    # type-check and production build
```

## How to play

- Pick a deck on the menu (or "watch four bots play").
- **Glowing cyan** cards can be played. Drag one from your hand up toward the table and let
  go to play a land or cast a spell. Mana is tapped for you (auto-pay, like Arena).
- To pay by hand, click your lands and mana rocks to tap them: the mana shows in a pill
  beside your avatar. Costs spend that mana first and auto-tap only for the rest. Click a
  tapped source again to take its mana back, as long as none of it has been spent.
- Casting a spell or using an ability takes two steps, and **Cancel** (or `Esc`) backs
  out of either one:
  1. **Targets.** Legal targets are highlighted in **yellow**. Click one.
  2. **Pay.** The prompt shows the cost and the lands auto-pay would tap glow. Press
     **Pay** to confirm, or tap lands yourself: the spell is cast as soon as your mana
     covers the cost.

  Until it is paid for nothing has happened. The spell isn't on the stack, and Cancel
  untaps any lands you tapped while paying, so you are back exactly where you were.
- A spell or ability waits on **the stack** before it does anything. When an opponent's is
  there and you could respond, the game stops for you: cast an instant or use an ability,
  or press **Resolve** to let it happen. The newest thing on the stack happens first.
- The game passes for you whenever you have nothing you could do, so most of an opponent's
  turn goes by on its own. It also stops for you after attackers and after blockers are
  declared, and in each opponent's end step, if you could do something then.
- Your commander sits bottom-left in the command zone. Click it to cast it.
  Each recast costs 2 more (the `+2` badge).
- **Attacking:** press Next → To Combat, click an opponent's portrait to choose who to
  attack, then click your creatures. Different creatures can attack different players.
- **Blocking:** when you are attacked, click your creature. If it could block more than
  one attacker, click the attacker next.
- "When this enters" abilities that need a target ask for it once the creature is on the
  battlefield. That choice can't be cancelled: the ability has already triggered.
- `Space` / `Enter` = the big button. `Esc` = cancel.
- Click a graveyard or exile pile to look through it. Hover any card for a full-size view.
- Drag a card sideways in your hand to rearrange it. The order is only for you: it never
  reaches the game engine, so it changes nothing about play. Clicking a hand card does
  nothing, so you can't play one by accident while sorting.

## What is implemented

Rule numbers below are from the Comprehensive Rules in `docs/rules/`.

- Commander rules: 40 life, command zone, commander tax, 21 commander damage,
  commander returns to the command zone instead of dying or being exiled.
- Turn structure (500-514): untap, upkeep, draw, main, beginning of combat, declare
  attackers, declare blockers, combat damage (twice with first strike), end of combat,
  second main, end step, cleanup. Mana empties as each step ends.
- Priority (117): the active player gets it first in each step, it passes in turn order,
  and a step ends only when everyone passes in a row with the stack empty.
- The stack (405, 601, 602, 608): spells and activated abilities wait there and resolve
  last-in, first-out. Targets are checked again on resolution, and a spell whose targets
  are all gone does nothing. Mana abilities and playing a land don't use the stack.
- Triggered abilities (603): they trigger when the event happens, go on the stack the
  next time a player would get priority (active player's first), and choose targets then.
- State-based actions (704) are checked every time a player would get priority.
- Timing: instants, flash and abilities any time you have priority; everything else, and
  lands, only in your own main phase with the stack empty.
- Multiplayer combat: each attacker picks its own defending player; every attacked
  player declares blocks in turn order; players are eliminated mid-game, and what they
  had on the stack goes with them.
- Keywords: flying, reach, first strike, double strike, deathtouch, lifelink, trample,
  vigilance, haste, defender, hexproof, indestructible, menace, flash.
- 123 real cards across four mono-coloured decks, every one fully working.
  `npm test` fails if a card has rules text the engine doesn't implement.

## Known simplifications

These are deliberate cuts for a prototype, roughly in the order I'd tackle them next:

- **The game passes priority for you** (see `wantsPriority` in `engine.ts`). You can't
  hold priority to respond to your own spell, and you aren't stopped in every step. The
  engine itself follows the rules: `applyAction(g, a, { autoPass: false })` asks every
  player every time.
- **A player's triggers go on the stack in the order they triggered.** The rules let the
  player choose (603.3b).
- **No priority in the cleanup step.** An ability that triggers there waits for the next
  upkeep instead (514.3a). No card in the pool can trigger then.
- **A card keeps its identity when it changes zones.** By the rules it becomes a new
  object (400.7), so a spell aimed at a creature that left and came back should miss it.
- **Decks are 60 cards, not 100** (commander + 59, singleton apart from basics).
  Lists live in `src/cards/decklists.json`.
- No mulligans, no planeswalkers, no equipment/auras, no X spells, no counterspells.
- Combat damage is assigned automatically (lethal to each blocker in order).
- Optional "you may" effects always happen when they are free upside, and a commander
  always goes back to the command zone.

## Project layout

```
src/cards/      decklists.json        the four decks, shared artifacts, tokens
                cards.generated.json  card data from Scryfall (npm run fetch-cards)
                scripts.ts            what each card does
src/engine/     types.ts              game state, actions, card-script types
                rules.ts              queries (stats, mana, targets) + effect primitives
                engine.ts             setup, turn structure, priority, the stack, applyAction()
                ai.ts                 the bots
src/ui/         store.ts              Zustand store (game + what the player is selecting)
                view.ts               highlights, prompt, buttons, click handlers
                Card/Board/Hud.tsx    components
                styles.css            all styling
tests/                                Vitest: card coverage, rules, bot-vs-bot games
docs/rules/     INDEX.md              official Comprehensive Rules, one file per rule
                                      (npm run fetch-rules)
```

Three ideas hold it together:

1. **The engine is a pure function.** `applyAction(game, action)` returns a new game
   (via Immer), or the same object if the action was illegal. No UI code touches rules.
2. **Cards are data plus a small script.** Scryfall supplies cost, type, power/toughness
   and keywords. `scripts.ts` adds everything else using a handful of hooks
   (`onEnter`, `onDies`, `static`, `activated`, …). Trigger hooks don't run on the spot:
   the engine puts them on the stack and runs them when they resolve.
3. **Bots try moves instead of following rules.** Because the engine is pure, a bot
   applies each possible cast to a copy of the game, lets the stack resolve, and keeps
   the one that scores best. Only attacks and blocks use hand-written heuristics.

`Game.priority` is always the player the game is waiting on. If `Game.decision` is null
they have priority and can cast, activate or pass. Otherwise they are making that
decision: declaring attackers or blockers, discarding, or choosing targets for a trigger.

### Adding a card

1. Add its name to a deck in `src/cards/decklists.json`.
2. Run `npm run fetch-cards` to pull its data and art from Scryfall.
3. If it does more than its printed keywords, add an entry to `src/cards/scripts.ts`.
   A trigger that only fires on some events ("whenever *another* creature enters") needs
   `{ when, resolve }`, so it doesn't go on the stack for the events it ignores.
4. Run `npm test`. The card-pool test tells you if anything is still missing.

### Layout note

The root font-size scales with the window so the screen is always at least 192 × 108
`rem` (16:9), and `1rem` = 10px at 1920×1080. Size everything in `rem` and it scales.

A wider or taller window gets extra `rem` on that side instead of empty bars. So place
things from an edge or the middle (`right: 2rem`, `top: calc(100% - 12rem)`), not from
a fixed spot on a 192 × 108 grid.

## Credits

Card data and images come from [Scryfall](https://scryfall.com) and are loaded from its
image server at runtime. Mana and ability icons are from
[mana-font](https://github.com/andrewgioia/mana). Magic: The Gathering is © Wizards of
the Coast; this is an unofficial fan prototype, not affiliated with or endorsed by them.
