# default-branch-guard

PreToolUse hook that blocks Bash invocations hard-coding `main` or `master` in scripting contexts where the fleet's "Default branch fallback" rule requires a `git symbolic-ref` lookup.

## Why

Fleet repos are mostly on `main`, but legacy/vendored repos still use `master`. Scripts that hard-code one name silently no-op on the other. The canonical pattern looks up `refs/remotes/origin/HEAD`, falls back to `main`, then `master`, never just assumes.

## What it catches

- `BASE=main` / `BASE=master` literal assignments
- `--base=main` / `--base main` flag values
- `DEFAULT_BRANCH=main` / `MAIN_BRANCH=master`
- Heredoc / `cat > file.sh` writes containing `main..HEAD` / `master...HEAD` literals

## Non-blocking reminder (notify, not block)

- Renaming a branch onto the default name to switch the default branch — `git branch -m <src> main` / `-M` / `--move`, or the GitHub `.../branches/<src>/rename` API with `new_name=main` — emits a heads-up; the rename still proceeds. Switching the default this way **fails when a branch by the target name already exists**, so the reminder is: make sure the branch you're keeping has the right content, delete/relocate the existing `main` to free the name, then rename the source. (Learned switching a repo's default from `probe` → `main` while a `main` branch already existed.)

## What it does NOT catch

- Interactive one-offs: `git checkout main`, `git pull origin main`, `gh pr create --base main` are allowed — the user is operating on a known repo.
- Renames _away_ from the default (`git branch -m main develop`) — the target name isn't the default.
- Mentions of "main" / "master" in non-scripting commands (`echo`, comments, etc.).

## Bypass

- Type `Allow default-branch bypass` in a recent user message (also accepts `Allow default branch bypass` / `Allow defaultbranch bypass`).

## Test

```sh
pnpm test
```
