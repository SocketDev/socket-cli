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
import process from 'node:process'

const args = process.argv.slice(2)
const forwardedArgs = args.filter(
  a => a === '--all' || a === '--fix' || a === '--quiet' || a === '--staged',
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
  // Hook-registry doc integrity: every `- \`<name>\`` bullet in
  // docs/agents.md/fleet/hook-registry.md names a real .claude/hooks/fleet/<name>/
  // dir. CLAUDE.md defers its full hook list to the registry, so a stale/renamed
  // bullet points readers at policy that doesn't exist. Stale bullets fail;
  // undocumented hooks are reported, not enforced (many are internal tooling).
  () => run('node', ['scripts/fleet/check/hook-registry-is-current.mts']),
  // Global Claude config stays hardened (copyOnSelect: false → no TUI OSC-52
  // clipboard banner). setup/claude-config.mts sets it; this catches drift.
  () => run('node', ['scripts/fleet/check/claude-config-is-hardened.mts']),
  // Structural floor: every skill dir is a well-formed skill — has a SKILL.md
  // with frontmatter whose name matches the dir + a description. Catches a
  // half-built skill (engine/test, no SKILL.md) that the mirror + citation
  // gates would otherwise trip on later.
  () => run('node', ['scripts/fleet/check/skills-are-well-formed.mts']),
  // Cost routing: every mutating (fix) skill must declare a model: tier so
  // mechanical work runs cheap. See docs/agents.md/fleet/skill-model-routing.md.
  () => run('node', ['scripts/fleet/check/mutating-skills-have-model.mts']),
  // Cross-tool skills: the generated .agents/skills/ mirror (flat <tier>-<name>
  // so Codex + OpenCode's one-level discovery finds every fleet/repo skill)
  // stays in sync with the segmented .claude/skills/ source. Fails if a skill
  // was added/renamed/removed without regenerating, or the mirror was
  // hand-edited. Fix: node scripts/fleet/gen-agents-skills-mirror.mts.
  () =>
    run('node', ['scripts/fleet/check/agents-skills-mirror-is-current.mts']),
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
  // ADVISORY (never fails): surface `_shared/` hook-helper exports with no
  // in-repo consumer — dead weight in the cascaded layer / a DRY signal. Can't
  // hard-gate: some are consumed out-of-repo (user-global dispatch) and removal
  // is a judgment call. The fleet DRY sweep is plan-only.
  () => run('node', ['scripts/fleet/check/shared-hook-helpers-are-used.mts']),
  // Error messages are UI (CLAUDE.md "Error messages"): no bare vague-only
  // `throw new Error("invalid")` across the source tree. Commit-time twin of the
  // error-message-quality-reminder Stop hook — shares the classifier so the two
  // can't drift. Reporting candidates the human rewrites; never auto-fixed.
  () => run('node', ['scripts/fleet/check/error-messages-are-thorough.mts']),
  // Rule citations are generic (CLAUDE.md "Compound lessons into rules"): a
  // `**Why:**`/incident line in fleet rule prose (CLAUDE.md, docs/agents.md/
  // fleet, SKILL.md, hook READMEs) must be a timeless example, not a dated log
  // — no ISO dates, version deltas, percentages, or commit SHAs (they age into
  // a changelog + leak detail in a fleet-duplicated file). Commit-time twin of
  // the dated-citation-reminder hook; shares the matcher so the two can't drift.
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
  // the plan-review-reminder "settle the shape before the cascade" nudge).
  () => run('node', ['scripts/fleet/check/name-rename-is-complete.mts']),
  // The only hook disable is the canonical "Allow <X> bypass" phrase. A
  // SOCKET_*_DISABLED env var / disabledEnvVar field / isHookDisabled() call
  // lets a session silently neuter a guard. The edit-time
  // no-env-kill-switch-guard blocks NEW ones; this full-scan complement fails
  // the gate if any hook file (index/README/test) still NAMES one — code,
  // comment, message, or doc. Back-catalog sweep: 2026-06-06.
  () => run('node', ['scripts/fleet/check/env-kill-switches-are-absent.mts']),
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
  () => run('pnpm', ['exec', 'tsgo', '--noEmit', '-p', 'tsconfig.check.json']),
  // Path-hygiene check (1 path, 1 reference). Mantra-driven gate;
  // see .claude/skills/path-guard/ + .claude/hooks/fleet/path-guard/.
  () => run('node', ['scripts/fleet/check/paths-are-canonical.mts', '--quiet']),
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
  // package.json `files:` allowlist hygiene. Flags publishes that leak
  // dev/test content (overshoot), `files:` entries that match nothing in
  // the publish surface (undershoot), and packages missing the canonical
  // README + LICENSE essentials. Skips workspaces marked
  // `"private": true`. Uses `npm pack --dry-run --json` as the source of
  // truth — same logic npm itself uses for publish.
  () => run('node', ['scripts/fleet/check/package-files-are-allowlisted.mts']),
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
  // BLOCKS, a `-reminder` hook NUDGES — one surface per concern, never both.
  // Errors when a base name has both `<base>-guard` and `<base>-reminder`
  // (an exact same-concern duplicate); advisory-lists 2-segment shared-prefix
  // pairs for a human glance. Past incident (2026-06-03): a prose-antipattern
  // reminder + guard overlapped; resolved by dropping the reminder.
  () =>
    run('node', [
      'scripts/fleet/check/hooks-have-no-guard-reminder-overlap.mts',
      '--quiet',
    ]),
  // Hook name ⟷ blocking behavior: a `-guard` must BLOCK (exitCode=2 /
  // exit(2) / return 2 / decision:'block'), a `-reminder` must only NUDGE.
  // Errors when a `-guard` never blocks (→ should be `-reminder`) or a
  // `-reminder` blocks (→ should be `-guard`).
  () =>
    run('node', ['scripts/fleet/check/hook-names-are-accurate.mts', '--quiet']),
]

for (let i = 0, { length } = steps; i < length; i += 1) {
  if (!steps[i]!()) {
    process.exitCode = 1
    break
  }
}
