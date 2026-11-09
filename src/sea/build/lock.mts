import { promises as fs } from 'node:fs'
import path from 'node:path'

/** Acquire an exclusive directory lock. Existing locks are never removed as stale. */
export async function acquireBuildLock(
  lockPath: string,
): Promise<() => Promise<void>> {
  await fs.mkdir(path.dirname(lockPath), { recursive: true })
  try {
    await fs.mkdir(lockPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`SEA build lock is already held: ${lockPath}`)
    }
    throw error
  }
  let released = false
  return async () => {
    if (released) {
      return
    }
    released = true
    await fs.rmdir(lockPath)
  }
}
