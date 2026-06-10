# Stranded cascades

Local-only `chore(wheelhouse): cascade template@<sha>` commits and `chore/wheelhouse-<sha>` worktree branches whose template SHA has been **superseded** on origin. They accumulate when a cascade wave was interrupted (machine crash, push rejection followed by abandonment, parallel-session race) and a later wave pushed past the abandoned attempt.

A real incident drove this rule: a fleet repo ended up with 4 stranded local cascade commits behind 11 origin commits including a `@socketsecurity/lib → lib-stable` migration. A trivial CLAUDE.md trim couldn't push without resolving ~50 fleet-canonical hook merge conflicts. Auto-cleanup at the start of every cascade wave prevents that state from recurring.

## How auto-cleanup works

The wheelhouse cascade runs `socket-wheelhouse/scripts/fleet/cleanup-stranded.mts --target <repo>` against each fleet repo **before** creating that wave's `chore/wheelhouse-<sha>` worktree. Default mode is **fix**:

- Stranded commits are removed via `git reset --hard origin/<base>`.
- Stranded worktrees are removed via `git worktree remove --force` followed by `git branch -D chore/wheelhouse-<sha>`.

Pass `--dry-run` to report without acting. Pass `--all` instead of `--target <path>` to sweep every fleet repo from `fleet-repos.json`.

## No-layering rule

🚨 **A repo carries at most one in-flight cascade at a time.** When a new cascade wave starts (a fresh `chore(wheelhouse): cascade template@<sha>` is being prepared), any pre-existing local-only cascade commits get discarded, not stacked on top of.

The shape this rule prevents: a repo accumulates `chore(wheelhouse): cascade template@A`, then `@B`, then `@C` locally without any of them landing on origin. Each successive wave is a strict superset of the prior (template is monotonic on the relevant paths), so layering 3 unpushed cascade commits buys nothing over discarding A + B + landing C. The layered state is also hostile to merge resolution when origin diverges (a parallel session lands its own `@D` to origin). Every conflict has to be resolved against 3 cascade commits instead of 1.

Same supersession check as below, but the comparison is **`local-commit-N` vs `local-commit-N+1`**. When wave N+1 is being prepared, wave N's local-only commit must already have a strict-ancestor relationship to N+1's template SHA. If it does (the common case where template moves forward), N gets discarded as part of N+1's setup. If it doesn't, the script bails because something unusual is going on.

The wheelhouse cascade enforces this by running `scripts/repo/cleanup-stranded.mts` against the target repo **before** creating wave N+1's worktree. Same call site as the supersession cleanup below, with the "vs origin" check extended to "vs the next-wave SHA we're about to use." A new transient cascade commit at the wrong base is blocked at commit time by `.claude/hooks/fleet/no-cascade-transient-git-guard/`.

## Safety rails

Auto-cleanup runs **only** when every local commit ahead of origin satisfies **all four**:

1. **Subject** matches `chore(wheelhouse): cascade template@<sha40>`.
2. **Author** is `github-actions[bot]` OR an alias in `~/.claude/git-authors.json` (mirrors the `commit-author-guard` trust set).
3. **Supersession**: the local commit's template SHA is a **strict ancestor** of EITHER origin's most recent cascade commit's SHA OR the next-wave SHA being prepared (whichever is the cleanup invocation's reference). Equal SHA means "not stranded, just unpushed"; bail.
4. **File allowlist**: every path the local commit touches is under one of `.claude/`, `.config/`, `.github/`, `.husky/`, `scripts/`, or one of a tightly enumerated set of root files (`CLAUDE.md`, `.editorconfig`, `.gitattributes`, `.gitignore`, `.gitmodules`, `.nvmrc`, `.prettierignore`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig.json`).

If **any** check fails for **any** local commit, the script bails the **whole repo**. No partial cleanup, no "skip the bad one and continue." The operator decides.

The script will refuse to auto-clean if:

- A non-cascade commit is present locally ahead of origin (real work; never auto-touch).
- A cascade commit was authored by someone outside the trusted email set.
- A cascade commit references a template SHA that is **not** a strict ancestor of origin's current cascade SHA (could be a future template, an unrelated branch, or a forced reset).
- A cascade commit modifies a file outside the cascade-allowlist (e.g. source code under `src/`, vendored deps, test fixtures).
- Origin has no cascade commits at all. There's nothing to prove supersession against.

## Stranded worktree detection

Same supersession rule, applied to worktree branches:

- Branch name matches `chore/wheelhouse-<sha40>` (or the legacy `chore/sync-<sha40>` form during the cutover window; both regexes accepted by `cleanup-stranded.mts`).
- That SHA is a strict ancestor of origin's most recent cascade SHA (so the worktree's intent has already landed via a newer wave).

Only worktrees that match both conditions are removed. Other worktrees (task branches, PR branches, ad-hoc work) are untouched.

## Manual invocation

The script lives at `socket-wheelhouse/scripts/fleet/cleanup-stranded.mts`. You don't normally run it directly (the cascade does that), but it's safe to invoke ad-hoc:

```bash
# Dry-run against one repo (substitute the actual repo path).
node $PROJECTS/socket-wheelhouse/scripts/fleet/cleanup-stranded.mts \
  --target $PROJECTS/<repo> --dry-run

# Sweep the whole fleet, reporting only.
node $PROJECTS/socket-wheelhouse/scripts/fleet/cleanup-stranded.mts \
  --all --dry-run

# Apply the fix.
node $PROJECTS/socket-wheelhouse/scripts/fleet/cleanup-stranded.mts --all
```

## Recovery when auto-cleanup bails

If the script reports `not cleaning up: <reason>`, the repo has at least one local commit that doesn't fit the auto-removable profile. Decide per-case:

1. **Real work ahead of origin** (e.g. a one-off fix you committed to `main` locally without pushing): push it, or move it to a feature branch (`git switch -c feat/x && git push -u origin feat/x`). Then re-run cleanup.
2. **Cascade commit touching unexpected files**: inspect with `git show <sha>`. If the cascade should have written that path, lift the path into the cascade allowlist (in `scripts/fleet/cleanup-stranded.mts`) and re-run. If the file shouldn't be cascade-touched at all, this is an authoring bug in `sync-scaffolding/manifest.mts`.
3. **Cascade commit from an untrusted author**: usually means another agent / contributor authored it. Validate the commit by hand, then either trust the author (add to `~/.claude/git-authors.json` aliases) or rebase the commit out manually.
4. **Template SHA that's not a strict ancestor**: the local commit may be from a branch of `socket-wheelhouse/template/` that was never merged. Confirm by inspecting the SHA in the wheelhouse history (`git -C $PROJECTS/socket-wheelhouse log <sha>`). If it's orphan / abandoned, `git reset --hard origin/<base>` manually after backing up the SHA in case it's wanted later.

## Dogfood cascade sweeps parallel-session work: inspect before push

A dogfood cascade (`sync-scaffolding/cli.mts --target . --fix`) reconciles the **entire** repo against the template, not only the file you edited, and commits everything it fixes in one `chore(wheelhouse): cascade template@<sha>` commit. When a parallel session has landed (or is mid-flight on) other fleet work, that single commit captures THEIR files (new hooks, soak entries, oxlint rules) under YOUR authorship, and can pull an un-annotated `pnpm-workspace.yaml` soak entry that blocks your push at the soak-date gate.

The trap: you edit one `template/` file, cascade to sync its live copy, and land a 9-to-17-file commit dominated by another session's work, plus an un-pushable workspace file.

Discipline:

1. After a dogfood cascade, run **`git show --stat HEAD`** before pushing.
2. If the cascade commit touches files you did NOT author this turn, `git reset --hard <your-source-sha>` to drop it and push your source commit by itself. The live `.claude/` / `.config/` copies sync on the next clean cascade by whoever owns the wave. Your source edit is the deliverable; the dogfood cascade is convenience, not a requirement for your change to be correct.
3. The per-commit push succeeds; folding the live-copy sync into your push captures a parallel session's work in your commit.

## What this rule does NOT do

- It does **not** sync the cascade's actual content. That's `sync-scaffolding/cli.mts`'s job.
- It does **not** push anything. Cleanup only mutates local state.
- It does **not** delete uncommitted working-tree changes. `git reset --hard origin/<base>` does discard tracked-but-uncommitted changes, so the cascade-template flow runs cleanup before any worktree state is at risk; the worktree for the new wave hasn't been created yet.
- It does **not** clean up stranded artifacts in branches other than the repo's default branch. v1.x release branches keep their own cascade history.
