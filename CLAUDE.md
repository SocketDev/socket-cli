# CLAUDE.md

**MANDATORY**: Act as principal-level engineer. Follow these guidelines exactly.

<!-- BEGIN FLEET-CANONICAL — sync via socket-wheelhouse/scripts/sync-scaffolding.mts. Do not edit downstream. -->

## 📚 Wheelhouse Standards

### Identifying users

Identify users by git credentials and use their actual name. Use "you/your" when speaking directly; use names when referencing contributions (enforced by `.claude/hooks/fleet/prose-tone-reminder/`).

### Parallel Claude sessions

🚨 Multiple Claude sessions may target the same checkout (parallel agents, terminals, or worktrees on the same `.git/`). **The umbrella rule:** never run a git command that mutates state belonging to a path other than the file you just edited. Forbidden in the primary checkout: `git stash`, `git add -A` / `git add .` (enforced by `.claude/hooks/fleet/overeager-staging-guard/`; bypass: `Allow add-all bypass`), `git checkout/switch <branch>`, `git reset --hard <non-HEAD>`. Branch work goes in a `git worktree`. Cross-repo imports via `@socketsecurity/lib/...` only, never `../<sibling-repo>/...` (enforced by `.claude/hooks/fleet/cross-repo-guard/`). Dirty paths you didn't author this session + that changed recently are likely another live agent — never `add -A`/`stash`/`reset --hard`/`checkout`/`restore` over them; stage only your own files (enforced by `.claude/hooks/fleet/parallel-agent-on-stop-reminder/`, enforced by `.claude/hooks/fleet/parallel-agent-staging-guard/`; bypass `Allow parallel-agent-staging bypass`). **Why:** 2026-05-27 a session's own `pnpm check` surfaced another agent's migration files; it nearly committed them. Full prohibition list + worktree recipe in [`docs/claude.md/fleet/parallel-claude-sessions.md`](docs/claude.md/fleet/parallel-claude-sessions.md).

### Default branch fallback

Never hard-code `main` in scripts — a few legacy repos still use `master`. Resolve via `git symbolic-ref refs/remotes/origin/HEAD`, fall back to `main` then `master`:

```bash
BASE=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')
[ -z "$BASE" ] && git show-ref --verify --quiet refs/remotes/origin/main && BASE=main
[ -z "$BASE" ] && git show-ref --verify --quiet refs/remotes/origin/master && BASE=master
BASE="${BASE:-main}"
```

Apply in: worktree creation, base-ref resolution for `git diff`/`git rev-list`, PR base detection, hook scripts walking history. Doc examples may write `main` for clarity; scripts must look up. Order matters — `main → master` matches fleet reality; reversing would mispick during rename migrations (enforced by `.claude/hooks/fleet/default-branch-guard/`).

### Public-surface hygiene

🚨 Never write a real customer / company name, private repo / internal project name, or Linear ref (`SOC-123`, `ENG-456`, Linear URLs) into a commit, PR, issue, comment, or release note. No denylist — a denylist is itself a leak (enforced by `.claude/hooks/fleet/{private-name-guard,public-surface-reminder}/`).

🚨 Never `gh workflow run|dispatch` against publish / release / build-release workflows (enforced by `.claude/hooks/fleet/release-workflow-guard/`). Bypass: `gh workflow run -f dry-run=true` (workflow declares `dry-run:` input) OR `Allow workflow-dispatch bypass: <workflow>` typed verbatim. `workflow_dispatch.inputs` keys are kebab-case.

🚨 **Workflow YAML invariants:** SHA-pinned `uses:` lines need a `# <tag> (YYYY-MM-DD)` comment; `run:` blocks with multi-line `gh ... --body "..."` break YAML — always `--body-file <path>`; `pull_request_target` is privileged and never combines with fork-head checkout + execute. External-issue refs (`<owner>/<repo>#<num>`) in commits / PR bodies spam upstream maintainers — only `SocketDev/<repo>#<num>` is allowed inline; link upstream refs in PR _description prose_ instead. Bypass: `Allow external-issue-ref bypass`.

Full ruleset + threat model + bypass surface in [`docs/claude.md/fleet/public-surface-hygiene.md`](docs/claude.md/fleet/public-surface-hygiene.md) and [`docs/claude.md/fleet/pull-request-target.md`](docs/claude.md/fleet/pull-request-target.md).

### Canonical README

🚨 Root `README.md` follows the fleet skeleton — 5 level-2 sections in order (Why this repo exists / Install / Usage / Development / License), no `socket-wheelhouse` mentions (it's a private repo), no sibling-relative script commands (e.g. `node ../socket-foo/scripts/...` fails for outside readers). Canonical skeleton: `socket-wheelhouse/template/README.md`. Bypass: `Allow readme-fleet-shape bypass` (enforced by `.claude/hooks/fleet/readme-fleet-shape-guard/`).

### Commits & PRs

🚨 Conventional Commits `<type>(<scope>): <description>`, lowercase type, NO AI attribution (enforced by `.claude/hooks/fleet/commit-message-format-guard/`, enforced by `.claude/hooks/fleet/commit-pr-reminder/`; bypasses `Allow commit-format bypass` / `Allow ai-attribution bypass`). Push direct → PR only on rejection. NEVER push, open PRs, file issues, or create releases against a non-fleet repo without confirmation (bypasses `Allow non-fleet-push bypass` / `Allow non-fleet-publish bypass`; enforced by `.claude/hooks/fleet/no-non-fleet-push-guard/`, enforced by `.claude/hooks/fleet/non-fleet-pr-issue-ask-guard/`).

Full ruleset — open-PR edits, Bugbot inline replies, rebase-over-revert for unpushed commits, no-empty-commits, commit-author canonical identity, scan-label scrubbing, enterprise-ruleset bypass — in [`docs/claude.md/fleet/commit-cadence-format.md`](docs/claude.md/fleet/commit-cadence-format.md).

### Prose authoring (commit bodies, PRs, CHANGELOG, docs)

🚨 Run human-facing prose through the `prose` skill before it lands: commit message bodies, PR descriptions, CHANGELOG entries, README sections, `docs/` markdown. The skill catches throat-clearing openers, "not X, it's Y" contrasts, em-dash chains, adverbs doing vague work, metronomic rhythms. Subject lines stay terse and imperative under `commit-message-format-guard`. Cascade commits and bot output are exempt. Full rules: [`.claude/skills/fleet/prose/SKILL.md`](.claude/skills/fleet/prose/SKILL.md).

### Squash-history opt-in

Some fleet repos squash the default branch on a cadence — currently socket-addon, socket-bin, socket-btm, sdxgen, stuie (declared via `optIns: ['squash-history']` in `template/.claude/skills/cascading-fleet/lib/fleet-repos.json`). When working in an opted-in repo, prefer one consolidated commit per logical change over a long fan of tiny WIP commits; the `squashing-history` skill is the documented way to collapse history when it grows long. Threshold reminder + bypass `Allow squash-history-reminder bypass` (enforced by `.claude/hooks/fleet/squash-history-reminder/`).

### Version bumps & immutable releases

🚨 Bump: (1) pre-bump wave; (2) CHANGELOG public-facing only, no empty sections (enforced by `.claude/hooks/fleet/changelog-no-empty-sections-guard/`; bypass `Allow changelog-empty-section bypass`); (3) `chore: bump version to X.Y.Z` LAST; (4) `git tag vX.Y.Z` (`version-bump-order-guard`); (5) user dispatches publish. GH Releases ship **immutable** via 3-step `gh release create --draft` → `gh release upload` → `gh release edit --draft=false`; single-call form forbidden (enforced by `.claude/hooks/fleet/immutable-release-pattern-guard/`; bypass `Allow immutable-release-pattern bypass`). Detail: [`docs/claude.md/fleet/version-bumps.md`](docs/claude.md/fleet/version-bumps.md).

### Programmatic Claude calls

🚨 Workflows / skills / scripts that invoke `claude` CLI or `@anthropic-ai/claude-agent-sdk` MUST set all four lockdown flags: `tools`, `allowedTools`, `disallowedTools`, `permissionMode: 'dontAsk'`. Never `default` mode in headless contexts. Never `bypassPermissions`. See `.claude/skills/fleet/locking-down-programmatic-claude/SKILL.md`.

### Tooling

🚨 **Package manager: `pnpm`** — `pnpm run foo --flag`; `pnpm install` after `package.json` edits. NEVER `npx`/`pnpm dlx`/`yarn dlx` — use `pnpm exec`/`pnpm run`. NEVER `--experimental-strip-types`. NEVER pipe install/check/test/build to `tail`/`head` (SFW footer hides warnings; use `grep -iE "warning|error|ignored|fail"`). `package.json` `allowScripts` mirrors `pnpm-workspace.yaml` `allowBuilds`. **`-stable` self-import:** `scripts/**` + `.claude/hooks/**` via `-stable` alias (autofix `socket/prefer-stable-self-import`). **Python: NEVER `pip`/`pip3`** — fleet code goes through `@socketsecurity/lib/external-tools/pypa-tool` (4-tier VFS→PATH→DLX-venv→fail); dev shortcut `pipx install <pkg>==<ver>` (enforced by `.claude/hooks/fleet/{no-experimental-strip-types-guard,no-tail-install-output-guard,prefer-pipx-over-pip-guard}/`).

🚨 **Supply-chain hygiene.** New deps Socket-scored at edit time; 7-day `minimumReleaseAge` soak is malware protection; soak-bypass entries need `# published: YYYY-MM-DD | removable: YYYY-MM-DD` annotations. Dep overrides in `pnpm-workspace.yaml`, never `package.json` `pnpm.overrides`. **Never weaken a trust gate** (`trustPolicy: no-downgrade`, `--config.trustPolicy=trust-all`, `blockExoticSubdeps`) — fix stale lockfiles via the soak/exclude entry (enforced by `.claude/hooks/fleet/{check-new-deps,minimum-release-age-guard,soak-exclude-date-annotation-guard,soak-exclude-scope-guard,no-package-json-pnpm-overrides-guard,bundle-flags-guard,catch-message-guard,target-arch-env-guard,trust-downgrade-guard}/`).

Full ruleset (docs lead with pnpm, `packageManager` field, `.config/` placement, `.mts` runners, monorepo `engines.node`, vitest/node-test runner separation, `npm-run-all2` + `node --run` opt-in) in [`docs/claude.md/fleet/tooling.md`](docs/claude.md/fleet/tooling.md).

🚨 **Database:** PostgreSQL + Drizzle ORM (driver `node:smol-sql`, `pglite` for tests). Most repos need none. [`docs/claude.md/fleet/database.md`](docs/claude.md/fleet/database.md).

### Claude Code plugin pins

🚨 Fleet-blessed Claude Code plugins are SHA-pinned in the wheelhouse-canonical [`.claude-plugin/marketplace.json`](../.claude-plugin/marketplace.json), with companion human-readable metadata (pin date, pinner) in [`.claude-plugin/README.md`](../.claude-plugin/README.md). The pair is enforced together: every `plugins[].source.sha` in `marketplace.json` must have a row in the README table with matching `version` + `sha` + an ISO-8601 `date`. Same staleness signal the GHA `uses:` SHA-pin comments carry. Bump the SHA → bump the row. Run `pnpm run install-claude-plugins` to reconcile a machine to the pinned set — adds the marketplace + installs each plugin at its pinned SHA, then reapplies `scripts/plugin-patches/*.patch` for upstream bugs we can't land yet (fleet `# @`-header + plain `diff -u` body, `patch -p1`; regenerate via `regenerating-plugin-patches`; full spec [`docs/claude.md/fleet/plugin-cache-patches.md`](docs/claude.md/fleet/plugin-cache-patches.md)) (enforced by `.claude/hooks/fleet/marketplace-comment-guard/`, `.claude/hooks/fleet/plugin-patch-format-guard/`).

### Token minification

Two surfaces apply lossless, deterministic compression to Claude tool_result payloads (JSON whitespace, `cat -n` prefixes, blank-line runs; no ML). **Wire-level proxy** `@socketsecurity/token-minifier` ([`packages/`](../packages/socket-token-minifier/)) sits between Claude Code and api.anthropic.com via `ANTHROPIC_BASE_URL=http://localhost:7779`; auto-started **fail-closed** by `socket-token-minifier-start` (sets the env var only if healthy). **In-context hook** `minify-mcp-output` rewrites MCP results via `hookSpecificOutput.updatedMCPToolOutput` (built-in Read/Bash have no such channel — use the proxy) (enforced by `.claude/hooks/fleet/minify-mcp-output/`, `.claude/hooks/fleet/socket-token-minifier-start/`).

### Fix it, don't defer

🚨 See a lint/type/test error or broken comment in your reading window — fix it. Stop current task, fix the issue in a sibling commit, resume. Don't label as "pre-existing", "unrelated", or "out of scope" — the labels are rationalizations (enforced by `.claude/hooks/fleet/excuse-detector/`).

🚨 Don't blame the user (or "the linter") when your own edits get reverted between turns. The cause is almost always your own scripts: pre-commit autofix, sync-cascade from `template/`, oxlint --fix. Investigate with `git log -S`, run pre-commit phases in isolation, diff `template/` canonical sources. Only attribute to the user with direct evidence (enforced by `.claude/hooks/fleet/dont-blame-user-reminder/`).

🚨 Never offer "fix vs accept-as-gap" as a choice — pick the fix.

Exceptions (state the trade-off and ask): genuinely large refactor on a small bug, file belongs to another session, fix needs off-machine action.

### Don't leave the worktree dirty

🚨 Finish a code change → **commit it**. Never end a turn with uncommitted edits, untracked files, or staged-but-uncommitted hunks. Surgical staging only (`git add <specific-file>`, never `-A` / `.`); stage and commit in the same Bash call. If you can't commit yet (mid-refactor, failing tests, waiting on user), announce it in the turn summary — silent dirty worktrees are the failure mode. Worktrees from `git worktree add` must be left clean (committed + pushed) before `git worktree remove`. Enforced by `.claude/hooks/fleet/no-orphaned-staging/` + `.claude/hooks/fleet/node-modules-staging-guard/` (bypass: `Allow node-modules-staging bypass`); end-of-turn dirty-worktree scan (enforced by `.claude/hooks/fleet/dirty-worktree-on-stop-reminder/`). Full rules + parallel-session rationale in [`docs/claude.md/fleet/worktree-hygiene.md`](docs/claude.md/fleet/worktree-hygiene.md).

### Smallest chunks, land ASAP

🚨 Smallest possible chunks; land ASAP via direct-push-to-main. Don't accumulate work across worktrees or long-lived branches; each unmerged branch is in-flight state that has to be rebased and reconciled later. Past incident: 4 sibling wheelhouse worktrees (2 dead, 2 needing rebase) burned a turn on consolidation. **How to apply:** finish a branch the session it's opened; consolidate any pile-up at session start before resuming the queue. <!--advisory-->

### Commit cadence & message format

🚨 Commit early, commit often. Every commit follows [Conventional Commits 1.0](https://www.conventionalcommits.org/en/v1.0.0/): lowercase `<type>[(scope)][!]: <description>` with type ∈ { feat, fix, chore, docs, style, refactor, perf, test, build, ci, revert }. No AI attribution anywhere. Bypass: `Allow commit-format bypass` or `Allow ai-attribution bypass`. Full rationale + examples + edge cases in [`docs/claude.md/fleet/commit-cadence-format.md`](docs/claude.md/fleet/commit-cadence-format.md) (enforced by `.claude/hooks/fleet/commit-message-format-guard/`, enforced by `.claude/hooks/fleet/commit-pr-reminder/`).

### Don't disable lint rules

🚨 Adding `"rule-name": "off"` (or `"warn"`) to any oxlint/eslint config weakens the gate for every file matching that selector. Fix the underlying code instead. For genuine single-call-site exemptions, use `oxlint-disable-next-line <rule> -- <reason>` on the specific line. Bypass: `Allow disable-lint-rule bypass`. Full rationale + recipes in [`docs/claude.md/fleet/no-disable-lint-rule.md`](docs/claude.md/fleet/no-disable-lint-rule.md) (enforced by `.claude/hooks/fleet/no-disable-lint-rule-guard/`).

### Extension build hygiene

🚨 The trusted-publisher Chrome extension at `tools/trusted-publisher-extension/` is bundled via rolldown. Commits that touch `tools/trusted-publisher-extension/src/**` MUST be paired with a successful `pnpm --filter @socketsecurity/trusted-publisher-extension build` so the bundled output stays loadable. Bypass: `Allow extension-build-current bypass`. (Enforced by `.claude/hooks/fleet/extension-build-current-guard/`.)

### Untracked-by-default for vendored / build-copied trees

🚨 Dirs under `additions/source-patched/`, `vendor/`, `third_party/`, `external/`, `upstream/`, `deps/<lib>/`, `pkg-node/`, `*-bundled`/`*-vendored` are **untracked-by-default** — before staging, `git status --ignored` + read `.gitignore` allowlists + find the build script that copies the dir. When REMOVING a consumed class/attr/selector, grep the repo root AND every `upstream/`/`vendor/` submodule first (enforced by `.claude/hooks/fleet/consumer-grep-reminder/`). Run the command instead of guessing; ask before 100+-file/multi-MB drops. Full playbook: [`docs/claude.md/fleet/untracked-by-default.md`](docs/claude.md/fleet/untracked-by-default.md).

### Hook bypasses require the canonical phrase

🚨 Reverting tracked changes or bypassing a hook (--no-verify, DISABLE*PRECOMMIT*\*, --no-gpg-sign, force-push) requires the user to type **`Allow <X> bypass`** verbatim in a recent user turn (e.g. `Allow revert bypass`, `Allow no-verify bypass`). Paraphrases don't count (enforced by `.claude/hooks/fleet/no-revert-guard/`). Full phrase table: [`docs/claude.md/fleet/bypass-phrases.md`](docs/claude.md/fleet/bypass-phrases.md).

**Exception — wheelhouse cascade.** Mechanical `chore(wheelhouse): cascade template@<sha>` operations across the fleet would otherwise need a fresh bypass phrase per repo. Prefix cascade Bash commands with `FLEET_SYNC=1` to opt in: the sentinel allowlists exactly three operations — (1) `git commit --no-verify` whose message starts with `chore(wheelhouse): cascade template@`; (2) `git push --no-verify`; (3) broad-stage `git add -A` / `git add -u` / `git add .` (safe inside a fresh worktree off `origin/main`, which is how cascade scripts work). Everything else with `FLEET_SYNC=1` still falls through to the normal checks — `git stash`, `git reset --hard`, `git checkout/restore`, non-cascade commits all still need the canonical phrase. The sentinel is opt-in per command; no global env-var poisoning. (Enforced by `.claude/hooks/fleet/no-revert-guard/` + `.claude/hooks/fleet/overeager-staging-guard/`.)

### Variant analysis on every High/Critical finding

🚨 When a finding lands at severity High or Critical, **search the rest of the repo for the same shape** before closing it. Bugs cluster — same mental model, same antipattern. Three searches: same file (read the whole thing, not just the hunk), sibling files (`rg` the shape, not the names), cross-package (parallel implementations love to drift).

Skip for style nits. Full taxonomy in [`.claude/skills/_shared/variant-analysis.md`](.claude/skills/_shared/variant-analysis.md). Cross-fleet variants become a _Drift watch_ task — open `chore(wheelhouse): cascade <fix>` (enforced by `.claude/hooks/fleet/variant-analysis-reminder/`).

### Compound lessons into rules

When the same kind of finding fires twice — across two runs, two PRs, or two fleet repos — **promote it to a rule** instead of fixing it again. Land it in CLAUDE.md, a `.claude/hooks/*` block, or a skill prompt — pick the lowest-friction surface. Always cite the original incident in a `**Why:**` line. Skip the retrospective doc; the rule is the artifact (enforced by `.claude/hooks/fleet/compound-lessons-reminder/`). Discipline: [`.claude/skills/_shared/compound-lessons.md`](.claude/skills/_shared/compound-lessons.md).

Every new `.claude/hooks/<name>/` hook must have a matching `(enforced by `.claude/hooks/<name>/`)` reference in CLAUDE.md before the hook's `index.mts` can be written (enforced by `.claude/hooks/fleet/new-hook-claude-md-guard/`). Hooks ignore CLAUDE.md themselves — citing the enforcer inline keeps the rule visible to whoever's reading either surface.

### Plan review before approval

For non-trivial work (multi-file refactor, new feature, migration), the plan itself is a deliverable. List steps numerically, name files you'll touch, name rules you'll honor — don't bury the plan in prose. If the plan touches fleet-shared resources (this CLAUDE.md fleet block, hooks, `_shared/`), invite a second-opinion pass before writing code. If the plan adds a fleet rule, name the original incident (per _Compound lessons_) (enforced by `.claude/hooks/fleet/plan-review-reminder/`).

### Plan storage

🚨 Design / implementation / migration plan docs live at `<repo-root>/.claude/plans/<lowercase-hyphenated>.md` and are **never tracked by version control** — the fleet `.gitignore` excludes `/.claude/*` and `plans/` is intentionally absent from the allowlist. Don't write plans into `docs/plans/` or a package-level `<pkg>/docs/plans/` (enforced by `.claude/hooks/fleet/plan-location-guard/`; bypass: `Allow plan-location bypass`). Full rationale + migration guidance in [`docs/claude.md/fleet/plan-storage.md`](docs/claude.md/fleet/plan-storage.md).

### Doc filenames

🚨 Markdown files are `lowercase-with-hyphens.md` and live in any `docs/` directory (repo-root `docs/`, package `packages/<pkg>/docs/`, language `packages/<pkg>/lang/<lang>/docs/`, etc.) or under `.claude/`. SCREAMING_CASE names are restricted to a fleet allowlist (`README`, `LICENSE`, `CLAUDE`, `CHANGELOG`, `CONTRIBUTING`, `GOVERNANCE`, `MAINTAINERS`, `NOTICE`, `SECURITY`, `SUPPORT`, etc.) and only at repo root, repo-root `docs/`, or `.claude/` — not deeper. `README.md` and `LICENSE` are allowed anywhere. Source-file-hint shape (`smol-ffi.js.md` describing `smol-ffi.js`) is allowed in any `docs/` (enforced by `.claude/hooks/fleet/markdown-filename-guard/`).

### Cascade work is mechanical, not analytical

🚨 **Wheelhouse → fleet syncing is automated dumb-bit propagation, not a thinking task.** `pnpm run sync --target . --fix` is the canonical operation: run it, commit the result with `chore(wheelhouse): cascade template@<sha>`, push. Do NOT analyze each modified file, design alternatives, or write multi-paragraph rationale for cascade commits — the wheelhouse template is the source of truth and the sync runner is the authority on what changes. If a cascade refuses to apply (lockfile policy reject, dependency soak window, broken hook from stale install), the right move is almost always (a) bump the immediate blocker (soak-exclude entry, lockfile rebuild) or (b) defer the repo and report it. Don't reason through a multi-step manual reproduction of what the sync runner already does. Cheap/fast model settings are the default for cascade waves; reserve principal-engineer mode for design work. <!--advisory-->

### Drift watch

🚨 **Drift across fleet repos is a defect, not a feature.** When two socket-\* repos pin different versions of the same shared resource (a tool in `external-tools.json`, a workflow SHA, a CLAUDE.md fleet block, a hook in `.claude/hooks/`, an upstream submodule, `.gitmodules` `# name-version` annotations enforced by `.claude/hooks/fleet/gitmodules-comment-guard/` + GitHub SHA-pin reachability across workflows/`.gitmodules`/`package.json` URLs by `.claude/hooks/fleet/uses-sha-verify-guard/` (bypass `Allow uses-sha-verify bypass`), pnpm/Node `packageManager`/`engines`), **opt for the latest**. Canonical sources: `socket-registry`'s `setup-and-install` action for tool SHAs; `socket-wheelhouse`'s `template/` tree for `.claude/`, CLAUDE.md fleet block, hooks. Either reconcile in the same PR or open `chore(wheelhouse): cascade <thing> from <newer-repo>` and link it (enforced by `.claude/hooks/fleet/drift-check-reminder/`). Full drift-surface list + cascade-PR convention in [`docs/claude.md/fleet/drift-watch.md`](docs/claude.md/fleet/drift-watch.md).

### Stranded cascades

🚨 Local-only `chore(wheelhouse): cascade template@<sha>` commits + `chore/wheelhouse-<sha>` worktrees whose template SHA has been superseded on origin accumulate from interrupted cascade waves and silently block future pushes. The wheelhouse cascade auto-runs `socket-wheelhouse/scripts/fleet/cleanup-stranded.mts --target <repo>` at the start of every wave (default = fix; pass `--dry-run` to report only). Safety rails: cascade-subject regex match + trusted commit author + strict-ancestor proof of supersession + cascade-allowlist file check. Any ambiguity → bail the whole repo. Full algorithm + recovery instructions in [`docs/claude.md/fleet/stranded-cascades.md`](docs/claude.md/fleet/stranded-cascades.md).

### Never fork fleet-canonical files locally

🚨 Edit fleet-canonical files ONLY in `socket-wheelhouse/template/...` — never downstream. Lift missing helpers upstream + re-cascade. **Trust the wheelhouse:** don't grep / read / debug canonical files in downstream repos to verify contents — treat the wheelhouse as oracle (enforced by `.claude/hooks/fleet/no-fleet-fork-guard/`; bypass: `Allow fleet-fork bypass`). Full ruleset: [`docs/claude.md/wheelhouse/no-local-fork-canonical.md`](docs/claude.md/wheelhouse/no-local-fork-canonical.md).

### Code style

Default to no comments (enforced by `.claude/hooks/fleet/no-meta-comments-guard/`); when written, for a junior reader. Invariants: no `TODO`/`FIXME`; `undefined` over `null`; `httpJson`/`httpText` from `@socketsecurity/lib/http-request` over `fetch()`; `safeDelete()` from `@socketsecurity/lib/fs` over `fs.rm`; lib `spawn` over `node:child_process` (enforced by `.claude/hooks/fleet/prefer-async-spawn-guard/`); Edit tool over `sed`/`awk`; `JSON.parse(JSON.stringify(x))` over `structuredClone(x)`; `getDefaultLogger()` over `console.*` (enforced by `.claude/hooks/fleet/logger-guard/`); `@sinclair/typebox` for wire/config over zod/valibot/ajv. Cross-port files use `Lock-step` comments; see [`docs/claude.md/fleet/parser-comments.md`](docs/claude.md/fleet/parser-comments.md) §5–7 (enforced by `.claude/hooks/fleet/lock-step-ref-guard/` + `scripts/check-lock-step-{refs,header}.mts`; bypass: `Allow lock-step bypass`). Full ruleset in [`docs/claude.md/fleet/code-style.md`](docs/claude.md/fleet/code-style.md).

### No underscore-prefixed identifiers

🚨 Never prefix an **identifier** (function, variable, type, export) with `_` — patterns like `_resetX`, `_cache`, `_doFoo`, `_internal` are banned at the symbol level. Privacy in TS is handled by module boundaries (not exporting) or by `_internal/` _directory_ layout; the underscore-as-internal-marker convention from other languages adds noise without enforcement. Exporting "internal" helpers is fine and explicitly preferred — easier to unit-test. **Exception:** the directory name `_internal/` is allowed (and is the documented way to signal module-private files); the rule is about identifiers inside files, not folder layout (enforced by `.claude/hooks/fleet/no-underscore-identifier-guard/` + the `socket/no-underscore-identifier` oxlint rule; bypass: `Allow underscore-identifier bypass`).

### Function declarations over const expressions

🚨 Module-scope functions use `function foo() {}` declarations, not `const foo = () => {}` or `const foo = function () {}` expressions. Function declarations hoist, sort cleanly under `socket/sort-source-methods` (one of the `socket/sort-*` family that also sorts named imports, object-literal properties, Set args, regex alternations, equality disjunctions, boolean chains — sort every sibling list alphanumerically, code or not; non-code surfaces JSON/YAML/markdown/bash are nudged by `.claude/hooks/fleet/alpha-sort-reminder/`, full ruleset [`docs/claude.md/fleet/sorting.md`](docs/claude.md/fleet/sorting.md)), and render with a stable `foo.name` in stack traces. Arrow expressions assigned to `const` lose all three. Apply also to `export` (write `export function foo()`, not `export const foo = () =>`). Exception: declarators carrying a TS type annotation (`const foo: Handler = () => ...`) — the annotation is the contract. Enforced by the `socket/prefer-function-declaration` oxlint rule (autofixes at commit time) and at edit time by `.claude/hooks/fleet/prefer-function-declaration-guard/` so the agent never writes the wrong shape in the first place. Bypass: `Allow function-declaration bypass`.

### Export everything; NO `any` ever

🚨 Every top-level function / interface / type alias / class in `src/` is `export`ed — privacy is handled by NOT importing, never by leaving symbols private. `typescript/no-explicit-any: "error"` is fleet-wide and never relaxed; `as any` is forbidden, bulk `: any` → `: unknown` breaks property access. Use real shapes (`Record<string, unknown>`, `t.ImportDeclaration`, …) or `unknown` + narrowing guards. Full rationale + typed-namespace-cast recipe: [`docs/claude.md/fleet/export-and-no-any.md`](docs/claude.md/fleet/export-and-no-any.md).

### File size

Soft cap **500 lines**, hard cap **1000 lines** per source file. Past those, split along natural seams — group by domain, not line count; name files for what's in them; co-locate helpers with consumers. Exceptions: a single function that legitimately needs the space (note it inline), or a generated artifact. Full playbook in [`docs/claude.md/fleet/file-size.md`](docs/claude.md/fleet/file-size.md).

### Lint rules: errors over warnings, fixable over reporting

🚨 Fleet lint rules are guardrails for AI-generated code — make them strict. Default new rules to `"error"` (never `"warn"`). Ship an autofix when the rewrite is deterministic (`fixable: 'code'` + `fix(fixer) => ...`). Defense in depth: skill (docs) + hook (edit-time) + lint (commit-time) — having one doesn't excuse the others. Tooling: oxlint + oxfmt only (no ESLint, no Prettier); the fleet socket-\* plugin lives in `template/.config/oxlint-plugin/`. Always invoke with explicit `-c .config/...rc.json` so the tools don't fall through to their double-quotes + semis defaults. No file-scope `oxlint-disable` blocks — use `oxlint-disable-next-line <rule> -- <reason>` per call site (enforced by `socket/no-file-scope-oxlint-disable`, enforced by `.claude/hooks/fleet/no-file-scope-oxlint-disable-guard/`). Don't stack byte-identical disables on adjacent lines — refactor to a helper or named constant. Full rationale + cascade behavior + recipes in [`docs/claude.md/fleet/lint-rules.md`](docs/claude.md/fleet/lint-rules.md).

### c8 / v8 coverage ignore directives

🚨 `/* c8 ignore next N */` is broken for multi-line bodies (the reporter counts physical lines, not statements) — always bracket the construct with `/* c8 ignore start - <reason> */` … `/* c8 ignore stop */`; single-line `/* c8 ignore next */` is fine. **Why:** 2026-05-24 socket-lib coverage rose 98.9%→99.15% just by rewriting `next N` to start/stop. Full catalog: [`docs/claude.md/fleet/c8-ignore-directives.md`](docs/claude.md/fleet/c8-ignore-directives.md).

### 1 path, 1 reference

🚨 A path is constructed exactly once; everywhere else references the constructed value. Per-package `scripts/paths.mts` is the canonical owner; sub-packages inherit via `export *`. Build outputs live at `<package-root>/build/<mode>/<platform-arch>/out/Final/<artifact>`. Enforced at three levels: `.claude/hooks/fleet/path-guard/` (edit-time, build-path construction outside `paths.mts`), `.claude/hooks/fleet/paths-mts-inherit-guard/` (edit-time, sub-package inheritance), `scripts/check-paths.mts` (commit-time, whole-repo). `/guarding-paths` is the audit-and-fix skill. Full ruleset + canonical layout + common mistakes in [`docs/claude.md/fleet/path-hygiene.md`](docs/claude.md/fleet/path-hygiene.md).

### Conformance runners

External-spec-conformance runners (test262, WPT, future suites) use a canonical 4-tier layout: sparse-checkout submodule at `<pkg>/test/fixtures/<corpus>/`, thin runner CLI at `<pkg>/test/scripts/<corpus>-<scope>-runner.mts` with modular guts under `<corpus>/`, vitest integration wrapper at `<pkg>/test/integration/<corpus>-<scope>.test.mts` that spawns the runner + checks exit code (auto-runs via `pnpm test`), vitest unit tests at `<pkg>/test/unit/<corpus>-<scope>.test.mts` covering the pure classifier. Allowlist lives in a separate file under `<corpus>-config/`, never inline. Build-time submodules go under `upstream/`; test-time corpora go under `test/fixtures/`. Use `scripts/git-partial-submodule.mts` to honor `sparse-checkout = <patterns>` declared in `.gitmodules`. Full layout + authoring checklist in [`docs/claude.md/fleet/conformance-runners.md`](docs/claude.md/fleet/conformance-runners.md).

### Cross-platform path matching

When a regex matches against a path string, **normalize the path first** with `normalizePath` (or `toUnixPath`) from `@socketsecurity/lib/paths/normalize` and write the regex against `/` only. Don't write dual-separator patterns like `[/\\]` — they're easy to miss in some branches, slower to read, and they multiply when you add `\\\\` for escaped Windows separators. `normalizePath` is the same helper the fleet uses everywhere; relying on it gives one path representation across `darwin` / `linux` / `win32` (enforced by `.claude/hooks/fleet/path-regex-normalize-reminder/`). Bypass: `Allow path-regex-normalize bypass`.

### Background Bash

Never use `Bash(run_in_background: true)` for test / build commands (`vitest`, `pnpm test`, `pnpm build`, `tsgo`) — backgrounded runs you don't poll leak Node workers. Background mode is for dev servers and long migrations whose results you'll consume. Kill hangs with `pkill -f "vitest/dist/workers"`; `.claude/hooks/fleet/stale-process-sweeper/` reaps orphans on Stop. `.DS_Store` files swept at turn-end by `.claude/hooks/fleet/sweep-ds-store/` — no bypass; never wanted in a repo. When writing Bash-allowlist hooks, prefer **AST-based parsing** (via `.claude/hooks/_shared/shell-command.mts` / `findInvocation`, wraps `shell-quote`) over regex when the rule reasons about command structure — regex approves `git $(echo rm) foo.txt`; AST blocks it.

🚨 Tests never connect to third-party servers — mock HTTP with `nock` (`disableNetConnect()` + stubs; `registry-*.test.mts` are canonical). Fleet `test/setup.mts` fails closed; localhost stays allowed. Bypass: `Allow unmocked-network-in-tests bypass` (enforced by `.claude/hooks/fleet/no-unmocked-network-in-tests-guard/`).

### Judgment & self-evaluation

🚨 **Default to perfectionist** when you have latitude — "works now" ≠ "right". **Direct imperatives → execute, don't litigate**: bare commands ("do it", "kill it", "cancel the build") get the tool call, not a tradeoff paragraph. **When the user authorizes a queue** ("complete each one", "100%", "do them all"): finish every item before stopping — no "what's next?" / "session totals" mid-queue; skip AskUserQuestion when explicit go-ahead is already in transcript. **Fix warnings on sight** — don't label "pre-existing" / "out of scope". **UI/render changes**: rebuild + visually verify BEFORE committing. Flag adjacent bugs ("I also noticed X — want me to fix it?"). Name misconceptions before executing. If a fix fails twice: stop, re-read top-down, try something fundamentally different. Detail + per-rule citations in [`docs/claude.md/fleet/judgment-and-self-evaluation.md`](docs/claude.md/fleet/judgment-and-self-evaluation.md) (enforced by `.claude/hooks/fleet/{ask-suppression-reminder,dont-stop-mid-queue-reminder,excuse-detector,follow-direct-imperative-reminder,prose-tone-reminder,verify-rendered-output-before-commit-reminder}/`).

### Error messages

An error message is UI. The reader should fix the problem from the message alone. Four ingredients in order:

1. **What** — the rule, not the fallout (`must be lowercase`, not `invalid`).
2. **Where** — exact file / line / key / field / flag.
3. **Saw vs. wanted** — the bad value and the allowed shape or set.
4. **Fix** — one imperative action (`rename the key to …`).

Use `isError` / `isErrnoException` / `errorMessage` / `errorStack` from `@socketsecurity/lib/errors` over hand-rolled checks. Use `joinAnd` / `joinOr` from `@socketsecurity/lib/arrays` for allowed-set lists. Vague-shape `throw new Error("…")` strings are flagged on Stop (enforced by `.claude/hooks/fleet/error-message-quality-reminder/`). Full guidance in [`docs/claude.md/fleet/error-messages.md`](docs/claude.md/fleet/error-messages.md).

### Token hygiene

🚨 Never emit a raw secret to tool output, commits, comments, or replies; when blocked, rewrite — don't bypass. Redact `token` / `jwt` / `api_key` / `secret` / `password` / `authorization` fields when citing API responses (`.claude/hooks/fleet/token-guard/`). Tokens live in env vars (CI) or the OS keychain (dev local) — never in `.env*` / `.envrc` / `~/.sfw.config` / dotfiles (`.claude/hooks/fleet/no-token-in-dotenv-guard/`). Setup + rotation: `node .claude/hooks/fleet/setup-security-tools/install.mts [--rotate]` — the ONLY correct rotator. Never call platform keychain CLIs from Bash to read (token is already in-process — use `findApiToken()` or `process.env.SOCKET_API_KEY` / `SOCKET_API_TOKEN`); writes/deletes are allowed. Bypass: `Allow blind-keychain-read bypass` (`.claude/hooks/fleet/no-blind-keychain-read-guard/`). Canonical env var: `SOCKET_API_TOKEN` in docs / workflow inputs / `.env.example`; local-dev keychain stores as `SOCKET_API_KEY`. Full spec: [`docs/claude.md/fleet/token-hygiene.md`](docs/claude.md/fleet/token-hygiene.md).

### gh token hygiene

🚨 GitHub CLI tokens are high-blast-radius. Three invariants apply (enforced by `.claude/hooks/fleet/gh-token-hygiene-guard/`):

1. **Keychain storage only.** `gh auth status` must report `(keyring)`. On-disk `~/.config/gh/hosts.yml` rejected — re-auth with `gh auth logout && gh auth login` (keychain is the default since gh 2.40). Nx breach exfiltrated this file in <74s.
2. **`workflow` scope off by default; bypass single-use + Touch ID.** Type `Allow workflow-scope bypass` → `gh auth refresh -s workflow` → Touch ID (osascript fallback, absolute `/usr/bin/` paths defeat PATH-hijack) → ONE dispatch. Recommended scopes: `read:org, repo, gist` (gh forces `gist`).
3. **8-hour token age cap.** Same hook. Refresh: `gh auth refresh -h github.com`. If you refreshed outside Claude (side shell), run `node .claude/hooks/fleet/gh-token-hygiene-guard/index.mts --stamp` to recover. Full spec + recovery: [`docs/claude.md/fleet/gh-token-hygiene.md`](docs/claude.md/fleet/gh-token-hygiene.md).

### Commit signing

🚨 Commits on `main`/`master` must be signed. Three layers: pre-commit config gate, pre-push signature check (`%G?` ∈ {`N`,`B`} blocks), GitHub `required_signatures`. Setup: `node .claude/hooks/fleet/setup-signing/install.mts`. Bypass envs `SOCKET_PRE_{COMMIT,PUSH}_ALLOW_UNSIGNED=1`. Full spec: [`docs/claude.md/fleet/commit-signing.md`](docs/claude.md/fleet/commit-signing.md). Post-hoc audit: `node scripts/audit-transcript.mts --recent` flags privileged tool uses in a session ([full stack](docs/claude.md/fleet/security-stack.md)).

### Agents & skills

- `/scanning-security` — AgentShield + zizmor audit
- `/scanning-quality` — quality analysis
- Shared subskills in `.claude/skills/fleet/_shared/`
- Skill telemetry (enforced by `.claude/hooks/fleet/skill-usage-logger/`)
- **Handing off to another agent** — see [`docs/claude.md/fleet/agent-delegation.md`](docs/claude.md/fleet/agent-delegation.md).
- **Skill scope tiers** (fleet / partial / unique), the `updating` umbrella + `updating-*` siblings convention, and the `scripts/run-skill-fleet.mts` cross-fleet runner in [`docs/claude.md/fleet/agents-and-skills.md`](docs/claude.md/fleet/agents-and-skills.md).

### Hook registry

Hooks under `.claude/hooks/fleet/<name>/` (fleet-canonical); host-repo-only hooks under `.claude/hooks/repo/<name>/` (exempt from citation gate). Each hook's README documents trigger + bypass. Full listing + per-hook enforcement details: [`docs/claude.md/fleet/hook-registry.md`](docs/claude.md/fleet/hook-registry.md).

<!-- END FLEET-CANONICAL -->

## 🏗️ CLI-Specific

### Commands

- **Build**: `pnpm run build` (smart) | `--force` | `pnpm run build:cli` | `pnpm run build:sea`
- **Test**: `pnpm test` (monorepo root) | `pnpm --filter @socketsecurity/cli run test:unit <path>`
- **Lint**: `pnpm run lint` | **Type check**: `pnpm run type` | **Check all**: `pnpm run check`
- **Fix**: `pnpm run fix` | **Dev**: `pnpm dev` (watch) | **Run built**: `node packages/cli/dist/index.js <args>`

### Testing

- 🚨 **NEVER use `--` before test file paths** — runs ALL tests
- Always build before testing: `pnpm run build:cli`
- Update snapshots: `pnpm testu <path>` or `--update` flag
- NEVER write source-code-scanning tests — verify behavior, not string patterns

### Command Pattern

- Simple (<200 LOC, no subcommands): single `cmd-*.mts`
- Complex: `cmd-*.mts` + `handle-*.mts` + `output-*.mts` + `fetch-*.mts`

### Codex Usage

Advice and critical assessment ONLY — never for making code changes. Consult before complex optimizations (>30min).
