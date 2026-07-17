/**
 * @file Readiness-gate stage runners (pre-bump): preflight, exports gate,
 *   files gate, and the commit-fixes + CI gate. Each defers to its owning
 *   fleet script — the pipeline orchestrates, it never re-implements a step a
 *   script owns. Spawns go through the injectable seams in seams.mts.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'

import { resolveSeams } from './seams.mts'

import type { ResolvedSeams, RunnerSeams, StageOutcome } from './seams.mts'

// ── stage 1: preflight ─────────────────────────────────────────────────────

const PREFLIGHT_STEPS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['pnpm', ['run', 'update']],
  ['pnpm', ['install']],
  ['pnpm', ['run', 'fix', '--all']],
  ['pnpm', ['run', 'check', '--all']],
]

// The one preflight step that mutates nothing — the only one a dry run
// executes.
const PREFLIGHT_CHECK_STEP = 3

/**
 * `pnpm run update` → `pnpm i` → `fix --all` → `check --all`, fail-loud with
 * the exact failing step. Dry runs execute only the non-mutating
 * `check --all`.
 */
export async function runPreflight(options: {
  cwd: string
  dryRun: boolean
  seams?: RunnerSeams | undefined
}): Promise<StageOutcome> {
  const opts = { __proto__: null, ...options } as typeof options
  const seams = resolveSeams(opts.seams)
  for (let i = 0; i < PREFLIGHT_STEPS.length; i += 1) {
    if (opts.dryRun && i !== PREFLIGHT_CHECK_STEP) {
      continue
    }
    const [cmd, args] = PREFLIGHT_STEPS[i]!
    const code = await seams.runInherit(cmd, [...args], opts.cwd)
    if (code !== 0) {
      return {
        detail:
          `preflight failed at \`${cmd} ${args.join(' ')}\` (exit ${code}).\n` +
          `  Where: step ${i + 1}/${PREFLIGHT_STEPS.length} in ${opts.cwd}\n` +
          `  Fix: run that command directly, resolve its findings, re-run the pipeline (it resumes here).`,
        status: 'failed',
      }
    }
  }
  return {
    detail: opts.dryRun
      ? 'check --all green (dry-run skipped update/install/fix — they mutate)'
      : 'update, install, fix --all, check --all all green',
    status: 'passed',
  }
}

// ── stage 2: exports gate ──────────────────────────────────────────────────

/**
 * Exports gate: regenerate the exports map when the repo opts in
 * (make-package-exports.mts, write skipped under --dry-run), then run the
 * canonical map ↔ files check (public-files-are-exported).
 */
export async function runExportsGate(options: {
  cwd: string
  dryRun: boolean
  seams?: RunnerSeams | undefined
}): Promise<StageOutcome> {
  const opts = { __proto__: null, ...options } as typeof options
  const seams = resolveSeams(opts.seams)
  const optedIn = existsSync(
    path.join(opts.cwd, 'scripts/repo/package-exports.config.mts'),
  )
  let generated = false
  if (optedIn && !opts.dryRun) {
    const gen = await seams.runInherit(
      'node',
      ['scripts/fleet/make-package-exports.mts'],
      opts.cwd,
    )
    if (gen !== 0) {
      return {
        detail:
          `make-package-exports.mts exited ${gen}.\n` +
          `  Fix: run \`node scripts/fleet/make-package-exports.mts\` directly and resolve its error.`,
        status: 'failed',
      }
    }
    generated = true
  }
  const check = await seams.runInherit(
    'node',
    ['scripts/fleet/check/public-files-are-exported.mts', '--quiet'],
    opts.cwd,
  )
  if (check !== 0) {
    return {
      detail:
        `public-files-are-exported check failed (exit ${check}).\n` +
        `  Fix: export the orphaned files (or mark them private), then re-run.`,
      status: 'failed',
    }
  }
  return {
    detail: generated
      ? 'exports regenerated + map ↔ public files agree'
      : 'exports map ↔ public files agree',
    status: 'passed',
  }
}

// ── stage 3: files gate ────────────────────────────────────────────────────

/**
 * Files gate: pack the real tarball and inspect its entry list via the
 * owning check (pack-contents-are-clean). Non-mutating (packs to a temp
 * dir), so it runs under --dry-run too.
 */
export async function runFilesGate(options: {
  cwd: string
  dryRun: boolean
  seams?: RunnerSeams | undefined
}): Promise<StageOutcome> {
  const opts = { __proto__: null, ...options } as typeof options
  const seams = resolveSeams(opts.seams)
  const code = await seams.runInherit(
    'node',
    ['scripts/fleet/check/pack-contents-are-clean.mts'],
    opts.cwd,
  )
  if (code !== 0) {
    return {
      detail:
        `pack-contents-are-clean failed (exit ${code}).\n` +
        `  Fix: tighten package.json \`files\` per the check output, then re-run.`,
      status: 'failed',
    }
  }
  return {
    detail: 'pnpm pack tarball inspected — entries clean',
    status: 'passed',
  }
}

// ── stage 4: commit fixes + CI ─────────────────────────────────────────────

export interface DirtyFiles {
  modified: string[]
  unmerged: string[]
}

/**
 * Parse `git status --porcelain` into modified-tracked vs unmerged paths.
 * Untracked (`??`) and ignored (`!!`) files are left alone — never swept into
 * a release commit. Unmerged = X or Y is `U`, or the `AA`/`DD` conflict
 * pairs. Pure — exported for tests.
 */
export function parsePorcelainStatus(stdout: string): DirtyFiles {
  const modified: string[] = []
  const unmerged: string[] = []
  for (const line of stdout.split('\n')) {
    if (line.length < 4) {
      continue
    }
    const xy = line.slice(0, 2)
    const rest = line.slice(3)
    // Rename lines are `R  old -> new`; the working-tree path is `new`.
    const filePath = rest.includes(' -> ') ? rest.split(' -> ')[1]! : rest
    if (xy === '??' || xy === '!!') {
      continue
    }
    if (xy.includes('U') || xy === 'AA' || xy === 'DD') {
      unmerged.push(filePath)
      continue
    }
    modified.push(filePath)
  }
  return { modified, unmerged }
}

/**
 * All-success CI conclusions.
 */
const CI_GREEN_CONCLUSIONS = new Set(['neutral', 'skipped', 'success'])

export interface GhRun {
  conclusion?: string | null | undefined
  status?: string | undefined
  workflowName?: string | undefined
}

/**
 * Classify one `gh run list` poll. Pure — exported for tests.
 */
export function classifyCiRuns(
  runs: readonly GhRun[],
): 'green' | 'pending' | 'red' {
  if (runs.some(r => r.status !== 'completed')) {
    return 'pending'
  }
  return runs.every(r => r.conclusion && CI_GREEN_CONCLUSIONS.has(r.conclusion))
    ? 'green'
    : 'red'
}

/**
 * Stage 4: surgically commit any staged fixes the earlier gates produced
 * (modified TRACKED files only; untracked files stay put; unmerged paths
 * fail loud), then require green CI on the current head — but ONLY when the
 * head is already pushed. An unpushed head records "local-only, CI deferred";
 * the pipeline NEVER pushes.
 */
export async function runCiGate(options: {
  ciTimeoutMs: number
  cwd: string
  dryRun: boolean
  seams?: RunnerSeams | undefined
}): Promise<StageOutcome> {
  const opts = { __proto__: null, ...options } as typeof options
  const seams = resolveSeams(opts.seams)
  const status = await seams.runCapture(
    'git',
    ['status', '--porcelain'],
    opts.cwd,
  )
  if (status.code !== 0) {
    return { detail: `git status exited ${status.code}`, status: 'failed' }
  }
  const { modified, unmerged } = parsePorcelainStatus(status.stdout)
  if (unmerged.length) {
    return {
      detail:
        `unmerged paths present (${unmerged.join(', ')}).\n` +
        `  Fix: finish the merge/rebase, then re-run the pipeline.`,
      status: 'failed',
    }
  }
  let committed = ''
  if (modified.length) {
    if (opts.dryRun) {
      committed = `[dry-run] would commit ${modified.length} fixed file(s): ${modified.join(', ')}; `
    } else {
      await seams.runCapture('git', ['add', '--', ...modified], opts.cwd)
      const commit = await seams.runCapture(
        'git',
        [
          'commit',
          '-o',
          ...modified,
          '-m',
          'chore: apply release readiness fixes',
        ],
        opts.cwd,
      )
      if (commit.code !== 0) {
        return {
          detail:
            `surgical commit of release fixes failed (exit ${commit.code}).\n` +
            `  Saw: ${commit.stdout.trim()}\n` +
            `  Fix: resolve the pre-commit failure, commit the files, re-run.`,
          status: 'failed',
        }
      }
      committed = `committed ${modified.length} fixed file(s); `
    }
  }
  const head = await seams.runCapture('git', ['rev-parse', 'HEAD'], opts.cwd)
  const sha = head.stdout.trim()
  const onOrigin = await headIsOnOrigin(sha, opts.cwd, seams)
  if (!onOrigin) {
    return {
      detail: `${committed}local-only, CI deferred (HEAD ${sha.slice(0, 12)} not on origin; the pipeline never pushes)`,
      status: 'deferred',
    }
  }
  return await pollCi(sha, opts, seams, committed)
}

/**
 * True when `sha` is an ancestor of the origin default branch.
 */
async function headIsOnOrigin(
  sha: string,
  cwd: string,
  seams: ResolvedSeams,
): Promise<boolean> {
  // Never hard-code main: resolve origin/HEAD, fall back main → master.
  const symref = await seams.runCapture(
    'git',
    ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'],
    cwd,
  )
  const candidates =
    symref.code === 0 && symref.stdout.trim()
      ? [symref.stdout.trim().replace('refs/remotes/', '')]
      : ['origin/main', 'origin/master']
  for (const ref of candidates) {
    // eslint-disable-next-line no-await-in-loop
    const check = await seams.runCapture(
      'git',
      ['merge-base', '--is-ancestor', sha, ref],
      cwd,
    )
    if (check.code === 0) {
      return true
    }
  }
  return false
}

const CI_POLL_INTERVAL_MS = 15_000

async function pollCi(
  sha: string,
  opts: { ciTimeoutMs: number; cwd: string; dryRun: boolean },
  seams: ResolvedSeams,
  prefix: string,
): Promise<StageOutcome> {
  const deadline = Date.now() + opts.ciTimeoutMs
  for (;;) {
    // Recurring gh loop: re-stamp the token-freshness heartbeat each tick.
    // eslint-disable-next-line no-await-in-loop
    await seams.runCapture(
      'node',
      ['scripts/fleet/gh-heartbeat.mts', '--quiet'],
      opts.cwd,
    )
    // eslint-disable-next-line no-await-in-loop
    const list = await seams.runCapture(
      'gh',
      [
        'run',
        'list',
        '--commit',
        sha,
        '--json',
        'status,conclusion,workflowName',
        '--limit',
        '50',
      ],
      opts.cwd,
    )
    if (list.code !== 0) {
      return {
        detail:
          `gh run list exited ${list.code} while polling CI for ${sha.slice(0, 12)}.\n` +
          `  Fix: check \`gh auth status\`, then re-run (the pipeline resumes here).`,
        status: 'failed',
      }
    }
    let runs: GhRun[] = []
    try {
      runs = JSON.parse(list.stdout || '[]') as GhRun[]
    } catch {
      runs = []
    }
    if (runs.length) {
      const verdict = classifyCiRuns(runs)
      if (verdict === 'green') {
        return {
          detail: `${prefix}CI green on ${sha.slice(0, 12)} (${runs.length} run(s))`,
          status: 'passed',
        }
      }
      if (verdict === 'red') {
        const red = runs
          .filter(r => r.conclusion && !CI_GREEN_CONCLUSIONS.has(r.conclusion))
          .map(r => `${r.workflowName}: ${r.conclusion}`)
        return {
          detail:
            `CI red on ${sha.slice(0, 12)} — ${red.join('; ')}.\n` +
            `  Fix: get CI green on this head, then re-run the pipeline.`,
          status: 'failed',
        }
      }
    }
    if (Date.now() >= deadline) {
      return {
        detail:
          `${prefix}CI still ${runs.length ? 'pending' : 'absent'} for ${sha.slice(0, 12)} after ${Math.round(opts.ciTimeoutMs / 1000)}s.\n` +
          `  Fix: wait for CI, or re-run with a larger --ci-timeout.`,
        status: 'failed',
      }
    }
    // eslint-disable-next-line no-await-in-loop
    await seams.sleep(CI_POLL_INTERVAL_MS)
  }
}
