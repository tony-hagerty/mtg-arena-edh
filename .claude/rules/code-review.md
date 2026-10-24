# Code review after finishing a task

When a task changed code, review the change before calling it done.

## When

- After the work is finished and `npm test` and `npm run build` pass, before the wrap-up
  or final message.
- Skip it when the task changed no code (docs only, a question answered) or the change is
  a one-line fix you can see is right.

## How

1. Run the `code-review` skill on the current diff (uncommitted changes, or the branch
   against `main` if already committed).
2. Fix every finding you agree with. For one you don't, say why in one line.
3. Check the fixes the same way as the task:
   - Rules or card scripts: reread the Oracle text and the cited rule in `docs/rules/`.
   - Engine changes: the bot games in `tests/simulation/` still pass.
   - Rerun the affected test file, then `npm test` and `npm run build` again.
4. In the closing message, list what the review found and what you changed. If it found
   nothing, say so in one line.

Don't commit or push the fixes unless the user asked for commits in this task.
