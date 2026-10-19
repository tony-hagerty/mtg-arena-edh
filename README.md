# Arena EDH

Play Commander (EDH), the four-player Magic: The Gathering format, with an MTG Arena-style
table. Two to four players: you play one deck, and bots or friends play the others.

This is an unofficial fan prototype. Expect rough edges.

## Highlights

- **Full Commander games** for 2 to 4 players: 40 life, commander tax, 21 commander
  damage, partners, and a proper turn structure with the stack and priority.
- **Play your own deck.** Paste a list from Arena, Moxfield, Archidekt, MTGO, TappedOut
  or plain text. Cards the game doesn't know are fetched from
  [Scryfall](https://scryfall.com) and read from their rules text.
- **Bots** fill any empty seat, so you can play alone.
- **Friends** can share your screen, or join from their own computer with a code.
- **Eight decks built in**, four two-colour starters and four Commander decks.

## Getting the game

- **Windows:** download `ArenaEDH.exe` from the
  [Releases page](https://github.com/tony-hagerty/mtg-arena-edh/releases) and
  double-click it. Nothing to install. The first time, Windows may say "Windows protected
  your PC": click **More info**, then **Run anyway**.
- **Any computer with a browser:** if someone sent you a single `index.html`, double-click
  it. Card images need an internet connection.

## Quick start

1. Pick a deck on the menu, or **Paste a deck list** to use your own.
2. Under the decks, choose who fills each other seat: **Bot**, **Person here** (a friend
   at your screen), or **Empty seat**.
3. Keep your opening hand or mulligan.
4. **Glowing** cards can be played. Drag one from your hand onto the table, pick targets
   (shown in yellow), and press **Pay**. Mana is tapped for you.
5. Press **Space** for the big button (Next, Resolve, Pass) and **Esc** to cancel.

To cast your commander, click the **crown** on your portrait. Hover any card to see it
full size.

The full guide, covering combat, the stack, stops, special cards and every control, is in
**[How to play](docs/how-to-play.md)**.

## Playing with friends

- **Same screen:** set a seat to **Person here**. The table is covered when it's someone
  else's turn to decide, until they click **I'm Player N**.
- **Different computers (Windows app):** one person uses **Host a table** and shares the
  code; everyone else uses **Join a table** and pastes it. Everyone needs the same version of the game.
  The first time you host, Windows Firewall asks whether to allow it: say yes.
- If someone drops out, the game waits for them, or the table can vote for a bot to take
  their seat. If the host leaves, anyone can resume the game from **Saved games**.

## What's missing

The biggest gaps are listed below. The full list is in
[Rules coverage](docs/rules-coverage.md#known-simplifications).

- Some cards can't be read yet. The paste screen tells you which: swap them out, or play
  them as plain cards without their rules text, clearly marked. Each one is noted so it
  can be added later.
- Bots play a simple game. They skip some combo lines and never hold priority to
  respond to their own spells.
- A few rules are simplified, mostly ones that rarely come up in play.

## For developers

You need [Node.js](https://nodejs.org) (a recent LTS version).

```bash
npm install
npm run dev            # play at http://localhost:5180
npm test               # every test: rules tests and full bot-vs-bot games
npm run test:quick     # every test but the whole games, while you work
npm run test:games     # only the whole games (tests/simulation/ and a few others)
npm run build          # type-check and build into dist/
npm run build:single   # one self-contained dist-single/index.html to share
npm run build:exe      # the Windows program, release/ArenaEDH.exe
npm run fetch-cards    # pull card data from Scryfall after editing decklists.json
npm run parse-report   # which cards the Oracle text parser can script, and why not the rest
npm run fetch-corpus   # refresh the parse report's corpus: the 600 most-played Commander cards
npm run recheck-requests  # take requested cards the parser now reads out of docs/
npm run card-requests -- <file>  # merge a downloaded card-requests.json into docs/
npm run fetch-rules    # refresh docs/rules/ after a new set releases
npm run profile-game -- <seed>   # one bot game under the CPU profiler: where the time goes
```

Behind an HTTPS proxy, run `fetch-cards`, `fetch-corpus` and `recheck-requests` with
`NODE_USE_ENV_PROXY=1` in front, as in `NODE_USE_ENV_PROXY=1 npm run fetch-cards` (Node's
`fetch` ignores the proxy otherwise).

**Releasing:** set `version` in `package.json`, merge to `main`, then push a matching tag
(`git tag v0.1.0 && git push origin v0.1.0`). The
[Release workflow](.github/workflows/release.yml) runs the tests (the quick ones and the
games, as two jobs at once), builds `ArenaEDH.exe` on Windows, checks that it starts, and
publishes the release with the `.exe` attached.

The stack is TypeScript, React, Zustand and Immer, built with Vite and tested with Vitest.
The rules engine is a pure function, `applyAction(game, action)`, in `src/engine/`.

| Read this | For |
| --- | --- |
| [Developer guide](docs/developing.md) | Project layout, core ideas, adding a card, the card-script reference |
| [Rules coverage](docs/rules-coverage.md) | What is implemented, with rule numbers, and the known simplifications |
| [Card scripting](docs/card-scripting.md) | How to script a card from its exact wording |
| [Windows program](launcher/README.md) | How the .exe and its launcher work |
| [Comprehensive Rules](docs/rules/INDEX.md) | The official rules, one file per rule |
| [CLAUDE.md](CLAUDE.md) | Instructions for Claude Code in this repo |

Cards that pasted decks needed but the game couldn't read are collected in
`docs/card-requests.json`. Run `/script-requested-cards` in Claude Code to script them.

## Credits

Card data and images come from [Scryfall](https://scryfall.com) and are loaded from its
image server at runtime. If an image doesn't load, the card is drawn as text instead. Mana
and ability icons are from [mana-font](https://github.com/andrewgioia/mana). The mouse
cursor (`src/ui/cursor.png`) is
["MTGA cursor"](https://www.cursor.cc/?action=icon&file_id=114958) by Tales on cursor.cc,
shared under Creative Commons with no attribution required; `cursor-down.png` is a shrunk,
recoloured copy of it.

Magic: The Gathering is © Wizards of the Coast. This is an unofficial fan prototype, not
affiliated with or endorsed by them.

## License

The code is under the [MIT License](LICENSE). It covers this project's own code only, not
Magic card names, text or images, the Comprehensive Rules in `docs/rules/`, or the
third-party assets credited above.
