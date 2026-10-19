# Arena EDH

An Arena-style Commander (EDH) table: TypeScript, React, Zustand and Immer, built with
Vite and tested with Vitest. The rules engine in `src/engine/` is a pure function,
`applyAction(game, action)`. The UI in `src/ui/` never touches rules. A card in `src/cards/`
is Scryfall data plus a small script.

Read first:

- `README.md`: the commands.
- `docs/developing.md`: project layout, core ideas, adding a card, the script reference.
- `docs/rules-coverage.md`: what is implemented, with rule numbers, and the known
  simplifications.
- `docs/how-to-play.md`: what the player sees and every control.
- `docs/card-scripting.md`: how to script a card from its exact wording.

## Working here

- `npm test` runs everything, bot-vs-bot games included, and takes minutes. While working,
  run one file: `npx vitest run tests/engine.test.ts`. Finish with `npm test` and
  `npm run build` (type-check and build) passing.
- Where tests go: rules in `tests/engine.test.ts` or a deck's own file
  (`tests/ketramose.test.ts`); the UI flow in `tests/view.test.ts`, which drives the store
  and `buildView()` without rendering; bot games in `tests/simulation/`.
- Bots (`src/engine/ai.ts`) must keep working with every engine change. The bot games are
  the check.
- Cite the rule number in a comment for anything the Comprehensive Rules decide
  (`117.3c`), and quote the clause a script implements next to its code.
- Size the UI in `rem` (see "Sizing the UI" in `docs/developing.md`). All styling is in
  `src/ui/styles.css`.
- Sounds are synthesized in `src/ui/synth.ts`. There are no sound files.
- When behaviour changes, update the doc that describes it: `docs/rules-coverage.md` for
  rules, `docs/how-to-play.md` for the interface, `docs/developing.md` for the layout and
  the script reference.
- Generated, never edited by hand: `src/cards/cards.generated.json` and
  `tests/fixtures.generated.json` (`npm run fetch-cards`); `src/cards/creature-types.json`,
  `src/cards/subtypes.json` and `docs/rules/` (`npm run fetch-rules`). Behind the cloud
  session's HTTPS proxy, run `NODE_USE_ENV_PROXY=1 npm run fetch-cards`.

## Data sources

- **Scryfall** (`api.scryfall.com`, `cards.scryfall.io`) is the source for card data, art
  and a card's popularity: every Scryfall card carries `edhrec_rank`, its rank across all
  Commander decks. Use it before reaching for anything else.
- **EDHREC** (`edhrec.com`, `json.edhrec.com`) is for what Scryfall lacks: the cards played
  most with a given commander, and a commander's themes. The site has no documented API;
  its pages load pre-built JSON from `json.edhrec.com/pages/commanders/<slug>.json` (and
  `themes`, `cards`, `combos` the same way), which can change shape without notice. Fetch
  sparingly and cache, as `scripts/fetch-cards.mjs` does with Scryfall; never fetch at
  game time. Both hosts must be allowed in the cloud environment's network settings.
- **Moxfield** (`moxfield.com`, `api2.moxfield.com`) is where sample decks would come from,
  but its API is not public: Cloudflare turns away requests that don't come from a browser,
  and Moxfield grants scripted access only on request (they issue a User-Agent to send).
  Until the user has that, the supported route is the one the app already has: export a
  deck from Moxfield and paste it (`src/cards/decklist.ts` reads the format). Don't work
  around the block. With access granted, keep the agreed User-Agent in an environment
  secret, fetch sparingly and cache, and allow both hosts in the network settings.

## Card wording is the rules

Magic interactions depend on exact wording: "may" vs. "must", "you" vs. "that player",
"target" vs. not, "when" vs. "as", exile vs. graveyard. Before scripting or changing a
card, read its Oracle text clause by clause and follow `docs/card-scripting.md`. Never
approximate a card quietly: ask the user, and list any approved difference under
"Known simplifications" in `docs/rules-coverage.md`.

## Magic rules reference

The official Comprehensive Rules are in `docs/rules/`, one file per rule
(`docs/rules/<number>-<title>.txt`; Commander is `903-commander.txt`). Use them instead of
memory or the web for any rules question, and cite the rule number.

- `docs/rules/INDEX.md`: every rule and its file, and every keyword in 701 and 702 with its
  number. Start here if you don't know the number.
- `docs/rules/glossary.txt`: short definitions that point to the full rule.

Lookups:

- Know the number: Grep `^702\.19` in `docs/rules/702-keyword-abilities.txt`.
- Know the keyword: Grep the name in `INDEX.md` to get the number, then as above.
- Know only the term: Grep `^Term$` in `glossary.txt` with a few lines of context.

`701-*.txt`, `702-*.txt` and `glossary.txt` are large: Grep them, don't Read them whole.
