# no-unisolated-git-fixture-guard

PreToolUse hook that blocks Write/Edit on a test file which spawns `git` against a temp-dir fixture without isolating the inherited git environment.

When such a suite runs inside the pre-commit hook, git exports `GIT_DIR` / `GIT_WORK_TREE` / `GIT_INDEX_FILE` pointing at the live repo, and git honors those over cwd-based discovery. The fixture's `git config` / `git init` / `git commit` then escape onto the real `.git/config` and HEAD — observed damage: `user.email=test@example.com` (junk-authored commits), `core.bare=true` (breaks every worktree op), and junk commits stacked on the working branch.

## Fires when

A test file (`*.test.*` / `*.spec.*` / under `test/`) that BOTH:

- spawns git: `spawnSync('git', …)`, `spawn('git', …)`, `execFileSync('git', …)`, and
- builds a temp-dir fixture: `mkdtemp`/`tmpdir()` plus a `git init`.

## Allowed (isolation present)

- pins `GIT_CONFIG_GLOBAL` (and/or `GIT_CONFIG_SYSTEM`), or
- strips the inherited context (`delete process.env['GIT_DIR']`, a `LEAKY_GIT_VARS` scrub list).

A test that runs git against the real repo for read-only introspection (no temp fixture) is out of scope.

## Fix

Isolate every git spawn — strip the repo-pointing vars and pin the config files:

```js
for (const v of ['GIT_DIR','GIT_WORK_TREE','GIT_INDEX_FILE','GIT_COMMON_DIR',
  'GIT_OBJECT_DIRECTORY','GIT_PREFIX','GIT_CEILING_DIRECTORIES','GIT_NAMESPACE',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES']) delete process.env[v]
process.env.GIT_CONFIG_GLOBAL = '/dev/null'
process.env.GIT_CONFIG_SYSTEM = '/dev/null'
```

## Bypass

`Allow unisolated-git-fixture bypass` typed verbatim in a recent user turn.
