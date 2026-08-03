# readme-fleet-shape-guard

PreToolUse Edit/Write hook that blocks edits to the **root `README.md`** when the resulting content violates the canonical fleet skeleton.

## Why

Root READMEs across fleet repos drift in four predictable ways: (a) the canonical 5-section structure gets reordered or partially missing, (b) `socket-wheelhouse` (a private repo) leaks into prose or links, (c) commands invoke sibling-repo relative paths (`node ../socket-foo/scripts/...`) that outside readers can't follow, (d) the canonical social-follow badges (X / Twitter + Bluesky) go missing. All four are public-facing failure modes.

The fleet has matching surfaces at three layers:

- **Lint-time** — `template/.config/fleet/markdownlint-rules/socket-{readme-required-sections, readme-social-badges, no-private-wheelhouse-leak, no-relative-sibling-script}.mts`.
- **Sync-time** — `scripts/sync-scaffolding/checks/readme-skeleton-drift.mts` (report-only; no autofix because README content is contextual).
- **Edit-time** — this hook. Fires at the earliest surface, before the drift can be committed or pushed.

## How

On `Edit` / `MultiEdit` / `Write` whose `file_path` resolves to the repo-root `README.md`, the hook:

1. Reconstructs the post-edit text (Write → `content`; Edit → splice `old_string` → `new_string` against the on-disk file).
2. Runs four checks: section list (5 required, in order); `socket-wheelhouse` mention (outside fenced code blocks); sibling-repo relative path patterns; canonical social-follow badge presence (X / Twitter + Bluesky).
3. If any check fires AND the user hasn't typed the bypass phrase, exits 2 with a stderr explaining which rule was hit, the canonical fix, and the bypass instructions.

Nested READMEs (`packages/*/README.md`, `docs/*/README.md`, etc.) are silently ignored — they're scoped docs with their own shape.

## Bypass

User types **`Allow readme-fleet-shape bypass`** verbatim in a recent message (within the last 8 user turns). Case-sensitive; paraphrases don't count.

## Failing open

The hook fails open on its own bugs (exit 0 + stderr log) so a buggy hook can't brick the session. The trade-off: a bug means the check silently doesn't apply for that edit. The sync-time check and the lint-time check still catch the drift later.

## Related

- `.claude/hooks/fleet/no-meta-comments-guard/` — structural template; same `_shared/transcript.mts` bypass pattern.
- `.claude/hooks/fleet/plan-location-guard/` — same PreToolUse + bypass shape, blocking on file-path classification.
