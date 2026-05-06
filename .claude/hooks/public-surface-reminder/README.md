# public-surface-reminder

A **Claude Code hook** that runs before any Bash command Claude is
about to execute and prints a quick reminder about two writing rules
to stderr. It never blocks — its job is just to make sure those rules
are top-of-mind right when Claude is about to commit, push, comment
on a PR, or otherwise publish text somewhere public.

> If you haven't worked with Claude Code hooks before: hooks are tiny
> scripts that run at specific lifecycle points. A `PreToolUse` hook
> like this one fires *before* Claude calls a tool (here, the Bash
> tool). The hook can either **prime** the model (write to stderr,
> exit 0, model carries on) or **block** the call (exit 2). This one
> only primes.

## The two rules

1. **No real customer or company names.** Use a placeholder like
   `Acme Inc`. No exceptions.
2. **No internal work-item IDs or tracker URLs.** No `SOC-123` /
   `ENG-456` / `ASK-789` / similar; no `linear.app` / `sentry.io` /
   internal Jira links.

## What counts as "public surface"

The hook only primes for commands that publish text outward:

- `git commit` (including `--amend`)
- `git push`
- `gh pr (create|edit|comment|review)`
- `gh issue (create|edit|comment)`
- `gh api -X POST|PATCH|PUT`
- `gh release (create|edit)`

Any other Bash command passes through silently.

## Why no denylist

You might ask: why doesn't the hook just have a list of customer
names to scan for? Because **the list itself is the leak**. A file
named `customers.txt` enumerating "these are our customers" is worse
than the bug it tries to prevent — anyone who finds it gets the org's
full customer map for free. Recognition has to happen at write time,
done by the model reading what it's about to send. The hook just
makes sure that read happens.

## Wiring

In `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node .claude/hooks/public-surface-reminder/index.mts"
          }
        ]
      }
    ]
  }
}
```

## Exit code

Always `0`. The hook prints a reminder and steps aside.

## Sibling hooks

- [`private-name-guard`](../private-name-guard/) — primes on private
  repo / project names.
- [`token-guard`](../token-guard/) — *blocks* Bash calls that would
  leak literal secrets to stdout. (The blocking sibling, contrasted
  with this priming one.)

## Cross-fleet sync

This README and the hook itself live in
[`socket-repo-template`](https://github.com/SocketDev/socket-repo-template/tree/main/template/.claude/hooks/public-surface-reminder)
and are required to be byte-identical across every fleet repo.
`scripts/sync-scaffolding.mts` flags drift; `--fix` rewrites it.
