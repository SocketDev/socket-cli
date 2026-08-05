# no-revert-guard

PreToolUse Bash hook that blocks destructive git commands and hook bypasses unless the user has authorized them with the canonical phrase `Allow <X> bypass`. Force-push detection lives in the sibling `no-force-push-guard/` hook.

## What it blocks

Every history-destroying git shape, each with its matching bypass phrase.

<details>
<summary><b>The full pattern table</b> — checkout/restore/reset/stash/clean/rm under <code>Allow revert bypass</code>; hook-dodging (<code>--no-verify</code>, HUSKY=0, hooksPath) under <code>Allow no-verify bypass</code></summary>

| Pattern                                                                                                                                 | Bypass phrase                 |
| --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `git checkout -- <files>` / `git checkout <ref> -- <files>`                                                                             | `Allow revert bypass`         |
| `git restore <files>` (without `--staged`)                                                                                              | `Allow revert bypass`         |
| `git reset --hard`                                                                                                                      | `Allow revert bypass`         |
| `git stash drop` / `git stash pop` / `git stash clear`                                                                                  | `Allow revert bypass`         |
| `git clean -f` (and variants)                                                                                                           | `Allow revert bypass`         |
| `git rm -r{f,}`                                                                                                                         | `Allow revert bypass`         |
| `git stash` (bare / `push` / `save` / `--keep-index`)                                                                                   | `Allow stash bypass`          |
| `--no-verify`                                                                                                                           | `Allow no-verify bypass`      |
| `HUSKY=0 git …` / `export HUSKY=0`                                                                                                      | `Allow no-verify bypass`      |
| `-c core.hooksPath=<path>` / `--config-env=core.hooksPath=<VAR>` / `GIT_CONFIG_KEY_<i>=core.hooksPath`, on a subcommand that runs hooks | `Allow no-verify bypass`      |
| `--no-gpg-sign` / `commit.gpgsign=false`                                                                                                | `Allow gpg bypass`            |
| `SKIP_ASSET_DOWNLOAD=1`                                                                                                                 | `Allow asset-download bypass` |
| Bash file-write (`python -c '…write…'`, heredoc `> file`, `tee <file>`, `dd of=…`)                                                      | `Allow bash-write bypass`     |

`git revert` is NOT in the table. It appends an inverse commit and discards
nothing — the working tree keeps every uncommitted change and the reverted
commit stays reachable — so it is not work loss and this guard does not gate it.
The name "revert" here is the category (putting tracked work back), which every
row above does. The fleet's position on `git revert` itself is
`prefer-rebase-over-revert-nudge`, a nudge, which steers an unpushed commit to
`git reset --soft` / `git rebase -i`. The covered subcommands, the rule label
derived from them, and this reasoning live in `destructive-git-shapes.mts`.

The three hook-chain rows share one phrase because they are one decision with
one outcome: the `.git-hooks/` chain does not run. The `core.hooksPath` rule
stands down when the command names another repository (`-C` / `--git-dir`
outside the acting repo, or a `cd` out of the fleet), which is the hardening
idiom `docs/agents.md/fleet/untrusted-cwd.md` mandates for a scanned checkout.

</details>

## Which repository it reads

A `git -C <dir>` points the command at another checkout, so the unconditional
unbacked-reset gate gathers its facts THERE: the commits ahead of the reset
target, the files only that HEAD carries, and the refs that would still hold
them after the reset lands. Resolution order is the destructive invocation's own
`-C`, then the tool call's acted-on path (which follows a `cd`), then the hook's
project dir — `target-repo.mts`, over the one `-C` parser in
`_shared/git-cwd.mts`. Reading the session's own checkout instead named this
repo's HEAD as the at-risk commit and missed a backup branch that existed in the
targeted repo.

## Inline sentinels (scoped auto-bypass)

Two batch flows run the same blocked operations many times and would otherwise need a fresh typed phrase per command. Each marks intent with an inline `NAME=1` assignment (opt-in per command — no global env poisoning), scoped to exactly the operations that flow needs. Anything else carrying the sentinel falls through to the normal blocking checks.

| Sentinel           | Flow                      | Allows only                                                                                                                                                                                                   |
| ------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FLEET_SYNC=1`     | wheelhouse cascade        | `git commit` whose message starts `chore(wheelhouse): cascade template@`; any `git push`                                                                                                                      |
| `SQUASH_HISTORY=1` | `squashing-history` skill | a single un-chained `git commit --amend -m "chore: initial commit"` (this guard); a single un-chained `git push --force`/`--force-with-lease` to a bare remote + one plain branch ref (`no-force-push-guard`) |

`SQUASH_HISTORY=1` is hardened against malicious bypass, a poisoned prompt riding the sentinel to clobber a remote or chain extra work: the shared `_shared/squash-sentinel.mts` parses the command and honors the sentinel **only** when the line is exactly one statically-resolved `git` segment — no `&&`/`;`/`|` chaining, no `$(…)` substitution, no `$VAR`/`eval` indirection, no extra inline env assignment, no refspec (`src:dst`) / `--mirror` / `--all` / `--delete` / `--no-verify` on the push.

## How the bypass works

The hook reads the conversation transcript (path passed in the PreToolUse JSON payload) and searches the concatenated user-turn text for the exact phrase. The match is **case-sensitive** and **substring-based** — a paraphrase like "go ahead and revert" does not count.

A phrase from a previous session does not carry over: the transcript only includes the current session's turns.

## Why hook + memory + CLAUDE.md rule

Defense in depth:

- **CLAUDE.md** documents the policy so a reviewer reading the canonical fleet rules sees the rule.
- **Memory** keeps the assistant honest across sessions even before the hook fires.
- **Hook** is the actual enforcement: when Claude tries the destructive command, this hook checks the transcript, finds no matching authorization phrase, and exits 2 with a stderr message telling Claude exactly what the user needs to type.

The user then makes a deliberate choice instead of Claude inferring intent from context.

## Failing open

The hook fails open on its own bugs (exit 0 + stderr log) so a bad deploy of the hook can't brick the session. The trade-off: a buggy hook silently allows the destructive command. Acceptable because the alternative (hook crashes wedge the session) is worse for development velocity, and bug reports surface quickly.

## Companion files

- `index.mts` — the hook itself
- `hooks-path.mts` — the `core.hooksPath` detector, the git subcommands that consult it, and the foreign-repository carve-out
- `target-repo.mts` — which repository a destructive command acts on, so every git read runs in the repo the command targets
- `package.json` — declares the hook as a workspace package (taze sees it via `pnpm-workspace.yaml`'s `packages: ['.claude/hooks/*']`)
- `tsconfig.json` — fleet-canonical TS config for hooks
- `test/` — node:test runner specs (run via `pnpm exec --filter hook-no-revert-guard test` or `node --test test/*.test.mts`)
