#!/usr/bin/env node
/*
 * @file Prune GitHub Actions workflow runs by a retention policy:
 *
 *   - Workflow whose source `.yml` EXISTS on the default branch: delete runs
 *     older than the retention window (default 15 days); keep the rest.
 *   - Workflow whose source is ABSENT from the default branch (deleted file, an
 *     org-required workflow not vendored here, or an orphaned run group):
 *     delete ALL its runs.
 *
 *   Covers registered workflows (`/actions/workflows`) and orphaned run groups
 *   (runs whose `workflow_id` is absent from that list). The default-branch
 *   source check is the single validity signal.
 *
 *   Deletes are paced + exponentially backed off: GitHub's SECONDARY rate limit
 *   403-throttles rapid run-deletes (separate from the primary quota), so a
 *   tight loop stalls.
 *
 *   Usage: node scripts/fleet/prune-workflow-runs.mts [--days N] [--dry-run]
 *   Auth: `gh` (GITHUB_TOKEN in CI, keychain locally); needs `actions: write`.
 */

import process from 'node:process'

import { parseArgs } from '@socketsecurity/lib-stable/argv/parse'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from './paths.mts'
import { runCapture } from './publish-infra/shared.mts'
import { isMainModule } from './_shared/is-main-module.mts'

const logger = getDefaultLogger()

const RETENTION_DAYS_DEFAULT = 15
const MS_PER_DAY = 86_400_000
const PACE_MS = 1500
const INITIAL_BACKOFF_MS = 15_000
const MAX_BACKOFF_MS = 300_000

export interface WorkflowEntry {
  id: number
  name: string
  path: string
}

export interface RunEntry {
  createdAt: number
  id: number
  workflowId: number
}

// Resolve the effective retention window in days from the raw `--days` CLI
// value: a finite positive number wins, anything else (absent/NaN/<=0) falls
// back to the default.
export function resolveRetentionDays(rawDays: string | undefined): number {
  const days = Number(rawDays ?? RETENTION_DAYS_DEFAULT)
  return Number.isFinite(days) && days > 0 ? days : RETENTION_DAYS_DEFAULT
}

export function computeCutoff(retentionDays: number, now: number): number {
  return now - retentionDays * MS_PER_DAY
}

// The retention decision: a run is doomed when its workflow is no longer
// valid (source absent from the default branch / an orphaned run group) OR
// it predates the cutoff. Pure — no gh/network access.
export function selectRunsToDelete(
  runs: readonly RunEntry[],
  validById: ReadonlyMap<number, boolean>,
  cutoff: number,
): number[] {
  const doomed: number[] = []
  for (let i = 0, { length } = runs; i < length; i += 1) {
    const run = runs[i]!
    const valid = validById.get(run.workflowId) ?? false
    const expired = run.createdAt < cutoff
    if (!valid || expired) {
      doomed.push(run.id)
    }
  }
  return doomed
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, ms)
    timer.unref?.()
  })
}

export async function resolveRepoSlug(): Promise<string | undefined> {
  const fromEnv = process.env['GITHUB_REPOSITORY']
  if (fromEnv) {
    return fromEnv
  }
  const r = await runCapture('git', ['remote', 'get-url', 'origin'], REPO_ROOT)
  if (r.code !== 0) {
    return undefined
  }
  // Capture "owner/repo" from an https or ssh GitHub remote URL, dropping an
  // optional `.git` suffix and any trailing whitespace.
  const match = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?\s*$/.exec(r.stdout)
  return match?.[1]
}

export async function resolveDefaultBranch(repo: string): Promise<string> {
  const r = await runCapture(
    'gh',
    ['api', `/repos/${repo}`, '--jq', '.default_branch'],
    REPO_ROOT,
  )
  const branch = r.stdout.trim()
  return r.code === 0 && branch ? branch : 'main'
}

export async function sourceExistsOnBranch(
  repo: string,
  filePath: string,
  branch: string,
): Promise<boolean> {
  const r = await runCapture(
    'gh',
    [
      'api',
      `/repos/${repo}/contents/${filePath}?ref=${branch}`,
      '--jq',
      '.sha',
    ],
    REPO_ROOT,
  )
  return r.code === 0 && !!r.stdout.trim()
}

export async function listWorkflows(repo: string): Promise<WorkflowEntry[]> {
  const r = await runCapture(
    'gh',
    [
      'api',
      '--paginate',
      `/repos/${repo}/actions/workflows`,
      '--jq',
      '.workflows[] | "\\(.id)\\t\\(.path)\\t\\(.name)"',
    ],
    REPO_ROOT,
  )
  if (r.code !== 0) {
    return []
  }
  const out: WorkflowEntry[] = []
  const lines = r.stdout.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!.trim()
    if (!line) {
      continue
    }
    const [idRaw, path, name] = line.split('\t')
    const id = Number(idRaw)
    if (Number.isFinite(id) && path) {
      out.push({ id, name: name ?? '', path })
    }
  }
  return out
}

export async function listAllRuns(repo: string): Promise<RunEntry[]> {
  const r = await runCapture(
    'gh',
    [
      'api',
      '--paginate',
      `/repos/${repo}/actions/runs?per_page=100`,
      '--jq',
      '.workflow_runs[] | "\\(.id)\\t\\(.workflow_id)\\t\\(.created_at)"',
    ],
    REPO_ROOT,
  )
  if (r.code !== 0) {
    return []
  }
  const out: RunEntry[] = []
  const lines = r.stdout.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!.trim()
    if (!line) {
      continue
    }
    const [idRaw, wfRaw, createdRaw] = line.split('\t')
    const id = Number(idRaw)
    const workflowId = Number(wfRaw)
    const createdAt = Date.parse(createdRaw ?? '')
    if (Number.isFinite(id) && Number.isFinite(workflowId)) {
      out.push({
        createdAt: Number.isFinite(createdAt) ? createdAt : 0,
        id,
        workflowId,
      })
    }
  }
  return out
}

export async function deleteRun(
  repo: string,
  runId: number,
): Promise<'deleted' | 'throttled' | 'failed'> {
  const r = await runCapture(
    'gh',
    ['api', '-X', 'DELETE', `/repos/${repo}/actions/runs/${runId}`],
    REPO_ROOT,
  )
  if (r.code === 0) {
    return 'deleted'
  }
  return /rate limit|secondary|abuse|retry/i.test(r.stdout)
    ? 'throttled'
    : 'failed'
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      days: { type: 'string' },
      'dry-run': { default: false, type: 'boolean' },
      help: { default: false, type: 'boolean' },
    },
    strict: false,
  })
  if (values['help']) {
    logger.log(
      'Usage: node scripts/fleet/prune-workflow-runs.mts [--days N] [--dry-run]',
    )
    return
  }
  const dryRun = !!values['dry-run']
  const rawDays = values['days']
  const retentionDays = resolveRetentionDays(
    typeof rawDays === 'string' ? rawDays : undefined,
  )
  const cutoff = computeCutoff(retentionDays, Date.now())

  const repo = await resolveRepoSlug()
  if (!repo) {
    logger.fail(
      'Could not resolve owner/repo (set GITHUB_REPOSITORY or run inside a GitHub clone).',
    )
    process.exitCode = 1
    return
  }
  const branch = await resolveDefaultBranch(repo)
  logger.log(
    `Pruning ${repo}: keep <=${retentionDays}d for workflows present on ${branch}, delete all for absent ones${dryRun ? ' [dry-run]' : ''}.`,
  )

  const workflows = await listWorkflows(repo)
  const validById = new Map<number, boolean>()
  for (let i = 0, { length } = workflows; i < length; i += 1) {
    const wf = workflows[i]!
    // eslint-disable-next-line no-await-in-loop
    const valid = await sourceExistsOnBranch(repo, wf.path, branch)
    validById.set(wf.id, valid)
    logger.log(`  ${wf.path}: ${valid ? 'present' : 'ABSENT'} on ${branch}`)
  }

  const runs = await listAllRuns(repo)
  const doomed = selectRunsToDelete(runs, validById, cutoff)
  logger.log(`${doomed.length} run(s) to delete of ${runs.length} total.`)
  if (dryRun || doomed.length === 0) {
    logger.success(
      dryRun
        ? 'Dry-run: re-run without --dry-run to delete.'
        : 'Nothing to prune.',
    )
    return
  }

  let deleted = 0
  let backoff = INITIAL_BACKOFF_MS
  for (let i = 0, { length } = doomed; i < length; i += 1) {
    const runId = doomed[i]!
    // eslint-disable-next-line no-await-in-loop
    const result = await deleteRun(repo, runId)
    if (result === 'deleted') {
      deleted += 1
      backoff = INITIAL_BACKOFF_MS
      if (deleted % 25 === 0) {
        logger.log(`  deleted ${deleted}/${doomed.length}`)
      }
      // eslint-disable-next-line no-await-in-loop
      await sleep(PACE_MS)
    } else if (result === 'throttled') {
      logger.warn(
        `  throttled at ${deleted}; backing off ${Math.round(backoff / 1000)}s`,
      )
      // eslint-disable-next-line no-await-in-loop
      await sleep(backoff)
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS)
      i -= 1
    }
  }
  logger.success(`Pruned ${deleted} workflow run(s) from ${repo}.`)
}

if (isMainModule(import.meta.url)) {
  main().catch((e: unknown) => {
    logger.error(e)
    process.exitCode = 1
  })
}
