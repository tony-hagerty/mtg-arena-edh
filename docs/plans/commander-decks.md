# Plan: real Commander decks

Goal: play real 100-card Commander decks of any colours, with partner commanders and
every card type, and add the user's own deck to the menu.

**Status: sessions 1-6 and 7a done. Don't start the next session until the user says so.**

## What "every card type" means here

The engine will support every card type and the common mechanics. Each card still needs a
script in `src/cards/scripts.ts` if it does more than its keywords, so adding a deck always
includes writing scripts for its cards. A general Oracle-text parser that scripts any card
automatically is out of scope (projects like Forge spent years on that).

## Rules every session follows

- Do only that session's scope. Leave other gaps to later sessions.
- Cite rule numbers from `docs/rules/` in comments (see `CLAUDE.md`).
- Script cards from their exact Oracle text, clause by clause (`docs/card-scripting.md`).
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

### 4. Counters and attachments: Auras, Equipment, Vehicles (done)

- `Card.counters` becomes a map of counter kinds (122): +1/+1, -1/-1 (they cancel,
  704.5q), loyalty, charge, and so on.
- Attachments: `Card.attachedTo`. Auras with enchant (303.4, 702.5), Equipment and equip
  (301.5, 702.6). State-based actions for illegal attachments (704.5m, 704.5n).
- Vehicles and crew (301.7, 702.122).
- UI: draw attached cards tucked under their host.

### 5. Planeswalkers and battles (done)

- Loyalty, one loyalty ability per turn at sorcery speed (306, 606).
- Attacking planeswalkers and battles: `Attack.defender` can be a permanent (506.3, 508.1b).
  Done as `Attack.target` (the permanent) beside `defender` (its controller or protector,
  the player who blocks, 508.5).
- Damage to them removes counters (120.3c); SBA puts them in the graveyard at 0 (704.5i).
- Battles: protector, defeat trigger (310). Casting a defeated Siege transformed waits
  for double-faced cards in session 6: it is only exiled for now.
- Bots attack and defend them sensibly.

### 6. Other card frames and graveyard casting (done)

- Double-faced cards: transforming (712) and modal double-faced (MDFC) cards.
  `scripts/fetch-cards.mjs` must keep each face's data (Scryfall `card_faces`).
  Then a defeated Siege is cast transformed without paying its mana cost (310.12b).
- Adventures (715), split cards (709), Sagas (714), Classes (716).
- Casting from the graveyard: flashback (702.34), and similar.
- Common tokens: Treasure, Food, Clue (111.10).
- Done with flashback and Adventures from exile as the "graveyard casting". Not done:
  meld, fuse, aftermath, rooms (709.5), read ahead, disturb. Test cards now come from
  Scryfall (`tests/fixture-cards.json` → `tests/fixtures.generated.json`).

### 7. Add the user's deck

- Ask the user for the list (Arena/Moxfield export or plain names) and the commander(s).
- Add it to `decklists.json`, run `npm run fetch-cards`, script every card, run tests.
- Any card the engine still can't do: list it for the user and agree on a fix (new engine
  feature or a stand-in card). Don't swap cards silently.
- Play a few bot games with it (`tests/simulation.test.ts`) to catch crashes.
- If the deck needs more than about 60 new scripts, split it over two sessions.
- The user's deck: Kraum, Ludevic's Opus and Tymna the Weaver, a four-colour (WUBR) cEDH
  deck. Eight cards were listed by their Universes Within names (Chaos Emerald, Joshua
  Rosfield, ...): the deck uses their Oracle names. About 100 scripts, so it is split in two.
  Any card that can't be done exactly is listed for the user and approved one at a time.

#### 7a. Combo-turn engine features and the cards they cover (done)

- Searching a library for any card, with or without a stated quality, into hand, on top or
  onto the battlefield (701.23): tutors and fetch lands.
- Choices partway through resolving: yes/no questions for any player, "unless that player
  pays" (118.12a), looking at the top cards of a library, naming a card.
- Per-turn counts: spells cast, cards drawn, players dealt combat damage. Storm (702.40),
  "second spell each turn" and "first noncreature spell each turn" triggers.
- Turn-long effects: "can't cast spells", "as though it had flash". "Can't be countered".
- Mana: several mana abilities on one permanent, mana abilities that cost life or deal
  damage, conditional and dynamic colours, mana abilities from a hand, rituals, permanents
  that don't untap. Alternative costs that exile a card from your hand (pitch spells).
- Delayed triggers (603.7), extra turns (500.7), losing and winning the game (104).
- Cards: lands, fast mana, rituals, tutors, counterspells, draw engines, the stax
  creatures, Thassa's Oracle, Demonic Consultation, Tainted Pact, Brain Freeze, Final
  Fortune, Last Chance, Wheel of Fortune, and the commanders.
- The deck is added to `decklists.json` but stays off the menu (`wip`) until 7b.
- Done. The user asked for "you may draw" on Rhystic Study and Mystic Remora to be asked
  each time, not assumed. Card wording rules are now in `docs/card-scripting.md`.

#### 7b. The rest of the deck

- Graveyard and odd cards: Underworld Breach (escape), Mnemonic Betrayal, Necropotence,
  Ad Nauseam, Intuition, Mockingbird, Deflecting Swat, Chain of Vapor, Wishclaw Talisman,
  Gemstone Caverns, Cavern of Souls, Chrome Mox, Mox Diamond, Lion's Eye Diamond, Ragavan,
  Into the Flood Maw, Beseech the Mirror, Dragon's Rage Channeler, Birgi, Jeska's Will,
  Otawara, Sevinne's Reclamation, Flare of Duplication, Hexing Squelcher, Rain of Filth.
- The legend rule (704.5j), which a Mockingbird copy of a legend needs.
- Bots that look for the deck's combos (Thassa's Oracle with Consultation or Tainted Pact),
  and use rituals, Simian Spirit Guide and Final Fortune.
- The deck goes on the menu.

### 8. (Optional) Rebuild the four starter decks to 100 cards

- Bring the existing decks up to 100 cards, possibly two-colour, so every seat is a real
  Commander deck. Roughly 160 new cards to script, so likely two sessions.

## Not planned unless asked

- An in-app deck import screen (paste a list in the browser).
- Automatic scripting of cards from their Oracle text.
