# workflow-uses-comment-guard

A **Claude Code PreToolUse hook** that blocks Edit/Write tool calls
which would land a `uses: <action>@<40-char-sha>` line in a GitHub
Actions workflow or local-action YAML without the canonical trailing
`# <tag-or-version-or-branch> (YYYY-MM-DD)` staleness comment.

## Why this rule

SHA-pinning makes `uses:` lines opaque — a reader can't tell at-a-glance
whether `27d5ce7f...` is `v5.0.5` from last week or `v3.2.1` from 2024.
The trailing comment is the cheapest staleness signal we have outside of
running a full drift audit. The date stamp matters as much as the
version label: a comment that says `# v6.4.0` could have been written
the day v6.4.0 shipped, or could be eighteen months stale — the date
disambiguates.

## Conventional shape

```yaml
- uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2 (2026-05-15)
- uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6.4.0 (2026-05-15)
- uses: SocketDev/socket-registry/.github/actions/setup-pnpm@c14cb59f... # main (2026-05-15)
- uses: actions/cache@27d5ce7f107fe9357f9df03efb73ab90386fccae # 27d5ce7f (2026-05-15)
```

The label is the upstream tag, branch name, or short-SHA; the date is
when you pinned / refreshed the SHA (today's date for new pins).

## What's enforced

- Every `uses: <action>@<sha>` line where `<sha>` is a 40-char hex
  digest must carry a trailing `# <label> (YYYY-MM-DD)` comment.
- The label is any non-paren text (`v1.0.0`, `main`, `27d5ce7f`).
- The date must match the ISO `YYYY-MM-DD` shape — no `2026/05/15` or
  `15 May 2026`.

## What's not enforced

- Local-action references (`uses: ./.github/actions/foo`) — they don't
  carry SHAs.
- Docker-image actions (`uses: docker://...`) — not SHA-pinned in the
  GitHub sense.
- The accuracy of the label or date — that's a human-review concern.

## Override marker

For a legitimate one-off:

```yaml
- uses: third-party/action@deadbeef... # socket-hook: allow uses-no-stamp
```

Don't reach for this — add the comment instead.

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
            "command": "node .claude/hooks/workflow-uses-comment-guard/index.mts"
          }
        ]
      }
    ]
  }
}
```

## Cross-fleet sync

This hook lives in
[`socket-wheelhouse`](https://github.com/SocketDev/socket-wheelhouse/tree/main/template/.claude/hooks/workflow-uses-comment-guard)
and is required to be byte-identical across every fleet repo.
`scripts/sync-scaffolding.mts` flags drift; `--fix` rewrites it.
