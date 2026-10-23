# How to play Arena EDH

The full guide to the game's screens and controls. For a quick start, see the
[README](../README.md).

## Starting a game

- Pick a deck on the menu: the decks fill the middle, starter decks then your pasted
  ones. Pointing at one shows its art behind the menu. **Watch the bots play** (right)
  starts a game of four bots instead.
- **The table:** right of the decks, for each of the three other seats pick who plays it
  and its deck, built-in or pasted. **Bot** (the default) is played by the computer;
  **Person here** by a friend at the same screen; **Empty seat** leaves it out, for a
  table of two or three (at least one seat stays filled). **Automatic** (the default deck)
  takes the next built-in deck no one else has. Saved in the browser.
- **With friends:** under the seats, **Host a table** and **Join a table** play with people
  on other computers, and **Saved games** resumes a table's game. They show only in the
  Windows program (or `npm run dev`), not in a page opened from disk.
- **Passing the screen:** with friends at the same screen, the table is covered whenever
  another person must decide something, until they click **I'm Player N**. Then their
  seat is at the bottom with their hand. People are called Player 1 to 4 by seat, and the
  log is written in the third person; alone against bots, you're "You".
- **Paste a deck list:** the last tile under "Your decks" opens a text box. Paste a plain list ("1 Sol Ring", "Sol
  Ring" or "Sol Ring x1") or an export from Arena, Moxfield, Archidekt, MTGO or
  TappedOut. Set codes, collector numbers, foil marks, tags and category headings
  ("Creatures (12)") are ignored, and sideboard and maybeboard cards ("SB:", Archidekt's
  `{noDeck}`) are left out. The commander comes from a "Commander" section, a
  "Commander: Name" line (one per partner), a `*CMDR*` mark, Archidekt's "Commander"
  category, a one- or two-card sideboard, or the last one or two cards after a blank line
  in a list with no headings (Moxfield's and MTGO's plain exports); otherwise click one
  (or two partners) among the list's legendary creatures. Every problem is listed: names
  that aren't cards, cards not legal in Commander, and broken deck rules (100 cards, one
  of each, colour identity, commander). **Save Deck** works once there are none. The deck
  joins the menu, saved in the browser; **×** deletes it. A saved deck the game can no
  longer play is greyed out with the reason.
- **Any card:** a card the game doesn't have is fetched from Scryfall as you paste, and
  scripted from its Oracle text. Fetched cards are kept in the browser, so the deck works
  offline afterwards (**Clear N fetched** forgets them). If Scryfall can't be reached,
  the screen says why and offers **Retry**; every other card still works.
- **Cards the game can't read yet** are listed under their own heading, grouped by the
  words the game couldn't read, each with that line of its rules text and two choices:
  - **Play without its rules text:** the card is in the deck with its real name, cost,
    types, power and toughness and the keywords the game knows (flying, deathtouch ...),
    and the rest of its text does nothing: it is a plain card. It moves to the heading
    "Played without their rules text", where **Undo** takes it back. In a game it has a
    small **no text** badge and a greyed name bar, on the table and in your hand;
    hovering it says so, and the log adds "(its rules text doesn't work here)" the first
    time it is cast. On the menu the deck says "N cards play without their text". Once
    the game learns to read the card, it plays with its text again by itself.
  - **Swap it out** takes its line out of the list, so you can paste another card in.

  Your commander can't be played without its text (its text is the deck), and neither
  can a card the game can't play as a plain card at all, like a double-faced card or one
  with a keyword such as ninjutsu: those can only be swapped.
- **Saving for later:** a deck with cards still to choose for can be saved anyway
  (**Save for Later**). It waits greyed out on the menu with "N cards the game can't play
  yet", and **Swap them** (**Swap it** for one) opens it in the paste screen with those cards at the top of the
  list, so you can fix it at your own pace. Saving there replaces it.
- Cards the game can't read are written down for Claude to script later (see
  [Adding a card](developing.md#adding-a-card)); outside `npm run dev`, **Download
  report** saves them as a file.
- **Loading:** when a game starts, a splash covers the board while the 3D table loads: the
  logo, the five mana symbols bouncing in turn, "Loading board state…" and a bar that fills
  as it goes. It fades once the table is drawn, usually within a few seconds.
- **Mulligan:** before the first turn you see your seven cards. Press **Keep**, or
  **Mulligan** to shuffle them away and draw seven new ones. Your first mulligan is free;
  after that you pick one card per extra mulligan to put on the bottom of your library.

## Playing cards

- **The table** is drawn in 3D and seen from above your seat, leaning away from you like
  Arena's board (see "The table" below). Everyone sits in a corner: you at the bottom left, the others clockwise
  in turn order. Two players sit in opposite corners (you bottom left, the opponent top
  right); at three you have the whole bottom edge and the others take the top corners;
  at four the seats go bottom left (you), top left, top right, bottom right.
- **A seat** is its corner's mat, its battlefield: three rows square to the mat, lands
  nearest its edge, then artifacts, enchantments and the rest, then creatures nearest the
  middle of the table. Every card stands upright, whoever controls it. The cards grow
  while a seat's rows have room and shrink as they fill up; a very crowded row overlaps
  its cards instead. A permanent shows its art and name; hover it for the whole card. The library and graveyard lie on the mat along the seat's
  own edge, the library nearest the middle (yours just above the bottom of the screen,
  beside the controls; the far seats' against their mat's inner edge, by the middle path). Exile is shared, so it is the well in the middle of the table, with the top
  card of each player's exile circling in its whirlpool and the count at its edge. The portrait sits
  on the seat's side edge, and an opponent holds their hand up, fanned, face down, at the
  back of their mat beside their piles, with a count at its foot. Hover any card to see
  it full size. A tapped card is dimmed, turned a little, and marked with a large,
  see-through tap symbol. A face-down card shows the program's icon in gold.
- **Your hand** curves out of the bottom-left corner, its first card's left edge on the
  screen's left edge, flat at first and then bending down
  into the bottom edge. Up to seven cards show; with more, two short pills arc over the
  middle of the cards. Point at the left one to scroll to earlier cards, the right one to
  later ones (after a moment, one card at a time); a click moves one card. Each pill's
  chevrons dim once there is nothing more that way. Pointing at a card stands it up and
  zooms it. What you point at is the card where it sits in the hand, not the zoomed copy:
  move onto the part of the next card that shows and that one zooms instead, even though
  the zoomed card is drawn over it. While you drag a card, the cards you pass over stay
  as they are; pointing works again once you let go.
- **Glowing cyan** cards can be played. Drag one from your hand up toward the table and
  let go to play a land or cast a spell. Mana is tapped for you (auto-pay, like Arena).
- Casting a spell or using an ability takes two steps, and **Cancel** (or `Esc`) backs
  out of either one:
  1. **Targets.** Legal targets are highlighted in **yellow**. Click one.
  2. **Pay.** The prompt shows the cost and the lands auto-pay would tap glow. Press
     **Pay** to confirm, or tap lands yourself: the spell is cast as soon as your mana
     covers the cost. **Cancel** and the **Hold priority** box sit in a row above Pay.

  Until it is paid for nothing has happened. The spell isn't on the stack, and Cancel
  untaps any lands you tapped while paying, so you are back exactly where you were.

  `Ctrl+Z` (`Cmd+Z` on a Mac) steps back one choice at a time instead: the last land you
  tapped while paying untaps, then the last sacrifice, card to discard or exile, creature
  to crew or convoke, or target goes, then you are back at the choices for X, kicker or
  the cost. With nothing chosen yet it cancels, like `Esc`. A triggered ability's targets
  step back the same way, but it can't be cancelled.
- **More than one way to play a card:** when a card can be cast for an alternative cost,
  plotted instead (Highway Robbery), cast as either half, or needs X or kicker, the prompt
  in the middle of the table lists the choices with **Cast** (or **Play**) and **Cancel**
  beside them, so the whole choice is made right there. The big button at the bottom does
  the same as the prompt's Cast.
- **Paying by hand:** click your lands and mana rocks to tap them. The mana shows in a
  pill under your portrait. Costs spend that mana first and auto-tap only for the rest.
  A source with a choice (a dual land, a Talisman, Sunken Ruins, Command Tower) asks which
  ability and which mana you want, in the prompt's band in the middle of the table (under
  the words while you are paying), with **Cancel** to tap nothing. Click a tapped source
  again to take its mana back, whatever else using it did: the life a Talisman or a
  painland cost you comes back, a Treasure or Lotus Petal returns, and so does what it
  triggered. That works until you do something other than make mana; after that, a source
  that only tapped and made mana can still be taken back while its mana is unspent.
  Sources you used after it stay used, unless they were paid with its mana. `Ctrl+Z` does
  the same for the source you used last, one press each (a pile used with one click comes
  back with one press), and closes a mana choice left open.
- **Piles:** identical lands, and identical creature tokens, pile up with a count (`x7`)
  on top. Click the count to use the whole pile: lands tap for mana together (while
  paying, only as many as the cost needs; a pile of dual lands asks once which mana), or untap together to take the mana back, and
  tokens attack or block together. Clicking a card in the pile still uses just that one,
  and it moves out to its own pile.
- **Sorting your hand:** drag a card sideways to rearrange it. The order is only for you:
  it never reaches the game engine, so it changes nothing about play. Clicking a hand card
  does nothing, so you can't play one by accident while sorting.

## The stack and your stops

- A spell or ability waits on **the stack** before it does anything. When an opponent's
  is there and you could respond, the game stops for you: cast an instant or use an
  ability, or press **Resolve** to let it happen. The newest thing on the stack happens
  first.
- The stack shows over the middle of the table, with **Stack · n** under it. **Hide**
  tucks it into a small chip in the middle, in the colour of the card on top, so you can
  see the cards under it; click the chip (**Show**) to bring it back. It comes back by
  itself while you are paying for a spell or can target something on it, and once the
  stack empties the next spell shows it again.
- Cards fly to where they go: from a hand to the stack, from the stack to the battlefield
  or the graveyard, from the battlefield to a graveyard or exile pile, back to a hand or
  the command zone. A spell or ability that resolves glows gold as it leaves the stack, an
  ability flies back into the permanent it came from, and the log lines it wrote flash
  gold. A new token pops up where it lands, and a card reaching the battlefield flies
  down onto the table from where it was and settles. At a higher
  **Speed** the flights are quicker,
  and with your system set to reduce motion cards just appear where they go.
- With the stack empty, the game passes for you except at your **stops**. The tracker on
  the controls' plate at the bottom of the screen, in the middle, shows them: a strip of the turn's parts, the
  current one lit, with the turn and step written under it and the big button below:

  | Mark under a step | Meaning              |
  | ----------------- | -------------------- |
  | nothing           | no stop              |
  | **ring**          | stop if I can act    |
  | **dot**           | always stop          |

  Click a step to cycle it: no stop, ring, dot, no stop. A pip that covers several steps
  (beginning, combat, end) opens one button per step. The untap and cleanup steps can't
  hold a stop: nobody gets priority there (502.4, 514.3).
- The arrows above the plate are the seats, left to right: bottom left (you), top left,
  top right, bottom right, each pointing at its corner in that player's deck colour (yours
  points straight down when you have the whole bottom edge). The one whose turn it is is
  ringed. Click one to see and edit the stops for that player's turns; the tracker takes
  their deck colour. Click it again to go back to the current turn. Your turns show
  orange, everyone else's blue.
- Default stops (your stops are saved in the browser):
  - **Your turn:** always in both main phases; if you can act, at beginning of combat
    and after blockers are declared.
  - **Other turns:** if you can act, in the upkeep, after attackers (only once something
    attacks) and blockers are declared, and in the end step.
- When a ring stop or an opponent's spell stops the game only because you could act, the
  prompt says what you could do ("You could cast Solitude"). A card you can always cast,
  like Solitude with a white card to exile for its evoke cost, stops you at every ring.
  The **Next** button says the step it will really stop at.
- **Full control** (`Ctrl+Shift`): the game stops for you every time you get priority, on
  every turn, with the stack empty or not (never in untap or cleanup, where nobody gets
  priority), and **Hold priority** starts ticked, so you keep priority after each spell
  or ability you cast; untick it to let one go. A small **Full control** tag beside the
  turn under the tracker shows it is on, and the prompt starts "Full control." where
  nothing else would have stopped. Press `Ctrl+Shift` again, or click the tag, to go back
  to your stops. It lasts until you turn it off or close the page.

## Your commander

- Every portrait is that player's commander; hover it to read the card. A player with two
  partner commanders has a portrait split in two.
- To cast yours, click the **crown** on the top left of your portrait. It glows when you
  can cast it and is dimmed while that commander is anywhere but the command zone.
- The badge on the top right of a portrait is that commander's tax: each recast costs 2
  more (`+2`, `+4`, …).
- With partners, each commander's badges sit on its own half of the portrait: the left
  one's crown at top left and tax on the left edge, the right one's crown at top right
  and tax on the right edge.
- When your commander dies, is exiled, or would go to your hand or library, a window asks
  whether it goes to the **Command Zone** (castable again, with tax) or stays where it
  went.

## Combat

- **Attacking:** press Next until you reach declare attackers (the button says where it
  goes), click an opponent's portrait to choose who to attack, then click your creatures.
  Different creatures can attack different players. Planeswalkers and battles you can
  attack glow yellow: click one to send your next attackers at it instead.
- **Blocking:** when you are attacked, click your creature. If it could block more than
  one attacker, click the attacker next.
- **Taking back:** until you press the button that finishes attacking or blocking,
  `Ctrl+Z` takes back the last attackers you sent (one click's worth, so **All Attack**
  at once; an attacker you switched to a planeswalker goes back to its old target), the
  last block, or the last blocker you picked.
- **Dividing damage:** with **Damage: By hand** on (in the log bar), a window opens in
  the damage step when one of your attackers has a choice: two or more blockers, or
  trample. Use − and + to move damage between the blockers and, with trample, the player
  or permanent attacked. It starts on the automatic split; **Deal Damage** is enabled once
  the split is legal. With **Damage: Auto** (the default) it is never asked.

## Special cards

| Card or cost | What to do |
| --- | --- |
| **Planeswalker** | Click yours to see its loyalty abilities and pick one. It happens right away (after any target): loyalty abilities cost loyalty, not mana. A −X ability first asks for X, like an ability with {X} in its cost does. Loyalty is the shield in the corner. |
| **Battle** | Its defense is the orange box. When you cast a Siege, the prompt asks which opponent protects it. |
| **Two faces** (split, adventurer, modal double-faced) | The prompt has a **Face** row: pick the half, the Adventure, or the face to play. A modal card's land face says "(land)"; its button reads **Play** instead of **Cast**. |
| **Class** | Click yours to see its level bars; pick the next one and pay for it. |
| **Several abilities** (Deathrite Shaman) | Click the permanent to see every activated ability; the ones you can't use now are dimmed. With only one usable, clicking goes straight to it. |
| **"One mana of any color"** | A window with the five colours opens while it resolves. **Lion's Eye Diamond** asks for the colour when you click it. |
| **Aura and Equipment** | What is attached to a permanent fans out behind it, toward the top of the card, each showing its name and a strip of art; it taps and attacks with the permanent. Click an Equipment's strip to equip it to something else, hover a strip to read the card. An enchanted land stands on its own instead of in its pile. |
| **Graveyard and exile** | A graveyard, or the well (the exile), glows when something in it can be cast (flashback, escape, an adventurer card whose Adventure you cast, or a card an effect lets you cast or play, in anyone's exile). Right-click it to open it and click the glowing card. With escape (Underworld Breach) a window then asks for the three other cards to exile. A card exiled face down shows its back, unless you may look at it. |
| **Gift, channel, bargain, plot** | Extra prompt rows and buttons: **Gift** (promise an opponent a gift, or none); a button beside **Cast** for a card with an ability that works from the hand (Otawara's channel) or that can be plotted instead (Highway Robbery); **No Sacrifice** skips a bargain sacrifice. |
| **Sacrifice costs** (Goblin Bombardment, Village Rites) | After the targets, the creatures you could sacrifice glow yellow; click one. |
| **Shock lands** | Asks whether you pay 2 life as you play it. |
| **New targets** (Deflecting Swat) | Click the new target for each slot, or press **Keep Target**. A card in a graveyard (Sevinne's Reclamation) is targeted from a window. |
| **Cast as it resolves** (Beseech the Mirror) | A window offers **Cast** or **Don't Cast**; casting goes through the usual targets and costs. |
| **A choice from several places** (Highway Robbery: discard a card or sacrifice a land) | The window groups the cards by where they are, **Your hand** and **Your battlefield**, so a Mountain in your hand isn't taken for one on the table. |
| **Proliferate** (Atraxa, Karn's Bastion) | A window shows every permanent with a counter, under whose battlefield it is, and a button for each player with counters (their counters in brackets). Click the ones that get another counter of each kind they have, any number or none, and press **Proliferate**. |
| **Blight** (High Perfect Morcant, Auntie Ool's ward) | A window asks which creature of yours gets the -1/-1 counters. Paying Auntie Ool's **Ward—Blight 2** is optional: choose none and your spell or ability is countered. |
| **Tap untapped creatures as a cost** (High Perfect Morcant's "Tap three untapped Elves") | After clicking the permanent, the ones you could tap glow yellow, the permanent itself included; click exactly that many and press **Tap**. Summoning sickness doesn't matter. |
| **Moving a counter** (Tidus, Nesting Grounds) | When the first creature has more than one kind of counter, a window asks which kind moves. |
| **Counters on players** (poison, experience, rad) | They show as small pills under the player's name on their portrait. Ten poison counters lose the game. |
| **Library search** (Rampant Growth, Cultivate, Path to Exile, ...) | Your whole library opens. Cards you could find glow; click one and press **Choose**, or **Find Nothing**. |
| **Ward that asks for a sacrifice** (Ygra's "Ward—Sacrifice a Food") | When your spell or ability targets it, a window shows what of yours you could sacrifice: pick one and press **Sacrifice**, or **Don't Pay** to have it countered. |
| **The Ring tempts you** (Frodo, Sauron) | With two or more creatures, a window asks which is your **Ring-bearer**. It carries a gold ring on the table, and the log counts the times the Ring has tempted you. |
| **Amass** (Sauron) | With two or more Armies, a window asks which gets the counters. |

## Triggers and pop-up windows

- "When this enters" abilities that need a target ask for it once the creature is on the
  battlefield. That choice can't be cancelled: the ability has already triggered.
- When two or more of your triggered abilities happen at once, you choose their order:
  the one on the left resolves first. Use the arrows to move them.
- These windows can't be closed, since the game is waiting on you, but **View table**
  folds one away so you can look at the board.

## Controls

| Input | Does |
| --- | --- |
| `Space` / `Enter` | the big button |
| `Esc` | cancel |
| `Ctrl+Z` / `Cmd+Z` | undo the last step that can be: close a mana choice; while casting, step back the last choice (a mana source untaps), or cancel at the start; otherwise take back the last mana you made, or the last attacker, block or blocker picked. Never a spell cast, a land played or a pass. |
| `Ctrl+Space` | hold priority (see [Turns, priority and the stack](rules-coverage.md#turns-priority-and-the-stack)) |
| `Ctrl+Shift` (the two alone, then let go) | full control on or off (see [The stack and your stops](#the-stack-and-your-stops)) |
| `Alt+Enter` (`Option+Enter` on a Mac) | fullscreen on or off |
| Hover a card | full-size view |
| Right-click a card (in your hand, on the table, on the stack, or in a graveyard or exile window) | bigger view that stays up; left-click off it to close (over that window, the first click closes the view and the next the window) |
| Right-click a graveyard | look through it, or see that it's empty; hovering the pile shows its top card |
| Right-click the well | look through the exile: everyone's exiled cards, under each owner's name |
| Click a mat, the well or a path | the board answers: a splash and a soft splash sound in the well, a puff of dust off the leather, chips off the wood, sparks off the slate, lint off the cloth, a little dust off the flagstones, each with its own soft sound. It does nothing in the game. |
| Right-click anywhere else | nothing: the browser's menu is off in the game (text boxes keep it, for copy and paste) |
| Hover a card name in the log (dashed underline) | see the card |

The log is at the top of the screen, in the middle, under one bar; point at a button on it
(or tab to it) for its name. **Log**, the bar's left half, folds the log open under the bar
and away again (it starts folded). On the right:

- **Pause** (‖, a table's game only) pauses the game for everyone at the table.
- **Settings** (the gear) opens a small panel: **Bot speed** (1×, 2×, 4×), **Sound** and
  **Music** (each a mute button and a volume slider), and **Combat damage**, Auto or By
  hand, for dividing an attacker's damage among its blockers or trampling over. `Esc` or a
  click elsewhere closes it. **Hotkeys**, at the panel's foot, opens a window listing every
  key and mouse control in this table. The game takes no keys while it's open: `Esc`,
  **Close** or a click outside it closes it.
- **Exit** (the door) asks before leaving the game for the deck menu.

The deck menu has the same sound and music controls in its top-right corner. Sound, music
and damage choices are saved in the browser.

**The table** is seen at a steep angle, like Arena's board, with the camera pushing in
during combat. The cards lie on it as thick tiles with rounded corners, each tipped up a
little at its top, with a wide gap between the rows. So do each player's
library and graveyard: the library is a deck as thick as it is full. The board is a hall
for four: a mat in each seat's corner, all four the same size (so the far two
look smaller), lying flat on the flagstone floor of a torch-lit stone hall, your two
starting just above the bottom of the screen. A player alone on their side of the table
(both players in a two-player game, you in a three-player one) has one mat across the
whole side instead, curving round the well. Each mat is a dark material with a border
worked into it, in turn order from yours: worn leather with stitching, oak planks, slate
slabs with a brass line, and a woven cloth with a gold trim. Where the paths between them
cross is a well with a low cobblestone wall, which is the exile: its green-blue water, rippling
and catching the torchlight, turns in a slow whirlpool with streaks of foam. Torches burn on the
walls either side of the play area. Each opponent holds their hand up at the back of their mat,
fanned out, backs to you, with its count at its foot. Everything plays the
same: hover a card to read it, click it, drag from your hand, right-click a graveyard or the
well to open it. The portraits, your hand and the rest stay flat on the screen. It needs a browser with
WebGPU or WebGL 2 (every current one); `?gl=webgl` forces WebGL, and `?quality=low` drops
the shadows for a weak machine. A browser that can't draw it says so in the table's place.

The music is made as it plays, so it never loops: a harp arpeggio over a plucked bass and a
soft frame drum, with a melody and a shaker coming and going as it builds and eases off. It
starts, fading in, with your first click or key press (browsers keep a page silent until
then), plays quietly on the deck menu and a little louder in a game, pauses while the window
is hidden, and fades out when a game ends.

## If the game crashes

If something goes wrong while the screen is being drawn, an error screen takes the place
of the table instead of a blank page. It shows the error and the game's last few log
lines. **Copy Details** copies everything to paste into a message, and **Leave to Menu**
leaves the game the same way **Exit** does (at a table, you leave the table and the others
play on).

The Windows program also writes every error to its log: `launcher.log` in the
`ArenaEDH-data` folder beside `ArenaEDH.exe`, one line per error with the program's build,
the turn and step, and where in the code it happened. To report a crash, send the copied
details (or `launcher.log`) and a few words on what was happening: the card that was cast
or the button that was pressed. At a table, the log is on each player's own computer.
