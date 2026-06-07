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
  // CLAUDE.md doc integrity: every cited hook + socket/ rule must exist (catches
  // stale citations after a rename/removal — the reverse of new-hook-claude-md-guard).
  () => run('node', ['scripts/fleet/check/claude-md-citations-resolve.mts']),
  // Cost routing: every mutating (fix) skill must declare a model: tier so
  // mechanical work runs cheap. See docs/claude.md/fleet/skill-model-routing.md.
  () => run('node', ['scripts/fleet/check/mutating-skills-have-model.mts']),
  // Code is law: every hook + socket/* rule ships thorough tests (both arms,
  // every branch). A token or absent test fails the gate.
  () => run('node', ['scripts/fleet/check/enforcers-have-thorough-tests.mts']),
  // No husk hook dirs: a hook directory holding only node_modules/ (no
  // index.mts / install.mts / README.md) is a rename leftover — git moved the
  // tracked files, the untracked node_modules stayed behind under the old name.
  // 10 such husks accumulated before this gate (2026-06-06). Fails check --all
  // so the next rename sweeps its own leftover.
  () => run('node', ['scripts/fleet/check/hook-dirs-are-not-husks.mts']),
  // Error messages are UI (CLAUDE.md "Error messages"): no bare vague-only
  // `throw new Error("invalid")` across the source tree. Commit-time twin of the
  // error-message-quality-reminder Stop hook — shares the classifier so the two
  // can't drift. Reporting candidates the human rewrites; never auto-fixed.
  () => run('node', ['scripts/fleet/check/error-messages-are-thorough.mts']),
  // Rule citations are generic (CLAUDE.md "Compound lessons into rules"): a
  // `**Why:**`/incident line in fleet rule prose (CLAUDE.md, docs/claude.md/
  // fleet, SKILL.md, hook READMEs) must be a timeless example, not a dated log
  // — no ISO dates, version deltas, percentages, or commit SHAs (they age into
  // a changelog + leak detail in a fleet-duplicated file). Commit-time twin of
  // the dated-citation-reminder hook; shares the matcher so the two can't drift.
  () => run('node', ['scripts/fleet/check/rule-citations-are-generic.mts']),
  // Naming consistency: every check basename reads as an ASSERTION (states the
  // invariant it guarantees — paths-are-canonical, lock-step-refs-resolve), so
  // the check/ dir reads as a spec. A bare-topic name (paths, provenance) fails.
  () => run('node', ['scripts/fleet/check/check-names-are-assertions.mts']),
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
  // docs/claude.md/fleet/parser-comments.md §5–6.
  () =>
    run('node', ['scripts/fleet/check/lock-step-refs-resolve.mts', '--quiet']),
  // Lock-step header byte-equality. Same opt-in. Where the path-refs
  // gate above catches stale REFERENCES, this one catches drift in the
  // top-of-file `BEGIN LOCK-STEP HEADER` / `END LOCK-STEP HEADER` block
  // — the intent tripwire across the quadruplet. Spec:
  // docs/claude.md/fleet/parser-comments.md §7.
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
]

for (let i = 0, { length } = steps; i < length; i += 1) {
  if (!steps[i]!()) {
    process.exitCode = 1
    break
  }
}
