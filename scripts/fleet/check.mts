/**
 * @file Unified check runner — delegates to lint + type + path-hygiene.
 *   Forwards CLI scope flags to the lint script so `pnpm run check --all`
 *   actually runs a full-scope lint (not the default modified-only scope).
 *   `pnpm type` doesn't accept our scope flags, so it's always a full check.
 *   Usage: pnpm run check # lint in modified scope + full type check +
 *   path-hygiene pnpm run check --staged # lint staged + full type + paths pnpm
 *   run check --all # full lint + full type + paths (CI) Byte-identical across
 *   every fleet repo. Sync-scaffolding flags drift.
 */

// prefer-async-spawn: sync-required — top-level CLI runner; entire
// flow is sequential gate-running with exit-code aggregation.
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { discoverRepoChecks } from './_shared/repo-checks.mts'
import { isScopeFlag } from './_shared/scope-flags.mts'
import { REPO_ROOT } from './paths.mts'

const args = process.argv.slice(2)
const forwardedArgs = args.filter(
  a => a === '--fix' || a === '--quiet' || isScopeFlag(a),
)

// spawnSync with array args — no shell interpolation, matches the
// socket/prefer-spawn-over-execsync rule.
function run(cmd: string, cmdArgs: string[]): boolean {
  const r = spawnSync(cmd, cmdArgs, { stdio: 'inherit' })
  return r.status === 0
}

const steps: Array<() => boolean> = [
  // Lint scope is forwarded; everything else is full-scope.
  () => run('node', ['scripts/fleet/lint.mts', ...forwardedArgs]),
  // Verify the socket/ oxlint plugin actually LOADS + registers every rule. A
  // broken plugin import disables every socket/ rule; oxlint only warns on
  // stderr (gating varies by version), and never checks the rule COUNT. This
  // gate asserts both explicitly and fails closed. No-op in repos with no
  // plugin.
  () => run('node', ['scripts/fleet/check/oxlint-plugin-loads.mts']),
  // Fleet uses oxlint + oxfmt ONLY. Fail on a tracked foreign linter/formatter
  // config (biome/eslint/prettier/dprint) or a package.json declaring one as a
  // dep — the committed-state gate paired with the edit-time
  // no-other-linters-guard hook. Vendored upstream (upstream/, vendor/, *-upstream)
  // is exempt; we never touch upstream tooling.
  () => run('node', ['scripts/fleet/check/linters-are-oxlint-oxfmt-only.mts']),
  // CLAUDE.md doc integrity: every cited hook + socket/ rule must exist (catches
  // stale citations after a rename/removal — the reverse of new-hook-claude-md-guard).
  () => run('node', ['scripts/fleet/check/claude-md-citations-resolve.mts']),
  // Code-is-law coverage: every 🚨 (hard-discipline) rule in the CLAUDE.md fleet
  // block and in docs/agents.md/fleet/*.md must resolve to an EXECUTABLE enforcer
  // (a hook with index/install.mts, a socket/ or typescript/ lint rule, or a
  // scripts/{fleet,repo}/*.mts), directly or via the detail surface it links.
  // Where claude-md-rules-are-informative accepts a docs link ALONE as an anchor,
  // this fails a hard rule with no code behind it (the policy-on-paper state the
  // Code-is-law rule forbids). Granularity is the 🚨 paragraph, so a multi-rule
  // section passes only when EVERY hard rule resolves. A rule that genuinely
  // can't be coded carries an inline `<!-- enforcement: <category> reason -->`
  // opt-out.
  () => run('node', ['scripts/fleet/check/claude-md-rules-are-enforced.mts']),
  // Code-is-law: fleet CONVENTION guards (formatter/linter/tooling/code-style)
  // must consult the isFleetTarget detector so they no-op outside a fleet repo;
  // universal-safety guards must NOT. Locks the bidirectional CONVENTION_GUARDS
  // ⟺ isFleetTarget invariant so a threaded guard can't silently un-thread and a
  // new consumer can't lighten itself without being registered.
  () =>
    run('node', [
      'scripts/fleet/check/convention-guards-consult-fleet-context.mts',
    ]),
  // Hook-registry doc integrity: every `- \`<name>\`` bullet in
  // docs/agents.md/fleet/hook-registry.md names a real .claude/hooks/fleet/<name>/
  // dir. CLAUDE.md defers its full hook list to the registry, so a stale/renamed
  // bullet points readers at policy that doesn't exist. Stale bullets fail;
  // undocumented hooks are reported, not enforced (many are internal tooling).
  () => run('node', ['scripts/fleet/check/hook-registry-is-current.mts']),
  // Report-only (exits 0): surfaces feedback/project memories that lack an
  // `enforcement:` disposition when a local memory store exists; skips clean
  // in CI. See memory→code-is-law (#240).
  () => run('node', ['scripts/fleet/check/memories-are-codified.mts']),
  // The _dispatch/dispatch-table.mts matches a fresh regen over the tree's hook
  // dirs — catches a hook added/removed without rebuilding, or a byte-cascaded
  // table referencing an absent hook dir (the concurrent-cargo dangle).
  () => run('node', ['scripts/fleet/check/dispatch-table-is-current.mts']),
  // Every settings.json dispatcher matcher covers the tools its bundled hooks
  // declare — a tool omitted from the coarse matcher never reaches the
  // dispatcher, so that hook silently never fires for it (how
  // dep-derived-source-nudge stopped firing on MultiEdit).
  () =>
    run('node', ['scripts/fleet/check/dispatch-matchers-cover-hook-tools.mts']),
  // Global Claude config stays hardened (copyOnSelect: false → no TUI OSC-52
  // clipboard banner). setup/claude-config.mts sets it; this catches drift.
  () => run('node', ['scripts/fleet/check/claude-config-is-hardened.mts']),
  // Least-privilege GitHub App tokens: every app-token minter step must carry
  // a scoped (non-blank) PERMISSIONS env, never blanket installation
  // permissions. Fleet enforcement of the zizmor `github-app` audit so it holds
  // even where zizmor soft-skips (no upstream binary for the platform).
  () => run('node', ['scripts/fleet/check/app-tokens-are-scoped.mts']),
  // .github/actions/ segmentation: only the fleet/ (cascade-owned) + repo/
  // (host-owned) tiers — a flat action dir sits outside both ownership tiers
  // (the cascade's tombstones prune the historical flat locations). Same
  // fleet/repo split as .claude/hooks/ and the oxlint plugin.
  () => run('node', ['scripts/fleet/check/actions-are-segmented.mts']),
  // Single-source for the co-located app-token minter: every action dir's
  // mint-app-installation-token.mjs copy must be byte-identical (the inlined
  // form of single-source-of-truth — a drifted copy mints with stale logic).
  () =>
    run('node', ['scripts/fleet/check/app-token-minters-are-identical.mts']),
  // Structural floor: every skill dir is a well-formed skill — has a SKILL.md
  // with frontmatter whose name matches the dir + a description. Catches a
  // half-built skill (engine/test, no SKILL.md) that the mirror + citation
  // gates would otherwise trip on later.
  () => run('node', ['scripts/fleet/check/skills-are-well-formed.mts']),
  // Cost routing: every mutating (fix) skill must declare a model: tier so
  // mechanical work runs cheap. See docs/agents.md/fleet/skill-model-routing.md.
  () => run('node', ['scripts/fleet/check/mutating-skills-have-model.mts']),
  // File-doc headers carrying markdown must be plain `/* */` blocks, not `/**`
  // JSDoc — oxfmt's JSDoc reflow drops markdown content on `format`.
  () => run('node', ['scripts/fleet/check/markdown-doc-headers-are-plain.mts']),
  // Commit-time twin of markdown-filename-guard: every tracked .md has a
  // canonical filename (lowercase-hyphens, or an allowlisted SCREAMING_CASE name
  // only at root/docs/.claude). Reuses the guard's classifyMarkdownPath predicate.
  () =>
    run('node', ['scripts/fleet/check/markdown-filenames-are-canonical.mts']),
  // package.json's packageManager + engines.{pnpm,npm} are GENERATED from
  // external-tools.json (the single source); this gate fails on drift.
  () =>
    run('node', ['scripts/fleet/check/package-manager-pins-are-synced.mts']),
  // A lint config's `!` re-include must never re-expose vendored files to
  // lint/--fix (the acorn wasm-bindgen glue break). Fails when a vendored glob
  // is left before the last negation.
  () => run('node', ['scripts/fleet/check/lint-configs-protect-vendored.mts']),
  // The .agents/skills/ mirror is generated + git-untracked (regenerated in
  // every cascade by sync-scaffolding/fix-agents-mirror.mts, and on demand via
  // gen-agents-skills-mirror.mts), so there is no committed mirror for a CI
  // gate to verify "current" against. Staleness is handled by the cascade
  // regen + the agents-skills-mirror-nudge hook, not a check here.
  // Code is law for the onboarding skill's CI step: the ci:local script keeps
  // its canonical agent-ci flag set, and the agent-ci Dockerfile (when adopted)
  // stays byte-identical to the template.
  () => run('node', ['scripts/fleet/check/ci-local-is-canonical.mts']),
  // Agent CI can't parse a gh-aw compiled .lock.yml (GitHub's
  // @actions/workflow-parser crashes on its agent-runtime jobs). The
  // agent-ci-skip-locks.mts wrapper turns that cryptic crash into an
  // informative error/skip; this gate keeps the wrapper's guard surface intact.
  () => run('node', ['scripts/fleet/check/agent-ci-skip-locks-is-guarded.mts']),
  // Cost routing twin: a programmatic AI spawn that pins a model must also pin
  // reasoning effort (CLAUDE.md token-spend). The lib makes effort optional —
  // this gate is the enforcement the optional field can't provide. Vocab per
  // backend: .claude/skills/fleet/_shared/multi-agent-backends.md.
  () => run('node', ['scripts/fleet/check/ai-spawns-have-paired-effort.mts']),
  // Fable-5 refusal fallback: every claude-fable-5 spawn must either route
  // through spawnTierWithFallback('fable',…) or read result.refused /
  // result.servedByFallback so a classifier refusal isn't silently swallowed.
  // Also blocks budget/thinking knobs on Fable (adaptive-only) and hand-rolled
  // --model <fable> argv that bypasses spawnAiAgent. See
  // docs/agents.md/fleet/fable-fallback.md.
  () =>
    run('node', ['scripts/fleet/check/fable-spawns-have-opus-fallback.mts']),
  // Subagent return contract twin: the SubagentStatus union in
  // @socketsecurity/lib/ai/subagent-status and the status table in
  // agent-delegation.md must list the same four states, so an orchestrator
  // reading the doc routes on a contract the code honors (code is law).
  () => run('node', ['scripts/fleet/check/subagent-status-doc-is-current.mts']),
  // Review-pipeline ordering is a contract: the reviewing-code skill's
  // spec-compliance pass must precede the quality passes (discovery /
  // remediation) in ALL_ROLES, so a quality review never runs on out-of-scope
  // code. Parses run.mts and fails if the order regressed (code is law).
  () => run('node', ['scripts/fleet/check/review-stages-are-ordered.mts']),
  // Model-pricing data stays fresh: the cost-ladder figures in skill-model-
  // routing.md drive tier routing, and vendor prices move. Parses the doc's
  // MODEL-PRICING-SNAPSHOT date and REMINDS (non-fatal) when it's >35 days old,
  // pointing the fix at the researching-recency skill. Turns the prose
  // "re-verify if stale" note into an enforced surface (code is law).
  () => run('node', ['scripts/fleet/check/pricing-data-is-current.mts']),
  // Multi-agent routing is legal: every skill's per-role `preferenceOrder`
  // names a known backend and never lists a hybrid one (opencode), which the
  // resolver never auto-picks. Catches a dead/no-op entry at commit time that
  // the runtime would silently skip. Mirrors the @socketsecurity/lib/ai/backends
  // registry; see _shared/multi-agent-backends.md.
  () => run('node', ['scripts/fleet/check/backend-routing-is-legal.mts']),
  // Code is law: every hook + socket/* rule ships thorough tests (both arms,
  // every branch). A token or absent test fails the gate.
  () => run('node', ['scripts/fleet/check/enforcers-have-thorough-tests.mts']),
  // No husk hook dirs: a hook directory holding only node_modules/ (no
  // index.mts / install.mts / README.md) is a rename leftover — git moved the
  // tracked files, the untracked node_modules stayed behind under the old name.
  // 10 such husks accumulated before this gate (2026-06-06). Fails check --all
  // so the next rename sweeps its own leftover.
  () => run('node', ['scripts/fleet/check/hook-dirs-are-not-husks.mts']),
  // Every exporting hook's main() must run only behind the entrypoint guard
  // (`if (process.argv[1] && import.meta.url === ...)`). A bare top-level
  // `main()` / `await withEditGuard(...)` hangs the hook's test on import —
  // this exact hang hit 15 hooks before the gate. Fails check --all so the
  // next hook that forgets the guard is caught, not silently hung.
  () =>
    run('node', ['scripts/fleet/check/hook-main-is-entrypoint-guarded.mts']),
  // Every hook dir must be WIRED — make-hook-dispatch discovers + wires each by
  // its defineHook `hook` export (dispatched) or a SIDE_EFFECT entry (spawned).
  // ADVISORY (never fails): surface `_shared/` hook-helper exports with no
  // in-repo consumer — dead weight in the cascaded layer / a DRY signal. Can't
  // hard-gate: some are consumed out-of-repo (user-global dispatch) and removal
  // is a judgment call. The fleet DRY sweep is plan-only.
  () => run('node', ['scripts/fleet/check/shared-hook-helpers-are-used.mts']),
  // Error messages are UI (CLAUDE.md "Error messages"): no bare vague-only
  // `throw new Error("invalid")` across the source tree. Commit-time twin of the
  // error-message-quality-nudge Stop hook — shares the classifier so the two
  // can't drift. Reporting candidates the human rewrites; never auto-fixed.
  () => run('node', ['scripts/fleet/check/error-messages-are-thorough.mts']),
  // Rule citations are generic (CLAUDE.md "Compound lessons into rules"): a
  // `**Why:**`/incident line in fleet rule prose (CLAUDE.md, docs/agents.md/
  // fleet, SKILL.md, hook READMEs) must be a timeless example, not a dated log
  // — no ISO dates, version deltas, percentages, or commit SHAs (they age into
  // a changelog + leak detail in a fleet-duplicated file). Commit-time twin of
  // the dated-citation-guard hook; shares the matcher so the two can't drift.
  () => run('node', ['scripts/fleet/check/rule-citations-are-generic.mts']),
  // Naming consistency: every check basename reads as an ASSERTION (states the
  // invariant it guarantees — paths-are-canonical, lock-step-refs-resolve), so
  // the check/ dir reads as a spec. A bare-topic name (paths, provenance) fails.
  () => run('node', ['scripts/fleet/check/check-names-are-assertions.mts']),
  // A recorded fleet rename is FINISHED, not half-done. When a file carries a
  // `renamed-from: <old>` marker, the prior name must be fully gone — absent as
  // a live file (script / hook dir / lint rule) AND unreferenced across the
  // fleet surfaces. Catches the incoherent old-and-new-coexist state a rename
  // leaves when it lands across some files but not all (the structural twin of
  // the plan-review-nudge "settle the shape before the cascade" nudge).
  () => run('node', ['scripts/fleet/check/name-rename-is-complete.mts']),
  // The only hook disable is the canonical "Allow <X> bypass" phrase. A
  // SOCKET_*_DISABLED env var / disabledEnvVar field / isHookDisabled() call
  // lets a session silently neuter a guard. The edit-time
  // no-env-kill-switch-guard blocks NEW ones; this full-scan complement fails
  // the gate if any hook file (index/README/test) still NAMES one — code,
  // comment, message, or doc. Back-catalog sweep: 2026-06-06.
  () => run('node', ['scripts/fleet/check/env-kill-switches-are-absent.mts']),
  // No INTERNAL / PRIVATE path (`.claude/plans|reports/…`, `socket-<repo>/.claude/…`,
  // `/Users/<name>/…`, `../socket-<repo>/…`) inside a SOURCE-code comment. The
  // edit-time no-private-path-in-source-guard + socket/no-private-path-in-source
  // block NEW ones; this full-scan complement fails the gate if any tracked
  // source file already carries one. Incident: a scaffolding-repo .claude/plans/
  // path leaked into a public napi-rs source comment.
  () => run('node', ['scripts/fleet/check/private-paths-are-absent.mts']),
  // Every `pnpm run <x>` that invokes `node <path>.mts` must resolve to a real
  // file — a renamed/deleted script leaves the package.json entry (and the
  // CANONICAL_SCRIPT_BODIES synthesizer source) dead, failing only when someone
  // runs it. Past incident (2026-06-06): a check rename left doctor:auth
  // pointing at a deleted file and no gate caught it.
  () => run('node', ['scripts/fleet/check/script-paths-resolve.mts']),
  // Sibling of script-paths-resolve for prose: every `node <script>` reference
  // in a SKILL.md or command .md must resolve to a real file — a renamed/moved
  // script leaves the doc instruction dead. Past incident (2026-06-06):
  // setup-repo/SKILL.md cited 3 setup scripts that didn't exist.
  () => run('node', ['scripts/fleet/check/doc-references-resolve.mts']),
  // Sibling of doc-references-resolve for the `pnpm run` surface those two skip:
  // every `pnpm run <name>` a SKILL.md / reference.md / command .md cites must
  // resolve to a real package.json script (exact, or a `*`/`:`-prefix match), so
  // a renamed/dropped script can't leave a dead `pnpm run` citation shipping
  // fleet-wide. Skips `allowed-tools:` frontmatter (Bash() permission globs).
  () => run('node', ['scripts/fleet/check/pnpm-run-citations-resolve.mts']),
  // npm-run-all2 ordering (CLAUDE.md "npm-run-all-ordering"): a `run-s`/`run-p`
  // `:*` glob in a package.json scripts value is silently order-dependent —
  // npm-run-all2 expands via `Object.keys(scripts)` (ECMA-262 §10.1.11,
  // package.json source order, not alphabetical). Unannotated globs fail;
  // `// order-independent` annotation on the line or the line above clears it.
  () => run('node', ['scripts/fleet/check/run-s-globs-are-explicit.mts']),
  // A package's `exports` map and its public file surface must agree: every
  // exports target resolves to a real file (no stale map entry that throws
  // ERR_MODULE_NOT_FOUND for consumers), and every public built file (privacy
  // taxonomy applied — not external/, not _-prefixed) is reachable through some
  // exports entry (no orphaned public module). Complements files[] allowlist
  // hygiene and runtime require-ability; this is the map ↔ files check.
  () => run('node', ['scripts/fleet/check/public-files-are-exported.mts']),
  // Every external-tools.json / bundle-tools.json must match the shared
  // TypeBox schema (scripts/fleet/lib/external-tools-schema.mts). These files
  // pin tool versions + integrities; an unvalidated shape drift surfaces only
  // at runtime as an undefined-at-runtime throw mid-build/install. Past
  // incident: a drifted tool entry left an INLINED_* env var empty and hung a
  // pre-commit test run.
  () => run('node', ['scripts/fleet/check/external-tools-are-valid.mts']),
  // Fail-closed telemetry scan: no dependency or external tool ships a telemetry
  // / analytics SDK (Sentry/PostHog/Segment/Datadog/OTEL-SDK/langfuse/…) that
  // isn't in the reviewed baseline. A dep update or a new tool that ADDS one is
  // caught here and forced through review. Pairs with update.mts (re-checks on
  // every software update) + the per-tool lockdown gates (e.g. headroom).
  () => run('node', ['scripts/fleet/check/telemetry-deps-are-reviewed.mts']),
  // The universal no-phone-home env (FLEET_ENV) is set in this environment —
  // telemetry + update-notifier opt-outs across npm/pnpm/Claude Code. Deployed
  // by setup-security-tools (dev shell-rc) + the reusable CI workflow env.
  () => run('node', ['scripts/fleet/check/telemetry-env-is-disabled.mts']),
  // Internal GitHub Action / reusable-workflow SHA pins are current w.r.t. their
  // CLOSURE — the pinned unit's own files PLUS its declared `# cascade-data-deps:`
  // (e.g. external-tools.json read via ${GITHUB_ACTION_PATH}/../…). A data-edge
  // change once invalidated a pinned pnpm version with no `uses:` line to catch
  // it, reddening fleet CI. No-ops where there are no internal pins (the
  // wheelhouse, pure consumers); also fails any escaping read missing a
  // `# cascade-data-deps:` declaration.
  () => run('node', ['scripts/fleet/check/action-pins-are-current.mts']),
  // Every .gitmodules submodule is sparse-checkout'd to its consumed subtree
  // or annotated `# full-checkout: <reason>`. A vendored upstream drags its
  // whole tree into every clone otherwise. Determination is the
  // optimizing-submodules skill; this gate keeps the result from regressing.
  () =>
    run('node', [
      'scripts/fleet/check/submodules-are-sparse-or-annotated.mts',
      '--quiet',
    ]),
  // Companion: every sparse submodule declares a `verify =` consumer (the
  // command that build-proves the pattern) or `verify = none` (reference-only).
  // A sparse pattern with no declared consumer is unproven — the verify is
  // run separately (heavy: clone + build) via verify-submodule-sparse --run.
  () => run('node', ['scripts/fleet/verify-submodule-sparse.mts', '--check']),
  // researching-recency SKILL.md must quote the engine's output markers
  // verbatim (badge, evidence envelope, footer fences) so the model's
  // pass-through/synthesis instructions match what the engine emits.
  () =>
    run('node', [
      'scripts/fleet/check/researching-recency-contract-is-current.mts',
    ]),
  // Invoke tsc through node directly (typescript is a root devDep, so the bin
  // is always linked at the repo root). Going through `pnpm exec` would prepend
  // pnpm's verify-deps-before-run + prepare preamble and the sfw firewall line;
  // tsc is silent on success, so that preamble would be the ONLY output and a
  // green run reads as "nothing happened" — the diagnostics get buried.
  () =>
    run('node', [
      'node_modules/typescript/bin/tsc',
      '--noEmit',
      '-p',
      'tsconfig.check.json',
    ]),
  // Path-hygiene check (1 path, 1 reference). Mantra-driven gate;
  // see .claude/skills/path-guard/ + .claude/hooks/fleet/path-guard/.
  () => run('node', ['scripts/fleet/check/paths-are-canonical.mts', '--quiet']),
  // Separator-sensitive ops on un-normalized path vars — the commit-time
  // belt for the trees oxlint doesn't reach (live hooks); the AST rule
  // socket/normalize-path-before-match is the write-time twin. Backlog
  // cleared to zero 2026-07-07; any finding here is a regression.
  () =>
    run('node', [
      'scripts/fleet/check/paths-are-normalized-before-match.mts',
      '--quiet',
    ]),
  // Lock-step reference hygiene. Opt-in gate that exits clean when the
  // repo-owned .config/repo/lock-step-refs.json (legacy top-level
  // .config/lock-step-refs.json) is absent; for repos that ship
  // cross-language ports (acorn quadruplet, socket-btm mcp/*.cpp),
  // it validates every `Lock-step with <Lang>: <path>` comment resolves
  // to an existing file. Forms documented in
  // docs/agents.md/fleet/parser-comments.md §5–6.
  () =>
    run('node', ['scripts/fleet/check/lock-step-refs-resolve.mts', '--quiet']),
  // Lock-step header byte-equality. Same opt-in. Where the path-refs
  // gate above catches stale REFERENCES, this one catches drift in the
  // top-of-file `BEGIN LOCK-STEP HEADER` / `END LOCK-STEP HEADER` block
  // — the intent tripwire across the quadruplet. Spec:
  // docs/agents.md/fleet/parser-comments.md §7.
  () =>
    run('node', ['scripts/fleet/check/lock-step-headers-match.mts', '--quiet']),
  // Soak-exclude date-annotation gate — pairs with
  // .claude/hooks/fleet/soak-exclude-date-guard/. Catches
  // pnpm-workspace.yaml `minimumReleaseAgeExclude` entries that landed
  // via non-Claude paths without the canonical
  // `# published: YYYY-MM-DD | removable: YYYY-MM-DD` annotation.
  () => run('node', ['scripts/fleet/check/soak-excludes-have-dates.mts']),
  // .npmrc's Socket soak-exclude block is DERIVED from SOCKET_PACKAGE_PATTERNS
  // (the one source), never hand-copied. Fails on drift; the cascade --fixes it.
  () =>
    run('node', [
      'scripts/fleet/check/npmrc-socket-soak-excludes-are-derived.mts',
    ]),
  // Fleet soak-exclude parity. Wheelhouse-only at runtime — the script
  // no-ops when `scripts/sync-scaffolding/manifest.mts` is absent (i.e.
  // in every cascaded fleet repo). Enforces that every versioned soak
  // entry in wheelhouse's own pnpm-workspace.yaml also lives in
  // `EXPECTED_RELEASE_AGE_EXCLUDE`. Without parity, the cascade omits
  // these entries from downstream repos and every fleet `pnpm install`
  // rejects the transitive dep. Past incident (cascade@4ec6212c):
  // @oxc-project/types@0.133.0 was in wheelhouse's soak block but not
  // EXPECTED_RELEASE_AGE_EXCLUDE — every fleet repo went red on the
  // next install.
  () => run('node', ['scripts/fleet/check/fleet-soak-exclude-parity.mts']),
  // Baseline catalog coverage. Wheelhouse-only (no-ops where the
  // sync-scaffolding manifest is absent). Every `catalog:` dep the fleet
  // package.json baseline (CANONICAL_CATALOG_DEPS) writes onto a member must be
  // a key of EXPECTED_CATALOG_ENTRIES or OPTIONAL_CATALOG_ENTRIES — otherwise
  // the cascade writes the member a `"<dep>": "catalog:"` ref with no catalog
  // entry and its `pnpm install` dies with ERR_PNPM_CATALOG_ENTRY_NOT_FOUND_FOR_SPEC
  // (hit on socket-mcp + socket-registry: @types/semver et al.). Pairs with the
  // catalog injector in checks/workspace-config-catalog.mts.
  () =>
    run('node', ['scripts/fleet/check/baseline-catalog-deps-are-covered.mts']),
  // Every static bare-specifier import in a .claude/hooks/{fleet,repo} file
  // must resolve to a package.json dependencies/devDependencies entry — the
  // general form of the baseline-catalog-deps-are-covered incident above
  // (check-new-deps imported two -stable packages the root package.json never
  // declared, so every member installed a hook whose imports weren't on disk).
  () => run('node', ['scripts/fleet/check/hook-imports-are-declared.mts']),
  // Every pnpm `patchedDependencies` entry is justified: a rationale comment,
  // an existing .patch file, and a corresponding `overrides:` force pin. A
  // patch is opaque + high-trust; an unannotated or force-less one is suspect.
  // See docs/agents.md/fleet/pnpm-patching.md (the patch-for-compat dedup lever).
  () => run('node', ['scripts/fleet/check/dedup-patches-are-justified.mts']),
  // Avoidable dependency duplication (CLAUDE.md dedup discipline). Parses
  // pnpm-lock.yaml and reports packages resolved at >1 major (collapse
  // candidates — informational) and any package carrying a known
  // @socketregistry hardened drop-in that isn't redirected via overrides:
  // (a free hardening + dedup win — hard failure). The code-as-law surface
  // the deduping-dependencies skill cites; the safe-collapse judgment stays
  // in the skill's decision tree.
  () => run('node', ['scripts/fleet/check/dependencies-are-deduped.mts']),
  // No package.json may use a `link:` protocol dependency — non-portable,
  // outside the lockfile integrity guarantees, breaks the zero-dep bundle
  // contract. Use workspace: (in-repo) or catalog: (centrally pinned).
  () =>
    run('node', ['scripts/fleet/check/package-deps-have-no-link-protocol.mts']),
  // Per-platform tail packages match their naming domain: binaries (bin/
  // payload) use pnpm pack-app triplets (linux-x64, glibc unsuffixed); ABI/
  // NAPI .node addons use napi-rs targets (linux-x64-gnu, ABI explicit). The
  // payload shape decides the domain; a mismatched suffix makes the artifact
  // kind illegible to loaders + allowlists.
  () =>
    run('node', ['scripts/fleet/check/platform-tails-match-naming-domain.mts']),
  // Whole-tree BYTE-size cap (2 MB/file) — catches an accidentally committed
  // binary / data dump / build artifact. Distinct from socket/max-file-lines
  // (per-file LINE count for source). Skips build/cache/vendor dirs.
  () =>
    run('node', ['scripts/fleet/check/tracked-files-are-within-size-cap.mts']),
  // Commit-time twin of cdn-allowlist-guard: no source line references a host
  // off the public-CDN/registry allowlist (catches a bare CDN domain the
  // edit-time guard's fetch-attached detection misses).
  () => run('node', ['scripts/fleet/check/cdn-allowlist-is-respected.mts']),
  // Commit-time twin of package-manager-auto-update-guard: every installed
  // package manager has auto-update disabled (no silent self-bump).
  () =>
    run('node', [
      'scripts/fleet/check/package-manager-auto-update-is-disabled.mts',
    ]),
  // No _shared/ module shared across fleet trees has been re-forked (drift in a
  // cross-tree shared helper). The commit-time gate behind the DRY invariant.
  () => run('node', ['scripts/fleet/check/scanner-parity.mts']),
  // Supply-chain trust-gate floors + the pnpm trust-expansion opt-out, for
  // the non-Claude edit path. Mirrors the trust-downgrade-guard +
  // npmrc-trust-optout-guard hooks (shared detection via
  // _shared/{trust-gates,npmrc-trust}.mts): asserts pnpm-workspace.yaml keeps
  // minimumReleaseAge >= 10080 / trustPolicy: no-downgrade / blockExoticSubdeps:
  // true, and that no tracked script/workflow/.npmrc sets
  // PNPM_CONFIG_NPMRC_AUTH_FILE / a repo-local NPM_CONFIG_USERCONFIG or a
  // `${ENV}` beside an auth/registry key.
  () => run('node', ['scripts/fleet/check/trust-gates-are-not-weakened.mts']),
  // Homebrew supply-chain posture (macOS). Asserts brew >= 6.0.0 with
  // tap-trust + cask-SHA enforcement; `absent` (no brew) is a pass — CI
  // runners lack brew. Shares detection with the brew-supply-chain-guard
  // hook + setup-security-tools via _shared/brew-supply-chain.mts.
  () => run('node', ['scripts/fleet/check/brew-supply-chain-is-hardened.mts']),
  // Sparkle GUI-app auto-update OFF (macOS). Asserts apps that self-update via
  // Sparkle (e.g. OrbStack, bundle dev.kdrag0n.MacVirt) have SUEnableAutomatic-
  // Checks + SUAutomaticallyUpdate set false; `absent` (not installed / not
  // macOS) is a pass. Shares detection with setup-security-tools via
  // _shared/sparkle-auto-update.mts. No guard twin — a GUI app self-updates
  // with no Bash invocation to gate, so persist + audit are the surfaces.
  () =>
    run('node', ['scripts/fleet/check/sparkle-auto-update-is-disabled.mts']),
  // uv (Python) reproducibility: every pyproject.toml with a [tool.uv] table
  // ships a hash-verified uv.lock + an exclude-newer soak pin (the Python
  // analog of pnpm --frozen-lockfile + minimumReleaseAge). Vacuous pass in
  // repos with no uv project. Shares policy with _shared/uv-config.mts.
  () => run('node', ['scripts/fleet/check/uv-lockfiles-are-current.mts']),
  // Every fleet-managed tool resolved on PATH (pnpm vs engines.pnpm, uv vs its
  // external-tools pin) is at or above its pinned floor. A stray older binary
  // winning PATH resolution — a Homebrew uv, a corepack pnpm — silently breaks
  // the cascade (a sub-engines.pnpm pnpm churns the catalog against an
  // un-refreshable lockfile). Skips absent tools; fails loud on below-floor.
  () =>
    run('node', ['scripts/fleet/check/path-tools-are-at-pinned-version.mts']),
  // SkillSpector pin agrees across all three records (external-tools.json
  // version ⇔ pyproject.toml rev ⇔ uv.lock resolved SHA). The locked uv
  // project can't drift from the fleet-canonical SHA. Vacuous in repos that
  // don't ship SkillSpector.
  () => run('node', ['scripts/fleet/check/skillspector-pin-is-consistent.mts']),
  // headroom-ai pin agrees across all three records (external-tools.json
  // version ⇔ pyproject.toml ==pin ⇔ uv.lock resolved version). The locked uv
  // project (installed _dlx-contained) can't drift from the fleet-canonical
  // version. Vacuous in repos that don't ship headroom.
  () => run('node', ['scripts/fleet/check/headroom-pin-is-consistent.mts']),
  // headroom's telemetry beacon (default-ON) + its HuggingFace model fetch are
  // forced OFF by the bin/headroom lockdown wrapper. This gate imports the typed
  // lockdown export (no source-sniffing) and fails if it's weakened — the lib
  // also throws at import (fail-closed). Audit: .claude/reports/headroom-telemetry-audit.md. // socket-lint: allow private-path -- names this repo's own audit-report doc, not a leak.
  () =>
    run('node', ['scripts/fleet/check/headroom-is-telemetry-locked-down.mts']),
  // The headroom proxy MUST start with --lossless. Its default `token` mode is
  // LOSSY (CCR + Kompress ML abbreviate content, garbling proper nouns like
  // paths / package names in large tool reads — silently wrong for a coding
  // agent). Fails if PROXY_ARGS in headroom-proxy-start drops the flag.
  () => run('node', ['scripts/fleet/check/headroom-proxy-is-lossless.mts']),
  // pnpm-lock.yaml resolves vite rolldown-native (8.x) with no esbuild —
  // the fleet bundler is rolldown, esbuild is banned. A vitest repo whose
  // transitive vite floats to 7.x drags esbuild in (noisy Dependabot
  // advisories); this fails the cascade until vite is pinned to 8.x.
  () => run('node', ['scripts/fleet/check/vite-is-rolldown-native.mts']),
  // gh-aw agentic workflows: each `<name>.md` source has a compiled
  // `<name>.lock.yml` (what Actions runs) whose embedded body_hash matches
  // the .md body — catches a prompt edited without `gh aw compile`. Pure
  // node, no gh-aw dependency; vacuous pass with no agentic workflows.
  () => run('node', ['scripts/fleet/check/gh-aw-locks-are-current.mts']),
  // The fleet-owned local-agent egress allowlist (.config/fleet/egress-
  // allowlist.json) is a SUBSET of gh-aw's expanded firewall allowDomains — the
  // hosts CI's agent firewall already trusts. One-directional containment (fleet
  // ⊆ gh-aw), not byte-equality, so a gh-aw version bump doesn't flap it; fails
  // only when the local allowlist grants a host the CI fence would block (a
  // hole). Vacuous pass where the allowlist or a gh-aw lock is absent.
  () =>
    run('node', ['scripts/fleet/check/egress-allowlist-is-gh-aw-subset.mts']),
  // The non-gh-aw weekly-update fallback ships disabled-only
  // (`weekly-update-non-gh-aw.yml.disabled`); the ENABLED `.yml` is transient +
  // untracked. If it were committed it auto-runs weekly in every cascaded repo —
  // this gate fails when the enabled form is git-tracked, so the accident can't
  // land.
  () =>
    run('node', ['scripts/fleet/check/weekly-update-fallback-is-disabled.mts']),
  // CLAUDE.md informativeness audit. Every `###` section in the fleet
  // block must anchor to one of: a hook citation
  // (`.claude/hooks/...` reference), a docs link
  // (`[text](docs/...)`), a skill reference
  // (`.claude/skills/.../SKILL.md`), or an explicit
  // `(advisory, no enforcement)` opt-out. CLAUDE.md is load-bearing
  // context for every session; sections without an enforcement
  // anchor tend to rot. Per the Salesforce agentic-engineering
  // article, CLAUDE.md variance is a direct quality driver.
  () =>
    run('node', ['scripts/fleet/check/claude-md-rules-are-informative.mts']),
  // .claude/ segmentation gate. Every entry under
  // .claude/{agents,commands,hooks,skills}/ must live under fleet/<name>/
  // (when wheelhouse-canonical) or repo/<name>/ (everything else).
  // Dangling top-level entries shadow the canonical copy and break
  // skill resolution. Past incident (2026-06-01): fleet-wide audit found
  // ~200 dangling entries across 10 repos. Auto-fixable with
  // `node scripts/fleet/check/claude-dirs-are-segmented.mts --fix`.
  () => run('node', ['scripts/fleet/check/claude-dirs-are-segmented.mts']),
  // Release-hygiene floor: every publishable package.json (private!==true,
  // has a name) must declare a `files` field. Without it, npm publishes the
  // ENTIRE directory — test fixtures, .claude/ tooling, coverage, secrets.
  // REPORT-ONLY (exits 0, lists findings); flip MODE to 'strict' in the
  // check after clearing the pre-existing backlog.
  () =>
    run('node', [
      'scripts/fleet/check/published-packages-have-files-field.mts',
    ]),
  // package.json `files:` allowlist hygiene. Flags publishes that leak
  // dev/test content (overshoot), `files:` entries that match nothing in
  // the publish surface (undershoot), and packages missing the canonical
  // README + LICENSE essentials. Skips workspaces marked
  // `"private": true`. Uses `npm pack --dry-run --json` as the source of
  // truth — same logic npm itself uses for publish.
  () => run('node', ['scripts/fleet/check/package-files-are-allowlisted.mts']),
  // Pre-publish source gate: every publishable package.json declares
  // publishConfig.access:"public" + provenance:true (and registry-if-set =
  // npmjs) — the source-config preconditions for a public, provenance-attested
  // release under OIDC trusted publishing. Skips `"private": true` workspaces.
  // The post-publish registry audit is provenance-is-attested.mts.
  () => run('node', ['scripts/fleet/check/publish-config-is-hardened.mts']),
  // Release-gate: the fleet bundle must build → install → verify round-trip
  // cleanly before it ships. Calls validate-release-bundle.mts (wheelhouse-only
  // `scripts/repo/`); vacuous pass in every cascaded fleet repo (validator
  // absent). Catches a broken producer or installer before the tarball reaches
  // a GitHub Release.
  () => run('node', ['scripts/fleet/check/bundle-is-installable.mts']),
  // The dep-0 fetcher (bootstrap/fleet.mjs) is a rolldown-inlined build artifact;
  // fail loud if it drifts from its bootstrap/src/* source (rebuild: node
  // scripts/repo/build-bootstrap-fetcher.mts). Wheelhouse-only — the build script
  // lives in uncascaded scripts/repo/, so a member with no such script vacuous-passes.
  () =>
    !existsSync(
      path.join(REPO_ROOT, 'scripts', 'repo', 'build-bootstrap-fetcher.mts'),
    ) || run('node', ['scripts/repo/build-bootstrap-fetcher.mts', '--check']),
  // Every slashed pattern in .config/fleet/.prettierignore must be `**/`-anchored
  // or it silently matches nothing (oxfmt roots the matcher at the ignore file's
  // dir via Gitignore::new). Catches the footgun where a bare `vendor/**` looks
  // right but excludes nothing.
  () =>
    run('node', ['scripts/fleet/check/prettierignore-globs-are-anchored.mts']),
  // A PENDING release's CHANGELOG entry must be DERIVED from the commits it
  // releases (run `node scripts/fleet/bump.mts`), never hand-written ahead of the
  // tag. Fires only when package.json is ahead of the last v<semver> tag;
  // regenerates the entry from the commits since that tag and fails on drift.
  // Catches the failure mode that shipped a CHANGELOG entry describing work that
  // landed after its tag. Published versions are historical and not re-checked.
  () => run('node', ['scripts/fleet/check/changelog-is-commit-derived.mts']),
  // No tracked symlink is self-referential or points at an absolute path
  // inside the repo (a `node_modules → /abs/<repo>/node_modules` self-loop
  // bricked fresh clones fleet-wide with ELOOP; git kept it tracked despite
  // .gitignore). Reads the git object's link target so it catches one already
  // committed regardless of how it was staged.
  () => run('node', ['scripts/fleet/check/tracked-symlinks-are-safe.mts']),
  // README coverage badge matches the latest coverage run. When
  // coverage/coverage-summary.json (vitest json-summary) exists AND the README
  // carries a populated `![Coverage](…coverage-NN%…)` badge, the percent must
  // equal the rounded line-coverage total. Fails open when not checkable (no
  // badge, the `<PCT>` placeholder, or no coverage data — a lint/type CI lane).
  // Pre-bump-wave twin of `make-coverage-badge.mts`; shares lib/coverage-badge.
  () => run('node', ['scripts/fleet/check/coverage-badge-is-current.mts']),
  // Reminder/guard duplication gate. The fleet convention: a `-guard` hook
  // BLOCKS, a `-nudge` hook NUDGES — one surface per concern, never both.
  // Errors when a base name has both `<base>-guard` and `<base>-nudge`
  // (an exact same-concern duplicate); advisory-lists 2-segment shared-prefix
  // pairs for a human glance. Past incident (2026-06-03): a prose-antipattern
  // reminder + guard overlapped; resolved by dropping the reminder.
  () =>
    run('node', [
      'scripts/fleet/check/hooks-have-no-guard-nudge-overlap.mts',
      '--quiet',
    ]),
  // Hook name ⟷ blocking behavior: a `-guard` must BLOCK (exitCode=2 /
  // exit(2) / return 2 / decision:'block'), a `-nudge` must only NUDGE.
  // Errors when a `-guard` never blocks (→ should be `-nudge`) or a
  // `-nudge` blocks (→ should be `-guard`).
  () =>
    run('node', ['scripts/fleet/check/hook-names-are-accurate.mts', '--quiet']),
  // The cascaded co-located trees (.claude/hooks/fleet, .config/fleet/oxlint-plugin,
  // .git-hooks) ship to members + the release bundle, but the cascaded vitest
  // config EXCLUDES their test dirs — so a wheelhouse-only hook/lint-rule/git-hook
  // test there is dead weight no member can run. Those tests live under test/repo/
  // (vitest); this fails if a `*.test.*` reappears in a cascaded tree. See
  // docs/agents.md/fleet/test-layout.md.
  () =>
    run('node', [
      'scripts/fleet/check/cascaded-fleet-trees-have-no-tests.mts',
      '--quiet',
    ]),
  // Lock-step release-cascade pairing: a member's pinned bundle.cascadeSha has a
  // matching gh release whose templateSha equals it, and the release at
  // bundle.ref exists. Read-side twin of the dep-0 fetch-path verify (which
  // hard-fails at install). Network-gated: SKIPS when gh is unavailable, so it
  // no-ops in offline CI lanes + repos with no pin (the wheelhouse producer).
  () =>
    run('node', [
      'scripts/fleet/check/release-and-cascade-are-paired.mts',
      '--quiet',
    ]),
  // llms.txt structural freshness: compares H1 + section titles + ordered link
  // pairs of the committed file against deterministic extraction. Prose is never
  // diffed — the check is credential-free and member-safe fail-open (no file or
  // no package.json → skip).
  () => run('node', ['scripts/fleet/check/llms-txt-is-current.mts', '--quiet']),
  // Test mirror-naming convention: every unit test basename matches the basename
  // of its one first-party static import. Run with --strict so violations exit
  // non-zero; mirror-exempt markers on skip files suppress known exceptions.
  () =>
    run('node', [
      'scripts/fleet/check/tests-are-mirror-named.mts',
      '--strict',
      '--quiet',
    ]),
  // package.json test*-script convention (CLAUDE.md "test-scripts-defer-to-mts"):
  // route through a .mts wrapper, never a raw vitest/jest/mocha/ava/tap
  // binary (the hook/lint-rule tier's `node --test` is exempt). REPORT-ONLY
  // (exits 0) — the fleet backlog of raw invocations predates this gate; flip
  // to --strict once it clears.
  () => run('node', ['scripts/fleet/check/test-scripts-are-deferred.mts']),
  // external-tools.json shared entries match the wheelhouse copy: the
  // cascade-owned setup actions read this per-repo-owned data file at runtime,
  // so stale copies break CI setup (five repos on 2026-07-08). Compares only
  // SHARED tool names; repo-specific tools pass. Skips cleanly in CI (needs a
  // sibling wheelhouse checkout for the reference copy).
  () =>
    run('node', [
      'scripts/fleet/check/external-tools-match-wheelhouse.mts',
      '--quiet',
    ]),
]

// Repo-owned checks: a member extends `check --all` by dropping assertion-named
// scripts into scripts/repo/check/ (fleet/repo segmentation — a one-repo
// concern never enters the fleet tier). Appended after the fleet steps,
// alphabetical, same fail-fast loop; vacuous when the dir is absent.
for (const rel of discoverRepoChecks(REPO_ROOT)) {
  steps.push(() => run('node', [rel]))
}

for (let i = 0, { length } = steps; i < length; i += 1) {
  if (!steps[i]!()) {
    process.exitCode = 1
    break
  }
}
