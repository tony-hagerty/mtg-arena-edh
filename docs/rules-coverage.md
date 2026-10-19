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
  and runs `deckProblems`. A card the pool lacks, or one the engine can't play
  (`unsupported` in `src/cards/support.ts`, the same check as the card-pool test), stops
  the deck being saved. Saved decks live in `localStorage` (`arena-edh.decks`); one whose
  cards a newer pool lacks stays on the menu, greyed out with the reason.
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
  searcher's log shows; everyone else reads "for a card".
- **One player's view:** `viewFor(game, seat)` (src/engine/view.ts) is the game as that
  player may know it, for the host's server to send each player. Other hands, every
  library and cards exiled face down they may not look at (406.3) become blank stand-ins
  (`isHidden`) whose ids only say where they are, so the counts stay right (402.3) but no
  id follows a hidden card. A choice in front of the player shows what it needs: their
  library while they search it, sorted so its order stays hidden (701.23a, 401.2), or the
  cards they pick from. Private log lines read in full only for their player, and the
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
  once; anything else waits for the server's next view. Each move carries a number the
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
  make a player win (104.2b) or lose (104.3e) the game.
- **Additional phases (500.8):** Sphinx of the Second Sun's additional beginning phase
  after your postcombat main phase: untap, upkeep and draw steps, then the ending phase.
- **Choices partway through resolving (608.2d):** any player can be asked yes or no ("you
  may ...", or "... unless that player pays {1}", where that player chooses first,
  118.12a), to pick from a few cards (Thassa's Oracle), or to name a card (201.3).
- **Counterspells (701.6):** a spell or ability can target spells or abilities on the
  stack (click one in the stack panel). A countered spell goes to the graveyard and its
  costs aren't refunded; a countered commander can still go to the command zone.
- **Modal spells (700.2):** the cast panel lists the modes; pick as many as the card says.
  Each mode has its own targets, and a mode with no legal target can't be picked. "You may
  choose the same mode more than once" works (700.2d).
- **Copying spells (707.10):** the copy keeps the original's modes, X and kicker, and its
  controller may choose new targets. A copy ceases to exist when it leaves the stack.
- **Copying abilities (707.10)** works the same way (Return the Favor), and so does
  copying a card in exile and casting the copy (707.12, Mizzix's Mastery; a copy you
  don't cast ceases to exist). Copies trigger magecraft's "whenever you copy" (Storm-Kiln
  Artist).
- **Changing a target (115.7a):** "change the target of target spell or ability with a
  single target" (Redirect Lightning, Return the Favor, Untimely Malfunction). Only a
  spell or ability that targets exactly one thing once can be chosen. As it resolves, you
  must pick another legal target if there is one; if there isn't, nothing changes.
- **Modal triggered abilities (603.3c):** "choose one or more —" is chosen as the ability
  goes on the stack, with the targets of the chosen modes (Black Market Connections). One
  with too few modes that can be chosen is removed from the stack.
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
  leaves the rest unpayable.
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
  in the cast panel.
- **"Exile two cards from your graveyard"** as an activation cost (Matoc): pick them after
  the targets; bots exile the cards they want least.
- **Offspring (702.175):** pay the extra cost and a 1/1 token copy enters with it
  (Coruscation Mage). **Spectacle (702.137):** the cheaper cost only once an opponent has
  lost life this turn (Light Up the Stage).

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
  it for mana" in the cast panel). Auto-pay uses free sources first, then painful ones,
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
  Souls), mana kept until end of turn (Birgi), mana abilities a land gains until end of
  turn (Rain of Filth), and Lion's Eye Diamond (discard your hand, only with priority).
- **More mana:** mana that can be spent only on instants and sorceries (106.6, Tablet of
  Discovery), unspent red mana kept between steps and turns (500.5, Electro), "activate
  only if this land entered this turn or if you control a basic land" (Dark Fortress),
  and "{T}, Sacrifice a creature: Add {B}{B}" (Phyrexian Tower: click the Tower, then pick
  the creature).

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
- **Planeswalkers (306, 606):** they enter with their printed loyalty. One loyalty ability
  a turn per planeswalker, at sorcery speed (606.3); a minus ability needs that much
  loyalty (606.6). Damage removes loyalty (120.3c), and one with no loyalty goes to the
  graveyard (704.5i). "Any target" and "target player or planeswalker" can name them
  (115.4). Bots use loyalty abilities when the look-ahead says it helps.
- **Battles (310):** they enter with their printed defense and a protector. A Siege's
  protector is an opponent of its controller, chosen when it is cast (the human picks in
  the cast panel; bots pick the opponent with the fewest untapped blockers). Anyone but
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
  replaces its other colours, 105.3), abilities (6), then power and
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
  is the turn's land (305.2a).
- **Casting while a spell resolves**, without paying its mana cost (608.2g, Beseech the
  Mirror), or paying it from a graveyard (Emet-Selch, which also exiles the spell instead
  of putting it into a graveyard).
- **Rebound (702.88):** a spell cast from the hand is exiled as it resolves and may be
  cast free at your next upkeep.
- **Paradigm (702.192):** the spell is exiled; after the first one of that name you
  resolve, a copy of it is made in exile at each of your precombat main phases, and you
  may cast it free. A copy you don't cast ceases to exist.

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
  spell or ability resolves (Mother of Runes, Sejiri Shelter).
- **Damage and life:** damage prevention (615, Solitary Confinement's "Prevent all damage
  that would be dealt to you"), shroud on a player (702.18a), each player's life lost
  this turn ("if a player lost 4 or more life this turn"), "whenever a source deals
  damage to a player", and "whenever one or more opponents lose life", which triggers once
  for an event that hits several players at once: "each opponent loses 1 life", combat
  damage, extort.
- **Trigger doubling (603.2d):** Roaming Throne's "triggers an additional time", even for
  a creature that died alongside it (603.10a). Elesh Norn, Mother of Machines does it for
  abilities of your permanents that a permanent entering causes to trigger, and stops
  such abilities of your opponents' permanents from triggering at all.
- **Protection for a player (702.16):** Serra's Emissary's "You ... have protection from
  the chosen card type": damage from such sources is prevented and spells and abilities
  from them can't target you.
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
  once its controller has done it (G'raha Tia, Emet-Selch).
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
- **Populate (701.36):** you choose which creature token to copy, and a token that is
  itself a copy copies what it copies.
- **Linked abilities** (607, Chrome Mox), cards exiled face down (406.3), and targets in
  a graveyard. "Cards exiled with" a permanent (Skyclave Apparition, Ghost Vacuum,
  Currency Converter, Emperor of Bones) are the ones it exiled while it stayed the same
  object (400.7).
- **Exile triggers:** "whenever one or more cards are put into exile from graveyards
  and/or the battlefield" triggers once for each event (Ketramose: Relic of Progenitus's
  cost is one event, exiling every graveyard another); "when this leaves the battlefield"
  and "whenever a creature you control with a +1/+1 counter leaves" look back in time
  (603.10a, Skyclave Apparition, The Ooze).
- **Life and protection for a player:** "your life total can't change" (119.7, 119.8;
  Flare of Fortitude, Teferi's Protection), "you gain protection from everything"
  (702.16j), life gained this turn (Haliya), and "if an opponent would begin an extra
  turn, that player skips that turn instead" (614.10, Trouble in Pairs).
- **Reflexive triggers (603.12):** "When a creature card is exiled this way, ..." (Agatha's
  Soul Cauldron).
- **More triggers:** "whenever an opponent searches their library" (once for each search,
  701.23h, Archivist of Oghma), "whenever two or more creatures attack" (Argent Dais),
  "becomes the target of a spell or ability" (Monk Gyatso), "draws their second card each
  turn" (Trouble in Pairs), "whenever you cast a spell from exile" (Appa) and "spells
  your opponents cast from graveyards or from exile cost {2} more" (Aven Interrupter).
- **"No more than one creature can attack [this planeswalker] each combat"** (508.1c,
  The Eternal Wanderer). "Until your next turn, your opponents can't cast spells from
  anywhere other than their hands" (Avatar's Wrath).
- **Keywords:** flying, reach, first strike, double strike, deathtouch, lifelink,
  trample, vigilance, haste, defender, hexproof, indestructible, menace, fear (702.36),
  flash, storm,
  cumulative upkeep, mobilize, ward, dash, bargain, gift, afterlife, delve, rebound,
  aftermath, paradigm, extort (702.101), job select (702.182), convoke, escape,
  overload, evoke, warp, spree, persist, reconfigure, and protection from a colour or from
  everything.

### Bots

Bots consider every face (split halves, Adventures, modal faces), cast from the graveyard
and from exile, play a modal card as a land only when they have no other land and few on
the battlefield, level Classes, and crack Food and Clues when it helps. They sacrifice
their least valuable permanent and discard the cards they want least. Bot behaviour tied
to one mechanic is described with that mechanic above.

## Known simplifications

These are deliberate cuts for a prototype. The biggest ones come first.

### Biggest gaps

- **Auto-pass:** with something on the stack, the game stops for you only when the top
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
- **Modes and copies:** only spells can be modal: modal triggered and activated abilities
  (700.2b) aren't supported. A copy's controller must pick legal new targets or keep all
  the old ones (707.10c allows keeping some). Copying abilities isn't supported yet.
- **Layers (613) not built yet:** effects that set or change colour (layer 5). No card has
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
  companion, "partner—[text]") aren't recognised. Vehicles can't be commanders yet. A
  planeswalker that says it "can be your commander" is accepted as one (903.3a).
- **Pasted decks use only the card pool:** the cards in `decklists.json`. Anything else
  is listed as missing. Companions, sideboards and maybeboards in a list are ignored. A
  saved deck can't be edited: delete it and paste it again. Saved decks stay in the
  browser they were pasted in.

### Mana and paying

- **Snow mana** {S} isn't supported.
- **Phyrexian mana** is always paid with mana when the mana is there; you can't choose to
  pay life instead. Tapping lands by hand first lets you steer it.
- **Taking mana back:** a source tapped by hand can be clicked again to take its mana
  back while all of that mana is unspent. This is a convenience, not a rule: mana
  abilities can't be undone in paper Magic. It works only when using the ability changed
  nothing but which permanents are tapped and what is in your pool. A Signet or filter
  land can be taken back, and the mana or lands that paid its cost come back too. Not
  when it paid life, dealt damage (painlands, a Talisman's coloured mana), sacrificed or
  exiled something (a Treasure), discarded a card, or triggered an ability: those have
  happened, and other players have seen them.
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
no hand script. It matches each ability, clause by clause, against a short list of
templates and builds the script from the helpers in `rules.ts`. One clause it can't read
refuses the whole card, naming the clause: it never guesses. Hand scripts always win.

- **Abilities:** "When this enters", "When this dies", "Whenever this attacks" and
  "Whenever you cast a [noncreature] spell" (603.1), prowess (702.108a), extort
  (702.101a) and job select (702.182a); delve, rebound and paradigm lines are the
  engine's; activated
  abilities (602) with `{T}`, mana (with `{X}`, 107.3a), "Pay N life" (119.4), "Discard
  a card", "Sacrifice this" and "Sacrifice a/another [creature, artifact, land,
  permanent]" costs, and "Activate only as a sorcery"; cycling (702.29a); mana abilities
  "{T}: Add {G}", "{C}{C}", "{W} or {B}", "{W}, {U}, or {B}", "one mana of any color",
  "three mana of any one color", "{1}, {T}: Add {W}{U}" (Signets) and "{W/B}, {T}: Add
  {W}{W}, {W}{B}, or {B}{B}" (filter lands), with "This deals 1 damage to you" or
  "Activate only if you control a Plains or a Swamp" (605); "[Other] [Soldier] creatures you control get
  +N/+N [and have flying]" and "... have haste" (613); instants and sorceries.
- **Lines about the card itself:** "This land enters tapped", "... unless you control two
  or more other lands / two or more basic lands / a basic land / an Island or a Swamp",
  "... unless you have two or more opponents", "... unless your opponents control eight
  or more lands" (614.1c); "As this land enters, you may pay 2 life. If you don't, it
  enters tapped" (614.12a); "This spell can't be countered"; "You have no maximum hand
  size" (402.2); "[Colour] spells you cast cost {N} less to cast" (601.2f); "If you
  control a commander, you may cast this spell without paying its mana cost" (118.9);
  "As an additional cost to cast this spell, discard a card / pay N life" (118.8).
- **Effects:** draw, gain or lose life, mill, surveil, deal damage, "deals N damage to
  each opponent", destroy, exile, "exile target player's graveyard", return to its
  owner's hand, create a token listed in `decklists.json`, put +1/+1 counters (on a
  target, on this, or on each creature you control), "gets +N/+N until end of turn",
  "creatures you control gain [keyword] until end of turn", "draw N, then discard N",
  search for a basic land, a land card, a "[basic type] or [basic type] card" or any card,
  "each opponent loses N life". Clauses join with "and" ("you draw a card and you lose 1
  life"); a subject carried over is the same target ("target player draws two cards and
  loses 2 life"). An effect that waits for a choice (a search, a discard, surveil) can be
  followed only by another choice or a "you may", so nothing happens out of order.
- **Targets (115):** "any target", "target player/opponent", "target player or
  planeswalker", and "target [non-type, colour, basic or nonbasic words] creature /
  permanent / artifact / enchantment / land / planeswalker / artifact or enchantment /
  creature or enchantment / creature or planeswalker [you control / an opponent controls /
  you don't control]".
- **"You may" (608.2d)** asks the player each time; the rest of the ability waits for the
  answer.
- **Refused:** anything else, including modal text, "instead", "for each", conditions,
  X outside a cost, other triggers, and cards with faces. A fetched card it refuses can't
  be played: it is never played as a stand-in.
- `npm run parse-report` prints, for the pool, the cards it scripts on its own (92 of 263
  with rules text today) and every refusal grouped by reason. A test plays a sample of
  55 pool cards with the parsed script and with the hand script and checks the table
  ends the same, and another reads every requested card the parser was taught.

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
- A bot always says yes to a parsed "you may" effect.

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
