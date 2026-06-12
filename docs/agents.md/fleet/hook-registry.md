# Hook registry

Companion to the `### Hook registry` section in `CLAUDE.md`. Full enforcement list lives here because the inline form was pushing CLAUDE.md past the 40 KB cap.

## Layout

- **`.claude/hooks/fleet/<name>/`** — fleet-canonical hooks. Edited only in `socket-wheelhouse/template/.claude/hooks/fleet/<name>/`; cascade pushes to every fleet repo. Citation gate (`new-hook-claude-md-guard`) requires each hook to have a matching `(enforced by ...)` mention somewhere in CLAUDE.md or the linked fleet docs.
- **`.claude/hooks/repo/<name>/`** — host-repo-only hooks. Live in the downstream repo; exempt from the citation gate. Mirrors `docs/agents.md/repo/` + `scripts/repo/`.
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
- `claude-md-rule-add-guard` — blocks hand-adding a CLAUDE.md rule; routes it through `scripts/fleet/codify-rule.mts` (which writes the terse bullet within the 40KB cap + the `agents.md/{fleet,repo}/` detail doc via the AI helper)
- `codex-no-write-guard` — blocks `codex` invocations with write-intent flags
- `commit-author-guard` — canonical-identity gate on git author email
- `concurrent-cargo-build-guard` — blocks a second `cargo build --release` while one is in flight (an OOM guard). Capability-gated via the `@socket-capability cargo` header, so the cascade installs it only in repos declaring `claude.capabilities: ["cargo"]`.
- `dirty-worktree-stop-guard` — Stop-time: BLOCKS ending a turn with a dirty PRIMARY checkout (uncommitted/untracked/staged-but-uncommitted). Escapes: clean tree, a linked git worktree (defer via `git commit --no-verify` there), or `Allow dirty-worktree bypass`. Once-per-turn (suppressed when `stop_hook_active`); fail-open.
- `dogfood-cascade-reminder` — Stop-time: edited template/ but the dogfood copy is stale → cascade
- `enterprise-push-reminder` — GitHub enterprise ruleset push-property reminders
- `extension-build-current-reminder` — pairs `tools/.../extension/src/**` edits with a build
- `file-size-reminder` — Stop-time scan for source files over the 500-line soft cap
- `inline-script-defer-guard` — blocks `<script>` without `defer`/`async`/`module`
- `judgment-reminder` — perfectionist / direct-imperative / queue-completion nudges
- `mass-delete-guard` — blocks a commit deleting ≥50 files or >75% of the tree (clobbered index)
- `no-amend-foreign-commit-guard` — blocks `git commit --amend` onto an unpushed commit not authored this turn (a parallel session's work); bypass `Allow amend-foreign bypass`
- `no-blanket-file-exclusion-guard` — blocks a `max-file-lines:` exemption marker that names a self-judgment word (`legitimate`, `ok`, …) instead of a real category; no bypass
- `no-blind-keychain-read-guard` — blocks Bash reads of platform keychain tokens
- `no-cascade-transient-git-guard` — blocks cascade commits on a cherry-pick/detached/rebase HEAD
- `no-empty-commit-guard` — blocks `--allow-empty` commits without bypass
- `no-env-kill-switch-guard` — blocks adding a `disabledEnvVar` / `SOCKET_*_DISABLED` kill switch to a hook
- `no-ext-issue-ref-guard` — blocks `<owner>/<repo>#<num>` from non-SocketDev orgs
- `no-orphaned-staging` — blocks ending a turn with staged-but-uncommitted hunks
- `no-other-linters-guard` — PreToolUse Edit/Write: fleet uses oxlint + oxfmt ONLY. Blocks creating a biome/eslint/prettier/dprint config file or adding `@biomejs/biome`/`eslint`/`@eslint/*`/`@typescript-eslint/*`/`prettier`/`dprint`/`rome` to a `package.json`. Vendored upstream (`upstream/`, `vendor/`, `*-upstream`) exempt. Committed-state gate: `scripts/fleet/check/only-oxlint-oxfmt.mts`. Bypass `Allow other-linter bypass`
- `no-pkgjson-pnpm-overrides-guard` — keeps overrides in `pnpm-workspace.yaml`
- `no-pm-exec-guard` — blocks `<pm> exec` (wrapper overhead) + `npx`/`pnpm dlx`/`yarn dlx` (fetch+exec) Bash invocations; bypass `Allow pm-exec bypass`
- `no-platform-import-guard` — blocks direct `/node` or `/browser` imports of platform-split modules (http-request, logger); bypass `Allow platform-http-import bypass`
- `no-premature-commit-kill-guard` — PreToolUse Bash: blocks `run_in_background:true` on a `git commit`/`rebase`/`merge`/`cherry-pick` (its bounded ~60s pre-commit looks like a hang when backgrounded), and blocks a `pkill`/`kill` targeting a `git commit`/`git push`, a `pre-commit`/`pre-push` hook process, or a `vitest` run (killing a mid-hook run corrupts the index + leaks workers; a broad bare-verb pattern also reaps a parallel session's op in a sibling checkout). The worker-scoped reap `vitest/dist/workers` is exempt. Bypass `Allow background-git bypass`
- `no-test-in-scripts-guard` — blocks `node:test` suites under `scripts/` (they never run in CI; move to `test/unit/` vitest)
- `options-param-naming-guard` — PreToolUse Edit/Write: blocks introducing a function options-bag param named `opts` into a code file (the param is `options`, the normalized local is `opts`). AST-parsed via `_shared/acorn` (no regex; the parser handles TS). Edit-time half of the pair with the `socket/options-param-naming` lint rule. Skips `.d.ts` + test files; per-line marker `// socket-lint: allow options-param-naming`; bypass `Allow options-param-naming bypass`
- `prefer-json-clone-guard` — `JSON.parse(JSON.stringify(x))` over `structuredClone`
- `no-token-in-dotenv-guard` — blocks raw token writes into `.env*` / `.envrc`
- `no-unisolated-git-fixture-guard` — blocks a test that spawns `git` against a temp-dir fixture without isolation. Under pre-commit the inherited `GIT_DIR`/`GIT_WORK_TREE` leaks the fixture's writes onto the live `.git/config` (sets `core.bare`/junk identity, stacks junk commits). Satisfy it with the blessed one-liner `import '.git-hooks/_shared/isolate-git-env.mts'` (strips the discovery vars on load; vitest does this via its setup) or by pinning `GIT_CONFIG_GLOBAL` per-spawn. Bypass `Allow unisolated-git-fixture bypass`
- `no-verify-format-reminder` — PreToolUse Bash, non-blocking. On a `git commit`/`push --no-verify` (the `Allow no-verify bypass` path) it runs `oxfmt --check` on the changed format-relevant files and warns about any that are unformatted. Rationale: `--no-verify` skips the format gate too, so the debt would otherwise ship and fail CI. The message names the files plus the `oxfmt -c .config/fleet/oxfmtrc.json <files>` fix. Silent for `FLEET_SYNC=1` cascade commits.
- `node-modules-staging-guard` — blocks staging `node_modules/` into git
- `parallel-agent-edit-guard` — blocks edits to files another agent owns this session
- `path-guard` — blocks multi-stage paths constructed outside `paths.mts`
- `paths-mts-inherit-guard` — sub-package `paths.mts` must `export *` from parent
- `plugin-patch-format-guard` — `# @`-header + plain `diff -u` body for plugin patches
- `pointer-comment-reminder` — limits one-line "see X" pointer comments per file
- `pr-vs-push-default-reminder` — direct-push-to-main vs. PR-only-on-rejection nudge
- `prefer-rebase-over-revert-reminder` — rebase unpushed commits, don't revert
- `primary-checkout-branch-guard` — blocks `git checkout/switch <branch>` / `-b` / `-c` in the primary checkout (branch work goes in a worktree); bypass `Allow primary-branch bypass`
- `private-name-reminder` — blocks private repo / company names in public surface
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
- `synthesized-script-edit-guard` — blocks editing a cascade-synthesized `package.json` `scripts` entry (lives in `CANONICAL_SCRIPT_BODIES`) directly, since the next cascade reverts it; edit the manifest + cascade instead. Bypass: `Allow synthesized-script-edit bypass`
- `test-platform-coverage-reminder` — nudges to gate POSIX-vs-Windows path assertions in test edits
- `token-guard` — redacts tokens/keys/JWTs in tool output
- `unbacked-claim-commit-guard` — blocks `git commit`/`push` when the last turn claimed "tests pass"/"builds"/"typechecks"/"lint passes"/"render verified" with no backing command this session (shares the matcher with `stop-claim-verify-reminder`). Bypass: `Allow unbacked-claim bypass`
- `uncodified-lesson-reminder` — Stop-time: the turn wrote a `feedback`/`project` memory with an enforceable shape + no enforcer citation → nudge to codify it via `/codifying-disciplines` or `scripts/fleet/codify-rule.mts`. Scoped to the memory-write signal so it doesn't overlap `compound-lessons-reminder`. Non-blocking, no bypass.
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
- `npmrc-trust-optout-guard` — blocks the pnpm trust-aware env-expansion opt-out (`PNPM_CONFIG_NPMRC_AUTH_FILE`/`NPM_CONFIG_USERCONFIG`) + `${ENV}`-beside-`_authToken` in a committed `.npmrc`
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
