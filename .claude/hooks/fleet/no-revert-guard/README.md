# no-revert-guard

PreToolUse Bash hook that blocks destructive git commands and hook bypasses unless the user has authorized them with the canonical phrase `Allow <X> bypass`. Force-push detection lives in the sibling `no-force-push-guard/` hook.

## What it blocks

| Pattern                                                     | Bypass phrase             |
| ----------------------------------------------------------- | ------------------------- |
| `git checkout -- <files>` / `git checkout <ref> -- <files>` | `Allow revert bypass`     |
| `git restore <files>` (without `--staged`)                  | `Allow revert bypass`     |
| `git reset --hard`                                          | `Allow revert bypass`     |
| `git stash drop` / `git stash pop` / `git stash clear`      | `Allow revert bypass`     |
| `git clean -f` (and variants)                               | `Allow revert bypass`     |
| `git rm -r{f,}`                                             | `Allow revert bypass`     |
| `git stash` (bare / `push` / `save` / `--keep-index`)       | `Allow stash bypass`      |
| `--no-verify`                                               | `Allow no-verify bypass`  |
| `HUSKY=0 git …` / `export HUSKY=0`                          | `Allow no-verify bypass`  |
| `-c core.hooksPath=<path>` / `--config-env=core.hooksPath=<VAR>` / `GIT_CONFIG_KEY_<i>=core.hooksPath`, on a subcommand that runs hooks | `Allow no-verify bypass`  |
| `--no-gpg-sign` / `commit.gpgsign=false`                    | `Allow gpg bypass`        |
| `SKIP_ASSET_DOWNLOAD=1`                                     | `Allow asset-download bypass` |
| Bash file-write (`python -c '…write…'`, heredoc `> file`, `tee <file>`, `dd of=…`) | `Allow bash-write bypass` |

The three hook-chain rows share one phrase because they are one decision with
one outcome: the `.git-hooks/` chain does not run. The `core.hooksPath` rule
stands down when the command names another repository (`-C` / `--git-dir`
outside the acting repo, or a `cd` out of the fleet), which is the hardening
idiom `docs/agents.md/fleet/untrusted-cwd.md` mandates for a scanned checkout.

## Inline sentinels (scoped auto-bypass)

Two batch flows run the same blocked operations many times and would otherwise need a fresh typed phrase per command. Each marks intent with an inline `NAME=1` assignment (opt-in per command — no global env poisoning), scoped to exactly the operations that flow needs. Anything else carrying the sentinel falls through to the normal blocking checks.

| Sentinel          | Flow                  | Allows only                                                                                                                                                |
| ----------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FLEET_SYNC=1`    | wheelhouse cascade    | `git commit` whose message starts `chore(wheelhouse): cascade template@`; any `git push`                                                                   |
| `SQUASH_HISTORY=1`| `squashing-history` skill | a single un-chained `git commit --amend -m "chore: initial commit"` (this guard); a single un-chained `git push --force`/`--force-with-lease` to a bare remote + one plain branch ref (`no-force-push-guard`) |

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
- `package.json` — declares the hook as a workspace package (taze sees it via `pnpm-workspace.yaml`'s `packages: ['.claude/hooks/*']`)
- `tsconfig.json` — fleet-canonical TS config for hooks
- `test/` — node:test runner specs (run via `pnpm exec --filter hook-no-revert-guard test` or `node --test test/*.test.mts`)
