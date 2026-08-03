# no-verify-format-nudge

PreToolUse Bash hook, non-blocking. When a `git commit` / `git push --no-verify` is about to run, it runs `oxfmt --check` on the changed format-relevant files and warns about any that are unformatted.

## Why

`--no-verify` skips the **whole** pre-commit / pre-push chain, including the oxfmt **format** gate, not only the test/lint steps. The usual reason to reach for `--no-verify` is a hanging pre-commit — a slow staged-test reminder or a wedged install — but the side effect is that unformatted files ship and then fail CI's format check.

This hook closes that gap: at the moment the bypassing command is detected, it checks the files that are about to land and names the ones that need formatting, so the debt gets fixed (`oxfmt` + amend) before it reaches CI.

It complements `pre-commit-race-nudge` (which steers away from `--no-verify` when the failure is an index race); this one covers the skipped format gate.

## What it does

Fires on a Bash `git commit` / `git push` carrying `--no-verify` / `-n`. Stays quiet for `FLEET_SYNC=1` cascade commits (the documented `--no-verify` exception). Collects the changed `.{c,m}?[jt]sx?` files (staged + unstaged), runs `oxfmt -c .config/fleet/oxfmtrc.json --check` on each, and writes a stderr reminder listing the unformatted ones plus the fix:

```
node_modules/.bin/oxfmt -c .config/fleet/oxfmtrc.json <files>
git add <files> && git commit --amend --no-edit --no-verify
```

Always exits 0 — a reminder, never a block. `--no-verify` is legitimate and is already gated behind the `Allow no-verify bypass` phrase by `no-revert-guard`.

## Failing open

Any error (not a git repo, no `oxfmt` binary, spawn failure) exits 0 with no output. A reminder must never block a commit on its own bug.

## Related

- `pre-commit-race-nudge` — the index-race sibling reminder on `--no-verify`.
- `no-revert-guard` — gates `--no-verify` behind the `Allow no-verify bypass` phrase.
- CLAUDE.md → "Hook bypasses require the canonical phrase".
