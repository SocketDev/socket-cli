# bump-defers-to-release-guard

PreToolUse Bash hook that blocks an agent-driven version bump. The version is
the user's decision: derived bumps are patch or minor with patch the default,
and MAJOR is never derived. The bump commit + CHANGELOG belong to the release
workflow/scripts.

## What it blocks

- `node <path>/bump.mts` without `--dry-run` (a write run).
- `npm|pnpm|yarn version <arg>` — a bare `npm version` only prints and passes.

## What it allows

- `bump.mts --dry-run` — the evidence-gathering step is always open.
- Any run after the user types `Allow release-bump bypass` (post
  version-naming). A major run (`--release-as major|premajor`, `npm version
  major`) additionally requires `Allow major-bump bypass`.

## CI

The hook never runs in CI. There, major happens only when a human manually
selects it on the release workflow's dispatch form; `bump.mts` itself refuses
to derive major from commit types.
