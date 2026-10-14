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
  Planeswalkers and battles you can attack glow yellow: click one to send your next
  attackers at it instead.
- **Planeswalkers:** click yours to see its loyalty abilities and pick one. It happens
  right away (after any target): loyalty abilities cost loyalty, not mana. Loyalty is the
  shield in the corner; a battle's defense is the orange box. When you cast a Siege
  battle, the cast panel asks which opponent protects it.
- **Cards with two faces:** a split card, an adventurer card or a modal double-faced card
  opens the cast panel with a **Face** row: pick the half, the Adventure, or the face to
  play. A modal card's land face says "(land)"; pressing Continue on it plays the land.
- **Classes:** click yours to see its level bars; pick the next one and pay for it.
- **Graveyard and exile:** a pile glows when something in it can be cast (flashback,
  escape, an adventurer card whose Adventure you cast, or a card an effect lets you cast or
  play, in anyone's exile). Open it and click the glowing card. With escape (Underworld
  Breach) a window then asks for the three other cards to exile. A card exiled face down
  shows its back, unless you may look at it.
- **More cast-panel rows:** **Gift** (promise an opponent a gift, or none), and for a
  card with an ability that works from the hand, like Otawara's channel, an **Or** chip
  beside playing it. A bargain sacrifice can be skipped with **No Sacrifice**.
- **Lion's Eye Diamond** asks for the colour when you click it.
- **Sacrifice costs** (Goblin Bombardment, Village Rites): after the targets, the
  creatures you could sacrifice glow yellow; click one. A shock land asks whether you pay
  2 life as you play it.
- **New targets** (Deflecting Swat): click the new target for each slot, or press **Keep
  Target**. A card in a graveyard (Sevinne's Reclamation) is targeted from a window.
- When a spell lets you cast a card as it resolves (Beseech the Mirror), a window offers
  **Cast** or **Don't Cast**; casting goes through the usual targets and costs.
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
- Planeswalkers (306, 606): they enter with their printed loyalty. One loyalty ability a
  turn per planeswalker, at sorcery speed (606.3); a minus ability needs that much
  loyalty (606.6). Damage removes loyalty (120.3c), and one with no loyalty goes to the
  graveyard (704.5i). "Any target" and "target player or planeswalker" can name them
  (115.4). Bots use loyalty abilities when the look-ahead says it helps.
- Battles (310): they enter with their printed defense and a protector. A Siege's
  protector is an opponent of its controller, chosen when it is cast (the human picks in
  the cast panel; bots pick the opponent with the fewest untapped blockers). Anyone but
  the protector can attack it, including its controller; only the protector can block
  for it (310.9b-c). Damage removes defense (120.3h). A defeated Siege is exiled when its
  defeat ability resolves, then cast transformed for free (310.12b, 704.5v). A battle
  whose protector leaves the game gets a new one (310.11).
- Double-faced cards (712): transforming cards turn over (701.27) and stay the same
  object; modal double-faced cards are cast as either face, or played as a land face
  (712.11b, 712.12). Off the battlefield and stack a card has its front face (712.8a); a
  transformed permanent's mana value is its front face's (712.8e).
- Split cards (709): cast either half; anywhere but the stack the card has both halves
  combined (its mana value is the total). Adventurer cards (715): cast the creature, or
  the Adventure, which goes to exile when it resolves and can be cast from there as the
  creature (715.3d). A countered Adventure goes to the graveyard.
- Sagas (714): a lore counter as one enters and in each of its controller's precombat
  main phases; each chapter ability triggers as its counter arrives, and the Saga is
  sacrificed after its last chapter has resolved (714.4).
- Classes (716): level up one level at a time, as a sorcery; scripts read `self.level`.
  "When this Class becomes level N" triggers. Tiles show "Lv 2".
- Flashback (702.34): cast from your graveyard for the flashback cost, then exiled
  whenever it leaves the stack (countered too).
- Treasure, Food and Clue tokens (111.10). A Treasure is sacrificed for one mana of any
  colour; auto-pay spends lands first and Treasures last.
- Bots consider every face (split halves, Adventures, modal faces), cast from the
  graveyard and from exile, play a modal card as a land only when they have no other land
  and few on the battlefield, level Classes, and crack Food and Clues when it helps.
- Attacking planeswalkers and battles (506.3, 508.1b): each attacker picks a player,
  planeswalker or battle. Unblocked damage, and trample damage past blockers, goes to
  it; if it has left, the attacker deals no damage (510.1b). Bots attack a planeswalker
  when killing it is worth more than hitting its controller, attack battles they control,
  and chump-block to save a planeswalker or battle that the attack would finish.
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
  may find nothing (701.23b). The spell stays on the stack until the choice is made. A
  search can be for any card, which must find one if it can (701.23d), or for a type,
  subtype or mana value, and puts the card into a hand, on top after shuffling, or onto
  the battlefield (tutors, fetch lands). A bot's card that isn't revealed isn't named in
  the log (701.23e).
- Choices partway through resolving (608.2d): any player can be asked yes or no ("you
  may ...", or "... unless that player pays {1}", where that player chooses first,
  118.12a), to pick from a few cards (Thassa's Oracle), or to name a card (201.3).
- Mana abilities (605): a permanent can have several, and they can cost life (119.4),
  deal damage, need a condition ("activate only if"), make colours worked out as they are
  used (Fellwar Stone and Exotic Orchard check what opponents' lands could produce, 106.7),
  or work from a hand (Simian Spirit Guide: click it in your hand, or pick "Exile it for
  mana" in the cast panel). Auto-pay uses free sources first, then painful ones, then
  ones that are sacrificed. Rituals add mana as they resolve. A permanent can skip its
  untap (502.3), and "whenever this becomes tapped" triggers.
- Pitch costs (118.9): an alternative cost can exile a card from your hand, like Force
  of Will's blue card. You pick the card after the targets; bots give up the card they
  want least.
- Per-turn counts: spells cast (and noncreature spells) by each player, cards drawn,
  and players dealt combat damage. Storm (702.40) copies a spell for each spell cast
  before it this turn; "second spell each turn" and "first noncreature spell each turn"
  trigger.
- Turn-long effects: "can't cast spells this turn" (Silence), "as though it had flash"
  (Borne Upon a Wind, Valley Floodcaller), and permanents that stop opponents casting or
  activating (Grand Abolisher, which also stops their artifacts' mana abilities). "Can't
  be countered" works (113.6g).
- Delayed triggers (603.7), extra turns (500.7, the newest first), and effects that make
  a player win (104.2b) or lose (104.3e) the game. Mill (701.17), discarding at random,
  cumulative upkeep (702.24), mobilize (702.181), and "two target players" that must be
  different (115.3).
- State-based actions (704) are checked every time a player would get priority.
- Timing: instants, flash and abilities any time you have priority; everything else, and
  lands, only in your own main phase with the stack empty.
- Multiplayer combat: each attacker picks its own defending player (or one of their
  planeswalkers or battles); every attacked
  player declares blocks in turn order; players are eliminated mid-game, and what they
  had on the stack goes with them.
- Keywords: flying, reach, first strike, double strike, deathtouch, lifelink, trample,
  vigilance, haste, defender, hexproof, indestructible, menace, flash, storm, cumulative
  upkeep, mobilize, ward, dash, bargain, gift, afterlife.
- Every card in the pool works. On the menu: two 100-card two-colour decks
  (white-black "Heaven's Host" with Karlov of the Ghost Council, black-red "Whispers of
  the Pit" with Judith, the Scourge Diva), two old 60-card mono-coloured "legacy" decks
  (red and green, rebuilt in session 8b) and the Kraum and Tymna deck. The menu shows
  each deck's colour pips.
  `npm test` fails if a card has rules text the engine doesn't implement.
- Control (110.2): a permanent sits on its controller's side and can change hands
  (Wishclaw Talisman). A spell is controlled by its caster, and a permanent spell enters
  under its caster's control, even one owned by someone else. When a player leaves, control
  they gained ends and what they still control is exiled (800.4a).
- Casting from other zones: escape (702.138, given by Underworld Breach), and "you may
  cast / play that card this turn" from any exile (Ragavan, Jeska's Will, Harnfel,
  Mnemonic Betrayal, whose spells take mana of any type). A land played this way is the
  turn's land (305.2a). A card may be cast while a spell resolves, without paying its
  mana cost (608.2g, Beseech the Mirror).
- Copies of permanents (707): Mockingbird enters as a copy of a creature, with the copy
  effect's exceptions (707.9b); the copy has the copied card's abilities, enters
  abilities included, and mana cost.
- Replacement effects as a permanent enters (614.1c, 614.12a), with a choice: Mox
  Diamond's discard, Cavern of Souls's creature type (all of 205.3m), Mockingbird's copy.
  "Enters with counters". Actions from an opening hand (103.6, Gemstone Caverns).
- The legend rule (704.5j): you choose which to keep; bots keep the untapped, ready one.
- Ward (702.21), choosing new targets (115.7d), gift (702.174), bargain (702.166), dash
  (702.109), surveil (701.25), delirium, "attacks each combat if able" (508.1d: one left
  out attacks the next opponent), "skip your draw step", "whenever you discard".
- Mana: restricted mana that makes a spell uncounterable (106.6, Cavern of Souls), mana
  kept until end of turn (Birgi), mana abilities a land gains until end of turn (Rain of
  Filth), and Lion's Eye Diamond (discard your hand, only with priority). Activated
  abilities can cost a discard, a counter or life, work from the hand (channel), cost less,
  or be usable only on your turn. Linked abilities (607, Chrome Mox), cards exiled face
  down (406.3), and targets in a graveyard.
- The user's Kraum and Tymna deck is on the menu: all 100 cards work (scripts in
  `src/cards/kraum-tymna.ts`). Eight cards were listed by their Universes Within names
  (Chaos Emerald is Lotus Petal, and so on); the deck uses their Oracle names.

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
- **A card mostly keeps its identity when it changes zones.** By the rules it becomes a
  new object (400.7). Each card counts its zone changes (`Card.moves`), and the cards that
  remember another card across time check it (Necropotence, dash, Mnemonic Betrayal,
  Chrome Mox, Beseech the Mirror, Wishclaw Talisman, Underworld Breach), but targets don't:
  a spell aimed at a creature that left and came back before it resolved still finds it.
- **The red and green starter decks are still 60 cards** (commander + 59). They are marked
  `"legacy": true` in `src/cards/decklists.json`, get the shared artifacts added, and are
  checked as 60-card decks. Session 8b rebuilds them.
- Partner variants other than plain partner and "partner with" (Background, Doctor's
  companion, "partner—[text]") aren't recognised. Vehicles can't be commanders yet.
- A defeated Siege's back face is always cast ("you may" is free upside); a back face
  that needs targets gets the first legal ones. The protector is announced with the
  spell rather than chosen as it enters. Only Siege battles exist in print; others are
  protected by their controller.
- Not supported yet among other frames: meld cards (712.4), fuse (702.102), aftermath,
  split cards with a shared type line (709.5, "unlocking" rooms), Sagas with read ahead
  (714.3b), disturb and other ways to cast a back face from a graveyard, and casting a
  transformed card's back face any way but a defeated Siege. Tapping a Treasure by hand
  sacrifices it at once, so Cancel can't take that mana back (mana abilities can't be
  undone). The test-only cards are in `tests/fixtures.ts` (Delver of Secrets, Kazandu
  Mammoth, Needleverge Pathway, Dead // Gone, Murderous Rider, History of Benalia, Wizard
  Class, Think Twice, Strike It Rich, Thraben Inspector, Bake into a Pie).
- Loyalty abilities with an X cost (−X) aren't supported, and "two target lands" can
  name the same land twice. Trample over planeswalkers (702.19c) isn't supported.
  No card on the menu is a planeswalker or battle yet; the test-only ones are in
  `tests/fixtures.ts` (Jace Beleren, Garruk Wildspeaker, Invasion of Dominaria). A
  planeswalker that says it "can be your commander" is accepted as one (903.3a).
- Auras can only enchant permanents, not players (702.5d). A card can have only one
  activated ability, so an Equipment's equip is its only one. Proliferate, shield,
  stun and other counters with their own rules (122.1c-j) do nothing special yet.
  The test-only cards are in `tests/fixtures.ts` (Pacifism, Holy Strength, Bonesplitter,
  Loxodon Warhammer, Untethered Express, Black Sun's Zenith).
- Only spells can be modal: modal triggered and activated abilities (700.2b) aren't
  supported. A copy's controller must pick legal new targets or keep all the old ones
  (707.10c allows keeping some). Copying abilities isn't supported yet. The test-only cards for this are in `tests/fixtures.ts` too
  (Counterspell, Negate, Essence Scatter, Stifle, Cryptic Command, Boros Charm, Fiery
  Confluence, Reverberate).
- **No card on the menu uses the new costs yet.** The engine supports them, and the tests
  use real cards in `tests/fixtures.ts` (Blaze, Gut Shot, Burst Lightning, Bone
  Splinters, Flawless Maneuver, Thalia, Ruby Medallion, Boros Recruit).
- Phyrexian mana is always paid with mana when the mana is there; you can't choose to pay
  life instead. Tapping lands by hand first lets you steer it.
- Not supported yet: X in activated abilities, targets that exist only when kicked
  (702.33g) and snow mana {S}. A spell's mana value counts X on the stack (202.3e) only
  where a card checks it (`manaValue`; Mental Misstep).
- Cultivate asks for its two lands one at a time (battlefield, then hand), not as one pick
  of two. It is still one search with one shuffle (701.23h).
- Combat damage is assigned automatically (lethal to each blocker in order).
- In the older scripts, optional "you may" effects always happen when they are free upside
  (a defeated Siege's back face, the starter decks' land searches). The session 7a cards
  ask.
- A copy that enters with the copied creature's own "as this enters" choice doesn't make
  that choice too (614.12). No creature in the pool has one.
- Birgi's "creatures you control can boast twice" does nothing: no card in the pool has
  boast.
- Naming a card (Demonic Consultation) offers every card the game knows, not every card
  ever printed. Naming any card that isn't in your library does the same thing.
- Auto-pay never uses a mana ability that costs a card (Simian Spirit Guide) or your
  hand (Lion's Eye Diamond): use them by hand.
- City of Brass deals its damage only when it is tapped for mana: nothing in the pool taps
  a land any other way.
- Mana Vault doesn't ask about paying {4} while it is untapped, and Tymna doesn't ask
  with no opponent dealt combat damage: paying would change nothing. Both still trigger.
- Bots: they win with Thassa's Oracle plus Demonic Consultation or Tainted Pact when they
  can pay for both (Oracle first, holding priority). They cast a ritual, exile Simian
  Spirit Guide or crack Lion's Eye Diamond (only with an empty hand) when the mana lets
  them cast something they couldn't, and Final Fortune only with one opponent left whose
  life their creatures could take. They cast tutors in their second main phase, Pact of
  Negation only if they could pay next upkeep, use Necropotence in their second main
  phase above 16 life, never cast Rain of Filth, decline Chain of Vapor's copy, give
  Wishclaw Talisman to the opponent whose turn comes last and use their own only to find a
  missing combo piece. They don't try Underworld Breach loops.
- **Your commander going to your hand or library** lands there first, and you choose
  before anyone gets priority. By the rules (903.9b) that is a replacement effect chosen
  as it moves, but an effect can't stop partway through to ask. Bots get the real
  replacement. No card in the pool puts a permanent into a hand or library yet.

## Project layout

```
src/cards/      decklists.json        the decks, shared artifacts, tokens
                db.ts                 card lookup, deck colours, deck legality (deckProblems)
                creature-types.json   every creature type (205.3m; npm run fetch-rules)
                cards.generated.json  card data from Scryfall (npm run fetch-cards)
                scripts.ts            what each card does (starter decks)
                kraum-tymna.ts        what the Kraum and Tymna deck's cards do
                pairs.ts              what the two-colour starter decks' new cards do
src/engine/     types.ts              game state, actions, card-script types
                rules.ts              queries (stats, mana, targets) + effect primitives
                engine.ts             setup, turn structure, priority, the stack, applyAction()
                ai.ts                 the bots
src/ui/         store.ts              Zustand store (game + what the player is selecting)
                view.ts               highlights, prompt, buttons, click handlers
                Card/Board/Hud.tsx    components
                Picker.tsx            card picker: search, mulligan, bottom, trigger order,
                                      yes/no questions, naming, players, legend rule,
                                      escape, casting while a spell resolves
                styles.css            all styling
tests/                                Vitest: card coverage, rules, the UI casting flow,
                                      bot-vs-bot games
                fixtures.ts           scripts for cards not in the pool yet, for testing
                fixture-cards.json    their names; fetch-cards writes their data to
                                      fixtures.generated.json
public/         cursor.png            the mouse cursor, and cursor-down.png while a
                                      button is held (see Credits)
docs/rules/     INDEX.md              official Comprehensive Rules, one file per rule
                                      (npm run fetch-rules)
docs/           card-scripting.md     how to script a card from its exact wording
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
trigger, ordering their triggers, picking cards from a list (`CardChoice`, the legend rule
too), answering yes or no (`AskChoice`), naming a card or creature type (`NameChoice`),
choosing a player (`PlayerChoice`), casting a card while a spell resolves (`CastChoice`)
or choosing new targets (`RetargetChoice`). A choice in the middle of a spell's
effect waits in `Game.choices` until the effect so far has run; the spell stays on the
stack as `Game.resolving` until it is answered. What happens next is the script's
`then[key]`, which the choice names, so a card can ask several questions in a row.

### Adding a card

1. Add its name to a deck in `src/cards/decklists.json`. A deck lists `commanders` (one,
   or two partners), `basics` as a map like `{ "Forest": 18, "Island": 17 }`, and
   `cards`, one of each.
2. Run `npm run fetch-cards` to pull its data and art from Scryfall. Behind an HTTPS
   proxy (as in a Claude Code cloud session) run `NODE_USE_ENV_PROXY=1 npm run fetch-cards`:
   Node's `fetch` ignores the proxy otherwise.
3. Read `docs/card-scripting.md` first: the script must follow the card's exact Oracle
   text, clause by clause. If it does more than its printed keywords, add an entry to
   `src/cards/scripts.ts` (or the deck's own file, like `kraum-tymna.ts`).
   A trigger that only fires on some events ("whenever *another* creature enters") needs
   `{ when, resolve }`, so it doesn't go on the stack for the events it ignores.
   Costs printed in rules text go in the script too: `kicker`, `additionalCost` (a
   sacrifice), `alternativeCosts`, and `costModifier` for "spells cost {1} more/less".
   An X or kicked spell reads `self.cast.x` and `self.cast.kicked`. A modal spell uses
   `modal` instead of `targets`/`onResolve`; a counterspell targets `{ type: 'spell' }`
   and calls `counter`. An Aura sets `enchant` and `static: attachedBonus({...})`; an
   Equipment uses `attachedBonus` with `activated: equip('{2}')`; a Vehicle uses
   `activated: crew(3)`. Counters: `addCounters(g, card, n, kind)`. A planeswalker lists
   its `loyalty` abilities (`{ cost: -2, text, targets, resolve }`); a target spec of
   `'player or planeswalker'` or `'creature or planeswalker'` matches cards that say so.
   A Siege's script can add `onDefeat`.
   A card with faces (double-faced, split, adventurer) gets one script per face, under
   each face's name ("Delver of Secrets", "Insectile Aberration"); `transform(g, card)`
   turns one over. A deck may list it by its first face's name. A Saga lists `chapters`
   (`{ text, targets, resolve }`, chapter I first); a Class lists `levels` (`{ cost,
   text }` for level 2, 3) and reads `self.level`, with `onLevel` for "when this Class
   becomes level N". `flashback: '{2}{U}'` lets it be cast from a graveyard.
   `createToken(g, pid, 'Treasure')` (or `'Food'`, `'Clue'`) makes the predefined tokens.
   A `{ when, resolve }` trigger can take `targets`.
   Mana: `mana` can be a list of abilities, each with `colors` (a list, `'any'`,
   `'identity'` or a function), and optionally `life`, `damage`, `sacrifice`, `when`,
   `fromHand` or `manual`. `addMana(g, pid, ['B', 'B', 'B'], self)` for rituals;
   `noUntap: true` for "doesn't untap".
   Choices while resolving: `search(g, pid, to, find, { then })`, `ask(g, pid, { text,
   cost, yes, no, then })`, `pickCards(...)` and `nameCard(...)` queue a question; the
   answer runs the script's `then[key]` with `picked`, `yes` or `name`. `botChoice[key]`
   says how a bot answers, and `botCast` stops a bot casting it when the look-ahead can't
   see the cost (Pact of Negation).
   Other hooks: `forbids` ("can't cast"/"can't activate"), `grantsFlash`, `uncounterable`,
   `protectsSpell`, `onPostcombatMain`, `onDrawStep`, `onTapped`; effects `addEffect`
   (until end of turn), `delay` with `delayed[key]` (603.7), `extraTurn`, `winGame`,
   `loseGame`, `mill`, `discard`. Storm needs no script. A target spec with
   `distinctFrom: i` can't repeat target `i`. An alternative cost can `exile` a card from
   the hand or `sacrifice` a permanent, or be `dash`; `additionalCost.optional` is
   bargain; `gift` promises a token. `replaceEnter` asks a choice as the card enters and
   calls `finishEnter`; `entersWith` adds counters; `openingHand` acts before the first
   turn. Activated abilities can be `fromHand`, have a `when`, a `reduction`, and cost
   `discard`, `discardSelf` or `counters`. Also `ward`, `grantsWard`, `grantsEscape`,
   `skipDrawStep`, `onDiscard`, `delayedIf`, and helpers `gainControl`, `offerCast`,
   `offerRetarget`, `choosePlayer`, `surveil`, `copyOf`, `abilitySource` (the source if
   it is still the same object). Mana abilities can be `discardHand`, `instant` or
   `chosenType`; `addMana(..., { keep: true })` lasts the turn. Bot hints: `ai: 'ritual'`
   or `'extraTurn'`, `botActivate`. An ability's cost can `sacrificeOne` permanent that fits
   a spec ("Sacrifice a creature:"); the resolve sees `sacrificed` and `sacrificedPower`
   (as it was, 608.2h), and so does a spell with a sacrifice cost. `entersTapped` can be a
   function (check lands). `chooseToSacrifice` and `chooseToDiscard` let a player choose;
   `onSacrifice` and `onPlaneswalkerDies` trigger.
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
