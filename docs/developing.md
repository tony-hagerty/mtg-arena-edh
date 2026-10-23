# Developer guide

How the code is laid out, how to add a card, and the card-script reference. See the
[README](../README.md#for-developers) for the commands.

## How the code works

### Project layout

```
src/cards/      decklists.json        the decks and tokens
                db.ts                 card lookup, deck colours, deck legality (deckProblems)
                decklist.ts           reading a pasted deck list (parseDeckList, checkList)
                oracle.ts             scripts from Oracle text, for cards without a hand script
                oracle-report.ts      the parse report (npm run parse-report)
                support.ts            can the engine play a card (unsupported, problemsOf), and
                                      playing one without its rules text (playsWithoutText)
                scryfall.ts           Scryfall's card data as CardData; fetching by name
                fetched.ts            cards fetched for pasted decks: add, script, refuse
                cache.ts              the browser's cache of fetched cards (IndexedDB)
                requests.ts           docs/card-requests.json: entries and merging
                creature-types.json   every creature type (205.3m; npm run fetch-rules)
                subtypes.json         the other card types' subtypes (205.3g-q; npm run fetch-rules)
                cards.generated.json  card data from Scryfall (npm run fetch-cards)
                scripts.ts            what each card does (starter decks)
                pairs.ts              what the two-colour starter decks' new cards do
                kraum-tymna.ts, yshtola.ts, ketramose.ts, kuja.ts, hashaton.ts
                                      what each Commander deck's own cards do
                edhrec/               hand scripts for EDHREC's most-played cards and
                                      commanders the parser can't read, one file per group
                                      of mechanics (counters, ward-ring, mana, ...)
src/engine/     types.ts              game state, actions, card-script types
                rules.ts              queries (stats, mana, targets) + effect primitives
                layers.ts             continuous effects in layers and timestamp order (613)
                replace.ts            replacement and prevention effects, and their order (614-616)
                engine.ts             setup, turn structure, priority, the stack, applyAction()
                ai.ts                 the bots
                view.ts               one seat's copy of the game, hidden cards taken out
                registry.ts           where card scripts register themselves
src/net/        protocol.ts           what the game window and game server send each other
                lobby.ts              what the window and the lobby send each other
server/game/    host.ts               the game server: the whole game, bots, each seat's view
                http.ts               its web endpoints (/api/game/...)
                report.ts             the window's errors, one line each in the launcher's log
                service.ts            which game the endpoints play: this computer's, or a host's
server/lobby/   table.ts              the host's table: seats, decks, ready, starting the game
                hosting.ts            hosting: friends' TLS connections, the join code
                guest.ts              a friend's side: joining, and relaying the host's game
                lobby.ts, http.ts     this computer's lobby and its endpoints (/api/lobby/...)
                saves.ts              saved table games, to resume if the host goes
                wire.ts, version.ts   the host-to-friend protocol; the build each program is
server/net/                           reaching the host: TLS identity, join codes, port
                                      forwarding (NAT-PMP, UPnP), addresses, CGNAT checks
launcher/                             the Windows program: serves the game, opens Edge, logs
                                      to ArenaEDH-data/launcher.log (see launcher/README.md)
src/ui/         App.tsx               menu or game screen; GameScreen.tsx lays the game out
                ErrorScreen.tsx       what shows instead of a blank page when drawing throws
                crash.ts              sends the window's errors to the program's log
                store.ts              Zustand store (game + what the player is selecting)
                remote.ts             the window's connection to the game server
                lobby.ts              the window's connection to the lobby; the name you play under
                LobbyScreen.tsx       hosting a table, joining one with a code, the waiting room
                view.ts               highlights, prompt, buttons, click handlers
                Card/Board/Hud.tsx    components: your hand's cards, the portraits and piles, the HUD
                TextCard.tsx          a card drawn as text when its image doesn't load
                Menu.tsx              deck menu, opponent seats, the paste screen
                card-requests.ts      sends refused cards to the dev server or a download
                Picker.tsx            card picker: search, mulligan, bottom, trigger order,
                                      yes/no questions, naming, players, legend rule,
                                      escape, casting while a spell resolves
                sound.ts              plays the interface sounds: clicks, hand cards, game moves
                synth.ts              how each sound is made (Web Audio, no sound files)
                game-sounds.ts        which sound a change of game state makes (gameSound)
                music.ts              plays the background music (Web Audio: harp, bass, drum, reverb)
                music-score.ts        the music's notes from a seed, and when it plays (musicLevel)
                zone-moves.ts         which cards changed zones between two games (zoneMoves)
                Flights.tsx           cards flying between zones, drawn from that diff
                SoundControl.tsx      mute buttons and volume sliders for sound and music
                hotkeys.ts            every key and mouse control, for the gear menu's Hotkeys window
                BoardSplash.tsx       the splash over the board while the 3D table loads
                fullscreen.ts, rem.ts Alt+Enter fullscreen; the root font-size as a hook
                camera.ts             the camera on the table: its tilt and perspective, the
                                      table's height, and the projection table <-> screen
                table-layout.ts       your hand's curve and scroll pills (pure maths, tested)
                util.ts               small helpers: class names, deck colours, hover props
                styles.css            all styling
                three/                the table, drawn in 3D (how it came about:
                                      docs/plans/flutter-conversion.md). Table3D.tsx is the
                                      scene (Three.js through React Three Fiber) and the
                                      cards' proxies; layout3d.ts where each card lies in its
                                      rows (seatScale) and the camera that matches camera.ts
                                      (pure maths, tested); geometry.ts a card's rounded shape;
                                      board.ts the board's plan: four mats, each a seat's
                                      battlefield (seatArea: its rows' box and its piles),
                                      where each opponent holds their hand, and the well
                                      that is the shared exile, with the mats' maps (pure
                                      maths, tested); layout3d.ts also fans a held hand
                                      (heldFan); Garden.tsx draws the mats and the well's
                                      water and whirlpool; Hall.tsx the stone walls and
                                      the torches; effects.tsx the bursts a click on the
                                      board makes; floor.ts the flagstones; noise.ts the
                                      noise they share; textures.ts card faces (a
                                      permanent's art-and-name tile, tileTexture), back
                                      and floor
                card-back.svg         the back of every card, on the screen and in the scene
                cursor.png            the mouse cursor, and cursor-down.png while a
                                      button is held (see Credits)
tests/                                Vitest: card coverage, rules, the UI casting flow,
                                      bot-vs-bot games
                simulation/           bot-vs-bot games, one file each so they run on
                                      every core at once: games.ts lists them (deck
                                      sets and seeds), play.ts plays one out
                fixtures.ts           scripts for cards not in the pool yet, for testing
                fixture-cards.json    their names; fetch-cards writes their data to
                                      fixtures.generated.json
                parser-corpus.generated.json
                                      the Oracle text of the 600 most-played Commander
                                      cards, which the parse report scores the parser on
                                      (npm run fetch-corpus; never edited by hand)
docs/rules/     INDEX.md              official Comprehensive Rules, one file per rule
                                      (npm run fetch-rules)
docs/           card-scripting.md     how to script a card from its exact wording
                card-requests.json    cards the game refused, for /script-requested-cards
```

### Three core ideas

1. **The engine is a pure function.** `applyAction(game, action)` returns a new game
   (via Immer), or the same object if the action was illegal. No UI code touches rules.
2. **Cards are data plus a small script.** Scryfall supplies cost, type, power/toughness
   and keywords. `scripts.ts` adds everything else using a handful of hooks
   (`onEnter`, `onDies`, `static`, `activated`, …). Trigger hooks don't run on the spot:
   the engine puts them on the stack and runs them when they resolve.
3. **Bots try moves instead of following rules.** Because the engine is pure, a bot
   applies each possible cast to a copy of the game, lets the stack resolve, and keeps
   the one that scores best. Only attacks and blocks use hand-written heuristics.

### Who the game is waiting on

`Game.priority` is always the player the game is waiting on. If `Game.decision` is null
they have priority and can cast, activate or pass. Otherwise they are making that
decision:

| Decision | Examples |
| --- | --- |
| Built-in | a mulligan, declaring attackers or blockers, discarding, choosing targets for a trigger, ordering their triggers |
| `CardChoice` | picking cards from a list (the legend rule too), and players with them for proliferate (`players`) |
| `AskChoice` | answering yes or no |
| `NameChoice` | naming a card or creature type |
| `PlayerChoice` | choosing a player |
| `CastChoice` | casting a card while a spell resolves |
| `RetargetChoice` | choosing new targets |

A choice in the middle of a spell's effect waits in `Game.choices` until the effect so
far has run; the spell stays on the stack as `Game.resolving` until it is answered. What
happens next is the script's `then[key]`, which the choice names, so a card can ask
several questions in a row.

### The lobby

Playing with friends on other computers starts in the lobby (`src/net/lobby.ts`). The
window only talks to the program on its own computer: `connectLobby` (src/ui/lobby.ts)
streams `LobbyState` from `/api/lobby/events` and POSTs requests (host, join, deck,
ready, table, start, leave); a refusal comes back as a reason in plain words, which the
screen shows. A page with no lobby (a build opened from disk) gets no Host or Join
buttons. The menu shows the waiting room while `LobbyState.role` isn't `none`. Its screens, like the paste screen, sit in `MenuFrame`
(`src/ui/LobbyScreen.tsx`), the panel that matches the title screen. Once
`started` is true, the store (`onLobby`) plays the game through the game server as
`yourSeat` alone: it streams only that seat, never passes the screen, and never starts a
game itself (the host's Play Again asks the lobby to start the next one). Leaving that game leaves the table (for the host, that closes it), and the
server's game goes on for the others.

During a table's game the lobby also says who is away and the table's open votes on a
bot for their seat (`SeatVotes`, in the waiting room and over the board), and whether the
game is paused: **Pause** in the log bar sends `pause`, and while `paused` an overlay
covers the board with Resume and the store takes no moves. **Saved games** on the menu
lists the table games saved on this computer (`SavedGames`), and when a table ends (the
host left) the menu says so and points there (`TableEnded`). Resume hosts one again at a new table, where
`resuming` fixes the seats and Start reads Resume Game until the away players are back.

### Sizing the UI

The root font-size scales with the window so the screen is always at least 192 × 108
`rem` (16:9), and `1rem` = 10px at 1920×1080. Size everything in `rem` and it scales.

A wider or taller window gets extra `rem` on that side instead of empty bars. So place
things from an edge or the middle (`right: 2rem`, `top: calc(100% - 12rem)`), not from a
fixed spot on a 192 × 108 grid.

**The table leans away from you**, like Arena's: the scene's table (three/Table3D.tsx) is
turned by `TILT` (26°) about its bottom edge under a perspective of `DEPTH` (170rem, the
far edge about 0.6 of the near one), both in `src/ui/camera.ts`, which the scene's camera
is built from (`baseCamera`) and everything that projects through `camera()` follows. The
table is taller than the screen by just enough that, leaned over, its far edge lands on the
top of the screen (`tableHeight`). A browser without WebGL 2 gets a notice in the table's
place (`CAN_DRAW_3D`).

**The table loads behind a splash.** Its code is loaded only once a game starts, and its
renderer starts and its first frames build the shaders after that, with the canvas blank
until they're done: a few seconds the first time. `Table3D` reports each step through
`onProgress` (`BoardStep`: loaded, renderer, drawn), and GameScreen's `Board3D` shows
`BoardSplash` until the scene has drawn three frames. The splash's bar fills by those
steps; it gives up after 15 seconds (`SPLASH_MAX_MS`) so it can never hide the game for good.
A hidden window draws no frames, so there the splash waits until the window shows.

**Seats sit in the corners** (`seatOf` in util.ts: a `Seat` is `{ v: 'top' | 'bottom', h:
'left' | 'right' | 'full' }`, and `seatClass` gives `seat-bottom-left seat-bottom
seat-left` and the like). Two players sit bottom left and top right, three leave you the
whole bottom edge (`full`) and take the top corners, four go bottom left, top left, top
right, bottom right. Each seat's rows and piles lie on its mat (`seatArea` in
three/board.ts: the mat short of its piles and the well): lands nearest the seat's edge,
then the other permanents, then creatures nearest the middle, grown to the biggest scale
(0.7 to 1.9) at which every row fits its length and the rows fit the mat (`seatScale` in
three/layout3d.ts; past 0.7 a crowded row overlaps, `rowGap`). Cards stay upright for
everyone. Exile is shared in the well, and an opponent holds their hand on their mat
(`HeldHand`). Only the portrait stands on the screen (`SeatHud` in Board.tsx), 2.4rem in
from the side edge, just below the middle for the bottom seats and above it for the top
ones.

Your hand follows a curve out of the bottom-left corner (`handSlot`), the first card placed
along it so its left edge touches the screen's (`S0`): up to seven cards,
each turned to the curve under it; a bigger hand scrolls (`handStart` in the store, the
pills from `handPills`). A hand card is drawn in a slot that takes no pointer events,
so its zoom can cover its neighbours; a clear copy of its resting shape (`.hand-hit`)
takes the hover, the click and the press that starts the drag, and while a card is
dragged (`holding` in the store) no other card hovers. The HUD sits flat on the screen: the log bar at the top in the
middle, the controls' plate with the seat arrows above it at the bottom in the middle,
the stack over the middle of the table (`stackHidden` in the store tucks it into a chip).

That leaves two coordinate spaces. The cards, piles and held hands are laid out on the
table, in its own rem (three/board.ts, three/layout3d.ts); the hand, the portraits, the
HUD, the arrows and the hover preview sit flat on the screen. `getBoundingClientRect`
always answers in screen px; `camera()` projects between the two (`toScreen`,
`toTable`), which is how board.ts keeps a mat's rows clear of what stands on the screen
over it. Every card on the table has a proxy, a DOM box the scene lays over it on the
screen each frame (`useProxy` in Table3D.tsx), so the preview, the arrows and the flights
find it by its element as they find a hand card. The scene flies arrivals onto the table
itself; Flights.tsx flies everything else over the screen.

### Colours and the table's look

`styles.css` opens with the design tokens on `:root`: surfaces (`--board`, `--panel`,
`--raised`, `--sunken`), text shades, the gold accent, the action colours (`--play` cyan
for what can be played, `--target` yellow for what can be chosen, `--attack`, `--block`),
lines, shadows and radii. Use them rather than new literal colours; the comment above them
says what each is for. The card frame colours (`--f-W` to `--f-land`) double as each
deck's seat colour. All the app's text is one sans-serif typeface, `--sans`: use it rather
than naming a font (the tile names in the scene read it too, `tileTexture`).

- **Seats** are the mats (three/Garden.tsx), one material each in turn order from yours.
  Whose turn it is shows on their avatar (the rays and the gold life plate).
- **A card's badges** (P/T, counters, the summoning-sick mark, a pile's count) are DOM, on
  the card's proxy, whose font-size is a tenth of the card's width, so they are sized in
  `em`, with `rem` floors on text that must stay readable. A pile shows `PILE_STEP`
  (three/layout3d.ts) of each card under its top one.
- **Rows** never wrap: a seat's three rows share its box (`seatScale`), and a row too long
  for it overlaps its cards (`rowGap`).
- **The card back** is one SVG, `src/ui/card-back.svg` (the icon as a gold silhouette),
  in `--card-back` wherever a card is face down on the screen, and drawn onto the cards'
  undersides and the libraries in the scene (`backTexture`).
- **A tapped card** lies turned 8° and carries the tap symbol on its proxy (`.tap-symbol`,
  the mana font's {T}).

## Tests

Three commands, the same tests split two ways:

| Command | Runs | For |
| --- | --- | --- |
| `npm test` | everything | before you push: it must pass |
| `npm run test:quick` | everything but whole games | while you work |
| `npm run test:games` | the whole games only | after an engine or bot change |

While working on one thing, run its file: `npx vitest run tests/engine.test.ts`.

**Whole games** are the tests tagged `game` (`it(name, { tags: ['game'] }, ...)`): every
game in `tests/simulation/`, and the few others that play one out with bots (seats at each
table size, `viewFor` through a game, a game through the lobby and the game server). They
are most of the run's time. `test:quick` skips them; `test:games` runs only them.

**The bot games** in `tests/simulation/` are the engine's regression set: bots play each to
a finish, and `play.ts` checks the game after every action (every card in one place, every
commander home, no state-based action left undone). `games.ts` lists every deck set and the
seeds it is played with; each game has its own file, `<set>-<seed>.test.ts`, which is one
line, `play('<set>', <seed>)`, so Vitest spreads the games over every core and the run takes
about as long as the slowest game. Keep the seeds. To add a game, add the seed (or a new set)
to `games.ts` and a file for it: `tests/games-table.test.ts` fails until the two match.

Vitest starts the files that took longest last time first. With no timings from an earlier
run (a fresh checkout, CI), `BotGamesFirst` in `vite.config.ts` starts the games, the
slowest ones measured (`SLOW_GAMES`) first.

**Profiling.** `npm run profile-game -- <seed>` plays one game under Node's CPU profiler and
prints the functions that took the most time, by their own code and with what they call.
By default it is the suite's slowest game (two Hashaton decks, seed 94); add `starter` for
the four starter decks (`npm run profile-game -- 44 starter`), or a deck set from `games.ts`
(`npm run profile-game -- 71 kuja`). The raw `.cpuprofile` it names opens in Chrome's
DevTools (Performance, Load profile).

### Keeping the engine fast

The bots try moves on copies of the game, so the engine's speed is the bots' speed, in the
app as in the tests. What keeps it fast, and what to keep in mind when changing it:

- **Reading through drafts is slow.** Inside `produce`, every property read goes through an
  Immer proxy. Ask questions of a finished (frozen) game where you can: there the layers keep
  their answers (`characteristics` memoizes per frozen game).
- **`settle` runs between drafts.** `applyAction` applies the action in one `produce`, then
  `settle` asks its questions (`sbaPending`, `wantsPriority`) of the finished game and makes
  each change in a `produce` of its own. If you add a state-based action to `checkState`,
  add its condition to `sbaPending` too; `tests/state-checks.test.ts` and the bot games check
  the two agree.
- **An untouched draft is its finished game.** Until a draft changes, `untouched(g)` gives
  the game it came from, and the legality checks at the start of an action (`canCast`,
  `canActivate`, `legalTargets` and a few more) ask that game instead.
- **A plain copy for a big read inside a draft.** Where a step that has already changed the
  draft must read a lot (planning a payment in `pay`, checking targets again in
  `resolveTop`), it reads `current(g)`, a plain copy, and uses ids from it.
- **`settled(g, fn)`** keeps each permanent's characteristics while `fn` only reads `g`; wrap
  a read-only pass over many permanents in it. For a frozen game what it works out is kept
  for good.
- **A bot's trial moves** (`simulate`, `withoutLookahead`) skip auto-pay's lookahead and the
  log.
- **The registry knows which names have what.** `registerScripts` notes, for every property
  of a script (each trigger hook, `doublesTriggers`, `grants`), which names have it, so an
  event offered to every permanent skips the ones that can't have the ability by name alone
  (`mayHaveScript`). Register scripts only through `registerScripts`, and don't add to a
  script after registering it.

### Keeping the table fast

What the browser spends its time on while the table is up, measured in
`docs/plans/performance.md`, and the rules that came out of it:

- **Never change the cursor on the whole page.** A cursor change repaints the element it
  changes, and the cursor is set on every element (`* { cursor: var(--cursor) }`), so a
  class on `<html>` that switched it repainted and re-rastered the whole screen on every
  press and release, 300 to 600 ms a time. The pressed-in arrow (`main.tsx`) goes on the
  one element under the pointer, and never on a floor-sized one, whose repaint is the
  table's. `:active` is no good for it either: the browser churns it during a drag. The
  same goes for anything else that changes a painted property on every element at once.
- **SVG filter textures are expensive to paint.** `--grain` (the graveyard's worn top
  card) is an `feTurbulence` filter; at screen size such a texture takes hundreds of
  milliseconds to rasterize (the old CSS floor was three of them). Keep them small, and
  never invalidate their paint per frame or per click.
- **What Motion animates every frame is a compositor layer** (`will-change: transform`,
  as the cards' proxies have): without a layer each animated frame repainted the screen
  under it.
- **Keep any always-on DOM animation stepped, or off.** An animating layer makes the
  compositor draw every frame for as long as it is up (in a software-rendered browser that
  alone halves the frame rate), but it skips frames in which nothing changed, so a pulse
  in steps (`steps(24, jump-none)`: one change every 150 ms, too small to see) draws about
  seven times a second instead of sixty. The scene itself draws every frame (the water, the
  torches); that is the table's cost, so nothing over it should add to it.
- **A bot thinks inside its timer** (`scheduleBot` in ai.ts, which drives the bots on the
  screen and on the game server), never in the effect that follows a game change:
  `botAction` can take 30 to 70 ms and would stretch the frame that draws the last move.
  The screen's bot waits `BOT_PAUSE_MIN` first, then picks its move, then acts when the
  move's own pause is up; the server's thinks at once, having no frame to keep smooth.
- **Write to the DOM only on change.** `ArrowLayer` follows cards every frame; setting an
  SVG path's `d` repaints the whole full-screen SVG, so it sets it only when it moved.
- **Every game change re-renders every card on the table**, through the view context, and
  that is correct (any move can change any card). UI-only changes (hover, drag, the hand's
  order) don't. `SeatHud` is `memo`, so `GameScreen` re-rendering without a new view (a
  speed or settings change) skips the portraits.

## Adding a card

1. Add its name to a deck in `src/cards/decklists.json`. A deck lists `commanders` (one,
   or two partners), `basics` as a map like `{ "Forest": 18, "Island": 17 }`, and
   `cards`, one of each. `"offMenu": true` keeps a finished deck off the menu (its cards
   stay in the pool and tests can still play it, from `ALL_DECKS`); `"wip": true` marks
   one still being built.
2. Run `npm run fetch-cards` to pull its data and art from Scryfall. Behind an HTTPS
   proxy (as in a Claude Code cloud session) run `NODE_USE_ENV_PROXY=1 npm run fetch-cards`:
   Node's `fetch` ignores the proxy otherwise.
3. Run `npm run parse-report`. If the card is listed as scripted, the parser handles it
   and you're done. Otherwise it names the clause it couldn't read: either add a template
   to `src/cards/oracle.ts` (for wording many cards share) or write a hand script. Read
   `docs/card-scripting.md` first: the script must follow the card's exact Oracle
   text, clause by clause. If it does more than its printed keywords, add an entry to
   `src/cards/scripts.ts` (or the deck's own file, like `kraum-tymna.ts`). The
   [script reference](#script-reference) below lists the hooks.
4. Run `npm test`. The card-pool test tells you if anything is still missing.

Once a card is in the pool it can also be used in a pasted deck, by any name `poolName`
matches.

A card pasted in a deck doesn't need to be in the pool: the app fetches it (see
[Commander and decks](rules-coverage.md#commander-and-decks)). The ones it can't play are listed in
`docs/card-requests.json`; run `/script-requested-cards` in Claude Code to add parser
templates or hand scripts for them, then `npm run recheck-requests` to take out the ones the
parser now reads. Until then a player may play such a card without its
rules text: the deck lists it in `DeckDef.textless`, the engine makes the card with
`Card.textless`, and `scriptFor` gives it the empty script (see
[Known simplifications](rules-coverage.md#known-simplifications)). `playedDeck` drops a
card from that list once it has a script, so it plays with its text again.

**Widening the parser.** `npm run parse-report` scores the parser alone on the pool and on a
corpus of real staples, `tests/parser-corpus.generated.json` (the 600 most-played Commander
cards by EDHREC rank, from `npm run fetch-corpus`). For the corpus it groups the refused
clauses by their opening words and by shape (the card's name, numbers and mana symbols set
aside), biggest group first: that is the to-do list. A template in `src/cards/oracle.ts` is a
regular expression and the helper that builds what it does, in the list for its kind of line
(effects, costs, static and card lines, trigger events); each reads its wording exactly and
refuses anything near it, and each gets a made-up card test, a game test and a near-miss test
in `tests/oracle.test.ts`. A hand script in `src/cards/scripts.ts` works for a
fetched card too, since the card is matched to it by name.

### Script reference

**Triggers**

- A trigger that only fires on some events ("whenever *another* creature enters") needs
  `{ when, resolve }`, so it doesn't go on the stack for the events it ignores. It can
  take `targets`.
- A hook can hold a list of triggers when a card has several for one event
  (`onCreatureEnters: [a, b]`, Dragon Tempest). Then each names its own `targets`
  (`onEnter` ones too) and a short `text`, and `when` may be left out for one that
  triggers on every event.
- Other trigger hooks: `onPostcombatMain`, `onDrawStep`, `onTapped`, `onDiscard`,
  `onSacrifice`, `onPlaneswalkerDies`, `onBeginCombat`, `onRingTempts` ("whenever the Ring
  tempts you", 701.54d), `onBecomesBlocked` (once for each creature blocking it, 509.3d) and
  `onChapterResolved` (a Saga's chapter ability resolved; `final` for its final chapter,
  714.2e). `onLifeLoss` tells `firstThisTurn` for the first life a player loses in a turn,
  and `onDraw` `firstInDrawStep` for the first card a player draws in their own draw step
  (504.1).
- "One or more" hooks, once for each event (603.2c): `onMilled` (the cards milled, every
  player's in one event), `onCountersPut` (a permanent and a kind of counter put on it, as it
  enters too), `onPlayerDealtCombatDamage` (a player and the creatures that dealt them
  combat damage in that step) and `onLeaveGraveyard` ("whenever one or more cards leave your
  graveyard": once for each event and graveyard, looking back in time, 603.10a).
- `oncePerTurn: true` on a `{ when, resolve }` trigger is "This ability triggers only once
  each turn": one instance a turn, even with `doublesTriggers` (101.2). "Do this only once
  each turn" (603.2h) is `didThisTurn` and `markDid`.
- A target spec with `any` can have `most`: "up to X target creatures" with X worked out from
  the source, a triggered ability's event included (`Card.triggeredBy`).
- Other hooks: `onAttackersDeclared` ("whenever you attack", once with every attack) and
  `onPermanentLeaves`, whose event says whether the permanent was `attacking`.
- Reflexive triggered abilities (603.12): `reflexive(g, self, you, key, data)` queues the
  script's `reflexive[key]`, which can have `targets` or `modes` ("When you do, choose two —",
  Caesar); its modes are chosen as it goes on the stack like any modal trigger's.
- Trigger doubling: `doublesTriggers(g, self, source, hook, event)` says whether `self` makes
  `source`'s ability on `hook` trigger once more (603.2d). `ENTERING_HOOKS` are the events
  that are a permanent entering (Elesh Norn), `ATTACKING_HOOKS` a creature attacking
  (Isshin), and `causedByCreatureDying(g, source, hook, event)` says whether a creature dying
  caused it (Teysa Karlov). Delayed and reflexive abilities are never doubled (603.2d).

**Spells and costs**

| Card | Script |
| --- | --- |
| Costs printed in rules text | `kicker`, `additionalCost` (a sacrifice), `alternativeCosts`, `costModifier` ("spells cost {1} more/less") |
| X or kicked spell | reads `self.cast.x` and `self.cast.kicked` |
| Alternative cost | can `exile` a card from the hand or `sacrifice` a permanent, or be `dash` |
| Bargain / gift | `additionalCost.optional` is bargain; `gift` promises a token |
| Modal spell | `modal` instead of `targets`/`onResolve` |
| Counterspell | targets `{ type: 'spell' }` and calls `counter` |
| Target specs | `'player or planeswalker'` and `'creature or planeswalker'` match cards that say so; `distinctFrom: i` can't repeat target `i` |
| Flashback | `flashback: '{2}{U}'` lets it be cast from a graveyard |
| Storm | needs no script |

**Permanents**

| Card | Script |
| --- | --- |
| Aura | `enchant` and `static: attachedBonus({...})` |
| Aura on a graveyard card | `enchant: { type: 'graveyard card', ... }`; an effect gives it a new enchant ability with `addLasting(g, aura, { lose: ['enchant'], enchantOf: name })` and the script's `givesEnchant` (Animate Dead) |
| Equipment | `attachedBonus` with `activated: equip('{2}')` |
| Vehicle | `activated: crew(3)` |
| Impending | spread `...impending(4, '{1}{U}{U}')` into the script: its alternative cost and end-step trigger; the engine adds the time counters and "isn't a creature" |
| Several activated abilities | list them in printed order (`activated: [ab1, equip('{1}')]`); an `activate` action and its stack item name one by `activated` (its index) |
| Activated ability options | `fromHand`, `when`, `reduction`; costs `discard`, `discardSelf`, `counters`, or `sacrificeOne` permanent that fits a spec ("Sacrifice a creature:"), `sacrificeCount` of them ("Sacrifice two ..."), `tapUntapped` ("Tap three untapped Elves you control", picked like a crew; with `tap` too, the source isn't one of them, Lathril) |
| Ward | `ward: { mana }`, `{ life }` or `{ blight }` ("Ward—Blight 2", 701.68a) |
| Modal activated ability | `modes: { min, max, modes, bot? }` instead of `targets` ("Choose one —", Breya, 700.2a); the action's `modes` are chosen as it is activated and each mode has its own targets |
| Planeswalker | `loyalty` abilities: `{ cost: -2, text, targets, resolve }`, or `cost: '-X'` |
| Siege | can add `onDefeat` |
| Faces (double-faced, split, adventurer) | one script per face, under each face's name ("Delver of Secrets", "Insectile Aberration"); `transform(g, card)` turns one over. A deck may list it by its first face's name. |
| Saga | `chapters` (`{ text, targets, resolve }`, chapter I first) |
| Class | `levels` (`{ cost, text }` for level 2, 3), reads `self.level`, `onLevel` for "when this Class becomes level N" |
| Entering | `replaceEnter` asks a choice as the card enters and calls `finishEnter`; `entersWith` adds counters; `entersTapped` can be a function (check lands); `openingHand` acts before the first turn |

An ability with {X} or −X in its cost reads the announced X as `ctx.x`. A resolve after a
sacrifice cost (ability or spell) sees `sacrificed` and `sacrificedPower` (as it was,
608.2h).

**Mana**

- `mana` can be a list of abilities, each with `colors` (a list, `'any'`, `'identity'`
  or a function), and optionally `life`, `damage`, `sacrifice`, `when`, `fromHand`,
  `manual`, `discardHand`, `instant`, `chosenType` or `subtype` ("spend this mana only to
  cast an Angel spell").
- `addMana(g, pid, ['B', 'B', 'B'], self)` for rituals; `addMana(..., { keep: true })`
  lasts the turn.
- `noUntap: true` for "doesn't untap".

**Choices while resolving**

`search(g, pid, to, find, { then })`, `ask(g, pid, { text, cost, yes, no, then })`,
`pickCards(...)` and `nameCard(...)` (a card, or `of: 'creature type'` or `'color'`,
answered as W, U, B, R or G, or `of: 'counter'` with `options`, a kind of counter) queue a question. The answer runs the script's `then[key]`
with `picked`, `yes` or `name`. Also `chooseToSacrifice`, `chooseToDiscard`,
`choosePlayer`, `offerCast` and `offerRetarget`. `pickCards(..., { min: 0, decline: "Don't
Pay" })` shows a button for picking none. A helper that asks through an engine continuation
(`@amass`, `@ringBearer`) takes the script's own `then` key and runs it once the engine's is
done (`data.next`), so the rest of the effect follows: "the Ring tempts you. Then if ...".
A search can be for `{ name }`, a card with that name.

**Static abilities and continuous effects**

A static ability (`static: (g, self, c) => ...`) says what it does to each permanent `c`:
`null` for nothing, or a `LayerParts` object (`types`, `subtypes`, `keywords`, `mana`,
`ward`, `grant`, `loseAll`/`lose` for "loses all abilities"/"loses flying",
`setPower`/`setToughness` for "base power and toughness", `power`/`toughness` for "+N/+N",
`switchPT`, …), or a list of them for a card with several abilities. "Has '[triggered
ability]'" is an entry in the card's `grants` plus `grantOf(self, i)` in `static`. A card
whose static ability takes abilities away sets `removesAbilities: true`, and a resolving
spell or ability takes them away only through `addContinuous` (or `addLasting`,
`untilEndOfTurn`), which sets `Game.abilitiesLost`: until one of those is in the game,
looking up a permanent's abilities checks nothing but names (the layer system throws if
either is missing). After that, only a permanent carrying such an effect has its layers
worked out for its abilities (`mayLoseAbilities`), unless a static ability can take them away.
`characteristics` in `layers.ts` applies every effect layer by layer (613.1), each layer
in timestamp order (613.7) unless one effect depends on another (613.8), so a script
doesn't think about order. Ask about a permanent through `g`, because another effect may
have changed it: `isCreature(g, c)`,
`hasType(g, c, 'Artifact')`, `subtypesOf(g, c)`, `colorsOf(g, c)`, `stats(g, c)`. Inside a
`static`, "creatures you control" needs `isCreature(g, c)`, while "permanents you control"
needs no type check.

Working out a permanent means asking every static ability on the battlefield, so the
engine keeps answers where it can: for a finished state (Immer freezes it), and inside
`settled(g, fn)`, for code that asks many questions without changing the game
(`checkState`'s checks, `legalTargets`; `broadcast` only queues triggered abilities).
Nothing inside `settled` may change what a permanent is.

An effect from a resolving spell or ability is locked in as it starts (611.2c), with its
own timestamp (613.7b): `untilEndOfTurn(g, c, parts)` ("gets +2/+2 until end of turn",
`pump` for just P/T), `addLasting(g, c, parts)` (for as long as it stays), or
`addContinuous(g, c, parts, until, { while })` for other durations ("until your next turn",
"for as long as you control ...").

**Replacement and prevention effects**

A static ability that says "instead", "skip" or "prevent" (614.1, 615.1) is a `replaces`
hook: given an event about to happen (`ReplaceEvent`: damage, a card changing zones, a
draw, tokens being created, counters being put on, life gained, a permanent entering, an
extra turn or draw step beginning), it returns the event that happens instead, or null.

```ts
// "If one or more tokens would be created under your control, twice that many of those tokens are created instead."
replaces: (g, self, ev) =>
  ev.kind === 'tokens' && ev.player === self.controller ? { instead: { ...ev, tokens: ev.tokens.map((t) => ({ ...t, count: t.count * 2 })) } } : null,
```

`replace` in `replace.ts` collects every effect that applies to the event, the rules'
own included (protection, finality counters, flashback, a commander's way to the command
zone), and applies each once (614.5). When the order changes the outcome, the affected
player chooses (616.1); a "you may" effect (`optional`) is asked too. A person is asked
partway through the action, which is then applied again with their answer (`Game.replay`).
`changesDamage`, `preventsDamage`, `entersTappedFor`, `skipDrawStep` and `skipsExtraTurn`
are shorthand for common ones. A card's own way of entering stays `entersTapped`,
`entersWith` or `replaceEnter`.

**Other static hooks**

`forbids` ("can't cast"/"can't activate"), `grantsFlash`, `uncounterable`,
`protectsSpell`, `ward`, `grantsEscape`, `delayedIf`, and `abilityCostModifier` ("activated
abilities of Foods you control cost {1} less", generic mana only, mana abilities included).
`ward` is mana, life, or `sacrifice` (a `TargetSpec` the payer's permanent must fit:
"Ward—Sacrifice a Food").

A static ability that gives other permanents an activated ability ("have '{2}, {T},
Sacrifice this permanent: You gain 3 life'") names a script registered for that ability alone
in `activatedOf`; the parser registers it under "[card] (ability N)".

**A permanent's abilities**

An effect can take a permanent's abilities away (layer 6, 613.1f), so the engine reads a
permanent's abilities through `abilitiesOf(g, c)`: its script, less what it has lost.
`scriptFor(c)` is the printed script, for spells, cards off the battlefield, and a spell or
ability already on the stack, which exists apart from its source (113.7a).

**Effect helpers**

| Helper | Does |
| --- | --- |
| `addCounters(g, card, n, kind)` | adds counters |
| `createToken(g, pid, 'Treasure')` | makes a predefined token (`'Food'`, `'Clue'` too) |
| `addEffect` | an effect until end of turn |
| `delay` with `delayed[key]` | a delayed trigger (603.7) |
| `extraTurn`, `winGame`, `loseGame` | as named |
| `mill`, `discard`, `discardHand`, `surveil` | as named |
| `discover(g, pid, n)` | discover N (701.57a), the cast-or-hand choice included |
| `revealUntil(g, pid, fits, what)` | "reveal cards from the top until you reveal a ... card" (701.20a): the cards revealed, still in the library, and the one that fits |
| `exileUntil(g, pid, fits)` then `castFromExiled(g, pid, hit, rest, opts)` | "exile cards from the top until ...", "you may cast that card without paying its mana cost" (`maxMv`, `toHand` for discover), and the rest on the bottom in a random order |
| `enterBattlefield(g, c, { attacking: { defender } })` | put onto the battlefield attacking what the effect names (508.4); `putAttacking(g, pid, creatures)` when the effect doesn't say: the controller chooses (mobilize, Caesar) |
| `leftGraveyards(g, cards)` | cards that left a graveyard other than by `moveCard` (cast from it), for `onLeaveGraveyard` |
| `Card.arrived` | the zone a card came from into its zone and the turn ("put there from their library this turn") |
| `exileAll(g, cards, text?, pid?)` | exiles several cards from anywhere as one event and logs once, so "whenever one or more cards are put into exile" triggers once (603.2c). Never `moveCard` cards into exile in a loop |
| `toGraveyards(g, cards)`, `destroyMany`, `dieMany` | several cards to graveyards as one event |
| `simultaneously(g, fn)` | runs `fn` as one event: "each opponent loses 1 life" in it triggers "whenever one or more players lose life" once |
| `gainControl` | changes control |
| `copyOf` | copies a permanent |
| `becomeCopy(g, card, copyOf(x))` | a permanent becomes a copy while it stays (707.4) |
| `populate(g, pid)` | copies a creature token the player chooses |
| `proliferate(g, pid)` | the player chooses permanents and/or players with counters, each gets another of each kind (701.34a); `proliferated` gives them out for a script's own continuation |
| `blight(g, pid, n)`, `eachBlights(g, pids, n)` | the player puts n -1/-1 counters on a creature they control of their choice (701.68a); `blighted` puts them on |
| `addPlayerCounters(g, pid, n, kind)`, `playerCounters(p, kind)` | counters on a player (122.1): poison, experience, rad |
| `moveCounter(g, from, to, kind)` | moves a counter (122.5), or nothing if it can't |
| `tap(g, card)` | taps a permanent and triggers `onTapped` |
| `combatDamageOf(g, c)` | the combat damage a creature assigns: its power, or its toughness under `ASSIGNS_TOUGHNESS` (Arcades, Felothar); `ATTACKS_DESPITE_DEFENDER` lets it attack with defender. Both are given through `static`'s `keywords`, like `CANT_ATTACK` |
| `basePT(g, c)` | base power and toughness (layers 7a-7b), for "power greater than its base power" |
| `abilitySource` | the source, if it is still the same object |
| `amass(g, pid, 'Orc', n, then?)` | amass (701.47); returns true if the player must choose an Army |
| `temptWithRing(g, pid, then?)` | the Ring tempts the player (701.54); returns true if they must choose a Ring-bearer. `isRingBearer`, `ringBearerOf`, `timesTempted` read it |
| `partnerWith(name)` | partner with's "enters" ability (702.124j), spread into the script |
| `tokenCopy(g, pid, c, { nonlegendary: true })` | "except the token isn't legendary" (707.9b) |

**Bot hints**

`botChoice[key]` says how a bot answers a question. `botCast` stops a bot casting the card
when the look-ahead can't see the cost (Pact of Negation). `ai: 'ritual'` or
`'extraTurn'`, and `botActivate` (told which activated ability).
