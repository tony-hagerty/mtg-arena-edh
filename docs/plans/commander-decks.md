# Plan: real Commander decks

Goal: play real 100-card Commander decks of any colours, with partner commanders and
every card type, and add the user's own deck to the menu.

**Status: sessions 1-3 done. Don't start the next session until the user says so.**

## What "every card type" means here

The engine will support every card type and the common mechanics. Each card still needs a
script in `src/cards/scripts.ts` if it does more than its keywords, so adding a deck always
includes writing scripts for its cards. A general Oracle-text parser that scripts any card
automatically is out of scope (projects like Forge spent years on that).

## Rules every session follows

- Do only that session's scope. Leave other gaps to later sessions.
- Cite rule numbers from `docs/rules/` in comments (see `CLAUDE.md`).
- Bots must use each new feature (`src/engine/ai.ts`), or at least not break on it.
- Add tests in `tests/engine.test.ts`. Keep `tests/simulation.test.ts` passing.
- Finish with `npm test` and `npm run build` passing, and update `README.md`
  ("What works", "Known simplifications", "Adding a card").
- Ask the user before committing.

## Sessions

Order matters: each one builds on the ones before it.

### 1. Deck format: 100 cards, any colours, partners (done)

- `DeckDef` (`src/cards/db.ts`): `commanders: string[]` (1 or 2), `basics` becomes a map
  like `{ "Forest": 18, "Island": 17 }`, drop the single `color` in favour of colours from
  the commanders' colour identity (903.4).
- `Player.commander` becomes a list. Each commander has its own tax (903.8) and its own
  commander-damage count (903.10a, 702.124d).
- Partner (702.124): both start in the command zone; validate the pair.
- A deck test: exactly 100 cards, singleton except basics (903.5b), every card inside the
  commanders' colour identity (903.5c).
- Mana: the auto-tapper and `castable` checks pay multicolour costs from multicolour
  sources. Dual lands and other multi-colour mana sources work through `mana.colors`.
- UI: command zone shows two commanders; the seat colour/tracker handles multicolour decks
  (pick a blend or the first colour); the menu shows the colour pips.
- Existing 60-card mono decks keep working until session 8 rebuilds them.

### 2. Costs: X, hybrid, Phyrexian, kicker, alternative costs (done)

- Parse `{X}`, hybrid (`{W/U}`, `{2/W}`), Phyrexian (`{W/P}`) costs (107.4, 202.1).
- X spells: the caster picks X when casting (601.2b, 107.3). UI needs a number picker.
- Additional and alternative costs (601.2b, 118.8, 118.9): kicker (702.33), "sacrifice a
  creature" style costs, and free/alternative casting.
- Cost increases and reductions that apply together in the right order (601.2f).

### 3. The stack: counterspells, holding priority, modes (done)

- Counter a spell or ability (701.6). New target kind for stack objects.
- Let the human hold priority to respond to their own spell (117.3c). This removes the
  first item in "Known simplifications".
- Modal spells, "choose one/two —" (700.2).
- Copying spells (707.10) if time allows.

### 4. Counters and attachments: Auras, Equipment, Vehicles

- `Card.counters` becomes a map of counter kinds (122): +1/+1, -1/-1 (they cancel,
  704.5q), loyalty, charge, and so on.
- Attachments: `Card.attachedTo`. Auras with enchant (303.4, 702.5), Equipment and equip
  (301.5, 702.6). State-based actions for illegal attachments (704.5m, 704.5n).
- Vehicles and crew (301.7, 702.122).
- UI: draw attached cards tucked under their host.

### 5. Planeswalkers and battles

- Loyalty, one loyalty ability per turn at sorcery speed (306, 606).
- Attacking planeswalkers and battles: `Attack.defender` can be a permanent (506.3, 508.1b).
- Damage to them removes counters (120.3c); SBA puts them in the graveyard at 0 (704.5i).
- Battles: protector, defeat trigger (310).
- Bots attack and defend them sensibly.

### 6. Other card frames and graveyard casting

- Double-faced cards: transforming (712) and modal double-faced (MDFC) cards.
  `scripts/fetch-cards.mjs` must keep each face's data (Scryfall `card_faces`).
- Adventures (715), split cards (709), Sagas (714), Classes (716).
- Casting from the graveyard: flashback (702.34), and similar.
- Common tokens: Treasure, Food, Clue (111.10).

### 7. Add the user's deck

- Ask the user for the list (Arena/Moxfield export or plain names) and the commander(s).
- Add it to `decklists.json`, run `npm run fetch-cards`, script every card, run tests.
- Any card the engine still can't do: list it for the user and agree on a fix (new engine
  feature or a stand-in card). Don't swap cards silently.
- Play a few bot games with it (`tests/simulation.test.ts`) to catch crashes.
- If the deck needs more than about 60 new scripts, split it over two sessions.

### 8. (Optional) Rebuild the four starter decks to 100 cards

- Bring the existing decks up to 100 cards, possibly two-colour, so every seat is a real
  Commander deck. Roughly 160 new cards to script, so likely two sessions.

## Not planned unless asked

- An in-app deck import screen (paste a list in the browser).
- Automatic scripting of cards from their Oracle text.
