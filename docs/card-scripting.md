# Scripting a card: the wording is the rules

Magic cards do exactly what their Oracle text says, word for word. A script that gets
the gist right but changes one word plays a different card: "may" becomes "must", the
wrong player makes a choice, or a trigger fires when it shouldn't. Treat every card as
a small rules question, and check each clause before writing code for it.

## How to script a card

1. Read the card's current Oracle text from `src/cards/cards.generated.json` (fetched
   from Scryfall), not from memory. Printed text and memory are often out of date.
2. Split it into abilities, and each ability into clauses. Ask the questions below for
   each clause.
3. Look up every rule you rely on in `docs/rules/` (see `CLAUDE.md`), and cite it in a
   comment.
4. For anything more than a one-liner, quote the clause the code implements in a comment
   next to it.
5. Write a test for each clause that could go wrong, especially the edge cases below.
6. If the engine can't do a clause exactly, don't approximate quietly. Ask the user,
   and list the approved difference in `docs/rules-coverage.md` under "Known simplifications".

## Words to check

**Who.**

- "You" is the controller of the spell or ability (109.5), and that isn't always the owner.
- "That player", "its controller" and "its owner" are different people. A countered
  spell's controller gets Swan Song's Bird, not its owner.
- "Each player" and "each opponent" act in APNAP order (101.4), and draw in turn order
  (121.2c).
- "Target opponent", "an opponent" and "each opponent" are three different things.

**Optional or not.**

- "May" is a choice, and the player it names makes it (608.2d). Without "may", the
  action happens.
- "[Do X] unless [player] pays {N}" means that player chooses whether to pay first
  (118.12a). "You may draw unless that player pays" is then a second, separate choice.
- "Pay {N}. If you don't, ..." lets the player refuse to pay (118.12).
- Life can be paid only if the player has that much (119.4). Damage dealt to you isn't
  paying life.

**Targets.**

- Only the word "target" targets (115). Untargeted effects ignore hexproof and can't
  fizzle.
- "Two target players" means two different players (115.3).
- A spell or ability whose targets have all become illegal does nothing at all
  (608.2b). If only some are illegal, the rest of it still happens.

**When.**

- "When", "whenever" and "at" are triggered abilities. They use the stack and can be
  responded to (603).
- "If [condition]" right after the trigger event is checked twice: when the ability
  triggers and when it resolves (603.4).
- "As ...", "enters with", "instead" and "skip" are replacement effects, not triggers
  (614.1). They don't use the stack.
- "This turn", "until end of turn", "at the beginning of the next end step" and "your
  next upkeep" are all different lengths of time. A delayed trigger fires once (603.7b).
- "First" or "second spell each turn" counts spells cast. Copies aren't cast (707.10).
- "Triggers only once each turn" and "do this only once each turn" (603.2h) differ too.

**Costs.**

- "As an additional cost" (118.8) and "rather than pay this spell's mana cost" (118.9)
  are paid while casting. "Pay ... :" is part of an ability's cost.
- "Activate only if ...", "activate only as a sorcery" and "spend this mana only to ..."
  are restrictions that are easy to drop by accident.
- Mana abilities don't use the stack (605.3b).

**Zones and words for moving cards.**

- Exile, graveyard, the top of the library, the bottom of the library and "in a random
  order" are all different.
- "Reveal" makes a card public. Without it, a searched-for card stays hidden (701.23e).
- A search for "a card" must find one if it can (701.23d). A search for a card with a
  stated quality may find nothing (701.23b).
- "Countered this way" and "if you do" only follow if that part actually happened.

**Numbers.**

- Mana value counts X while a spell is on the stack (202.3e), and uses the larger part
  of a hybrid symbol (202.3f).
- An effect that can't be done in full does as much as it can (609.3).
- "Can't" beats "can" (101.2).
