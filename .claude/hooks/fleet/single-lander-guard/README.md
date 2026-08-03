# single-lander-guard

**Type:** PreToolUse guard (Bash) — BLOCKS (exit 2). Fleet-scoped convention.

**Rule:** one lander per repo. Blocks two shapes of destructive git op that
entangle a repo's live tree when more than one lander touches it at once.

- **(A) STALE-STASH.** A blind `git stash pop` / `git stash apply` — no explicit
  `stash@{N}` and no other `<stash>` argument — pops `stash@{0}`, which in a
  shared checkout may be ANOTHER session's stash, not yours. Blocked regardless
  of the index lock.
- **(B) CONCURRENT-LAND.** A destructive land op — `git merge`, `git rebase`,
  `git reset --hard`, `git cherry-pick`, or a `git stash pop` / `apply` — run
  while `<repo>/.git` holds an `index.lock`. The lock means another git process
  is mid-operation; piling on races the lock and can entangle the live tree.

**Why:** a background land-watcher armed to merge branches onto main the
instant the co-session primary goes clean can fire in the same window as a
MANUAL land. Both race on `.git/index.lock`: the manual `git stash push` fails
on the lock, but the script still runs a blind `git stash pop`, which pops
`stash@{0}` — a STALE co-session stash — into the live tree, leaving `UU`
conflict markers in workspace files. This guard makes both halves of that
impossible at the Bash layer, so NO path — script, loop, or manual — can
blind-pop or pile a destructive land onto a repo with an active git process.

**Pure decision:** `decideLandGuard(command, { indexLockPresent })` returns
`{ blocked, rule, op }`. It is exhaustively unit-tested without touching the
filesystem. The wrapper resolves the real repo dir from the command
(`extractGitCwd`) and stats `<repo>/.git/index.lock` — following a worktree's
`.git` file to its real gitdir — to supply `indexLockPresent`.

**Parsing:** AST-parsed via `commandsFor`, robust to leading env assignments,
`git -C <path>`, quoting, and `&&` / `;` chains — each git segment is judged.

**Does NOT fire when:**
- the context is CI — `CI` / `GITHUB_ACTIONS` / `CONTINUOUS_INTEGRATION` set. CI
  runs one job with no rival session, and a hung `index.lock` there is a crashed
  step to clear, not a live-tree race.
- the acted-on repo is not fleet-managed — `scope: 'convention'` stands the hook
  down in a foreign repo.
- a stash pop / apply carries an explicit ref (`stash@{N}`, a numeric index, or
  any positional `<stash>`) AND no `index.lock` is present.
- read-only git — `status` / `log` / `diff` / `show`.

**Stable code:** `ERR_FLEET_SINGLE_LANDER` in the block message.

**Bypass:** `Allow single-lander bypass` typed verbatim in a recent user turn.

**Fails open** on parse / payload errors (exit 0) — a guard bug must not wedge
every Bash call.
