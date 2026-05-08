# CLAUDE.md

**MANDATORY**: Act as principal-level engineer. Follow these guidelines exactly.

<!-- BEGIN FLEET-CANONICAL — sync via socket-repo-template/scripts/sync-scaffolding.mts. Do not edit downstream. -->

## 📚 Fleet Standards

### Identifying users

Identify users by git credentials and use their actual name. Use "you/your" when speaking directly; use names when referencing contributions.

### Parallel Claude sessions

This repo may have multiple Claude sessions running concurrently against the same checkout, against parallel git worktrees, or against sibling clones. Several common git operations are hostile to that.

**Forbidden in the primary checkout:**

- `git stash` — shared store; another session can `pop` yours
- `git add -A` / `git add .` — sweeps files from other sessions
- `git checkout <branch>` / `git switch <branch>` — yanks the working tree out from under another session
- `git reset --hard` against a non-HEAD ref — discards another session's commits

**Required for branch work:** spawn a worktree.

```bash
BASE=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo main)
git worktree add -b <task-branch> ../<repo>-<task> "$BASE"
cd ../<repo>-<task>
# edit / commit / push from here; primary checkout is untouched
git worktree remove ../<repo>-<task>
```

The `BASE` lookup resolves the remote's default branch — usually `main`, but legacy repos still use `master`. Never hard-code one; use `git symbolic-ref refs/remotes/origin/HEAD` (or fall back to `main` if the remote isn't set). See [Default branch fallback](#default-branch-fallback) below.

**Required for staging:** surgical `git add <specific-file>`. Never `-A` / `.`.

**Never revert files you didn't touch.** If `git status` shows unfamiliar changes, leave them — they belong to another session, an upstream pull, or a hook side-effect.

The umbrella rule: never run a git command that mutates state belonging to a path other than the file you just edited.

### Default branch fallback

Always **favor `main` and fall back to `master`** when scripting git operations that target the default branch. Never hard-code either name — fleet repos are mostly on `main`, but a few legacy / vendored repos still use `master`, and a script that hard-codes `main` silently no-ops on those.

The canonical lookup, in order of preference:

```bash
# Best: ask the remote what its HEAD points to
BASE=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')

# Fallback 1: prefer main if it exists
if [ -z "$BASE" ] && git show-ref --verify --quiet refs/remotes/origin/main; then
  BASE=main
fi

# Fallback 2: fall back to master if main doesn't exist
if [ -z "$BASE" ] && git show-ref --verify --quiet refs/remotes/origin/master; then
  BASE=master
fi

# Last resort: assume main and let the next git command fail loudly
BASE="${BASE:-main}"
```

Apply this in: worktree creation, base-ref resolution for `git diff` / `git rev-list`, PR base detection in scripts, default-branch comparisons in skills, hook scripts that walk history. Documentation and CLAUDE.md examples can write `main` for clarity, but the underlying scripts must do the lookup.

The order **main → master** matches fleet reality (overwhelming majority on `main`); reversing it would silently pick the wrong branch in repos that have both (e.g., during a rename migration).

### Public-surface hygiene

🚨 The four rules below have hooks that re-print the rule on every public-surface `git` / `gh` command. The rules apply even when the hooks are not installed.

- **Real customer / company names** — never write one into a commit, PR, issue, comment, or release note. Replace with `Acme Inc` or rewrite the sentence to not need the reference. (No enumerated denylist exists — a denylist is itself a leak.)
- **Private repos / internal project names** — never mention. Omit the reference entirely; don't substitute "an internal tool" — the placeholder is a tell.
- **Linear refs** — never put `SOC-123`/`ENG-456`/Linear URLs in code, comments, or PR text. Linear lives in Linear.
- **Publish / release / build-release workflows** — never `gh workflow run|dispatch` or `gh api …/dispatches`. Dispatches are irrevocable. The user runs them manually. Bypass: a `gh workflow run` with `-f dry-run=true` is allowed when the target workflow declares a `dry-run:` input under `workflow_dispatch.inputs` and no force-prod override (`-f release=true` / `-f publish=true` / `-f prod=true`) is set.
- **Workflow input naming** — `workflow_dispatch.inputs` keys are kebab-case (`dry-run`, `build-mode`), not snake_case. The release-workflow-guard hook only recognizes kebab; a `dry_run` input silently fails the dry-run bypass.

### Commits & PRs

- Conventional Commits `<type>(<scope>): <description>` — NO AI attribution.
- **When adding commits to an OPEN PR**, update the PR title and description to match the new scope. Use `gh pr edit <num> --title … --body …`. The reviewer should know what's in the PR without scrolling commits.
- **Replying to Cursor Bugbot** — reply on the inline review-comment thread, not as a detached PR comment: `gh api repos/{owner}/{repo}/pulls/{pr}/comments/{comment_id}/replies -X POST -f body=…`.

### Programmatic Claude calls

🚨 Workflows / skills / scripts that invoke `claude` CLI or `@anthropic-ai/claude-agent-sdk` MUST set all four lockdown flags: `tools`, `allowedTools`, `disallowedTools`, `permissionMode: 'dontAsk'`. Never `default` mode in headless contexts. Never `bypassPermissions`. See `.claude/skills/locking-down-programmatic-claude/SKILL.md`.

### Tooling

- **Package manager**: `pnpm`. Run scripts via `pnpm run foo --flag`, never `foo:bar`. After `package.json` edits, `pnpm install`.
- 🚨 NEVER use `npx`, `pnpm dlx`, or `yarn dlx` — use `pnpm exec <package>` or `pnpm run <script>` # socket-hook: allow npx
- **`packageManager` field** — bare `pnpm@<version>` is correct for pnpm 11+. pnpm 11 stores the integrity hash in `pnpm-lock.yaml` (separate YAML document) instead of inlining it in `packageManager`; on install pnpm rewrites the field to its bare form and migrates legacy inline hashes automatically. Don't fight the strip. Older repos may still ship `pnpm@<version>+sha512.<hex>` — leave it; pnpm migrates on first install. The lockfile is the integrity source of truth.
- **Monorepo internal `engines.node`** — only the workspace root needs `engines.node`. Private (`"private": true`) sub-packages in `packages/*` don't need their own `engines.node` field; the field is dead, drift-prone, and removing it is the cleaner play. Public-published sub-packages (the npm-published ones with no `"private": true`) keep their `engines.node` because external consumers see it.
- **Config files in `.config/`** — place tool / test / build configs in `.config/`: `taze.config.mts`, `vitest.config.mts`, `tsconfig.base.json` and other `tsconfig.*.json` variants, `esbuild.config.mts`. New configs go in `.config/` by default. Repo root keeps only what _must_ be there: package manifests + lockfile (`package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`), the linter / formatter dotfiles whose tools require root placement (`.oxlintrc.json`, `.oxfmtrc.json`, `.npmrc`, `.gitignore`, `.node-version`), and `tsconfig.json` itself (TypeScript's project root anchor — the rest of the tsconfig graph extends from `.config/tsconfig.base.json`).
- **Runners are `.mts`, not `.sh`** — every executable script (skill runner, hook handler, fleet automation) is TypeScript via `node <file>.mts`. Bash works on macOS/Linux but breaks on Windows; `bash` isn't on Windows PATH by default and `if [ ... ]` / `${VAR:-default}` aren't portable. The fleet runs on developer machines (mixed macOS / Linux / Windows / WSL) and CI (Linux), so cross-platform is a hard requirement. Use `@socketsecurity/lib/spawn` (`spawn`, `isSpawnError`) instead of `child_process` — it ships consistent error shapes (`SpawnError`), `stdioString: true` for buffered stdout, and integrates with the rest of the lib. Reach for `_shared/scripts/*.mts` for cross-skill helpers (default-branch resolution, report formatting); reach for `<skill>/run.mts` for skill-specific implementation. Reserve `.sh` for tiny one-shot snippets that genuinely have no Windows audience (e.g., a `bin/` wrapper). The `lib/` vs `scripts/` distinction matches `@socketsecurity/lib` (public, importable surface) vs per-package `scripts/` (private, internal automation) — skill helpers are internal, hence `scripts/`.
- **Soak window** (pnpm-workspace.yaml `minimumReleaseAge`, default 7 days) — never add packages to `minimumReleaseAgeExclude` in CI. Locally, ASK before adding (security control).
- **Upstream submodules — always shallow.** Every entry in `.gitmodules` MUST set `shallow = true`. Every `git submodule update --init` call (postinstall.mts, CI, manual) MUST pass `--depth 1 --single-branch`. Upstream repos like yarnpkg/berry, oven-sh/bun, rust-lang/cargo are multi-GB with full history; we only ever need the pinned SHA's tree. A non-shallow init can take 30+ minutes and waste GB of disk on every fresh clone. There is no scenario where the fleet needs upstream submodule history.
- **Backward compatibility** — FORBIDDEN to maintain. Actively remove when encountered.

### No "pre-existing" excuse

🚨 If you see a lint error, type error, test failure, broken comment, or stale comment **anywhere in your reading window** — fix it. Don't label it "pre-existing" and skip past. The label is a tell that you're rationalizing avoiding work; the user reads "pre-existing" the same as "I noticed but chose not to."

The only exceptions:

- The fix is genuinely out of scope (a 2000-line refactor would derail a one-line bug fix). State the trade-off explicitly and ask before deferring.
- You don't have permission (the file belongs to another session per the parallel-Claude rule).

In all other cases: fix it in the same commit, or in a sibling commit on the same branch. Never assume someone else will get to it.

### Unrelated issues are critical

🚨 An issue being **unrelated to the task** is not a reason to defer it — it's a reason to treat it as **critical and fix it immediately**. Unrelated bugs are exactly the bugs nobody is currently looking for; if you walk past one, no one else will catch it either. The instinct to "stay focused on the task" is how regressions accumulate.

When you spot an unrelated bug, broken comment, dead branch, type error, failing test, or stale config:

1. Stop the current task.
2. Fix the unrelated issue first, in its own commit on the same branch (or a sibling commit if scope demands it).
3. Resume the original task.

If the fix is genuinely too large to bundle (a 2000-line refactor on a one-line bug), state the trade-off explicitly and ask before deferring — same exception as the "no pre-existing excuse" rule. Otherwise: unrelated = critical = fix now.

### Don't leave the worktree dirty

🚨 When you finish a code change, **commit it**. Don't end a turn with uncommitted edits, untracked new files, or staged-but-uncommitted hunks lingering in the working tree. A dirty worktree is a half-finished job: another session, another agent, or a future `git checkout` will trip over it, and the user has to clean up after you.

Rules:

- **After finishing a logical unit of work, commit it.** Use a Conventional Commits message per the _Commits & PRs_ rule. Never leave the working tree dirty between turns.
- **Surgical staging only** — `git add <specific-file>`, never `-A` / `.` (per the _Parallel Claude sessions_ rule). The dirty-worktree rule is no excuse to sweep in files you didn't touch.
- **If you genuinely can't commit yet** (the change is mid-refactor, tests are failing, you're waiting on user input), say so explicitly in the turn summary so the user knows the dirty state is intentional. Silent dirty worktrees are the failure mode.
- **Worktrees from `git worktree add`** — same rule, sharper: a transient task-worktree must be left clean (committed + pushed) before `git worktree remove`, or the removal refuses and you've stranded the work.

The principle: the working tree at end-of-turn should match the user's mental model of where the work is. "Done" means committed; anything else is paused, and pause states need to be announced.

### Variant analysis on every High/Critical finding

🚨 When a finding lands at severity High or Critical, **search the rest of the repo for the same shape** before closing it. Bugs cluster — same mental model, same antipattern. Three searches: same file (read the whole thing, not just the hunk), sibling files (`rg` the shape, not the names), cross-package (parallel implementations love to drift).

Skip for style nits. Full taxonomy in [`.claude/skills/_shared/variant-analysis.md`](.claude/skills/_shared/variant-analysis.md). Cross-fleet variants become a _Drift watch_ task — open `chore(sync): cascade <fix>`.

### Compound lessons into rules

When the same kind of finding fires twice — across two runs, two PRs, or two fleet repos — **promote it to a rule** instead of fixing it again. Land it in CLAUDE.md, a `.claude/hooks/*` block, or a skill prompt — pick the lowest-friction surface. Always cite the original incident in a `**Why:**` line. Skip the retrospective doc; the rule is the artifact. Discipline: [`.claude/skills/_shared/compound-lessons.md`](.claude/skills/_shared/compound-lessons.md).

### Plan review before approval

For non-trivial work (multi-file refactor, new feature, migration), the plan itself is a deliverable. List steps numerically, name files you'll touch, name rules you'll honor — don't bury the plan in prose. If the plan touches fleet-shared resources (this CLAUDE.md fleet block, hooks, `_shared/`), invite a second-opinion pass before writing code. If the plan adds a fleet rule, name the original incident (per _Compound lessons_).

### Drift watch

🚨 **Drift across fleet repos is a defect, not a feature.** When you see two socket-\* repos pinning different versions of the same shared resource — a tool in `external-tools.json`, a workflow SHA, a CLAUDE.md fleet block, an action in `.github/actions/`, an upstream submodule SHA, a hook in `.claude/hooks/` — **opt for the latest**. The repo with the newer version is the source of truth; older repos catch up.

Where drift commonly hides:

- `external-tools.json` — pnpm/zizmor/sfw versions + per-platform sha256s
- `socket-registry/.github/actions/*` — composite-action SHAs pinned in consumer workflows
- `template/CLAUDE.md` `<!-- BEGIN FLEET-CANONICAL -->` block — must be byte-identical across the fleet
- `template/.claude/hooks/*` — same hook, same code
- lockstep.json `pinned_sha` rows — upstream submodules tracked by socket-btm
- `.gitmodules` `# name-version` annotations
- pnpm/Node `packageManager`/`engines` fields

How to check:

1. If you're editing one of these in repo A, grep the same thing in repos B/C/D. If A is older, bump A first; if A is newer, plan a sync to B/C/D.
2. `socket-registry`'s `setup-and-install` action is the canonical source for tool SHAs. Diverging from it is drift.
3. `socket-repo-template`'s `template/` tree is the canonical source for `.claude/`, CLAUDE.md fleet block, and hook code. Diverging is drift.
4. Run `pnpm run sync-scaffolding` (in repos that have it) to surface drift programmatically.

Never silently let drift sit. Either reconcile in the same PR or open a follow-up PR titled `chore(sync): cascade <thing> from <newer-repo>` and link it.

### Code style

- **Comments** — default to none. Write one only when the WHY is non-obvious to a senior engineer. **When you do write a comment, the audience is a junior dev**: explain the constraint, the hidden invariant, the "why this and not the obvious thing." Don't label it ("for junior devs:", "intuition:", etc.) — just write in that voice. No teacher-tone, no condescension, no flattering the reader.
- **Completion** — never leave `TODO` / `FIXME` / `XXX` / shims / stubs / placeholders. Finish 100%. If too large for one pass, ask before cutting scope.
- **`null` vs `undefined`** — use `undefined`. `null` is allowed only for `__proto__: null` or external API requirements.
- **Object literals** — `{ __proto__: null, ... }` for config / return / internal-state.
- **Imports** — no dynamic `await import()`. `node:fs` cherry-picks (`existsSync`, `promises as fs`); `path` / `os` / `url` / `crypto` use default imports. Exception: `fileURLToPath` from `node:url`.
- **HTTP** — never `fetch()`. Use `httpJson` / `httpText` / `httpRequest` from `@socketsecurity/lib/http-request`.
- **Subprocesses** — prefer async `spawn` from `@socketsecurity/lib/spawn` over `spawnSync` from `node:child_process`. Async unblocks parallel tests / event-loop work; the sync version freezes the runner for the duration of the child. Use `spawnSync` only when you genuinely need synchronous semantics (script bootstrapping, a hot loop where awaiting would invert control flow). When you do need stdin input: `const child = spawn(cmd, args, opts); child.stdin?.end(payload); const r = await child;` — the lib's `spawn` returns a thenable child handle, not a `{ input }` option. Throws `SpawnError` on non-zero exit; catch with `isSpawnError(e)` to read `e.code` / `e.stderr`.
- **File existence** — `existsSync` from `node:fs`. Never `fs.access` / `fs.stat`-for-existence / async `fileExists` wrapper.
- **File deletion** — route every delete through `safeDelete()` / `safeDeleteSync()` from `@socketsecurity/lib/fs`. Never `fs.rm` / `fs.unlink` / `fs.rmdir` / `rm -rf` directly — even for one known file. Prefer the async `safeDelete()` over `safeDeleteSync()` when the surrounding code is already async (test bodies, request handlers, build scripts that await elsewhere) — sync I/O blocks the event loop and there's no benefit when the caller is awaiting anyway. Reserve `safeDeleteSync()` for top-level scripts whose entire flow is sync.
- **Edits** — Edit tool, never `sed` / `awk`.
- **Generated reports** — quality scans, security audits, perf snapshots, anything an automated tool emits — write to `.claude/reports/` (naturally gitignored as part of `.claude/*`, no separate rule needed). Never commit reports to a tracked `reports/`, `docs/reports/`, or similarly-named tracked directory: dated reports rot the moment they land and the directory becomes a graveyard. The current state of the repo is the report; tools regenerate findings on demand. If a finding is genuinely worth keeping past one run, fix it or open an issue — don't pickle it as a markdown file.
- **Inclusive language** — see [`docs/references/inclusive-language.md`](docs/references/inclusive-language.md) for the substitution table.
- **Sorting** — sort alphanumerically (literal byte order, ASCII before letters). Applies to: object property keys (config + return shapes + internal state — `__proto__: null` first); named imports inside a single statement (`import { a, b, c }`); `Set` / `SafeSet` constructor arguments; allowlists / denylists / config arrays / interface members. Position-bearing arrays (where index matters) keep their meaningful order. Full details in [`docs/references/sorting.md`](docs/references/sorting.md). When in doubt, sort.
- **`Promise.race` / `Promise.any` in loops** — never re-race a pool that survives across iterations (the handlers stack). See `.claude/skills/plug-leaking-promise-race/SKILL.md`.
- **`Safe` suffix** — non-throwing wrappers end in `Safe` (`safeDelete`, `safeDeleteSync`, `applySafe`, `weakRefSafe`). Read it as "X, but safe from throwing." The wrapper traps the thrown value internally and returns `undefined` (or the documented fallback). Don't invent alternative suffixes (`Try`, `OrUndefined`, `Maybe`) — pick `Safe`.
- **`node:smol-*` modules** — feature-detect, then require. From outside socket-btm (socket-lib, socket-cli, anywhere else): `import { isBuiltin } from 'node:module'; if (isBuiltin('node:smol-X')) { const mod = require('node:smol-X') }`. The `node:smol-*` namespace is provided by socket-btm's smol Node binary; on stock Node `isBuiltin` returns false and the require would throw. Wrap the loader in a `/*@__NO_SIDE_EFFECTS__*/` lazy-load that caches the result — see `socket-lib/src/smol/util.ts` and `socket-lib/src/smol/primordial.ts` for canonical shape. **Inside** socket-btm's `additions/source-patched/` JS (the smol binary's own bootstrap code), use `internalBinding('smol_X')` directly — that's the C++-binding access path and it's guaranteed available there.

### File size

Source files have a **soft cap of 500 lines** and a **hard cap of 1000 lines**. Past those thresholds, split the file along its natural seams. Long files are not a badge of thoroughness — they are a sign the module is doing too many things.

How to split:

- **Group by domain or concept, not by line count.** Lines 0–500 of a 1500-line file is not a split. Find the natural boundary (one tool per file, one ecosystem per file, one orchestration phase per file) and cut there.
- **Name the new files for what they are.** `spawn-cdxgen.mts`, `spawn-coana.mts`, `parse-arguments.mts`, `validate-options.mts` — the file name should match what's inside it. Avoid generic suffixes (`-helpers`, `-utils`, `-lib`) that just kick the can down the road.
- **Co-locate related helpers with their consumer.** A helper used only by one function lives next to that function in the same file (or the same domain split). A helper used across three files lives in a shared module named after the concept (`format-purl.mts`, not `purl-helpers.mts`).
- **Update the index/barrel only if one already exists.** Don't introduce a barrel just to hide the split — let importers update their paths to the specific file. Barrels are for stable public surfaces.
- **Run tests after each split, not at the end.** A reviewable commit is one logical extraction. Batching ten splits into one commit makes a regression impossible to bisect.

When NOT to split:

- A single function legitimately needs 500 lines (a parser, a state machine, a configuration table). State this in a one-line comment at the top of the function.
- The file is a generated artifact (lockfile-style data, schema dump). Generated files don't count toward the cap.

The principle: **a reader should be able to predict what's in a file from its name, and find what they need without scrolling past three other concerns.** If a file's table-of-contents reads like "this and also that and also the other thing," it's overdue for a split.

### 1 path, 1 reference

A path is constructed exactly once. Everywhere else references the constructed value.

- **Within a package**: every script imports its own `scripts/paths.mts`. No `path.join('build', mode, …)` outside that module.
- **Across packages**: package B imports package A's `paths.mts` via the workspace `exports` field. Never `path.join(PKG, '..', '<sibling>', 'build', …)`.
- **Workflows / Dockerfiles / shell** can't `import` TS — construct once, reference by output / `ENV` / variable.
- **Canonical layout**: build outputs live at `<package-root>/build/<mode>/<platform-arch>/out/Final/<artifact>`, where `mode ∈ {dev, prod}` and `platform-arch` is the Node-style `<process.platform>-<process.arch>` (e.g. `darwin-arm64`, `linux-x64`). socket-btm is the worked example; ultrathink follows it; smaller TS-only repos that don't fork by platform may use `'any'` as the platform-arch sentinel but keep the same nesting. Each package's `scripts/paths.mts` exports `PACKAGE_ROOT`, `BUILD_ROOT`, and `getBuildPaths(mode, platformArch)` returning at minimum `outputFinalDir` + `outputFinalFile`/`outputFinalBinary`.

Three-level enforcement: `.claude/hooks/path-guard/` blocks at edit time; `scripts/check-paths.mts` is the whole-repo gate run by `pnpm check`; `/guarding-paths` is the audit-and-fix skill. Find the canonical owner and import from it.

### Background Bash

Never use `Bash(run_in_background: true)` for test / build commands (`vitest`, `pnpm test`, `pnpm build`, `tsgo`). Backgrounded runs you don't poll get abandoned and leak Node workers. Background mode is for dev servers and long migrations whose results you'll consume. If a run hangs, kill it: `pkill -f "vitest/dist/workers"`. The `.claude/hooks/stale-process-sweeper/` `Stop` hook reaps true orphans as a safety net.

When writing or extending a Bash-allowlist hook, prefer **AST-based parsing** over regex matchers when the rule needs to reason about command structure (chains, subshells, redirects, command substitution). Regex matchers approve `git $(echo rm) foo.txt` because the surface looks like `git`; an AST parser sees the substitution and blocks. Pure-syntactic rules (binary name only) can stay regex; structure-sensitive rules (no writes to `.env*`, no destructive chains, no `$(…)` containing destructive verbs) need a parser. Pattern reference: https://github.com/ldayton/Dippy.

### Judgment & self-evaluation

- If the request is based on a misconception, say so before executing.
- If you spot an adjacent bug, flag it: "I also noticed X — want me to fix it?"
- Fix warnings (lint / type / build / runtime) when you see them — don't leave them for later.
- **Default to perfectionist** when you have latitude. "Works now" ≠ "right."
- Before calling done: perfectionist vs. pragmatist views. Default perfectionist absent a signal.
- If a fix fails twice: stop, re-read top-down, state where the mental model was wrong, try something fundamentally different.

### Error messages

An error message is UI. The reader should fix the problem from the message alone. Four ingredients in order:

1. **What** — the rule, not the fallout (`must be lowercase`, not `invalid`).
2. **Where** — exact file / line / key / field / flag.
3. **Saw vs. wanted** — the bad value and the allowed shape or set.
4. **Fix** — one imperative action (`rename the key to …`).

Use `isError` / `isErrnoException` / `errorMessage` / `errorStack` from `@socketsecurity/lib/errors` over hand-rolled checks. Use `joinAnd` / `joinOr` from `@socketsecurity/lib/arrays` for allowed-set lists. Full guidance in [`docs/references/error-messages.md`](docs/references/error-messages.md).

### Token hygiene

🚨 Never emit the raw value of any secret to tool output, commits, comments, or replies. The `.claude/hooks/token-guard/` `PreToolUse` hook blocks the deterministic patterns (literal token shapes, env dumps, `.env*` reads, unfiltered `curl -H "Authorization:"`, sensitive-name commands without redaction). When the hook blocks a command, rewrite — don't bypass.

Behavior the hook can't catch: redact `token` / `jwt` / `access_token` / `refresh_token` / `api_key` / `secret` / `password` / `authorization` fields when citing API responses. Show key _names_ only when displaying `.env.local`. If a user pastes a secret, treat it as compromised and ask them to rotate.

Full hook spec in [`.claude/hooks/token-guard/README.md`](.claude/hooks/token-guard/README.md).

**Personal-path placeholders** — when a doc / test / comment needs to show an example user-home path, use the canonical platform-specific placeholder so the personal-paths scanner recognizes it as documentation: `/Users/<user>/...` (macOS), `/home/<user>/...` (Linux), `C:\Users\<USERNAME>\...` (Windows). Don't drift to `<name>` / `<me>` / `<USER>` / `<u>` etc. — the scanner accepts anything in `<...>` but a fleet-wide audit relies on the canonical strings being grep-able. Env vars (`$HOME`, `${USER}`, `%USERNAME%`) also satisfy the scanner.

**Socket API token env var** — the canonical fleet name is `SOCKET_API_TOKEN`. The legacy names `SOCKET_API_KEY`, `SOCKET_SECURITY_API_TOKEN`, and `SOCKET_SECURITY_API_KEY` are accepted as aliases for one cycle (deprecation grace period) — bootstrap hooks read all four and normalize to `SOCKET_API_TOKEN` going forward. New `.env.example` files, docs, workflow inputs, and action env exports use `SOCKET_API_TOKEN`. Don't confuse with `SOCKET_CLI_API_TOKEN` (socket-cli's separate setting).

**Cross-repo path references** — `../<fleet-repo>/...` (relative escape) and `/<abs-prefix>/projects/<fleet-repo>/...` (absolute sibling-clone) are both forbidden. Either form hardcodes a clone-layout assumption that breaks in CI / fresh clones / non-standard checkouts. Import via the published npm package (`@socketsecurity/lib/<subpath>`, `@socketsecurity/registry/<subpath>`) — every fleet repo is a real workspace dep. The `cross-repo-guard` PreToolUse hook blocks both forms at edit time; the git-side `scanCrossRepoPaths` gate catches commits/pushes too.

### Agents & skills

- `/scanning-security` — AgentShield + zizmor audit
- `/scanning-quality` — quality analysis
- Shared subskills in `.claude/skills/_shared/`
- **Handing off to another agent** — see [`docs/references/agent-delegation.md`](docs/references/agent-delegation.md) for when to reach for `codex:codex-rescue`, the `delegate` subagent (OpenCode → Fireworks/Synthetic/Kimi), `Explore`, `Plan`, vs. driving the skill CLIs directly. The CLI-subprocess contract used by skills lives in [`_shared/multi-agent-backends.md`](.claude/skills/_shared/multi-agent-backends.md).

#### Skill scope: fleet vs partial vs unique

Every skill under `.claude/skills/` falls into one of three tiers — surface this distinction when adding a new skill so it lands in the right place:

- **Fleet skill** — present in every fleet repo, identical contract everywhere. Examples: `guarding-paths`, `scanning-quality`, `scanning-security`, `updating`, `locking-down-programmatic-claude`, `plug-leaking-promise-race`. New fleet skills land in `socket-repo-template/template/.claude/skills/<name>/` and cascade via `node socket-repo-template/scripts/sync-scaffolding.mts --all --fix`. Track them in `SHARED_SKILL_FILES` in the sync manifest.
- **Partial skill** — present in the subset of repos that need it, identical contract within that subset. Examples: `driving-cursor-bugbot` (every repo with PR review), `updating-lockstep` (every repo with `lockstep.json`), `squashing-history` (repos with the squash workflow). Live in each adopting repo's `.claude/skills/<name>/`. When you change one, propagate to the others.
- **Unique skill** — one repo only, bespoke to that repo's domain. Examples: `updating-cdxgen` (sdxgen), `updating-yoga` (socket-btm), `release` (socket-registry). Never canonical-tracked; the host repo owns it end-to-end.

Audit the current classification with `node socket-repo-template/scripts/run-skill-fleet.mts --list-skills`.

#### `updating` umbrella + `updating-*` siblings

`updating` is the canonical fleet umbrella that runs `pnpm run update` then discovers and runs every `updating-*` sibling skill the host repo registers. The umbrella is fleet-shared; the siblings are per-repo (or partial — e.g. `updating-lockstep` lives in every repo with `lockstep.json`). To add a new repo-specific update step, drop a new `.claude/skills/updating-<domain>/SKILL.md` and the umbrella picks it up automatically — no edits to `updating` itself.

#### Running skills across the fleet

`scripts/run-skill-fleet.mts` (in `socket-repo-template`) spawns one headless `claude --print` agent per fleet repo, in parallel (concurrency 4 by default), with the four lockdown flags set per the _Programmatic Claude calls_ rule above. Per-skill profile table maps known skills to sensible tool/allow/disallow lists; override with `--tools` / `--allow` / `--disallow`. Per-repo logs land in `.cache/fleet-skill/<timestamp>-<skill>/<repo>.log`. Use `Promise.allSettled` semantics — one repo's failure doesn't abort the rest.

```bash
pnpm run fleet-skill updating                       # update every fleet repo
pnpm run fleet-skill scanning-quality --concurrency 2 # slower, more conservative
pnpm run fleet-skill --list-skills                  # classify skills fleet/partial/unique
```

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
