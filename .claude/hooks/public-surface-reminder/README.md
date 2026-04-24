# public-surface-reminder

`PreToolUse` hook that **never blocks**. On every `Bash` command that would
publish text to a public Git/GitHub surface, writes a short reminder to
stderr so the model re-reads the command with the two rules freshly in
mind:

1. **No real customer or company names.** Use `Acme Inc`. No exceptions.
2. **No internal work-item IDs or tracker URLs.** No `SOC-123` /
   `ENG-456` / `ASK-789` / similar, no `linear.app` / `sentry.io` URLs.

Attention priming, not enforcement. The model is responsible for actually
applying the rule — the hook just ensures the rule is in the active
context at the moment the command is about to fire.

## What counts as "public surface"

- `git commit` (including `--amend`)
- `git push`
- `gh pr (create|edit|comment|review)`
- `gh issue (create|edit|comment)`
- `gh api -X POST|PATCH|PUT`
- `gh release (create|edit)`

Any other `Bash` command passes through silently.

## Why no denylist

Because a denylist is itself a customer leak. A file named
`customers.txt` that enumerates "these are our customers" is worse than
the bug it tries to prevent. Recognition and replacement happen at write
time, done by the model, every time.

## Exit code

Always `0`. The hook prints a reminder and steps aside.
