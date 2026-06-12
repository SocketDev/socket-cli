/**
 * @file Thin pass-through wrapper around the local Agent CI runner that guards
 *   the one input it cannot handle: a gh-aw compiled `*.lock.yml`. Agent CI
 *   parses workflows with GitHub's own `@actions/workflow-parser`, whose
 *   `convertWorkflowTemplate` crashes on the gh-aw agent-runtime jobs (the
 *   `agent` / `conclusion` / `detection` jobs reference `inputs.aw_context` and
 *   the gh-aw container steps), so it returns a template with no `.jobs` and
 *   Agent CI aborts every task with the cryptic `No jobs found in workflow`.
 *   gh-aw workflows are exercised with `gh aw trial` (an isolated trial repo),
 *   never Agent CI — see docs/agents.md/fleet/shared-workflow-cascade.md. This
 *   wrapper makes that boundary legible instead of cryptic:
 *
 *   - An explicit `--workflow <X>.lock.yml` target exits with an informative
 *     error (the verified crash case) — the reader is told to use `gh aw
 *     trial`.
 *   - In discovery mode (`--all`), it forwards to Agent CI unchanged but first
 *     prints a one-line note for any `*.lock.yml` present in
 *     `.github/workflows/` so a surfaced skip/crash reads as expected, not
 *     mysterious. Everything else (args, stdio, exit code) passes through
 *     verbatim, so the wrapper is a drop-in for the canonical `ci:local`
 *     command.
 */

import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

const WIN32 = process.platform === 'win32'
const logger = getDefaultLogger()

const AGENT_CI_BIN = 'agent-ci'
const WORKFLOWS_DIR = path.join('.github', 'workflows')
const TRIAL_HINT =
  'gh-aw compiled .lock.yml workflows are not Agent-CI-simulatable ' +
  '(GitHub’s @actions/workflow-parser crashes on their agent-runtime jobs). ' +
  'Exercise them with `gh aw trial <workflow>.md` against an isolated trial ' +
  'repo instead. See docs/agents.md/fleet/shared-workflow-cascade.md.'

function logTrialHint(): void {
  logger.error(TRIAL_HINT)
}

export function isLockYmlTarget(value: string | undefined): boolean {
  return typeof value === 'string' && value.endsWith('.lock.yml')
}

/**
 * Pull the value passed to `--workflow` / `-w`, supporting both `--workflow
 * path` and `--workflow=path` forms.
 */
export function extractWorkflowTarget(argv: string[]): string | undefined {
  for (let i = 0, { length } = argv; i < length; i += 1) {
    const arg = argv[i]!
    if (arg === '--workflow' || arg === '-w') {
      return argv[i + 1]
    }
    if (arg.startsWith('--workflow=')) {
      return arg.slice('--workflow='.length)
    }
    if (arg.startsWith('-w=')) {
      return arg.slice('-w='.length)
    }
  }
  return undefined
}

export function listLockYmls(workflowsDir: string): string[] {
  if (!existsSync(workflowsDir)) {
    return []
  }
  return readdirSync(workflowsDir)
    .filter(name => name.endsWith('.lock.yml'))
    .toSorted()
}

export async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const target = extractWorkflowTarget(argv)

  // Verified crash case: an explicit .lock.yml target. Fail loudly + usefully
  // rather than letting Agent CI throw `No jobs found`.
  if (isLockYmlTarget(target)) {
    logger.error(`Agent CI cannot run the gh-aw lock file ${target}.`)
    logTrialHint()
    return 1
  }

  // Discovery mode: note any gh-aw locks so a surfaced skip/crash is expected.
  const isDiscovery = argv.includes('--all') || argv.includes('-a')
  if (isDiscovery) {
    const locks = listLockYmls(WORKFLOWS_DIR)
    if (locks.length) {
      logger.warn(
        `Skipping ${locks.length} gh-aw lock file(s) Agent CI cannot parse: ` +
          `${locks.join(', ')}.`,
      )
      logger.warn(TRIAL_HINT)
    }
  }

  const result = await spawn(AGENT_CI_BIN, argv, {
    shell: WIN32,
    stdio: 'inherit',
  })
  return result.code ?? 1
}

if (process.argv[1]?.endsWith('agent-ci-skip-locks.mts')) {
  void (async () => {
    process.exitCode = await main()
  })()
}
