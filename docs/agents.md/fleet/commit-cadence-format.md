# Commit cadence & message format

Companion to the `### Commit cadence & message format` rule in `template/CLAUDE.md`. The inline section gives the headline. This file holds the spec, the cadence rationale, and the bypass surface.

## Cadence: small chunks, committed often

Commit early, commit often. Don't sit on 20+ minutes of edits in a dirty worktree. Split the work into the smallest logical chunks and commit each as soon as it's a coherent unit:

- Passing tests
- No half-finished functions
- A working state for the next collaborator to pick up

Past incident: a 90-minute session ended with 11 uncommitted file changes spanning three unrelated refactors. Restoring intent took an hour of `git diff` reading. Two small commits would have kept the story legible.

Pairs with _Don't leave the worktree dirty_ and _Smallest chunks, land ASAP_. Cadence is the input; dirty worktree is what happens when cadence slips; small-chunks is the post-commit shape.

## Conventional Commits 1.0

Every commit message follows the spec at
<https://www.conventionalcommits.org/en/v1.0.0/>. The headline form is:

    <type>[optional scope][!]: <description>

    [optional body]

    [optional footer(s)]

Where:

- `type` (required, lowercase), one of:
  - `feat`: new feature
  - `fix`: bug fix
  - `chore`: maintenance, deps, tooling
  - `docs`: documentation only
  - `style`: formatting, whitespace, no semantic change
  - `refactor`: internal restructure, no behavior change
  - `perf`: performance improvement
  - `test`: test-only change
  - `build`: build system / packaging
  - `ci`: CI configuration
  - `revert`: undoes a prior commit
- `[scope]` (optional): a parenthesized noun describing the affected area (e.g. `(parser)`, `(extension)`, `(lib)`, `(hooks)`)
- `[!]` (optional): flags a breaking change. Either `feat!: ...` or `feat(api)!: ...`. Adding `BREAKING CHANGE:` in the footer is also acceptable but `!` is preferred.
- `: ` (required): colon + space, separates the header from the description
- `<description>` (required): non-empty, lowercase-leading, short imperative summary

### Valid examples

- `feat(parser): add ability to parse arrays`
- `fix: array parsing issue when multiple spaces`
- `chore!: drop support for Node 14`
- `refactor(api)!: drop legacy /v1 routes`
- `docs(claude.md): document commit cadence`
- `ci: bump actions/checkout pin`

### Blocked anti-patterns

- `update stuff`: no type
- `feat:`: empty description
- `FEAT: parser`: uppercase type
- `feature(parser): X`: `feature` not in the allowed type list
- `feat parser: X`: missing colon
- `WIP` / `fix typo` / `more changes`: no type, vague description

## No AI attribution

The fleet forbids AI-attribution markers in commit messages, PR
descriptions, and inline review replies. The patterns blocked by
`commit-message-format-guard` and reminded by `commit-pr-reminder`:

- `Generated with Claude` / `Generated with Anthropic` (any case)
- `Co-Authored-By: Claude` / `Co-Authored-By:Claude`
- 🤖 robot-emoji tag lines
- `<noreply@anthropic.com>` footer references

The rule applies at draft time too. Rewrite the message to omit the strings before you run `git commit`.

## Bypass phrases

Per the fleet's _Hook bypasses require the canonical phrase_ rule
(`Allow <X> bypass` verbatim in a recent user turn):

- `Allow commit-format bypass`: for format/type issues. Use when the commit message diverges from the spec on purpose (rare; usually the user is bringing in a fixup or an external patch with a pre-existing message).
- `Allow ai-attribution bypass`: for the AI-attribution check specifically. Use when a commit legitimately documents the forbidden strings (e.g. a CLAUDE.md edit that quotes them as examples, a test fixture, or a release note explaining why they're forbidden).
- Env var `SOCKET_COMMIT_MESSAGE_FORMAT_GUARD_DISABLED=1`: full disable for testing.

## Operational rules

- **When adding commits to an OPEN PR**, update the PR title + description to match the new scope: `gh pr edit <num> --title … --body …`. The reviewer should know what's in the PR without scrolling commits.
- **Fixing a finding on someone else's PR branch**: leave a GitHub _suggestion_ comment rather than pushing a fixup onto their branch. Post via `gh api repos/{owner}/{repo}/pulls/{num}/comments -X POST` with a body that wraps the replacement in a ` ```suggestion ` block, anchored to `commit_id` (the PR head SHA), `path`, and `line`. The author accepts with one click and keeps authorship; you never rewrite a branch you don't own. The discriminator is **branch ownership, not change size**. This is the one place the _Fix it, don't defer_ default yields. It does not extend to your own working tree, where you still fix in place. Push directly to a teammate's branch only when they asked or you're actively pairing. **Why:** SocketDev/socket-mcp#182 was a low-severity README doc-drift fix on annextuckner's branch; pushing a fixup would have landed our authorship over theirs when a one-click suggestion did the job.
- **Replying to Cursor Bugbot**: reply on the inline review-comment thread, not as a detached PR comment: `gh api repos/{owner}/{repo}/pulls/{pr}/comments/{comment_id}/replies -X POST -f body=…`.
- **Backing out an unpushed commit**: prefer `git reset --soft HEAD~1` (or `git rebase -i HEAD~N`) over `git revert`. Revert commits are for changes already on origin; for local-only commits they just pollute history (enforced by `.claude/hooks/fleet/prefer-rebase-over-revert-guard/`).
- **No empty commits.** Never use `git commit --allow-empty`, `git cherry-pick --allow-empty`, or `--keep-redundant-commits`. Anchor releases on the actual version-bump commit + move the tag forward with `git tag -f vX.Y.Z` instead. Empty commits pollute `git log` and break CHANGELOG generators / `git log -p` / blame. Bypass: `Allow empty-commit bypass` (enforced by `.claude/hooks/fleet/no-empty-commit-guard/`).
- **Commit author + subject**: a commit's author/committer must not be a denied placeholder identity (`test@example.com`, `Test`, empty — the universal denylist in `.config/fleet/git-authors.json`), and when a repo declares an allowlist (`.config/repo/git-authors.json`: `canonical` + `aliases[]`) the email must be on it. The allowlist is per-repo; the cascaded fleet default ships only the denylist (no machine-local `~/` source). The commit subject must not be a content-free placeholder (`initial`/`wip`/`test`). Two surfaces each: `.claude/hooks/fleet/commit-author-guard/` + `commit-message-format-guard/` gate Claude `git commit` tool calls; the `.git-hooks/fleet/commit-msg` git-stage backstop catches subprocess / worktree / CI commits the tool layer never sees (a batch of `test@example.com` `initial` commits once reached a fleet repo's main exactly this way). Bypass: `Allow commit-author bypass`.
- **Scan-internal labels stay out of commits**: `B1` / `M9` / `H3` / `L4` codes from `/fleet:scanning-quality` / `/fleet:scanning-security` reports are scaffolding. Inline the finding text in the commit body instead. Bypass: `Allow scan-label-in-commit bypass` (enforced by `.claude/hooks/fleet/scan-label-in-commit-guard/`).
- **Push policy: push, fall back to PR.** Default to `git push origin <branch>` (typically `main`). On rejection: open a PR via `gh pr create` against the default base. Don't pre-open PRs "to be safe"; don't force-push to recover. Reminder fires when `gh pr create` is invoked without an explicit user directive (enforced by `.claude/hooks/fleet/pr-vs-push-default-reminder/`). Enterprise-ruleset push rejections are unblocked via the repo's `temporarily-doesnt-touch-customers` custom property (`canSkipReviewGate()` in `scripts/_shared/repo-properties.mts`); Stop-time reminder surfaces this when the error pattern fires (enforced by `.claude/hooks/fleet/enterprise-push-reminder/`). Full rationale: [`docs/agents.md/fleet/push-policy.md`](push-policy.md).

## Enforcement surface

Defense in depth:

- **Edit-time draft**: `commit-pr-reminder` Stop hook flags AI
  attribution in assistant prose. Catches the issue before the
  command is run.
- **Commit-time gate**: `commit-message-format-guard` PreToolUse hook
  parses `git commit -m`/`--message` and blocks on type, format, or
  AI-attribution failure. The last line of defense before history
  carries the bad message.

Two surfaces by design. A draft can sneak past the Stop hook because it only sees the most recent assistant turn. The PreToolUse gate sees every command at commit time.
