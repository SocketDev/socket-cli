# Local git config invariants

A fleet repo's local `.git/config` carries **per-clone** state. Identity, signing keys, and core invariants like `core.bare` live in the **global** git config (and in `~/.gitconfig`); the local config exists for per-repo overrides like `branch.<name>.remote` and `lfs.url`.

## What's banned

These keys must never appear in a fleet repo's local `.git/config`:

| Key               | Why it's banned                                                                                                                                                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core.bare`       | `bare = true` turns the work tree into a bare repo. Every `git status` / `git commit` / `git rev-parse --is-inside-work-tree` then fails with "must be run in a work tree". The repo becomes unusable until manually cleaned up. |
| `user.email`      | Overrides the global identity. Commits sign with the global GPG key but author with the local email — GitHub rejects the push for "Found N violations: <sha>" verified-signature check.                                          |
| `user.name`       | Same shape — the commit author won't match the global GitHub identity.                                                                                                                                                           |
| `user.signingkey` | Pinning a key locally drifts from the canonical global key. If the local key is wrong (or stale after rotation), every commit is unsigned to GitHub.                                                                             |
| `commit.gpgsign`  | Disabling signing locally bypasses the fleet rule. Pre-commit hook catches it for `main`/`master` but the local config has clobbered the global preference.                                                                      |

## How the guard fires

`PreToolUse(Bash + Edit/Write)` blocker triggered by either path:

1. **Bash** — `git config <key> <value>` (no `--global` / `--system` / `--worktree` qualifier) that touches a banned key:
   ```
   git config core.bare true
   git config user.email test@example.com
   git config commit.gpgsign false
   ```
2. **Edit / Write** — direct writes to `.git/config` (any path matching `**/.git/config`) where the new content contains one of the banned `[section] key = value` shapes.

`git config --global <key>` is **always allowed** — global config is the canonical home for identity / signing settings.

## Bypass

Single-use bypass for genuine operator scenarios (initial signing setup on a fresh checkout, signing-key rotation, manual cleanup after a `bare = true` incident):

```
Allow git-config-write bypass
```

Type the phrase verbatim in a recent user turn. The guard rescans on every Bash/Edit/Write call, so the bypass applies to exactly the next action that would have been blocked.

## SessionStart corruption probe

Same hook runs at SessionStart and walks fleet repos under `~/projects/` looking for already-corrupted state:

- `[core] bare = true` in any local `.git/config`
- `[user] email = test@*` or `email = *@example.com` (test-fixture leaks)
- `[user] name = Test User`
- Local `commit.gpgsign = false`

Findings are reported at SessionStart (informational, never blocks). `core.bare = true` is the one exception to "no auto-fix": it is unset automatically (`git config -f <path> --unset core.bare`) because it is always wrong for a non-bare fleet checkout and breaks every `git` command on that `.git/` for any session — there is no legitimate reason to keep it, so restoring it needs no human judgment. The identity/signing findings (test-fixture email, `Test User`, `commit.gpgsign = false`) stay operator-driven: edit `.git/config` manually, or `git config --unset <key>` per finding.

## Why this exists

**2026-06-02**: A fleet repo's `.git/config` was found with `bare = true` + `user.email = test@example.com` from a prior session. Every git command failed with "must be run in a work tree" for 3+ turns until the user manually edited the config back. Root cause traced to a test fixture or sibling-session leak that ran `git init --bare` or similar inside the working tree.

The blast radius is high: a single bad config write knocks out an entire repo for the rest of the session.

## Preventing the leak at the source

The SessionStart auto-unset is a backstop. The leak is prevented at the source by neutralizing the inherited git env in tests, so a fixture's `git init` / `git config` can never escape. The single source of truth is `.git-hooks/_shared/isolate-git-env.mts`:

- vitest loads it via `test/scripts/fleet/setup.mts`, calling `isolateGitEnv({ pinConfigToNull: true })` (strip discovery vars + pin the config files).
- `node --test` git-fixture suites do NOT load the vitest setup, so each side-effect imports the module at the top: `import '<…>/.git-hooks/_shared/isolate-git-env.mts'`. The default strips the `GIT_*` discovery vars (which is what stops the escape), leaving each fixture free to scope its own `GIT_CONFIG_GLOBAL` per-spawn (the signing-gate tests need that).

`no-unisolated-git-fixture-guard` blocks authoring a git-fixture test without that import (or an equivalent scrub).

## Self-referential symlinks

A related fleet-breaker: a `node_modules` symlink whose target is the repo's own absolute path (a self-loop) committed via a cascade's broad `git add`. git keeps it tracked despite `.gitignore`, and every fresh clone then aborts `pnpm install` with `ELOOP: too many symbolic links`. The `tracked-symlinks-are-safe` check (in `check --all`) reads each tracked symlink's git-object target and fails on a self-referential link, an absolute target inside the repo, or any tracked `node_modules`. A symlink that must be tracked has to be relative and point outside its own subtree.

## Companion rules

- [`docs/agents.md/fleet/commit-signing.md`](commit-signing.md) — the signing topology this guards
- [`docs/agents.md/fleet/parallel-claude-sessions.md`](parallel-claude-sessions.md) — broader parallel-agent hygiene
- `.claude/hooks/fleet/no-revert-guard/` — bypass-phrase pattern this hook reuses
  </content>
