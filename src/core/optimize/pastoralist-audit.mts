import { readFileSync } from 'node:fs'
import { findPackageJSON } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { debug, debugDir } from '@socketsecurity/lib-stable/debug/output'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { rootPath } from '../../constants/paths.mts'
import { resolveNodeRuntime } from '../../util/spawn/node-runtime.mts'

const logger = getDefaultLogger()

export type PastoralistAuditResult = {
  ok: boolean
  reason?: string | undefined
}

export async function runPastoralistAudit(
  root: string,
): Promise<PastoralistAuditResult> {
  let binPath: string
  try {
    const manifest = findPackageJSON(
      'pastoralist',
      pathToFileURL(path.join(rootPath, 'package.json')),
    )
    if (!manifest) {
      return { ok: false, reason: 'pastoralist is not installed' }
    }
    const packageJson = JSON.parse(readFileSync(manifest, 'utf8')) as {
      bin: { pastoralist: string }
    }
    binPath = path.resolve(path.dirname(manifest), packageJson.bin.pastoralist)
  } catch (e) {
    debug('pastoralist is not resolvable from this checkout')
    debugDir(e)
    return { ok: false, reason: 'pastoralist is not installed' }
  }

  const runtime = await resolveNodeRuntime({ cwd: root })
  const result = await spawn(runtime.executable, [binPath, '--root', root], {
    env: runtime.environment,
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
