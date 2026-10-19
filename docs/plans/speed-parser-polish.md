# Plan: a faster test suite, a wider card parser, and a polished table

Goal: three things the user asked for at once, each its own session, all four run in
parallel in the cloud and reviewed as pull requests.

1. The full test suite takes far longer than it should.
2. Pasting a deck still refuses too many cards. The parser must read much more common
   wording, and the paste screen must let the group play without swapping cards first.
3. The table lacks visual polish: the board, the permanents, the library, graveyard and
   exile piles, the bottom-right controls, and the opponents' seats.

**Status: planned, sessions started 2026-10-19.**

## What was measured (2026-10-19, 16 cores)

- `npm test`: 41 files, 989 tests, 136 s wall, about 1460 CPU-seconds. The bot games in
  `tests/simulation/` are 46 games in 15 files and about 1300 of those CPU-seconds. The
  longest files take 135 s (`kuja`), 133 s (`kraum-tymna`), 124 s (`hashaton-pair`):
  the wall time is one file's games played one after another. Single games run from 4 s
  to 95 s (`hashaton-pair` seed 94: 95 s; `kuja` seed 71: 86 s; `starter-decks` seed 11:
  76 s). Outside the games: `tests/seats.test.ts` 67 s (full games at every table size),
  `tests/lobby-server.test.ts` 41 s (one test plays a whole game through the server),
  `tests/viewfor.test.ts` 36 s (two full games). Everything else together is under 20 s.
  On GitHub's 2-core runners the same run is several times longer.
- The parser (`npm run parse-report`): 497 pool cards with rules text, 151 scripted by
  the parser alone (30%), 346 refused, 281 of them "no template matches".
  `docs/card-requests.json` holds 142 cards pasted decks asked for; some entries are
  older than the parser's newest templates (the Signets are listed but now parse).
- The table today: a flat dark board with a faint diamond grid and orange side glows,
  Arena-style tiles (cropped art, name bar, P/T box), three small piles with a dashed
  outline when empty, round portraits, a fanned hand, the log bottom-left, and bottom
  right the phase tracker (seven pips, seat arrows) over the big button.

## Rules every session follows

- Do only your session's scope. The other three run at the same time on their own
  branches; don't touch their files beyond what your scope needs, so the branches merge.
- Read `CLAUDE.md` first, then the docs it names for the area you touch.
- Cite rule numbers from `docs/rules/` in comments for anything the rules decide.
- Script cards from their exact Oracle text, clause by clause (`docs/card-scripting.md`).
  Never approximate quietly.
- Bots (`src/engine/ai.ts`) must keep working with every engine change. The bot games in
  `tests/simulation/` are the check.
- While working, run one test file (`npx vitest run tests/engine.test.ts`). Finish with
  `npm test` and `npm run build` passing. Behind the cloud session's proxy, Scryfall
  fetches need `NODE_USE_ENV_PROXY=1`.
- Update the doc that describes what changed: `docs/rules-coverage.md` for rules and the
  parser's reach, `docs/how-to-play.md` for the interface, `docs/developing.md` for the
  layout and commands, `README.md` for the commands.
- Commit on your branch in small, clearly named commits, push it, and open one pull
  request against `main` whose description says what changed, what was measured before
  and after, and what was left out and why. Don't merge: the user reviews in the morning.
- Where the plan says "ask the user", the user is asleep: choose the option the plan
  recommends, say so in the PR description, and list anything that needs their decision
  under a "Decisions for you" heading there.

## Sessions

### 1. Test suite speed

**Scope:** `tests/simulation/`, `tests/seats.test.ts`, `tests/viewfor.test.ts`,
`tests/lobby-server.test.ts`, `vite.config.ts`, `package.json` scripts,
`.github/workflows/`, and the engine's hot paths in `src/engine/` (performance only, no
rules changes). Also `README.md` and `docs/developing.md` for the commands.

**Goal:** `npm test` well under a minute on a 16-core machine and under five minutes on
GitHub's runners, with the bot games still played to a finish, and the bots faster in the
real app as a side effect.

Do these in order; measure after each and put the numbers in the PR.

1. **Profile before changing anything.** Play one slow game under the profiler: a script
   in the project folder that loads `tests/simulation/play.ts` through Vite's
   `ssrLoadModule` (as `scripts/parse-report.mjs` loads modules) and calls
   `playOut(94, [hashaton, DECKS[0], { ...hashaton, id: 'hashaton2' }, DECKS[1]])`, run
   with `node --cpu-prof`. Aggregate self and inclusive time by function. Keep that script
   as `npm run profile-game -- <seed>` (`scripts/profile-game.mjs`) so the next person can
   repeat it. Name the top five hot spots in the PR.

   A first profile of that game was taken on 2026-10-19 (31 s alone on an idle machine,
   against 95 s inside the full suite: the sixteen workers contend for eight physical
   cores, so try `maxWorkers: '50%'` in `vite.config.ts` and measure). By self time, about
   45% of all samples are inside Immer's draft proxies (`isDraftable`, `get`, `has`,
   `arrayTraps`, `isPlainObject`, `shallowCopy`): reading the game through a draft inside
   `produce` is the dominant cost, not copying it. By inclusive time: `botAction` 78%, of
   which `bestPlay` 75% and its `resolveStack` 53%; inside the engine `act` 44%, `settle`
   44%, `checkState` (`rules.ts`) 35%, the layer walk (`layers` and `entries` in
   `layers.ts`) 31% and 21%, `passPriority` 20%, `broadcast` 14%, `settled` 11%,
   `planFrom` and `planPlain` (payment) 9% and 8%, `canCastAs` 7%, `legalTargets` 6%,
   `log` 6%. Project functions high in self time: `entries` (layers.ts:344) 6%,
   `layers` (layers.ts:579) 3%, `characteristics` 2%, `scriptFor` 2%, `log` 2%,
   `staticSources` 2%, `checkState` 2%, `copyData` 1%.

2. **Make the engine faster where the profile says**, without changing any rule. Starting
   points, in the order the profile suggests:
   - **Reads through Immer drafts.** Everything `act` and `settle` ask about the game
     goes through proxy traps. Read-only questions (`checkState`, `layers`, `legalTargets`,
     `canCastAs`, `wantsPriority`, the bot's `evaluate`) could read the plain object:
     Immer's `current(draft)` costs a copy, so look instead at where a read-heavy pass can
     run on the finished state between produces, or at keeping the arrays those passes
     walk (`battlefield`, `players`) out of the draft until they are written. Measure each
     idea on the profile script before keeping it.
   - **`checkState` and the layer walk** (`entries`, `layers`, `staticSources`): how
     often they run per action (every priority pass?), whether the answers are memoised
     while the game doesn't change (`settled`, `heldMemo`, `storeFor` in `layers.ts`: the
     memo relies on Immer freezing finished states), and whether a cheap "nothing changed
     since last check" test can skip them.
   - **The bot's lookahead** (`bestPlay`, `resolveStack`, `outcome`, `finishCombat` in
     `src/engine/ai.ts`): `applyAction` with `simulate` for every candidate, then the
     whole stack resolved for each. Prune candidates that can't change the score, share
     the baseline, and avoid resolving the stack twice for the same state. Keep the bots'
     choices the same where the games' outcomes are checked (the seeds must still finish;
     a different winner on a seed is acceptable if the game is still consistent).
   - **`log`** (`rules.ts`) at 6% inclusive during simulation: a simulated move's log is
     thrown away; skip building it under `simulate`.
   - `checkInvariants` in `tests/simulation/play.ts` walks every zone after every action;
     it doesn't show in the profile, so leave it.
   Every optimisation keeps `npm test` green; the bot games are the regression test.
   Report the speed-up per change in the PR, and the final profile's top ten.

3. **Lay the suite out so the cores stay busy.** The wall time is the longest file, and
   files hold two to six games. Put each bot game in its own file (or make the sequencer
   split them: one spec per seed), so 46 games spread over every core and the wall time
   drops toward the longest single game. Keep `BotGamesFirst` in `vite.config.ts`. Keep
   the seeds as they are: they are the regression set.

4. **Split the commands.** `npm test` stays the full run (CLAUDE.md promises it). Add
   `npm run test:quick` (everything but the bot games and the other whole-game files:
   `seats`, `viewfor`, `lobby-server`'s whole-game test) for use while working, and
   `npm run test:games` for the games alone. In the release workflow, run the games as
   their own job so the quick job reports fast; keep the total under the workflow's
   timeouts. Document the three commands in `README.md` and `docs/developing.md`.

5. **The three slow non-game files.** `seats.test.ts` plays full games at every table
   size with the bots; `viewfor.test.ts` plays two full games checking `viewFor` after
   every action; `lobby-server.test.ts` plays one through the server. Keep what they
   check, but make them cheaper where they can be: play to a fixed turn rather than to a
   finish where the finish isn't the point, or check every Nth action. Say in the PR what
   each test still proves.

**Don't:** drop seeds, cap games short of a finish in `tests/simulation/`, loosen
`checkInvariants`, or change any rule. If the engine work turns up a rules bug, note it
in the PR and leave it.

### 2. The Oracle text parser

**Scope:** `src/cards/oracle.ts`, `tests/oracle.test.ts`, `src/cards/decklists.json`
(tokens only), `src/engine/rules.ts` only to add small helpers the templates need,
`docs/rules-coverage.md` ("Scripts from Oracle text"), `docs/card-requests.json`
(remove what now parses). Hand scripts for one-off cards go in `src/cards/scripts.ts`.

**Goal:** the parser reads a large share of the common wording in real Commander decks,
measured, not guessed. Target: the parser alone scripts at least 60% of the pool's cards
with rules text (30% today), and a corpus of real staples scores at least as high.

Work in this order:

1. **Build the corpus first.** Add `scripts/fetch-corpus.mjs` that pulls the Oracle text
   of the 600 most-played Commander cards from Scryfall
   (`/cards/search?q=format:commander&order=edhrec`, paged, polite delay, the same
   headers `scripts/fetch-cards.mjs` uses; `NODE_USE_ENV_PROXY=1` behind the proxy) into
   `tests/parser-corpus.generated.json` (name, Oracle text, type line, keywords, faces),
   data only, no images. Extend `src/cards/oracle-report.ts` and `npm run parse-report`
   to score that corpus too, with the refused clauses grouped by shape (names and numbers
   set aside) and counted. The report's group counts are the to-do list: work from the
   biggest group down. Commit the corpus file (it is generated; say so in
   `docs/developing.md` like the other generated files).

2. **Fix the general gaps before adding templates.** Each of these unlocks many cards:
   - **Two abilities on one event** ("two abilities that trigger on the same event"): the
     engine takes a list of triggers per hook (`onEnter: [a, b]`, see `docs/developing.md`
     "Triggers"). Build lists instead of refusing.
   - **Ability-word labels** ("Metalcraft — {T}: ...", "Channel — {3}{U}, Discard this
     card: ...", "Threshold —", "Bloodrush —", "Landfall —"): 207.2c says the word is a
     label with no rules meaning. Strip it before reading the line, except where the
     ability word names a condition the template must then read ("Activate only if ...").
   - **Cards with faces** ("a card with more than one face"): read each face on its own,
     register one script per face name as hand scripts do (`docs/developing.md`,
     "Faces"). Modal double-faced lands (Malakir Rebirth // Malakir Mire, Sejiri Shelter,
     Silundi Vision, Valakut Awakening, Ondu Inversion, Boggart Trawler, Witch Enchanter,
     Waterlogged Teachings, Sink into Stupor, Bloodsoaked Insight, Glasspool Mimic ...)
     are the most pasted refused cards: their back is "~ enters tapped" or the pay-3-life
     line, and their front is a simple spell or creature. Adventure cards next.
   - **Tokens described in the text** ("create two 1/1 white Soldier creature tokens with
     lifelink", "a 3/3 green Beast creature token", "a Treasure token"): today only a token
     listed in `decklists.json` matches. Read the description into a token definition
     (power, toughness, colours, creature types, keywords the engine knows) and register it
     on the fly, keyed like the listed tokens (`Beast 3/3`), with the listed one winning
     when both exist so its art shows. A token "with" a quoted ability stays refused unless
     a template reads that ability.
   - **Targets** (`targetSpec`): "up to one/two/three target X" (count 0..N), "any number
     of target X", "another target X", "target X or Y or Z" lists ("artifact, creature, or
     planeswalker"; "artifact, enchantment, or land"), "attacking or blocking creature",
     "tapped creature", "creature with power N or greater/less", "with mana value N or
     less", "nonland permanent", "noncreature", "target spell", "target creature spell",
     "target card from a graveyard", "target X card in your graveyard", "target X card
     from a graveyard". The engine's `TargetSpec` already has `type: 'spell'`,
     `'graveyard card'` and filters; check what `legalTargets` supports before adding.
   - **Untargeted groups**: "each creature", "each opponent", "each player", "each other
     player", "all creatures", "all tapped creatures", "all X your opponents control",
     "creatures you control", "each creature with flying" as the object of damage,
     destroy, exile, tap, untap, -N/-N, +N/+N, counters, sacrifice. One reader for the
     group phrase, used by every verb, running as one event (`simultaneously`,
     `destroyMany`, `exileAll`, `toGraveyards`).
3. **Add the templates the corpus asks for most.** From the pool and the requests, the
   big groups are:
   - **Triggers:** "At the beginning of your upkeep / end step / combat / precombat main",
     "Whenever ~ deals combat damage to a player", "Whenever another creature you control
     enters / dies", "When ~ enters or attacks", "Whenever ~ enters or dies", "Whenever
     you gain life", "Whenever ~ becomes tapped / untapped", "Whenever a creature an
     opponent controls dies", "Whenever you draw a card", "Landfall" ("whenever a land
     you control enters"). Use the hooks `Triggers` in `src/engine/types.ts` already has;
     add a hook only when the engine fires the event already.
   - **Effects:** "counter target spell" (and "unless its controller pays {N}"), "scry
     N", "look at the top N cards of your library, put one into your hand and the rest on
     the bottom in a random order", "draw a card for each X", "gain/lose life equal to
     ...", "each opponent discards a card / sacrifices a creature", "return target X card
     from your graveyard to your hand / the battlefield", "tap / untap target X", "target
     creature gains K until end of turn", "target creature gets +N/+N and gains K", "~
     fights target creature", "deals damage equal to its power", "put N +1/+1 counters
     on each creature you control", "~ enters with N X counters", "proliferate" only if
     the engine knows it, "take an extra turn after this one" (`extraTurn`), "you may
     cast spells as though they had flash" (`grantsFlash`), "~ can't be blocked",
     "protection from X".
   - **Modal spells:** "Choose one —" / "Choose one or more —" / "Choose two —" with the
     modes as bullet lines, each mode read by the clause reader (`modal` in `CardScript`).
     Spree the same way with its mode costs.
   - **Statics:** "Enchant creature" with "Enchanted creature gets +N/+N [and has K]"
     (`enchant` + `attachedBonus`), "Equipped creature gets/has ..." with "Equip {N}"
     (`equip`), "Creatures you control get +N/+N" variants already read, "~ gets +1/+1
     for each X you control", "Ward {N}" (`ward`), "~ can't be countered" is read, "Other
     X you control have K".
   - **Costs and keywords with costs:** "Kicker {cost}" (`kicker`), "Flashback {cost}"
     (`flashback`), "Equip {N}", "Crew N", "Cycling" is read, "Escape—{cost}, Exile N
     other cards from your graveyard" (`escape`), "Overload {cost}", "Spectacle {cost}",
     "Offspring {cost}" (`offspring`), "Convoke" (`grantsConvoke` exists for granting;
     check how a spell's own convoke is handled), "Madness". Mana abilities with other
     costs: "{T}, Sacrifice ~: Add ...", "{T}, Pay 1 life: Add ...", "Discard a card: Add
     ...", "Tap an untapped creature you control: Add ..." (`ManaAbility` has `sacrifice`,
     `life`, `damage`; add what is missing in `rules.ts`), "Add {B}{B}{B}", "Add one mana
     of any color that a land an opponent controls could produce".
4. **Keep the parser honest.** A template reads a wording exactly and refuses anything
   near it that it doesn't cover (`docs/card-scripting.md`). For each template add to
   `tests/oracle.test.ts`: a `fake` card with the wording, what it does in a game, and a
   near miss it still refuses. After each batch, run `npm run parse-report` and
   `npx vitest run tests/oracle.test.ts`, then the bot games.
5. **Requests file.** Re-run the entries of `docs/card-requests.json` through the parser
   and remove the ones it now reads (`removeRequests` in `src/cards/requests.ts`). What
   is left is the next session's list; leave it.

**Don't:** approximate a clause (a card the engine can't do exactly stays refused, and
the reason says what is missing), rewrite the parser's structure (keep templates as
readable regex-plus-helper pairs so the next person can add one in minutes), or script
one-off cards by hand except where one is a staple in the corpus's top 100.

### 3. Pasting a deck without the swap-and-script loop

**Scope:** `src/ui/Menu.tsx` (the paste screen), `src/cards/decklist.ts`,
`src/cards/db.ts`, `src/cards/support.ts`, `src/cards/fetched.ts`, `src/ui/store.ts`
where decks are saved, `src/engine/` only for how an unscripted card is played, a small
badge in `src/ui/Card.tsx`, styles appended at the end of `src/ui/styles.css` (session 4
is reworking that file: add, don't reorganise), `docs/how-to-play.md`,
`docs/rules-coverage.md` ("Known simplifications").

**Goal:** a group pastes four decks and plays tonight, even when some cards aren't
scripted yet. Today a deck with one refused card can't be saved at all.

1. **Play a refused card as printed, by choice.** For each refused card the paste screen
   offers **Play without its rules text**: the card is in the deck with its real name,
   cost, types, power and toughness and the keywords the engine knows, and the rules
   text the game can't read does nothing. The engine plays it as a vanilla card. This is
   never silent: on the paste screen the card is listed under its own heading with the
   clause the game can't read; on the table its tile and hand card carry a small, plain
   "no text" badge and a dimmed name bar; hovering shows the card with the same note; the
   log says "(its rules text doesn't work here)" the first time it is cast; the deck tile
   on the menu says "3 cards play without their text". The choice is saved with the deck
   and can be undone there. A commander can't be played this way (its text is the deck).
   A card the engine can't represent at all (an unsupported keyword that changes how it
   is cast, like a split card the engine can't frame) stays refused with the reason. Write
   it up under "Known simplifications".
2. **Let a deck be saved with refused cards, marked.** Saving a deck with refused cards
   left over (not chosen to play as printed) is allowed too: the deck is greyed out on the
   menu with "N cards the game can't play yet" and a button to open it in the paste
   screen with those cards at the top, so a friend can swap them at their own pace instead
   of re-pasting a hundred lines.
3. **A better refused list.** Group the refused cards by the clause the parser named,
   show the Oracle line it stumbled on, and, for each, the choice (play as printed, or
   swap). Keep the "written down for Claude" note and the download. A card refused for
   Commander legality stays as it is.
4. **Common list formats.** Check `parseDeckList` against what Moxfield, Archidekt, Arena,
   MTGO, TappedOut and plain text export today (sideboard markers, "SB:", set codes with
   collector numbers, "x4" suffixes, category headings like "Creatures (12)", a
   "Commander:" line, the partner on two lines). Add the ones it doesn't read with tests
   in `tests/decklist.test.ts`.
5. **Tests:** `tests/view.test.ts` for the paste flow (the store and `checkList`),
   `tests/engine.test.ts` for a vanilla-played card casting, attacking and dying like a
   plain creature, and the bots not breaking on it.

**Don't:** change the parser (session 2), or let a card play with a script that isn't its
own.

### 4. Visual polish of the table

**Scope:** `src/ui/styles.css`, `src/ui/Board.tsx`, `src/ui/Card.tsx`, `src/ui/Hud.tsx`,
`src/ui/GameScreen.tsx`, `src/ui/TextCard.tsx`, `src/ui/Flights.tsx` where a redesign
moves something they measure, `docs/how-to-play.md` where a control changes.

**Goal:** the table looks like something a group would choose to play on: the board, the
permanents, the piles, the bottom-right controls, and the opponents' seats. Arena is the
reference for feel; the game's own identity (gold serif headings, the card frame colours,
the deck-coloured seats) stays. Use the `impeccable` skill for the design pass and iterate
in the browser (`npm run dev`, port 5180; Chromium and Playwright are available in the
cloud session), with screenshots before and after in the PR.

Read `docs/developing.md` "Sizing the UI" first: everything is in `rem`, placed from an
edge or the middle. Keep every control where `docs/how-to-play.md` says it is unless you
update the doc. Keep `data-*` attributes and class names the code reads (`data-card`,
`data-library`, `data-pile`, `data-hand-of`, `.hand`, `.card-back`, `.tile`): the
animations in `Flights.tsx` and `Card.tsx` measure them.

Do these in order, committing each:

1. **Design tokens.** Turn the loose colours in `styles.css` into a small set of
   variables on `:root`: surfaces (board, panel, raised panel), text (primary, muted),
   the gold accent, the two action colours (cyan play, yellow target), borders, shadows
   and a few radii. A short comment block at the top names them. Everything after uses
   them.
2. **The board.** Replace the flat grid with a table that has depth: a dark felt or
   stone surface with a subtle texture, a vignette, a soft light from above, the seat
   areas as faintly marked zones that take the player's deck colour at the edge, and the
   active player's seat lit. Keep it quiet: cards are the content.
3. **Permanents (tiles).** Give the tile a real card frame: a thin bevelled border in the
   frame colour, the art with a slight inner shadow, a name bar that reads at every tile
   size (`font-size` scales with `--tw`), a P/T box that looks like one, counters and
   keyword icons that don't collide, a clear tapped state (the rotation plus a dim), and
   summoning sickness, attacking, blocking and targetable states that read at a glance.
   Attached Auras and Equipment fanned behind, as now, but tidier. Piles of tokens and
   lands show their depth with offset edges.
4. **Library, graveyard and exile.** Make the three piles look like piles: the library a
   stacked deck with a proper card back design (replace the two-ellipse back with
   something that looks designed: a dark field, a gold rule, a central mark; it is also
   used for opponents' hands), the graveyard the top card with a worn edge, exile the
   top card desaturated with a cool ring, the counts as readable badges, the empty state
   as a quiet outline with the zone's icon. Same treatment at every seat, turned for the
   side seats.
5. **The bottom-right controls.** Make the phase tracker, seat arrows, stop marks, turn
   label and the big button one designed panel: a plate with a clear hierarchy (the big
   button first, the turn and step second, the pips third), the pips readable as a turn
   strip with the current step clearly lit, stops visible but not loud, the seat arrows a
   compact dial. Keep every behaviour (`docs/how-to-play.md`, "The stack and your
   stops"). The prompt bar above the hand and the hold toggle get the same plate style.
6. **Opponent seats.** Review the three opponent layouts (top, left, right): the
   portrait, life, commander damage badges, hand fan, piles, and the two rows. Make the
   portrait and life total the clear anchor of each seat, align the piles with it, give
   the side seats' turned rows the same spacing rhythm as the top seat, and check a
   crowded board (ten lands, eight creatures, attachments) at each seat still fits. The
   human's seat gets the same anchor treatment: portrait, mana pool and piles aligned
   with the hand.
7. **Check** at 1920×1080, 2560×1440, an ultrawide and a 4:3 window, with reduced motion
   on, and in a four-player game past turn ten. `npm test` (the view tests drive the
   store, not the DOM, so they should pass untouched) and `npm run build`.

**Don't:** change what any control does, add sound or music, touch the menu screens
(`Menu.tsx`, `LobbyScreen.tsx`), or restyle the pickers and modals beyond the tokens
(they inherit the variables; a later pass does them).
