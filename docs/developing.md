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
                kraum-tymna.ts        what the Kraum and Tymna deck's cards do
                pairs.ts              what the two-colour starter decks' new cards do
src/engine/     types.ts              game state, actions, card-script types
                rules.ts              queries (stats, mana, targets) + effect primitives
                layers.ts             continuous effects in layers and timestamp order (613)
                replace.ts            replacement and prevention effects, and their order (614-616)
                engine.ts             setup, turn structure, priority, the stack, applyAction()
                ai.ts                 the bots
src/net/        protocol.ts           what the game window and game server send each other
                lobby.ts              what the window and the lobby send each other
server/game/    host.ts               the game server: the whole game, bots, each seat's view
                http.ts               its web endpoints (/api/game/...)
server/lobby/   table.ts              the host's table: seats, decks, ready, starting the game
                hosting.ts            hosting: friends' TLS connections, the join code
                guest.ts              a friend's side: joining, and relaying the host's game
                lobby.ts, http.ts     this computer's lobby and its endpoints (/api/lobby/...)
src/ui/         store.ts              Zustand store (game + what the player is selecting)
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
                SoundControl.tsx      the menu's volume slider and the in-game Sound button
                styles.css            all styling
tests/                                Vitest: card coverage, rules, the UI casting flow,
                                      bot-vs-bot games
                simulation/           bot-vs-bot games, a few to a file so they run on
                                      every core at once; play.ts plays one out
                fixtures.ts           scripts for cards not in the pool yet, for testing
                fixture-cards.json    their names; fetch-cards writes their data to
                                      fixtures.generated.json
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
buttons. The menu shows the waiting room while `LobbyState.role` isn't `none`. Once
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

## Adding a card

1. Add its name to a deck in `src/cards/decklists.json`. A deck lists `commanders` (one,
   or two partners), `basics` as a map like `{ "Forest": 18, "Island": 17 }`, and
   `cards`, one of each.
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
templates or hand scripts for them. A hand script in `src/cards/scripts.ts` works for a
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
| Equipment | `attachedBonus` with `activated: equip('{2}')` |
| Vehicle | `activated: crew(3)` |
| Impending | spread `...impending(4, '{1}{U}{U}')` into the script: its alternative cost and end-step trigger; the engine adds the time counters and "isn't a creature" |
| Several activated abilities | list them in printed order (`activated: [ab1, equip('{1}')]`); an `activate` action and its stack item name one by `activated` (its index) |
| Activated ability options | `fromHand`, `when`, `reduction`; costs `discard`, `discardSelf`, `counters`, or `sacrificeOne` permanent that fits a spec ("Sacrifice a creature:") |
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
either is missing).
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
| `mill`, `discard`, `surveil` | as named |
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
