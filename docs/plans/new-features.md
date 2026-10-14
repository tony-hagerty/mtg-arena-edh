# Plan: new features

Goal: six features the user asked for after the Commander-decks plan
(`docs/plans/commander-decks.md`) was finished. Each is its own session, started only when
the user says so, one at a time.

**Status: not started. Open questions below need answers first (marked ❓).**

## Rules every session follows

The same as in `commander-decks.md`:

- Do only that session's scope. Leave other gaps to later sessions.
- Cite rule numbers from `docs/rules/` in comments (see `CLAUDE.md`).
- Script cards from their exact Oracle text, clause by clause (`docs/card-scripting.md`).
- Bots must use each new feature (`src/engine/ai.ts`), or at least not break on it.
- Add tests in `tests/engine.test.ts`. Keep `tests/simulation.test.ts` passing.
- Finish with `npm test` and `npm run build` passing, and update `README.md`
  ("What works", "Known simplifications", "Adding a card").
- Ask the user before committing.

## Sessions

Order matters: 2 and 3 are independent of the rest; 4 comes before 6, and 5 before 6.

### 1. Several triggered abilities for one event, and Dragon Tempest

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
  `deckProblems` passes). Check its Oracle text in `cards.generated.json` after
  `npm run fetch-cards`. As of writing it has two abilities: a flying creature you control
  entering gains haste until end of turn, and a Dragon you control entering deals X damage
  to any target, X = the number of Dragons you control. Note: "it deals" means the
  entering Dragon is the source (last known information if it has left), and X is counted
  as the ability resolves (608.2h).
- Remove the Dragon Tempest sentence from README's "Known simplifications".
- Tests: both abilities trigger from one Dragon with flying; each can be ordered; a
  non-flying Dragon triggers only the damage one; a flier that isn't a Dragon only the
  haste one.
- ❓ Which card leaves the deck? Default: Claude picks the weakest non-land card and names
  it in the PR.

### 2. {X} in activated ability costs

Spells already have X (`self.cast.x`). Activated abilities don't (README: "Not supported
yet: X in activated abilities").

- Rules: the player announces X while activating (107.3a, 601.2b via 602.2b); an ability's
  X is its own, independent of other X values on the object (107.3k). X is paid as generic
  mana (107.3) unless the cost says otherwise ({X}{X}, {X}{R}).
- `activated.cost.mana` accepts `{X}`; the chosen X is stored on the stack item and read by
  the resolve (for example `ctx.x`). Mana abilities with X, if any, too (605).
- UI: the same number picker the cast panel uses for X spells, shown before targets.
- Bots: try X values from 0 to what they can pay in the look-ahead, keep the best; skip X=0
  when it does nothing.
- Also lifts "Loyalty abilities with an X cost (−X) aren't supported" if it fits the same
  code (606, [-X] in 107.3a). ❓ In scope, or leave for later?
- Tests: a real card with an {X}: ability in `tests/fixtures.ts` (for example Crypt Rats,
  "{X}: Crypt Rats deals X damage to each creature and each player"; checked against its
  Oracle text in the session).

### 3. Manual combat damage assignment

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
- UI: a window listing each such attacker with its blockers (and the player/planeswalker
  for trample), +/− per recipient, a running total, and "lethal" markers. A default fill
  (today's automatic split) so pressing Done keeps current behaviour.
- Bots keep auto-assigning (today's split, which still fits the new rules).
- Remove "Combat damage is assigned automatically" from Known simplifications. Trample
  over planeswalkers (702.19c) stays out unless asked.
- ❓ Should the human be asked every time they have a choice, or only when they turn on a
  setting ("assign combat damage by hand")? Default: ask every time, with the automatic
  split pre-filled.

### 4. Paste a deck list in the app

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
  built-in decks; it can be deleted. Bots still play the built-in decks.
- Tests: the parser of the list format, and that a known-good list builds the same
  `DeckDef` as the one in `decklists.json`.
- ❓ Should bots be able to play pasted decks too (pick per seat), or only the human?
  Default: only the human in this session.

### 5. Automatic scripting from Oracle text

A parser that turns common, regular Oracle wording into a `CardScript`, and refuses any
card it can't handle completely. It never approximates: one clause it doesn't understand
means the whole card is refused, with the clause named.

- Shape: split the Oracle text into abilities (by line), each into its trigger/cost/effect
  parts and clauses; match each clause against a list of templates; build the script from
  the existing helpers in `rules.ts`. Anything left unmatched → refuse.
- Reminder text in parentheses is ignored; keywords the engine knows are left to
  Scryfall's keyword list as today.
- How far it goes is the main open question (see ❓ below). A first proposal, from the
  wording most common in the pool:
  - Keyword-only cards and vanilla creatures (already work without a script).
  - "When this enters" / "When [this] dies" / "Whenever [this] attacks" with one effect.
  - Effects: draw N, gain/lose N life, deal N damage to [target spec], destroy / exile /
    return to hand target [spec], create N [listed token], put N +1/+1 counters on, target
    creature gets +N/+N until end of turn, search for a basic land, mill N, surveil N,
    each opponent loses N life.
  - Target specs: "any target", "target creature", "target creature an opponent
    controls", "target artifact or enchantment", "target player", "target opponent", with
    "nonland", "nontoken" and colour words.
  - Simple activated abilities with `{T}`, mana and sacrifice costs, and "Activate only as
    a sorcery".
  - Mana abilities "{T}: Add {G}." / "Add one mana of any colour."
  - Static "[Creatures] you control get +N/+N" and "have [keyword]".
- Explicitly refused (always): "may" choices beyond the simplest yes/no, modal triggered
  abilities, replacement effects, "instead", copy effects, anything with "for each" unless
  it is a listed count, cards that name other cards, X outside a cost, conditions like
  "if you control", and every card with layers or text-changing effects.
- Every generated script is checked by the same tests as a hand script: the card-pool
  test, and a sample of real cards whose hand scripts already exist (the parser's output
  must behave the same in a test game). Hand scripts always win over parsed ones.
- A CLI report (`npm run parse-report`) lists, for the current card data, which cards it
  scripts and why each other card was refused, so its reach can be measured.
- ❓ Questions for the user:
  1. How far should it go? (a) only the narrow list above, measured by the report;
     (b) aim at a named target, e.g. "most commons from one recent set"; (c) grow it over
     several sessions, one family of wording per session. Default: (a) in this session,
     with the report deciding what comes next.
  2. Should parsed scripts replace hand scripts for cards already in the pool where they
     behave the same (less code), or only add new cards? Default: only new cards.
  3. Runs where? It must run in the browser for session 6, so it is plain TypeScript with
     no Node-only parts. OK?
  4. "May" effects: ask the player each time, as the session 7a cards do (never assume
     yes)? Default: yes, ask.

### 6. Paste a deck with any card

Builds on 4 and 5.

- A pasted card not in the pool is fetched from Scryfall's API from the browser
  (`/cards/collection`, up to 75 names per request, with Scryfall's rate limits:
  50-100 ms between requests), using the same field mapping as `scripts/fetch-cards.mjs`
  (move it to a shared module).
- Each fetched card is scripted by the parser. Cards it refuses are listed with the reason
  (the clause it couldn't read), and the deck can't be played until they are replaced.
- Fetched data and generated scripts are cached in the browser (IndexedDB or
  localStorage) so a deck works offline afterwards; the cache can be cleared.
- Images keep coming from Scryfall's image server as now.
- ❓ Questions for the user:
  1. Is the browser calling Scryfall at runtime acceptable (it needs a network
     connection; Scryfall asks for a sensible User-Agent and rate limits)? The
     alternative is a "fetch and save into the repo" dev command only.
  2. Should a card the parser refuses be playable as a "vanilla" stand-in if the user
     explicitly ticks it? Default: no, following "never approximate".

## Other limits these features touch

- A card still has only one activated ability (README, "Known simplifications"). Session 2
  doesn't change that. The parser (session 5) will refuse cards with two activated
  abilities unless lifting this is added. ❓ Add it as its own session (like session 1, for
  activated abilities) before session 5?
