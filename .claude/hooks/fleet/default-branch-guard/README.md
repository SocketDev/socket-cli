# default-branch-guard

PreToolUse hook that blocks Bash invocations hard-coding `main` or `master` in scripting contexts where the fleet's "Default branch fallback" rule requires a `git symbolic-ref` lookup.

## Why

Fleet repos are mostly on `main`, but legacy/vendored repos still use `master`. Scripts that hard-code one name silently no-op on the other. The canonical pattern looks up `refs/remotes/origin/HEAD`, falls back to `main`, then `master`, never just assumes.

## What it catches

- `BASE=main` / `BASE=master` literal assignments
- `--base=main` / `--base main` flag values
- `DEFAULT_BRANCH=main` / `MAIN_BRANCH=master`
- Heredoc / `cat > file.sh` writes containing `main..HEAD` / `master...HEAD` literals

## What it does NOT catch

- Interactive one-offs: `git checkout main`, `git pull origin main`, `gh pr create --base main` are allowed (the user is operating on a known repo).
- Mentions of "main" / "master" in non-scripting commands (`echo`, comments, etc.).

## Bypass

- Type `Allow default-branch bypass` in a recent user message (also accepts `Allow default branch bypass` / `Allow defaultbranch bypass`), or
- Set `SOCKET_DEFAULT_BRANCH_GUARD_DISABLED=1`.

## Test

```sh
pnpm test
```
