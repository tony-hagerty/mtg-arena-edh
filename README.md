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
- Spells with targets highlight legal targets in **yellow**. Click one, or press Cancel.
- Your commander sits bottom-left in the command zone. Click it to cast it.
  Each recast costs 2 more (the `+2` badge).
- **Attacking:** press Next → To Combat, click an opponent's portrait to choose who to
  attack, then click your creatures. Different creatures can attack different players.
- **Blocking:** when you are attacked, click your creature. If it could block more than
  one attacker, click the attacker next.
- `Space` / `Enter` = the big button. `Esc` = cancel.
- Click a graveyard or exile pile to look through it. Hover any card for a full-size view.
- Drag a card sideways in your hand to rearrange it. The order is only for you: it never
  reaches the game engine, so it changes nothing about play. Clicking a hand card does
  nothing, so you can't play one by accident while sorting.

## What is implemented

- Commander rules: 40 life, command zone, commander tax, 21 commander damage,
  commander returns to the command zone instead of dying or being exiled.
- Turn structure: untap, upkeep triggers, draw, main 1, combat (attackers → blockers →
  first-strike and regular damage), main 2, end step, discard to seven.
- Multiplayer combat: each attacker picks its own defending player; every attacked
  player declares blocks in turn order; players are eliminated mid-game.
- Keywords: flying, reach, first strike, double strike, deathtouch, lifelink, trample,
  vigilance, haste, defender, hexproof, indestructible, menace.
- 123 real cards across four mono-coloured decks, every one fully working.
  `npm test` fails if a card has rules text the engine doesn't implement.

## Known simplifications

These are deliberate cuts for a prototype, roughly in the order I'd tackle them next:

- **No stack or priority passing.** Spells resolve as soon as they are cast, so nothing
  can be responded to or countered. You can still cast instants during combat: before
  damage on your turn, and while declaring blocks on someone else's.
- **Decks are 60 cards, not 100** (commander + 59, singleton apart from basics).
  Lists live in `src/cards/decklists.json`.
- No mulligans, no planeswalkers, no equipment/auras, no X spells.
- "Enters the battlefield" targets are chosen when you cast the creature.
- Combat damage is assigned automatically (lethal to each blocker in order).
- Optional "you may" effects always happen when they are free upside.

## Project layout

```
src/cards/      decklists.json        the four decks, shared artifacts, tokens
                cards.generated.json  card data from Scryfall (npm run fetch-cards)
                scripts.ts            what each card does
src/engine/     types.ts              game state, actions, card-script types
                rules.ts              queries (stats, mana, targets) + effect primitives
                engine.ts             setup, turn structure, combat, applyAction()
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
   (`onEnter`, `onDies`, `static`, `activated`, …).
3. **Bots try moves instead of following rules.** Because the engine is pure, a bot
   applies each possible cast to a copy of the game and keeps the one that scores best.
   Only attacks and blocks use hand-written heuristics.

### Adding a card

1. Add its name to a deck in `src/cards/decklists.json`.
2. Run `npm run fetch-cards` to pull its data and art from Scryfall.
3. If it does more than its printed keywords, add an entry to `src/cards/scripts.ts`.
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
