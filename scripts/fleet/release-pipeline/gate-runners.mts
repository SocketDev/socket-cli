/**
 * @file Readiness-gate stage runners (pre-bump): preflight, the coverage +
 *   badge-refresh gate, exports gate, files gate, and the commit-fixes + CI
 *   gate. Each defers to its owning fleet script — the pipeline orchestrates,
 *   it never re-implements a step a script owns. Spawns go through the
 *   injectable seams in seams.mts.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { coverageScriptName, readmeBadgeForm } from '../lib/coverage-badge.mts'
import { resolveSeams } from './seams.mts'

import type { ResolvedSeams, RunnerSeams, StageOutcome } from './seams.mts'

// ── stage 1: preflight ─────────────────────────────────────────────────────

/**
 * The preflight step list. The DEFAULT scopes fix + check to changed files
 * (their own no-flag default) — the preflight tree is usually already clean
 * at the receipt sha, fix.mts early-exits on a clean scope in under a second,
 * and the repo-wide fix backlog is not a release readiness question. `all`
 * (the pipeline's --preflight-all escape) restores the full-tree
 * `fix --all` + `check --all` passes. Pure — exported for tests.
 */
export function preflightSteps(
  all: boolean,
): ReadonlyArray<readonly [string, readonly string[]]> {
  const scope = all ? ['--all'] : []
  return [
    ['pnpm', ['run', 'update']],
    ['pnpm', ['install']],
    ['pnpm', ['run', 'fix', ...scope]],
    ['pnpm', ['run', 'check', ...scope]],
  ]
}

// The one preflight step that mutates nothing — the only one a dry run
// executes.
const PREFLIGHT_CHECK_STEP = 3

/**
 * `pnpm run update` → `pnpm i` → `fix` → `check` (changed-file scope by
 * default; `all: true` runs the full-tree `--all` passes), fail-loud with the
 * exact failing step. Dry runs execute only the non-mutating check step.
 */
export async function runPreflight(config: {
  all?: boolean | undefined
  cwd: string
  dryRun: boolean
  seams?: RunnerSeams | undefined
}): Promise<StageOutcome> {
  const cfg = { __proto__: null, ...config } as typeof config
  const seams = resolveSeams(cfg.seams)
  const steps = preflightSteps(cfg.all === true)
  for (let i = 0; i < steps.length; i += 1) {
    if (cfg.dryRun && i !== PREFLIGHT_CHECK_STEP) {
      continue
    }
    const [cmd, args] = steps[i]!
    const code = await seams.runInherit(cmd, [...args], cfg.cwd)
    if (code !== 0) {
      return {
        detail:
          `preflight failed at \`${cmd} ${args.join(' ')}\` (exit ${code}).\n` +
          `  Where: step ${i + 1}/${steps.length} in ${cfg.cwd}\n` +
          `  Fix: run that command directly, resolve its findings, re-run the pipeline (it resumes here).`,
        status: 'failed',
      }
    }
  }
  const scopeNote = cfg.all === true ? ' --all' : ' (changed-file scope)'
  return {
    detail: cfg.dryRun
      ? `check${scopeNote} green (dry-run skipped update/install/fix — they mutate)`
      : `update, install, fix, check${scopeNote} all green`,
    status: 'passed',
  }
}

// ── stage 2: coverage + badge refresh ──────────────────────────────────────

/**
 * Cover gate: run the repo's coverage script (`pnpm run cover` — or whichever
 * of cover/coverage/test:cover the repo declares), then ACTIVELY regenerate
 * the coverage badge via gen/coverage-badge.mts. `check --all` (preflight)
 * only runs coverage-badge-is-current — a CHECK, not an UPDATE — so this stage
 * is where the badge actually refreshes; the refreshed
 * assets/repo/badges/coverage.svg is a modified tracked file the ci stage
 * commits surgically, so it rides ahead of the bump commit and ships with the
 * release. Skips (passes) when the repo declares no coverage script or its
 * README carries no coverage badge (the same opt-outs
 * coverage-badge-is-current fails open on). Dry runs skip both steps — the
 * coverage run and the badge write mutate.
 */
export async function runCoverGate(config: {
  cwd: string
  dryRun: boolean
  seams?: RunnerSeams | undefined
}): Promise<StageOutcome> {
  const cfg = { __proto__: null, ...config } as typeof config
  const seams = resolveSeams(cfg.seams)
  const script = coverageScriptName(cfg.cwd)
  if (script === undefined) {
    return {
      detail:
        'no coverage script (cover/coverage/test:cover) declared — coverage + badge refresh skipped',
      status: 'passed',
    }
  }
  if (cfg.dryRun) {
    return {
      detail: `[dry-run] skipped \`pnpm run ${script}\` + badge refresh (both mutate — coverage cache + badge asset)`,
      status: 'passed',
    }
  }
  const cover = await seams.runInherit('pnpm', ['run', script], cfg.cwd)
  if (cover !== 0) {
    return {
      detail:
        `\`pnpm run ${script}\` exited ${cover}.\n` +
        `  Fix: get the coverage run green (failing tests? thresholds?), then re-run the pipeline (it resumes here).`,
      status: 'failed',
    }
  }
  const readmePath = path.join(cfg.cwd, 'README.md')
  const badgeForm = existsSync(readmePath)
    ? readmeBadgeForm(readFileSync(readmePath, 'utf8'))
    : undefined
  if (badgeForm === undefined) {
    return {
      detail: `\`pnpm run ${script}\` green; README carries no coverage badge — badge refresh skipped`,
      status: 'passed',
    }
  }
  const badge = await seams.runInherit(
    'node',
    ['scripts/fleet/gen/coverage-badge.mts'],
    cfg.cwd,
  )
  if (badge !== 0) {
    return {
      detail:
        `gen/coverage-badge.mts exited ${badge}.\n` +
        `  Fix: run \`node scripts/fleet/gen/coverage-badge.mts\` directly and resolve its error, then re-run.`,
      status: 'failed',
    }
  }
  return {
    detail: `\`pnpm run ${script}\` green + coverage badge refreshed (assets/repo/badges/coverage.svg; the ci stage commits any change before bump)`,
    status: 'passed',
  }
}

// ── stage 3: exports gate ──────────────────────────────────────────────────

/**
 * Exports gate: regenerate the exports map when the repo opts in
 * (gen/package-exports.mts, write skipped under --dry-run), then run the
 * canonical map ↔ files check (public-files-are-exported).
 */
export async function runExportsGate(config: {
  cwd: string
  dryRun: boolean
  seams?: RunnerSeams | undefined
}): Promise<StageOutcome> {
  const cfg = { __proto__: null, ...config } as typeof config
  const seams = resolveSeams(cfg.seams)
  const optedIn = existsSync(
    path.join(cfg.cwd, 'scripts/repo/package-exports.config.mts'),
  )
  let generated = false
  if (optedIn && !cfg.dryRun) {
    const gen = await seams.runInherit(
      'node',
      ['scripts/fleet/gen/package-exports.mts'],
      cfg.cwd,
    )
    if (gen !== 0) {
      return {
        detail:
          `gen/package-exports.mts exited ${gen}.\n` +
          `  Fix: run \`node scripts/fleet/gen/package-exports.mts\` directly and resolve its error.`,
        status: 'failed',
      }
    }
    generated = true
  }
  const check = await seams.runInherit(
    'node',
    ['scripts/fleet/check/public-files-are-exported.mts', '--quiet'],
    cfg.cwd,
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

// ── stage 4: files gate ────────────────────────────────────────────────────

/**
 * Files gate: pack the real tarball and inspect its entry list via the
 * owning check (pack-contents-are-clean). Non-mutating (packs to a temp
 * dir), so it runs under --dry-run too.
 */
export async function runFilesGate(config: {
  cwd: string
  dryRun: boolean
  seams?: RunnerSeams | undefined
}): Promise<StageOutcome> {
  const cfg = { __proto__: null, ...config } as typeof config
  const seams = resolveSeams(cfg.seams)
  const code = await seams.runInherit(
    'node',
    ['scripts/fleet/check/pack-contents-are-clean.mts'],
    cfg.cwd,
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

// ── stage 5: commit fixes + CI ─────────────────────────────────────────────

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
  const lines = stdout.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (line.length < 4) {
      continue
    }
    const xy = line.slice(0, 2)
    const rest = line.slice(3)
    // Rename lines are `R  old -> new`; the working-tree path is `new`.
    const filePath = rest.includes(' -> ') ? rest.split(' -> ')[1]! : rest
    if (xy === '!!' || xy === '??') {
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
 *
 * Fast path: when every LOCAL gate already passed at this sha
 * (`localGatesGreen`, computed by the pipeline from the tree receipts) and
 * strict blocking wasn't requested (`waitForRemote` / --ci-wait), a pushed
 * head records `deferred-pending-remote` instead of blocking on the remote
 * run — the remote CI remains an async back-check, and release/stage-publish
 * proceed on the local receipts.
 */
export async function runCiGate(config: {
  ciTimeoutMs: number
  cwd: string
  dryRun: boolean
  localGatesGreen?: boolean | undefined
  seams?: RunnerSeams | undefined
  waitForRemote?: boolean | undefined
}): Promise<StageOutcome> {
  const cfg = { __proto__: null, ...config } as typeof config
  const seams = resolveSeams(cfg.seams)
  const status = await seams.runCapture(
    'git',
    ['status', '--porcelain'],
    cfg.cwd,
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
    if (cfg.dryRun) {
      committed = `[dry-run] would commit ${modified.length} fixed file(s): ${modified.join(', ')}; `
    } else {
      await seams.runCapture('git', ['add', '--', ...modified], cfg.cwd)
      const commit = await seams.runCapture(
        'git',
        [
          'commit',
          '-o',
          ...modified,
          '-m',
          'chore: apply release readiness fixes',
        ],
        cfg.cwd,
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
  const head = await seams.runCapture('git', ['rev-parse', 'HEAD'], cfg.cwd)
  const sha = head.stdout.trim()
  const onOrigin = await headIsOnOrigin(sha, cfg.cwd, seams)
  if (!onOrigin) {
    return {
      detail: `${committed}local-only, CI deferred (HEAD ${sha.slice(0, 12)} not on origin; the pipeline never pushes)`,
      status: 'deferred',
    }
  }
  // Sanctioned non-blocking receipt: local gates green at this sha + strict
  // blocking not demanded → don't sit in the remote poll loop. The commit-fix
  // sweep above already ran; only the WAIT is skipped.
  if (cfg.localGatesGreen === true && cfg.waitForRemote !== true) {
    return {
      detail:
        `${committed}deferred-pending-remote — every local gate passed at ` +
        `${sha.slice(0, 12)}; the remote CI run stays an async back-check ` +
        `(re-run with --ci-wait to block on it)`,
      status: 'deferred',
    }
  }
  return await pollCi(sha, cfg, seams, committed)
}

/**
 * True when `sha` is an ancestor of the origin default branch. Exported for
 * the stage-publish runner: a workflow dispatch stages from the ORIGIN default
 * branch, so an unpushed bump commit would stage the wrong version.
 */
export async function headIsOnOrigin(
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
  config: { ciTimeoutMs: number; cwd: string; dryRun: boolean },
  seams: ResolvedSeams,
  prefix: string,
): Promise<StageOutcome> {
  const cfg = { __proto__: null, ...config } as typeof config
  const deadline = Date.now() + cfg.ciTimeoutMs
  for (;;) {
    // Recurring gh loop: re-stamp the token-freshness heartbeat each tick.
    // eslint-disable-next-line no-await-in-loop
    await seams.runCapture(
      'node',
      ['scripts/fleet/gh-heartbeat.mts', '--quiet'],
      cfg.cwd,
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
      cfg.cwd,
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
          `${prefix}CI still ${runs.length ? 'pending' : 'absent'} for ${sha.slice(0, 12)} after ${Math.round(cfg.ciTimeoutMs / 1000)}s.\n` +
          `  Fix: wait for CI, or re-run with a larger --ci-timeout.`,
        status: 'failed',
      }
    }
    // eslint-disable-next-line no-await-in-loop
    await seams.sleep(CI_POLL_INTERVAL_MS)
  }
}
