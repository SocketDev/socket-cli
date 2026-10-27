import { promises as fs, mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { logger } from '@socketsecurity/registry/lib/logger'

import {
  buildBazelStartupFlags,
  getBazelEnvironmentValue,
  spawnBazel,
} from './bazel-process.mts'
import { getErrorCause, isErrnoException } from '../../../utils/errors.mts'

import type { BazelQueryOptions } from './bazel-query-runner.mts'

export const BAZEL_OUTPUT_ROOT_PREFIX = 'socket-bazel-'

export function makeBazelOutputUserRoot(
  env: NodeJS.ProcessEnv,
  cwd: string,
): string {
  const parent = getBazelEnvironmentValue(env, 'SOCKET_BAZEL_OUTPUT_ROOT')
  const resolved = parent ? path.resolve(cwd, parent) : os.tmpdir()
  mkdirSync(resolved, { recursive: true })
  return mkdtempSync(path.join(resolved, BAZEL_OUTPUT_ROOT_PREFIX))
}

const RM_OPTIONS = {
  recursive: true,
  force: true,
  maxRetries: 5,
  retryDelay: 200,
}

export async function removeBazelTempdir(dir: string): Promise<boolean> {
  try {
    try {
      await fs.rm(dir, RM_OPTIONS)
    } catch (e) {
      if (!isErrnoException(e) || !['EACCES', 'EPERM'].includes(e.code ?? '')) {
        throw e
      }
      await makeDirectoriesWritable(dir)
      await fs.rm(dir, RM_OPTIONS)
    }
    return true
  } catch (error) {
    logger.warn(
      `Bazel temporary directory could not be removed: ${dir}. ${getErrorCause(error)}`,
    )
    return false
  }
}

async function makeDirectoriesWritable(root: string): Promise<void> {
  const pending = [root]
  while (pending.length) {
    const directory = pending.pop()
    if (!directory) {
      continue
    }
    try {
      // Repository rules can unpack read-only directories. Keep links to user files untouched.
      // eslint-disable-next-line no-await-in-loop
      const stat = await fs.lstat(directory)
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        continue
      }
      // eslint-disable-next-line no-await-in-loop
      await fs.chmod(directory, 0o700)
      // eslint-disable-next-line no-await-in-loop
      const entries = await fs.readdir(directory, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.isSymbolicLink()) {
          pending.push(path.join(directory, entry.name))
        }
      }
    } catch (e) {
      if (!isErrnoException(e) || e.code !== 'ENOENT') {
        throw e
      }
    }
  }
}

export async function cleanUpBazelOutputRoot(
  root: string,
  contexts: Map<string, BazelQueryOptions>,
): Promise<boolean> {
  await Promise.all(Array.from(contexts.values(), cleanUpBazelServer))
  return await removeBazelTempdir(root)
}

export async function cleanUpBazelServer(
  opts: BazelQueryOptions,
): Promise<void> {
  const root = opts.outputUserRoot
  if (!root) {
    return
  }
  const startupFlags = buildBazelStartupFlags(opts)
  const spawnOptions = {
    cwd: opts.cwd,
    ...(opts.env ? { env: opts.env } : {}),
    timeout: 10_000,
  }
  try {
    // Only this scan can have started a server whose install or output base is in its fresh root.
    // An rc file can point the scan at a caller's install and output base.
    const info = await spawnBazel(
      opts.bin,
      [...startupFlags, 'info', 'install_base', 'output_base'],
      spawnOptions,
    )
    if (
      !parseBazelInfoPaths(info.stdout).some(dir => isPathInside(dir, root))
    ) {
      return
    }
    await spawnBazel(opts.bin, [...startupFlags, 'shutdown'], spawnOptions)
  } catch (error) {
    logger.warn(`Bazel shutdown failed in ${opts.cwd}. ${getErrorCause(error)}`)
  }
}

function parseBazelInfoPaths(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map(line => line.slice(line.indexOf(': ') + 2).trim())
    .filter(Boolean)
}

function isPathInside(child: string, parent: string): boolean {
  const relative = path.relative(
    realpathSync.native(parent),
    realpathSync.native(child),
  )
  return (
    relative !== '' &&
    relative.split(path.sep)[0] !== '..' &&
    !path.isAbsolute(relative)
  )
}
