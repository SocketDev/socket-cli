# History rewrites: attribution stripping + on-lineage bases

Two rules for any operation that rewrites committed history (consolidate,
squash, reword, lease-force reconcile).

## Commits are ephemeral on a squash-enabled repo

A repo that carries the `squashing-history` skill collapses its default branch
to a single `chore: initial commit` on a cadence — the squash preserves the
**tree**, not the **log**. So on such a repo, individual commit granularity and
message polish are throwaway: they exist only until the next squash.

Once the member has cut a real published release, that "collapses to one
commit" claim narrows: every commit through the newest published-release
commit FREEZES (byte-identical forever — see
[`squash-until-release`](squash-until-release.md)), and only the tail above it
is still throwaway in the sense below. The opt-in stays; a released repo does
not drop back to ordinary permanent-history rules.

<details>
<summary><b>The relaxed cadence, rule by rule</b> — commit hygiene, messy commits, what still matters, how to identify a squash repo, which staging guards stand down, which destructive ops stay gated, pushing to origin main</summary>

- **Don't over-invest in commit hygiene.** Skip the surgical one-commit-per-fix
  splitting, the carefully-worded Conventional-Commits bodies, and the
  logical-grouping agonizing. Land fast with a plain, reasonable message and
  move on — the message is gone at the next flatten.
- **A messy or imperfect commit is not worth a cleanup pass.** A stray rebuilt
  artifact, a bundled-together set of changes, a terse subject — none survive
  the squash, so don't spend a revert-bypass or a re-commit dance fixing them.
  Land it; the flatten cleans the log.
- **What still matters:** the working TREE must be correct (the squash keeps
  it), and no AI attribution / secrets / private names ever land (those persist
  in the tree and on every public surface regardless of squashing).
- **Identify a squash repo:** it ships `.claude/skills/fleet/squashing-history/`
  (or `refreshing-history`), and is listed with `optIns: ['squash-history']` in
  the cascade roster (`.claude/skills/fleet/cascading-fleet/lib/fleet-repos.json`), which is the signal
  the guards key off via `isSquashOptIn()` in `.claude/hooks/fleet/_shared/fleet-roster.mts`.
  Non-squash repos keep their real log, where commit hygiene is permanent and
  worth the care. `.claude/hooks/fleet/squash-history-nudge/` reminds a session
  working in a squash-opted repo of this relaxed cadence; `parallel-agent-on-stop-nudge`
  reads the same roster to reinforce the path-coordination rule below in those
  repos specifically.
- **The staging/commit guards relax here.** Because commit order and granularity
  are meaningless before a flatten, the NON-destructive staging guards stand down
  in a squash-opt-in repo. `overeager-staging-guard` allows a broad `git add -A`
  and a bare `git commit` sweep, and `parallel-agent-staging-guard` allows those
  same sweeps even over a parallel actor's dirty paths (the work LANDS, then the
  flatten collapses it, so nothing is lost). This is the "merge merge merge" flow.
- **Destructive ops stay gated even here.** `git stash`, `git reset --hard`,
  `git restore`, and `git checkout <branch>` destroy or hide uncommitted work,
  and a squash rewrites commits without un-destroying a working tree. Those remain
  blocked by `parallel-agent-staging-guard`; use `git commit -o` or land, not a
  sweep-and-discard.
- **Pushing to origin main:** flatten local to one commit (the `squashing-history`
  skill or `SQUASH_HISTORY=1`), then `git push --force-with-lease`. Local main is
  canonical; origin carries the pre-squash history, and a diverged or orphan origin
  is the EXPECTED state, reconciled forward by the force-push, never a reset of
  local to origin. A released member's tail squash is still a non-fast-forward
  rewrite of the SAME shape — the force-push cost below is unchanged; freezing
  the release commit changes WHAT gets rewritten, not whether a rewrite needs
  the ruleset exemption dance.

</details>

## The server-side ref-protection block, and its temporary exemption

Clearing the local guards leaves a second wall. Every fleet repo carries two
repo-level protection rulesets, each created and converged by the one check
script that owns its shape:

<details>
<summary><b>Detail</b> — the full list (8 entries)</summary>

- `fleet-main-protection`, from
  `scripts/fleet/check/main-branch-rules-are-enforced.mts`: target `branch`,
  `~DEFAULT_BRANCH`, rules `deletion` + `non_fast_forward`.
- `fleet-tag-protection`, from
  `scripts/fleet/check/release-tags-are-immutable.mts`: target `tag`,
  `refs/tags/v*`, rules `deletion` + `non_fast_forward`.

Both carry **zero bypass actors**, so GitHub rejects a force-push to the default
branch and a delete of any `v*` tag even after `no-force-push-guard` has stood
aside. `current_user_can_bypass` reads `never` for a repo admin too. A
squash-history flatten, a lease-force reconcile, and an amend-and-push hit the
branch ruleset; deleting a loose alias tag such as `v1` hits the tag ruleset.
Deleting that alias is the sanctioned remedy for a floating tag, because a
mutable `v*` ref lets the bytes behind a consumer's pin change underneath them.

The exemption is a temporary self-grant, and it runs through one script:

```bash
# Who can bypass the branch ruleset right now? (read-only, the default)
node scripts/fleet/grant-ruleset-bypass.mts <repo>

# Exempt yourself, push, then hand the exemption back.
node scripts/fleet/grant-ruleset-bypass.mts <repo> --grant --yes
node scripts/fleet/grant-ruleset-bypass.mts <repo> --revoke

# The same three moves against the tag ruleset, to delete a v1 alias tag.
node scripts/fleet/grant-ruleset-bypass.mts <repo> --tags
node scripts/fleet/grant-ruleset-bypass.mts <repo> --grant --yes --tags
node scripts/fleet/grant-ruleset-bypass.mts <repo> --revoke --tags
```

- **The ruleset is a flag, and the default never moved.** No flag, or the
  explicit `--branch`, selects `fleet-main-protection`; `--tags` selects
  `fleet-tag-protection`. Both identities come from
  `scripts/fleet/_shared/managed-ruleset-identity.mts`, which reads each
  ruleset's name, target, ref includes, and owning `--fix` command off the check
  script that owns it. A third managed ruleset is one more table entry.
- **Never hand-run `gh api` against a ruleset.** A hand-written full body
  silently rewrites whatever it omits — that is how a PUT meant to add one
  bypass actor drops `non_fast_forward` for everyone. The script reads the
  ruleset, replaces only `bypass_actors`, writes it back, then re-reads and
  fails loud if any rule type disappeared.
- **The grant expires on the next `--fix` run.** The canonical body each check
  writes has no `bypass_actors` field at all, so the owning check's next `--fix`
  wipes every grant on its ruleset. GitHub also logs a
  `Bypassed rule violations` entry on each use. Nothing here is durable, and
  the script prints both facts on every grant.
- **It is reflexive only.** There is no `--user` flag: the actor is always the
  authenticated `gh` account, so the tool can exempt the person running it and
  nobody else. `--grant` additionally requires `--yes`.
- **It never creates a ruleset, and never writes the wrong one.** An absent
  managed ruleset is a hard stop pointing at the owning `--fix` command. A
  ruleset whose live target disagrees with the selected identity is refused
  before any write, so a `--tags` run cannot land on a branch ruleset.
- **Revoke when done.** Waiting for the next `--fix` run works, but leaves a
  live exemption sitting on the repo until then.

</details>

## Strip attribution with the script, never a rebase dance

When the pre-push gate reports "AI attribution found in commit messages", the
owner is:

```bash
node scripts/fleet/strip-ai-attribution.mts --base <ref> [--dry-run]
```

It walks `base..HEAD` with plumbing, rewords ONLY flagged messages (shared
detector: `.claude/hooks/fleet/_shared/ai-attribution.mts`), preserves trees, author
identity, and author dates, re-signs through the normal signing config,
verifies the final tree byte-identical, and re-scans the result. A
hand-scripted `git rebase -i` with `GIT_SEQUENCE_EDITOR`/`GIT_EDITOR` editors
is banned by `attribution-rewrite-nudge`: it is quoting-fragile, silently
no-ops when the todo regex misses, and verifies nothing — all three failure
modes happened live (socket-mcp, 2026-07-10) before the script existed.

## Never `filter-branch` — it drops signatures and keeps the committer

`history-rewrite-guard` BLOCKS `git filter-branch`, `git filter-repo` (both the
subcommand and the standalone `git-filter-repo` binary), and a `git commit-tree`
with no `-S`/`--gpg-sign`. Bypass slug: `history-rewrite`.

Two defects, both silent, both fatal on a branch whose ruleset requires verified
signatures:

<details>
<summary><b>The two defects in full</b> — signatures dropped on every re-created commit, and the original GIT_COMMITTER_* restored so even a re-signed rewrite fails verification</summary>

- **Signatures are dropped.** `filter-branch` re-creates every commit, and a
  re-created commit is unsigned unless you ask for a signature. Nothing warns
  you; the next `commits-are-signed` check or the push itself is the first
  signal.
- **The committer is restored.** `filter-branch` puts the ORIGINAL
  `GIT_COMMITTER_NAME` / `GIT_COMMITTER_EMAIL` / `GIT_COMMITTER_DATE` back on
  each rewritten commit. So even re-signing with
  `--commit-filter 'git commit-tree -S "$@"'` fails GitHub verification: your
  signature disagrees with the restored committer field.

</details>

Two invariants hold for any rewrite:

1. **Sign every re-minted commit** — pass `-S`.
2. **Let the committer default** to whoever runs the rewrite. Set only
   `GIT_AUTHOR_NAME` / `GIT_AUTHOR_EMAIL` / `GIT_AUTHOR_DATE`; never restore
   `GIT_COMMITTER_*`.

`git rebase` holds both naturally, and `scripts/fleet/strip-ai-attribution.mts`
holds both explicitly (`commit-tree … -S`, author env only). BFG Repo-Cleaner
has the same re-mint problem and is not a sanctioned path either.

Both defects have landed for real: a hand-rolled `filter-branch --msg-filter`,
reached for to strip one trailer instead of the script that already owned the
operation, left a branch-worth of unsigned commits that only `commits-are-signed`
caught, and the re-signed retry was still rejected — "Commits must have verified
signatures."

## A rewrite base must sit on origin's lineage

After a force-push rewrite, old anchors — version tags, npm `gitHead`
records, backup refs — still point into the REPLACED history. Consolidating
or squashing onto such a base rebuilds the branch on that dead line, so every
replaced commit comes back, including ones the rewrite removed on purpose.

`consolidate-commits.mts` enforces this: a `--base` that DIVERGED from
`origin/<default>` (neither contains the other) fails loud with the recovery
steps. A base below origin's tip (normal release anchor) or above it (an
unpushed local span) is fine. `--allow-off-lineage-base` skips the check for
a deliberately local-only lineage.

Recovery when the anchor is stale: find the SAME release point on the live
history (`git log origin/main --oneline | head -20`, match the bump/release
subject) and pass that sha as `--base`. When local work is already built on
the dead line, re-anchor it: snapshot the verified tree
(`git commit-tree <tree> -p origin/main`), point the branch at the snapshot,
then consolidate with `--base origin/main` — the result is a fast-forward of
origin, no force needed.

## What consolidation preserves

The local `HEAD` at command start is the content source. The base ref chooses
the parent lineage; it never replaces the local tree. Before the first
destructive command, the script parks the original tip on the fleet's canonical
backup branch — `refs/heads/backup-YYYYMMDD-HHMMSS`, the same
`formatBackupBranch` name the squash flow uses — and pushes it to `origin`. That
one name is what `backup-branches.mts prune` retires,
`backup-branches.mts normalize` renames, and `bump.mts` scans at release time
for parked, un-landed work, so a consolidation's safety net is visible to every
tool that handles backups. Recover it with
`git fetch origin backup-<ts> && git reset --hard FETCH_HEAD`.

Three outcomes:

<details>
<summary><b>The three backup outcomes</b> — pushed to origin, push failed so the consolidate aborts, no origin remote so the backup stays local under the canonical name</summary>

- **Pushed to origin** — the normal case. The original history is recoverable
  from any clone.
- **Push failed** (auth, branch protection, network) — the consolidate ABORTS.
  A rewrite with no recoverable backup is the outcome the mechanism exists to
  prevent, so a failed push is a hard error, never a warning.
- **No `origin` remote** — the backup is written as a LOCAL branch under the
  same canonical name, and the run says so on its own line. The name stays
  canonical, so the prune and normalize scripts still see a backup that never
  left the machine.

</details>

The backup is never torn down by the script. When the rewrite fails its own
integrity check the script hard-restores the original tip AND leaves the backup
standing; `backup-branches.mts prune` is what retires a spent one.

Consolidation preserves the exact Git tree object, so every tracked path and
byte stays the same. It intentionally replaces commit identities. The final
message reports the original tip, the backup branch and its recovery command,
old and new commit counts, and the push mode computed from ancestry: a normal
push when `origin/<default>` is an ancestor of the new tip, otherwise a
separately authorized lease force-push.

## Subagents: a worktree is not durable storage

`tidying-worktrees` and `managing-worktrees` prune worktrees automatically —
`git worktree prune` plus a `--force` removal of anything the removability
predicate calls spent — and a squash-opt-in repo force-pushes its default
branch on a cadence. A subagent that treats its worktree as the durable copy
of its own work, or a commit SHA as a stable handle, loses both without
warning.

- **Land to your own branch continuously.** Never let work live only in the
  worktree. Commit and push (or land to local main) as you go — a worktree
  that gets swept mid-task takes any unlanded commit with it.
- **Identify your work by subject, not SHA.** A squash or a lease-force
  reconcile mints new commit objects for the same tree; the SHA you saw
  earlier will not resolve. Match on the commit subject / your own diff
  instead of pinning to a specific hash.
- **A live rewrite in progress is a pause signal.** If a squash or history
  rewrite is running, or `main`'s history changes under you mid-task, stop
  mutating git state, report what you saw, and wait — don't try to reconcile
  a moving target yourself.
- **Never reset or rewind local main to origin.** Origin moving ahead by a
  squash/rewrite is not newer truth; reconcile forward (see "Local main is
  canonical" above), the same rule as every other actor.

A hook that watched for an in-progress rewrite (a lockfile, a running
`squashing-history` process, a `SQUASH_HISTORY` env sentinel) and warned a
subagent before it mutated git state would catch this earlier than a lost-work
postmortem; nothing currently does.

## Incident this codifies

socket-mcp, 2026-07-10: a morning sweep consolidation force-pushed rewritten
history; the evening "consolidate since the last npm release" resolved the
`v0.0.20` tag to the replaced lineage, resurrected an AI-attributed commit
the rewrite had removed, and the pre-push gate rejected the push. Three
rebase-reword hand-attempts then failed silently (quoting, todo-regex miss,
no verification) before the branch was re-anchored onto origin's lineage.
