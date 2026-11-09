import { EventEmitter } from 'node:events'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { runEmbeddedJsTool } from '../runtime.mts'

import type { DlxOptions } from '../../utils/dlx.mts'
import type { EmbeddedToolRunResult } from '../runtime.mts'

export async function runCdxgen(
  projectPath: string,
  outputPath: string,
  options?: DlxOptions,
  beforeExit?: (() => Promise<void>) | undefined,
): Promise<{
  spawnPromise: Promise<EmbeddedToolRunResult> & { process: EventEmitter }
}> {
  const isolatedRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'socket-cdxgen-api-'),
  )
  try {
    const packageJson = JSON.parse(
      await fs.readFile(path.join(projectPath, 'package.json'), 'utf8'),
    ) as Record<string, unknown>
    if (typeof packageJson['name'] !== 'string' || !packageJson['name']) {
      // cdxgen otherwise uses the directory basename as its fallback project
      // name; retain the user's project identity while scanning the temp root.
      packageJson['name'] = path.basename(path.resolve(projectPath))
    }
    await Promise.all([
      fs.writeFile(
        path.join(isolatedRoot, 'package.json'),
        `${JSON.stringify(packageJson)}\n`,
      ),
      fs.copyFile(
        path.join(projectPath, 'package-lock.json'),
        path.join(isolatedRoot, 'package-lock.json'),
      ),
    ])
  } catch (error) {
    await fs.rm(isolatedRoot, { recursive: true, force: true })
    throw error
  }

  const process = new EventEmitter()
  const cleanTemp = async () =>
    await fs.rm(isolatedRoot, { recursive: true, force: true })
  const embeddedPromise = runEmbeddedJsTool('cdxgen', [], {
    cwd: options?.cwd,
    env: { CDXGEN_PLUGINS_DIR: 'plugins-empty' },
    inheritEnv: false,
    signal: options?.signal,
    stdio: options?.stdio,
    ipc: {
      projectPath: isolatedRoot,
      sourceRoot: path.resolve(projectPath),
      outputPath,
    },
  })
  const finalize = async (
    code: number | null,
    signal: NodeJS.Signals | null,
  ) => {
    const cleanupResults = await Promise.allSettled([
      cleanTemp(),
      Promise.resolve().then(async () => await beforeExit?.()),
    ])
    const cleanupErrors = cleanupResults.flatMap(result =>
      result.status === 'rejected' ? [result.reason] : [],
    )
    const failure =
      cleanupErrors.length === 0
        ? undefined
        : cleanupErrors.length === 1
          ? cleanupErrors[0]
          : new AggregateError(cleanupErrors, 'cdxgen cleanup failed')
    process.emit('exit', failure ? 1 : code, failure ? null : signal)
    if (failure) {
      throw failure
    }
  }
  const spawnPromise = embeddedPromise.then(
    async result => {
      await finalize(result.code, result.signal)
      return result
    },
    async error => {
      await finalize(1, null)
      throw error
    },
  ) as Promise<EmbeddedToolRunResult> & { process: EventEmitter }
  Object.defineProperty(spawnPromise, 'process', { value: process })
  return { spawnPromise }
}
