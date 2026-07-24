/*
 * @file Deterministic one-stub-at-a-time trim loop for the trimming-bundle
 *   skill. The model picks the candidates (the static reachability signal is
 *   ambiguous — measure-bundle.mts deliberately renders no verdict); this loop
 *   then mechanically proves each one: extend the rolldown stubPattern with one
 *   candidate, rebuild, run tests, and KEEP it only if tests still pass AND the
 *   bundle shrank — otherwise REVERT it and move on. Multi-candidate stubs make
 *   failure attribution painful, so the loop is strictly one-at-a-time, with the
 *   size delta recorded per candidate.
 *
 *   This is the deterministic half of the skill. The candidate list, the
 *   per-candidate reachability reasoning, and the kept-stub WHY comments are the
 *   model's job (SKILL.md Phases 2–3, 5). This loop owns Phase 4: stub → rebuild
 *   → test → keep-or-revert, with a `dryRun` mode that reports what it would do.
 *
 *   Usage (from a skill driver or directly):
 *     node lib/trim-loop.mts --repo <dir> --candidates globs,sorts,http-request
 *       [--dry-run] [--json]
 */

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { measureBundle } from '../../../../../scripts/fleet/trimming-bundle/measure-bundle.mts'

const logger = getDefaultLogger()

// The stubPattern lives in the rolldown config as `/(?:a|b|c)\.js$/`. We splice
// candidates into the alternation group and write it back, so the regex must be
// editable in place. This pins the exact shape the loop reads and rewrites.
const STUB_PATTERN_RE =
  /const\s+stubPattern\s*=\s*\/\(\?:([^)]*)\)\\\.js\$\/u?/u

export interface TrimOutcome {
  // The candidate token spliced into the stubPattern (e.g. "globs").
  candidate: string
  // 'kept' — tests passed and bundle shrank; the stub stays.
  // 'reverted-tests' — tests failed; the candidate is reachable, stub removed.
  // 'reverted-no-shrink' — tests passed but bundle didn't shrink; stub removed.
  // 'reverted-grew' — bundle grew (stub overhead > saved); stub removed.
  verdict: 'kept' | 'reverted-grew' | 'reverted-no-shrink' | 'reverted-tests'
  // Bundle size before this candidate's stub (bytes).
  beforeBytes: number
  // Bundle size after this candidate's stub (bytes); equals beforeBytes on a
  // build that didn't run (dry run) or a test-revert measured pre-build.
  afterBytes: number
  // afterBytes - beforeBytes (negative = shrank).
  deltaBytes: number
}

export interface TrimLoopResult {
  startBytes: number
  endBytes: number
  totalSavedBytes: number
  keptCandidates: string[]
  outcomes: TrimOutcome[]
}

export interface TrimLoopOptions {
  repoDir: string
  candidates: readonly string[]
  dryRun: boolean
}

// Read the current alternation tokens out of the rolldown stubPattern.
export function readStubTokens(configSource: string): string[] {
  const m = STUB_PATTERN_RE.exec(configSource)
  if (!m) {
    return []
  }
  return m[1]!
    .split('|')
    .map(s => s.trim())
    .filter(s => s.length > 0)
}

// Rewrite the rolldown config's stubPattern alternation to exactly `tokens`.
// Throws when the config has no recognizable stubPattern — the skill's
// precondition check (createLibStubPlugin import) should have caught that.
export function writeStubTokens(
  configSource: string,
  tokens: readonly string[],
): string {
  if (!STUB_PATTERN_RE.test(configSource)) {
    throw new Error(
      'No `const stubPattern = /(?:…)\\.js$/` found in rolldown.config.mts. ' +
        'The skill requires createLibStubPlugin to be wired with an editable ' +
        'stubPattern before the trim loop can run.',
    )
  }
  const group = tokens.length > 0 ? tokens.join('|') : ''
  return configSource.replace(
    STUB_PATTERN_RE,
    `const stubPattern = /(?:${group})\\.js$/u`,
  )
}

async function runBuild(repoDir: string): Promise<void> {
  await spawn('pnpm', ['build'], {
    cwd: repoDir,
    stdio: 'pipe',
    stdioString: true,
  })
}

// Run the repo test suite; resolves to true on pass, false on any failure.
// lib spawn rejects on a non-zero exit, which is exactly the failing-tests
// signal the loop keys on.
async function runTests(repoDir: string): Promise<boolean> {
  try {
    await spawn('pnpm', ['test'], {
      cwd: repoDir,
      stdio: 'pipe',
      stdioString: true,
    })
    return true
  } catch {
    return false
  }
}

export async function trimLoop(
  config: TrimLoopOptions,
): Promise<TrimLoopResult> {
  const cfg = { __proto__: null, ...config } as TrimLoopOptions
  const { candidates, dryRun, repoDir } = cfg
  const configPath = path.join(
    repoDir,
    '.config',
    'repo',
    'rolldown.config.mts',
  )
  const original = readFileSync(configPath, 'utf8')
  let current = original
  const kept = [...readStubTokens(original)]
  const outcomes: TrimOutcome[] = []

  const startMeasure = await measureBundle(repoDir)
  let beforeBytes = startMeasure.bundleSizeBytes
  const startBytes = beforeBytes

  for (let i = 0, { length } = candidates; i < length; i += 1) {
    const candidate = candidates[i]!
    if (kept.includes(candidate)) {
      // Already stubbed in a prior run; nothing to prove.
      outcomes.push({
        afterBytes: beforeBytes,
        beforeBytes,
        candidate,
        deltaBytes: 0,
        verdict: 'kept',
      })
      continue
    }
    const trial = writeStubTokens(current, [...kept, candidate])
    if (dryRun) {
      logger.info(`[dry-run] would stub '${candidate}' and rebuild + test`)
      outcomes.push({
        afterBytes: beforeBytes,
        beforeBytes,
        candidate,
        deltaBytes: 0,
        verdict: 'kept',
      })
      continue
    }
    writeFileSync(configPath, trial)
    await runBuild(repoDir)
    const passed = await runTests(repoDir)
    if (!passed) {
      // The candidate IS reached at runtime — revert and move on.
      writeFileSync(configPath, current)
      outcomes.push({
        afterBytes: beforeBytes,
        beforeBytes,
        candidate,
        deltaBytes: 0,
        verdict: 'reverted-tests',
      })
      logger.warn(`'${candidate}': tests failed — reachable, reverted.`)
      continue
    }
    const afterBytes = (await measureBundle(repoDir)).bundleSizeBytes
    const deltaBytes = afterBytes - beforeBytes
    if (deltaBytes >= 0) {
      // No shrink (regex didn't match) or grew (stub overhead). Revert.
      writeFileSync(configPath, current)
      outcomes.push({
        afterBytes,
        beforeBytes,
        candidate,
        deltaBytes,
        verdict: deltaBytes > 0 ? 'reverted-grew' : 'reverted-no-shrink',
      })
      logger.warn(
        `'${candidate}': bundle ${deltaBytes > 0 ? 'grew' : 'unchanged'}` +
          ` (${deltaBytes} bytes) — reverted.`,
      )
      continue
    }
    // Kept: tests pass and the bundle shrank.
    current = trial
    kept.push(candidate)
    beforeBytes = afterBytes
    outcomes.push({
      afterBytes,
      beforeBytes: afterBytes - deltaBytes,
      candidate,
      deltaBytes,
      verdict: 'kept',
    })
    logger.success(`'${candidate}': kept (${-deltaBytes} bytes saved).`)
  }

  const endBytes = beforeBytes
  return {
    endBytes,
    keptCandidates: kept,
    outcomes,
    startBytes,
    totalSavedBytes: startBytes - endBytes,
  }
}

export function parseArgs(argv: readonly string[]): TrimLoopOptions & {
  json: boolean
} {
  let repoDir = process.cwd()
  let candidates: string[] = []
  let dryRun = false
  let json = false
  for (let i = 0, { length } = argv; i < length; i += 1) {
    const a = argv[i]!
    if (a === '--repo') {
      repoDir = path.resolve(argv[++i]!)
    } else if (a === '--candidates') {
      candidates = argv[++i]!.split(',')
        .map(s => s.trim())
        .filter(s => s.length > 0)
    } else if (a === '--dry-run') {
      dryRun = true
    } else if (a === '--json') {
      json = true
    } else {
      throw new Error(`Unknown argument: ${a}`)
    }
  }
  if (candidates.length === 0) {
    throw new Error(
      'Missing --candidates <a,b,c>. The model supplies the candidate tokens ' +
        '(lib subpath basenames) it judged unreachable; the loop proves each.',
    )
  }
  return { candidates, dryRun, json, repoDir }
}

export async function main(argv: readonly string[]): Promise<number> {
  try {
    const { json, ...options } = parseArgs(argv)
    const result = await trimLoop(options)
    if (json) {
      logger.log(JSON.stringify(result, undefined, 2))
    } else {
      logger.info(
        `trim loop done: ${result.totalSavedBytes} bytes saved` +
          ` (${result.startBytes} → ${result.endBytes});` +
          ` kept ${result.keptCandidates.length} stub(s).`,
      )
    }
    return 0
  } catch (e) {
    logger.fail(`trim-loop failed: ${errorMessage(e)}`)
    return 1
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void (async () => {
    process.exitCode = await main(process.argv.slice(2))
  })()
}
