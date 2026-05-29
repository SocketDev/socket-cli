# actionlint-on-workflow-edit

PostToolUse Edit/Write hook that runs local `actionlint` against any
`.github/workflows/*.y*ml` file after the edit. Reports any actionlint
errors via stderr; never blocks (the edit already landed).

## Why

GitHub Actions' YAML parser fails silently — a malformed workflow shows
"0 jobs" on the next push with no error in the UI. `actionlint` catches
the same YAML / shell / SHA-pin issues locally, instantly. The fleet
already has actionlint installed on dev machines (homebrew default
`/opt/homebrew/bin/actionlint`).

## What it covers

Any Edit/Write to a file matching `.github/workflows/*.y*ml`. Runs
`actionlint <file>`. If exit code is non-zero, surfaces stdout + stderr
to Claude via this hook's stderr. If `actionlint` isn't on PATH, no-op.

## Not a blocker

This hook is reporting-only. Blocking is covered by:

- `workflow-uses-comment-guard` (SHA-pin comment format)
- `workflow-yaml-multiline-body-guard` (multi-line `--body "..."`)
- `pull-request-target-guard` (privileged context misuse)

If a future block-worthy actionlint check is identified, promote it to
its own PreToolUse hook with a focused detection pattern.
