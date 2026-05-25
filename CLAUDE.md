# CLAUDE.md

**MANDATORY**: Act as principal-level engineer. Follow these guidelines exactly.

<!-- BEGIN FLEET-CANONICAL — sync via socket-wheelhouse/scripts/sync-scaffolding.mts. Do not edit downstream. -->

## 📚 Wheelhouse Standards

### Identifying users

Identify users by git credentials and use their actual name. Use "you/your" when speaking directly; use names when referencing contributions (enforced by `.claude/hooks/identifying-users-reminder/`).

### Parallel Claude sessions

🚨 Multiple Claude sessions may target the same checkout (parallel agents, terminals, or worktrees on the same `.git/`). **The umbrella rule:** never run a git command that mutates state belonging to a path other than the file you just edited. Forbidden in the primary checkout: `git stash`, `git add -A` / `git add .` (enforced by `.claude/hooks/overeager-staging-guard/`; bypass: `Allow add-all bypass`), `git checkout/switch <branch>`, `git reset --hard <non-HEAD>`. Branch work goes in a `git worktree`. Cross-repo imports via `@socketsecurity/lib/...` only, never `../<sibling-repo>/...` (enforced by `.claude/hooks/cross-repo-guard/`). Full prohibition list + worktree recipe in [`docs/claude.md/fleet/parallel-claude-sessions.md`](docs/claude.md/fleet/parallel-claude-sessions.md).

### Default branch fallback

Never hard-code `main` in scripts — a few legacy repos still use `master`. Resolve via `git symbolic-ref refs/remotes/origin/HEAD`, fall back to `main` then `master`:

```bash
BASE=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')
[ -z "$BASE" ] && git show-ref --verify --quiet refs/remotes/origin/main && BASE=main
[ -z "$BASE" ] && git show-ref --verify --quiet refs/remotes/origin/master && BASE=master
BASE="${BASE:-main}"
```

Apply in: worktree creation, base-ref resolution for `git diff`/`git rev-list`, PR base detection, hook scripts walking history. Doc examples may write `main` for clarity; scripts must look up. Order matters — `main → master` matches fleet reality; reversing would mispick during rename migrations (enforced by `.claude/hooks/default-branch-guard/`).

### Public-surface hygiene

🚨 Never write a real customer / company name, private repo / internal project name, or Linear ref (`SOC-123`, `ENG-456`, Linear URLs) into a commit, PR, issue, comment, or release note. No denylist — a denylist is itself a leak (enforced by `.claude/hooks/{private-name-guard,public-surface-reminder}/`).

🚨 Never `gh workflow run|dispatch` against publish / release / build-release workflows (enforced by `.claude/hooks/release-workflow-guard/`). Bypass: `gh workflow run -f dry-run=true` (workflow declares `dry-run:` input) OR `Allow workflow-dispatch bypass: <workflow>` typed verbatim. `workflow_dispatch.inputs` keys are kebab-case.

🚨 **Workflow YAML invariants:** SHA-pinned `uses:` lines need a `# <tag> (YYYY-MM-DD)` comment; `run:` blocks with multi-line `gh ... --body "..."` break YAML — always `--body-file <path>`; `pull_request_target` is privileged and never combines with fork-head checkout + execute. External-issue refs (`<owner>/<repo>#<num>`) in commits / PR bodies spam upstream maintainers — only `SocketDev/<repo>#<num>` is allowed inline; link upstream refs in PR _description prose_ instead. Bypass: `Allow external-issue-ref bypass`.

Full ruleset + threat model + bypass surface in [`docs/claude.md/fleet/public-surface-hygiene.md`](docs/claude.md/fleet/public-surface-hygiene.md) and [`docs/claude.md/fleet/pull-request-target.md`](docs/claude.md/fleet/pull-request-target.md).

### Canonical README

🚨 Root `README.md` follows the fleet skeleton — 5 level-2 sections in order (Why this repo exists / Install / Usage / Development / License), no `socket-wheelhouse` mentions (it's a private repo), no sibling-relative script commands (e.g. `node ../socket-foo/scripts/...` fails for outside readers). Canonical skeleton: `socket-wheelhouse/template/README.md`. Bypass: `Allow readme-fleet-shape bypass` (enforced by `.claude/hooks/readme-fleet-shape-guard/`).

### Commits & PRs

🚨 Conventional Commits `<type>(<scope>): <description>`, lowercase type, NO AI attribution (enforced by `.claude/hooks/commit-message-format-guard/` + draft-time reminder `.claude/hooks/commit-pr-reminder/`; bypasses `Allow commit-format bypass` / `Allow ai-attribution bypass`). Push policy: push direct → fall back to PR only on rejection (no pre-emptive PRs, no force-pushes). When adding commits to an OPEN PR, update the title + description via `gh pr edit` to match the new scope.

Full ruleset — open-PR edits, Bugbot inline replies, rebase-over-revert for unpushed commits, no-empty-commits, commit-author canonical identity, scan-label scrubbing, enterprise-ruleset bypass — in [`docs/claude.md/fleet/commit-cadence-format.md`](docs/claude.md/fleet/commit-cadence-format.md).

### Prose authoring (commit bodies, PRs, CHANGELOG, docs)

🚨 Run human-facing prose through the `prose` skill before it lands: commit message bodies, PR descriptions, CHANGELOG entries, README sections, `docs/` markdown. The skill catches throat-clearing openers, "not X, it's Y" contrasts, em-dash chains, adverbs doing vague work, metronomic rhythms. Subject lines stay terse and imperative under `commit-message-format-guard`. Cascade commits and bot output are exempt. Full rules: [`.claude/skills/prose/SKILL.md`](.claude/skills/prose/SKILL.md).

### Squash-history opt-in

Some fleet repos squash the default branch on a cadence — currently socket-addon, socket-bin, socket-btm, sdxgen, stuie (declared via `optIns: ['squash-history']` in `template/.claude/skills/cascading-fleet/lib/fleet-repos.json`). When working in an opted-in repo, prefer one consolidated commit per logical change over a long fan of tiny WIP commits; the `squashing-history` skill is the documented way to collapse history when it grows long. Threshold reminder + bypass `Allow squash-history-reminder bypass` (enforced by `.claude/hooks/squash-history-reminder/`).

### Version bumps & immutable releases

🚨 Bump: (1) `pnpm run update` → `pnpm i` → `pnpm run fix --all` → `pnpm run check --all`; (2) CHANGELOG public-facing only; (3) `chore: bump version to X.Y.Z` LAST; (4) `git tag vX.Y.Z` (`version-bump-order-guard`); (5) user dispatches publish. Stop reminder verifies provenance + trustedPublisher. GH Releases ship **immutable** (Sigstore attestation, GA 2025-10-28). Release workflows use 3-step `gh release create --draft` → `gh release upload` → `gh release edit --draft=false`; single-call form is forbidden (enforced by `.claude/hooks/immutable-release-pattern-guard/`; bypass: `Allow immutable-release-pattern bypass`). Verify: `gh release verify <tag>`. Detail: [`docs/claude.md/fleet/version-bumps.md`](docs/claude.md/fleet/version-bumps.md), [`docs/claude.md/fleet/immutable-releases.md`](docs/claude.md/fleet/immutable-releases.md).

### Programmatic Claude calls

🚨 Workflows / skills / scripts that invoke `claude` CLI or `@anthropic-ai/claude-agent-sdk` MUST set all four lockdown flags: `tools`, `allowedTools`, `disallowedTools`, `permissionMode: 'dontAsk'`. Never `default` mode in headless contexts. Never `bypassPermissions`. See `.claude/skills/locking-down-programmatic-claude/SKILL.md`.

### Tooling

🚨 **Package manager: `pnpm`** — scripts via `pnpm run foo --flag` (never `foo:bar`); after `package.json` edits, `pnpm install`. NEVER `npx` / `pnpm dlx` / `yarn dlx` — use `pnpm exec` or `pnpm run` # socket-hook: allow npx. NEVER `--experimental-strip-types` to Node (enforced by `.claude/hooks/no-experimental-strip-types-guard/`).

🚨 **Engine floors are pinned fleet-wide:** `engines.pnpm: ">=11.3.0"` (matches the canonical `packageManager` pin) and `engines.npm: ">=11.15.0"` (the version that introduced `npm stage publish`). The wheelhouse `package.json` is the single source of truth — both floors cascade to fleet repos via the sync-scaffolding `engines_pnpm_drift` + `engines_npm_drift` categories.

🚨 **Bundler: rolldown, not esbuild.** Backward compatibility is FORBIDDEN — actively remove when encountered.

🚨 **New deps Socket-scored at edit time** (enforced by `.claude/hooks/check-new-deps/`); the 7-day `minimumReleaseAge` soak is malware protection (bypass `Allow minimumReleaseAge bypass`; enforced by `.claude/hooks/minimum-release-age-guard/`). Soak-bypass entries need `# published: YYYY-MM-DD | removable: YYYY-MM-DD` annotations (enforced by `.claude/hooks/soak-exclude-date-annotation-guard/`).

Full ruleset — docs lead with pnpm, `packageManager` field, `.config/` placement, `.mts` runners, monorepo `engines.node`, vitest/node-test runner separation, `npm-run-all2` + `node --run` opt-in — in [`docs/claude.md/fleet/tooling.md`](docs/claude.md/fleet/tooling.md).

### Claude Code plugin pins

🚨 Fleet-blessed Claude Code plugins are SHA-pinned in the wheelhouse-canonical [`.claude-plugin/marketplace.json`](../.claude-plugin/marketplace.json), with companion human-readable metadata (pin date, pinner) in [`.claude-plugin/README.md`](../.claude-plugin/README.md). The pair is enforced together: every `plugins[].source.sha` in `marketplace.json` must have a row in the README table with matching `version` + `sha` + an ISO-8601 `date`. Same staleness signal the GHA `uses:` SHA-pin comments carry. Bump the SHA → bump the row. Run `pnpm run install-claude-plugins` to reconcile a machine to the pinned set — adds the marketplace + installs each plugin at its pinned SHA, no plugin modifications (enforced by `.claude/hooks/marketplace-comment-guard/`).

### Token minification

Two surfaces apply lossless compression to Claude tool_result payloads — `minify` (JSON whitespace), `strip-lines` (`cat -n` prefixes), `whitespace` (3+ blank lines → 1). All deterministic and information-preserving; no semantic ML compression. **Wire-level proxy**: `@socketsecurity/token-minifier` in [`socket-wheelhouse/packages/`](../packages/socket-token-minifier/) sits between Claude Code and `api.anthropic.com` when `ANTHROPIC_BASE_URL=http://localhost:7779` is set. Installed via `pnpm run install-token-minifier` (self-contained at `~/.socket/_wheelhouse/socket-token-minifier/`, shim at `~/.socket/_wheelhouse/bin/socket-token-minifier`). Auto-started by `.claude/hooks/socket-token-minifier-start/` SessionStart hook — **fail-closed**: only writes `ANTHROPIC_BASE_URL` to the session env if the proxy is verified healthy on `:7779`; if not, session goes direct to api.anthropic.com. **In-context hook**: [`.claude/hooks/minify-mcp-output/`](.claude/hooks/minify-mcp-output/) fires PostToolUse on MCP-tool results and returns `hookSpecificOutput.updatedMCPToolOutput` — the only documented rewrite channel for already-collected tool outputs (built-in tools like Read/Bash have no such channel; use the proxy for those) (enforced by `.claude/hooks/minify-mcp-output/`, `.claude/hooks/socket-token-minifier-start/`).

### Fix it, don't defer

🚨 See a lint/type/test error or broken comment in your reading window — fix it. Stop current task, fix the issue in a sibling commit, resume. Don't label as "pre-existing", "unrelated", or "out of scope" — the labels are rationalizations (enforced by `.claude/hooks/excuse-detector/`).

🚨 Don't blame the user (or "the linter") when your own edits get reverted between turns. The cause is almost always your own scripts: pre-commit autofix, sync-cascade from `template/`, oxlint --fix. Investigate with `git log -S`, run pre-commit phases in isolation, diff `template/` canonical sources. Only attribute to the user with direct evidence (enforced by `.claude/hooks/dont-blame-user-reminder/`).

🚨 Never offer "fix vs accept-as-gap" as a choice — pick the fix.

Exceptions (state the trade-off and ask): genuinely large refactor on a small bug, file belongs to another session, fix needs off-machine action.

### Don't leave the worktree dirty

🚨 Finish a code change → **commit it**. Never end a turn with uncommitted edits, untracked files, or staged-but-uncommitted hunks. Surgical staging only (`git add <specific-file>`, never `-A` / `.`); stage and commit in the same Bash call. If you can't commit yet (mid-refactor, failing tests, waiting on user), announce it in the turn summary — silent dirty worktrees are the failure mode. Worktrees from `git worktree add` must be left clean (committed + pushed) before `git worktree remove`. Enforced by `.claude/hooks/no-orphaned-staging/` + `.claude/hooks/node-modules-staging-guard/` (bypass: `Allow node-modules-staging bypass`); end-of-turn dirty-worktree scan (enforced by `.claude/hooks/dirty-worktree-on-stop-reminder/`). Full rules + parallel-session rationale in [`docs/claude.md/fleet/worktree-hygiene.md`](docs/claude.md/fleet/worktree-hygiene.md).

### Smallest chunks, land ASAP

🚨 Smallest possible chunks; land ASAP via direct-push-to-main. Don't accumulate work across worktrees or long-lived branches — each unmerged branch is in-flight state that has to be rebased and reconciled later. Same instinct that flags _Drift watch_ across fleet repos applies to in-flight branches in one repo. Past incident: 4 sibling wheelhouse worktrees (2 dead, 2 needing rebase) burned a turn on consolidation. **How to apply:** finish a branch the session it's opened; consolidate any pile-up at session start before resuming the queue.

### Commit cadence & message format

🚨 Commit early, commit often. Every commit follows [Conventional Commits 1.0](https://www.conventionalcommits.org/en/v1.0.0/): lowercase `<type>[(scope)][!]: <description>` with type ∈ { feat, fix, chore, docs, style, refactor, perf, test, build, ci, revert }. No AI attribution anywhere. Bypass: `Allow commit-format bypass` or `Allow ai-attribution bypass`. Full rationale + examples + edge cases in [`docs/claude.md/fleet/commit-cadence-format.md`](docs/claude.md/fleet/commit-cadence-format.md) (enforced by `.claude/hooks/commit-message-format-guard/` at commit time + `.claude/hooks/commit-pr-reminder/` at draft time).

### Don't disable lint rules

🚨 Adding `"rule-name": "off"` (or `"warn"`) to any oxlint/eslint config weakens the gate for every file matching that selector. Fix the underlying code instead. For genuine single-call-site exemptions, use `oxlint-disable-next-line <rule> -- <reason>` on the specific line. Bypass: `Allow disable-lint-rule bypass`. Full rationale + recipes in [`docs/claude.md/fleet/no-disable-lint-rule.md`](docs/claude.md/fleet/no-disable-lint-rule.md) (enforced by `.claude/hooks/no-disable-lint-rule-guard/`).

### Extension build hygiene

🚨 The trusted-publisher Chrome extension at `tools/trusted-publisher-extension/` is bundled via rolldown. Commits that touch `tools/trusted-publisher-extension/src/**` MUST be paired with a successful `pnpm --filter @socketsecurity/trusted-publisher-extension build` so the bundled output stays loadable. Bypass: `Allow extension-build-current bypass`. (Enforced by `.claude/hooks/extension-build-current-guard/`.)

### Untracked-by-default for vendored / build-copied trees

🚨 Untracked dirs under `additions/source-patched/`, `vendor/`, `third_party/`, `external/`, `upstream/`, `deps/<libname>/`, `pkg-node/`, or `*-bundled`/`*-vendored` paths are **untracked-by-default**. Before staging: `git status --ignored` + read `.gitignore` (look for `dir/*` + `!dir/file` allowlists — the allowlisted file is our hand-written glue, not the whole tree) + grep for the build script that copies the dir in. When REMOVING a class / attribute / selector that other code consumes, grep BOTH the repo root AND every `upstream/` / `vendor/` / `third_party/` submodule before deleting — past incident: stripped a CSS class because repo-root grep found 0 hits; upstream bundle hydrated from it and the rendered output went blank (enforced by `.claude/hooks/consumer-grep-reminder/`). Ban "must be" / "presumably" / "looks like" when handling someone else's tree — run the command instead. Ask before committing 100+ file or multi-MB drops. Full playbook in [`docs/claude.md/fleet/untracked-by-default.md`](docs/claude.md/fleet/untracked-by-default.md).

### Hook bypasses require the canonical phrase

🚨 Reverting tracked changes or bypassing a hook (--no-verify, DISABLE*PRECOMMIT*\*, --no-gpg-sign, force-push) requires the user to type **`Allow <X> bypass`** verbatim in a recent user turn (e.g. `Allow revert bypass`, `Allow no-verify bypass`). Paraphrases don't count (enforced by `.claude/hooks/no-revert-guard/`). Full phrase table: [`docs/claude.md/fleet/bypass-phrases.md`](docs/claude.md/fleet/bypass-phrases.md).

**Exception — wheelhouse cascade.** Mechanical `chore(wheelhouse): cascade template@<sha>` operations across the fleet would otherwise need a fresh bypass phrase per repo. Prefix cascade Bash commands with `FLEET_SYNC=1` to opt in: the sentinel allowlists exactly three operations — (1) `git commit --no-verify` whose message starts with `chore(wheelhouse): cascade template@`; (2) `git push --no-verify`; (3) broad-stage `git add -A` / `git add -u` / `git add .` (safe inside a fresh worktree off `origin/main`, which is how cascade scripts work). Everything else with `FLEET_SYNC=1` still falls through to the normal checks — `git stash`, `git reset --hard`, `git checkout/restore`, non-cascade commits all still need the canonical phrase. The sentinel is opt-in per command; no global env-var poisoning. (Enforced by `.claude/hooks/no-revert-guard/` + `.claude/hooks/overeager-staging-guard/`.)

### Variant analysis on every High/Critical finding

🚨 When a finding lands at severity High or Critical, **search the rest of the repo for the same shape** before closing it. Bugs cluster — same mental model, same antipattern. Three searches: same file (read the whole thing, not just the hunk), sibling files (`rg` the shape, not the names), cross-package (parallel implementations love to drift).

Skip for style nits. Full taxonomy in [`.claude/skills/_shared/variant-analysis.md`](.claude/skills/_shared/variant-analysis.md). Cross-fleet variants become a _Drift watch_ task — open `chore(wheelhouse): cascade <fix>` (enforced by `.claude/hooks/variant-analysis-reminder/`).

### Compound lessons into rules

When the same kind of finding fires twice — across two runs, two PRs, or two fleet repos — **promote it to a rule** instead of fixing it again. Land it in CLAUDE.md, a `.claude/hooks/*` block, or a skill prompt — pick the lowest-friction surface. Always cite the original incident in a `**Why:**` line. Skip the retrospective doc; the rule is the artifact (enforced by `.claude/hooks/compound-lessons-reminder/`). Discipline: [`.claude/skills/_shared/compound-lessons.md`](.claude/skills/_shared/compound-lessons.md).

Every new `.claude/hooks/<name>/` hook must have a matching `(enforced by `.claude/hooks/<name>/`)` reference in CLAUDE.md before the hook's `index.mts` can be written (enforced by `.claude/hooks/new-hook-claude-md-guard/`). Hooks ignore CLAUDE.md themselves — citing the enforcer inline keeps the rule visible to whoever's reading either surface.

### Plan review before approval

For non-trivial work (multi-file refactor, new feature, migration), the plan itself is a deliverable. List steps numerically, name files you'll touch, name rules you'll honor — don't bury the plan in prose. If the plan touches fleet-shared resources (this CLAUDE.md fleet block, hooks, `_shared/`), invite a second-opinion pass before writing code. If the plan adds a fleet rule, name the original incident (per _Compound lessons_) (enforced by `.claude/hooks/plan-review-reminder/`).

### Plan storage

🚨 Design / implementation / migration plan docs live at `<repo-root>/.claude/plans/<lowercase-hyphenated>.md` and are **never tracked by version control** — the fleet `.gitignore` excludes `/.claude/*` and `plans/` is intentionally absent from the allowlist. Don't write plans into `docs/plans/` or a package-level `<pkg>/docs/plans/` (enforced by `.claude/hooks/plan-location-guard/`; bypass: `Allow plan-location bypass`). Full rationale + migration guidance in [`docs/claude.md/fleet/plan-storage.md`](docs/claude.md/fleet/plan-storage.md).

### Doc filenames

🚨 Markdown files are `lowercase-with-hyphens.md` and live in any `docs/` directory (repo-root `docs/`, package `packages/<pkg>/docs/`, language `packages/<pkg>/lang/<lang>/docs/`, etc.) or under `.claude/`. SCREAMING_CASE names are restricted to a fleet allowlist (`README`, `LICENSE`, `CLAUDE`, `CHANGELOG`, `CONTRIBUTING`, `GOVERNANCE`, `MAINTAINERS`, `NOTICE`, `SECURITY`, `SUPPORT`, etc.) and only at repo root, repo-root `docs/`, or `.claude/` — not deeper. `README.md` and `LICENSE` are allowed anywhere. Source-file-hint shape (`smol-ffi.js.md` describing `smol-ffi.js`) is allowed in any `docs/` (enforced by `.claude/hooks/markdown-filename-guard/`).

### Drift watch

🚨 **Drift across fleet repos is a defect, not a feature.** When two socket-\* repos pin different versions of the same shared resource (a tool in `external-tools.json`, a workflow SHA, a CLAUDE.md fleet block, a hook in `.claude/hooks/`, an upstream submodule, `.gitmodules` `# name-version` annotations enforced by `.claude/hooks/gitmodules-comment-guard/`, pnpm/Node `packageManager`/`engines`), **opt for the latest**. Canonical sources: `socket-registry`'s `setup-and-install` action for tool SHAs; `socket-wheelhouse`'s `template/` tree for `.claude/`, CLAUDE.md fleet block, hooks. Either reconcile in the same PR or open `chore(wheelhouse): cascade <thing> from <newer-repo>` and link it (enforced by `.claude/hooks/drift-check-reminder/`). Full drift-surface list + cascade-PR convention in [`docs/claude.md/fleet/drift-watch.md`](docs/claude.md/fleet/drift-watch.md).

### Stranded cascades

🚨 Local-only `chore(wheelhouse): cascade template@<sha>` commits + `chore/wheelhouse-<sha>` worktrees whose template SHA has been superseded on origin accumulate from interrupted cascade waves and silently block future pushes. The wheelhouse cascade auto-runs `socket-wheelhouse/scripts/fleet/cleanup-stranded.mts --target <repo>` at the start of every wave (default = fix; pass `--dry-run` to report only). Safety rails: cascade-subject regex match + trusted commit author + strict-ancestor proof of supersession + cascade-allowlist file check. Any ambiguity → bail the whole repo. Full algorithm + recovery instructions in [`docs/claude.md/fleet/stranded-cascades.md`](docs/claude.md/fleet/stranded-cascades.md).

### Never fork fleet-canonical files locally

🚨 Edit fleet-canonical files (anything in the sync manifest) ONLY in `socket-wheelhouse/template/...` — never in a downstream repo. Spot a missing helper in a downstream copy? Lift it upstream and re-cascade (enforced by `.claude/hooks/no-fleet-fork-guard/`; bypass: `Allow fleet-fork bypass`). Full canonical-surface list + lifting workflow: [`docs/claude.md/wheelhouse/no-local-fork-canonical.md`](docs/claude.md/wheelhouse/no-local-fork-canonical.md).

### Code style

Default to no comments (enforced by `.claude/hooks/no-meta-comments-guard/`); when written, write for a junior reader. Heaviest fleet invariants: no `TODO`/`FIXME`/stubs; `undefined` over `null`; `httpJson`/`httpText` from `@socketsecurity/lib/http-request` over `fetch()`; `safeDelete()` from `@socketsecurity/lib/fs` over `fs.rm`; Edit tool over `sed`/`awk`; `JSON.parse(JSON.stringify(x))` over `structuredClone(x)` for JSON-shaped data (enforced by `.claude/hooks/no-structured-clone-prefer-json-guard/` + `socket/no-structured-clone-prefer-json` oxlint rule; bypass: `Allow no-structured-clone-prefer-json bypass`); `getDefaultLogger()` over `console.*` (enforced by `.claude/hooks/logger-guard/`). Cross-port files use `Lock-step` comments — see [`docs/claude.md/fleet/parser-comments.md`](docs/claude.md/fleet/parser-comments.md) §5–7 (enforced by `.claude/hooks/lock-step-ref-guard/` + `scripts/check-lock-step-{refs,header}.mts`; bypass: `Allow lock-step bypass`). Full ruleset (object literals, imports, subprocesses, file existence, env checks, generated reports, sorting, Promise.race, Safe suffix, `node:smol-*`, doc filenames, inline-defer, ESLint-config refs, inclusive language) in [`docs/claude.md/fleet/code-style.md`](docs/claude.md/fleet/code-style.md). See also [`docs/claude.md/fleet/sorting.md`](docs/claude.md/fleet/sorting.md) and [`docs/claude.md/fleet/inclusive-language.md`](docs/claude.md/fleet/inclusive-language.md).

### No underscore-prefixed identifiers

🚨 Never prefix an **identifier** (function, variable, type, export) with `_` — patterns like `_resetX`, `_cache`, `_doFoo`, `_internal` are banned at the symbol level. Privacy in TS is handled by module boundaries (not exporting) or by `_internal/` _directory_ layout; the underscore-as-internal-marker convention from other languages adds noise without enforcement. Exporting "internal" helpers is fine and explicitly preferred — easier to unit-test. **Exception:** the directory name `_internal/` is allowed (and is the documented way to signal module-private files); the rule is about identifiers inside files, not folder layout (enforced by `.claude/hooks/no-underscore-identifier-guard/` + the `socket/no-underscore-identifier` oxlint rule; bypass: `Allow underscore-identifier bypass`).

### File size

Soft cap **500 lines**, hard cap **1000 lines** per source file. Past those, split along natural seams — group by domain, not line count; name files for what's in them; co-locate helpers with consumers. Exceptions: a single function that legitimately needs the space (note it inline), or a generated artifact. Full playbook in [`docs/claude.md/fleet/file-size.md`](docs/claude.md/fleet/file-size.md).

### Lint rules: errors over warnings, fixable over reporting

- **Errors, not warnings.** Default `"error"` for new rules.
- **Fixable when possible.** Ship an autofix (`fixable: 'code'` + `fix(fixer) => ...`) whenever the rewrite is deterministic.
- **Skill or hook ≠ no rule.** Defense in depth — skill is docs, hook is edit-time, lint is commit-time.
- **Tooling: oxlint + oxfmt only.** No ESLint, no Prettier. Fleet socket-\* oxlint plugin lives in `template/.config/oxlint-plugin/`.
- **Invoke oxfmt / oxlint with `-c .config/...rc.json` explicitly.** Both tools accept a `-c PATH` (oxfmt) / `--config PATH` (oxlint). The fleet keeps both configs under `.config/`, not at repo root. Without the flag, the tools fall through to their built-in defaults — oxfmt's default is double-quotes + semis, the opposite of the fleet style, and would silently rewrite ~200 files on `pnpm run format`. Canonical script bodies in `manifest.mts` already encode the flag; the sync-scaffolding gate rewrites drifted scripts back to the canonical form.
- **No file-scope `oxlint-disable`.** Always use `oxlint-disable-next-line <rule> -- <reason>` per call site so each exemption is independently justified in `git blame`. File-scope blocks silently exempt future edits the author never thought about (enforced by `socket/no-file-scope-oxlint-disable` lint rule + `.claude/hooks/no-file-scope-oxlint-disable-guard/` edit-time guard).
- **Don't repeat the same `oxlint-disable-next-line` comment on adjacent lines.** Byte-identical disables on consecutive lines is a smell — refactor: lift the repeated call into a helper, or extract the disabled value into a single named constant that carries the exemption once. Per-call-site exemptions remain correct when reasons genuinely differ. Recipes in [`docs/claude.md/fleet/lint-rules.md`](docs/claude.md/fleet/lint-rules.md).

Full rationale + cascade behavior in [`docs/claude.md/fleet/lint-rules.md`](docs/claude.md/fleet/lint-rules.md).

### c8 / v8 coverage ignore directives

🚨 `/* c8 ignore next N */` is broken for multi-line bodies — the c8/v8 reporter counts physical lines, not statements, so a `catch { logger.warn(...); return undefined }` body is partly ignored and partly reported as uncovered. Always use `/* c8 ignore start - <reason> */` ... `/* c8 ignore stop */` brackets around the construct. Single-line uses (`/* c8 ignore next */ return undefined`) are fine. **Why:** Past incident, 2026-05-24 — socket-lib coverage jumped 98.9% → 99.15% just by rewriting nine files' worth of `next N` directives to start/stop blocks; the defensive arms had been correctly marked all along, the reporter just wasn't honoring the directive form. Full pattern catalog + diagnosis in [`docs/claude.md/fleet/c8-ignore-directives.md`](docs/claude.md/fleet/c8-ignore-directives.md).

### 1 path, 1 reference

🚨 A path is constructed exactly once; everywhere else references the constructed value. Per-package `scripts/paths.mts` is the canonical owner; sub-packages inherit via `export *`. Build outputs live at `<package-root>/build/<mode>/<platform-arch>/out/Final/<artifact>`. Enforced at three levels: `.claude/hooks/path-guard/` (edit-time, build-path construction outside `paths.mts`), `.claude/hooks/paths-mts-inherit-guard/` (edit-time, sub-package inheritance), `scripts/check-paths.mts` (commit-time, whole-repo). `/guarding-paths` is the audit-and-fix skill. Full ruleset + canonical layout + common mistakes in [`docs/claude.md/fleet/path-hygiene.md`](docs/claude.md/fleet/path-hygiene.md).

### Conformance runners

External-spec-conformance runners (test262, WPT, future suites) use a canonical 4-tier layout: sparse-checkout submodule at `<pkg>/test/fixtures/<corpus>/`, thin runner CLI at `<pkg>/test/scripts/<corpus>-<scope>-runner.mts` with modular guts under `<corpus>/`, vitest integration wrapper at `<pkg>/test/integration/<corpus>-<scope>.test.mts` that spawns the runner + checks exit code (auto-runs via `pnpm test`), vitest unit tests at `<pkg>/test/unit/<corpus>-<scope>.test.mts` covering the pure classifier. Allowlist lives in a separate file under `<corpus>-config/`, never inline. Build-time submodules go under `upstream/`; test-time corpora go under `test/fixtures/`. Use `scripts/git-partial-submodule.mts` to honor `sparse-checkout = <patterns>` declared in `.gitmodules`. Full layout + authoring checklist in [`docs/claude.md/fleet/conformance-runners.md`](docs/claude.md/fleet/conformance-runners.md).

### Cross-platform path matching

When a regex matches against a path string, **normalize the path first** with `normalizePath` (or `toUnixPath`) from `@socketsecurity/lib/paths/normalize` and write the regex against `/` only. Don't write dual-separator patterns like `[/\\]` — they're easy to miss in some branches, slower to read, and they multiply when you add `\\\\` for escaped Windows separators. `normalizePath` is the same helper the fleet uses everywhere; relying on it gives one path representation across `darwin` / `linux` / `win32` (enforced by `.claude/hooks/path-regex-normalize-reminder/`). Bypass: `Allow path-regex-normalize bypass`.

### Background Bash

Never use `Bash(run_in_background: true)` for test / build commands (`vitest`, `pnpm test`, `pnpm build`, `tsgo`). Backgrounded runs you don't poll get abandoned and leak Node workers. Background mode is for dev servers and long migrations whose results you'll consume. If a run hangs, kill it: `pkill -f "vitest/dist/workers"`. The `.claude/hooks/stale-process-sweeper/` `Stop` hook reaps true orphans as a safety net.

`.DS_Store` files created by Finder mid-session are swept at turn-end by `.claude/hooks/sweep-ds-store/` (excludes `.git/` and `node_modules/`). Silent on the happy path; logs sweep count when files are found. No bypass — `.DS_Store` is never wanted in a repo (enforced by `.claude/hooks/sweep-ds-store/`).

When writing or extending a Bash-allowlist hook, prefer **AST-based parsing** over regex matchers when the rule needs to reason about command structure (chains, subshells, redirects, command substitution). Regex matchers approve `git $(echo rm) foo.txt` because the surface looks like `git`; an AST parser sees the substitution and blocks. Pure-syntactic rules (binary name only) can stay regex; structure-sensitive rules (no writes to `.env*`, no destructive chains, no `$(…)` containing destructive verbs) need a parser. Pattern reference: https://github.com/ldayton/Dippy.

### Judgment & self-evaluation

- If the request is based on a misconception, say so before executing.
- If you spot an adjacent bug, flag it: "I also noticed X — want me to fix it?"
- Fix warnings (lint / type / build / runtime) when you see them — don't leave them for later. For UI/render changes (`*.html` / `*.css` / `scripts/tour.mts`-shape files): rebuild the artifact + verify the rendered output BEFORE committing — past pattern: multiple wasted commits per session ("rebuild before you fucking commit") (enforced by `.claude/hooks/verify-rendered-output-before-commit-reminder/`).
- **Default to perfectionist** when you have latitude. "Works now" ≠ "right." Don't offer "do it right" vs "ship fast" as a binary choice menu — pick perfectionist and execute (enforced by `.claude/hooks/perfectionist-reminder/`).
- Before calling done: perfectionist vs. pragmatist views. Default perfectionist absent a signal.
- If a fix fails twice: stop, re-read top-down, state where the mental model was wrong, try something fundamentally different.
- **When the user authorizes a queue** ("complete each one", "hammer it out", "100%", "do them all"): finish every item before stopping. Don't post "what's next?" / "honest stopping point" / "session totals" after one item — that re-litigates intent already given. Continue until the queue is empty or a genuine blocker hits (enforced by `.claude/hooks/dont-stop-mid-queue-reminder/`). Skip AskUserQuestion when recent transcript carries explicit go-ahead directives ("do it" / "yes" / "proceed") — pick the obvious default and execute (enforced by `.claude/hooks/ask-suppression-reminder/`).
- **Direct imperatives → execute, don't litigate.** When the user issues a bare command ("use nvm 26.2.0", "cancel the build", "do it", "kill it"), the response is the tool call, not a paragraph weighing trade-offs. Hedge openers ("That won't help because…", "Let me explain why…", "Before I do that…") + analysis-before-action when the command was unambiguous are the failure mode. State the intent in one short sentence at most, then run the command (enforced by `.claude/hooks/follow-direct-imperative-reminder/`).

### Error messages

An error message is UI. The reader should fix the problem from the message alone. Four ingredients in order:

1. **What** — the rule, not the fallout (`must be lowercase`, not `invalid`).
2. **Where** — exact file / line / key / field / flag.
3. **Saw vs. wanted** — the bad value and the allowed shape or set.
4. **Fix** — one imperative action (`rename the key to …`).

Use `isError` / `isErrnoException` / `errorMessage` / `errorStack` from `@socketsecurity/lib/errors` over hand-rolled checks. Use `joinAnd` / `joinOr` from `@socketsecurity/lib/arrays` for allowed-set lists. Vague-shape `throw new Error("…")` strings are flagged on Stop (enforced by `.claude/hooks/error-message-quality-reminder/`). Full guidance in [`docs/claude.md/fleet/error-messages.md`](docs/claude.md/fleet/error-messages.md).

### Token hygiene

🚨 Never emit a raw secret to tool output, commits, comments, or replies; when blocked, rewrite — don't bypass. Redact `token` / `jwt` / `api_key` / `secret` / `password` / `authorization` fields when citing API responses (`.claude/hooks/token-guard/`). Tokens live in env vars (CI) or the OS keychain (dev local) — never in `.env*` / `.envrc` / `~/.sfw.config` / dotfiles (`.claude/hooks/no-token-in-dotenv-guard/`). Setup + rotation: `node .claude/hooks/setup-security-tools/install.mts [--rotate]` — the ONLY correct rotator. Never call platform keychain CLIs from Bash to read (token is already in-process — use `findApiToken()` or `process.env.SOCKET_API_KEY` / `SOCKET_API_TOKEN`); writes/deletes are allowed. Bypass: `Allow blind-keychain-read bypass` (`.claude/hooks/no-blind-keychain-read-guard/`). Canonical env var: `SOCKET_API_TOKEN` in docs / workflow inputs / `.env.example`; local-dev keychain stores as `SOCKET_API_KEY`. Full spec: [`docs/claude.md/fleet/token-hygiene.md`](docs/claude.md/fleet/token-hygiene.md).

### Agents & skills

- `/scanning-security` — AgentShield + zizmor audit
- `/scanning-quality` — quality analysis
- Shared subskills in `.claude/skills/_shared/`
- **Handing off to another agent** — see [`docs/claude.md/fleet/agent-delegation.md`](docs/claude.md/fleet/agent-delegation.md).
- **Skill scope tiers** (fleet / partial / unique), the `updating` umbrella + `updating-*` siblings convention, and the `scripts/run-skill-fleet.mts` cross-fleet runner in [`docs/claude.md/fleet/agents-and-skills.md`](docs/claude.md/fleet/agents-and-skills.md).

### Tool-specific guards

Hooks that gate specific external tools — they only fire when those tools appear in a command, so they're safe to wire fleet-wide:

- `codex-no-write-guard` — blocks `codex` CLI / `codex:codex-rescue` Agent invocations with write-intent flags or prompts. The rule (originally from ultrathink: Codex regressions cost real perf; use Codex for advice not code changes) applies fleet-wide whenever Codex is invoked. Bypass: `Allow codex-write bypass` (enforced by `.claude/hooks/codex-no-write-guard/`).
- `concurrent-cargo-build-guard` — blocks a second `cargo build --release` while one is in flight (8 LLVM threads × 8-22GB = OOM on dual builds). Fires only on cargo release commands, so a no-op in non-cargo repos. Bypass: `Allow concurrent-cargo-build bypass` (enforced by `.claude/hooks/concurrent-cargo-build-guard/`).

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
