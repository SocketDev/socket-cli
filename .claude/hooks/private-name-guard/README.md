# private-name-guard

`PreToolUse` hook that **never blocks**. On every `Bash` command that
would publish text to a public Git/GitHub surface, writes a short
reminder to stderr so the model re-reads the command with the rule
freshly in mind:

> No private repos or internal project names in public surfaces. Omit
> the reference entirely — don't substitute a placeholder. The
> placeholder itself is a tell.

Attention priming, not enforcement. The model is responsible for
applying the rule — the hook just ensures the rule is in the active
context at the moment the command is about to fire.

Sibling to `public-surface-reminder`, which covers customer/company
names and internal work-item IDs. The two hooks compose: both fire on
the same public-surface commands, each priming a distinct slice of the
rule set.

## What counts as "public surface"

- `git commit` (including `--amend`)
- `git push`
- `gh pr (create|edit|comment|review)`
- `gh issue (create|edit|comment)`
- `gh api -X POST|PATCH|PUT`
- `gh release (create|edit)`

Any other `Bash` command passes through silently.

## Why no denylist

Because a denylist is itself a leak. A file named `private-projects.txt`
that enumerates "these are our internal repos" is worse than no list at
all — anyone who finds it gets the org's full internal map for free.
Recognition happens at write time, every time, by the model reading the
text it's about to send. The hook just makes sure that read happens.

## Wiring

`.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [{ "type": "command", "command": "node .claude/hooks/private-name-guard/index.mts" }]
      }
    ]
  }
}
```

## Exit code

Always `0`. The hook never blocks; it only prints to stderr.
