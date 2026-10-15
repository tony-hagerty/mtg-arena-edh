---
name: script-requested-cards
description: Script the cards players asked for. Reads docs/card-requests.json (cards a pasted deck named that the Oracle text parser refused), groups them by the wording it couldn't read, adds parser templates for shared wording and hand scripts for one-off cards, tests, and removes the handled cards from the file. Use when the user says /script-requested-cards, or asks to script requested, refused or missing cards.
---

# Script requested cards

`docs/card-requests.json` lists cards the game refused: each has `name`, `oracleText`,
`clause` (what the parser couldn't read), `reason`, `count` (how many paste screens met
it) and `last` (when). The deck-paste screen adds to it while `npm run dev` runs, and
`npm run parse-report` adds pool cards that can't be played.

Follow `CLAUDE.md` and `docs/card-scripting.md` throughout: the card's exact Oracle text
is the rules, clause by clause, and rule numbers from `docs/rules/` go in comments.

## 1. Gather the requests

1. If the user has a `card-requests.json` downloaded from the paste screen (a built or
   hosted version can't write the file), merge it first:
   `npm run card-requests -- <path to the download>`. Repeats are merged, not added twice.
2. Read `docs/card-requests.json`. If it is empty, say so and stop.
3. Group the cards by the wording they share: the same `clause` shape with names and
   numbers set aside ("Whenever you gain life, ..." on several cards is one group). Within
   the groups, highest total `count` first.
4. Show the user the groups (cards, counts, the clause) and the plan for each: a parser
   template, a hand script, or leave it. Ask which to do if there are many.

## 2. Script them

- **Wording many cards share → a parser template** in `src/cards/oracle.ts`, built from
  the helpers in `src/engine/rules.ts`. It must read the wording exactly and refuse
  anything near it that it doesn't cover: the parser never approximates. Add cases to
  `tests/oracle.test.ts` (a `fake` card with the wording, what it does in a game, and a
  near miss it still refuses).
- **One-off cards → a hand script** in `src/cards/scripts.ts`, keyed by the card's name.
  The app registers it before the card is fetched, so the fetched card uses it. For tests,
  add the name to `tests/fixture-cards.json`, run `npm run fetch-cards` (in a cloud
  session: `NODE_USE_ENV_PROXY=1 npm run fetch-cards`) and test each clause that could go
  wrong in `tests/engine.test.ts`.
- **Can't be done exactly** (the engine lacks a rule the card needs): don't approximate.
  Ask the user. An approved difference goes under "Known simplifications" in
  `docs/rules-coverage.md`.
  Leave a card the user doesn't approve in the file.
- Bots must at least not break on a new ability (`src/engine/ai.ts`).
- Check the result: `npm run parse-report` shows which pool cards the parser now scripts;
  a new template may also script pool cards that have hand scripts (hand scripts still
  win, so that changes nothing in play).

## 3. Finish

1. Run `npm test` (several minutes) and `npm run build`. Both must pass.
2. Take the handled cards out of `docs/card-requests.json` (by name; keep the rest as
   they are). The `removeRequests` helper in `src/cards/requests.ts` does it the same
   way the app writes the file.
3. Update `docs/rules-coverage.md`: the parser's reach under "Known simplifications" → "Scripts from
   Oracle text" if it grew, and any approved simplification.
4. Tell the user what was scripted, what was left and why, then ask before committing.
