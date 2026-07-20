/**
 * @file Check --all step registry — hooks, dispatch, docs, GitHub App
 *   tokens, skills, AI-routing, and naming/rename hygiene. One of three
 *   domain-split siblings of check-steps.mts (the others: paths-and-supply-
 *   chain, release-and-docs); see that file for the assembled order.
 */

import { run } from './check-steps.mts'
import type { CheckStep } from './check-steps.mts'

export function buildHookAndDocSteps(forwardedArgs: string[]): CheckStep[] {
  return [
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
    () =>
      run('node', ['scripts/fleet/check/linters-are-oxlint-oxfmt-only.mts']),
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
      run('node', [
        'scripts/fleet/check/dispatch-matchers-cover-hook-tools.mts',
      ]),
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
    () => run('node', ['scripts/fleet/check/skill-system-is-coherent.mts']),
    // The interface-design authority and its four companions form one routing
    // cluster. Require reciprocal direct links so no skill becomes an orphaned
    // prompt island after a rename or a future companion is added.
    () =>
      run('node', [
        'scripts/fleet/check/design-skill-cluster-is-connected.mts',
      ]),
    // Cost routing: every mutating (fix) skill must declare a model: tier so
    // mechanical work runs cheap. See docs/agents.md/fleet/skill-model-routing.md.
    () => run('node', ['scripts/fleet/check/mutating-skills-have-model.mts']),
    // File-doc headers carrying markdown must be plain `/* */` blocks, not `/**`
    // JSDoc — oxfmt's JSDoc reflow drops markdown content on `format`.
    () =>
      run('node', ['scripts/fleet/check/markdown-doc-headers-are-plain.mts']),
    // Commit-time twin of markdown-filename-guard: every tracked .md has a
    // canonical filename (lowercase-hyphens, or an allowlisted SCREAMING_CASE name
    // only at root/docs/.claude). Reuses the guard's classifyMarkdownPath predicate.
    () =>
      run('node', ['scripts/fleet/check/markdown-filenames-are-canonical.mts']),
    // Commit-time twin of golden-fixture-naming-guard: no tracked test fixture is
    // named `*.expected.json` (must be `*.golden.json`). Reuses the guard's
    // goldenTarget predicate.
    () =>
      run('node', ['scripts/fleet/check/golden-fixtures-are-named-golden.mts']),
    // Commit-time twin of no-nested-gitignore-guard: every ignore entry lives in
    // the single root .gitignore — no tracked nested per-dir .gitignore. Reuses
    // the guard's isNestedGitignore predicate.
    () => run('node', ['scripts/fleet/check/gitignore-is-single-file.mts']),
    // DRY bypass-phrase gate: a defineHook hook that references an `Allow <slug>
    // bypass` phrase must declare it as `bypass:` metadata (single source →
    // detector + footer), never hand-write it. Catches drift regressions.
    () => run('node', ['scripts/fleet/check/bypass-phrases-are-metadata.mts']),
    // package.json's packageManager + engines.{pnpm,npm} are GENERATED from
    // external-tools.json (the single source); this gate fails on drift.
    () =>
      run('node', ['scripts/fleet/check/package-manager-pins-are-synced.mts']),
    // A lint config's `!` re-include must never re-expose vendored files to
    // lint/--fix (the acorn wasm-bindgen glue break). Fails when a vendored glob
    // is left before the last negation.
    () =>
      run('node', ['scripts/fleet/check/lint-configs-protect-vendored.mts']),
    // The .agents/skills/ mirror is generated + git-untracked (regenerated in
    // every cascade by sync-scaffolding/fix-agents-mirror.mts, and on demand via
    // gen-agents-skills-mirror.mts), so there is no committed mirror for a CI
    // gate to verify "current" against. Staleness is handled by the cascade
    // regen + the agents-skills-mirror-nudge hook, not a check here.
    // Code is law for the onboarding skill's CI step: the ci:local script keeps
    // its canonical agent-ci flag set, and the agent-ci Dockerfile (when adopted)
    // stays byte-identical to the template.
    () => run('node', ['scripts/fleet/check/ci-local-is-canonical.mts']),
    // The scope-mode fleet scripts (test/lint/check) default to MODIFIED —
    // vacuous on a clean CI checkout. A bare `pnpm test` in the canonical CI
    // template once false-greened the whole fleet; workflow invocations must
    // name their scope (--all in CI) or pass explicit paths.
    () =>
      run('node', [
        'scripts/fleet/check/workflow-scripts-are-explicit-scope.mts',
      ]),
    // Registration <-> file lock-step: a pathspec-scoped commit (cascade,
    // --only) once landed a check registration without its check file,
    // breaking HEAD's check --all until a follow-up. Index-aware: run with
    // the split staged, it fails BEFORE the commit exists.
    () => run('node', ['scripts/fleet/check/check-registrations-resolve.mts']),
    // Agent CI can't parse a gh-aw compiled .lock.yml (GitHub's
    // @actions/workflow-parser crashes on its agent-runtime jobs). The
    // agent-ci-skip-locks.mts wrapper turns that cryptic crash into an
    // informative error/skip; this gate keeps the wrapper's guard surface intact.
    () =>
      run('node', ['scripts/fleet/check/agent-ci-skip-locks-is-guarded.mts']),
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
    () =>
      run('node', ['scripts/fleet/check/subagent-status-doc-is-current.mts']),
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
    () =>
      run('node', ['scripts/fleet/check/enforcers-have-thorough-tests.mts']),
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
    // The git pre-commit hook itself must stay bounded: every heavy optional
    // step (`pnpm lint`, `pnpm test`) has to run through the bounded runner
    // (kills the process group on timeout, fails open), and the declared
    // budget must stay at or under the cap — the same "never hang" invariant
    // hook-main-is-entrypoint-guarded enforces for hooks, applied to the
    // commit path itself. No-ops where the repo carries no
    // .git-hooks/fleet/pre-commit.
    () => run('node', ['scripts/fleet/check/precommit-steps-are-bounded.mts']),
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
  ]
}
