# no-pr-review-verdict-guard

PreToolUse (Bash) guard. Blocks a `gh pr review` that renders a **verdict** —
`--approve` / `-a` or `--request-changes` / `-r`.

## Why

Approving a pull request or requesting changes is a human's decision. The agent
reviews by leaving findings and flagging the PR for a person to act on; it never
casts the approve/reject vote itself. This is the enforced half of the
comment-only rule in the fleet PR-review doctrine
(`docs/agents.md/fleet/pr-review-comments.md`).

## What passes

- `gh pr review --comment` / `-c` (a comment-only review).
- `gh pr comment` (a plain PR comment).
- Any command without a `gh pr review` verdict flag.

The command is parsed with the fleet shell tokenizer (`_shared/shell-command.mts`),
so a quoted `--approve` inside a comment body or a sibling command cannot
false-fire — the flag only counts when it rides `gh pr review`'s own args.

## Bypass

A person authorizing the verdict types, in a recent message:

```
Allow pr-review-verdict bypass
```
