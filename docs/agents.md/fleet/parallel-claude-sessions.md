# Parallel Claude sessions

Companion to the `### Parallel Claude sessions` rule in `template/CLAUDE.md`. The inline section gives the headline plus the worktree recipe. This file holds the full prohibition list, the worktree recipe broken down, and the umbrella rule.

## The problem

A single socket-\* checkout often has multiple Claude sessions running concurrently: parallel agents, parallel terminals, or git worktrees mapped onto the same `.git/`. Your session is not the only writer. Several common git operations assume otherwise.

But the failure that recurs is the opposite one: attributing your OWN earlier work to a phantom parallel session. Recall resets across context compaction, and every fleet commit shares one git identity, so a recent commit or dirty path you don't remember creating reads as another agent's. You then pause, defer, or investigate instead of proceeding. Default the other way: unfamiliar recent commits and dirty paths by your own git identity are your own earlier work. Landing to local main is the shared goal, so aligned concurrent work (yours, an auto-lander's, or another session heading the same way) is collaboration toward it. Verify with the own-work check below before concluding a parallel session is at play. Reserve the prohibitions in this file for a genuine live conflict: a file mutating between two of your own reads this turn.

## Forbidden in the primary checkout

These commands mutate state that belongs to other sessions:

- **`git stash`**. The stash is a shared store. Another session can `git stash pop` yours.
- **`git add -A` / `git add .`**. Sweeps in files that belong to another session's in-progress work. The `overeager-staging-guard` hook blocks these in real time (bypass: `Allow add-all bypass`).
- **`git checkout <branch>` / `git switch <branch>`**. Yanks the working tree out from under another session editing a file on the current branch.
- **`git reset --hard` against a non-HEAD ref**. Discards another session's commits.
- **bare `git commit` (no pathspec) when the index holds files you didn't touch**. A bare commit commits the ENTIRE index, so another session's staged work lands under your authorship. The `overeager-staging-guard` hook blocks this and steers to `git commit -o <your-files>` (bypass: `Allow index-sweep bypass`).

If a hook flags one of these, the hook is doing its job. Don't bypass.

## Required for branch work: spawn a worktree

```bash
BASE=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null \
       | sed 's@^refs/remotes/origin/@@' || echo main)
git worktree add -b <task-branch> ../<repo>-<task> "$BASE"
cd ../<repo>-<task>
# edit / commit / push from here; primary checkout is untouched
git worktree remove ../<repo>-<task>
```

The `BASE` lookup resolves the remote's default branch. Usually `main`, but legacy repos still use `master`. Never hard-code one; see [Default branch fallback](../../../CLAUDE.md#default-branch-fallback).

After `git worktree remove`, the branch lives in the primary repo's `.git/refs/heads/`. Push it from there if you still need it.

## Required for staging AND commits: surgical, smallest explicit set

Parallel-session-cautious is the **default**, not a special mode. Tread, touch, and commit only the smallest set needed:

1. **Stage surgically.** `git add <specific-file>`. Never `-A` / `.` — that sweeps another session's unstaged edits into your index. The `overeager-staging-guard` hook blocks broad adds at edit time.
2. **Commit surgically.** `git commit -o <your-file> [<your-file> …]` (or `git commit … -- <paths>`). The `-o` / pathspec form commits **only** the named paths regardless of what else is staged — so even if a parallel session staged files into the shared index, they can't ride into your commit. A bare `git commit` whose index holds files this session didn't touch is **blocked** (steered to `-o`); bypass `Allow index-sweep bypass` only when you genuinely mean to commit the whole index.

Both halves matter: surgical `git add` keeps your index clean, surgical `git commit -o` is the backstop for when the index is already polluted (another agent staged concurrently, a hook auto-staged, a prior sweep). Under heavy contention the index is rarely yours alone — naming paths at commit time is the only reliable isolation.

The wheelhouse cascade is the documented exception: it commits the whole index in a fresh worktree off `origin/main`, opted in via the `FLEET_SYNC=1` sentinel.

## Squash-history repos coordinate on paths, not commits

A repo opted into `squash-history` discards intermediate commit boundaries at
the final collapse. Never wait for another session to commit when its dirty
paths are disjoint from yours. Continue immediately, edit only your paths, and
commit them with an explicit pathspec. Pause only when the same path changes
between your reads or when starting the final repo-wide squash/push. The
`parallel-agent-on-stop-nudge` reads the fleet roster and reinforces this rule
in squash-opted repos.

## Whose work is this? Own-work-first check

`git status` or `git log` shows unfamiliar changes? Before treating them as another session's, run the own-work check:

```bash
node scripts/fleet/whose-work.mts
```

It lists local-ahead commits (unpushed work toward local main) and classifies them by git identity. Commits by your own identity are your own earlier work: land them, don't investigate. In descending order of likelihood, unfamiliar changes are:

1. **Your own earlier work** you no longer recall, because compaction reset your memory. This is the common case on a single-user checkout.
2. A hook side-effect (formatter, linter, sync-scaffolding).
3. An auto-lander grouping the dirty tree into logical commits (see [Auto-landed commits are expected](#auto-landed-commits-are-expected)).
4. An upstream pull that is still settling.
5. A genuine concurrent session. This one holds only when a file mutates between two of your own reads *this turn*.

Whatever the source, `git checkout -- <file>` / `git reset --hard` against work you did not author destroys it. Leave it, or land it.

## Auto-landed commits are expected

Every session runs the same hooks, and the fleet biases toward landing to local main often. So a commit can appear that you did not personally issue: an auto-lander (or an aligned session) grouped the dirty tree into a logical commit and landed it. That is the system working. Do not spend cycles reverse-engineering why a commit exists that you don't remember making. Run `whose-work` if you need to confirm it is local plus your identity, then keep going. Landing is recoverable (a local commit can be amended or reset to `HEAD~`); a phantom-collision stall is wasted work.

## Never reach into a sibling fleet repo's path

Cross-repo imports go through `@socketsecurity/lib/...` and `@socketregistry/...` (workspace exports). Path-based imports (`../<sibling-repo>/...`) break in CI, in fresh clones, and on CI agents without the sibling checked out. The `cross-repo-guard` hook blocks these at edit time.

## Active-edits ledger — coordinating concurrent actors

The ledger is a per-actor JSON file under `node_modules/.cache/socket-active-edits/<actorId>.json` (dep-0, never tracked). Actor ID = `sha256(transcript_path).slice(0,16)` — the transcript path discriminates actors because each subagent / workflow-agent gets its own JSONL while the main session has a different one.

Three hooks build on it:

- **`active-edits-ledger`** (PostToolUse, Edit|Write|NotebookEdit): records the written path into the current actor's ledger file. Never blocks; exit 0 on every code path.
- **`live-edit-collision-guard`** (PreToolUse, Edit|Write|NotebookEdit): blocks when the target path appears in a DIFFERENT live actor's ledger with a write within the 5-minute collision window. The block message names the other actor, states the seconds since its last write, and lists the three sanctioned moves below.
- **`dirty-worktree-stop-guard`** (Stop): paths owned by a live foreign actor are SANCTIONED — listed separately and excluded from the blocking set (slice 3). If every dirty path is sanctioned, the guard exits clean.

### Stop-edit-resume protocol

When `live-edit-collision-guard` fires, the three moves in priority order:

1. **Stop the other run.** Use `TaskStop` on the blocking actor. Once it lands its changes, resume your edit.
2. **Queue the edit.** Work on a different file now; revisit this one after the other run completes. The completion notification re-invokes your session — no open-ended "I'll wait and monitor" promise needed.
3. **Bypass.** If the other run is already finished or abandoned and the ledger is stale, the user types `Allow live-edit-collision bypass` verbatim.

The excuse-detector (slice 4) gates on ledger presence: when a live foreign actor exists, open-ended wait promises ("I'll watch to completion", "wait and see", "land whatever it leaves") are converted into a protocol reminder — converge now, arm a Monitor, or hand off via a `.claude/plans/` doc.

## Never overwrite a file another session is editing

A plain `Edit` / `Write` to a file another session has dirty silently clobbers their uncommitted work — and they may clobber yours right back, edit-for-edit, until one of you stops. (When two sessions share one checkout and both keep re-writing the same source + test files, each pass reverts the other's fixes and neither change ever lands.) The `parallel-agent-edit-guard` hook blocks an Edit/Write/NotebookEdit whose target is **foreign** — dirty, not authored by this session, changed within 30 min — so the clobber is refused before it lands. Companion to `parallel-agent-staging-guard` (git-op version) + `parallel-agent-on-stop-nudge` (turn-end signal); all share `_shared/foreign-paths.mts`. When it fires: let the other session commit first, work on a different file, or use a `git worktree` for an isolated edit. Bypass (only if the other edit is abandoned): `Allow parallel-agent-edit bypass`.

## The umbrella rule

> Never run a git command that mutates state belonging to a path other than the file you just edited.

Stash, add-all, checkout-branch, reset-hard, and revert-other-session's-file are the common shapes. The rule is general. If you can't explain why the command only affects files your session owns, don't run it.

## Pre-commit index races — retry, don't `--no-verify`

When two sessions share one `.git/`, a `git commit` can fail in pre-commit because the *other* session's git op holds the index lock or left a half-written object. The signatures:

- `Unable to create '.git/index.lock': File exists` / `another git process seems to be running`
- `error: bad object` / `fatal: unable to read tree`
- `fatal: cannot lock ref` / `unable to write new index file`

This is **not** a failure in your change — it's contention on the shared `.git/`. When another session's pre-commit holds the index lock on a half-written object, your commit fails reproducibly even though your tree is clean. The wrong reflex is `git commit --no-verify`: it skips the **entire** validation chain (format, lint, tests, signing), so a real defect in your own change ships unseen too.

The right recovery, in order:

1. **Retry.** The lock clears the moment the other session's git op finishes. A second attempt usually succeeds.
2. **Commit from an isolated index** so the two sessions don't share the staging area:

   ```bash
   TMP_IDX=$(mktemp)
   GIT_INDEX_FILE="$TMP_IDX" git add -- path/to/your/file
   GIT_INDEX_FILE="$TMP_IDX" git commit -o path/to/your/file -m "type(scope): …"
   rm -f "$TMP_IDX"
   ```

3. **Only then**, if pre-commit is genuinely broken (not racing) AND you've verified the tree green independently (`git write-tree` clean, tests pass, oxfmt clean), `--no-verify` is the last resort — and it still needs the `Allow no-verify bypass` phrase.

Nudged by `.claude/hooks/fleet/pre-commit-race-nudge/` on any `git commit --no-verify` (cascade `FLEET_SYNC=1` commits exempt).

## origin/main is never authoritative over local main

The flow is one-directional: local `main`, then push, then origin. Local main is
the source of truth; origin is where landed work is published. So `origin/main`
being ahead of (or diverged from) local main is almost never a reason to touch
local main.

**The banned reflex.** Seeing `origin/main` ahead and concluding "origin is
ahead, I'll sync / reset / revert / drop local to match it" is wrong. The
capitulation that follows is the exact failure this rule exists to stop:

> "I won't touch local main… dropping it entirely… local main stays as it is,
> I'll leave origin alone since it's being squashed."

It treats a routine consolidation as a divergence to surrender to, and it either
strands local work or invites a lossy reset.

**Why origin looks ahead.** Some fleet repos squash or consolidate the default
branch on a cadence (`squashing-history`), and the cascade bot plus
`auto-land-on-stop` also land commits. So origin "ahead" is normally a squash or
consolidation of your OWN (or a bot's) commits: the same work, re-shaped.
Classify before reasoning with `node scripts/fleet/whose-work.mts`, and read the
commit timestamps (a newer origin commit that consolidates your older locals is
a squash, not a rival's landing).

**Reconcile FORWARD, never rewind:**

- **Origin is a 1-commit squash of your local set:** `git commit --amend` your
  local tip onto it (or re-apply), keeping local canonical.
- **Otherwise:** lease-force-push local over origin (`--force-with-lease`, behind
  the `no-force-push-guard` phrase). Local main wins because it holds the real
  work.
- **NEVER** `git reset --hard origin/main`, `git checkout origin/main -- .`, or
  "revert local to origin". `no-revert-guard` blocks it, and it discards unpushed
  local commits.

**When it IS a real divergence.** If the origin-ahead commits are by a real
other user (not the current git identity, not a bot such as `*[bot]`,
`github-actions`, or `dependabot`), that is genuine divergence. Coordinate (a
`managing-worktrees land`), do NOT force-push over them, and do NOT warn about
"origin ahead" as if it were the squash case. `whose-work` makes the
own-vs-bot-vs-other call.

**Every reset stays additive / recoverable.** A reset must never lose code from
local main or the current state. Before any reset, make it reversible: tag or
branch the pre-reset HEAD (`git tag backup/pre-reset-<date> HEAD`) so the work is
re-addable, or rely on the reflog. `git stash` is banned (the stash store is
shared across sessions, so another agent can pop or drop yours), so it is NOT the
recovery mechanism; a backup ref is. `no-revert-guard` blocks a bare
primary-checkout reset for exactly this reason.

Enforced by `no-revert-guard` (blocks the rewind), `no-force-push-guard` (gates
the forward reconcile), and `whose-work` (classifies author). A dedicated
origin-ahead Stop nudge is tracked to surface this proactively.

## Codex companions are quick checks, not long sessions

A Codex companion session (identified by a FOREIGN
`CODEX_COMPANION_SESSION_ID` — one that does not appear in the session's own
transcript path; the codex plugin exports every session's OWN id, which marks
nothing) exists for a quick second opinion — a diagnosis pass, a small
verification. It is NOT a peer long-running session: a runaway multi-hour
companion once looped `land-work.mts`/`cover.mts` for 8+ hours, monopolizing the
shared checkout's test gate and index while mis-attributing its dirty files to
the primary session.

`codex-session-budget-guard` (PreToolUse) enforces this: the companion's first
tool call stamps a start marker under
`node_modules/.cache/socket-codex-session/`, and once the 1-minute wall-clock
budget is spent every further tool call blocks with a hand-off message. Sustained
work belongs in a full Claude session. The user lifts it for one session by
typing `Allow codex-long-session bypass`.
