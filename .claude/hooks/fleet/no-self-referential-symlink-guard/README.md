# no-self-referential-symlink-guard

PreToolUse Bash hook that blocks a `git add` which would stage a symlink git
must never carry, or any `node_modules` path.

## Why

A cascade worktree symlinked `node_modules` at an absolute machine path so the
tests could run, then `git add -A` staged the **link** (git mode `120000`, body
`/Users/<user>/projects/<repo>/node_modules`). It was committed and pushed.

Two things had to fail together, and both are fixed here:

1. **`.gitignore` said `node_modules/`.** A trailing slash matches a
   **directory**. A symlink is a file to git, so the ignore rule never applied
   and the link was a normal untracked file waiting to be swept up. The fleet's
   `.gitignore` now says `**/node_modules`.
2. **Nothing blocked the `git add`.** The commit-time
   `tracked-symlinks-are-safe` check catches an offender that is already in the
   index, which is one commit too late. This guard is the edit-time layer.

In CI the target does not exist, so the link dangles. `mkdirSync(path, {
recursive: true })` on a dangling symlink throws `ENOENT`, the pre-install
bootstrap died, and five checks went red on a public repo. The earlier variant
of the same shape, a link pointing at itself, aborts `pnpm install` fleet-wide
with `ELOOP`.

## What it blocks

Three offences, evaluated against every path the command would stage:

| Shape                                                             | Block? |
| ----------------------------------------------------------------- | ------ |
| `link → <its own path>` (self-referential)                        | yes    |
| `a/b/link → ..` (target is an ancestor — traversal loops)         | yes    |
| `link → /Users/me/projects/repo/thing` (absolute, inside the repo) | yes    |
| any `node_modules` path, symlink or not                           | yes    |
| `packages/a/link → ../b/target` (relative, outside its subtree)   | no     |
| `link → /opt/toolchain` (absolute, outside the repo)              | no     |
| `git commit`, `git status`, anything that is not `git add`        | no     |

Relative symlinks are legitimate and several fleet repos track them. Only the
three shapes above are offences — a guard that blocks real work gets bypassed
and then ignored.

## How it decides what would be staged

The incident was `git add -A`, which names no path. A guard that only inspected
literal arguments would not have caught it. So the guard asks git:

```sh
git -c core.quotePath=false add --dry-run <the same args>
```

`--dry-run` writes nothing to the index and prints one `add '<path>'` line per
entry, **relative to the repo root** even when invoked from a subdirectory. Each
path is then `lstat`ed in the worktree; a symlink's body is read with
`readlink` (both work on a dangling link, which is the incident's shape) and
handed to the shared classifier.

When git cannot answer — not a repo, git missing, a pathspec that matches
nothing — the guard falls back to the literal path arguments, and otherwise
fails **open**.

Interactive adds (`-i`, `-p`, `-e`) are skipped: git refuses to pair them with
`--dry-run`, and an agent never issues them.

## Not relaxed for cascades

`overeager-staging-guard` stands down in a squash-history repo and for the
`FLEET_SYNC=1` cascade sentinel, because its complaint is staging etiquette. This
guard honors neither. The incident **was** a cascade broad-add, and unlike a
staging-etiquette problem this defect survives into every fresh clone.

## Shared detection

`scripts/fleet/lib/self-referential-symlink.mts` owns the rule
(`isNodeModulesPath`, `resolveTargetInRepo`, `classifyTrackedSymlink`,
`classifyStagedPath`). This guard and the commit-time
`scripts/fleet/check/tracked-symlinks-are-safe.mts` check both consume it, so
the two layers cannot drift into disagreement about what is dangerous.

## Bypass

Type the canonical phrase in a new message:

    Allow self-referential-symlink bypass

Reserved for a fixture that must track a loop on purpose.
