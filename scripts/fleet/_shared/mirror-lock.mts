/**
 * @file Mirror-lock lift primitives. The cascade chmods live fleet mirrors
 *   read-only (0444/0555) so stray edits fail at the filesystem level; every
 *   sanctioned writer that rewrites a mirror (a re-cascade, a block splice, a
 *   dispatch-table regen) lifts the lock for the write and restores it after.
 *   fs.cp/copyFile/writeFile all open the DESTINATION for write, so a locked
 *   mirror EACCESes without the lift. One implementation here — the cascade's
 *   mirror-mode fixer and the member-side generators (build-hook-bundle,
 *   gen/hook-dispatch) all import it, so the lift semantics cannot drift.
 */

import { chmodSync, promises as fs, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Lift the read-only lock from a target, file or dir-mirror tree, so a
 * re-cascade can overwrite it. applyMirrorMode re-locks after the copy.
 * A missing target is a no-op, the seed path.
 */
export async function liftMirrorLock(targetPath: string): Promise<void> {
  // oxlint-disable-next-line socket/prefer-exists-sync -- need mode + file-type bits, not existence
  const stat = await fs.stat(targetPath).catch(() => undefined)
  if (!stat) {
    return
  }
  if (!stat.isDirectory()) {
    await fs.chmod(targetPath, (stat.mode & 0o777) | 0o200)
    return
  }
  const entries = await fs.readdir(targetPath, {
    recursive: true,
    withFileTypes: true,
  })
  // oxlint-disable-next-line socket/prefer-all-settled -- fail-fast: a chmod failure during cascade must surface, not be swallowed
  await Promise.all(
    entries
      .filter(entry => entry.isFile())
      .map(async entry => {
        const filePath = path.join(entry.parentPath, entry.name)
        // oxlint-disable-next-line socket/prefer-exists-sync -- need the mode bits, not existence
        const mode = (await fs.stat(filePath)).mode & 0o777
        await fs.chmod(filePath, mode | 0o200)
      }),
  )
}

/**
 * Lift the read-only mirror lock around a write. A writable or missing
 * target runs `fn` untouched; a locked one is unlocked for the write and
 * restored to its prior mode after (0444 stays 0444, 0555 stays 0555).
 */
export async function withMirrorLockLifted<T>(
  filePath: string,
  fn: () => Promise<T>,
): Promise<T> {
  // oxlint-disable-next-line socket/prefer-exists-sync -- need the mode bits, not existence
  const stat = await fs.stat(filePath).catch(() => undefined)
  const mode = stat ? stat.mode & 0o777 : undefined
  const locked = mode !== undefined && (mode & 0o200) === 0
  if (locked) {
    await fs.chmod(filePath, mode | 0o200)
  }
  try {
    return await fn()
  } finally {
    if (locked && mode !== undefined) {
      await fs.chmod(filePath, mode)
    }
  }
}

/**
 * Lift the lock from ONE file with no re-lock — for generated outputs a
 * child process rewrites (rolldown writing _dist/fleet-pack.cjs cannot lift
 * for itself). Generated outputs are regenerated freely and should never
 * carry the mirror lock; this clears one that an earlier cascade applied.
 * Missing file is a no-op.
 */
export function liftMirrorLockSync(filePath: string): void {
  let stat
  try {
    // oxlint-disable-next-line socket/prefer-exists-sync -- need the mode bits, not existence
    stat = statSync(filePath)
  } catch {
    return
  }
  const mode = stat.mode & 0o777
  if ((mode & 0o200) === 0) {
    chmodSync(filePath, mode | 0o200)
  }
}

/**
 * Write `data` to a file in one call: lift any read-only cascade lock, write,
 * restore the prior mode (0444 stays 0444). A writable or missing target writes
 * untouched.
 *
 * This is the STANDARD writer for `scripts/fleet/**`, not a mirror-only
 * special case. A caller does not have to know whether its destination is a
 * cascade mirror, which is the knowledge that keeps going missing: a plain
 * writeFileSync EACCESes on a locked target, and the failure only surfaces on
 * the run where that particular file happens to be locked. Routing every write
 * through here removes the question.
 *
 * The cost on an unlocked target is one `statSync`; `chmod` runs only when the
 * file is actually locked. That is noise against the I/O these generators
 * already do, so there is no reason to reach for the raw `writeFileSync`.
 */
export function writeThroughMirrorLock(
  filePath: string,
  data: string | NodeJS.ArrayBufferView,
): void {
  withMirrorLockLiftedSync(filePath, () => writeFileSync(filePath, data))
}

/**
 * Sync twin of withMirrorLockLifted for writeFileSync-based generators
 * (build-hook-bundle, gen/hook-dispatch, the workspace-yaml sweep).
 */
export function withMirrorLockLiftedSync<T>(filePath: string, fn: () => T): T {
  let stat
  try {
    // oxlint-disable-next-line socket/prefer-exists-sync -- need the mode bits, not existence
    stat = statSync(filePath)
  } catch {
    stat = undefined
  }
  const mode = stat ? stat.mode & 0o777 : undefined
  const locked = mode !== undefined && (mode & 0o200) === 0
  if (locked) {
    chmodSync(filePath, mode | 0o200)
  }
  try {
    return fn()
  } finally {
    if (locked && mode !== undefined) {
      chmodSync(filePath, mode)
    }
  }
}
