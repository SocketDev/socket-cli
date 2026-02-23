import { promises as fs } from 'node:fs'
import path from 'node:path'

import { debug, debugDir } from '@socketsecurity/lib/debug'
import { readJson, safeMkdir, writeJson } from '@socketsecurity/lib/fs'

import { getSocketFixBranchName } from './git.mts'

/**
 * Check if a process with the given PID is still running.
 */
function isPidAlive(pid: number): boolean {
  try {
    // Signal 0 checks process existence without sending actual signal.
    process.kill(pid, 0)
    return true
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    // EPERM means process exists but no permission (treat as alive).
    // ESRCH means process doesn't exist (dead).
    // All other errors (EINVAL, etc.) treat as dead to be safe.
    return err.code === 'EPERM'
  }
}

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
 * Uses file locking to prevent race conditions with concurrent operations.
 */
export async function markGhsaFixed(
  cwd: string,
  ghsaId: string,
  prNumber?: number,
  branch?: string,
): Promise<void> {
  const trackerPath = path.join(cwd, TRACKER_FILE)
  const lockFile = `${trackerPath}.lock`

  // Acquire lock with exponential backoff and stale lock detection.
  let lockAcquired = false
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await fs.writeFile(lockFile, String(process.pid), { flag: 'wx' })
      lockAcquired = true
      break
    } catch (e) {
      const err = e as NodeJS.ErrnoException
      if (err.code === 'EEXIST' && attempt < 4) {
        // Lock exists, check if it's stale.
        try {
          const lockContent = await fs.readFile(lockFile, 'utf8')
          const lockPid = Number.parseInt(lockContent.trim(), 10)
          if (!Number.isNaN(lockPid) && !isPidAlive(lockPid)) {
            // Stale lock detected, remove and retry immediately.
            debug(
              `ghsa-tracker: removing stale lock from dead process ${lockPid}`,
            )
            await fs.unlink(lockFile).catch(() => {})
            continue
          }
        } catch {
          // Could not read lock file, may have been removed.
        }
        // Lock exists and process is alive, wait with exponential backoff.
        // Delays: 100ms, 200ms, 400ms, 800ms, capped at 10s to prevent overflow.
        await new Promise(resolve =>
          setTimeout(resolve, Math.min(100 * Math.pow(2, attempt), 10_000)),
        )
        continue
      }
      // If not EEXIST or last attempt, proceed without lock.
      debug(`ghsa-tracker: could not acquire lock, proceeding anyway`)
      break
    }
  }

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
  } finally {
    // Release lock.
    if (lockAcquired) {
      try {
        await fs.unlink(lockFile)
      } catch {
        // Ignore cleanup errors.
      }
    }
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
