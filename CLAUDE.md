# Arena EDH

See `README.md` for commands, project layout, and known simplifications.

## Magic rules reference

The official Comprehensive Rules are stored locally in `docs/rules/`. Use them
instead of memory or the web when a rules question comes up, and cite the rule
number (for example `702.19b`) in code comments and explanations.

- `docs/rules/INDEX.md`: every rule and its file, plus every keyword in 701 and 702
  with its number. Start here if you don't know the number.
- `docs/rules/<number>-<title>.txt`: one file per rule. Commander is
  `903-commander.txt`.
- `docs/rules/glossary.txt`: short definitions that point to the full rule.

Lookups:

- Know the number: Grep `^702\.19` in `docs/rules/702-keyword-abilities.txt`.
- Know the keyword: Grep the name in `INDEX.md` to get the number, then as above.
- Know only the term: Grep `^Term$` in `glossary.txt` with a few lines of context.

Do not Read `701-*.txt`, `702-*.txt`, or `glossary.txt` whole. They are large, so
Grep them.

The files are generated. To update after a new set releases, run
`npm run fetch-rules`. Don't edit them by hand.
