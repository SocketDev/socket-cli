# gitmodules-comment-guard

A **Claude Code PreToolUse hook** that blocks Edit/Write tool calls
which would land a `[submodule "..."]` section in `.gitmodules`
without the canonical `# <slug>-<version>` comment immediately above
it.

## Why this rule

The Socket fleet's lockstep harness uses the `# slug-version` annotation
to surface upstream version drift in its update reports. Without it,
`pnpm run lockstep` can't tell whether a submodule pin reflects v1.0 or
v3.5 of the upstream — the report is meaningless. Adding the comment
costs one line; missing it silently breaks the drift surface.

## Conventional shape

```gitmodules
# semver-7.7.4
[submodule "packages/node-smol-builder/upstream/semver"]
	path = packages/node-smol-builder/upstream/semver
	url = https://github.com/npm/node-semver.git
	ignore = dirty
```

The slug is short (no path); the version is whatever upstream tags
(`v25.9.0`, `1.7.19`, `liburing-2.14`, `epochs/three_hourly/2026-02-24_21H`).

## What's enforced

- Every `[submodule "PATH"]` line must be preceded *immediately* (no
  blank line) by `# <slug>-<version>`.
- The slug pattern is permissive: `[a-z0-9]([a-z0-9-]*[a-z0-9])?`.
- The version is anything non-whitespace after the first hyphen.

## What's not enforced

- `ignore = dirty` — conventional but not blocked here. (It's a
  parallel-Claude-sessions concern, not a build break.)
- Repository URL format / branch — those don't affect lockstep.

## Override marker

For a legitimate one-off where the comment doesn't apply:

```gitmodules
[submodule "..."] # socket-hook: allow gitmodules-no-comment
```

Don't reach for this — fix the comment instead.

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
            "command": "node .claude/hooks/gitmodules-comment-guard/index.mts"
          }
        ]
      }
    ]
  }
}
```

## Cross-fleet sync

This hook lives in
[`socket-wheelhouse`](https://github.com/SocketDev/socket-wheelhouse/tree/main/template/.claude/hooks/gitmodules-comment-guard)
and is required to be byte-identical across every fleet repo.
`scripts/sync-scaffolding.mts` flags drift; `--fix` rewrites it.
