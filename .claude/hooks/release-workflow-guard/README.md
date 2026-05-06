# release-workflow-guard

A **Claude Code hook** that runs before every Bash command and
**blocks** any attempt to dispatch a GitHub Actions workflow. The
model never gets to fire those commands; the human running Claude has
to do it themselves.

> If you haven't worked with Claude Code hooks before: hooks are tiny
> scripts that run at specific lifecycle points. A `PreToolUse` hook
> like this one fires *before* Claude calls a tool. It can either
> **prime** (write to stderr, exit 0, model carries on) or **block**
> (exit 2, command never runs). This one blocks.

## Why this is so strict

Workflow dispatches are **irrevocable**:

- Publish workflows push npm versions. Once published, an npm version
  is unpublishable after 24 hours.
- Build/Release workflows cut GitHub releases pinned to a specific
  SHA. Releases can be edited, but the SHA + the moment they were
  cut are forever.
- Container workflows push immutable image tags.
- Even workflows that *advertise* a `dry_run` input still treat the
  dispatch itself as a prod trigger — the workflow runs and counts
  for downstream CI gating; only specific steps may be skipped.

The cost of blocking a legitimate dispatch is one re-prompt — the
user types the command in their own terminal. The cost of letting
through a wrong dispatch is irreversible. So the hook errs strict.

## What gets blocked

- `gh workflow run <id>`
- `gh workflow dispatch <id>` (alias of `run`)
- `gh api .../actions/workflows/<id>/dispatches` (POST or PUT)

Any other Bash command passes through silently.

## Why no per-workflow allowlist

Because allowlists drift. A "benign" CI dispatch today becomes a
prod-touching dispatch tomorrow when someone wires a publish step
behind it, and nobody remembers to update the allowlist. Block all
dispatches; let the user judge case-by-case.

## Override

There is no opt-out. If a real workflow id needs dispatching during
a Claude session:

- The user runs it from a plain shell outside Claude, or
- Triggers it via the GitHub Actions UI, or
- Types `! gh workflow run ...` at a Claude prompt — the leading
  `!` runs the command in the user's session, where this hook
  doesn't fire.

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
            "command": "node .claude/hooks/release-workflow-guard/index.mts"
          }
        ]
      }
    ]
  }
}
```

## Exit codes

- `0` — command is not a workflow dispatch; pass through.
- `2` — command is a workflow dispatch; block + write the reason to
  stderr.

## Sibling hooks

The "blocking, not priming" pattern is shared across three hooks:

- [`token-guard`](../token-guard/) — blocks Bash calls that would
  leak literal secrets to stdout.
- [`path-guard`](../path-guard/) — blocks Edit/Write calls that
  build inline multi-stage paths.
- `release-workflow-guard` (this one).

The other public-surface hooks ([`private-name-guard`](../private-name-guard/),
[`public-surface-reminder`](../public-surface-reminder/)) only
**prime** — they exit 0 after writing a reminder. The shared rule
for which side of the fence a hook lands on: block when the harm of
a wrong fire is irreversible; prime when it's recoverable.

## Cross-fleet sync

This README and the hook itself live in
[`socket-repo-template`](https://github.com/SocketDev/socket-repo-template/tree/main/template/.claude/hooks/release-workflow-guard)
and are required to be byte-identical across every fleet repo.
`scripts/sync-scaffolding.mts` flags drift; `--fix` rewrites it.
