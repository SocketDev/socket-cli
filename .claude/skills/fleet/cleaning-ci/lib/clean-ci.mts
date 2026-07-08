/**
 * Read-only CI-surface inventory for the cleaning-ci skill: per repo, run the
 * three probes (orphan YAML on disk, workflow records, automated-security-fixes
 * state), categorize each finding, and emit a PROPOSED action plan as DATA.
 *
 * Inventory ONLY — it issues no `gh api -X DELETE`, no `git rm`, no toggle. The
 * deletions are irreversible server-side GitHub mutations; the model reads this
 * envelope, applies the legitimate-retired-workflow judgment (a stale record
 * may be a deliberately-kept renamed workflow), and issues the deletes itself
 * under the skill's per-repo confirmation gate. The engine reports counts +
 * candidate ids + the proposed commands; it never performs them.
 *
 * Usage: node clean-ci.mts <owner/repo> [<owner/repo> …] # one or more explicit
 * repos node clean-ci.mts --pretty <owner/repo> # + a human table.
 *
 * Repos are explicit args (mirrors auditing-gha — no implicit fleet-wide
 * default; the orchestrator skill expands the roster at call time).
 */

import process from 'node:process'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

const logger = getDefaultLogger()

// The four canonical orphan workflow names the unified ci.yml replaced.
const ORPHAN_RE = /^(lint|check|type|test)\.ya?ml$/u

export interface WorkflowRecord {
  id: number
  state: string
  name: string
  path: string
}

export interface RepoInventory {
  repo: string
  orphanFiles: string[]
  staleRecords: WorkflowRecord[]
  securityFixesEnabled: boolean | undefined
  // The proposed (NOT executed) actions, as data the model acts on.
  proposed: {
    deleteFile: string[]
    deleteRecord: Array<{ id: number; name: string; reason: string }>
    toggleOff: boolean
  }
}

async function gh(args: readonly string[]): Promise<string> {
  const r = await spawn('gh', args as string[], {
    stdio: 'pipe',
    stdioString: true,
    timeout: 30_000,
  }).catch((e: unknown) => e as { stdout?: unknown | undefined })
  return String(r.stdout ?? '').trim()
}

// Orphan YAML files present on disk in the given checkout (read-only).
export function findOrphanFiles(repoDir: string): string[] {
  const dir = path.join(repoDir, '.github', 'workflows')
  if (!existsSync(dir)) {
    return []
  }
  return readdirSync(dir)
    .filter(name => ORPHAN_RE.test(name))
    .toSorted()
}

// A workflow record is a delete-record CANDIDATE when its name matches the
// orphan pattern OR its backing `.path` no longer exists on disk. The model
// still decides whether deleting it is safe (a missing-path record may be a
// deliberately-retired workflow); this only flags the candidate.
export function isStaleRecord(
  record: WorkflowRecord,
  repoDir: string,
): boolean {
  const base = path.basename(record.path)
  if (ORPHAN_RE.test(base)) {
    return true
  }
  // record.path is repo-relative (e.g. .github/workflows/foo.yml).
  return record.path !== '' && !existsSync(path.join(repoDir, record.path))
}

function parseWorkflowRecords(raw: string): WorkflowRecord[] {
  return raw
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [id, state, name, p] = line.split('\t')
      return {
        id: Number(id),
        name: name ?? '',
        path: p ?? '',
        state: state ?? '',
      }
    })
}

export async function inventoryRepo(
  repo: string,
  repoDir: string,
): Promise<RepoInventory> {
  const orphanFiles = findOrphanFiles(repoDir)
  const recordsRaw = await gh([
    'api',
    `repos/${repo}/actions/workflows`,
    '--paginate',
    '--jq',
    '.workflows[] | "\\(.id)\\t\\(.state)\\t\\(.name)\\t\\(.path)"',
  ])
  const allRecords = parseWorkflowRecords(recordsRaw)
  // GitHub-managed dynamic/dependabot records can't be API-deleted — exclude.
  const staleRecords = allRecords.filter(
    r => !r.path.startsWith('dynamic/') && isStaleRecord(r, repoDir),
  )
  const secRaw = await gh([
    'api',
    `repos/${repo}/automated-security-fixes`,
    '--jq',
    '.enabled',
  ])
  const securityFixesEnabled =
    secRaw === 'true' ? true : secRaw === 'false' ? false : undefined
  return {
    orphanFiles,
    proposed: {
      deleteFile: orphanFiles.map(f => `.github/workflows/${f}`),
      deleteRecord: staleRecords.map(r => ({
        id: r.id,
        name: r.name,
        reason: ORPHAN_RE.test(path.basename(r.path))
          ? 'orphan-name'
          : 'path-missing',
      })),
      toggleOff: securityFixesEnabled === true,
    },
    repo,
    securityFixesEnabled,
    staleRecords,
  }
}

function renderPretty(inv: RepoInventory): void {
  logger.info(`── ${inv.repo} ──`)
  logger.info(
    `   orphan files: ${inv.orphanFiles.length ? inv.orphanFiles.join(', ') : '(none)'}`,
  )
  logger.info(
    `   stale records: ${inv.staleRecords.length ? inv.staleRecords.map(r => `${r.name}#${r.id}`).join(', ') : '(none)'}`,
  )
  logger.info(
    `   automated-security-fixes: ${String(inv.securityFixesEnabled)}`,
  )
  logger.info(
    '   (proposed actions are DATA — review, then issue the deletes yourself under the per-repo gate)',
  )
}

export async function main(argv: readonly string[]): Promise<number> {
  const pretty = argv.includes('--pretty')
  const repos = argv.filter(a => !a.startsWith('--'))
  if (!repos.length) {
    logger.fail(
      'cleaning-ci inventory needs one or more explicit <owner/repo> args. (No implicit fleet-wide default — the orchestrator expands the roster at call time.)',
    )
    return 1
  }
  try {
    const out: RepoInventory[] = []
    for (let i = 0, { length } = repos; i < length; i += 1) {
      const repo = repos[i]!
      // The checkout is assumed at cwd for a single-repo run; a fleet sweep
      // resolves each under $PROJECTS via the orchestrator.
      const inv = await inventoryRepo(repo, process.cwd())
      out.push(inv)
      if (pretty) {
        renderPretty(inv)
      }
    }
    if (!pretty) {
      // logger.log is prefix-free plain stdout — safe for machine JSON.
      logger.log(JSON.stringify({ repos: out }, undefined, 2))
    }
    return 0
  } catch (e) {
    logger.fail(`clean-ci inventory failed: ${errorMessage(e)}`)
    return 1
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void (async () => {
    process.exitCode = await main(process.argv.slice(2))
  })()
}
