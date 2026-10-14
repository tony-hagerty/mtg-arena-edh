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
- **Mulligan:** before the first turn you see your seven cards. Press **Keep**, or
  **Mulligan** to shuffle them away and draw seven new ones. Your first mulligan is free;
  after that you pick one card per extra mulligan to put on the bottom of your library.
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
- With the stack empty, the game passes for you except at your **stops**. The tracker in
  the bottom right shows them: a **ring** under a step means "stop if I can act", a
  **dot** means "always stop". Click a step to cycle it: no stop, ring, dot, no stop.
  A pip that covers several steps (beginning, combat, end) opens one button per step.
  The untap and cleanup steps can't hold a stop: nobody gets priority there (502.4, 514.3).
- The four arrows beside the tracker are the four seats (down is you). Click one to see
  and edit the stops for that player's turns; the tracker takes their deck colour. Click
  it again to go back to the current turn. Your turns show orange, everyone else's blue.
- The defaults: on your turn, always in main 1, and if you can act in main 2 and after
  blockers are declared. On other turns, if you can act, after attackers (only once
  something attacks) and blockers are declared, and in the end step. Stops are saved in
  the browser.
- Every portrait is that player's commander; hover it to read the card. A player with two
  partner commanders has a portrait split in two. To cast yours, click the **crown** on
  the top left of your portrait (a second commander's crown sits below it, at 9 o'clock).
  It glows when you can cast it and is dimmed while that commander is anywhere but the
  command zone. The badge on the top right of a portrait is that commander's tax: each
  recast costs 2 more (`+2`, `+4`, …). Partners each have their own tax badge.
- **Attacking:** press Next → To Combat, click an opponent's portrait to choose who to
  attack, then click your creatures. Different creatures can attack different players.
- **Blocking:** when you are attacked, click your creature. If it could block more than
  one attacker, click the attacker next.
- **Piles:** identical lands, and identical creature tokens, pile up with a count (`x7`) on
  top. Click the count to use the whole pile: lands tap for mana together (while paying,
  only as many as the cost needs), or untap together to take the mana back, and tokens
  attack or block together. Clicking a card in the pile still uses just that one, and it
  moves out to its own pile.
- When your commander dies, is exiled, or would go to your hand or library, a window asks
  whether it goes to the **Command Zone** (castable again, with tax) or stays where it went.
- "When this enters" abilities that need a target ask for it once the creature is on the
  battlefield. That choice can't be cancelled: the ability has already triggered.
- **Searching your library** (Rampant Growth, Cultivate, Path to Exile, ...) opens your whole
  library. Cards you could find glow; click one and press **Choose**, or **Find Nothing**.
- When two or more of your triggered abilities happen at once, you choose their order:
  the one on the left resolves first. Use the arrows to move them.
- These windows can't be closed, since the game is waiting on you, but **View table**
  folds one away so you can look at the board.
- `Space` / `Enter` = the big button. `Esc` = cancel.
- Click a graveyard or exile pile to look through it. Hover any card for a full-size view.
- The log is bottom-left. Hover a card name in it (dashed underline) to see the card.
  **Hide log** folds it away, **Speed** changes how fast the bots play, and **Exit** asks
  before leaving the game for the deck menu.
- Drag a card sideways in your hand to rearrange it. The order is only for you: it never
  reaches the game engine, so it changes nothing about play. Clicking a hand card does
  nothing, so you can't play one by accident while sorting.

## What is implemented

Rule numbers below are from the Comprehensive Rules in `docs/rules/`.

- Commander rules: 40 life, command zone, commander tax, 21 commander damage.
- Deck format: 100-card decks with one commander or two partners (702.124), in any
  colours. A deck's colours are its commanders' combined colour identity (903.4,
  702.124c). Partners both start in the command zone and keep separate commander tax and
  commander damage (702.124d). `deckProblems` in `src/cards/db.ts` checks a deck: 100
  cards, singleton except basics (903.5b), every card inside the colour identity
  (903.5c), legendary creature commanders (903.3), and a valid partner pair (plain
  partner or "partner with").
- Multicolour mana: auto-pay pays the scarcest colour first and backs up to try another
  source when a choice would leave a later pip unpayable. A multicolour source tapped by
  hand makes the colour your hand needs most. Bots play the land for the colour they are
  shortest of.
  A commander that dies or is exiled really goes there (so "dies" abilities see it),
  then its owner may move it to the command zone (903.9a). One headed for a hand or
  library may go to the command zone instead (903.9b). You're asked; bots always do.
- Costs (107.3, 107.4, 118, 601.2b, 601.2f):
  - {X}: the caster picks X before choosing targets; it is paid as generic mana. Scripts
    read it as `self.cast.x`.
  - Hybrid ({R/W}), monocoloured hybrid ({2/W}) and Phyrexian ({W/P}) symbols. Auto-pay
    tries coloured mana first, then {2}, then 2 life, and backs up if a choice leaves
    the rest unpayable.
  - Kicker and multikicker (702.33), "sacrifice a creature" additional costs (118.8) and
    alternative costs such as "cast without paying its mana cost" (118.9). Commander tax
    applies to alternative costs too (118.9d).
  - Cost increases and reductions from permanents (Thalia-style) and from the spell
    itself, added up together; reductions only take off generic mana (601.2f).
  - When you cast a spell with any of these, a small panel asks for X, kicker and which
    cost before you choose targets. A sacrifice is picked after the targets.
- Turn structure (500-514): untap, upkeep, draw, main, beginning of combat, declare
  attackers, declare blockers, combat damage (twice with first strike), end of combat,
  second main, end step, cleanup. Mana empties as each step ends.
- Priority (117): the active player gets it first in each step, it passes in turn order,
  and a step ends only when everyone passes in a row with the stack empty.
- The stack (405, 601, 602, 608): spells and activated abilities wait there and resolve
  last-in, first-out. Targets are checked again on resolution, and a spell whose targets
  are all gone does nothing. Mana abilities and playing a land don't use the stack.
- Counterspells (701.6): a spell or ability can target spells or abilities on the stack
  (click one in the stack panel). A countered spell goes to the graveyard and its costs
  aren't refunded; a countered commander can still go to the command zone.
- Holding priority (117.3c): tick **Hold priority** while paying (or press Ctrl+Space)
  to keep priority after your spell goes on the stack, so you can respond to it yourself.
- Modal spells (700.2): the cast panel lists the modes; pick as many as the card says.
  Each mode has its own targets, and a mode with no legal target can't be picked.
  "You may choose the same mode more than once" works (700.2d).
- Copying spells (707.10): the copy keeps the original's modes, X and kicker, and its
  controller may choose new targets. A copy ceases to exist when it leaves the stack.
- Counters (122): any kind, by name. +1/+1 and -1/-1 counters change power and
  toughness and cancel each other out (704.5q); a keyword counter like `flying` gives the
  keyword (122.1b). Tiles show them ("+2", "-1", "3 charge").
- Auras (303.4, 702.5): the spell targets what it will enchant; one whose target is gone
  goes to the graveyard. An Aura on something it can't enchant, or on nothing, goes to
  the graveyard (704.5m). "Can't attack" and "can't block" work (Pacifism).
- Equipment (301.5, 702.6): equip at sorcery speed to a creature you control; it falls
  off a permanent that stops being a creature, and stays on the battlefield (704.5n).
- Vehicles (301.7, 702.122): crew by tapping other untapped creatures with enough total
  power (summoning-sick ones can crew). The Vehicle is an artifact creature until end
  of turn. Bots crew before combat with their weakest or summoning-sick creatures.
- Attached Auras and Equipment are drawn tucked behind the permanent they're on; click
  an attached Equipment to equip it elsewhere.
- Triggered abilities (603): they trigger when the event happens, go on the stack the
  next time a player would get priority (active player's first), and choose targets then.
  You choose the order of your own that go on together (603.3b); bots keep the order they
  triggered in.
- Mulligans (103.5): players declare in turn order from the starting player, then
  everyone who chose to mulligan does so at once and puts cards on the bottom. The first
  mulligan is free in multiplayer (103.5c). Bots keep a hand with 2 to 5 lands.
- Searching a library (701.23): the player looks at every card and picks a valid one, or
  may find nothing (701.23b). The spell stays on the stack until the choice is made.
- State-based actions (704) are checked every time a player would get priority.
- Timing: instants, flash and abilities any time you have priority; everything else, and
  lands, only in your own main phase with the stack empty.
- Multiplayer combat: each attacker picks its own defending player; every attacked
  player declares blocks in turn order; players are eliminated mid-game, and what they
  had on the stack goes with them.
- Keywords: flying, reach, first strike, double strike, deathtouch, lifelink, trample,
  vigilance, haste, defender, hexproof, indestructible, menace, flash.
- 123 real cards across four mono-coloured decks, every one fully working. The decks
  shown on the menu are old 60-card "legacy" decks (see below); the menu shows each
  deck's colour pips.
  `npm test` fails if a card has rules text the engine doesn't implement.

## Known simplifications

These are deliberate cuts for a prototype, roughly in the order I'd tackle them next:

- **Auto-pass**: with something on the stack, the game stops for you only when the top
  object is an opponent's and you could act, or when you held priority. Outside that,
  auto-pass follows your stops (`wantsPriority` in `engine.ts`; the UI passes them in
  `applyAction(g, a, { stops })`). Bots always use the defaults and never hold. The
  engine itself follows the rules: `applyAction(g, a, { autoPass: false })` asks every
  player every time.
- **No priority in the cleanup step.** An ability that triggers there waits for the next
  upkeep instead (514.3a). No card in the pool can trigger then.
- **A card keeps its identity when it changes zones.** By the rules it becomes a new
  object (400.7), so a spell aimed at a creature that left and came back should miss it.
- **The four starter decks are still 60 cards** (commander + 59). They are marked
  `"legacy": true` in `src/cards/decklists.json`, get the shared artifacts added, and are
  checked as 60-card decks. The engine plays 100-card and partner decks, but none is on
  the menu yet.
- Partner variants other than plain partner and "partner with" (Background, Doctor's
  companion, "partner—[text]") aren't recognised. Vehicles can't be commanders yet.
- No planeswalkers or battles yet.
- Auras can only enchant permanents, not players (702.5d). A card can have only one
  activated ability, so an Equipment's equip is its only one. Proliferate, shield,
  stun and other counters with their own rules (122.1c-j) do nothing special yet.
  The test-only cards are in `tests/fixtures.ts` (Pacifism, Holy Strength, Bonesplitter,
  Loxodon Warhammer, Untethered Express, Black Sun's Zenith).
- Only spells can be modal: modal triggered and activated abilities (700.2b) aren't
  supported. A copy's controller must pick legal new targets or keep all the old ones
  (707.10c allows keeping some). Copying abilities and "can't be countered" aren't
  supported yet. The test-only cards for this are in `tests/fixtures.ts` too
  (Counterspell, Negate, Essence Scatter, Stifle, Cryptic Command, Boros Charm, Fiery
  Confluence, Reverberate).
- **No card on the menu uses the new costs yet.** The engine supports them, and the tests
  use real cards typed in by hand in `tests/fixtures.ts` (Blaze, Gut Shot, Burst
  Lightning, Bone Splinters, Flawless Maneuver, Thalia, Ruby Medallion, Boros Recruit),
  because Scryfall couldn't be reached to fetch them.
- Phyrexian mana is always paid with mana when the mana is there; you can't choose to pay
  life instead. Tapping lands by hand first lets you steer it.
- Not supported yet: X in activated abilities, targets that exist only when kicked
  (702.33g), snow mana {S}, and a spell's mana value counting X while on the stack
  (202.3e).
- Cultivate asks for its two lands one at a time (battlefield, then hand), not as one pick
  of two. It is still one search with one shuffle (701.23h).
- Combat damage is assigned automatically (lethal to each blocker in order).
- Optional "you may" effects always happen when they are free upside.
- **Your commander going to your hand or library** lands there first, and you choose
  before anyone gets priority. By the rules (903.9b) that is a replacement effect chosen
  as it moves, but an effect can't stop partway through to ask. Bots get the real
  replacement. No card in the pool puts a permanent into a hand or library yet.

## Project layout

```
src/cards/      decklists.json        the decks, shared artifacts, tokens
                db.ts                 card lookup, deck colours, deck legality (deckProblems)
                cards.generated.json  card data from Scryfall (npm run fetch-cards)
                scripts.ts            what each card does
src/engine/     types.ts              game state, actions, card-script types
                rules.ts              queries (stats, mana, targets) + effect primitives
                engine.ts             setup, turn structure, priority, the stack, applyAction()
                ai.ts                 the bots
src/ui/         store.ts              Zustand store (game + what the player is selecting)
                view.ts               highlights, prompt, buttons, click handlers
                Card/Board/Hud.tsx    components
                Picker.tsx            card picker: search, mulligan, bottom, trigger order
                styles.css            all styling
tests/                                Vitest: card coverage, rules, the UI casting flow,
                                      bot-vs-bot games
                fixtures.ts           cards not in the pool yet, for testing costs
public/         cursor.png            the mouse cursor, and cursor-down.png while a
                                      button is held (see Credits)
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
decision: a mulligan, declaring attackers or blockers, discarding, choosing targets for a
trigger, ordering their triggers, or picking cards from a list (`CardChoice`). A choice in
the middle of a spell's effect, like a search, waits in `Game.choices` until the effect
has run; the spell stays on the stack as `Game.resolving` until it is answered.

### Adding a card

1. Add its name to a deck in `src/cards/decklists.json`. A deck lists `commanders` (one,
   or two partners), `basics` as a map like `{ "Forest": 18, "Island": 17 }`, and
   `cards`, one of each.
2. Run `npm run fetch-cards` to pull its data and art from Scryfall.
3. If it does more than its printed keywords, add an entry to `src/cards/scripts.ts`.
   A trigger that only fires on some events ("whenever *another* creature enters") needs
   `{ when, resolve }`, so it doesn't go on the stack for the events it ignores.
   Costs printed in rules text go in the script too: `kicker`, `additionalCost` (a
   sacrifice), `alternativeCosts`, and `costModifier` for "spells cost {1} more/less".
   An X or kicked spell reads `self.cast.x` and `self.cast.kicked`. A modal spell uses
   `modal` instead of `targets`/`onResolve`; a counterspell targets `{ type: 'spell' }`
   and calls `counter`. An Aura sets `enchant` and `static: attachedBonus({...})`; an
   Equipment uses `attachedBonus` with `activated: equip('{2}')`; a Vehicle uses
   `activated: crew(3)`. Counters: `addCounters(g, card, n, kind)`.
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
[mana-font](https://github.com/andrewgioia/mana). The mouse cursor (`public/cursor.png`) is
["MTGA cursor"](https://www.cursor.cc/?action=icon&file_id=114958) by Tales on cursor.cc,
shared under Creative Commons with no attribution required; `cursor-down.png` is a
shrunk, recoloured copy of it. Magic: The Gathering is © Wizards of
the Coast; this is an unofficial fan prototype, not affiliated with or endorsed by them.
