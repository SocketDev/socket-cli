import path from 'node:path'

import { debug, debugDir } from '@socketsecurity/lib/debug'
import { readJson, safeMkdir, writeJson } from '@socketsecurity/lib/fs'

import { getSocketFixBranchName } from './git.mts'

export type GhsaFixRecord = {
  branch: string
  fixedAt: string // ISO 8601
  ghsaId: string
  prNumber?: number
}

export type GhsaTracker = {
  fixed: GhsaFixRecord[]
  version: 1
}

const TRACKER_FILE = '.socket/fixed-ghsas.json'

/**
 * Load the GHSA tracker from the repository.
 * Creates a new tracker if the file doesn't exist.
 */
export async function loadGhsaTracker(cwd: string): Promise<GhsaTracker> {
  const trackerPath = path.join(cwd, TRACKER_FILE)

  try {
    const data = await readJson(trackerPath)
    return (data as GhsaTracker) ?? { version: 1, fixed: [] }
  } catch (_e) {
    debug(`ghsa-tracker: creating new tracker at ${trackerPath}`)
    return { version: 1, fixed: [] }
  }
}

/**
 * Save the GHSA tracker to the repository.
 * Creates the .socket directory if it doesn't exist.
 */
export async function saveGhsaTracker(
  cwd: string,
  tracker: GhsaTracker,
): Promise<void> {
  const trackerPath = path.join(cwd, TRACKER_FILE)

  // Ensure .socket directory exists.
  await safeMkdir(path.dirname(trackerPath), { recursive: true })

  await writeJson(trackerPath, tracker, { spaces: 2 })
  debug(`ghsa-tracker: saved ${tracker.fixed.length} records to ${trackerPath}`)
}

/**
 * Mark a GHSA as fixed in the tracker.
 * Removes any existing record for the same GHSA before adding the new one.
 */
export async function markGhsaFixed(
  cwd: string,
  ghsaId: string,
  prNumber?: number,
  branch?: string,
): Promise<void> {
  try {
    const tracker = await loadGhsaTracker(cwd)

    // Remove any existing record for this GHSA.
    tracker.fixed = tracker.fixed.filter(r => r.ghsaId !== ghsaId)

    // Add new record.
    const record: GhsaFixRecord = {
      branch: branch ?? getSocketFixBranchName(ghsaId),
      fixedAt: new Date().toISOString(),
      ghsaId,
    }
    if (prNumber !== undefined) {
      record.prNumber = prNumber
    }
    tracker.fixed.push(record)

    // Sort by fixedAt descending (most recent first).
    tracker.fixed.sort((a, b) => b.fixedAt.localeCompare(a.fixedAt))

    await saveGhsaTracker(cwd, tracker)
    debug(`ghsa-tracker: marked ${ghsaId} as fixed`)
  } catch (e) {
    debug(`ghsa-tracker: failed to mark ${ghsaId} as fixed`)
    debugDir(e)
  }
}

/**
 * Check if a GHSA has been fixed according to the tracker.
 */
export async function isGhsaFixed(
  cwd: string,
  ghsaId: string,
): Promise<boolean> {
  try {
    const tracker = await loadGhsaTracker(cwd)
    return tracker.fixed.some(r => r.ghsaId === ghsaId)
  } catch (e) {
    debug(`ghsa-tracker: failed to check if ${ghsaId} is fixed`)
    debugDir(e)
    return false
  }
}

/**
 * Get all fixed GHSA records from the tracker.
 */
export async function getFixedGhsas(cwd: string): Promise<GhsaFixRecord[]> {
  try {
    const tracker = await loadGhsaTracker(cwd)
    return tracker.fixed
  } catch (e) {
    debug('ghsa-tracker: failed to get fixed GHSAs')
    debugDir(e)
    return []
  }
}
