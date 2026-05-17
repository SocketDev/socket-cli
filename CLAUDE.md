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

🚨 The rules apply even when hooks are not installed (enforced by `.claude/hooks/{private-name-guard,public-surface-reminder,release-workflow-guard}/`):

- **Real customer / company names** — never write one into a commit, PR, issue, comment, or release note. Replace with `Acme Inc` or rewrite the sentence to not need the reference. (No enumerated denylist exists — a denylist is itself a leak.)
- **Private repos / internal project names** — never mention. Omit the reference entirely; don't substitute "an internal tool" — the placeholder is a tell.
- **Linear refs** — never put `SOC-123`/`ENG-456`/Linear URLs in code, comments, or PR text. Linear lives in Linear.
- **Publish / release / build-release workflows** — never `gh workflow run|dispatch` or `gh api …/dispatches`. Dispatches are irrevocable. The user runs them manually. Bypass: either a `gh workflow run -f dry-run=true` when the workflow declares a `dry-run:` input and no force-prod override (`-f release=true` / `-f publish=true` / `-f prod=true`) is set, OR `Allow workflow-dispatch bypass: <workflow>` typed verbatim by the user — **one phrase authorizes one dispatch of that exact workflow**. A re-dispatch (same workflow) or a different workflow needs its own fresh phrase. `<workflow>` is the workflow filename, basename, or numeric id (e.g. `publish.yml`, `publish`, `12345` all work). The per-trigger shape replaces the older blanket `Allow workflow-dispatch bypass` — a single phrase shouldn't open the door for unrelated dispatches later in the session.
- **Workflow input naming** — `workflow_dispatch.inputs` keys are kebab-case (`dry-run`, `build-mode`), not snake_case. The release-workflow-guard hook only recognizes kebab; a `dry_run` input silently fails the dry-run bypass.
- **`uses:` SHA-pin comment format** — every `uses: <action>@<40-char-sha>` line must carry a trailing `# <tag-or-version-or-branch> (YYYY-MM-DD)` comment, e.g. `# v6.4.0 (2026-05-15)` or `# main (2026-05-15)`. The date is the day the SHA was pinned/refreshed and gives the staleness signal at-a-glance during reviews (enforced by `.claude/hooks/workflow-uses-comment-guard/`).
- **`pull_request_target` is privileged** — it runs in the BASE repo's context with secrets. Never combine it with `actions/checkout` of `${{ github.event.pull_request.head.* }}` AND a step that executes the checked-out fork code (`pnpm i` / `npm i` / `pnpm build` / `cargo build` / `make` / etc.). Prefer the split-workflow pattern (build in `pull_request`, publish artifact, separate `workflow_run` posts the comment) or gate `pull_request_target` on `types: [labeled]` so only maintainers can trigger. Enforced by `.claude/hooks/pull-request-target-guard/`.
- **No external issue/PR refs in commit messages or PR bodies.** GitHub auto-links `<owner>/<repo>#<num>` and `https://github.com/<owner>/<repo>/(issues|pull)/<num>` mentions back to the target issue, spamming the maintainer with `added N commits that reference this issue` events. Only SocketDev-owned refs are allowed (`SocketDev/<repo>#<num>` is fine). For upstream maintainer issues, link them in _the PR description prose_ (which doesn't trigger backrefs from commits) or use `[#1203](https://npmx.dev/...)` link form that omits the `owner/repo#` token. Bypass: `Allow external-issue-ref bypass` (enforced by `.claude/hooks/no-external-issue-ref-guard/`).

### Commits & PRs

- Conventional Commits `<type>(<scope>): <description>` — NO AI attribution.
- **When adding commits to an OPEN PR**, update the PR title and description to match the new scope. Use `gh pr edit <num> --title … --body …`. The reviewer should know what's in the PR without scrolling commits.
- **Replying to Cursor Bugbot** — reply on the inline review-comment thread, not as a detached PR comment: `gh api repos/{owner}/{repo}/pulls/{pr}/comments/{comment_id}/replies -X POST -f body=…`.
- **Backing out an unpushed commit** — prefer `git reset --soft HEAD~1` (or `git rebase -i HEAD~N`) over `git revert`. Revert commits are for changes already on origin; for local-only commits they just pollute history (enforced by `.claude/hooks/prefer-rebase-over-revert-guard/`).
- **Commit author** — every commit must use the user's canonical GitHub identity, not a work email or a substituted name. Canonical lives in `~/.claude/git-authors.json` (or global git config); aliases in `aliases[]` are also accepted (enforced by `.claude/hooks/commit-author-guard/`).
- **No AI attribution in drafts either** — when drafting a commit body or PR description, omit "Generated with Claude", "Co-Authored-By: Claude", and robot-emoji-tagged lines (enforced by `.claude/hooks/commit-pr-reminder/`).
- **Push policy: push, fall back to PR.** Default to `git push origin <branch>` on the current branch (typically `main`). If the push is rejected — branch protection requires a PR, conflicts, signature/identity rejection — open a PR via `gh pr create` against the default base. Don't pre-open PRs "to be safe"; the direct-push happy path is faster for the operator. Don't force-push to recover; resolve the actual cause (rebase to fix conflicts, fix the commit identity, etc.).

### Version bumps

🚨 When the user asks for a version bump (`bump to vX.Y.Z`, `tag X.Y.Z`, `release X`, etc.), the sequence is exactly: (1) pre-bump prep wave `pnpm run update` → `pnpm i` → `pnpm run fix --all` → `pnpm run check --all` (each must finish clean); (2) CHANGELOG entry, **public-facing only** — new exports / signature changes / migration recipes, NOT internal refactors or `chore(sync)` cascades; (3) `chore: bump version to X.Y.Z` is the LAST commit on the release; (4) `git tag vX.Y.Z` at that commit (enforced by `.claude/hooks/version-bump-order-guard/`); (5) do NOT dispatch the publish workflow — user-triggered. Full sequence + rationale in [`docs/claude.md/fleet/version-bumps.md`](docs/claude.md/fleet/version-bumps.md).

### Programmatic Claude calls

🚨 Workflows / skills / scripts that invoke `claude` CLI or `@anthropic-ai/claude-agent-sdk` MUST set all four lockdown flags: `tools`, `allowedTools`, `disallowedTools`, `permissionMode: 'dontAsk'`. Never `default` mode in headless contexts. Never `bypassPermissions`. See `.claude/skills/locking-down-programmatic-claude/SKILL.md`.

### Tooling

- **Package manager**: `pnpm`. Run scripts via `pnpm run foo --flag`, never `foo:bar`. After `package.json` edits, `pnpm install`.
- 🚨 NEVER use `npx`, `pnpm dlx`, or `yarn dlx` — use `pnpm exec <package>` or `pnpm run <script>` # socket-hook: allow npx
- 🚨 NEVER pass `--experimental-strip-types` to Node (enforced by `.claude/hooks/no-experimental-strip-types-guard/`).
- **New dependencies** — every new dep added to `package.json` runs a Socket-score check at edit time; low-scoring deps block (enforced by `.claude/hooks/check-new-deps/`).
- **Bundler**: `rolldown`, NOT `esbuild`. The fleet standardizes on rolldown for direct bundling (see `template/.config/rolldown/`). Transitive esbuild deps (e.g. via vitest) are unavoidable today — the rule is no _new direct_ esbuild use anywhere in the fleet.
- **Backward compatibility** — FORBIDDEN to maintain. Actively remove when encountered.
- Full ruleset (packageManager field, `.config/` placement, `.mts` runners, soak time, shallow submodules, monorepo `engines.node`) in [`docs/claude.md/fleet/tooling.md`](docs/claude.md/fleet/tooling.md).

### Fix it, don't defer

🚨 See a lint/type/test error or broken comment in your reading window — fix it. Stop current task, fix the issue in a sibling commit, resume. Don't label as "pre-existing", "unrelated", or "out of scope" — the labels are rationalizations (enforced by `.claude/hooks/excuse-detector/`).

🚨 Never offer "fix vs accept-as-gap" as a choice — pick the fix.

Exceptions (state the trade-off and ask): genuinely large refactor on a small bug, file belongs to another session, fix needs off-machine action.

### Don't leave the worktree dirty

🚨 When you finish a code change, **commit it**. Don't end a turn with uncommitted edits, untracked new files, or staged-but-uncommitted hunks lingering in the working tree. A dirty worktree is a half-finished job: another session, another agent, or a future `git checkout` will trip over it, and the user has to clean up after you.

Rules:

- **After finishing a logical unit of work, commit it.** Use a Conventional Commits message per the _Commits & PRs_ rule. Never leave the working tree dirty between turns.
- **Surgical staging only** — `git add <specific-file>`, never `-A` / `.` (per the _Parallel Claude sessions_ rule). The dirty-worktree rule is no excuse to sweep in files you didn't touch.
- **Stage only when you're about to commit.** `git add` and `git commit` belong on the same line (chained with `&&`) OR in the same Bash call. Don't stage as a side-effect of "preparing" — staging is a commit-time action. A turn that ends with staged-but-uncommitted hunks is the failure mode the previous bullet warns against (enforced by `.claude/hooks/no-orphaned-staging/`).
- **If you genuinely can't commit yet** (the change is mid-refactor, tests are failing, you're waiting on user input), say so explicitly in the turn summary so the user knows the dirty state is intentional. Silent dirty worktrees are the failure mode.
- **Worktrees from `git worktree add`** — same rule, sharper: a transient task-worktree must be left clean (committed + pushed) before `git worktree remove`, or the removal refuses and you've stranded the work.

The principle: the working tree at end-of-turn should match the user's mental model of where the work is. "Done" means committed; anything else is paused, and pause states need to be announced.

### Untracked-by-default for vendored / build-copied trees

🚨 Untracked dirs under `additions/source-patched/`, `vendor/`, `third_party/`, `external/`, `upstream/`, `deps/<libname>/`, `pkg-node/`, or `*-bundled`/`*-vendored` paths are **untracked-by-default**. Before staging: `git status --ignored` + read `.gitignore` (look for `dir/*` + `!dir/file` allowlists — the allowlisted file is our hand-written glue, not the whole tree) + grep for the build script that copies the dir in. Ban "must be" / "presumably" / "looks like" when handling someone else's tree — run the command instead. Ask before committing 100+ file or multi-MB drops. Full playbook in [`docs/claude.md/fleet/untracked-by-default.md`](docs/claude.md/fleet/untracked-by-default.md).

### Hook bypasses require the canonical phrase

🚨 Reverting tracked changes or bypassing a hook (--no-verify, DISABLE*PRECOMMIT*\*, --no-gpg-sign, force-push) requires the user to type **`Allow <X> bypass`** verbatim in a recent user turn (e.g. `Allow revert bypass`, `Allow no-verify bypass`). Paraphrases don't count (enforced by `.claude/hooks/no-revert-guard/`). Full phrase table: [`docs/claude.md/fleet/bypass-phrases.md`](docs/claude.md/fleet/bypass-phrases.md).

### Variant analysis on every High/Critical finding

🚨 When a finding lands at severity High or Critical, **search the rest of the repo for the same shape** before closing it. Bugs cluster — same mental model, same antipattern. Three searches: same file (read the whole thing, not just the hunk), sibling files (`rg` the shape, not the names), cross-package (parallel implementations love to drift).

Skip for style nits. Full taxonomy in [`.claude/skills/_shared/variant-analysis.md`](.claude/skills/_shared/variant-analysis.md). Cross-fleet variants become a _Drift watch_ task — open `chore(sync): cascade <fix>` (enforced by `.claude/hooks/variant-analysis-reminder/`).

### Compound lessons into rules

When the same kind of finding fires twice — across two runs, two PRs, or two fleet repos — **promote it to a rule** instead of fixing it again. Land it in CLAUDE.md, a `.claude/hooks/*` block, or a skill prompt — pick the lowest-friction surface. Always cite the original incident in a `**Why:**` line. Skip the retrospective doc; the rule is the artifact (enforced by `.claude/hooks/compound-lessons-reminder/`). Discipline: [`.claude/skills/_shared/compound-lessons.md`](.claude/skills/_shared/compound-lessons.md).

Every new `.claude/hooks/<name>/` hook must have a matching `(enforced by `.claude/hooks/<name>/`)` reference in CLAUDE.md before the hook's `index.mts` can be written (enforced by `.claude/hooks/new-hook-claude-md-guard/`). Hooks ignore CLAUDE.md themselves — citing the enforcer inline keeps the rule visible to whoever's reading either surface.

### Plan review before approval

For non-trivial work (multi-file refactor, new feature, migration), the plan itself is a deliverable. List steps numerically, name files you'll touch, name rules you'll honor — don't bury the plan in prose. If the plan touches fleet-shared resources (this CLAUDE.md fleet block, hooks, `_shared/`), invite a second-opinion pass before writing code. If the plan adds a fleet rule, name the original incident (per _Compound lessons_) (enforced by `.claude/hooks/plan-review-reminder/`).

### Plan storage

🚨 Design / implementation / migration plan docs live at `<repo-root>/.claude/plans/<lowercase-hyphenated>.md` and are **never tracked by version control** — the fleet `.gitignore` excludes `/.claude/*` and `plans/` is intentionally absent from the allowlist. Don't write plans into `docs/plans/` or a package-level `<pkg>/docs/plans/` (enforced by `.claude/hooks/plan-location-guard/`; bypass: `Allow plan-location bypass`). Full rationale + migration guidance in [`docs/claude.md/fleet/plan-storage.md`](docs/claude.md/fleet/plan-storage.md).

### Drift watch

🚨 **Drift across fleet repos is a defect, not a feature.** When two socket-\* repos pin different versions of the same shared resource (a tool in `external-tools.json`, a workflow SHA, a CLAUDE.md fleet block, a hook in `.claude/hooks/`, an upstream submodule, `.gitmodules` `# name-version` annotations enforced by `.claude/hooks/gitmodules-comment-guard/`, pnpm/Node `packageManager`/`engines`), **opt for the latest**. Canonical sources: `socket-registry`'s `setup-and-install` action for tool SHAs; `socket-wheelhouse`'s `template/` tree for `.claude/`, CLAUDE.md fleet block, hooks. Either reconcile in the same PR or open `chore(sync): cascade <thing> from <newer-repo>` and link it (enforced by `.claude/hooks/drift-check-reminder/`). Full drift-surface list + cascade-PR convention in [`docs/claude.md/fleet/drift-watch.md`](docs/claude.md/fleet/drift-watch.md).

### Never fork fleet-canonical files locally

🚨 Edit fleet-canonical files (anything in the sync manifest) ONLY in `socket-wheelhouse/template/...` — never in a downstream repo. Spot a missing helper in a downstream copy? Lift it upstream and re-cascade (enforced by `.claude/hooks/no-fleet-fork-guard/`; bypass: `Allow fleet-fork bypass`). Full canonical-surface list + lifting workflow: [`docs/claude.md/wheelhouse/no-local-fork-canonical.md`](docs/claude.md/wheelhouse/no-local-fork-canonical.md).

### Code style

Default to no comments (enforced by `.claude/hooks/no-meta-comments-guard/` for meta-labels + removed-code refs); when written, write for a junior reader. Parsers mirroring an upstream get the exception ([`docs/claude.md/fleet/parser-comments.md`](docs/claude.md/fleet/parser-comments.md)). Pointer comments (`// see X`) need both the destination and an inline one-line claim (enforced by `.claude/hooks/pointer-comment-guard/`). Heaviest invariants: no `TODO`/`FIXME`/stubs; `undefined` over `null`; `httpJson`/`httpText` from `@socketsecurity/lib/http-request` over `fetch()`; `safeDelete()` from `@socketsecurity/lib/fs` over `fs.rm`; Edit tool over `sed`/`awk`; `'CI' in process.env` presence check over truthy; `import os from 'node:os'` over named imports; `getDefaultLogger()` over `console.*` (enforced by `.claude/hooks/logger-guard/`); doc filenames `lowercase-with-hyphens.md` under `docs/` or `.claude/` (enforced by `.claude/hooks/markdown-filename-guard/`). Full ruleset (object literals, imports, subprocesses, file existence, generated reports, sorting, Promise.race, Safe suffix, `node:smol-*`, inclusive language) in [`docs/claude.md/fleet/code-style.md`](docs/claude.md/fleet/code-style.md). See also [`docs/claude.md/fleet/sorting.md`](docs/claude.md/fleet/sorting.md) and [`docs/claude.md/fleet/inclusive-language.md`](docs/claude.md/fleet/inclusive-language.md).

### File size

Soft cap **500 lines**, hard cap **1000 lines** per source file. Past those, split along natural seams — group by domain, not line count; name files for what's in them; co-locate helpers with consumers. Exceptions: a single function that legitimately needs the space (note it inline), or a generated artifact. Full playbook in [`docs/claude.md/fleet/file-size.md`](docs/claude.md/fleet/file-size.md).

### Lint rules: errors over warnings, fixable over reporting

- **Errors, not warnings.** Default `"error"` for new rules.
- **Fixable when possible.** Ship an autofix (`fixable: 'code'` + `fix(fixer) => ...`) whenever the rewrite is deterministic.
- **Skill or hook ≠ no rule.** Defense in depth — skill is docs, hook is edit-time, lint is commit-time.
- **Tooling: oxlint + oxfmt only.** No ESLint, no Prettier. Fleet socket-\* oxlint plugin lives in `template/.config/oxlint-plugin/`.
- **Invoke oxfmt / oxlint with `-c .config/...rc.json` explicitly.** Both tools accept a `-c PATH` (oxfmt) / `--config PATH` (oxlint). The fleet keeps both configs under `.config/`, not at repo root. Without the flag, the tools fall through to their built-in defaults — oxfmt's default is double-quotes + semis, the opposite of the fleet style, and would silently rewrite ~200 files on `pnpm run format`. Canonical script bodies in `manifest.mts` already encode the flag; the sync-scaffolding gate rewrites drifted scripts back to the canonical form.

Full rationale + cascade behavior in [`docs/claude.md/fleet/lint-rules.md`](docs/claude.md/fleet/lint-rules.md).

### 1 path, 1 reference

A path is constructed exactly once. Everywhere else references the constructed value.

- **Within a package**: every script imports its own `scripts/paths.mts`. No `path.join('build', mode, …)` outside that module. `paths.mts` is per-package (like `package.json`) — every package that has a `scripts/` dir has its own.
- **Across packages**: package B imports package A's `paths.mts` via the workspace `exports` field. Never `path.join(PKG, '..', '<sibling>', 'build', …)`.
- **Sub-packages inherit**: a sub-package's `paths.mts` `export * from '<rel>/paths.mts'` from the nearest ancestor and adds local overrides below the re-export. Don't re-derive `REPO_ROOT` / `CONFIG_DIR` / `NODE_MODULES_CACHE_DIR` (enforced by `.claude/hooks/paths-mts-inherit-guard/`).
- **Not just build paths**: `paths.mts` is for _every_ path the package constructs — config files (`socket-wheelhouse.json`), lockfiles, cache dirs, manifest files. The fleet ships a starter `template/scripts/paths.mts` that exports the common constants + `loadSocketWheelhouseConfig()`.
- **Workflows / Dockerfiles / shell** can't `import` TS — construct once, reference by output / `ENV` / variable.
- **Canonical layout**: build outputs live at `<package-root>/build/<mode>/<platform-arch>/out/Final/<artifact>`, where `mode ∈ {dev, prod}` and `platform-arch` is the Node-style `<process.platform>-<process.arch>` (e.g. `darwin-arm64`, `linux-x64`). socket-btm is the worked example; ultrathink follows it; smaller TS-only repos that don't fork by platform may use `'any'` as the platform-arch sentinel but keep the same nesting. Each package's `scripts/paths.mts` exports `PACKAGE_ROOT`, `BUILD_ROOT`, and `getBuildPaths(mode, platformArch)` returning at minimum `outputFinalDir` + `outputFinalFile`/`outputFinalBinary`.

Three-level enforcement: `.claude/hooks/path-guard/` blocks build-path construction outside `paths.mts` at edit time; `.claude/hooks/paths-mts-inherit-guard/` blocks sub-package `paths.mts` files that don't inherit from the nearest ancestor; `scripts/check-paths.mts` is the whole-repo gate run by `pnpm check`; `/guarding-paths` is the audit-and-fix skill. Find the canonical owner and import from it.

### Cross-platform path matching

When a regex matches against a path string, **normalize the path first** with `normalizePath` (or `toUnixPath`) from `@socketsecurity/lib/paths/normalize` and write the regex against `/` only. Don't write dual-separator patterns like `[/\\]` — they're easy to miss in some branches, slower to read, and they multiply when you add `\\\\` for escaped Windows separators. `normalizePath` is the same helper the fleet uses everywhere; relying on it gives one path representation across `darwin` / `linux` / `win32` (enforced by `.claude/hooks/path-regex-normalize-reminder/`). Bypass: `Allow path-regex-normalize bypass`.

### Background Bash

Never use `Bash(run_in_background: true)` for test / build commands (`vitest`, `pnpm test`, `pnpm build`, `tsgo`). Backgrounded runs you don't poll get abandoned and leak Node workers. Background mode is for dev servers and long migrations whose results you'll consume. If a run hangs, kill it: `pkill -f "vitest/dist/workers"`. The `.claude/hooks/stale-process-sweeper/` `Stop` hook reaps true orphans as a safety net.

When writing or extending a Bash-allowlist hook, prefer **AST-based parsing** over regex matchers when the rule needs to reason about command structure (chains, subshells, redirects, command substitution). Regex matchers approve `git $(echo rm) foo.txt` because the surface looks like `git`; an AST parser sees the substitution and blocks. Pure-syntactic rules (binary name only) can stay regex; structure-sensitive rules (no writes to `.env*`, no destructive chains, no `$(…)` containing destructive verbs) need a parser. Pattern reference: https://github.com/ldayton/Dippy.

### Judgment & self-evaluation

- If the request is based on a misconception, say so before executing.
- If you spot an adjacent bug, flag it: "I also noticed X — want me to fix it?"
- Fix warnings (lint / type / build / runtime) when you see them — don't leave them for later.
- **Default to perfectionist** when you have latitude. "Works now" ≠ "right." Don't offer "do it right" vs "ship fast" as a binary choice menu — pick perfectionist and execute (enforced by `.claude/hooks/perfectionist-reminder/`).
- Before calling done: perfectionist vs. pragmatist views. Default perfectionist absent a signal.
- If a fix fails twice: stop, re-read top-down, state where the mental model was wrong, try something fundamentally different.
- **When the user authorizes a queue** ("complete each one", "hammer it out", "100%", "do them all"): finish every item before stopping. Don't post "what's next?" / "honest stopping point" / "session totals" after one item — that re-litigates intent already given. Continue until the queue is empty or a genuine blocker hits (enforced by `.claude/hooks/dont-stop-mid-queue-reminder/`).

### Error messages

An error message is UI. The reader should fix the problem from the message alone. Four ingredients in order:

1. **What** — the rule, not the fallout (`must be lowercase`, not `invalid`).
2. **Where** — exact file / line / key / field / flag.
3. **Saw vs. wanted** — the bad value and the allowed shape or set.
4. **Fix** — one imperative action (`rename the key to …`).

Use `isError` / `isErrnoException` / `errorMessage` / `errorStack` from `@socketsecurity/lib/errors` over hand-rolled checks. Use `joinAnd` / `joinOr` from `@socketsecurity/lib/arrays` for allowed-set lists. Vague-shape `throw new Error("…")` strings are flagged on Stop (enforced by `.claude/hooks/error-message-quality-reminder/`). Full guidance in [`docs/claude.md/fleet/error-messages.md`](docs/claude.md/fleet/error-messages.md).

### Token hygiene

🚨 Never emit the raw value of any secret to tool output, commits, comments, or replies; when blocked, rewrite — don't bypass. Redact `token` / `jwt` / `api_key` / `secret` / `password` / `authorization` fields when citing API responses (enforced by `.claude/hooks/token-guard/`). Long-lived CLI logins are auto-rotated to limit stale-token exposure (enforced by `.claude/hooks/auth-rotation-reminder/`).

**Tokens belong in env vars (CI) or the OS keychain (dev local), never in `.env` / `.env.local` / `.envrc` dotfiles.** Dotfiles leak via accidental commits, file-indexers, backup clients, shell-history dumps. Run `node .claude/hooks/setup-security-tools/install.mts` to prompt + persist via macOS Keychain / Linux libsecret / Windows CredentialManager (enforced by `.claude/hooks/no-token-in-dotenv-guard/`).

**Socket API token env var** — canonical fleet name is `SOCKET_API_TOKEN` (legacy `SOCKET_API_KEY` / `SOCKET_SECURITY_API_TOKEN` / `SOCKET_SECURITY_API_KEY` accepted as aliases for one cycle). Don't confuse with `SOCKET_CLI_API_TOKEN` (socket-cli's separate setting).

Full spec (hook details, personal-path placeholders, cross-repo path references) in [`docs/claude.md/fleet/token-hygiene.md`](docs/claude.md/fleet/token-hygiene.md).

### Agents & skills

- `/scanning-security` — AgentShield + zizmor audit
- `/scanning-quality` — quality analysis
- Shared subskills in `.claude/skills/_shared/`
- **Handing off to another agent** — see [`docs/claude.md/fleet/agent-delegation.md`](docs/claude.md/fleet/agent-delegation.md).
- **Skill scope tiers** (fleet / partial / unique), the `updating` umbrella + `updating-*` siblings convention, and the `scripts/run-skill-fleet.mts` cross-fleet runner in [`docs/claude.md/fleet/agents-and-skills.md`](docs/claude.md/fleet/agents-and-skills.md).

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
