# commit-author-guard

PreToolUse hook that blocks a `git commit` tool call whose effective author is a denied placeholder identity, or (when an allowlist is configured) not on it.

## Why

A commit can land with the wrong identity. One case is a placeholder/sandbox identity like `Test <test@example.com>` from a fresh worktree or test harness. Another is a real-but-wrong email, such as a work email when the repo expects the personal one. The wrong identity misattributes `git log` and GitHub history, can break signed-commit verification, and (for placeholder identities) is the fingerprint of a corrupted-replay commit. This hook catches it before the commit lands.

## What it catches

1. **`--author=` override**: `git commit --author="Test <test@example.com>" -m "..."`
2. **`-c user.email=` override**: `git commit -c user.email=test@example.com -m "..."`
3. **Wrong local checkout config**: a plain `git commit` inheriting a placeholder or off-allowlist `user.email`.

## Identity policy (cascaded, wheelhouse-scoped)

The policy is read by the shared `.git-hooks/_shared/git-identity.mts` from a cascaded config. That is the same source the `commit-msg` git-stage backstop uses, so the two never diverge. Resolution is repo-scoped only, with no machine-local `~/` fallback by design:

- `.config/repo/git-authors.json` for a per-repo override (optional).
- `.config/fleet/git-authors.json` for the cascaded fleet default.

```json
{
  "denylist": {
    "emails": ["*@example.com", "you@localhost"],
    "names": ["Test", "User"]
  },
  "canonical": { "name": "...", "email": "..." },
  "aliases": [{ "name": "...", "email": "..." }]
}
```

- **denylist** (universal, shipped by the fleet config): placeholder/sandbox identities never valid anywhere. A denylist hit is always blocked. `emails` entries may use a leading `*@domain` whole-domain wildcard.
- **canonical / aliases** (allowlist): whose real email is OK. This is per-repo and is not hardcoded in the cascaded fleet default, since other contributors exist. An allowlist-miss blocks only when an allowlist is present. A denylist-only repo blocks the placeholder identities and nothing more.

## Two surfaces (defense in depth)

This guard covers Claude `git commit` tool calls. A subprocess, fresh worktree, CI, or test-harness commit never routes through the tool layer. Those are caught by the `commit-msg` git-stage backstop (`.git-hooks/fleet/commit-msg.mts`), which reads the same policy and checks the author and committer git would stamp.

## Bypass

- Add the email to `canonical`/`aliases[]` in `.config/repo/git-authors.json` (persistent, per-repo), or
- Type `Allow commit-author bypass` (or `Allow commit author bypass` / `Allow commitauthor bypass`) in a recent user message (one-shot).

## Test

```sh
pnpm test
```
