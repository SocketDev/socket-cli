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
  () => run('node', ['scripts/lint.mts', ...forwardedArgs]),
  () => run('pnpm', ['exec', 'tsgo', '--noEmit', '-p', 'tsconfig.check.json']),
  // Path-hygiene check (1 path, 1 reference). Mantra-driven gate;
  // see .claude/skills/path-guard/ + .claude/hooks/path-guard/.
  () => run('node', ['scripts/check-paths.mts', '--quiet']),
  // Lock-step reference hygiene. Opt-in gate that exits clean when
  // .config/lock-step-refs.json is absent; for repos that ship
  // cross-language ports (acorn quadruplet, socket-btm mcp/*.cpp),
  // it validates every `Lock-step with <Lang>: <path>` comment resolves
  // to an existing file. Forms documented in
  // docs/claude.md/fleet/parser-comments.md §5–6.
  () => run('node', ['scripts/check-lock-step-refs.mts', '--quiet']),
  // Lock-step header byte-equality. Same opt-in. Where the path-refs
  // gate above catches stale REFERENCES, this one catches drift in the
  // top-of-file `BEGIN LOCK-STEP HEADER` / `END LOCK-STEP HEADER` block
  // — the intent tripwire across the quadruplet. Spec:
  // docs/claude.md/fleet/parser-comments.md §7.
  () => run('node', ['scripts/check-lock-step-header.mts', '--quiet']),
  // Soak-exclude date-annotation gate — pairs with
  // .claude/hooks/soak-exclude-date-annotation-guard/. Catches
  // pnpm-workspace.yaml `minimumReleaseAgeExclude` entries that landed
  // via non-Claude paths without the canonical
  // `# published: YYYY-MM-DD | removable: YYYY-MM-DD` annotation.
  () => run('node', ['scripts/check-soak-exclude-dates.mts']),
]

for (let i = 0, { length } = steps; i < length; i += 1) {
  if (!steps[i]!()) {
    process.exitCode = 1
    break
  }
}
