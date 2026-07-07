#!/usr/bin/env node
/**
 * @file Enable / disable / run the non-gh-aw weekly-update fallback WORKFLOW.
 *   The workflow ships as
 *   `.github/workflows/weekly-update-non-gh-aw.yml.disabled`. GitHub only loads
 *   `*.yml`/`*.yaml` in `.github/workflows/`, so the `.yml.disabled` extension
 *   keeps it invisible in every repo's Actions list and unrunnable — it
 *   cascades fleet-wide but stays dormant. This script is the toggle: enable —
 *   copy `…non-gh-aw.yml.disabled` → `…non-gh-aw.yml` (now live + listed). The
 *   enabled copy is gitignored, so it's transient and never re-committed (the
 *   `.disabled` file stays the source of truth). disable — remove the enabled
 *   `…non-gh-aw.yml` (back to dormant). Idempotent. run — enable → run it
 *   locally via Agent CI → disable, even on failure. This is the supported way
 *   to exercise the fallback: Agent CI can't see a `.disabled` file, so it must
 *   be enabled for the run and re-hidden after. (Agent CI also can't simulate
 *   the gh-aw `.lock.yml` — see agent-ci-skip-locks.mts; this fallback is the
 *   plain workflow it CAN run.) Usage: node
 *   scripts/fleet/weekly-update-workflow.mts <enable|disable|run|status>
 */

import { copyFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { REPO_ROOT } from './paths.mts'

const logger = getDefaultLogger()

const WORKFLOW_NAME = 'weekly-update-non-gh-aw.yml'
const DISABLED_PATH = path.join(
  REPO_ROOT,
  '.github',
  'workflows',
  `${WORKFLOW_NAME}.disabled`,
)
const ENABLED_PATH = path.join(REPO_ROOT, '.github', 'workflows', WORKFLOW_NAME)

export type WorkflowMode = 'enable' | 'disable' | 'run' | 'status'

export function parseMode(argv: readonly string[]): WorkflowMode | undefined {
  const arg = argv[0]
  if (
    arg === 'disable' ||
    arg === 'enable' ||
    arg === 'run' ||
    arg === 'status'
  ) {
    return arg
  }
  return undefined
}

// Copy the dormant `.disabled` file to its live `.yml` name. The enabled copy
// is gitignored (transient). Returns true on success.
export function enableWorkflow(): boolean {
  if (!existsSync(DISABLED_PATH)) {
    logger.fail(
      `[weekly-update-workflow] no ${WORKFLOW_NAME}.disabled at ${DISABLED_PATH} — ` +
        'is this repo cascaded? Run the wheelhouse sync first.',
    )
    return false
  }
  copyFileSync(DISABLED_PATH, ENABLED_PATH)
  logger.success(
    `[weekly-update-workflow] enabled → ${WORKFLOW_NAME} (live + listed). ` +
      'Run `disable` (or `run`, which auto-disables) when done.',
  )
  return true
}

// Remove the live `.yml` copy, returning to dormant. Idempotent (no-op if
// already disabled). The `.disabled` source is left untouched.
export function disableWorkflow(): void {
  if (existsSync(ENABLED_PATH)) {
    safeDeleteSync(ENABLED_PATH)
    logger.success(
      `[weekly-update-workflow] disabled (removed live ${WORKFLOW_NAME}).`,
    )
  } else {
    logger.info('[weekly-update-workflow] already disabled (no live copy).')
  }
}

function reportStatus(): void {
  const enabled = existsSync(ENABLED_PATH)
  const present = existsSync(DISABLED_PATH)
  logger.info(
    `[weekly-update-workflow] ${WORKFLOW_NAME}: ` +
      `${present ? 'shipped' : 'MISSING (not cascaded)'}, ` +
      `${enabled ? 'ENABLED (live)' : 'disabled (dormant)'}.`,
  )
}

async function main(): Promise<void> {
  const mode = parseMode(process.argv.slice(2))
  if (!mode) {
    logger.fail(
      '[weekly-update-workflow] usage: node scripts/fleet/weekly-update-workflow.mts <enable|disable|run|status>',
    )
    process.exitCode = 1
    return
  }
  if (mode === 'status') {
    reportStatus()
    return
  }
  if (mode === 'enable') {
    if (!enableWorkflow()) {
      process.exitCode = 1
    }
    return
  }
  if (mode === 'disable') {
    disableWorkflow()
    return
  }
  // run: enable → Agent CI the workflow → disable (always, even on failure).
  if (!enableWorkflow()) {
    process.exitCode = 1
    return
  }
  let runOk = false
  try {
    logger.info(
      `[weekly-update-workflow] running ${WORKFLOW_NAME} via Agent CI…`,
    )
    await spawn(
      process.execPath,
      [
        path.join(REPO_ROOT, 'scripts', 'fleet', 'agent-ci-skip-locks.mts'),
        'run',
        `.github/workflows/${WORKFLOW_NAME}`,
        '--no-matrix',
      ],
      { cwd: REPO_ROOT, stdio: 'inherit' },
    )
    runOk = true
  } catch {
    logger.fail(
      '[weekly-update-workflow] Agent CI run failed — see output above.',
    )
  } finally {
    // Always re-hide so a forgotten enable doesn't leave a live workflow.
    disableWorkflow()
  }
  if (!runOk) {
    process.exitCode = 1
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main()
}
