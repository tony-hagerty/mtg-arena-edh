# Plan: fixes and polish

Goal: the fixes and polish the user asked for after the decks were in: an interface that
shows what is happening, stops and priority that behave, and a few rules bugs. The
eleven requests are grouped into seven sessions, each on its own branch, that can run at
the same time.

**Status: planned.**

## Rules every session follows

- Do only that session's scope. Leave the rest to the other sessions.
- Read `CLAUDE.md` first, then the docs it names for the area you touch.
- Reproduce a bug before fixing it: a failing test, or the real app (`npm run dev`,
  Chromium and Playwright are installed in cloud sessions), and say in the commit message
  what the cause was.
- Cite rule numbers from `docs/rules/` in comments.
- Add tests where the code can be tested: `tests/engine.test.ts` or a deck's file for
  rules, `tests/view.test.ts` for the store and view, `tests/sounds.test.ts` for sounds.
  Keep the bot games in `tests/simulation/` passing.
- Keep each change to its own area, so the branches merge cleanly. Styling goes in
  `src/ui/styles.css` next to the rules it changes; don't reorganise the file.
- Finish with `npm test` and `npm run build` passing, and update the docs that describe
  what changed: `docs/how-to-play.md` for the interface, `docs/rules-coverage.md` for
  rules, `docs/developing.md` for the layout.
- Commit on your branch with a clear message and push it. Don't open a pull request; the
  user reviews the branch.

## Sessions

### 1. One trigger for one event (Ketramose and "one or more")

**Request:** Ketramose, the New Dawn draws once per exile event, but Bojuka Bog exiling a
graveyard makes it draw once per card. "Whenever one or more cards are put into exile"
triggers once for the whole event, however many cards it moved (603.2, 603.2e).

**Where it goes wrong:** `moveCard` in `src/engine/rules.ts` reports each exiled card
through `leaves()`, which fires `onExiled` at once unless a `simultaneously()` batch is
open. Code that exiles several cards in a loop without `simultaneously` fires the trigger
once per card:

- `src/cards/oracle.ts` ~266, the "exile target player's graveyard" template (Bojuka Bog
  comes from a pasted deck, so it is scripted here).
- `src/cards/scripts.ts` ~661, the same wording by hand.
- Loops in `src/cards/kraum-tymna.ts` (~591, ~652, ~702), `src/cards/kuja.ts` (~703),
  `src/cards/hashaton.ts` and anywhere else `moveCard(g, c, 'exile')` or `exile(g, c)`
  runs inside a loop. `src/cards/ketramose.ts` (~223, ~290, ~695) shows the right shape.

**Do:**

- Add one helper in `src/engine/rules.ts` (for example `exileAll(g, cards)`) that moves
  the cards as one event inside `simultaneously`, logs once, and use it everywhere a
  script or template exiles several cards at once. Mill, "put into graveyard" loops and
  "exile each" board wipes get the same look: any effect that moves several cards in one
  event must go through one batch.
- Audit every "one or more" trigger hook in `src/engine/types.ts` (`onExiled`,
  `onLifeLossTogether`, `onCounters`, "whenever one or more creatures attack/die" if any,
  Y'shtola's `onLifeLossTogether` in `src/cards/yshtola.ts`) and every effect that could
  feed it several things at once. Fix each place that fires per item, and list in the
  commit message which cards were affected.
- Tests in `tests/ketramose.test.ts`: Ketramose on the battlefield on your turn, Bojuka
  Bog entering and exiling a graveyard of three cards draws one card and loses 1 life;
  a board wipe exiling several permanents draws once; two separate exile events still draw
  twice. One test per other hook you fixed.

### 2. Priority and stops: Full Control, alternative costs, the skipped main phase

Three requests that live in the same code: `wantsPriority`, `nextStop`, `canAct` and
`settle` in `src/engine/engine.ts`; `priorityView` in `src/ui/view.ts`; `ActionBar`,
`HoldToggle` and `PhaseTracker` in `src/ui/Hud.tsx`; the stops in `src/ui/store.ts`.

**2a. A main phase skipped after a fetchland.** The user plays a fetchland (for example
Polluted Delta: "{T}, Pay 1 life, Sacrifice this land: Search your library for an Island
or Swamp card, put it onto the battlefield, then shuffle"), cracks it, picks the land, and
the game goes straight past their main phase. Find out why. Things to check: what
`settle` does after the search decision (`chooseCards`) is answered: who has priority, is
`g.passes` right, do the human's stops reach that `applyAction` call (`applyOptions` in
`src/ui/store.ts`) or do the defaults apply; whether it depends on the land coming from a
hand script (`fetchland` in `src/cards/kraum-tymna.ts`) or the Oracle parser's template
(`src/cards/oracle.ts` ~345); whether a stop in `main1` is `always` for the seat in
question (`absoluteStops` maps stops by seat counted from the human's). Write a test in
`tests/engine.test.ts` or `tests/view.test.ts` that fails today: after the fetch resolves
the human still has priority in their main phase.

**2b. Stops with an alternative cost available.** With Solitude in hand and a white card
to pitch to its evoke cost (702.74), the game's stops misbehave. Reproduce with a test
first and say what actually happens: it stops at every `ifAble` step because `canAct` is
true, the Next button forecasts the wrong step (`nextStop`), or it fails to stop where a
stop is set. Note that `canCastAs` counts alternative costs as routes, so a pitch spell
makes `canAct` true in every step: an `ifAble` stop then stops everywhere. If the
behaviour is right by the rules but surprising, make the prompt say why the game stopped
("You could cast Solitude") and make sure the Next button says where it will really stop.
Fix any real bug.

**2c. Full Control mode.** A toggle, Ctrl+Shift (both pressed together, no other key),
that while on:

- stops for the human at every step where a player gets priority, on every turn, with
  the stack empty or not (502.4 and 514.3 steps excepted);
- keeps priority after each spell or ability they cast or activate (`hold`, 117.3c), so
  the Hold checkbox defaults on;
- shows that it is on, clearly but small, near the phase tracker, and the prompt says
  "Full control" where it stops only because of it.

Turning it off returns to the saved stops. Implement it as an engine-side `ApplyOptions`
setting or as a stops override from the store, whichever is cleaner; it must also work in
a table game (the server applies the human's stops: `prefs` in `src/net/protocol.ts` and
`server/game/host.ts`). Bots never use it. Document it in `docs/how-to-play.md` under
"The stack and your stops" and "Controls".

### 3. Attached cards always visible, and right-click in the graveyard

**3a. Equipment and Auras hide behind the permanent.** Attachments are drawn by
`Attachments` in `src/ui/Card.tsx` as thin strips above the permanent (`.tile-attached`
in `src/ui/styles.css`, `z-index: -1`). In play they end up hidden. Reproduce in the
browser (equip Lightning Greaves in the Kuja deck, or any Aura): a likely cause is that
`z-index: -1` falls below the row or board background when the tile's `motion.div` has no
transform and so no stacking context, and a tapped or attacking tile moves out from under
them. Redesign so an attached card is always visible: for example fanned behind the
permanent with its name strip and art showing, lifting with it when it attacks, taps or
glows, and still clickable (equip) and hoverable. It must survive several attachments, a
tapped permanent and the opponents' smaller tiles.

**3b. Graveyard cards can't be right-clicked to preview.** Right-click pins the card under
the pointer (`Preview` in `src/ui/Hud.tsx`, the `contextmenu` listener), but it reads the
store's `hover`, which only hand and board cards set through `hoverProps`
(`src/ui/util.ts`). The cards in `ZoneViewer` (graveyard and exile) set no hover, so
right-click does nothing there. Give them the same hover and right-click behaviour as
cards on the board, and make sure the pinned preview draws above the viewer's modal.

Add a view test where you can; the rest is checked in the browser with a screenshot in the
commit message's description of what changed.

### 4. Animations: show things happening

Other than a spell going on the stack, it is hard to see things happen: a creature
resolving onto the battlefield, a card going from hand to the stack, cards going to the
graveyard, triggers resolving. Add motion for the moves between zones, using the `motion`
library already in use (`layoutId` on `Permanent` in `src/ui/Card.tsx`, `AnimatePresence`
in `src/ui/Board.tsx`, `SpellFlash` and `StackPanel` in `src/ui/Hud.tsx`).

- Hand to stack, stack to battlefield (a permanent spell resolving), stack to graveyard
  (an instant or sorcery resolving, a countered spell), battlefield to graveyard or exile
  (dying, sacrifice, exile), library to hand (draw) where the card is the human's, and
  tokens appearing. Cards fly to where they go: the graveyard pile, the exile pile, the
  hand. Share `layoutId`s across zones so one element moves, or animate a flying copy from
  the old rectangle to the new one; the piles' positions are in the DOM.
- A short highlight when a stack item resolves, and the log line it made, so a resolve is
  seen not just inferred.
- Fast bots (the Speed button) must not pile up animations; cap or shorten them when the
  game changes again before one ends. `MotionConfig reducedMotion="user"` must keep
  working, and `motionConfig.skipAnimations` in dev.
- Everything that moves must still be clickable, hoverable and right where the view code
  puts it once the animation ends (`cardAt` in `src/ui/Hud.tsx` reads the DOM).

Check it in the browser with Playwright (a short video or a few screenshots described in
the commit). `tests/view.test.ts` must keep passing.

### 5. A more elegant log bar and start menu; drop the Kraum and Tymna deck from the menu

**5a. The log bar.** The buttons beside the log (`LogPanel` in `src/ui/Hud.tsx`: Show log,
Speed, Sound, Damage, Pause, Exit) are a row of plain buttons. Make them read as one
control: icons with labels on hover, a settings popover for the ones that are settings
(speed, damage, sound), a clear Exit, the log toggle part of the log's own edge. Keep every
function and its keyboard access, and the pause button for table games.

**5b. The start menu.** `DeckMenu` in `src/ui/Menu.tsx` (title, deck shelf, opponents,
actions). Make it feel like a game's title screen: hierarchy, the decks as the centre with
their art and colours, the seats and the actions (paste, host, join, saved games, watch
the bots) arranged, not stacked. Keep the paste, host, join, saved-games and waiting-room
screens working as they are (`src/ui/LobbyScreen.tsx` can stay) but match their frame to
the new menu.

**5c. Remove the Kraum and Tymna deck from the menu.** Keep its cards in the pool and
its scripts in `src/cards/kraum-tymna.ts`, so pasted decks that use them still play, and
keep its bot game if the list can live in the test. The deck leaves `DECKS` and the menu
only. Update `README.md` ("Five decks built in"), `docs/developing.md` and
`docs/rules-coverage.md` where they count or name it.

Check in the browser at 1920×1080 and a narrow window; everything is sized in `rem`.

### 6. The black screen after Kaya's Ghostform, and an error screen with a log

Two people at a table (one hosting, one joined) both saw a black screen after Kaya's
Ghostform (`src/cards/kuja.ts`) was cast and the stack resolved. There is no React error
boundary (`src/ui/App.tsx`), so a throw while rendering unmounts everything, and the page
reports nothing to a file: `ArenaEDH-data/launcher.log` (`launcher/paths.ts`) holds only
the launcher's own lines.

- Find the crash. Candidates: rendering an Aura attached to something (`Attachments` and
  `Permanent` in `src/ui/Card.tsx`, `attachmentsOf`), the seat's view of the game
  (`src/engine/view.ts`, which strips hidden cards: an attachment whose target is hidden
  or gone), the ability returning a card to the battlefield (`onPermanentLeaves`,
  `wentTo`, `enterBattlefield`), and `priorityView` or `cardAt` reading something that
  isn't there. Both players went black, which points at the game state or the view each
  seat gets rather than one window. Reproduce with a test (`tests/view.test.ts` drives
  the store without rendering; `tests/viewfor.test.ts` covers seat views) or in the
  browser with two windows against `npm run dev`. Fix the cause and add the test.
- Add an error boundary around the game screen that shows the error and the last log
  lines, with buttons to copy the details and to leave to the menu, instead of a blank
  page. Report uncaught page errors and render errors to the launcher's log through the
  game server (a small endpoint beside `/api/game`), so a crash on the Windows build
  leaves a line in `ArenaEDH-data/launcher.log`. Say in `docs/how-to-play.md` and
  `launcher/README.md` where the log is.

### 7. Ambient background music (lower priority)

Ambient, high-fantasy, instrumental music under the game. There are no sound files in the
project and the sounds are synthesized in `src/ui/synth.ts`, so prefer generative music
with the Web Audio API: slow pads, a drone, a sparse melodic line in a modal scale,
evolving so it doesn't loop audibly, quiet by default. If a real recording would be much
better, it must be licensed for redistribution (CC0 or similar), credited in `README.md`
under Credits, and small enough for the single-file build.

- A music volume separate from the sound volume (`SoundControl` in
  `src/ui/SoundControl.tsx`, settings in `src/ui/store.ts`), remembered like the rest.
- Starts on the first click (browsers keep pages silent until then, see `play` in
  `src/ui/sound.ts`), pauses when the window is hidden, stops on the menu or carries on
  quietly, whichever sounds better.
- Tests in `tests/sounds.test.ts` for what can be tested (settings, start and stop
  rules).
