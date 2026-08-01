# no-version-bump-pr-guard

PreToolUse Bash hook (blocking, exit 2) that HARD-BLOCKS any command opening a
pull request to land a **version bump**. The bump commit belongs directly on the
default branch — the local release pipeline's bump stage puts it there, and the
CI bump lands it through the release App.

## What it catches

`gh pr create` / `gh pr new`:

- A bump-shaped head branch, from `--head` / `-H` / `--head=`, or from the
  current checkout when no head flag is given: `npm-publish-v6.5.2`,
  `cargo-publish-v1.0.0`, `release-v2.3.4`, `bump-1.2.3`, anything carrying
  `version-bump`. A `<owner>:` fork prefix and a `refs/heads/` qualifier are
  stripped first.
- A bump-shaped title, from `--title` / `-t` / `--title=`:
  `chore: bump version to 6.5.2`, `chore(release): 6.5.2`, any `bump version`
  phrasing.
- A `--body-file` / `-F` payload carrying a bump SUBJECT line. The body is held
  to the strict subject patterns only — prose that merely mentions bumping is
  not a bump PR.

The GitHub API:

- `gh api repos/<o>/<r>/pulls -f head=… -f title=…` (every field spelling:
  `--field`, `--raw-field`, `-f`, `-F`, and the joined `-fhead=…` form).
- `gh api --input <file>` with a JSON body.
- A raw REST `POST /repos/<o>/<r>/pulls` from curl or anything else, with the
  head/title in a `-d` / `--data` / `--data-raw` / `--json` JSON payload. Every
  method spelling is read: `--method POST`, `--method=POST`, `--request POST`,
  `-X POST`, `-XPOST`.

Detection is **AST-based** — the shell-quote-backed `shell-command.mts` parser,
not regex over the raw string — so `&&` chains, quoting, `$(…)` substitution,
and a literal `"gh pr create"` inside a `grep` string are all handled.

## Why

A PR routes the bump through branch protection. The freshly-created bump branch
has no protected-branch rules, so `enablePullRequestAutoMerge` fails with
`Pull request Branch does not have required protected branch rules`, the run
dies, and the publish never happens with the version stranded on a throwaway
branch. There is nothing to review either: the version came from the committed
hint and the diff is machine-generated.

## Universal

Fires in NON-fleet repos too. A bump PR against an external repo strands that
repo's release the same way, so this is not gated on fleet membership.

## Skipped scenarios

- An ordinary feature PR — `gh pr create --head feat/foo --title "fix: thing"`.
- Reading or editing an existing PR (`gh pr view/list/checks/comment`,
  `gh api repos/o/r/pulls/12`).
- A `/pulls` GET, or any explicit non-POST method.
- Any non-Bash tool call.

## Bypass

Type `Allow version-bump-pr bypass` in a recent message.

## Exit codes

- `2` — blocked: the PR head, title, or body file is version-bump shaped.
- `0` — allowed (ordinary PR, read-only `gh pr` / API call, or the bypass
  phrase is present).
