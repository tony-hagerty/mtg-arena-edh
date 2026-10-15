# Plan: new features

Goal: the features the user asked for after the Commander-decks plan
(`docs/plans/commander-decks.md`) was finished. Each is its own session, started only when
the user says so, one at a time.

**Status: sessions 1 and 2 done. The user answered the first round of questions; the decisions
are written into each session.**

## Rules every session follows

The same as in `commander-decks.md`, plus one:

- Do only that session's scope. Leave other gaps to later sessions.
- Cite rule numbers from `docs/rules/` in comments (see `CLAUDE.md`).
- Script cards from their exact Oracle text, clause by clause (`docs/card-scripting.md`).
- Bots must use each new feature (`src/engine/ai.ts`), or at least not break on it.
- Add tests in `tests/engine.test.ts`. Keep `tests/simulation.test.ts` passing.
- Finish with `npm test` and `npm run build` passing, and update `README.md`
  ("What works", "Known simplifications", "Adding a card").
- Ask the user before committing.
- **Choices belong to the player.** Wherever the rules give a player a choice, the human
  can make it. Where most players won't care, a setting can make it automatic (the
  default being the sensible automatic choice), so lazy play stays quick. Settings are
  saved in the browser like the stops are.

## Sessions

Order matters. 1, 2, 3 and 4 are mostly independent; 3 uses 2. 5 comes before 7, and 6
before 7.

### 1. Several triggered abilities for one event, and Dragon Tempest (done)

Today `CardScript` has one hook per event (`onEnter`, `onDies`, ...; `Triggers` in
`src/engine/types.ts`), and a triggered `StackItem` records only its `hook`. A card with
two "whenever ... enters" abilities can't be scripted.

- A hook may hold a list of triggers (`onEnter: [t1, t2]`). A single trigger keeps
  working, so no existing script changes.
- Each one triggers on its own (603.2): its own `when`, its own targets (603.3d), its own
  stack item. `StackItem` gets an index (for example `trigger?: number`) beside `hook`,
  so resolving, target checks (608.2b), the trigger-ordering window (603.3b) and the
  stack panel text use the right one.
- Everything that looks up "the" trigger for a hook goes through one helper (engine, AI
  look-ahead, UI text, copies such as Mockingbird that copy abilities).
- Each trigger can carry its own `text`, so the stack and the ordering window show which
  ability it is.
- Add **Dragon Tempest** to "Fire and Fang" in place of one card (deck stays 100,
  `deckProblems` passes). Claude picks the weakest non-land card and names it in the PR.
  Check its Oracle text in `cards.generated.json` after `npm run fetch-cards`. As of
  writing it has two abilities: a flying creature you control entering gains haste until
  end of turn, and a Dragon you control entering deals X damage to any target, X = the
  number of Dragons you control. "It deals" means the entering Dragon is the source (last
  known information if it has left), and X is counted as the ability resolves (608.2h).
- Remove the Dragon Tempest sentence from README's "Known simplifications".
- Tests: both abilities trigger from one Dragon with flying; each can be ordered; a
  non-flying Dragon triggers only the damage one; a flier that isn't a Dragon only the
  haste one.
- Done. Dragon Tempest replaced Fire Elemental (Goblin Piker, the first pick, is used by
  many tests). No Dragon without flying is in the pool, so that test is left out; an
  opponent's Dragon is tested instead. `scripts/fetch-cards.mjs` now waits 500 ms between
  Scryfall requests: at 150 ms Scryfall answered 429 (too many requests) and token art
  came back empty.

### 2. Several activated abilities on one card (done)

Today `CardScript.activated` is a single ability (README: "A card can have only one
activated ability"). Many common cards have more, for example **Deathrite Shaman** (three),
and Equipment with another ability besides equip.

- `activated` may be a list. The action that activates names the ability by index, as
  loyalty abilities already do (`ability` in the action, 606).
- Each ability keeps its own costs, timing (`sorcery`), `when`, targets and resolve.
- An ability with a target is not a mana ability even if it adds mana (605.1a): Deathrite
  Shaman's first ability ("Exile target land card from a graveyard. Add one mana of any
  color.") uses the stack.
- UI: clicking a permanent with two or more abilities opens a small menu listing them by
  their text (like the planeswalker menu); with one, it works as now. Mana abilities stay
  as they are (`mana` is already a list).
- Bots: try each ability in the look-ahead.
- Tests: Deathrite Shaman in `tests/fixtures.ts`, each ability on its own; an Equipment
  with a second ability.
- Remove the one-activated-ability sentence from "Known simplifications".
- Done. Actions and stack items name the ability by a new `activated` index; `ability`
  still means a loyalty ability or Class level. The menu shows only when two or more
  abilities could be used now. Deathrite Shaman's "add one mana of any color" needed a
  colour choice while resolving: `nameCard` with `of: 'color'`, shown as five buttons.
  Cranial Plating is the Equipment test card ({B}{B} attach at instant speed, equip {1}).

### 3. {X} in activated ability costs, and −X loyalty abilities

Spells already have X (`self.cast.x`). Activated abilities don't (README: "Not supported
yet: X in activated abilities"), nor do loyalty abilities with −X.

- Rules: the player announces X while activating (107.3a, 601.2b via 602.2b); an ability's
  X is its own, independent of other X values on the object (107.3k). X is paid as generic
  mana unless the cost says otherwise ({X}{X}, {X}{R}). A −X loyalty cost removes X
  loyalty counters (606.4), so X can't be more than its loyalty (606.6).
- `activated.cost.mana` accepts `{X}`; the chosen X is stored on the stack item and read by
  the resolve (for example `ctx.x`). The same for `loyalty` abilities with cost `'-X'`.
- UI: the same number picker the cast panel uses for X spells, shown before targets.
- Bots: try X values from 0 to what they can pay in the look-ahead, keep the best; skip X=0
  when it does nothing.
- Tests: real cards in `tests/fixtures.ts`, for example Crypt Rats ("{X}: Crypt Rats deals
  X damage to each creature and each player") and a planeswalker with −X (chosen in the
  session, checked against Oracle text).
- Update "Known simplifications" (X in activated abilities, −X loyalty).

### 4. Manual combat damage assignment

Today damage is split automatically: lethal to each blocker in order, the rest to the last
one, or past them with trample (`dealCombatDamage` in `src/engine/engine.ts`).

Current rules (checked in `docs/rules/510-combat-damage-step.txt`):

- 510.1: the active player announces how each attacker assigns its damage, then the
  defending player(s) for blockers. It doesn't use the stack.
- 510.1c: a creature blocked by two or more divides its damage **as its controller
  chooses** among them. There is no damage assignment order any more, so lethal-first is no
  longer required without trample.
- 702.19b (trample): only once **every** blocker has been assigned lethal damage may the
  rest go to the player, planeswalker or battle attacked. Lethal counts damage already
  marked and damage other creatures assign in the same step, but not prevention. 702.2c:
  any nonzero damage from a deathtouch source counts as lethal. 702.19d: a blocked trampler
  with no blockers left assigns all its damage to what it attacked.
- 510.1d: a blocker blocking two or more attackers divides its damage among them. No
  creature in the pool can block more than one attacker, so this stays automatic unless it
  is cheap to do with the same UI.
- 510.1e: the whole assignment is checked once; an illegal one is redone.

Plan:

- A new decision (`DamageChoice`) for the attacking player when at least one of their
  attackers has a real choice (two or more blockers, or trample with one or more). Single
  blockers and unblocked attackers stay automatic. Both damage steps (first strike, 510.4)
  ask separately.
- The engine validates the full assignment (510.1e) and refuses an illegal one.
- **A setting decides whether the human is asked** ("Assign combat damage: automatic / by
  hand"). Default: automatic. The automatic split is today's, which still fits the rules.
- UI when asked: a window listing each such attacker with its blockers (and the player,
  planeswalker or battle for trample), +/− per recipient, a running total and "lethal"
  markers, pre-filled with the automatic split.
- Bots keep auto-assigning.
- Remove "Combat damage is assigned automatically" from Known simplifications. Trample
  over planeswalkers (702.19c) stays out unless asked.

### 5. Paste a deck list in the app

- A menu screen with a text box. Accepts plain names ("1 Sol Ring", "Sol Ring") and
  Arena/Moxfield exports (set codes and collector numbers ignored, "Commander" /
  "Deck" sections, `*CMDR*` marks).
- Commander(s): from a "Commander" section if there is one, otherwise picked from the list
  in the screen (legendary creatures, or a valid partner pair).
- Validation with `deckProblems` (`src/cards/db.ts`): 100 cards, singleton, colour
  identity, commander legality, partners. Every problem shown as a line the user can read.
- A card the pool doesn't have, or has data for but no script for ("unsupported"), is
  listed clearly; the deck can be played only when the list is empty.
- Names are matched case-insensitively, and by the first face of double-faced cards and
  split names ("Fire // Ice").
- The pasted deck is saved in the browser (localStorage) and shown on the menu with the
  built-in decks; it can be deleted.
- **Bots can play pasted decks too**: the setup lets each bot seat pick a deck (built-in
  or pasted). If this turns out too large for the session, it moves to its own session
  and the user is told.
- Tests: the list parser, and that a known-good list builds the same `DeckDef` as the one
  in `decklists.json`.

### 6. Automatic scripting from Oracle text

A parser that turns common, regular Oracle wording into a `CardScript`, and refuses any
card it can't handle completely. It never approximates: one clause it doesn't understand
means the whole card is refused, with the clause named.

- Shape: split the Oracle text into abilities (by line), each into its trigger/cost/effect
  parts and clauses; match each clause against a list of templates; build the script from
  the existing helpers in `rules.ts`. Anything left unmatched → refuse.
- Reminder text in parentheses is ignored; keywords the engine knows are left to
  Scryfall's keyword list as today.
- **Reach (decided): a narrow first list**, measured by a report; later sessions grow it
  if the user asks. The first list:
  - Keyword-only cards and vanilla creatures (already work without a script).
  - "When this enters" / "When [this] dies" / "Whenever [this] attacks" with one effect.
  - Effects: draw N, gain/lose N life, deal N damage to [target spec], destroy / exile /
    return to hand target [spec], create N [listed token], put N +1/+1 counters on, target
    creature gets +N/+N until end of turn, search for a basic land, mill N, surveil N,
    each opponent loses N life.
  - Target specs: "any target", "target creature", "target creature an opponent
    controls", "target artifact or enchantment", "target player", "target opponent", with
    "nonland", "nontoken" and colour words.
  - Simple activated abilities (one or several, after session 2) with `{T}`, mana
    (including {X}, after session 3) and sacrifice costs, and "Activate only as a
    sorcery".
  - Mana abilities "{T}: Add {G}." / "Add one mana of any colour."
  - Static "[Creatures] you control get +N/+N" and "have [keyword]".
  - "You may" effects ask the player each time, as the session 7a cards do (never
    assumed yes).
- Explicitly refused: modal triggered abilities, replacement effects, "instead", copy
  effects, "for each" unless it is a listed count, cards that name other cards, X outside
  a cost, conditions like "if you control", layers and text-changing effects.
- **Parsed scripts are only for cards with no hand script.** Hand scripts stay and always
  win.
- Every generated script is checked by the same tests as a hand script: the card-pool
  test, and a sample of pool cards whose hand scripts exist (the parser's output must
  behave the same in a test game, as a check on the parser, without replacing them).
- A report (`npm run parse-report`) lists, for the current card data, which cards it
  scripts and why each other card was refused, so its reach can be measured.
- Plain TypeScript with no Node-only parts, so session 7 can run it in the browser.

### 7. Paste a deck with any card

Builds on 5 and 6.

- A pasted card not in the pool is fetched from Scryfall's API by the browser
  (`/cards/collection`, up to 75 names per request, keeping to Scryfall's rate limits:
  50-100 ms between requests), using the same field mapping as `scripts/fetch-cards.mjs`
  (moved to a shared module).
- Each fetched card is scripted by the parser. Cards it refuses are listed with the reason
  (the clause it couldn't read), and the deck can't be played until they are replaced.
  A refused card is never played as a stand-in.
- Fetched data and generated scripts are cached in the browser (IndexedDB) so a deck
  works offline afterwards; the cache can be cleared.
- **Readable fallback when Scryfall can't be reached** (offline, blocked, rate limited,
  a name it doesn't know): the screen says which cards couldn't be fetched and why, in
  plain words, offers **Retry**, and keeps every card already in the pool or the cache
  working. A dev command (`npm run fetch-cards` with the deck added to
  `decklists.json`) stays as the other way to add cards.
- Images keep coming from Scryfall's image server as now.
- **Refused cards are written down for Claude to script later**, in
  `docs/card-requests.json` (tracked in git, so a cloud session can read it once pushed).
  Each entry: card name, Oracle text, the clause the parser couldn't read, how many times
  it was refused, and when last. Repeats are merged, not added twice.
  - While `npm run dev` runs: a small Vite dev-server endpoint receives each refusal from
    the app and updates the file automatically.
  - Anywhere else (a built or hosted version, no dev server): the deck-paste screen has a
    **Download report** button with the same entries, for the user to save into the repo.
    The session decides how a downloaded report merges into the file (likely the skill
    reads both).
  - `npm run parse-report` (session 6) writes its refusals to the same file.
- **A project skill, `/script-requested-cards`** (`.claude/skills/`), that:
  - reads `docs/card-requests.json` and groups the cards by the missing wording;
  - adds a parser template for wording many cards share, and a hand script for one-off
    cards, following `docs/card-scripting.md` and asking the user before any
    approximation;
  - runs `npm test` and `npm run build`, then removes the handled cards from the file;
  - asks before committing, like every session.
