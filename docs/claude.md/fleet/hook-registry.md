# Hook registry

Companion to the `### Hook registry` section in `CLAUDE.md`. Full enforcement list lives here because the inline form was pushing CLAUDE.md past the 40 KB cap.

## Layout

- **`.claude/hooks/fleet/<name>/`** — fleet-canonical hooks. Edited only in `socket-wheelhouse/template/.claude/hooks/fleet/<name>/`; cascade pushes to every fleet repo. Citation gate (`new-hook-claude-md-guard`) requires each hook to have a matching `(enforced by ...)` mention somewhere in CLAUDE.md or the linked fleet docs.
- **`.claude/hooks/repo/<name>/`** — host-repo-only hooks. Live in the downstream repo; exempt from the citation gate. Mirrors `docs/claude.md/repo/` + `scripts/repo/`.
- **`.claude/hooks/fleet/_shared/`** — utilities imported by hooks (`transcript.mts`, `stop-reminder.mts`, `shell-command.mts`, `acorn/`, etc.). Also fleet-canonical.

## Currently enforced (fleet)

The fleet hooks each cite their own trigger + bypass surface in their `README.md`. They are:

- `actionlint-on-workflow-edit` — runs actionlint when `.github/workflows/**` is edited
- `answer-passing-questions-reminder` — surface unanswered transcript questions
- `answer-status-requests-reminder` — surface status pings before silent end-of-turn
- `auth-rotation-reminder` — reminds about expiring keychain tokens
- `avoid-cd-reminder` — keeps `cd` out of Bash, use `{ cwd }` instead
- `broken-hook-detector` — SessionStart probe for sibling hooks with missing imports
- `c8-ignore-reason-guard` — blocks a c8/v8 coverage-ignore directive with no reason
- `codex-no-write-guard` — blocks `codex` invocations with write-intent flags
- `commit-author-guard` — canonical-identity gate on git author email
- `concurrent-cargo-build-guard` — blocks a second `cargo build --release` while one runs
- `enterprise-push-property-reminder` — GitHub enterprise ruleset push-property reminders
- `extension-build-current-guard` — pairs `tools/.../extension/src/**` edits with a build
- `file-size-reminder` — Stop-time scan for source files over the 500-line soft cap
- `inline-script-defer-guard` — blocks `<script>` without `defer`/`async`/`module`
- `judgment-reminder` — perfectionist / direct-imperative / queue-completion nudges
- `no-blind-keychain-read-guard` — blocks Bash reads of platform keychain tokens
- `no-empty-commit-guard` — blocks `--allow-empty` commits without bypass
- `no-external-issue-ref-guard` — blocks `<owner>/<repo>#<num>` from non-SocketDev orgs
- `no-orphaned-staging` — blocks ending a turn with staged-but-uncommitted hunks
- `no-package-json-pnpm-overrides-guard` — keeps overrides in `pnpm-workspace.yaml`
- `no-structured-clone-prefer-json-guard` — `JSON.parse(JSON.stringify(x))` over `structuredClone`
- `no-token-in-dotenv-guard` — blocks raw token writes into `.env*` / `.envrc`
- `node-modules-staging-guard` — blocks staging `node_modules/` into git
- `parallel-agent-edit-guard` — blocks edits to files another agent owns this session
- `path-guard` — blocks multi-stage paths constructed outside `paths.mts`
- `paths-mts-inherit-guard` — sub-package `paths.mts` must `export *` from parent
- `plugin-patch-format-guard` — `# @`-header + plain `diff -u` body for plugin patches
- `pointer-comment-guard` — limits one-line "see X" pointer comments per file
- `pr-vs-push-default-reminder` — direct-push-to-main vs. PR-only-on-rejection nudge
- `prefer-rebase-over-revert-guard` — rebase unpushed commits, don't revert
- `private-name-guard` — blocks private repo / company names in public surface
- `programmatic-claude-lockdown-guard` — headless `claude`/`codex exec` must set the lockdown flags
- `prose-antipattern-reminder` — Stop-time scan for AI prose tells (em-dash chains, throat-clearing, "not X it's Y")
- `prose-tone-reminder` — merged Stop scan: teacher-tone comments + "the user" naming + speed-vs-depth choice menus (per-group disable env vars preserved)
- `provenance-publish-reminder` — `--staged` provenance lifecycle reminder
- `public-surface-reminder` — Linear refs / private names / external issue refs
- `pull-request-target-guard` — `pull_request_target` + fork-head checkout pattern
- `scan-label-in-commit-guard` — strips Socket scan labels from commit messages
- `setup-basics-tools` — SessionStart installer for baseline dev tooling
- `setup-claude-scanners` — SessionStart installer for the Claude scanner toolchain
- `setup-firewall` — SessionStart installer/starter for Socket Firewall
- `setup-misc-tools` — SessionStart installer for miscellaneous fleet tools
- `socket-token-minifier-start` — auto-starts the token-minifier proxy fail-closed
- `stale-process-sweeper` — Stop-time reaper for orphaned vitest workers
- `sweep-ds-store` — Stop-time `.DS_Store` removal (no bypass)
- `token-guard` — redacts tokens/keys/JWTs in tool output
- `uses-sha-verify-guard` — full-SHA reachability check for `uses:` pins
- `version-bump-order-guard` — version bump → CHANGELOG → tag ordering
- `vitest-include-vs-node-test-guard` — vitest vs node-test runner separation
- `workflow-uses-comment-guard` — SHA-pinned `uses:` lines need `# <tag> (YYYY-MM-DD)`
- `workflow-yaml-multiline-body-guard` — `gh ... --body-file` over inline `--body "..."`

The set drifts; the citation gate (`new-hook-claude-md-guard`) catches additions that ship without a CLAUDE.md reference.
