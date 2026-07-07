# no-github-ai-attribution-guard

PreToolUse Bash hook that blocks a `gh` command from posting AI-attribution boilerplate to a public GitHub prose surface.

## Why

The commit-msg git hook strips AI attribution (`Co-Authored-By: Claude`, `🤖 Generated with…`) from commit **messages**, and pre-push blocks it — but nothing covered the prose the agent posts through `gh`: PR/issue bodies + titles, PR/issue/commit comments, reviews, release notes, discussions, and gists. A real leak (`Assisted-by: Claude Code:opus-4-8` in a PR summary, SocketDev/depscan#21837) slipped straight through. AI attribution on a human-facing surface is the same doctrine violation as in a commit (CLAUDE.md → no AI attribution).

## How

On a `Bash` tool call, the guard:

1. AST-parses the command with the fleet `shell-command` parser (`commandsFor(command, 'gh')`) — sees through quoting, `&&`/`|`/`;` chains, and `$(…)`; no command-line regex (per `no-hook-cmd-regex-guard`).
2. For each `gh` invocation whose first non-flag arg is a prose subcommand (`pr`, `issue`, `release`, `api`, `gist`, `discussion`), extracts the prose flag values — `--body` / `--body-text` / `--notes` / `--title` (+ `-b` / `-t`, and the `--flag=value` form) and the `gh api` `body=` / `title=` field (`-f` / `-F` / `--field` / `--raw-field`).
3. Runs the shared `containsAiAttribution` (from `.git-hooks/_shared/ai-attribution.mts` — the SAME detector the commit-msg / pre-push hooks use, so they never diverge) over the extracted text.
4. If attribution is found AND the user hasn't typed the bypass phrase, exits 2 with the offending-surface explanation + the fix (remove the attribution line).

`--body-file` / `--notes-file` (file paths) are out of scope — only args-as-text are inspected. Commit messages are out of scope (the git hooks own them).

## Bypass

User types **`Allow ai-attribution bypass`** verbatim in a recent message (within the last 8 user turns).

## Related

- `.git-hooks/_shared/ai-attribution.mts` — the shared detector (`containsAiAttribution`, `stripAiAttribution`, `AI_ATTRIBUTION_RE`).
- `.git-hooks/fleet/commit-msg` + `pre-push` — the commit-message side of the same rule.
- `.claude/hooks/fleet/no-ext-issue-ref-guard/` — sibling Bash guard over the same gh prose surfaces (structural template).
