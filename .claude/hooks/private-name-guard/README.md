# private-name-guard

A **Claude Code hook** that runs before any Bash command Claude is
about to execute and reminds the model not to publish private repo
names or internal project codenames to public surfaces. It never
blocks — its job is to keep that rule top-of-mind right when Claude
is about to commit, push, or comment on a public-facing PR/issue.

> If you haven't worked with Claude Code hooks before: hooks are tiny
> scripts that run at specific lifecycle points. A `PreToolUse` hook
> like this one fires *before* Claude calls a tool (here, the Bash
> tool). It can either **prime** (write to stderr, exit 0, model
> carries on) or **block** (exit 2). This one only primes.

## The rule

> No private repos or internal project names in public surfaces. Omit
> the reference entirely — don't substitute a placeholder. The
> placeholder itself is a tell.

This is the close sibling of [`public-surface-reminder`](../public-surface-reminder/),
which covers customer/company names and internal work-item IDs. The
two hooks **compose** — both fire on the same public-surface
commands, each priming a distinct slice of the rule set.

## What counts as "public surface"

- `git commit` (including `--amend`)
- `git push`
- `gh pr (create|edit|comment|review)`
- `gh issue (create|edit|comment)`
- `gh api -X POST|PATCH|PUT`
- `gh release (create|edit)`

Any other Bash command passes through silently.

## Why no denylist

A list of internal project names is itself a leak. A file named
`private-projects.txt` enumerating "these are our internal repos" is
worse than no list at all — anyone who finds it gets the org's full
internal map for free. Recognition happens at write time, every time,
by the model reading what it's about to send. The hook just makes
sure that read happens.

## Wiring

`.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node .claude/hooks/private-name-guard/index.mts"
          }
        ]
      }
    ]
  }
}
```

## Exit code

Always `0`. The hook never blocks; it only prints to stderr.

## Cross-fleet sync

This README and the hook itself live in
[`socket-repo-template`](https://github.com/SocketDev/socket-repo-template/tree/main/template/.claude/hooks/private-name-guard)
and are required to be byte-identical across every fleet repo.
`scripts/sync-scaffolding.mts` flags drift; `--fix` rewrites it.
