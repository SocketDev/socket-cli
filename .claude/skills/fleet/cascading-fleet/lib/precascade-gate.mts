/**
 * @file Pre-cascade gate for the fleet wave: the wheelhouse's own
 *   `pnpm run check --all` must be GREEN before a template SHA is shipped
 *   fleet-wide. A wave copies `template/` into every member and pushes, so a
 *   red wheelhouse check red-gates every repo it touches — and the wheelhouse
 *   gates ARE the fleet gates, so whatever is red locally is red everywhere
 *   within one cascade commit.
 *   No committed waiver list ships with the gate: every red check refuses a
 *   wave. The waiver seam survives as a caller-supplied `knownRed` allowlist —
 *   an argument a caller passes for one run, scoped and visible at the call
 *   site, so an exemption cannot sit in the tree unowned and unexpiring. A
 *   bypass phrase is still the wrong shape; it would silence every failure at
 *   once.
 *   Pure parse + evaluate is exported for tests; `runPrecascadeGate` is the
 *   thin spawn shell.
 */

// prefer-async-spawn: sync-required — the cascade driver's preflight is a
// straight-line sync CLI flow that exits before any repo is touched.
// prefer-spawn-over-execsync: same.
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

// The check runner's failure contract (scripts/fleet/check.mts):
//   [check] <n> check(s) failed: <label>, <label>, …
const FAILED_LINE_RE = /^\[check]\s+\d+\s+check\(s\)\s+failed:\s*(.+)$/m

export interface PrecascadeGateResult {
  // True when the wave may proceed.
  readonly ok: boolean
  // Failing check labels with no waiver — the reason a wave is refused.
  readonly blocking: readonly string[]
  // Failing check labels covered by a caller-supplied `knownRed` allowlist.
  readonly waived: readonly string[]
}

/**
 * Failing check labels named on the runner's summary line. Returns an empty
 * list when the line is absent (a crash / a non-check step failure), which the
 * evaluator treats as unattributable and therefore blocking.
 */
export function parseFailedChecks(output: string): string[] {
  const match = FAILED_LINE_RE.exec(output)
  if (!match) {
    return []
  }
  return match[1]!
    .split(',')
    .map(label => label.trim())
    .filter(Boolean)
}

/**
 * Split a `check --all` outcome into blocking vs waived. Fail-closed: a
 * non-zero exit the summary line cannot explain blocks under the synthetic
 * label `check --all (unattributed failure)`, so a crashed or lint/type-step
 * failure is never mistaken for green. With no `knownRed` argument every
 * failing check blocks.
 */
export function evaluatePrecascadeGate(
  exitCode: number,
  output: string,
  knownRed?: ReadonlyMap<string, string> | undefined,
): PrecascadeGateResult {
  if (exitCode === 0) {
    return { blocking: [], ok: true, waived: [] }
  }
  const failed = parseFailedChecks(output)
  if (failed.length === 0) {
    return {
      blocking: ['check --all (unattributed failure)'],
      ok: false,
      waived: [],
    }
  }
  const isWaived = (label: string): boolean => knownRed?.has(label) === true
  const blocking = failed.filter(label => !isWaived(label))
  const waived = failed.filter(isWaived)
  return { blocking, ok: blocking.length === 0, waived }
}

/**
 * Operator-facing refusal, in the fleet's four-part order:
 * What / Where / Saw vs. wanted / Fix.
 */
export function formatPrecascadeGateFailure(
  result: PrecascadeGateResult,
  wheelhouseDir: string,
  knownRed?: ReadonlyMap<string, string> | undefined,
): string {
  const waivedLines = result.waived.map(
    label => `    - ${label} — waived: ${knownRed?.get(label)}`,
  )
  return [
    "[cascade] Refusing to start: the wheelhouse's own `check --all` is red.",
    '',
    `  Where: ${wheelhouseDir} (run \`pnpm run check --all\` there to reproduce)`,
    '',
    '  Saw — these checks failed with no waiver:',
    ...result.blocking.map(label => `    - ${label}`),
    ...(waivedLines.length
      ? ['', '  Already waived (not blocking):', ...waivedLines]
      : []),
    '',
    '  Wanted: a green `check --all` before a template SHA ships fleet-wide. The',
    '  wheelhouse gates ARE the fleet gates, so a red one here goes red in every',
    '  member the wave pushes to — the action-port lock-step defect shipped exactly',
    '  this way: the gate worked, it was never run before the wave.',
    '',
    '  Fix: repair the failing checks and re-run the wave. There is no committed',
    '  waiver list to add to — a standing exemption in the tree has no expiry and',
    '  no owner, so the gate quietly stops protecting and nobody is accountable for',
    '  clearing it. A one-run exemption is the `knownRed` argument on',
    '  runPrecascadeGate, passed at the call site where a reviewer can see it.',
    '  `--dry-run` skips this gate (it pushes nothing).',
  ].join('\n')
}

/**
 * Run the wheelhouse's `check --all` and evaluate it. `runner` is injectable
 * for tests; production spawns pnpm in `wheelhouseDir`.
 */
export function runPrecascadeGate(
  wheelhouseDir: string,
  options?:
    | {
        knownRed?: ReadonlyMap<string, string> | undefined
        runner?:
          | ((dir: string) => { output: string; status: number })
          | undefined
      }
    | undefined,
): PrecascadeGateResult {
  const opts = { __proto__: null, ...options } as {
    knownRed?: ReadonlyMap<string, string> | undefined
    runner?: ((dir: string) => { output: string; status: number }) | undefined
  }
  const runner = opts.runner ?? defaultRunner
  const { output, status } = runner(wheelhouseDir)
  return evaluatePrecascadeGate(status, output, opts.knownRed)
}

function defaultRunner(dir: string): { output: string; status: number } {
  const r = spawnSync('pnpm', ['run', 'check', '--all'], {
    cwd: dir,
    encoding: 'utf8',
  })
  return {
    output: `${r.stdout ?? ''}${r.stderr ?? ''}`,
    status: r.status ?? 1,
  }
}
