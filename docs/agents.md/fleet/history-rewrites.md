# History rewrites: attribution stripping + on-lineage bases

Two rules for any operation that rewrites committed history (consolidate,
squash, reword, lease-force reconcile).

## Commits are ephemeral on a squash-enabled repo

A repo that carries the `squashing-history` skill collapses its default branch
to a single `chore: initial commit` on a cadence — the squash preserves the
**tree**, not the **log**. So on such a repo, individual commit granularity and
message polish are throwaway: they exist only until the next squash.

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
  worth the care.
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
  local to origin.

## The server-side force-push block, and its temporary exemption

Clearing the local guards leaves a second wall. Every fleet repo carries a
repo-level ruleset named `fleet-main-protection`, created and converged by
`scripts/fleet/check/main-branch-rules-are-enforced.mts`: `deletion` +
`non_fast_forward` on `~DEFAULT_BRANCH`, with **zero bypass actors**. GitHub
therefore rejects a force-push to the default branch even after
`no-force-push-guard` has stood aside. A squash-history flatten, a lease-force
reconcile, and an amend-and-push all hit it.

The exemption is a temporary self-grant, and it runs through a script:

```bash
# Who can force-push this repo right now? (read-only, the default)
node scripts/fleet/grant-main-bypass.mts <repo>

# Exempt yourself, push, then hand the exemption back.
node scripts/fleet/grant-main-bypass.mts <repo> --grant --yes
node scripts/fleet/grant-main-bypass.mts <repo> --revoke
```

- **Never hand-run `gh api` against the ruleset.** A hand-written full body
  silently rewrites whatever it omits — that is how a PUT meant to add one
  bypass actor drops `non_fast_forward` for everyone. The script reads the
  ruleset, replaces only `bypass_actors`, writes it back, then re-reads and
  fails loud if any rule type disappeared.
- **The grant is self-expiring, by construction.** The canonical ruleset body
  (`rulesetPayload()`) has no `bypass_actors` field at all, so the next
  `main-branch-rules-are-enforced --fix` wipes every grant. GitHub also logs a
  `Bypassed rule violations` entry on each use. Nothing here is durable, and
  the script prints both facts on every grant.
- **It is reflexive only.** There is no `--user` flag: the actor is always the
  authenticated `gh` account, so the tool can exempt the person running it and
  nobody else. `--grant` additionally requires `--yes`.
- **It never creates the ruleset.** An absent `fleet-main-protection` is a hard
  stop pointing at `main-branch-rules-are-enforced --fix`; one script owns that
  ruleset's shape, and a second definition would drift from it.
- **Revoke when done.** Waiting for the next `--fix` run works, but leaves a
  live force-push exemption sitting on the repo until then.

## Strip attribution with the script, never a rebase dance

When the pre-push gate reports "AI attribution found in commit messages", the
owner is:

```bash
node scripts/fleet/strip-ai-attribution.mts --base <ref> [--dry-run]
```

It walks `base..HEAD` with plumbing, rewords ONLY flagged messages (shared
detector: `scripts/fleet/lib/attribution.mts`), preserves trees, author
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

- **Signatures are dropped.** `filter-branch` re-creates every commit, and a
  re-created commit is unsigned unless you ask for a signature. Nothing warns
  you; the next `commits-are-signed` check or the push itself is the first
  signal.
- **The committer is restored.** `filter-branch` puts the ORIGINAL
  `GIT_COMMITTER_NAME` / `GIT_COMMITTER_EMAIL` / `GIT_COMMITTER_DATE` back on
  each rewritten commit. So even re-signing with
  `--commit-filter 'git commit-tree -S "$@"'` fails GitHub verification: your
  signature disagrees with the restored committer field.

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
the parent lineage; it never replaces the local tree. Before changing `HEAD`,
the script records the original tip under
`refs/fleet/recovery/consolidate/<full-sha>`. This local-only ref keeps every
original commit reachable even after reflog expiry. Recover or inspect it with
`git log refs/fleet/recovery/consolidate/<full-sha>`.

Consolidation preserves the exact Git tree object, so every tracked path and
byte stays the same. It intentionally replaces commit identities. The final
message reports the original tip, recovery ref, old and new commit counts, and
the push mode computed from ancestry: a normal push when `origin/<default>` is
an ancestor of the new tip, otherwise a separately authorized lease force-push.

## Incident this codifies

socket-mcp, 2026-07-10: a morning sweep consolidation force-pushed rewritten
history; the evening "consolidate since the last npm release" resolved the
`v0.0.20` tag to the replaced lineage, resurrected an AI-attributed commit
the rewrite had removed, and the pre-push gate rejected the push. Three
rebase-reword hand-attempts then failed silently (quoting, todo-regex miss,
no verification) before the branch was re-anchored onto origin's lineage.
