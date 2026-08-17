/**
 * Pastoralist override audit for the optimize command. Runs pastoralist's
 * update pipeline against the project so stale package-manager overrides get
 * the review record (and pruning) pastoralist maintains, before socket's own
 * @socketregistry overrides are applied.
 *
 * Key Functions: - runPastoralistAudit: spawn the pinned pastoralist bin
 * against the project root, never failing the optimize run on its errors.
 *
 * Spawned (not imported) for the same reason the package-manager agents are:
 * the dependency stays out of the CLI's CJS bundle (pastoralist's dist uses
 * top-level await, which rolldown cannot emit as CJS) while the lockfile
 * still pins the exact audited version.
 */

import { fileURLToPath } from 'node:url'

import { debug, debugDir } from '@socketsecurity/lib-stable/debug/output'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

export type PastoralistAuditResult = {
  ok: boolean
  reason?: string | undefined
}

/**
 * Run pastoralist's override audit against `root`: its update flow writes
 * the override review appendix and prunes overrides whose reason is gone.
 * Errors are logged and swallowed — an audit miss must never block the
 * optimization it precedes.
 */
export async function runPastoralistAudit(
  root: string,
): Promise<PastoralistAuditResult> {
  const logger = getDefaultLogger()

  let binPath: string
  try {
    // pastoralist's exports map carries only an `import` condition for `.`
    // (dist/index.js, the bin), so the import-condition resolver finds it
    // where a require-resolve cannot.
    binPath = fileURLToPath(import.meta.resolve('pastoralist'))
  } catch (e) {
    debug('pastoralist is not resolvable from this checkout')
    debugDir(e)
    return { ok: false, reason: 'pastoralist is not installed' }
  }

  const result = await spawn('node', [binPath, '--root', root], {
    cwd: root,
    stdio: 'inherit',
  })
  if (result.code !== 0) {
    debug(`pastoralist audit exited ${String(result.code)}`)
    return {
      ok: false,
      reason: `pastoralist exited ${String(result.code)}`,
    }
  }
  logger.info('Pastoralist override audit complete.')
  return { ok: true }
}
