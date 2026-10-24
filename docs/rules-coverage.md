# Rules coverage

What the game implements, and where it knowingly differs from the rules. Rule numbers
are from the Comprehensive Rules in `docs/rules/`.

## What is implemented

### Commander and decks

- **Commander rules:** 40 life, command zone, commander tax, 21 commander damage.
- **Deck format:** 100-card decks with one commander or two partners (702.124), in any
  colours. A deck's colours are its commanders' combined colour identity (903.4,
  702.124c). Partners both start in the command zone and keep separate commander tax and
  commander damage (702.124d).
- **Deck checks:** `deckProblems` in `src/cards/db.ts` checks 100 cards, singleton except
  basics (903.5b), every card inside the colour identity (903.5c), legendary creature
  commanders (903.3), and a valid partner pair (plain partner or "partner with").
- **Pasted decks:** `parseDeckList` in `src/cards/decklist.ts` reads the text,
  `poolName` matches each name to the card pool (any case, either apostrophe, a card
  with faces by its full or first-face name, 712), and `checkList` builds the `DeckDef`
  and runs `deckProblems`. A card the pool lacks, or one not legal in Commander, stops
  the deck being saved. One the engine can't play (`problemsOf` in
  `src/cards/support.ts`, the same check as the card-pool test) is listed in
  `ListCheck.refused`, grouped by the clause the parser named; the player plays it
  without its rules text (`DeckDef.textless`, see below) or swaps it. Leftover refused
  cards don't stop saving: the deck is kept but can't be played until they are dealt
  with (`savedDeckState`). Saved decks live in `localStorage` (`arena-edh.decks`); one
  whose cards a newer pool lacks stays on the menu, greyed out with the reason.
  `parseDeckList` reads Arena, Moxfield, Archidekt, MTGO, TappedOut and plain exports
  (see `tests/decklist.test.ts` for each form).
- **Cards from Scryfall:** a name the pool lacks is fetched by the browser from
  Scryfall's `/cards/collection` (75 names a request, 100 ms apart), mapped by
  `src/cards/scryfall.ts` (the same mapping `npm run fetch-cards` uses), added with
  `registerCards` and scripted by the Oracle text parser (`src/cards/fetched.ts`). The
  pool's cards and hand scripts always win over fetched ones. Fetched card data is cached
  in IndexedDB (`src/cards/cache.ts`) and scripted again on each load, so a newer parser
  reaches cached cards too. At start-up a saved deck's cards missing from the cache are
  fetched again. A card Scryfall lists as not legal in Commander only because it isn't
  released yet (a preview) counts as legal; Un-set, Alchemy and other never-legal sets
  don't (`legalityOf`).
- **Card requests:** each fetched card the game can't play goes into
  `docs/card-requests.json` (name, Oracle text, the clause, how many times, when last),
  merged by name (`src/cards/requests.ts`). Under `npm run dev` the app posts it to a dev
  server endpoint (`vite.config.ts`) that writes the file; a built version keeps it in the
  browser for the paste screen's **Download report** button, merged into the file with
  `npm run card-requests -- <download>`. `npm run parse-report` adds any pool card that
  can't be played. The `/script-requested-cards` skill (`.claude/skills/`) scripts them.
- **Seats:** `newGame({ seats })` takes 2 to 4 seats in turn order, each a deck and
  whether a person plays it. The store's `tableOf` builds them from the menu's choices
  (`seatDecks` picks the decks). Play Again replays the same deck and opponents.
- **Your view:** `human` in the store is the seat at the bottom of the screen; `humans` is
  every seat people at this screen play. `seatOf` places the others clockwise in turn
  order from the viewer (2 players: top; 3: left and right; 4: left, top, right). Your
  stops are saved by seat counted from yours, so they hold in any seat.
- **The log:** lines are in the third person ("Player 2 casts"), except for the one person
  alone against bots (`Player.you`). A line that names a hidden card, like the one found
  searching a library into a hand (701.23e), carries a `private` version that only the
  searcher's log shows; everyone else reads "for a card". A card put onto the battlefield
  from a graveyard or exile, by whatever effect (Reanimate, Kaya's Ghostform, persist),
  gets a line from the engine (`logReturns`): "Serra Angel returns to the battlefield",
  with "under Player 1's control" when its controller isn't its owner (110.2a). Cards
  coming back together share a line; a land played from exile keeps its "plays" line.
- **One player's view:** `viewFor(game, seat)` (src/engine/view.ts) is the game as that
  player may know it, for the host's server to send each player. Other hands, every
  library and cards exiled face down they may not look at (406.3) become blank stand-ins
  (`isHidden`) whose ids only say where they are, so the counts stay right (402.3) but no
  id follows a hidden card. A choice in front of the player shows what it needs: their
  library while they search it, sorted so its order stays hidden (701.23a, 401.2), the
  cards they pick from, or the card the choice is about (a fetched shock land asking as it
  enters, 614.12a). Private log lines read in full only for their player, and the
  random seed is dropped. `viewFor(game, null)` is an onlooker's view.
- **The game server:** under `npm run dev` and in the .exe, the page plays through a game
  server on the same computer (`server/game/`). `GameHost` alone holds the whole game,
  plays the bots after a short pause, and takes a move only from the seat the game is
  waiting on (`Game.priority`), never for a bot. Each window streams its seat's
  `viewFor` as server-sent events from `/api/game/events?seat=N` and POSTs its moves
  (`src/net/protocol.ts`, `src/ui/remote.ts`). The window checks a move against its own
  view first, so a refused click says so at once. It doesn't pass priority on for others
  (that depends on their hands), and a move that gets past the engine's checks and then
  reaches a hidden card, like the last mulligan keep (103.6), is left to the server. Tapping mana and declaring attackers or blockers show at
  once; anything else waits for the server's next view, and until it comes the window
  takes no other move, so a second click or key press on the old screen (Pay turned into
  Next) can't send a pass the player never saw. Each move carries a number the
  server echoes back (`ack`), so a view sent before the move arrived is ignored. Passing
  the screen to another person at the same computer switches which seat the window
  streams. A POST must come from the game's own page (its `Origin`), so another web page
  can't send moves. A plain `vite build` opened from disk, and the tests, have no server
  and run the whole game in the page. Each view also carries the data of any card from
  Scryfall the seat can see for the first time (`ViewMessage.cards`), so a friend's
  pasted deck shows up on everyone's screen.
- **Tables of friends:** the window's lobby (`src/net/lobby.ts`, `/api/lobby/`) hosts a
  table or joins one with a code (`server/lobby/`). Hosting listens for friends on TCP
  port 47190 (or the next free one), asks the router to forward it (`server/net`), and
  makes the code from the public address, or the home-network address when the router
  won't say. A friend's program connects over TLS, checks the host's key against the
  code, and sends the code's password; each side then sends one JSON message per line
  (`server/lobby/wire.ts`). The host's `Table` seats people, checks their decks (cards
  they fetched come with the deck; their program already checked Scryfall's legality),
  and starts the game on the host's `GameHost`, with bots in free seats if the host ticked
  the box, or a smaller table if not. A friend's program passes its window's moves to the
  host and the host's views back, so the window plays exactly as on one computer. The
  host's own window may play and watch only the host's seat. A friend who leaves or loses
  the connection during a game keeps their seat, and the game waits for them; joining
  again with the same code and name puts them back in it. Meanwhile the people still at
  the table vote on a bot playing that seat: it does once more than half of them say yes,
  until the person comes back. Anyone may pause the game (no moves, the bots wait) and
  carry on. Every player's program keeps a copy of the game (`server/lobby/saves.ts`,
  in `ArenaEDH-data/saves`), sent by the host every few seconds and at once on a pause,
  so if the host goes, anyone can resume it as the new host: the others join the new
  code under the names they played as. The copies are scrambled with a key every copy of
  the program shares, which stops a glance at a file for hidden cards and no more.
  Everyone at a table needs the same build of the program, since each window checks its
  own moves: the .exe carries a version (`server/lobby/version.ts`, package.json's
  version plus a hash of the source), and the host turns away a friend with another one,
  as resuming does for a game saved by another build.
- **Commander zone changes:** a commander that dies or is exiled really goes there (so
  "dies" abilities see it), then its owner may move it to the command zone (903.9a). One
  headed for a hand or library may go to the command zone instead (903.9b): a replacement
  effect, so you're asked as it moves, before it gets there. Bots always send it.
- **Every card in the pool works.** `npm test` fails if a card has rules text the engine
  doesn't implement. The menu shows each deck's colour pips:

  | Deck | Colours | Commander |
  | --- | --- | --- |
  | Heaven's Host | white-black | Karlov of the Ghost Council |
  | Whispers of the Pit | black-red | Judith, the Scourge Diva |
  | Fire and Fang | red-green | Halana and Alena |
  | Conclave's Chorus | green-white | Trostani, Selesnya's Voice |
  | Disciple of Matoya | white-blue-black | Y'shtola, Night's Blessed |
  | Necropotence at Home | white-black | Ketramose, the New Dawn |
  | The Stand User Could Be Anyone! | black-red | Kuja, Genome Sorcerer |
  | Hashaton, Scarab's Fist | white-blue-black | Hashaton, Scarab's Fist |

  The four starter decks are 100-card two-colour decks. Opus and Weaver, the user's Kraum
  and Tymna deck, is off the menu (`offMenu` in `decklists.json`) but its cards stay in
  the pool, scripted in `src/cards/kraum-tymna.ts`, so a pasted deck can play them, and
  the bot games still play it. Eight of its cards were listed by their Universes Within
  names (Chaos Emerald is Lotus Petal, and so on); the deck uses their Oracle names.

### Turns, priority and the stack

- **Turn structure (500-514):** untap, upkeep, draw, main, beginning of combat, declare
  attackers, declare blockers, combat damage (twice with first strike), end of combat,
  second main, end step, cleanup. Mana empties as each step ends.
- **Priority (117):** the active player gets it first in each step, it passes in turn
  order, and a step ends only when everyone passes in a row with the stack empty.
- **Holding priority (117.3c):** tick **Hold priority** while paying (or press
  Ctrl+Space) to keep priority after your spell goes on the stack, so you can respond to
  it yourself.
- **The stack (405, 601, 602, 608):** spells and activated abilities wait there and
  resolve last-in, first-out. Targets are checked again on resolution, and a spell whose
  targets are all gone does nothing. Mana abilities and playing a land don't use the
  stack.
- **Timing:** instants, flash and abilities any time you have priority; everything else,
  and lands, only in your own main phase with the stack empty.
- **State-based actions (704)** are checked every time a player would get priority.
- **Mulligans (103.5):** players declare in turn order from the starting player, then
  everyone who chose to mulligan does so at once and puts cards on the bottom. The first
  mulligan is free in multiplayer (103.5c), but not in a two-player game (100.1a). Bots
  keep a hand with 2 to 5 lands.
- **The first turn:** in a two-player game the starting player skips their first draw
  step (103.8a); with three or more nobody does (103.8c).
- **Triggered abilities (603):** they trigger when the event happens, go on the stack the
  next time a player would get priority (active player's first), and choose targets then.
  You choose the order of your own that go on together (603.3b); bots keep the order they
  triggered in. A card can have several abilities for the same event (Dragon Tempest's two
  "enters" abilities): each triggers, targets and goes on the stack on its own (603.2),
  and the ordering window and the stack (on hover) say which one it is.
- **Delayed triggers (603.7), extra turns** (500.7, the newest first), and effects that
  make a player win (104.2b) or lose (104.3e) the game. "At the beginning of your next main
  phase" (Mana Drain) is whichever of your main phases comes first, precombat or
  postcombat (505.1).
- **Additional phases (500.8):** Sphinx of the Second Sun's additional beginning phase
  after your postcombat main phase: untap, upkeep and draw steps, then the ending phase.
- **Choices partway through resolving (608.2d):** any player can be asked yes or no ("you
  may ...", or "... unless that player pays {1}", where that player chooses first,
  118.12a), to pick from a few cards (Thassa's Oracle), or to name a card (201.3).
- **Counterspells (701.6):** a spell or ability can target spells or abilities on the
  stack (click one in the stack panel). A countered spell goes to the graveyard and its
  costs aren't refunded; a countered commander can still go to the command zone.
- **Modal spells (700.2):** the prompt lists the modes; pick as many as the card says.
  Each mode has its own targets, and a mode with no legal target can't be picked. "You may
  choose the same mode more than once" works (700.2d).
- **Copying spells (707.10):** the copy keeps the original's modes, X and kicker, and its
  controller may choose new targets. A copy ceases to exist when it leaves the stack.
- **Copying abilities (707.10)** works the same way (Return the Favor; Ulalek, Fused
  Atrocity copies every spell you control, then every other activated and triggered
  ability you control, each copy with new targets if you like), and so does
  copying a card in exile and casting the copy (707.12, Mizzix's Mastery; a copy you
  don't cast ceases to exist). Copies trigger magecraft's "whenever you copy" (Storm-Kiln
  Artist). "Whenever you cast a spell while [this] is attacking, copy that spell" (Fire
  Lord Azula) copies it even if the spell has left the stack by then.
- **Changing a target (115.7a):** "change the target of target spell or ability with a
  single target" (Redirect Lightning, Return the Favor, Untimely Malfunction). Only a
  spell or ability that targets exactly one thing once can be chosen. As it resolves, you
  must pick another legal target if there is one; if there isn't, nothing changes.
- **Modal triggered abilities (603.3c):** "choose one or more —" is chosen as the ability
  goes on the stack, with the targets of the chosen modes (Black Market Connections). One
  with too few modes that can be chosen is removed from the stack.
- **Modal activated abilities (700.2a):** "{2}, Sacrifice two artifacts: Choose one —"
  (Breya, Etherium Shaper): the modes are chosen as the ability is activated, before its X
  and targets (601.2b-c via 602.2b), in the prompt's band; each mode has its own targets, and
  a mode with no legal target can't be chosen. Bots try each legal choice of modes.
- **Choosing a number** partway through resolving: Electro's "you may pay {X}" and Mages'
  Contest's bidding, where you start at 1 and the two bidders top each other until the
  high bid stands.
- **Villainous choices (701.55):** each opponent in turn order chooses, and the chosen
  option is carried out before the next one chooses (701.55d, Ensnared by the Mara).
- **Abilities that trigger from a graveyard** (Vivi's Persistence's "whenever your
  commander enters or attacks", Asgardian Inspiration's "whenever a source you control
  deals noncombat damage to an opponent"), with "you" the card's owner.

### Costs (107.3, 107.4, 118, 601.2b, 601.2f)

- **{X}:** the caster picks X before choosing targets; it is paid as generic mana.
  Scripts read it as `self.cast.x`.
- **{X} in an activated ability's cost, and −X loyalty abilities** (107.3a, 606.4): X is
  picked before targets with the same − / + / Max panel, starting at the most that can be
  paid. A −X ability can't take X above the loyalty (606.6). Each ability's X is its own
  (107.3k): it is kept on the stack item and scripts read it as `ctx.x`. "Spend only black
  mana on X" (Crypt Rats) is `cost.xColor`. Bots try X from 1 up to what they can pay (six
  values spread over the range when there are more) and keep the best.
- **Hybrid** ({R/W}), **monocoloured hybrid** ({2/W}) and **Phyrexian** ({W/P}) symbols.
  Auto-pay tries coloured mana first, then {2}, then 2 life, and backs up if a choice
  leaves the rest unpayable. For each symbol that may be paid with 2 life (Phyrexian mana,
  107.4f; K'rrik's {B}) the payer chooses mana or life before paying (601.2b): the payment
  panel's **Pay with life** stepper says how many such symbols are paid with life, for a
  spell, an ability or an attack cost alike (`CastChoices.payLife`, `Action.payLife`), never
  more life than the player has (119.4). Left on **Auto**, and for bots, mana is spent first
  and life only where the mana isn't there.
- **Kicker and multikicker** (702.33), additional costs (118.8): "sacrifice a creature",
  "discard a card" (picked after the targets, from your other cards; bots discard the
  card they want least) and "pay N life" or "pay X life" (X is announced with the spell,
  starts at 0 and can't be more than your life total, 119.4; bots pick X from the
  creatures' toughness and never pay all their life), and alternative costs such as
  "cast without paying its mana cost" (118.9). Commander tax applies to alternative
  costs too (118.9d).
- **Sacrificing several permanents as a cost:** "Sacrifice two other artifacts and/or
  creatures" (Mondrak) asks for that many when the ability is activated; bots give up
  their cheapest.
- **Madness (702.35):** a card with madness you discard is exiled instead, and its
  trigger lets you cast it from exile for its madness cost, or else it goes to your
  graveyard. **Miracle (702.94):** the first card you draw in a turn can be revealed if it
  has miracle, and its trigger lets you cast it from your hand for its miracle cost.
- **Pitch costs (118.9):** an alternative cost can exile a card from your hand, like Force
  of Will's blue card. You pick the card after the targets; bots give up the card they
  want least.
- **Cost increases and reductions** from permanents (Thalia-style) and from the spell
  itself, added up together; reductions only take off generic mana (601.2f).
- When you cast a spell with any of these, a small panel asks for X, kicker and which cost
  before you choose targets. A sacrifice is picked after the targets.
- **Delve (702.66):** after the targets, you pick cards in your graveyard to exile; each
  pays for {1}, after other cost changes (702.66b). Bots delve the cards they want least.
- **Attack costs (508.1g-i):** Propaganda's "{2} for each creature attacking you". An
  attack you can't pay for is refused as you declare it; the cost is paid with auto-pay
  once attackers are declared, after they tap, so an attacker can't tap for it. A creature
  that must attack doesn't have to pay (508.1d). Bots attack through it only when the
  attack is worth the mana. Summon: Yojimbo's "until your next turn" version works the
  same way.
- **Convoke (702.51):** given to creature spells (Eirdu). Auto-pay taps creatures after
  its other sources. To pick them yourself, click creatures while paying: each one pays
  for {1} or one mana of its colour, and the rest is paid with mana (`CastChoices.convoke`).
- **Spree (702.172):** each chosen mode adds its own cost (Insatiable Avarice, Lively
  Dirge).
- **Overload (702.96):** "target" becomes "each", so the spell has no targets (Winds of
  Abandon). **Evoke (702.74):** the creature is sacrificed as it enters (Solitude, whose
  evoke cost exiles a white card from your hand). **Warp (702.185):** cast from your hand
  for the warp cost; the permanent is exiled at the next end step and may be cast from
  exile on a later turn (Haliya).
- **Other costs:** "exile this" (Relic of Progenitus, Plaza of Heroes), "exile a creature
  you control" (The Soul Stone), "remove two oil counters" (Argent Dais), "tap an
  untapped creature you control" (Springleaf Drum, which a creature that just arrived can
  pay, 302.6) and "discard a card: add {B}" (Skirge Familiar), and "you may sacrifice a
  nontoken white creature rather than pay this spell's mana cost" (Flare of Fortitude).
- **Dividing damage as you cast (601.2d):** "X damage divided as you choose among any
  number of target creatures" (Fire Covenant, whose X is the life you pay). After the
  targets, a panel shares the damage out: at least 1 to each target, adding up to the
  total. A single target gets all of it. Bots kill what they can, keeping X below their
  life total.
- **A choice of additional costs:** "pay 5 life or pay {2}" (Redirect Lightning): pick one
  in the prompt.
- **"Exile two cards from your graveyard"** as an activation cost (Matoc): pick them after
  the targets; bots exile the cards they want least.
- **Offspring (702.175):** pay the extra cost and a 1/1 token copy enters with it
  (Coruscation Mage). **Spectacle (702.137):** the cheaper cost only once an opponent has
  lost life this turn (Light Up the Stage).
- **Alternative costs a permanent gives a spell (118.9):** Henzie "Toolbox" Torre's blitz
  for creature spells with mana value 4 or more ("the blitz cost is equal to its mana
  cost"), and Ashling, the Limitless's "gain evoke {4} as you cast them". They are offered
  with the spell's own costs; what was paid stays with the spell, so the permanent leaving
  before it resolves changes nothing (`CastInfo.blitz`, `CastInfo.evoke`).
- **Blitz (702.152):** cast for its blitz cost, the permanent has haste and "When this
  permanent is put into a graveyard from the battlefield, draw a card" (however it dies),
  and is sacrificed at the beginning of the next end step if it is still the same object.
  "Blitz costs you pay cost {1} less for each time you've cast your commander from the
  command zone" takes off generic mana only (601.2f), counting casts of either partner.
  "Each creature spell you cast with mana value 4 or greater has blitz" counts the X the
  caster announces (202.3e): blitz and X are chosen together (601.2b), so a creature with
  {X} in its cost has blitz only with an X that brings its mana value to 4
  (`AlternativeCost.minX`; the X panel starts there and won't go below).
- **Affinity (702.41):** "Affinity for creatures/artifacts" is a cost reduction of {1} for
  each such permanent you control (601.2f), and "Instant and sorcery spells you cast have
  affinity for creatures" (Witherbloom, the Balancer) gives it to those spells; several
  instances each apply (702.41b).
- **Reductions of coloured mana (118.7b-f):** Morophon's "Spells of the chosen type you
  cast cost {W}{U}{B}{R}{G} less to cast. This effect reduces only the amount of colored
  mana you pay": one symbol of each colour is taken off, a Phyrexian symbol by its colour
  (118.7f), a hybrid symbol by one of its halves (118.7e), chosen so as many symbols as
  possible are paid for, and the generic part is left alone. A reduction without that
  sentence would take the excess off generic mana (118.7c).
- **Paying life for a colour's mana:** K'rrik, Son of Yawgmoth's "For each {B} in a cost,
  you may pay 2 life rather than pay that mana" makes every {B} in a cost you pay (a
  spell's, an ability's, an attack tax) payable like {B/P}: a hybrid or Phyrexian symbol
  with a black half gets the choice too, and the payer chooses mana or life for each symbol
  as for Phyrexian mana (above).

### Mana

- **Multicolour mana:** auto-pay pays the scarcest colour first and backs up to try
  another source when a choice would leave a later pip unpayable. It pays each pip and
  the generic part with the source it most wants to keep the least: a basic before a dual,
  a colour your hand and command zone don't want before one they do, and lands and plain
  mana rocks before creatures and permanents with another {T} ability. A hybrid symbol is
  paid with the colour your other cards want less, and floating mana spent on generic is
  the colour they want least. When a payment really happens, auto-pay also looks ahead:
  it picks the way to pay that leaves the most of your other cards castable this turn,
  counting instants and flash cards double. Bots skip this while they try moves out, and
  use it for the move they make. Tapping a source by hand with a choice (a dual or tri
  land, a Talisman, a filter land, Command Tower) opens a picker: you pick the ability and
  the mana. Auto-pay still picks for you. Bots play the land for the colour
  they are shortest of.
- **Mana abilities (605):** a permanent can have several, and they can cost life (119.4),
  deal damage, need a condition ("activate only if"), make colours worked out as they are
  used (Fellwar Stone and Exotic Orchard check what opponents' lands could produce, and
  Reflecting Pool what your lands could produce, 106.7), or work from a hand (Simian Spirit Guide: click it in your hand, or pick "Exile
  it for mana" in the prompt). Auto-pay uses free sources first, then painful ones,
  then ones that are sacrificed. Rituals add mana as they resolve. A permanent can skip
  its untap (502.3), and "whenever this becomes tapped" triggers.
- **Treasure, Food and Clue tokens (111.10).** A Treasure is sacrificed for one mana of
  any colour; auto-pay spends lands first and Treasures last.
- **Mana abilities with a mana cost (605.1a):** Signets ("{1}, {T}: Add {W}{U}") and
  filter lands ("{W/B}, {T}: Add {W}{W}, {W}{B}, or {B}{B}"). Auto-pay and bots use them
  only when a payment can't be made without them, and never to pay their own cost. By
  hand, the cost is paid from your pool first, and auto-pay taps the rest.
- **"Tap an untapped legendary creature you control: Add one mana"** (Relic of Legends):
  by hand, click the Relic and pick that ability, the creature and the colour. Click the
  creature to take the mana back. A
  creature that just arrived can pay it (302.6). Auto-pay and bots use it like any other
  source, tapping such a creature only after lands and mana rocks.
- **Special mana:** restricted mana that makes a spell uncounterable (106.6, Cavern of
  Souls, Delighted Halfling's legendary spells), if it pays any part of the cost; a copy of
  that spell can be countered (707.10), mana kept until end of turn (Birgi), mana abilities a land gains until end of
  turn (Rain of Filth), and Lion's Eye Diamond (discard your hand, only with priority).
- **More mana:** mana that can be spent only on instants and sorceries (106.6, Tablet of
  Discovery), unspent red mana kept between steps and turns (500.5, Electro), "activate
  only if this land entered this turn or if you control a basic land" (Dark Fortress),
  and "{T}, Sacrifice a creature: Add {B}{B}" (Phyrexian Tower: click the Tower, then pick
  the creature).
- **Costs that tap other permanents (302.6):** "Tap an untapped artifact you control: Add
  {U}" (Urza) and "Tap two untapped tokens you control: Add one mana of any color" (Baylen),
  and activated abilities that cost "Tap three untapped tokens you control". Neither the
  source nor the permanents tapped use their own {T}, so ones that just arrived can be
  tapped. By hand, pick them in the mana picker or as the ability is activated; auto-pay and
  bots tap the ones that cost least (tokens and permanents with no mana or {T} ability first).
- **Mana abilities that work out what they make as they resolve (605.3b):** "Add X mana of
  any one color, where X is Helga's power", "Add X mana in any combination of {U} and/or {R}"
  (Vivi Ornitier: by hand, pick the combination), "For each color among permanents you
  control, add one mana of that color" (Faeburrow Elder, Bloom Tender; 105.2: colourless
  isn't a colour), and "Activate only once each turn" (602.5b, for as long as it is the same
  object, 400.7). One that would make no mana now (X is 0) is still a mana ability (605.1a):
  it can be activated by hand for nothing, using up its turn; auto-pay leaves it alone.
- **Mana spent only on some creature spells (106.6):** "creature spells with mana value 4 or
  greater or creature spells with {X} in their mana costs" (Helga).
- **Triggered mana abilities (605.1b, 605.4a):** "Whenever you tap a nonland permanent for
  mana, add one mana of any type that permanent produced" (Kinnan), "Whenever you tap a Swamp
  for mana, add an additional {B}" (Crypt Ghast), "Whenever enchanted land is tapped for mana,
  its controller adds an additional {G}" (Wild Growth). Tapping for mana is a mana ability
  with {T} in its cost (106.12), so Urza's and Vivi's abilities don't set them off, and they
  trigger only once it produced mana (106.12a). They resolve at once, by hand and when
  auto-pay taps the permanent (the extra mana stays in the pool), and doubling effects like
  Roaming Throne's apply (603.2d). When one offers a choice (Kinnan after a permanent that
  made two types), the mana picker asks it after the mana; bots and auto-pay take the type
  their cards want most. Taking the mana back takes the extra mana too.

### Permanents

- **Activated abilities (602):** a card can have several, each with its own cost, timing,
  targets and effect. They can cost a discard, a counter or life, work from the hand
  (channel), cost less, or be usable only on your turn. An ability that adds mana but has
  a target isn't a mana ability and uses the stack (605.1a, Deathrite Shaman). Bots
  consider every ability.
- **Counters (122):** any kind, by name. +1/+1 and -1/-1 counters change power and
  toughness and cancel each other out (704.5q); a keyword counter like `flying` gives the
  keyword (122.1b). Tiles show them ("+2", "-1", "3 charge").
- **Auras (303.4, 702.5):** the spell targets what it will enchant; one whose target is
  gone goes to the graveyard. An Aura on something it can't enchant, or on nothing, goes
  to the graveyard (704.5m). "Can't attack" and "can't block" work (Pacifism). An Aura
  can enchant a card in a graveyard (Animate Dead's "enchant creature card in a
  graveyard"); that card leaving the graveyard leaves the Aura on nothing (303.4c). An
  effect can give an Aura a new enchant ability (Animate Dead's "enchant creature put onto
  the battlefield with this Aura"), and every enchant ability it has must allow what it
  enchants (702.5c).
- **Exile "until this leaves the battlefield" (610.3):** Hostage Taker's card comes back
  as soon as Hostage Taker leaves, and isn't exiled at all if Hostage Taker left first
  (610.3c). Several come back at the same time when their exilers leave together.
- **Monstrosity (701.37):** puts its +1/+1 counters on only if the permanent isn't
  monstrous yet; a permanent stops being monstrous when it leaves.
- **Equipment (301.5, 702.6):** equip at sorcery speed to a creature you control; it
  falls off a permanent that stops being a creature, and stays on the battlefield
  (704.5n). Attaching an Equipment to the creature it is already on does nothing
  (701.3b). Attached Auras and Equipment are drawn tucked behind the permanent they're
  on; click an attached Equipment to equip it elsewhere.
- **Vehicles (301.7, 702.122):** crew by tapping other untapped creatures with enough
  total power (summoning-sick ones can crew). The Vehicle is an artifact creature until
  end of turn. Bots crew before combat with their weakest or summoning-sick creatures.
  A Pilot token "crews Vehicles as though its power were 2 greater" (`crewBonus`,
  Shorikai, Genesis Engine). A legendary Vehicle, or a legendary Spacecraft with a
  power/toughness box, can be a commander (903.3).
- **Spacecraft and station (702.184, 721):** "Station" taps another untapped creature you
  control, as a sorcery, and puts charge counters on the Spacecraft equal to that
  creature's power as the ability resolves (its last known power if it has gone, 608.2h).
  A "N+ |" line is a static ability while it has that many charge counters: abilities, and
  with a power/toughness box, "is a creature with base power and toughness [P/T]"
  (721.2a-b; Hearthhull, the Worldseed). Bots station after combat with their strongest
  idle creature.
- **Planeswalkers (306, 606):** they enter with their printed loyalty. One loyalty ability
  a turn per planeswalker, at sorcery speed (606.3); a minus ability needs that much
  loyalty (606.6). Damage removes loyalty (120.3c), and one with no loyalty goes to the
  graveyard (704.5i). "Any target" and "target player or planeswalker" can name them
  (115.4). Bots use loyalty abilities when the look-ahead says it helps.
- **Battles (310):** they enter with their printed defense and a protector. A Siege's
  protector is an opponent of its controller, chosen when it is cast (the human picks in
  the prompt; bots pick the opponent with the fewest untapped blockers). Anyone but
  the protector can attack it, including its controller; only the protector can block
  for it (310.9b-c). Damage removes defense (120.3h). A defeated Siege is exiled when its
  defeat ability resolves, then cast transformed for free (310.12b, 704.5v). A battle
  whose protector leaves the game gets a new one (310.11).
- **Sagas (714):** a lore counter as one enters and in each of its controller's precombat
  main phases; each chapter ability triggers as its counter arrives, and the Saga is
  sacrificed after its last chapter has resolved (714.4).
- **Classes (716):** level up one level at a time, as a sorcery; scripts read
  `self.level`. "When this Class becomes level N" triggers. Tiles show "Lv 2".
- **Control (110.2):** a permanent sits on its controller's side and can change hands
  (Wishclaw Talisman). A spell is controlled by its caster, and a permanent spell enters
  under its caster's control, even one owned by someone else. When a player leaves,
  control they gained ends and what they still control is exiled (800.4a).
- **Copies of permanents (707):** Mockingbird enters as a copy of a creature, with the
  copy effect's exceptions (707.9b); the copy has the copied card's abilities, enters
  abilities included, and mana cost. A permanent can also become a copy while it stays on
  the battlefield (707.4, Likeness Looter): nothing triggers as if it entered, its counters,
  status and other effects stay, and the latest copy effect replaces the earlier one. The
  copy effect has its own timestamp, which static abilities it gives take (613.7a). Abilities
  a copy effect adds as an exception, like "and this ability", are copied along (707.9a).
- **X before targets (601.2b-c via 602.2b):** an activated ability's X is announced before
  its targets, so a target can depend on it ("with mana value X"). The X shown first is the
  highest that has a target.
- **Replacement effects as a permanent enters** (614.1c, 614.12a), with a choice: Mox
  Diamond's discard, Cavern of Souls's and Roaming Throne's creature type (all of 205.3m),
  Mockingbird's copy. "Artifacts and creatures your opponents control enter tapped"
  (Blind Obedience).
- **Abilities one permanent gives another (613.1f):** Equipment and Auras that give a
  triggered ability ("has 'Whenever this creature deals damage to an opponent, ...'"),
  only while a condition holds (Helm of the Ghastlord's blue or black), or until end of
  turn (Malakir Rebirth's "When this creature dies, return it"), and ward ("Other
  creatures you control have 'Ward—Pay 2 life'"). The ability is the creature's own, and
  a layer 6 effect with its source's timestamp (613.7a). Types given by effects ("is a Wizard in addition to its other types",
  Urborg's "Each land is a Swamp", which then taps for {B}, 305.6).
- **Continuous effects in layers (613):** every permanent's types, abilities, power and
  toughness are worked out by `characteristics` (src/engine/layers.ts) from its copiable
  values, applying each effect in its layer: types (4), colours (5: "becomes black"
  replaces its other colours, 105.3, and Leyline of the Guildpact's "Each nonland permanent
  you control is all colors"), abilities (6), then power and
  toughness: characteristic-defining abilities (7a), "base power and toughness" (7b),
  +N/+N and counters (7c), switching (7d). Within a layer, effects apply in timestamp
  order (613.7), and an ability that changes something in several layers does so in all
  of them as it first applied (613.6). An effect that depends on another in the same
  layer waits until just after it (613.8): one that would apply to more or fewer things,
  or do something different, once the other applied. Urborg makes an artifact a Swamp
  once another effect made it a land, whichever came first, and "+X/+0 where X is its
  toughness" counts the +0/+2 from a later effect. Effects that depend on each other in a
  loop apply in timestamp order. Timestamps: a permanent gets one as it enters,
  becomes attached, or transforms; a static ability has its permanent's; an effect from a
  spell or ability gets its own when it starts, locked in (611.2c); counters of a kind
  get the newest one's (613.7c). Permanents entering together get theirs in APNAP order,
  and a person chooses the order of their own when two or more have static abilities
  (613.7m; bots keep the listed order). "Other permanents you control have
  indestructible" covers noncreature permanents too, and a Vehicle crewed into a creature
  gets "creatures you control" bonuses. A permanent that loses a card type loses the
  subtypes that went only with it, and gets them back if a later effect gives that card
  type back (205.1a): a reconfigured Equipment stops being a creature and isn't a Cat
  (702.151b), and one that loses the artifact type isn't Equipment. A subtype given to an
  object without its card type does nothing: a noncreature isn't a Wizard, a nonland isn't
  a Swamp (205.3d; every list of subtypes in 205.3 comes from the rules by
  `npm run fetch-rules`). Types are whole words: a Pirate isn't a Rat, and Time Lord is one
  creature type (205.3b). "Until your next turn" ends as that turn begins, or as the next
  player's would if you left the game (800.4m); "for as long as" ends when that object
  leaves.
- **Losing abilities (613.1f):** "loses all abilities" (113.10) takes a permanent's own
  abilities, keywords, triggered, activated, static, mana (its basic land types' too,
  305.6), characteristic-defining (so Tarmogoyf's shape is 0/1) and ward, and every
  ability effects with earlier timestamps gave it; later ones give abilities back.
  "Loses flying" takes every instance (113.10b). Restrictions like "can't attack" and
  designations like harnessed aren't abilities, so they stay (113.12, 701.64b). An
  ability that is lost does nothing more: its static effects stop applying, even ones it
  gave other permanents in layer 6 (they depend on the loss, 613.8a), but an effect that
  had started to apply goes on in later layers (613.6), and an ability already on the
  stack still resolves (113.7a). A creature entering under Humility loses its abilities as
  it enters, so its "enters" abilities don't trigger and it doesn't enter tapped or with
  counters by its own abilities (603.6b, 614.12); one entering at the same time as Humility
  still enters that way, as Humility's effect doesn't exist yet, but doesn't trigger. A Saga that lost its chapter abilities
  isn't sacrificed (714.4), and an Aura that lost its enchant ability stays on what it's
  attached to (303.4c).
- **Untapping in other players' untap steps** (502.3, Unwinding Clock, Bender's
  Waterskin).
- **Entering at the same time (603.6a):** cards an effect puts onto the battlefield
  together all see each other enter (Eerie Interlude, Ghost Vacuum, Lively Dirge, Winds
  of Abandon's lands). If one of them has a replacement effect that asks a choice as it
  enters (614.12a, a shock land's life or Roaming Throne's creature type), every such
  choice is made first and then they all enter. What the effect says the card is or has
  ("is a 1/1 Spirit", "gains haste") applies as it enters, and what it does afterwards
  ("sacrifice it at the beginning of the next end step") waits for the choice too.
- **Phasing (702.26):** phased-out permanents are drawn faded at the back of their
  controller's side and treated as though they don't exist; they phase in during that
  player's next untap step, with Auras and Equipment attached to them (Teferi's
  Protection, Talon Gates of Madara).
- **Airbending (701.65):** the permanent or spell is exiled, and its owner may cast it
  from exile for {2} for as long as it stays there (Appa, Avatar's Wrath, Avatar
  Yangchen, Monk Gyatso).
- **Plotted cards (702.170d):** Aven Interrupter's exiled spell may be cast free by its
  owner on a later turn, at sorcery speed.
- **Harnessed (701.64)** and abilities a Saga's chapter gives it (Urza's Saga, The Mind
  Stone, The Soul Stone): they last as long as the permanent stays.
- **Adapt (701.46), persist (702.79), reconfigure (702.151)** and "whenever one or more
  +1/+1 counters are put on this" (Emperor of Bones, which also uses finality counters,
  122.1h).
- **Abilities from other cards:** creatures with +1/+1 counters have the activated
  abilities of the creature cards exiled with Agatha's Soul Cauldron (607.2a), and you
  may spend mana as though it were any colour on them.
  "Enters with counters". Actions from an opening hand (103.6, Gemstone Caverns).
- **The legend rule (704.5j):** you choose which to keep; bots keep the untapped, ready
  one.

### Card frames

- **Double-faced cards (712):** transforming cards turn over (701.27) and stay the same
  object; modal double-faced cards are cast as either face, or played as a land face
  (712.11b, 712.12). Off the battlefield and stack a card has its front face (712.8a); a
  transformed permanent's mana value is its front face's (712.8e).
- **Split cards (709):** cast either half; anywhere but the stack the card has both halves
  combined (its mana value is the total).
- **Adventurer cards (715):** cast the creature, or the Adventure, which goes to exile
  when it resolves and can be cast from there as the creature (715.3d). A countered
  Adventure goes to the graveyard. A land with an Adventure (Ishgard, the Holy See) is
  played from exile afterwards, as the turn's land.
- **Aftermath (702.127):** the first half is cast only from the hand, the aftermath half
  only from the graveyard, and it is exiled whenever it leaves the stack.

### Casting from other zones

- **Flashback (702.34):** cast from your graveyard for the flashback cost, then exiled
  whenever it leaves the stack (countered too).
- **Escape (702.138)**, given by Underworld Breach or printed on the card (Cling to Dust,
  "exile five other cards"); you pick the cards to exile while paying.
- **"You may cast / play that card this turn"** from any exile (Ragavan, Jeska's Will,
  Harnfel, Mnemonic Betrayal, whose spells take mana of any type). A land played this way
  is the turn's land (305.2a). "Until end of turn, you may play that card without paying its
  mana cost" (Urza): a spell cast this way pays nothing, an alternative cost, so no other
  alternative cost can go with it and X is 0 (118.9a, 107.3b).
- **Casting while a spell resolves**, without paying its mana cost (608.2g, Beseech the
  Mirror), or paying it from a graveyard (Emet-Selch, which also exiles the spell instead
  of putting it into a graveyard).
- **Rebound (702.88):** a spell cast from the hand is exiled as it resolves and may be
  cast free at your next upkeep.
- **Paradigm (702.192):** the spell is exiled; after the first one of that name you
  resolve, a copy of it is made in exile at each of your precombat main phases, and you
  may cast it free. A copy you don't cast ceases to exist.
- **Cascade (702.85):** when you cast a spell with cascade, once for each instance it has
  ("Cascade, cascade", or a second The First Sliver's "Sliver spells you cast have
  cascade", 702.85c), cards are exiled face up from the top of your library until a
  nonland card with lesser mana value, which you may cast without paying its mana cost if
  the resulting spell's mana value is less (a split card's half counts on its own); then
  every exiled card that wasn't cast goes on the bottom in a random order. The spell's
  mana value is as cast, X counted (202.3e). Zhulodok, Void Gorger gives colorless spells
  with mana value 7 or more cast from your hand two instances, which resolve one after the
  other, the first's spell on the stack above the second trigger.
- **Abilities that function from the command zone (113.6b, eminence):** Edgar Markov's
  "Whenever you cast another Vampire spell, if Edgar is in the command zone or on the
  battlefield" (an intervening "if", 603.4: a commander that changed zones meanwhile is a
  new object and makes nothing), The Ur-Dragon's "other Dragon spells you cast cost {1}
  less" and Oloro's "At the beginning of your upkeep, if Oloro is in the command zone".
  A script lists the hooks that work from there in `fromCommandZone`.
- **Ninjutsu and commander ninjutsu (702.49):** an activated ability of a card in your
  hand, or your command zone too for commander ninjutsu (Yuriko, the Tiger's Shadow). Its
  cost returns an unblocked attacking creature you control to its owner's hand, so it can
  be activated only once blockers are declared (509.1h) and until combat ends; the card is
  put onto the battlefield tapped and attacking what that creature was attacking (702.49c),
  unblocked (508.4d), and it never "attacked" (508.4). Activating it from the command zone
  isn't casting: no commander tax is paid or added (903.8).

### Combat

- **Multiplayer combat:** each attacker picks its own defending player (or one of their
  planeswalkers or battles); every attacked player declares blocks in turn order; players
  are eliminated mid-game, and what they had on the stack goes with them.
- **Attacking planeswalkers and battles (506.3, 508.1b):** unblocked damage, and trample
  damage past blockers, goes to the attacked permanent; if it has left, the attacker
  deals no damage (510.1b). Bots attack a planeswalker when killing it is worth more than
  hitting its controller, attack battles they control, and chump-block to save a
  planeswalker or battle that the attack would finish.
- **Combat damage assignment (510.1):** an attacker blocked by two or more creatures
  divides its damage as its controller chooses (510.1c); there is no damage assignment
  order. With trample, damage goes past the blockers only once each has lethal damage,
  counting damage already marked and any damage from a deathtouch source (702.19b,
  702.2c). The whole assignment is checked, and an illegal one is refused (510.1e). The
  human is asked (an `assignDamage` decision) only with the setting on; otherwise, and
  for bots, the split is automatic: lethal to each blocker in turn, then the rest to the
  last one or past them with trample. Each damage step asks separately (510.4).

### Other mechanics

- **Searching a library (701.23):** the player looks at every card and picks a valid one,
  or may find nothing (701.23b). The spell stays on the stack until the choice is made.
  A search can be for any card, which must find one if it can (701.23d), or for a type,
  subtype, mana value or toughness (a characteristic-defining "*" counts, 208.2a), and
  puts the card into a hand, on top after shuffling, or onto the battlefield (tutors,
  fetch lands). A bot's card that isn't revealed isn't named in the log (701.23e).
- **Per-turn counts:** spells cast (and noncreature spells) by each player, cards drawn,
  and players dealt combat damage. Storm (702.40) copies a spell for each spell cast
  before it this turn; "second spell each turn" and "first noncreature spell each turn"
  trigger.
- **Turn-long effects:** "can't cast spells this turn" (Silence), "as though it had
  flash" (Borne Upon a Wind, Valley Floodcaller), and permanents that stop opponents
  casting or activating (Grand Abolisher, which also stops their artifacts' mana
  abilities). "Can't be countered" works (113.6g).
- **Also:** mill (701.17), discarding at random, cumulative upkeep (702.24), mobilize
  (702.181), "two target players" that must be different (115.3), ward (702.21),
  choosing new targets (115.7d), gift (702.174), bargain (702.166), dash (702.109),
  surveil (701.25), delirium, "attacks each combat if able" (508.1d: one left out attacks
  the next opponent), "skip your draw step", "whenever you discard", "at the beginning of
  combat on your turn" (507), and "whenever this becomes tapped" however it is tapped: for
  mana, to attack, for a cost or by an effect.
- **Protection from a colour (702.16):** it can't be targeted, blocked by, enchanted or
  equipped by, or dealt damage by anything of that colour. The colour is chosen as the
  spell or ability resolves (Mother of Runes, Sejiri Shelter), or printed: "Protection from
  white and from black" is two protection abilities (702.16g, Animar).
- **Damage and life:** damage prevention (615, Solitary Confinement's "Prevent all damage
  that would be dealt to you"), shroud on a player (702.18a), each player's life lost
  this turn ("if a player lost 4 or more life this turn"), "whenever a source deals
  damage to a player", and "whenever one or more opponents lose life", which triggers once
  for an event that hits several players at once: "each opponent loses 1 life" (Wicked
  Role too), combat damage, extort.
- **Trigger doubling (603.2d):** Roaming Throne's "triggers an additional time", even for
  a creature that died alongside it (603.10a). Elesh Norn, Mother of Machines does it for
  abilities of your permanents that a permanent entering causes to trigger, and stops
  such abilities of your opponents' permanents from triggering at all. Annie Joins Up
  does it for a legendary creature's own abilities, Isshin, Two Heavens as One for
  abilities a creature attacking causes to trigger ("whenever this attacks", mobilize,
  "whenever a creature attacks", "whenever you attack", exalted; a creature becoming tapped
  as it attacks is another event), and Teysa Karlov for abilities a creature dying causes to
  trigger ("when this dies", "whenever a creature dies", a creature leaving the
  battlefield for a graveyard, and a creature card, an artifact creature's included, put
  into a graveyard from the battlefield, 700.4, the creature as it last was, so a land made
  a creature counts; "whenever you sacrifice a permanent" triggers on the sacrifice, not
  the dying, so it doesn't double, as Teysa's rulings say). A creature dying together with
  Teysa still counts, and each further Teysa adds one more. Delayed and reflexive triggered
  abilities are never doubled (603.2d).
- **Protection for a player (702.16):** Serra's Emissary's "You ... have protection from
  the chosen card type": damage from such sources is prevented and spells and abilities
  from them can't target you.
- **Ward with other costs (702.21a):** "Ward—Pay 2 life", ward {N} alone or among other
  keywords ("Flying, ward {2}"), and "Ward—Sacrifice a Food" or "Ward—Sacrifice a legendary
  artifact or legendary creature": the targeting player picks one of their permanents that
  fits to sacrifice, or none (Don't Pay), and the spell or ability is countered unless they
  sacrificed one. With nothing that fits, it is countered without asking (118.3).
- **Amass (701.47):** with no Army, a 0/0 black [subtype] Army token is made; the player
  chooses among their Armies if they have several; it gets the counters, and becomes the
  subtype in addition to its others if it isn't one (Sauron, Orcish Bowmasters).
- **The Ring tempts you (701.54):** the player gets the emblem The Ring the first time (one of
  their emblems, 114, shown on the portrait), then chooses one of their creatures as Ring-bearer (asked only with two or more), even with none
  it counts as being tempted, and "whenever the Ring tempts you" triggers (701.54d). The
  Ring-bearer is legendary (layer 4, the emblem's timestamp) and can't be blocked by creatures
  with greater power; tempted two or more times, it loots as it attacks; three, a creature
  blocking it is sacrificed by its controller at end of combat (511.2); four, its combat
  damage to a player makes each opponent lose 3 life. The designation ends when another
  creature is chosen or another player gains control of it, even if control comes back
  (701.54a). "If [this] is your Ring-bearer" and "the Ring has tempted you N or more times
  this game" are conditions (Frodo). The table marks the Ring-bearer with a gold ring.
- **Partner with (702.124j):** besides the deck rule, "When this permanent enters, target
  player may search their library for a card named [name], reveal it, put it into their
  hand, then shuffle" (Frodo and Sam): the target player chooses whether to search.
- **Types and an ability from a static ability:** "Other creatures are Food artifacts in
  addition to their other types and have '{2}, {T}, Sacrifice this permanent: You gain 3
  life'" (Ygra), "Artifacts you control are Foods ..." (Ragost): card types and subtypes in
  layer 4 (205.1b, an object keeps only subtypes that go with its types, 205.3d), the
  activated ability in layer 6, to the same objects (613.6). "This permanent" in it is the
  permanent that has it.
- **Activated abilities that cost less (602.2b, 601.2f):** "Activated abilities of Foods you
  control cost {1} less to activate" (Sam) takes generic mana off every activated ability of
  those permanents, mana abilities with mana in their cost included, never below {0}.
- **"Whenever an opponent loses life for the first time during each of their turns"**
  (Valgavoth): only the first life they lose in their own turn; several losses at once
  (combat damage from two creatures) are one first time.
- **Token copies that aren't legendary (707.9b):** "create a token that's a copy of it,
  except the token isn't legendary" (Miirym), from its copiable values as it last was if it
  has left (608.2h).
- **Flavor words (207.2d)** like Ghyrson Starn's "Three Autostubs —" are labels with no rules
  meaning.
- **Suspend (702.62):** a card that gains suspend (Delay's countered spell) loses a time
  counter in each of its owner's upkeeps; when the last is removed, its owner may cast it
  without paying its mana cost, and a creature spell cast this way has haste.
- **Maximum hand size (402.2):** effects that change it, like Jin-Gitaxias, Progress
  Tyrant's "Each opponent's maximum hand size is reduced by seven", down to 0.
  Harmonic Prodigy does it for a Shaman's or another Wizard's triggered abilities.
- **Damage that is doubled or increased (614.1a):** Furnace of Rath, Trance Kuja (a
  Wizard you control), Collective Inferno (sources you control of the chosen type), and
  Tomik's "plus 1" for noncombat damage to an opponent or their permanent.
- **Replacement and prevention effects (614-616):** one system for every event they can
  change: damage (doubling, plus N, prevention, protection), a card changing zones
  (finality counters, flashback, "exile it instead"), draws (614.11, even from an empty
  library), tokens being created and counters being put on (614.16, including the
  counters a permanent enters with, but not a loyalty cost or a Saga's turn-based lore
  counter), gaining life (119.10), how a permanent enters (614.1c-d), and skipping a draw
  step or an extra turn (614.10). Each effect applies once to an event (614.5). When two
  or more apply and the order changes what happens, the affected player chooses which
  goes first, after any that must (616.1a-f); you're asked only then, with what each
  choice leads to, and bots take what is best for them. "You may" replacement effects ask
  too. A general effect of a permanent doesn't apply to it or to others entering at the
  same time (614.12), and tokens created together enter together.
- **Roles (303.7):** a Role token enters attached to its creature (Not Dead After All's
  Wicked Role). If a player has two or more Roles on the same permanent, all but the one
  attached most recently go to the graveyard (704.5z); each attachment gets a new
  timestamp (613.7e). A Role that can't be attached isn't created.
- **Changeling (702.73):** every creature type, in every zone (Black Market Connections'
  Shapeshifter is a Wizard for Kuja, and a search for a creature type finds a changeling
  card in the library). It is a characteristic-defining ability, so it applies first in
  layer 4 (604.3, 613.3). **Devoid (702.114)** likewise makes an object colorless in every
  zone, first in layer 5, so "becomes black" still makes it black.
- **Impending (702.176):** cast for its impending cost, the permanent enters with N time
  counters and isn't a creature while it has one (a layer 4 effect, so it loses its
  creature types too); at the beginning of its controller's end step, one is removed.
  Cast for its mana cost, time counters put on it change nothing (`impending` in a card's
  script).
- **Transforming (701.27f):** a permanent's own ability transforms it only if it hasn't
  transformed since the ability went on the stack (Kuja).
- **"When enchanted permanent dies or is put into exile, return that card"** (Kaya's
  Ghostform): it looks back in time, so it works when the Aura goes at the same time.
- **"Do this only once each turn" (603.2h):** the ability doesn't trigger again that turn
  once its controller has done it (G'raha Tia, Emet-Selch). Declining a "you may" isn't
  doing it, and one that triggered alongside does nothing once the action is taken (Tidus's
  Cheer: "you may draw a card and proliferate").
- **Looking at the top of a library:** "the rest on the bottom in any order" lets you
  order them (401.4); "in a random order" shuffles them. A look can show cards you can't
  take (Silundi Vision's six, only an instant or sorcery can be taken).
- **"Until the end of your next turn"** (Single Combat), and choices each player makes in
  turn order before anything happens (101.4): Single Combat's and Papalymo Totolymo's
  sacrifices happen together.
- **Playing exiled cards later:** "until the end of your next turn" (Light Up the Stage,
  Hex Magic, Matoc, Bloodsoaked Insight, which also lets you spend mana of any type), and
  "for as long as they remain exiled, you may play them if you control a Wizard"
  (Flameshape, whose cards are exiled face down but you may look at them). "As many times
  as you choose, exile the top card" (Dance with Calamity), and "exile cards until a
  nonland card" (Tibalt's Trickery, Ensnared by the Mara).
- **Counters on players (122.1):** a player can have counters of any kind: poison (ten or
  more lose the game, 704.5c), experience (Meren of Clan Nel Toth), rad (728). They show
  under the player's name. No replacement effect changes counters put on a player.
- **Proliferate (701.34a):** the player chooses any number of permanents and/or players
  that have a counter (none included) as it resolves, then each gets one more counter of
  each kind it has, all at the same time. A bot chooses its own permanents and itself where
  the counters help it (anything but -1/-1, stun, defense, time, finality, poison, rad), and
  its opponents' where they hurt.
- **Blight N (701.68a):** the player puts N -1/-1 counters on a creature they control, of
  their choice; with none they can't, and nothing happens (701.68b). "Each opponent blights
  1" is chosen in turn order from the active player (101.4). **Ward—Blight N** (702.21a) is
  paid by blighting, or not paid by choosing no creature, which counters the spell or
  ability; a player with no creature can't pay. Blighting for ward is a cost, so "if an
  effect would put counters" replacements don't change it. A bot pays only with a creature
  that survives it, or one worth little.
- **Rad counters (728.1):** at the beginning of each player's precombat main phase, if they
  have rad counters, a triggered ability with no source, controlled by them, mills that
  many cards; for each nonland card milled they lose 1 life and remove a rad counter. The
  "if" is checked again as it resolves (603.4).
- **Moving a counter (122.5):** removed from one permanent and put on the other, as any
  counter is put on (so replacement effects and "whenever counters are put on" see it). If
  either can't happen, neither does: the same permanent twice, no such counter, or one of
  them gone. Two instances of "target" ("from target creature ... onto a second target
  creature") may be the same creature (115.3); then nothing moves. With several kinds on the
  first, its controller chooses which.
- **Decayed (702.147a):** the creature can't block, and when it attacks, a delayed
  triggered ability sacrifices it at end of combat (511.2, 603.7), if its controller still
  controls the same object then. A decayed keyword counter works too (122.1b).
- **"One or more" events (603.2c):** "whenever one or more cards are milled" triggers once
  for each event, however many players milled in it ("each opponent mills X" is one event);
  "whenever one or more [kind] counters are put on a creature" once for each creature and
  kind, entering with them included (122.6); "whenever one or more creatures you control
  deal combat damage to a player" once for each player dealt combat damage in a combat
  damage step, with every creature that hit them (Kutzil, Malamet Exemplar's "each with
  power greater than its base power": base power is layer 7a-7b, 613.4a-b, before counters
  and +N/+N effects).
- **"Up to X target ..." with X from the event** (The Wise Mothman's "where X is the number
  of nonland cards milled this way"): at most X targets, chosen as the ability goes on the
  stack.
- **"Spend this mana only to cast an Angel spell"** (106.6, Giada): any spell with that
  subtype, creature or kindred.
- **"Tap N untapped [permanents] you control" as a cost** (High Perfect Morcant): exactly N
  untapped ones that fit, chosen as it is activated; the source may be one of them, and
  summoning sickness doesn't matter (302.6). With {T} in the cost as well ("{T}, Tap ten
  untapped Elves you control", Lathril, Blade of the Elves) the source isn't one of them.
- **The amount of life you gained or lost this turn** (Hope Estheim, Betor), counted as
  the ability resolves.
- **Populate (701.36):** you choose which creature token to copy, and a token that is
  itself a copy copies what it copies.
- **Linked abilities** (607, Chrome Mox), cards exiled face down (406.3), and targets in
  a graveyard. "Cards exiled with" a permanent (Skyclave Apparition, Ghost Vacuum,
  Currency Converter, Emperor of Bones) are the ones it exiled while it stayed the same
  object (400.7).
- **Exile triggers:** "whenever one or more cards are put into exile from graveyards
  and/or the battlefield" triggers once for each event, however many cards it moved
  (603.2c; Ketramose: Relic of Progenitus's cost is one event, exiling every graveyard
  another, and so are Bojuka Bog's "exile target player's graveyard" and "exile all
  creatures"). It looks back in time, so Ketramose sees itself exiled along with the rest
  (603.10a). Every effect that moves several cards at once (a graveyard, a hand, the top
  of a library, a board wipe, mill, surveil, each player discarding their hand) moves them
  as one event; "when this leaves the battlefield"
  and "whenever a creature you control with a +1/+1 counter leaves" look back in time
  (603.10a, Skyclave Apparition, The Ooze).
- **Life and protection for a player:** "your life total can't change" (119.7, 119.8;
  Flare of Fortitude, Teferi's Protection), "you gain protection from everything"
  (702.16j), life gained this turn (Haliya), and "if an opponent would begin an extra
  turn, that player skips that turn instead" (614.10, Trouble in Pairs).
- **Revealing and exiling until (701.20a):** "reveal cards from the top of your library
  until you reveal a creature card. Put that card onto the battlefield and the rest on the
  bottom in a random order" (Atla Palani, Tom Bombadil, and the parser's template, with "into
  your hand" too): everyone sees the cards revealed. "Exile cards from the top until you
  exile a legendary nonland card with lesser mana value. You may cast that card without
  paying its mana cost. Put the rest on the bottom" (Jodah): as its rulings say, a card not
  cast then stays in exile and can't be cast later, and with none found the exiled cards
  become the library again in a random order. "Reveal that many cards ... put any number of Dinosaur creature cards onto the
  battlefield" (Gishath), "look at that many ... one into your hand, any number of lands onto
  the battlefield tapped and the rest into your graveyard" (Choco), and "look at the top N.
  You may put a Dragon creature card from among them onto the battlefield" (Ureni).
- **Discover (701.57):** exile from the top until a nonland card with mana value N or less;
  its owner may cast it without paying its mana cost if the spell's mana value is N or less,
  or else puts it into their hand; the others go on the bottom in a random order (`discover`,
  Pantlaza, whose "do this only once each turn" is 603.2h).
- **Put onto the battlefield attacking (508.4):** the creature is attacking the player (or
  planeswalker or battle) the effect names, but it never "attacked", so nothing triggers on
  it attacking (Kaalia's "tapped and attacking that opponent"). When the effect doesn't say
  what it attacks (mobilize, 702.181a, Zurgo Stormrender and Voice of Victory; Caesar's
  Soldiers), its controller chooses which defending player, planeswalker or battle, every
  opponent being a defending player (802.2); with one thing to attack, no question, and bots
  attack the opponent with the least life. It isn't attacking if it
  isn't a creature, if its controller isn't the attacking player, or if that player has left
  the game or that planeswalker or battle is gone (506.3a-c, 506.3f, 508.4a); put there after
  blockers are declared, it is unblocked (508.4d).
- **Cards leaving a graveyard (603.10a):** "whenever one or more cards leave your
  graveyard" (Teval) triggers once for each event, however many cards left in it: returned,
  exiled, cast (601.2a) or put anywhere else. It looks back in time.
- **Sagas:** "whenever the final chapter ability of a Saga you control resolves" (Tom
  Bombadil; the final chapter is the greatest one, 714.2d-e, and one that did nothing for want
  of targets didn't resolve, 608.2b); lore counters among Sagas you control. "This ability
  triggers only once each turn" (a trigger's `oncePerTurn`) is a limit: an effect that makes
  it trigger an additional time (603.2d, Roaming Throne) adds no second instance, since
  "can't" beats an effect that would make it happen (101.2).
- **Draws:** "except the first one they draw in each of their draw steps" (504.1; Xyris,
  Orcish Bowmasters), and "at the beginning of each player's draw step, that player draws an
  additional card" (Nekusar), after the turn's own draw (504.2).
- **Where a card came from:** "a card in an opponent's graveyard that was put there from
  their library this turn" (Captain N'ghathrod).
- **An ability about a permanent that has left the battlefield** ("where X is that creature's
  toughness", Pantlaza) uses it as it last was there (608.2h), not as it entered.
- **Reflexive triggers (603.12):** "When a creature card is exiled this way, ..." (Agatha's
  Soul Cauldron), and "you may sacrifice another creature. When you do, choose two —"
  (Caesar, Legion's Emperor): the sacrifice is chosen as the ability resolves, and the
  reflexive ability's modes as it goes on the stack (603.3c).
- **Combat damage from toughness (510.1a):** Arcades, the Strategist's creatures with
  defender and Felothar the Steadfast's creatures assign combat damage equal to their
  toughness, attacking or blocking, and may attack as though they didn't have defender
  (702.3b). Both are effects on the creature, not abilities of its own (113.12), so losing
  all abilities doesn't take them.
- **"Whenever a creature token you control leaves the battlefield, draw a card if it was
  attacking"** (Zurgo Stormrender): whether it was attacking is remembered with the event
  (603.10a).
- **More triggers:** "whenever an opponent searches their library" (once for each search,
  701.23h, Archivist of Oghma), "whenever two or more creatures attack" (Argent Dais),
  "becomes the target of a spell or ability" (Monk Gyatso), "draws their second card each
  turn" (Trouble in Pairs), "whenever you cast a spell from exile" (Appa) and "spells
  your opponents cast from graveyards or from exile cost {2} more" (Aven Interrupter).
- **"No more than one creature can attack [this planeswalker] each combat"** (508.1c,
  The Eternal Wanderer). "Until your next turn, your opponents can't cast spells from
  anywhere other than their hands" (Avatar's Wrath).
- **The monarch (725):** "you become the monarch" (Queen Marchesa; the parser reads it),
  and its two inherent triggered abilities, which have no source: the monarch draws a card
  at the beginning of their end step, and a creature dealing combat damage to the monarch
  makes its controller the monarch (725.2), as the ability resolves. Only one player is
  the monarch (725.3); when the monarch leaves the game the active player takes it, or
  the next player in turn order (725.4). "If an opponent is the monarch" is an
  intervening "if" (603.4). A crown on the portrait shows who it is.
- **Goad (701.15):** a designation (not an ability, so it survives losing abilities) that
  lasts until the goading player's next turn. A goaded creature attacks each combat if
  able and attacks a player other than its goaders if able (508.1d): declaring it at a
  goader while another player could be attacked for free is refused, and one left home is
  sent at a player who didn't goad it (or any player, if only goaders can be attacked for
  free). Several players can goad it (701.15c); the same player goading it again changes
  nothing (701.15d). Alela, Cunning Conqueror; "goad target creature" is read by the
  parser. Bots attack with goaded creatures as the requirements say.
- **Rolling dice (706):** "roll a six-sided die", and one more for each mana from
  Treasures spent on the ability (the mana spent is remembered by its source, Mr. House,
  President and CEO). Each die is its own roll: "whenever you roll a 4 or higher" triggers
  once for each (603.2c), with the result it triggered on. No effect here modifies rolls.
- **The bending keywords:** earthbend (701.66: the land is a 0/0 land creature with haste
  for as long as it stays, with the counters; when it dies or is exiled it returns tapped
  under the earthbender's control, a delayed trigger for each player who earthbent it;
  Toph, the First Metalbender), firebending (702.189: "whenever this creature attacks,
  add N {R}" that stays in the pool until the combat phase ends, 500.5a; Fire Lord
  Azula, Avatar Aang; the parser reads "firebending N"), airbend (701.65, see above), and
  "whenever you waterbend, earthbend, firebend, or airbend" with "if you've done all four
  this turn" counted over the whole turn (Avatar Aang). Waterbend itself (701.67) waits
  for a card that needs it: no card here waterbends.
- **"Nontoken artifacts you control are lands in addition to their other types"** (Toph):
  a layer 4 effect, on the battlefield only; they gain no mana ability.
- **Cost reductions by coloured mana (118.7b-f):** "Spells you cast cost {W}{U}{B}{R}{G}
  less" (Aang, Master of Elements, with Morophon's `reducesColoredCost`) takes one mana of
  each colour off, a hybrid half chosen so as many symbols as possible are paid for, or one
  generic mana for a colour the cost doesn't have.
- **Additional lands (305.2b):** "you may play an additional land this turn" (a permission,
  cumulative, no question asked; Hearthhull, Explore) and "you may play an additional
  land on each of your turns" / "two additional lands" (Exploration, Azusa), both read by
  the parser.
- **Transforming at an upkeep with "you may":** Aang, Master of Elements asks at each
  upkeep; "if you do" follows only if he transformed (701.27f).
- **"During your turn, each [artifact and enchantment] is a 4/4 Elemental creature ...
  and has ..."** (Bello, Bard of the Brambles): types in layer 4, the abilities in layer 6,
  base power and toughness in layer 7b, on its controller's turn only.
- **Keywords:** flying, reach, first strike, double strike, deathtouch, lifelink,
  trample, vigilance, haste, defender, hexproof, indestructible, menace, fear (702.36),
  flash, storm, earthbend, goad, firebending, station,
  cumulative upkeep, mobilize, ward, dash, bargain, gift, afterlife, delve, rebound, decayed,
  aftermath, paradigm, extort (702.101), job select (702.182), convoke, escape,
  overload, evoke, warp, spree, persist, reconfigure, discover (701.57), cascade (702.85),
  affinity (702.41), ninjutsu and commander ninjutsu (702.49), blitz given by a permanent
  (702.152), and protection from a colour or from everything.
- **"If this is the second time this ability has resolved this turn"** (Ms. Bumbleflower,
  Omnath, Locus of Creation, Sephiroth): the engine counts each ability's resolutions this
  turn, one ability of one object (400.7: a permanent that left and came back has a new count),
  a copy of the ability counting as the ability (707.10b). An ability that does nothing because
  its targets have all gone hasn't resolved (608.2b) and isn't counted.
- **Emblems (114):** "you get an emblem with ..." puts one into its owner's command zone, kept
  apart from the commanders (it is neither a card nor a permanent, 114.5). Its abilities work
  there (114.4): they trigger like a permanent's. It leaves the game with its owner (800.4a).
  The portrait shows a player's emblems; hovering one shows its ability.
- **"As this creature transforms into [this face], ..." (712.20):** applied while it transforms,
  not afterward (Sephiroth's Super Nova emblem).
- **More triggers (tokens group):** "whenever one or more [tokens] you control enter", once for
  each event that puts permanents onto the battlefield (603.2c; Marneus Calgar), and "whenever a
  [Dwarf] you control becomes tapped", only when it was untapped (Magda). Tokens of several kinds
  that one effect creates ("create a Treasure token and a Food token") are created in one event
  (111.2), as the parser reads them: a replacement effect sees them all (614.1a), and "one or
  more tokens enter" triggers once.
- **Attack restrictions on a defender (508.1c):** Eriette's "Each creature that's enchanted by
  an Aura you control can't attack you or planeswalkers you control": such a creature may still
  attack another player, or a battle. A creature that must attack can't break it to do so
  (508.1d). Bots don't try it, and on the screen such a creature doesn't glow while its
  attackers go after you.
- **"Sacrifice X [permanents]" (107.3a):** X is announced as the ability is activated, then
  exactly that many are sacrificed (Chatterfang's "{B}, Sacrifice X Squirrels").
- **Each player chooses, then it all happens at once (101.4):** Kefka's "each player discards a
  card" and "each opponent sacrifices a permanent of their choice" ask each player in APNAP order
  (a player sees what those before chose, 101.4b, but not a card hidden in their hand, 101.4a),
  then do every discard or sacrifice as one event. "A card for each card type among cards
  discarded this way" counts the card types (205.2a): an artifact creature counts two.
- **Exalted (702.83):** each instance on each permanent its controller controls triggers when
  a creature attacks alone (506.5), printed or given; "that creature" is the attacker, if it
  is still the same object (400.7).
- **Riot (702.136):** "You may have this permanent enter with an additional +1/+1 counter on
  it. If you don't, it gains haste." A replacement effect as it enters (614.1c), so the
  choice is asked as the replacement question; each instance is chosen on its own
  (702.136b), whether printed or given as it enters (Rhythm of the Wild's "Nontoken creatures
  you control have riot", 614.12). Bots take haste on their own turn before combat, else the
  counter.

### Bots

Bots consider every face (split halves, Adventures, modal faces), cast from the graveyard
and from exile, play a modal card as a land only when they have no other land and few on
the battlefield, level Classes, and crack Food and Clues when it helps. They sacrifice
their least valuable permanent and discard the cards they want least. Bot behaviour tied
to one mechanic is described with that mechanic above.

## Known simplifications

These are deliberate cuts for a prototype. The biggest ones come first.

### Biggest gaps

- **Cards played without their rules text** (approved by the user, from the plan in
  `docs/plans/speed-parser-polish.md`): a card the game can't read yet may, by the
  player's choice on the paste screen, be played as a vanilla card. It keeps its printed
  name, mana cost, colours, types, power and toughness and the keywords the engine
  applies on its own (`PLAIN_KEYWORDS` in `src/cards/support.ts`), and none of its other
  rules text works: no triggered, activated or static ability, no "enters tapped", no
  replacement effect. This is not how the card plays by the rules, so it is never silent:
  the paste screen lists it under "Played without their rules text" with the clause the
  game can't read, its tile and hand card carry a "no text" badge and a greyed name bar,
  the hover preview says so, the log adds "(its rules text doesn't work here)" the first
  time it is cast or played, and the menu's deck tile counts them. The choice is saved
  with the deck (`DeckDef.textless`) and undone on the paste screen. A commander is never
  played this way, nor a card the engine can't frame as a vanilla card (a card with
  faces, or a keyword that needs a script or changes how it is cast). In the engine,
  `Card.textless` makes `scriptFor` return the empty script. Once a newer parser or a
  hand script reads the card, it plays with its text again (`playedDeck`).
- **Auto-pass:** with something on the stack, the game stops for you only when the top
  object is an opponent's and you could act, or when you held priority. Outside that,
  auto-pass follows your stops (`wantsPriority` in `engine.ts`; the UI passes them in
  `applyAction(g, a, { stops })`). Full control (`applyAction(g, a, { fullControl })`)
  stops for that person every time they get priority, stack or not, and lets it pass
  after a spell or ability only when they cast it without `hold`. Bots always use the
  defaults, never hold and are never in full control. The
  engine itself follows the rules: `applyAction(g, a, { autoPass: false })` asks every
  player every time.
- **No priority in the cleanup step.** An ability that triggers there waits for the next
  upkeep instead (514.3a). No card in the pool can trigger then.
- **A card mostly keeps its identity when it changes zones.** By the rules it becomes a
  new object (400.7). Each card counts its zone changes (`Card.moves`), and the cards that
  remember another card across time check it (Necropotence, dash, Mnemonic Betrayal,
  Chrome Mox, Beseech the Mirror, Wishclaw Talisman, Underworld Breach), but targets
  don't: a spell aimed at a creature that left and came back before it resolved still
  finds it.
- **Choosing about replacement effects** (616.1): while you choose, the game shows the
  moment before the action that led to the question (casting the spell, passing
  priority), and carries it out with your answer. Nothing has happened yet when you're
  asked, so the spell may still look like it's in your hand.

### Rules

- **Combat damage:** bots always split it automatically. A blocker blocking two or more
  attackers would divide its damage automatically too (510.1d), but no card in the pool
  can block more than one. Trample over planeswalkers (702.19c) isn't supported.
- **Targets:** "two target lands" can name the same land twice. Targets that exist only
  when kicked (702.33g) aren't supported.
- **Modes and copies:** A copy's controller must pick legal new targets or keep all
  the old ones (707.10c allows keeping some).
- **Layers (613) not built yet:** no card has
  a copy effect with a duration ("until end of turn") yet. In layer 6: "can't have
  [ability]" (113.11); effects that give a permanent an ability other than a keyword, ward,
  enchant, or a triggered, activated or mana ability (such as a static ability); losing a keyword ability the card's script carries, other than ward
  and enchant (the layer system refuses it); and abilities of cards that aren't on the
  battlefield (Yixlid Jailer).
- **Counters:** proliferate, shield, stun and other counters with their own rules
  (122.1c-j) do nothing special yet.
- **Auras** can only enchant permanents and cards in graveyards, not players (702.5d). An
  Aura put onto the battlefield without being cast isn't given something to enchant
  (303.4f), so it goes to the graveyard; no card in the pool does this yet.
- **Sieges:** a defeated Siege's back face is always cast ("you may" is free upside); a
  back face that needs targets gets the first legal ones. The protector is announced with
  the spell rather than chosen as it enters. Only Siege battles exist in print; others
  are protected by their controller.
- **"You may" effects:** in the older scripts, optional effects always happen when they
  are free upside (a defeated Siege's back face, the starter decks' land searches). The
  session 7a cards ask.
- **Cultivate** asks for its two lands one at a time (battlefield, then hand), not as one
  pick of two. It is still one search with one shuffle (701.23h).
- **Copies entering:** a copy that enters with the copied creature's own "as this enters"
  choice doesn't make that choice too (614.12). No creature in the pool has one.
- **Naming a card** (Demonic Consultation) offers every card the game knows, not every
  card ever printed. Naming any card that isn't in your library does the same thing.
- **Mana value:** a spell's mana value counts X on the stack (202.3e) only where a card
  checks it (`manaValue`; Mental Misstep).
- **Birgi's** "creatures you control can boast twice" does nothing: no card in the pool
  has boast.

### Card frames and commanders

- Not supported yet: meld cards (712.4), fuse (702.102), split cards with a
  shared type line (709.5, "unlocking" rooms), Sagas with read ahead (714.3b), disturb and
  other ways to cast a back face from a graveyard, and casting a transformed card's back
  face any way but a defeated Siege.
- Partner variants other than plain partner and "partner with" (Background, Doctor's
  companion, "partner—[text]") aren't recognised. A
  planeswalker that says it "can be your commander" is accepted as one (903.3a).
- **Pasted decks use only the card pool:** the cards in `decklists.json`. Anything else
  is listed as missing. Companions, sideboards and maybeboards in a list are ignored. A
  saved deck can't be edited: delete it and paste it again. Saved decks stay in the
  browser they were pasted in.

### Mana and paying

- **Snow mana** {S} isn't supported.
- **Taking mana back:** any mana ability (605.1a) used by hand can be taken back by
  clicking its source again (or the creature tapped for it, Relic of Legends; Ctrl+Z names
  a source that left, a Treasure). This is a convenience, not a rule: mana abilities can't
  be undone in paper Magic (605.3b). Until the player does anything but use mana
  abilities, taking one back returns the game to just before it (`Game.manaRewind`):
  life paid, damage dealt (painlands, a Talisman's coloured mana, Ancient Tomb), a
  sacrificed Treasure or Lotus Petal, a discarded or exiled card and what it triggered all
  come back, even though other players have seen them. The mana abilities used after it
  are used again; one that was paid with its mana stays taken back. Once the player does
  something else, a source that changed nothing but what is tapped and the pool can still
  be taken back while its mana is unspent (a Signet or filter land with the mana or lands
  that paid its cost).
- **Auto-pay's lookahead** checks your other cards at what they cost now, with commander
  tax and cost increases and reductions (601.2f), but with no kicker, X as 0 and no
  alternative cost. It doesn't foresee cost changes the spell being paid for will bring.
- **Auto-pay** never uses a mana ability that costs a card (Simian Spirit Guide, Skirge
  Familiar), a creature (Phyrexian Tower) or your hand (Lion's Eye Diamond): use them by
  hand.
- **Attack costs** (Propaganda) are paid with auto-pay once attackers are declared: you
  can't pick which lands pay them.
- **Mana Vault** doesn't ask about paying {4} while it is untapped, and **Tymna** doesn't
  ask with no opponent dealt combat damage: paying would change nothing. Both still
  trigger.

### Scripts from Oracle text

`src/cards/oracle.ts` reads common, regular Oracle wording into a script, for cards with
no hand script. It matches each ability, clause by clause, against a list of templates and
builds the script from the helpers in `rules.ts`. One clause it can't read refuses the whole
card, naming the clause: it never guesses. Hand scripts always win.

- **Reading a card:** the card's name, or a shortened one, means the card (201.5c): "Gishath"
  for "Gishath, Sun's Avatar", and a legendary card's "Ureni" for "Ureni of the Unwritten".
  Reminder text is dropped, and an ability word or flavor word in front
  of a line ("Landfall —", "Channel —", "Sell Contraband —") is a label with no rules meaning
  (207.2c, 207.2d). Every ability word is one the rules list (207.2c); a flavor word isn't
  listed (207.2d), so one is a label when the card's keywords name it ("Master Tactician —"),
  except the keywords with rules meaning written the same way: forecast, boast, visit, solved,
  exhaust, max speed and power-up (702). The deck-paste check accepts such a word for the same
  reason, and scry (a keyword action, 701.22) where Scryfall lists it as a keyword. A card with faces (modal double-faced, transforming, split, Adventure) is
  read face by face, one script per face name (712, 709, 715); one face it can't read refuses
  the card. Several abilities on one event become a list on the hook, each triggering on its
  own (603.2).
- **Triggers (603):** "When this enters / dies / leaves the battlefield", "Whenever this
  attacks / blocks / becomes tapped / deals combat damage to a player", "enters or attacks",
  "attacks or blocks", "enters or dies"; "At the beginning of your upkeep / each upkeep / each
  opponent's upkeep / your end step / each end step / combat on your turn / your first main
  phase / each of your postcombat main phases / your draw step"; "Whenever a / another [kind of
  permanent] enters / dies / attacks" (landfall among them), "this or another creature dies",
  "a creature or planeswalker you control dies"; "Whenever equipped or enchanted creature
  attacks / dies / deals damage"; "Whenever a creature you control deals combat damage to a
  player"; "Whenever this or another nontoken Shrine you control enters", "Whenever one or more
  tokens you control enter", "Whenever a Dwarf you control becomes tapped"; "Whenever you gain
  life / draw a card / discard a card / sacrifice a permanent",
  "an opponent draws / loses life / searches their library / casts a spell", "a player draws /
  sacrifices a permanent"; "Whenever you cast a [kind of] spell", magecraft's "cast or copy"
  (207.2c); prowess (702.108a), extort (702.101a), job select (702.182a), afterlife
  (702.135a); "At the beginning of each player's draw step" (504.2, "that player draws an
  additional card"), "Whenever an opponent draws a card except the first one they draw in
  each of their draw steps" (504.1), "Whenever an Egg you control dies" (a creature type
  means a creature, 205.3d). An intervening "if" (603.4) is checked as it triggers and as it resolves.
  "That player", "that much" and "that creature" are the event's; "it" in a trigger about
  another object is that object. Modal triggered abilities ("choose one —", 603.3c).
  "Whenever one or more creatures you control deal combat damage to a player" (once for each
  player hit, 603.2c).
- **Activated abilities (602):** costs of {T}, mana with {X} (107.3a), "Pay N life" (119.4),
  "Discard a card", "Discard this card" (channel, bloodrush: from the hand), "Sacrifice this",
  "Sacrifice a / another / N [kind of permanent]", "Exile this", "Exile a creature you
  control", "Exile N cards from your graveyard", "Remove a counter from this"; "Activate only
  as a sorcery / during your turn / if [condition]"; "This ability costs {1} less for each
  legendary creature you control"; cycling and basic landcycling (702.29), equip (702.6a),
  crew (702.122a).
- **Mana abilities (605):** "{T}: Add {G}", "{C}{C}", "{B}{B}{B}", "{W} or {B}", "{W}, {U},
  or {B}", "one mana of any color", "in your commander's color identity", "that a land an
  opponent controls could produce", "three mana of any one color", Signets ("{1}, {T}: Add
  {W}{U}") and filter lands, with costs of "Pay 1 life", "Sacrifice this", "Sacrifice a
  creature", "Discard a card", "Tap an untapped [legendary] creature you control", "Tap an
  untapped artifact you control", "Tap two untapped tokens you control" (with or without
  {T}) or "Exile this card from your hand", and "This deals 1 damage to you", "Activate only
  if [condition]" or "Activate only as an instant"; "For each color among permanents you
  control, add one mana of that color" (105.2). A mana ability that does anything else is
  refused. Triggered mana abilities (605.1b): "Whenever you tap [a kind of permanent] for
  mana, add an additional [mana]" or "add one mana of any type that permanent produced",
  and "Whenever enchanted land is tapped for mana, its controller adds an additional [mana]".
- **Spells:** instants and sorceries; modal spells ("Choose one / two / one or both / one or
  more / up to N —", 700.2) and spree (702.172), each mode with its own targets; kicker with
  "if this spell was kicked" (702.33); flashback (702.34), escape (702.138), overload, read
  again with "each" for "target" (702.96b); additional costs of a discard, life or a
  sacrifice (118.8); alternative costs of life, a card exiled from the hand or a sacrifice,
  with a condition (118.9); "this spell costs {1} less for each ..." or "{X} less, where X
  is ..." (601.2f); "Affinity for [permanents]" (702.41a) and "[kind] spells you cast have
  affinity for [permanents]"; cascade from the keyword line and "[kind] spells you cast
  have cascade." (702.85); "can't be countered".
- **Effects:** draw, discard (each player chooses, in APNAP order, 101.4), gain or lose life
  (a number, "that much", "equal to its power", "for each ..."), mill, scry (701.22) and surveil
  (701.25), "look at the top N, put K into your hand and the rest on the bottom", put them back
  in any order, search for a card, a basic land, named basic types, several cards, a card with
  mana value X or less, into the hand, onto the battlefield, into the graveyard or on top
  (701.23), Cultivate's split; damage to targets, groups and players as one event (120); destroy,
  exile, return to hand, tap and untap targets or groups; "they can't be regenerated" and "a
  creature destroyed this way can't be regenerated" (nothing here regenerates); "look at the
  top N ... you may put a [kind] card from among them onto the battlefield"; "reveal cards
  from the top of your library until you reveal a [kind] card. Put that card onto the
  battlefield / into your hand and the rest on the bottom in a random order" (701.20a); "you
  and that player / target opponent each draw ..." (in APNAP order, 121.2c); "draws / mills
  that many cards" and "deals 1 damage to that player" for a trigger's player and amount;
  counters (122); "gets +N/+N and gains [keyword] until end of turn", "can't
  block / can't be blocked this turn", "protection from the color of your choice"; fight
  (701.14), "deals damage equal to its power"; counter a spell, "unless its controller pays
  {N}", "exile it instead"; copy a spell (707.10); return a card from a graveyard to the hand or
  battlefield, put one on top of a library; sacrifices of the player's choice (701.21a); tokens;
  populate, investigate, proliferate (701.34), "move a counter from target permanent ... onto a
  second target permanent" (122.5), mana that stays until end of turn, an extra turn (with "you lose the
  game" at its end), "you may cast spells this turn as though they had flash", "can't cast
  spells this turn", "untap up to N lands"; choices made as it resolves ("return a land you
  control to its owner's hand", "put a land card from your hand onto the battlefield").
- **Order and memory:** effects happen in printed order (608.2c): a choice partway through (a
  discard, a search, scry, a payment) waits, and the rest goes on once it is made. "You may"
  asks the player it names (608.2d); "you may pay {N}. If you do, ..." asks with the cost;
  "[effect] unless that player pays {N}" asks that player first (118.12a). An effect remembers
  the object it acted on as it last was ("its controller", "its power", "that card's mana
  value", 608.2h), the group it acted on ("tap those creatures"), the life lost and damage
  dealt ("you gain life equal to the life lost this way"), and X: "where X is ...", the cost's
  X, or a permanent's own X in its "enters" ability (107.3m).
- **Targets and groups (115):** "any target", players and opponents, "two target players",
  "up to one / two", "one or two", "two", "any number of" (115.1d), "another target", lists of
  kinds ("artifact, creature, or planeswalker"), with words in front (colours, "non-", basic,
  legendary, token, tapped, attacking or blocking, creature types) and after ("you control", "an
  opponent controls", "with flying", "with power 4 or greater", "with mana value 3 or less");
  spells ("target noncreature spell", "spell or nonland permanent"), abilities, and cards in
  graveyards. Groups ("each creature you don't control", "all artifacts and enchantments",
  "creatures you control", "attacking creatures") are the objects as the effect starts (611.2c).
  Three or more targets that must all be different are refused: the engine keeps only one
  pair apart (see Known simplifications).
- **Tokens (111):** a token listed in `decklists.json` is used when the words match, so its
  art shows; otherwise the text's description ("a 2/2 black Zombie Knight creature token with
  menace") is made into a token on the fly, keyed like the listed ones ("Zombie Knight 2/2
  menace B"), and a quoted ability on it ("It has 'Sacrifice this token: Add {C}.'") is read by
  the parser itself. An artifact or enchantment token may have that type's subtypes ("a 1/1
  colorless Shrine enchantment creature token", 205.3d). An X/X token is refused.
- **An ability's resolutions:** "If this is the second time this ability has resolved this
  turn, ...", "[effect] if this is the first time ...", and after either "If it's the third
  time, ..." (Omnath), checked as that part resolves. A spell saying it is refused.
- **More effects and costs:** "~ deals damage to [target] equal to [an amount]" (Rin and Seri);
  "put target creature card from a graveyard onto the battlefield under its owner's control"
  (110.2a, Kenrith); "Sacrifice five Treasures:"; a search for "an artifact or Dragon card",
  any of those card types or subtypes.
- **Statics and lines about the card:** "[other] [kind] creatures / permanents you control get
  +N/+N, have [keywords], have 'Ward—Pay N life.'", "Enchant [kind]" with "enchanted creature
  gets / has / can't block" (702.5), "equipped creature gets / has / can't be blocked"; "this
  gets +1/+1 for each ...", base power and toughness from a count (604.3); "can't be blocked",
  "attacks each combat if able"; ward (702.21), "Ward—Blight N" too; "each land is a Swamp in addition" (305.7);
  "lands you control are every basic land type in addition to their other types" (305.7);
  "each [kind] you control is all colors" (105.3); "this gets +1/+1 for each color among
  [permanents]"; exalted (702.83) and riot (702.136) as keywords, and "have riot"; "If this
  card is in your opening hand, you may begin the game with it on the battlefield" (103.6a);
  enters tapped, unless [a condition], with N counters, paying 2 or 3 life, or revealing a land
  card (614.1c, 614.12a); no maximum hand size, "doesn't untap", "skip your draw step";
  "[kind] spells you cast cost {1} less / more"; "creatures your opponents control enter
  tapped"; "you may cast spells as though they had flash"; "spells you control can't be
  countered"; "untap [this / all artifacts you control] during each other player's untap step";
  token and counter doubling and Hardened Scales (614.1a); Propaganda's attack tax (508.1g);
  "during your turn, your opponents can't cast spells or activate abilities"; "you may play
  an additional land on each of your turns"; the keyword line "firebending N"; ward with a
  sacrifice cost, and ward {N} among other keywords; "partner with [name]" (702.124j);
  "protection from [colour] and from [colour]" (702.16g); "[group] are [types] in addition
  to their other types [and have '[activated ability]']"; "activated abilities of [kind] you
  control cost {N} less to activate"; "[kind] spells cost {1} less to cast for each +1/+1
  counter on this"; amass (701.47), "the Ring tempts you" and "whenever the Ring tempts you"
  (701.54); "if you gained [N or more] life this turn"; "whenever an opponent loses life for
  the first time during each of their turns"; "whenever [a permanent] is put into a graveyard
  from the battlefield"; "when this enters and whenever an opponent draws a card except the
  first one they draw in each of their draw steps"; "create a token that's a copy of it,
  except the token isn't legendary"; "you may discard your hand. If you do, ..."; two
  conditions joined by "and"; and flavor words (207.2d); trigger
  doublers, "if an artifact or creature entering / a creature dying / a creature attacking
  causes a triggered ability of a permanent you control to trigger, that ability triggers an
  additional time" (603.2d: Panharmonicon, Teysa Karlov, Isshin).
- **Refused:** anything else, including "instead" effects it has no template for, conditions it
  can't read, X outside a cost, and cards whose rules the engine doesn't have (playing lands
  from a graveyard, copies). A fetched card it refuses can't be
  played: it is never played as a stand-in.
- `npm run parse-report` prints the cards it scripts on its own and every refusal: for the
  pool (327 of 519 cards with rules text, 63%) and for a corpus of the 600 most-played
  Commander cards (`tests/parser-corpus.generated.json`: 420 of 590, 71%), whose refusals it
  groups by opening words and by shape, biggest first. A test plays about 190 pool cards with
  the parsed script and with the hand script and checks the table ends the same; others play
  each template on a made-up card and check a near miss is refused.
  `npm run recheck-requests` takes the requested cards the parser now reads out of
  `docs/card-requests.json`.
- **Corpus staples with hand scripts:** Brainstorm, Chaos Warp, Arcane Denial, The One Ring
  and Myriad Landscape are among the corpus's top 100 and need wording no template reads, so
  they have hand scripts in `src/cards/scripts.ts` for pasted decks (tested in
  `tests/staples.test.ts` with the corpus's data). Path of Ancestry stays refused: the engine
  has no ability that triggers when mana is spent.

### Bots

- They win with Thassa's Oracle plus Demonic Consultation or Tainted Pact when they can
  pay for both (Oracle first, holding priority).
- They cast a ritual, exile Simian Spirit Guide or crack Lion's Eye Diamond (only with an
  empty hand) when the mana lets them cast something they couldn't, and Final Fortune
  only with one opponent left whose life their creatures could take.
- They cast tutors in their second main phase, Pact of Negation only if they could pay
  next upkeep, and use Necropotence in their second main phase above 16 life.
- They never cast Rain of Filth, decline Chain of Vapor's copy, and give Wishclaw
  Talisman to the opponent whose turn comes last, using their own only to find a missing
  combo piece.
- They don't try Underworld Breach loops.
- A bot never announces X = 0 for an ability with X in its cost: it pays nothing and, for
  the current cards, does nothing.
- A bot always says yes to a parsed "you may" effect, keeps every card on top when a parsed
  card has it scry or surveil, and untaps its own lands for a parsed "untap up to N lands".

### Features tested only with extra cards

Some features have no card on the menu yet, or are tested with cards outside the pool.
Those cards are scripted in `tests/fixtures.ts`.

| Feature | Test-only cards |
| --- | --- |
| Planeswalkers and battles (none on the menu yet) | Jace Beleren, Garruk Wildspeaker, Chandra Nalaar, Invasion of Dominaria |
| Several activated abilities (none on the menu yet) | Deathrite Shaman, Cranial Plating |
| X in an ability's cost (none on the menu yet) | Crypt Rats, Chandra Nalaar |
| The new costs (none on the menu yet) | Blaze, Gut Shot, Burst Lightning, Bone Splinters, Flawless Maneuver, Thalia, Ruby Medallion, Boros Recruit |
| Card frames | Delver of Secrets, Kazandu Mammoth, Needleverge Pathway, Dead // Gone, Murderous Rider, History of Benalia, Wizard Class, Think Twice, Strike It Rich, Thraben Inspector, Bake into a Pie |
| Auras, Equipment, Vehicles, counters | Pacifism, Holy Strength, Bonesplitter, Loxodon Warhammer, Cranial Plating, Untethered Express, Black Sun's Zenith |
| Counterspells, modes, copies | Counterspell, Negate, Essence Scatter, Stifle, Cryptic Command, Boros Charm, Fiery Confluence, Reverberate |
