# marketplace-comment-guard

A **Claude Code PreToolUse hook** that blocks Edit/Write tool calls
which would land a `.claude-plugin/marketplace.json` or sibling
`.claude-plugin/README.md` in an inconsistent state — every plugin
pinned in marketplace.json must have a row in the README's pin table
with matching `version` (= `source.ref`), matching `sha`, and an
ISO-8601 `date`.

## Why this rule

JSON has no comments, so marketplace.json can't carry the human-readable
pin metadata (pin date, pinner, free-form notes) that the GHA `uses:`
SHA-pin convention puts inline. The fleet handles this by putting the
machine-readable pin in `marketplace.json` and the human metadata in a
sibling README, then enforcing consistency at edit time.

Without the guard the two surfaces drift: someone bumps `sha` in JSON
but forgets the README, or the README's `date` rots while pretending
the pin is fresh. Same failure mode the workflow `uses:` rule guards
against — opaque pins look fine and stay broken for months.

## Conventional shape

```jsonc
// .claude-plugin/marketplace.json
{
  "plugins": [
    {
      "name": "codex",
      "source": {
        "source": "git-subdir",
        "url": "https://github.com/openai/codex-plugin-cc.git",
        "ref": "v1.0.1",
        "sha": "9cb4fe4099195b2587c402117a3efce6ab5aac78"
      }
    }
  ]
}
```

```markdown
<!-- .claude-plugin/README.md -->
| plugin | version | sha                                      | date       | notes                            |
|--------|---------|------------------------------------------|------------|----------------------------------|
| codex  | v1.0.1  | 9cb4fe4099195b2587c402117a3efce6ab5aac78 | 2026-05-18 | upstream openai/codex-plugin-cc  |
```

The first four columns are required and inspected. Any trailing column
(e.g. free-form `notes`) is accepted but not validated. `git blame` is the
authoritative record of *who* bumped a pin, so a `by` column is deliberately
absent — duplicating personal identifiers into fleet-canonical files is a
public-surface-hygiene mistake.

## What's enforced

- Every `plugins[].source.sha` in marketplace.json has a row in the
  README table keyed by plugin name.
- The row's `version` cell matches `source.ref`.
- The row's `sha` cell matches `source.sha`.
- The row's `date` cell matches ISO-8601 `YYYY-MM-DD`.
- Either file edited without the sibling existing blocks — the pair
  must be created and maintained together.

## What's not enforced

- The accuracy of `date` — that's a human-review concern (same as the
  GHA `uses:` rule).
- Any trailing `notes` column — free-form metadata.
- Source types other than `git-subdir` carrying a `ref` field — if you
  add a new source type that doesn't have `ref`, the guard skips that
  entry rather than blocking. Add explicit support if the new type
  warrants it.

## Wiring

In `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "node .claude/hooks/marketplace-comment-guard/index.mts"
          }
        ]
      }
    ]
  }
}
```

## Cross-fleet sync

This hook lives in
[`socket-wheelhouse`](https://github.com/SocketDev/socket-wheelhouse/tree/main/template/.claude/hooks/marketplace-comment-guard)
and is required to be byte-identical across every fleet repo.
`scripts/sync-scaffolding.mts` flags drift; `--fix` rewrites it.
