# no-designated-ignore-guard

PreToolUse hook that blocks Edit/Write tool calls ADDING an ignore marker for a designated fix-only lint rule.

Some rules are designated fix-only: every finding has a real fix, so an ignore marker is always the wrong move. The first designee is `socket/max-comment-block-lines` — a long comment block is fixed by shortening it or moving the depth into `docs/agents.md/**`, and a JSDoc documentation block already gets the doubled doc budget (`MAX_DOC_COMMENT_LINES`), so contracts and lock-step notes never need excusing in the first place.

Detection is additive: the guard compares the about-to-land content against what it replaces (Edit `old_string`, the on-disk file for Write, folded edits for MultiEdit) and fires only when a designated marker count goes UP. Existing markers are grandfathered — editing around one, or rewriting a file that retains one, passes.

## Blocked (when added)

- `// socket-lint: allow long-comment-block -- <reason>`
- `/* oxlint-disable socket/max-comment-block-lines */`
- `// oxlint-disable-next-line socket/max-comment-block-lines`

## Allowed

- Any edit that keeps the marker count flat or removes markers.
- Ignore markers for non-designated rules (other guards own those shapes).

## Exemptions

The oxlint plugin's rule subtrees (`.config/fleet/oxlint-plugin/fleet/`, `.config/repo/oxlint-plugin/`) and this guard's own files — the banned shape is lookup-table data or test fixture there.

## Designating a rule

Add an entry to `DESIGNATED_RULES` in `index.mts` (`allowId`, `ruleId`, `fix`) and rebuild the hook bundle. Designation is a fleet decision: the rule's every finding must have a mechanical fix the block message can name.

## Bypass

`Allow designated-ignore bypass` typed verbatim by the user in a recent turn.
