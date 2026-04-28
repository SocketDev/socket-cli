# release-workflow-guard

`PreToolUse` hook that **blocks** every Bash command that would
dispatch a GitHub Actions workflow. Exit code `2`; the model never
gets to fire the command.

> Workflow dispatches are irrevocable. Publish workflows push npm
> versions (unpublishable after 24h). Build/Release workflows pin
> GitHub releases by SHA. Container workflows push immutable image
> tags. Even build workflows with a `dry_run` input still treat the
> dispatch itself as the prod trigger — the user runs them
> manually, never Claude.

## What gets blocked

- `gh workflow run <id>`
- `gh workflow dispatch <id>` (alias of `run`)
- `gh api .../actions/workflows/<id>/dispatches` POST/PUT

Any other `Bash` command passes through silently.

## Why no per-workflow allowlist

Because allowlists drift. A "benign" CI dispatch today becomes a
prod-touching dispatch tomorrow when someone wires a publish step
behind it; the allowlist hasn't updated. The cost of an extra
block is one re-prompt (the user runs the command in their own
terminal). The cost of a missed prod dispatch is irreversible.
Block all dispatches; let the user judge.

## Override

There is no opt-out. If a real workflow id needs dispatching during
a Claude session, the user runs it themselves — either in a plain
shell, via the GitHub Actions UI, or by typing `! gh workflow run
...` outside of a Claude prompt where the hook doesn't fire.

## Wiring

`.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [{ "type": "command", "command": "node .claude/hooks/release-workflow-guard/index.mts" }]
      }
    ]
  }
}
```

## Exit code

- `0` — command is not a workflow dispatch; pass through
- `2` — command is a workflow dispatch; block + write reason to stderr

## Sibling hooks

- `private-name-guard` — primes the model on private repo / project names
- `public-surface-reminder` — primes on customer / company names
- `token-guard` — blocks token-leaking shell shapes

`release-workflow-guard` is the third hook that **blocks** rather
than primes (alongside `token-guard` and `path-guard`). The shared
rule: block when the harm of a wrong fire is irreversible.
