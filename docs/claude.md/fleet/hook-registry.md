# Hook registry

Companion to the `### Hook registry` section in `CLAUDE.md`. Full enforcement list lives here because the inline form was pushing CLAUDE.md past the 40 KB cap.

## Layout

- **`.claude/hooks/fleet/<name>/`** — fleet-canonical hooks. Edited only in `socket-wheelhouse/template/.claude/hooks/fleet/<name>/`; cascade pushes to every fleet repo. Citation gate (`new-hook-claude-md-guard`) requires each hook to have a matching `(enforced by ...)` mention somewhere in CLAUDE.md or the linked fleet docs.
- **`.claude/hooks/repo/<name>/`** — host-repo-only hooks. Live in the downstream repo; exempt from the citation gate. Mirrors `docs/claude.md/repo/` + `scripts/repo/`.
- **`.claude/hooks/fleet/_shared/`** — utilities imported by hooks (`transcript.mts`, `stop-reminder.mts`, `shell-command.mts`, `acorn/`, etc.). Also fleet-canonical.

## Currently enforced (fleet)

The fleet hooks each cite their own trigger + bypass surface in their `README.md`. They are:

- `actionlint-on-workflow-edit` — runs actionlint when `.github/workflows/**` is edited
- `answer-questions-reminder` — surface unanswered transcript questions
- `answer-status-requests-reminder` — surface status pings before silent end-of-turn
- `auth-rotation-reminder` — reminds about expiring keychain tokens
- `avoid-cd-reminder` — keeps `cd` out of Bash, use `{ cwd }` instead
- `broken-hook-detector` — SessionStart probe for sibling hooks with missing imports
- `c8-ignore-reason-guard` — blocks a c8/v8 coverage-ignore directive with no reason
- `codex-no-write-guard` — blocks `codex` invocations with write-intent flags
- `commit-author-guard` — canonical-identity gate on git author email
- `dogfood-cascade-reminder` — Stop-time: edited template/ but the dogfood copy is stale → cascade
- `enterprise-push-reminder` — GitHub enterprise ruleset push-property reminders
- `extension-build-current-guard` — pairs `tools/.../extension/src/**` edits with a build
- `file-size-reminder` — Stop-time scan for source files over the 500-line soft cap
- `inline-script-defer-guard` — blocks `<script>` without `defer`/`async`/`module`
- `judgment-reminder` — perfectionist / direct-imperative / queue-completion nudges
- `mass-delete-guard` — blocks a commit deleting ≥50 files or >75% of the tree (clobbered index)
- `no-blind-keychain-read-guard` — blocks Bash reads of platform keychain tokens
- `no-cascade-transient-git-guard` — blocks cascade commits on a cherry-pick/detached/rebase HEAD
- `no-empty-commit-guard` — blocks `--allow-empty` commits without bypass
- `no-env-kill-switch-guard` — blocks adding a `disabledEnvVar` / `SOCKET_*_DISABLED` kill switch to a hook
- `no-ext-issue-ref-guard` — blocks `<owner>/<repo>#<num>` from non-SocketDev orgs
- `no-orphaned-staging` — blocks ending a turn with staged-but-uncommitted hunks
- `no-pkgjson-pnpm-overrides-guard` — keeps overrides in `pnpm-workspace.yaml`
- `no-pm-exec-guard` — blocks `<pm> exec` (wrapper overhead) + `npx`/`pnpm dlx`/`yarn dlx` (fetch+exec) Bash invocations; bypass `Allow pm-exec bypass`
- `no-platform-import-guard` — blocks direct `/node` or `/browser` imports of platform-split modules (http-request, logger); bypass `Allow platform-http-import bypass`
- `no-test-in-scripts-guard` — blocks `node:test` suites under `scripts/` (they never run in CI; move to `test/unit/` vitest)
- `prefer-json-clone-guard` — `JSON.parse(JSON.stringify(x))` over `structuredClone`
- `no-token-in-dotenv-guard` — blocks raw token writes into `.env*` / `.envrc`
- `node-modules-staging-guard` — blocks staging `node_modules/` into git
- `parallel-agent-edit-guard` — blocks edits to files another agent owns this session
- `path-guard` — blocks multi-stage paths constructed outside `paths.mts`
- `paths-mts-inherit-guard` — sub-package `paths.mts` must `export *` from parent
- `plugin-patch-format-guard` — `# @`-header + plain `diff -u` body for plugin patches
- `pointer-comment-guard` — limits one-line "see X" pointer comments per file
- `pr-vs-push-default-reminder` — direct-push-to-main vs. PR-only-on-rejection nudge
- `prefer-rebase-over-revert-guard` — rebase unpushed commits, don't revert
- `primary-checkout-branch-guard` — blocks `git checkout/switch <branch>` / `-b` / `-c` in the primary checkout (branch work goes in a worktree); bypass `Allow primary-branch bypass`
- `private-name-guard` — blocks private repo / company names in public surface
- `claude-lockdown-guard` — headless `claude`/`codex exec` must set the lockdown flags
- `prose-antipattern-guard` — PreToolUse block on AI prose tells (em-dash chains, throat-clearing, "not X it's Y", hedging adverbs) in CHANGELOG.md / docs/**/*.md / README.md; bypass `Allow prose-antipattern bypass`
- `yakback-reminder` — merged Stop scan: teacher-tone comments + "the user" naming + speed-vs-depth choice menus + self-narration (status-recap padding, "now let me" openers, hedges, apology-padding); per-group disable env vars preserved
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
- `synthesized-script-edit-reminder` — warns when you edit a cascade-synthesized `package.json` `scripts` entry (lives in `CANONICAL_SCRIPT_BODIES`) directly; edit the manifest + cascade instead
- `test-platform-coverage-reminder` — nudges to gate POSIX-vs-Windows path assertions in test edits
- `token-guard` — redacts tokens/keys/JWTs in tool output
- `uses-sha-verify-guard` — full-SHA reachability check for `uses:` pins
- `version-bump-order-guard` — version bump → CHANGELOG → tag ordering
- `vitest-vs-node-test-guard` — vitest vs node-test runner separation
- `workflow-uses-comment-guard` — SHA-pinned `uses:` lines need `# <tag> (YYYY-MM-DD)`
- `workflow-multiline-body-guard` — `gh ... --body-file` over inline `--body "..."`

Tooling + package manager:

- `no-strip-types-guard` — blocks `--experimental-strip-types`
- `no-tail-install-out-guard` — blocks piping install/check/test/build to `tail`/`head` (hides SFW warnings)
- `prefer-pipx-over-pip-guard` — blocks `pip`/`pip3`; use `pypa-tool` or `pipx install <pkg>==<ver>`
- `reserved-script-dir-guard` — blocks build/output dir names under `scripts/`; bypass `Allow reserved-script-dir bypass`
- `npm-otp-flow-reminder` — npm 2FA registry ops need an interactive-TTY OTP (run in a real terminal)

Supply-chain hygiene:

- `check-new-deps` — Socket-scores newly added dependencies at edit time
- `minimum-release-age-guard` — enforces the 7-day soak on new deps
- `soak-exclude-date-guard` — a soak-bypass entry needs a `# published: … | removable: …` annotation
- `soak-exclude-scope-guard` — soak-exclude entries are exact-pin + scoped
- `no-pkgjson-pnpm-overrides-guard` — version-range pins go in `pnpm-workspace.yaml` `overrides:`, not `package.json`
- `bundle-flags-guard` — guards bundler trust/exotic-subdep flags
- `catch-message-guard` — keeps catch-block error messages thorough
- `target-arch-env-guard` — guards cross-arch build env vars
- `trust-downgrade-guard` — blocks weakening a `trustPolicy`/`trust-all`/`blockExoticSubdeps` gate

Prompt-injection + agent-DoS:

- `prompt-injection-guard` — flags agent-overriding text in deps/upstreams/fixtures/fetched docs
- `ai-config-poisoning-guard` — blocks `.claude`/`.cursor`/`.gemini`/`.vscode` writes that bypass a guard, exfiltrate, or store tokens off-keychain
- `ai-config-drift-reminder` — Stop-time nudge on AI-config drift
- `claude-code-action-lockdown-guard` — enforces Agents-Rule-of-Two on CI agent workflows
- `no-shell-injection-bypass-guard` — blocks allowlist-evasion shell constructs (`=cmd`, `<()`/`>()`/`=()`, zsh-module builtins); bypass `Allow shell-injection bypass`
- `proc-environ-exfil-guard` — blocks reads of `/proc/*/environ`-style secret exfil

The set drifts; the citation gate (`new-hook-claude-md-guard`) catches additions that ship without a CLAUDE.md reference.
