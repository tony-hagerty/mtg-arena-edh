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
                support.ts            can the engine play a card (unsupported)
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
                Card/Board/Hud.tsx    components
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
                fullscreen.ts, rem.ts Alt+Enter fullscreen; the root font-size as a hook
                util.ts               small helpers: class names, deck colours, hover props
                styles.css            all styling
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
public/         cursor.png            the mouse cursor, and cursor-down.png while a
                                      button is held (see Credits)
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
| `CardChoice` | picking cards from a list (the legend rule too) |
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
parser now reads.

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
  `onSacrifice`, `onPlaneswalkerDies`, `onBeginCombat`.

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
| Activated ability options | `fromHand`, `when`, `reduction`; costs `discard`, `discardSelf`, `counters`, or `sacrificeOne` permanent that fits a spec ("Sacrifice a creature:"), `sacrificeCount` of them ("Sacrifice two ...") |
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
  `manual`, `discardHand`, `instant` or `chosenType`.
- `addMana(g, pid, ['B', 'B', 'B'], self)` for rituals; `addMana(..., { keep: true })`
  lasts the turn.
- `noUntap: true` for "doesn't untap".

**Choices while resolving**

`search(g, pid, to, find, { then })`, `ask(g, pid, { text, cost, yes, no, then })`,
`pickCards(...)` and `nameCard(...)` (a card, or `of: 'creature type'` or `'color'`,
answered as W, U, B, R or G) queue a question. The answer runs the script's `then[key]`
with `picked`, `yes` or `name`. Also `chooseToSacrifice`, `chooseToDiscard`,
`choosePlayer`, `offerCast` and `offerRetarget`.

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
`protectsSpell`, `ward`, `grantsEscape`, `delayedIf`.

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
| `exileAll(g, cards, text?, pid?)` | exiles several cards from anywhere as one event and logs once, so "whenever one or more cards are put into exile" triggers once (603.2c). Never `moveCard` cards into exile in a loop |
| `toGraveyards(g, cards)`, `destroyMany`, `dieMany` | several cards to graveyards as one event |
| `simultaneously(g, fn)` | runs `fn` as one event: "each opponent loses 1 life" in it triggers "whenever one or more players lose life" once |
| `gainControl` | changes control |
| `copyOf` | copies a permanent |
| `becomeCopy(g, card, copyOf(x))` | a permanent becomes a copy while it stays (707.4) |
| `populate(g, pid)` | copies a creature token the player chooses |
| `tap(g, card)` | taps a permanent and triggers `onTapped` |
| `abilitySource` | the source, if it is still the same object |

**Bot hints**

`botChoice[key]` says how a bot answers a question. `botCast` stops a bot casting the card
when the look-ahead can't see the cost (Pact of Negation). `ai: 'ritual'` or
`'extraTurn'`, and `botActivate` (told which activated ability).
