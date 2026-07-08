# Hook registry

Companion to the `### Hook registry` section in `CLAUDE.md`. Full enforcement list lives here because the inline form was pushing CLAUDE.md past the 40 KB cap.

## Layout

- **`.claude/hooks/fleet/<name>/`** — fleet-canonical hooks. Edited only in `socket-wheelhouse/template/.claude/hooks/fleet/<name>/`; cascade pushes to every fleet repo. Citation gate (`new-hook-claude-md-guard`) requires each hook to have a matching `(enforced by ...)` mention somewhere in CLAUDE.md or the linked fleet docs.
- **`.claude/hooks/repo/<name>/`** — host-repo-only hooks. Live in the downstream repo; exempt from the citation gate. Mirrors `docs/agents.md/repo/` + `scripts/repo/`.
- **`.claude/hooks/fleet/_shared/`** — utilities imported by hooks (`transcript.mts`, `stop-nudge.mts`, `shell-command.mts`, `acorn/`, etc.). Also fleet-canonical.

## Currently enforced (fleet)

The fleet hooks each cite their own trigger + bypass surface in their `README.md`. They are:

- `actionlint-on-workflow-edit` — runs actionlint when `.github/workflows/**` is edited
- `answer-questions-nudge` — surface unanswered transcript questions
- `answer-status-requests-nudge` — surface status pings before silent end-of-turn
- `auth-rotation-nudge` — reminds about expiring keychain tokens
- `avoid-cd-nudge` — keeps `cd` out of Bash, use `{ cwd }` instead
- `broken-hook-detector` — SessionStart probe for sibling hooks with missing imports
- `c8-ignore-reason-guard` — blocks a c8/v8 coverage-ignore directive with no reason
- `changelog-entry-shape-nudge` — PreToolUse Edit/Write, non-blocking. Warns when a `CHANGELOG.md` edit adds a column-0 entry bullet that links no detail into `docs/agents.md/{fleet,repo}/<topic>.md`. A CHANGELOG entry is a one-line bullet with the rationale linked to an agents.md doc (same diet pattern as the CLAUDE.md card); inline prose drifts from the doc. Sub-bullets/headings ignored. No bypass (never blocks)
- `claude-md-rule-add-guard` — blocks hand-adding a CLAUDE.md rule; routes it through `scripts/fleet/codify-rule.mts` (which writes the terse bullet within the 40KB cap + the `agents.md/{fleet,repo}/` detail doc via the AI helper)
- `claude-segmentation-guard` — PreToolUse Edit/Write, blocks a dangling top-level `.claude/{agents,commands,hooks,skills}/<name>/` entry that shadows the canonical `fleet/<name>/` copy; segment as `fleet/<name>/` or `repo/<name>/`
- `clone-reviewed-repo-nudge` — PreToolUse(Bash), non-blocking. Nudges when reviewing/cloning an external (non-SocketDev) GitHub repo toward the standard reference-clone dir (`~/.socket/_wheelhouse/repo-clones/<org>-<repo>/`, via `getSocketRepoClonesDir()`) and the smallest-practical clone flags (`--depth=1 --single-branch --filter=blob:none`). Two arms: a `gh repo view`/`--repo` of an external repo, and a `git clone` of an external repo missing those flags. No bypass (never blocks)
- `codex-no-write-guard` — blocks `codex` invocations with write-intent flags
- `convo-prose-nudge` — PreToolUse Bash, non-blocking. Fires when a `gh pr create|edit|comment` or `gh issue create|edit|comment` command's `--body`/`-b` value carries AI-scaffolding antipatterns (throat-clearing openers, closing filler, honesty announcements). Points to the prose skill (conversational mode) for the rewrite. Never blocks (exit 0).
- `commit-author-guard` — canonical-identity gate on git author email
- `commit-size-nudge` — PreToolUse Bash, non-blocking. On a `git commit`, warns when the STAGED diff exceeds ~400 changed lines of authored source (generated/lockfile/bundle/dist pathspecs excluded; `FLEET_SYNC=1` cascades exempt). The commit-time twin of `small-pr-nudge`: fleet commits stay small (one logical change) so they land clean onto local main without cross-worktree collisions. The message points at surgical `git commit -o <file>` splits.
- `concurrent-cargo-build-guard` — blocks a second `cargo build --release` while one is in flight (an OOM guard). Capability-gated via the `@socket-capability cargo` header, so the cascade installs it only in repos declaring `claude.capabilities: ["cargo"]`.
- `cross-repo-guard` — PreToolUse Edit/Write, blocks a hardcoded cross-repo path reference (`../<sibling-repo>/`) that breaks in CI / fresh clones; use `@socketsecurity/lib-stable/<subpath>` imports instead. One-line opt-out `// socket-lint: allow cross-repo`.
- `dirty-worktree-stop-guard` — Stop-time: BLOCKS ending a turn with a dirty PRIMARY checkout (uncommitted/untracked/staged-but-uncommitted). Escapes: clean tree, a linked git worktree (defer via `git commit --no-verify` there), or `Allow dirty-worktree bypass`. Once-per-turn (suppressed when `stop_hook_active`); fail-open.
- `dogfood-cascade-nudge` — Stop-time: edited template/ but the dogfood copy is stale → cascade
- `enterprise-push-nudge` — GitHub enterprise ruleset push-property reminders
- `extension-build-current-nudge` — pairs `tools/.../extension/src/**` edits with a build
- `file-size-nudge` — Stop-time scan for source files over the 500-line soft cap
- `inline-script-defer-guard` — blocks `<script>` without `defer`/`async`/`module`
- `judgment-nudge` — perfectionist / direct-imperative / queue-completion nudges
- `mass-delete-guard` — blocks a commit deleting ≥50 files or >75% of the tree (clobbered index)
- `module-noun-name-guard` — PreToolUse Write, fleet-scoped. Blocks CREATING a new `src/` module whose filename is a verb-phrase action (`trim-publish-manifest.ts`, `create-release.ts`, `fetch-packument.ts`). Fleet modules are concise NOUN names that GROUP the related functions for a domain (`manifest.ts` holds `trimPublishManifest` + `createPackageJson`); not one-method-per-file. Single-word names (`normalize.ts`) and pre-existing files are untouched. Bypass: `Allow module-noun-name bypass`. Detail: [`module-naming`](module-naming.md)
- `no-amend-foreign-commit-guard` — blocks `git commit --amend` onto an unpushed commit not authored this turn (a parallel session's work); bypass `Allow amend-foreign bypass`
- `no-blanket-file-exclusion-guard` — blocks a `max-file-lines:` exemption marker that names a self-judgment word (`legitimate`, `ok`, …) instead of a real category; no bypass
- `no-blind-keychain-read-guard` — blocks Bash reads of platform keychain tokens
- `no-cascade-transient-git-guard` — blocks cascade commits on a cherry-pick/detached/rebase HEAD
- `no-clipboard-access-guard` — PreToolUse Bash + Edit/Write: blocks clipboard READS + source-embedded OSC-52 escapes; explicit writes are allowed. Two surfaces: a clipboard READ CLI in a Bash command (`pbpaste`, `wl-paste`, `xclip -o`, `xsel` default-output), AST-parsed via the fleet shell parser — write-only tools (`pbcopy`/`wl-copy`/`clip`) and a writing `xclip`/`xsel -i` pass; or source that emits an OSC-52 clipboard escape (`ESC ]52;`). Reading is a cross-process exfil surface; putting data onto the clipboard is a deliberate operator action. Bypass `Allow clipboard-access bypass`
- `no-direct-linter-guard` — PreToolUse Bash: blocks invoking a linter/formatter binary directly (`oxlint`/`oxfmt`/`eslint`/`prettier`/`biome`/`dprint`/`rustfmt`/`gofmt`, the `node_modules/.bin/` path form, and `cargo fmt`/`cargo clippy` subcommands), matched on basename via AST parse. The fleet runs lint/format only through the script wrappers (`pnpm run lint`/`fix`/`check`/`format`, `scripts/fleet/*`), which own the `-c .config/fleet/…` flag plus ignore set. A bare formatter is configless (corrupts files) and unscoped (reformats vendored `upstream/`). Bypass `Allow direct-linter bypass`
- `no-empty-commit-guard` — blocks `--allow-empty` commits without bypass
- `no-env-kill-switch-guard` — blocks adding a `disabledEnvVar` / `SOCKET_*_DISABLED` kill switch to a hook
- `no-ext-issue-ref-guard` — blocks `<owner>/<repo>#<num>` from non-SocketDev orgs
- `no-force-push-guard` — PreToolUse Bash: blocks a `git push` carrying any force flag (`--force`, `-f`, `--force-with-lease` bare or `=<branch>:<expected-sha>`, `--force-if-includes`) unless authorized. One phrase unlocks both the bare and lease forms; the block message teaches the fleet default `--force-with-lease=<branch>:$(git rev-parse origin/<branch>)`. Honors the `SQUASH_HISTORY=1` sentinel for the `squashing-history` skill's force-push. Universal, fires in every repo, not fleet-only. Bypass `Allow force-push bypass` (legacy aliases: `Allow force-with-lease bypass`, `Allow force-push-hard bypass`)
- `no-orphaned-staging` — blocks ending a turn with staged-but-uncommitted hunks
- `no-other-linters-guard` — PreToolUse Edit/Write: fleet uses oxlint + oxfmt ONLY. Blocks creating a biome/eslint/prettier/dprint config file or adding `@biomejs/biome`/`eslint`/`@eslint/*`/`@typescript-eslint/*`/`prettier`/`dprint`/`rome` to a `package.json`. Vendored upstream (`upstream/`, `vendor/`, `*-upstream`) exempt. Committed-state gate: `scripts/fleet/check/linters-are-oxlint-oxfmt-only.mts`. Bypass `Allow other-linter bypass`
- `no-pkgjson-pnpm-overrides-guard` — keeps overrides in `pnpm-workspace.yaml`
- `no-pm-exec-guard` — blocks `<pm> exec` (wrapper overhead) + `npx`/`pnpm dlx`/`yarn dlx` (fetch+exec) Bash invocations; bypass `Allow pm-exec bypass`
- `no-platform-import-guard` — blocks direct `/node` or `/browser` imports of platform-split modules (http-request, logger); bypass `Allow platform-http-import bypass`
- `no-pr-from-default-branch-guard` — PreToolUse Bash: blocks `gh pr create` when the PR head resolves to the default branch (`main`/`master`/resolved default), including `--head <owner>:main`; bypass `Allow pr-from-default-branch bypass`
- `no-pr-from-default-checkout-guard` — PreToolUse Bash: blocks `gh pr create` run from a checkout sitting on its default branch (current branch === default), even when `--head` names a feature branch; bypass `Allow pr-from-default-checkout bypass`
- `no-premature-commit-kill-guard` — PreToolUse Bash: blocks `run_in_background:true` on a `git commit`/`rebase`/`merge`/`cherry-pick` (its bounded ~60s pre-commit looks like a hang when backgrounded), and blocks a `pkill`/`kill` targeting a `git commit`/`git push`, a `pre-commit`/`pre-push` hook process, or a `vitest` run (killing a mid-hook run corrupts the index + leaks workers; a broad bare-verb pattern also reaps a parallel session's op in a sibling checkout). The worker-scoped reap `vitest/dist/workers` is exempt. Bypass `Allow background-git bypass`
- `no-private-path-in-source-guard` — PreToolUse Edit/Write/MultiEdit: blocks a private/internal path (`.claude/plans|reports/…`, `socket-<repo>/.claude/…`, `/Users/<name>/…`, `../socket-<repo>/…`) inside a SOURCE-code comment; markdown / docs / `.claude/` files are out of scope. Bypass `Allow private-path-in-source bypass`
- `no-screenshot-guard` — PreToolUse Bash: blocks a screen-capture invocation (`screencapture`, `scrot`, `grim`, `import`, `gnome-screenshot`, `spectacle`, `maim`, `flameshot`, `snippingtool`/`SnippingTool.exe`), AST-parsed via the fleet shell parser. A screenshot can capture any window on the display (a password manager, a 2FA code) and write it to a file the agent then reads, an exfiltration surface. Fleet tooling renders known pages to PNG via the rendering-chromium-to-png skill, never the live desktop. Bypass `Allow screenshot bypass`
- `no-test-in-scripts-guard` — blocks `node:test` suites under `scripts/` (they never run in CI; move to `test/unit/` vitest)
- `options-param-naming-guard` — PreToolUse Edit/Write: blocks introducing a function options-bag param named `opts` into a code file (the param is `options`, the normalized local is `opts`). AST-parsed via `_shared/acorn` (no regex; the parser handles TS). Edit-time half of the pair with the `socket/options-param-naming` lint rule. Skips `.d.ts` + test files; per-line marker `// socket-lint: allow options-param-naming`; bypass `Allow options-param-naming bypass`
- `prefer-json-clone-guard` — `JSON.parse(JSON.stringify(x))` over `structuredClone`
- `no-token-in-dotenv-guard` — blocks raw token writes into `.env*` / `.envrc`
- `no-unisolated-git-fixture-guard` — blocks a test that spawns `git` against a temp-dir fixture without isolation. Under pre-commit the inherited `GIT_DIR`/`GIT_WORK_TREE` leaks the fixture's writes onto the live `.git/config` (sets `core.bare`/junk identity, stacks junk commits). Satisfy it with the blessed one-liner `import '.git-hooks/_shared/isolate-git-env.mts'` (strips the discovery vars on load; vitest does this via its setup) or by pinning `GIT_CONFIG_GLOBAL` per-spawn. Bypass `Allow unisolated-git-fixture bypass`
- `no-verify-format-nudge` — PreToolUse Bash, non-blocking. On a `git commit`/`push --no-verify` (the `Allow no-verify bypass` path) it runs `oxfmt --check` on the changed format-relevant files and warns about any that are unformatted. Rationale: `--no-verify` skips the format gate too, so the debt would otherwise ship and fail CI. The message names the files plus the `oxfmt -c .config/fleet/oxfmtrc.json <files>` fix. Silent for `FLEET_SYNC=1` cascade commits.
- `node-modules-staging-guard` — blocks staging `node_modules/` into git
- `parallel-agent-edit-guard` — blocks edits to files another agent owns this session
- `parallel-agent-on-stop-nudge` — Stop hook: warns when dirty paths changed recently that this session did not author — fingerprint of a concurrent Claude session sharing the same checkout
- `parallel-agent-removal-nudge` — Stop hook: warns when files this session READ have since vanished or moved on disk without this session deleting them (`rm`/`git rm`/`safeDelete`/`unlink`) — the fingerprint of a parallel Claude session sharing the same `.git/` removing or moving files mid-flight
- `parallel-agent-staging-guard` — PreToolUse Bash: when foreign dirty paths are present, blocks a git op that would sweep up / hide / destroy another agent's in-flight work (`git add -A`/`.`/`-u`, `commit -a`, `stash`, `reset --hard`, `checkout`/`switch`, `restore`). AST-parsed via the fleet shell parser; fires only when the parallel-agent signal is live. Bypass `Allow parallel-agent-staging bypass`
- `path-guard` — blocks multi-stage paths constructed outside `paths.mts`
- `paths-mts-inherit-guard` — sub-package `paths.mts` must `export *` from parent
- `plugin-patch-format-guard` — `# @`-header + plain `diff -u` body for plugin patches
- `pnpm-filter-zero-match-nudge` — PostToolUse Bash, non-blocking. Fires when a `pnpm --filter <name> run x` command's output contains "No projects matched the filters". pnpm exits 0 silently in that case; the no-op looks like success. Nudges to verify the package name via `pnpm ls --filter <name> --depth -1`. Never blocks.
- `pointer-comment-nudge` — limits one-line "see X" pointer comments per file
- `pr-vs-push-default-nudge` — direct-push-to-main vs. PR-only-on-rejection nudge
- `prefer-rebase-over-revert-nudge` — rebase unpushed commits, don't revert
- `primary-checkout-branch-guard` — blocks `git checkout/switch <branch>` / `-b` / `-c` in the primary checkout (branch work goes in a worktree); bypass `Allow primary-branch bypass`
- `private-name-nudge` — blocks private repo / company names in public surface
- `claude-lockdown-guard` — headless `claude`/`codex exec` must set the lockdown flags
- `anti-prose-guard` — PreToolUse block on AI prose tells (em-dash chains, throat-clearing, "not X it's Y", hedging adverbs) in CHANGELOG.md / docs/**/*.md / README.md; bypass `Allow prose-antipattern bypass`
- `reply-prose-nudge` — merged Stop scan: teacher-tone comments + "the user" naming + speed-vs-depth choice menus + self-narration (status-recap padding, "now let me" openers, hedges, apology-padding); per-group disable env vars preserved
- `provenance-publish-nudge` — `--staged` provenance lifecycle reminder
- `public-surface-nudge` — Linear refs / private names / external issue refs
- `pull-request-target-guard` — `pull_request_target` + fork-head checkout pattern
- `push-protected-branch-guard` — PreToolUse Bash: blocks a `git push` that would UPDATE a protected remote branch (`main`/`master`) when the user only asked to "land"/"commit"/"surgically commit" (which mean a LOCAL commit). Parses the destination ref of every refspec (`main`, `HEAD:main`, `<sha>:refs/heads/main`, `+main`/`--force`, the `:main` delete) plus the bare-push-on-a-main-tracking-checkout case, via `_shared/push-refspec.mts`. Allows every feature-branch / PR-opening push (`git push -u origin feature-x`) and all non-push git. A sub-agent cannot self-authorize — only an explicit user-turn "push" directive (`Allow push to main`) lifts the block. Fail-open on parse ambiguity. Bypass `Allow push to main` / `Allow push-to-protected bypass`
- `scan-label-in-commit-guard` — strips Socket scan labels from commit messages
- `setup-basics-tools` — SessionStart installer for baseline dev tooling
- `setup-claude-scanners` — SessionStart installer for the Claude scanner toolchain
- `setup-firewall` — SessionStart installer/starter for Socket Firewall
- `setup-misc-tools` — SessionStart installer for miscellaneous fleet tools
- `setup-security-tools` — SessionStart SFW-shim integrity checker (flags shims whose dlx-cached target vanished) + the Socket security-tool installer (`install.mts`: SFW, AgentShield, Zizmor, TruffleHog, … + token-to-keychain)
- `skill-usage-logger` — PreToolUse telemetry-only logger: appends one TSV line per Skill invocation to `~/.claude/projects/<project>/.skill-usage.log`; falls open on every error path
- `headroom-proxy-start` — auto-starts the telemetry-locked headroom proxy fail-closed
- `stale-process-sweeper` — Stop-time reaper for orphaned vitest workers
- `sweep-ds-store` — Stop-time `.DS_Store` removal (no bypass)
- `synthesized-script-edit-guard` — blocks editing a cascade-synthesized `package.json` `scripts` entry (lives in `CANONICAL_SCRIPT_BODIES`) directly, since the next cascade reverts it; edit the manifest + cascade instead. Bypass: `Allow synthesized-script-edit bypass`
- `test-platform-coverage-nudge` — nudges to gate POSIX-vs-Windows path assertions in test edits
- `token-guard` — redacts tokens/keys/JWTs in tool output
- `unbacked-claim-commit-guard` — blocks `git commit`/`push` when the last turn claimed "tests pass"/"builds"/"typechecks"/"lint passes"/"render verified" with no backing command this session (shares the matcher with `stop-claim-verify-nudge`). Bypass: `Allow unbacked-claim bypass`
- `uncodified-lesson-nudge` — Stop-time: the turn wrote a `feedback`/`project` memory with an enforceable shape + no enforcer citation → nudge to codify it via `/codifying-disciplines` or `scripts/fleet/codify-rule.mts`. Scoped to the memory-write signal so it doesn't overlap `compound-lessons-nudge`. Non-blocking, no bypass.
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
- `npm-otp-flow-nudge` — npm 2FA registry ops need an interactive-TTY OTP (run in a real terminal)

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
- `ai-config-drift-nudge` — Stop-time nudge on AI-config drift
- `claude-code-action-lockdown-guard` — enforces Agents-Rule-of-Two on CI agent workflows
- `no-shell-injection-bypass-guard` — blocks allowlist-evasion shell constructs (`=cmd`, `<()`/`>()`/`=()`, zsh-module builtins); bypass `Allow shell-injection bypass`
- `proc-environ-exfil-guard` — blocks reads of `/proc/*/environ`-style secret exfil
- `untrusted-coauthor-guard` — blocks a `Co-authored-by:` trailer crediting an identity not on the cascaded `git-authors.json` allowlist (a drive-by issue/PR from a new low-history account is untrusted input, not a contributor to auto-credit); bypass `Allow untrusted-coauthor bypass`
- `issue-autolink-nudge` — warns that a bare `#N` in a GitHub-destined surface (commit/PR/issue/comment/release body) auto-links to an unrelated issue/PR; suggests backticking or reshaping when `#N` means a list item / task number (advisory, never blocks)

The set drifts; the citation gate (`new-hook-claude-md-guard`) catches additions that ship without a CLAUDE.md reference.
