/*
 * @file The coverage runner seam. `cover.mts` was hardwired to vitest, so a
 *   member whose tests need another runtime could not use the fleet coverage
 *   runner at all — its only escape was replacing the `cover` script body,
 *   which forfeits the build-with-sourcemaps step, the tier merge, the
 *   churn-retry, and the `coverage-summary.json` the badge pipeline reads.
 *   A repo declares `cover.runner` in socket-wheelhouse.json. The value is a
 *   fixed ENUM, never a free-form command string: an arbitrary shell string is
 *   an injection surface, and it would defeat the structured plan the rest of
 *   `cover.mts` builds from (per-suite `--exclude` globs, `--config` overrides,
 *   the passthrough argv). Every runner the fleet supports gets a builder here
 *   that emits a real argv array, so nothing user-supplied is ever concatenated
 *   into a command line.
 *   vitest is the default. A repo that declares nothing behaves exactly as
 *   before — `resolveCoverRunner(undefined)` is `vitest`, and the vitest plan
 *   is byte-identical to the one this seam replaced.
 *   What the bun lane supports, and what it does not:
 *
 *   - SUPPORTED. Bun writes lcov; this module parses it into the same
 *     `AggregateCoverage` shape the v8→istanbul merge produces, so the
 *     threshold gate, the summary display, and the `coverage-summary.json` the
 *     badge reads all keep working unchanged.
 *   - SUPPORTED. Per-file floors, which the aggregate gate cannot express. A file
 *     whose module init branches on the host OS is unreachable in part on any
 *     single machine, so it needs a floor of its own rather than dragging the
 *     whole repo's minimum down.
 *   - NOT SUPPORTED, and LOUD. Bun has no shared/isolated tier split, so a bun
 *     repo declaring more than one suite is a hard error rather than a silent
 *     single-suite run. `coverRunnerLimitation` is that message.
 *   - NOT SUPPORTED, and LOUD. Bun emits no branch data in lcov, so a `branches`
 *     threshold under the bun runner is a hard error rather than a
 *     silently-passing gate. The thresholds are applied HERE, by the fleet,
 *     never by the runner's own config. Bun's `coverageThreshold` accepts
 *     singular keys (`line`, `function`) without complaint and then ignores
 *     them: `{ line = 0.99 }` exits 0 at 50% coverage while `{ lines = 0.99 }`
 *     exits 1. A gate that can be disabled by a typo is not a gate, so the
 *     fleet reads the lcov and decides for itself.
 */

import path from 'node:path'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import type { AggregateCoverage } from '../util/coverage-merge.mts'
import type { CoverConfig, CoverThresholds } from './discovery.mts'

// Every runner the fleet's coverage pipeline can drive. An enum, not a command
// string — see the file header.
export const COVER_RUNNERS = ['bun', 'vitest'] as const

export type CoverRunnerId = (typeof COVER_RUNNERS)[number]

export const DEFAULT_COVER_RUNNER: CoverRunnerId = 'vitest'

/**
 * Resolve the declared runner. An absent declaration is `vitest`, so an
 * un-configured repo is unchanged. An unrecognized value FAILS — silently
 * falling back to vitest for a bun repo is precisely the "reports success
 * while measuring nothing" outcome this seam exists to stop.
 */
export function resolveCoverRunner(
  raw: unknown,
  configPath: string,
): { runner: CoverRunnerId } | { error: string } {
  if (raw === undefined) {
    return { runner: DEFAULT_COVER_RUNNER }
  }
  if (
    typeof raw === 'string' &&
    (COVER_RUNNERS as readonly string[]).includes(raw)
  ) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the includes() check above narrows `raw` to a member of COVER_RUNNERS, which TS cannot track through a readonly-string-array widening.
    return { runner: raw as CoverRunnerId }
  }
  return {
    error: [
      `Unknown coverage runner ${JSON.stringify(raw)}.`,
      `  Where: ${configPath}, \`cover.runner\``,
      `  Saw:   ${JSON.stringify(raw)}; wanted one of: ${COVER_RUNNERS.join(', ')}.`,
      `  Fix:   set \`cover.runner\` to a supported value, or drop the key to use the default (${DEFAULT_COVER_RUNNER}).`,
    ].join('\n'),
  }
}

// The only metric names a threshold block may carry. Everything else is a typo.
const THRESHOLD_METRICS: readonly string[] = [
  'branches',
  'functions',
  'lines',
  'statements',
]

// The singular form a writer reaches for, mapped to the plural the gate reads.
// These are the typos that MATTER: they look right, they parse, and they are
// then ignored.
const SINGULAR_METRIC_HINTS: Readonly<Record<string, string>> = {
  branch: 'branches',
  function: 'functions',
  line: 'lines',
  statement: 'statements',
}

function thresholdBlockErrors(
  block: Readonly<Record<string, unknown>> | undefined,
  where: string,
): string[] {
  if (!block) {
    return []
  }
  const errors: string[] = []
  const keys = Object.keys(block)
  for (let i = 0, { length } = keys; i < length; i += 1) {
    const key = keys[i]!
    if (THRESHOLD_METRICS.includes(key)) {
      continue
    }
    const hint = SINGULAR_METRIC_HINTS[key]
    errors.push(
      [
        `Unknown coverage threshold key ${JSON.stringify(key)}.`,
        `  Where: ${where}`,
        `  Saw:   ${JSON.stringify(key)}; wanted one of: ${THRESHOLD_METRICS.join(', ')}.`,
        hint
          ? `  Fix:   the gate reads the PLURAL name — rename it to \`${hint}\`.`
          : '  Fix:   remove the key, or rename it to one of the four metrics above.',
      ].join('\n'),
    )
  }
  return errors
}

/**
 * Reject a threshold block that names a metric the gate does not read. An
 * unrecognized key parses fine and is then ignored, so a `{ line: 99 }` typo
 * turns a 99% gate into no gate at all and the run reports success — the exact
 * silent pass this seam exists to make impossible.
 *
 * This is runner-agnostic on purpose: bun's own config has the bug natively,
 * but a typo in the fleet's block is just as silent under vitest, so both lanes
 * validate.
 */
export function coverThresholdKeyErrors(
  config: CoverConfig,
  configPath: string,
): string[] {
  const errors = thresholdBlockErrors(
    config.thresholds as Readonly<Record<string, unknown>> | undefined,
    `${configPath}, \`cover.thresholds\``,
  )
  const perFile = config.perFileThresholds
  if (perFile) {
    for (const [filePath, block] of Object.entries(perFile)) {
      errors.push(
        ...thresholdBlockErrors(
          block as Readonly<Record<string, unknown>>,
          `${configPath}, \`cover.perFileThresholds["${filePath}"]\``,
        ),
      )
    }
  }
  return errors
}

/**
 * The limitations a runner cannot honor, given this repo's cover config. A
 * non-empty result is FATAL — the caller reports every line and exits non-zero
 * rather than running a gate that quietly measures less than it claims.
 */
export function coverRunnerLimitations(
  runner: CoverRunnerId,
  config: CoverConfig,
  configPath: string,
): string[] {
  if (runner !== 'bun') {
    return []
  }
  const problems: string[] = []
  const suiteNames = Object.keys(config.suites ?? {})
  if (suiteNames.length > 1) {
    problems.push(
      [
        'The bun coverage runner cannot honor a multi-suite tier split.',
        `  Where: ${configPath}, \`cover.suites\``,
        `  Saw:   ${suiteNames.length} suites (${suiteNames.join(', ')}); wanted at most 1.`,
        '  Why:   bun has no shared/isolated pool split, so the extra tiers would',
        '         never run and the merge would report a narrower number as the whole.',
        '  Fix:   collapse to a single suite, or move the repo to the vitest runner.',
      ].join('\n'),
    )
  }
  if (config.thresholds?.branches !== undefined) {
    problems.push(
      [
        'The bun coverage runner cannot enforce a branches threshold.',
        `  Where: ${configPath}, \`cover.thresholds.branches\``,
        '  Saw:   a branches minimum; wanted none — bun emits no BRDA records in lcov,',
        '         so the branch percentage would always read 0 and the gate would be a lie.',
        '  Fix:   drop `branches` and gate on statements / functions / lines.',
      ].join('\n'),
    )
  }
  return problems
}

/**
 * The argv for a bun coverage run. `--coverage-reporter=lcov` is what makes the
 * result machine-readable; `--coverage-dir` puts it where the caller reads it.
 * Passthrough args come from the operator's own command line and are appended
 * verbatim as separate array elements — never joined into a string.
 */
export function buildBunCoverageArgs(config: {
  coverageDir: string
  passthroughArgs?: readonly string[] | undefined
}): string[] {
  const cfg = { __proto__: null, ...config } as typeof config
  return [
    'exec',
    'bun',
    'test',
    '--coverage',
    '--coverage-reporter=lcov',
    `--coverage-dir=${cfg.coverageDir}`,
    ...(cfg.passthroughArgs ?? []),
  ]
}

export interface LcovFileCoverage {
  // Repo-relative, forward-slash path.
  file: string
  functionsHit: number
  functionsTotal: number
  linesHit: number
  linesTotal: number
}

// An lcov record line is `<TAG>:<payload>`; `DA:<line>,<hits>` and
// `FNDA:<hits>,<name>` carry the per-entity counts, and the `LF`/`LH`/`FNF`/
// `FNH` summary tags carry the per-file totals. The summary tags are used when
// present because they are what the producer itself computed; the DA/FNDA
// records are the fallback for a producer that omits them.
export function parseLcov(
  lcovText: string,
  repoRoot: string,
): LcovFileCoverage[] {
  const out: LcovFileCoverage[] = []
  let file: string | undefined
  let daTotal = 0
  let daHit = 0
  let fnTotal = 0
  let fnHit = 0
  let lf: number | undefined
  let lh: number | undefined
  let fnf: number | undefined
  let fnh: number | undefined

  const flush = (): void => {
    if (file === undefined) {
      return
    }
    out.push({
      file,
      functionsHit: fnh ?? fnHit,
      functionsTotal: fnf ?? fnTotal,
      linesHit: lh ?? daHit,
      linesTotal: lf ?? daTotal,
    })
    file = undefined
    daTotal = 0
    daHit = 0
    fnTotal = 0
    fnHit = 0
    lf = undefined
    lh = undefined
    fnf = undefined
    fnh = undefined
  }

  const lines = lcovText.split(/\r?\n/)
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!.trim()
    if (line === 'end_of_record') {
      flush()
      continue
    }
    const colon = line.indexOf(':')
    if (colon < 0) {
      continue
    }
    const tag = line.slice(0, colon)
    const payload = line.slice(colon + 1)
    if (tag === 'SF') {
      // A new record without an end_of_record — flush the previous one rather
      // than merging two files' counts.
      flush()
      const abs = path.isAbsolute(payload)
        ? payload
        : path.resolve(repoRoot, payload)
      file = normalizePath(path.relative(repoRoot, abs))
      continue
    }
    if (tag === 'DA') {
      daTotal += 1
      if (Number(payload.split(',')[1] ?? '0') > 0) {
        daHit += 1
      }
      continue
    }
    if (tag === 'FNDA') {
      fnTotal += 1
      if (Number(payload.split(',')[0] ?? '0') > 0) {
        fnHit += 1
      }
      continue
    }
    if (tag === 'LF') {
      lf = Number(payload)
    } else if (tag === 'LH') {
      lh = Number(payload)
    } else if (tag === 'FNF') {
      fnf = Number(payload)
    } else if (tag === 'FNH') {
      fnh = Number(payload)
    }
  }
  flush()
  return out
}

function percent(hit: number, total: number): string {
  if (total === 0) {
    return '0.00'
  }
  return ((hit / total) * 100).toFixed(2)
}

/**
 * Fold per-file lcov coverage into the same aggregate shape the v8→istanbul
 * merge produces, so every downstream leg (threshold gate, summary display,
 * badge) reads one type regardless of which runner produced the numbers.
 *
 * `statements` mirrors `lines`: lcov has no separate statement dimension, and
 * reporting a statements figure derived from anything else would be inventing
 * a number. `branches` is 0 with a 0 denominator — the loud limitation above
 * blocks a branches threshold under this runner, so no gate reads it.
 *
 * `totalStatements` carries the line denominator. Zero is the collected-nothing
 * signal `cover.mts` fails on, which is what turns "bun ran but measured no
 * files" from a 0.00% pass into a non-zero exit.
 */
export function aggregateFromLcov(
  files: readonly LcovFileCoverage[],
): AggregateCoverage {
  let linesHit = 0
  let linesTotal = 0
  let functionsHit = 0
  let functionsTotal = 0
  for (let i = 0, { length } = files; i < length; i += 1) {
    const f = files[i]!
    linesHit += f.linesHit
    linesTotal += f.linesTotal
    functionsHit += f.functionsHit
    functionsTotal += f.functionsTotal
  }
  return {
    branches: '0.00',
    coveredLines: linesHit,
    functions: percent(functionsHit, functionsTotal),
    lines: percent(linesHit, linesTotal),
    statements: percent(linesHit, linesTotal),
    totalLines: linesTotal,
    totalStatements: linesTotal,
  }
}

/**
 * The istanbul `coverage-summary.json` payload the badge pipeline reads, built
 * from lcov. Same shape istanbul emits: a `total` key plus one key per file.
 */
export function lcovToIstanbulSummary(
  files: readonly LcovFileCoverage[],
): Record<string, unknown> {
  const metric = (
    covered: number,
    total: number,
  ): { covered: number; pct: number; skipped: number; total: number } => ({
    covered,
    pct: total === 0 ? 0 : Number(((covered / total) * 100).toFixed(2)),
    skipped: 0,
    total,
  })
  const summary: Record<string, unknown> = {}
  let linesHit = 0
  let linesTotal = 0
  let functionsHit = 0
  let functionsTotal = 0
  for (let i = 0, { length } = files; i < length; i += 1) {
    const f = files[i]!
    linesHit += f.linesHit
    linesTotal += f.linesTotal
    functionsHit += f.functionsHit
    functionsTotal += f.functionsTotal
    summary[f.file] = {
      branches: metric(0, 0),
      functions: metric(f.functionsHit, f.functionsTotal),
      lines: metric(f.linesHit, f.linesTotal),
      statements: metric(f.linesHit, f.linesTotal),
    }
  }
  summary['total'] = {
    branches: metric(0, 0),
    functions: metric(functionsHit, functionsTotal),
    lines: metric(linesHit, linesTotal),
    statements: metric(linesHit, linesTotal),
  }
  return summary
}

/**
 * Per-file floors, keyed by repo-relative path. The aggregate gate cannot
 * express "this one file is allowed to sit lower" — a file whose module init
 * branches on the host OS has lines no single machine can reach — and dragging
 * the repo-wide minimum down to that file's number would stop guarding every
 * other file. Percentages, 0-100, matching `cover.thresholds`.
 *
 * A configured path that produced NO coverage record fails: it means the file
 * was renamed, excluded, or never loaded, and a floor nobody checks is a floor
 * that silently stopped working.
 */
export function perFileThresholdFailures(
  files: readonly LcovFileCoverage[],
  perFile: Readonly<Record<string, CoverThresholds>> | undefined,
): string[] {
  if (!perFile) {
    return []
  }
  const byPath = new Map(files.map(f => [f.file, f]))
  const failures: string[] = []
  for (const [rawPath, thresholds] of Object.entries(perFile)) {
    const filePath = normalizePath(rawPath)
    const record = byPath.get(filePath)
    if (!record) {
      failures.push(
        `${filePath}: no coverage record — the per-file floor is configured for a file the run never measured`,
      )
      continue
    }
    const actual = {
      branches: 0,
      functions:
        record.functionsTotal === 0
          ? 100
          : (record.functionsHit / record.functionsTotal) * 100,
      lines:
        record.linesTotal === 0
          ? 100
          : (record.linesHit / record.linesTotal) * 100,
      statements:
        record.linesTotal === 0
          ? 100
          : (record.linesHit / record.linesTotal) * 100,
    }
    for (const metric of ['statements', 'functions', 'lines'] as const) {
      const min = thresholds[metric]
      if (min === undefined) {
        continue
      }
      if (actual[metric] < min) {
        failures.push(
          `${filePath} ${metric} ${actual[metric].toFixed(2)}% < ${min}%`,
        )
      }
    }
  }
  return failures
}
