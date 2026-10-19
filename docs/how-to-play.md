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
- **Paste a deck list:** the last tile under "Your decks" opens a text box. Paste a plain list ("1 Sol Ring" or "Sol
  Ring") or an Arena, Moxfield or MTGO export; set codes, collector numbers and foil
  marks are ignored. The commander comes from a "Commander" section, a `*CMDR*` mark or
  a one- or two-card sideboard; otherwise click one (or two partners) among the list's
  legendary creatures. Every problem is listed: cards the game can't play, and broken
  deck rules (100 cards, one of each, colour identity, commander). **Save Deck** works
  once there are none. The deck joins the menu, saved in the browser; **×** deletes it. A
  saved deck the game can no longer play is greyed out with the reason.
- **Any card:** a card the game doesn't have is fetched from Scryfall as you paste, and
  scripted from its Oracle text. One the game can't read yet is listed with the words it
  couldn't read; replace it to save the deck. Fetched cards are kept in the browser, so
  the deck works offline afterwards (**Clear N fetched** forgets them). If Scryfall
  can't be reached, the screen says why and offers **Retry**; every other card still
  works. Refused cards are written down for Claude to script later (see
  [Adding a card](developing.md#adding-a-card)).
- **Mulligan:** before the first turn you see your seven cards. Press **Keep**, or
  **Mulligan** to shuffle them away and draw seven new ones. Your first mulligan is free;
  after that you pick one card per extra mulligan to put on the bottom of your library.

## Playing cards

- **Glowing cyan** cards can be played. Drag one from your hand up toward the table and
  let go to play a land or cast a spell. Mana is tapped for you (auto-pay, like Arena).
- Casting a spell or using an ability takes two steps, and **Cancel** (or `Esc`) backs
  out of either one:
  1. **Targets.** Legal targets are highlighted in **yellow**. Click one.
  2. **Pay.** The prompt shows the cost and the lands auto-pay would tap glow. Press
     **Pay** to confirm, or tap lands yourself: the spell is cast as soon as your mana
     covers the cost.

  Until it is paid for nothing has happened. The spell isn't on the stack, and Cancel
  untaps any lands you tapped while paying, so you are back exactly where you were.
- **Paying by hand:** click your lands and mana rocks to tap them. The mana shows in a
  pill beside your avatar. Costs spend that mana first and auto-tap only for the rest.
  A source with a choice (a dual land, a Talisman, Sunken Ruins) asks which ability and
  which mana you want. Click a tapped source again to take its mana back, as long as none
  of it has been spent and using it did nothing else, like dealing you damage.
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
- Cards fly to where they go: from a hand to the stack, from the stack to the battlefield
  or the graveyard, from the battlefield to a graveyard or exile pile, back to a hand or
  the command zone. A spell or ability that resolves glows gold as it leaves the stack, an
  ability flies back into the permanent it came from, and the log lines it wrote flash
  gold. A new token flares as it appears. At a higher **Speed** the flights are quicker,
  and with your system set to reduce motion cards just appear where they go.
- With the stack empty, the game passes for you except at your **stops**. The tracker in
  the bottom right shows them:

  | Mark under a step | Meaning              |
  | ----------------- | -------------------- |
  | nothing           | no stop              |
  | **ring**          | stop if I can act    |
  | **dot**           | always stop          |

  Click a step to cycle it: no stop, ring, dot, no stop. A pip that covers several steps
  (beginning, combat, end) opens one button per step. The untap and cleanup steps can't
  hold a stop: nobody gets priority there (502.4, 514.3).
- The arrows beside the tracker are the seats (down is you). Click one to see
  and edit the stops for that player's turns; the tracker takes their deck colour. Click
  it again to go back to the current turn. Your turns show orange, everyone else's blue.
- Default stops (your stops are saved in the browser):
  - **Your turn:** always in both main phases; if you can act, at beginning of combat
    and after blockers are declared.
  - **Other turns:** if you can act, in the upkeep, after attackers (only once something
    attacks) and blockers are declared, and in the end step.

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
- **Dividing damage:** with **Damage: By hand** on (in the log bar), a window opens in
  the damage step when one of your attackers has a choice: two or more blockers, or
  trample. Use − and + to move damage between the blockers and, with trample, the player
  or permanent attacked. It starts on the automatic split; **Deal Damage** is enabled once
  the split is legal. With **Damage: Auto** (the default) it is never asked.

## Special cards

| Card or cost | What to do |
| --- | --- |
| **Planeswalker** | Click yours to see its loyalty abilities and pick one. It happens right away (after any target): loyalty abilities cost loyalty, not mana. A −X ability first asks for X, like an ability with {X} in its cost does. Loyalty is the shield in the corner. |
| **Battle** | Its defense is the orange box. When you cast a Siege, the cast panel asks which opponent protects it. |
| **Two faces** (split, adventurer, modal double-faced) | The cast panel has a **Face** row: pick the half, the Adventure, or the face to play. A modal card's land face says "(land)"; pressing Continue on it plays the land. |
| **Class** | Click yours to see its level bars; pick the next one and pay for it. |
| **Several abilities** (Deathrite Shaman) | Click the permanent to see every activated ability; the ones you can't use now are dimmed. With only one usable, clicking goes straight to it. |
| **"One mana of any color"** | A window with the five colours opens while it resolves. **Lion's Eye Diamond** asks for the colour when you click it. |
| **Aura and Equipment** | What is attached to a permanent fans out behind it, toward the top of the card, each showing its name and a strip of art; it taps and attacks with the permanent. Click an Equipment's strip to equip it to something else, hover a strip to read the card. An enchanted land stands on its own instead of in its pile. |
| **Graveyard and exile** | A pile glows when something in it can be cast (flashback, escape, an adventurer card whose Adventure you cast, or a card an effect lets you cast or play, in anyone's exile). Open it and click the glowing card. With escape (Underworld Breach) a window then asks for the three other cards to exile. A card exiled face down shows its back, unless you may look at it. |
| **Gift, channel, bargain** | Extra cast-panel rows: **Gift** (promise an opponent a gift, or none); an **Or** chip beside playing a card with an ability that works from the hand (Otawara's channel); **No Sacrifice** skips a bargain sacrifice. |
| **Sacrifice costs** (Goblin Bombardment, Village Rites) | After the targets, the creatures you could sacrifice glow yellow; click one. |
| **Shock lands** | Asks whether you pay 2 life as you play it. |
| **New targets** (Deflecting Swat) | Click the new target for each slot, or press **Keep Target**. A card in a graveyard (Sevinne's Reclamation) is targeted from a window. |
| **Cast as it resolves** (Beseech the Mirror) | A window offers **Cast** or **Don't Cast**; casting goes through the usual targets and costs. |
| **Library search** (Rampant Growth, Cultivate, Path to Exile, ...) | Your whole library opens. Cards you could find glow; click one and press **Choose**, or **Find Nothing**. |

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
| `Ctrl+Space` | hold priority (see [Turns, priority and the stack](rules-coverage.md#turns-priority-and-the-stack)) |
| Hover a card | full-size view |
| Right-click a card (in your hand, on the stack, on a graveyard or exile pile, or in the window that opens from one) | bigger view that stays up; left-click off it to close (over that window, the first click closes the view and the next the window) |
| Click a graveyard or exile pile | look through it; hovering the pile shows its top card |
| Hover a card name in the log (dashed underline) | see the card |

The log is bottom-left, under one bar; point at a button on it (or tab to it) for its name.
**Log**, the bar's left half, folds the log away and back. On the right:

- **Pause** (‖, a table's game only) pauses the game for everyone at the table.
- **Settings** (the gear) opens a small panel: **Bot speed** (1×, 2×, 4×), **Sound** (mute
  and a volume slider), and **Combat damage**, Auto or By hand, for dividing an attacker's
  damage among its blockers or trampling over. `Esc` or a click elsewhere closes it.
- **Exit** (the door) asks before leaving the game for the deck menu.

The deck menu has the same mute button and volume slider in its top-right corner. Sound
and damage choices are saved in the browser.
