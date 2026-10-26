import { promises as fs, mkdirSync, mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { logger } from '@socketsecurity/registry/lib/logger'

import {
  buildBazelStartupFlags,
  getBazelEnvironmentValue,
  spawnBazel,
} from './bazel-process.mts'
import { getErrorCause } from '../../../utils/errors.mts'

import type { BazelQueryOptions } from './bazel-query-runner.mts'

export function makeBazelOutputUserRoot(
  env: NodeJS.ProcessEnv,
  cwd: string,
): string {
  const parent = getBazelEnvironmentValue(env, 'SOCKET_BAZEL_OUTPUT_ROOT')
  const resolved = parent ? path.resolve(cwd, parent) : os.tmpdir()
  mkdirSync(resolved, { recursive: true })
  return mkdtempSync(path.join(resolved, 'socket-bazel-'))
}

export async function removeBazelTempdir(dir: string): Promise<boolean> {
  try {
    try {
      await fs.rm(dir, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 200,
      })
    } catch (e) {
      if (
        !(e instanceof Error) ||
        !('code' in e) ||
        !['EACCES', 'EPERM'].includes(String(e.code))
      ) {
        throw e
      }
      await makeDirectoriesWritable(dir)
      await fs.rm(dir, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 200,
      })
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
      if (!(e instanceof Error) || !('code' in e) || e.code !== 'ENOENT') {
        throw e
      }
    }
  }
}

export async function cleanUpBazelServer(
  opts: BazelQueryOptions,
): Promise<boolean> {
  if (!opts.outputUserRoot || opts.bazelOutputBase) {
    return true
  }
  try {
    await spawnBazel(opts.bin, [...buildBazelStartupFlags(opts), 'shutdown'], {
      cwd: opts.cwd,
      ...(opts.env ? { env: opts.env } : {}),
      signal: new AbortController().signal,
      timeout: 10_000,
    })
    return true
  } catch (error) {
    logger.warn(
      `Bazel shutdown failed in ${opts.cwd}. Keeping ${opts.outputUserRoot} for manual cleanup. ${getErrorCause(error)}`,
    )
    return false
  }
}
