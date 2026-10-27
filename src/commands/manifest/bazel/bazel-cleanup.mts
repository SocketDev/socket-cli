import {
  existsSync,
  promises as fs,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

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

const SHUTDOWN_TIMEOUT_MS = 10_000
const SERVER_EXIT_TIMEOUT_MS = 5_000

export async function cleanUpBazelOutputRoot(
  root: string,
  contexts: Map<string, BazelQueryOptions>,
): Promise<boolean> {
  // Ctrl-C aborts the scan's signal while the CLI keeps running, and cleanup must still run.
  const signal = AbortSignal.timeout(3 * SHUTDOWN_TIMEOUT_MS)
  const servers = new Set(findServerPids(root))
  const shutDown = await Promise.all(
    Array.from(contexts.values(), opts => shutDownBazelServer(opts, signal)),
  )
  for (const pid of shutDown) {
    if (pid !== undefined) {
      servers.add(pid)
    }
  }
  const stopped = await Promise.all(Array.from(servers, stopBazelServer))
  if (!stopped.every(Boolean)) {
    logger.warn(
      `Bazel output root kept because its server is still running: ${root}`,
    )
    return false
  }
  return await removeBazelTempdir(root)
}

// Returns the pid of a server this scan owns, read before shutdown removes its pid file.
export async function shutDownBazelServer(
  opts: BazelQueryOptions,
  signal: AbortSignal,
): Promise<number | undefined> {
  const root = opts.outputUserRoot
  if (!root) {
    return undefined
  }
  const startupFlags = buildBazelStartupFlags(opts)
  const spawnOptions = {
    cwd: opts.cwd,
    ...(opts.env ? { env: opts.env } : {}),
    signal,
    timeout: SHUTDOWN_TIMEOUT_MS,
  }
  let pid: number | undefined
  try {
    // Only this scan can have started a server whose install or output base is in its fresh root.
    // An rc file can point the scan at a caller's install and output base.
    const info = await spawnBazel(
      opts.bin,
      [...startupFlags, 'info', 'install_base', 'output_base'],
      spawnOptions,
    )
    const bases = parseBazelInfo(info.stdout)
    const outputBase = bases.get('output_base')
    if (
      !outputBase ||
      ![bases.get('install_base'), outputBase].some(
        dir => dir && isPathInside(dir, root),
      )
    ) {
      return undefined
    }
    pid = readServerPid(outputBase)
    await spawnBazel(opts.bin, [...startupFlags, 'shutdown'], spawnOptions)
  } catch (error) {
    logger.warn(`Bazel shutdown failed in ${opts.cwd}. ${getErrorCause(error)}`)
  }
  return pid
}

function findServerPids(root: string): number[] {
  if (!existsSync(root)) {
    return []
  }
  const pids: number[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const pid = entry.isDirectory()
      ? readServerPid(path.join(root, entry.name))
      : undefined
    if (pid !== undefined) {
      pids.push(pid)
    }
  }
  return pids
}

function readServerPid(outputBase: string): number | undefined {
  let contents: string
  try {
    contents = readFileSync(
      path.join(outputBase, 'server', 'server.pid.txt'),
      'utf8',
    )
  } catch (e) {
    if (isErrnoException(e) && e.code === 'ENOENT') {
      return undefined
    }
    throw e
  }
  const pid = Number(contents.trim())
  return Number.isSafeInteger(pid) && pid > 0 && isProcessAlive(pid)
    ? pid
    : undefined
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return isErrnoException(e) && e.code === 'EPERM'
  }
}

async function waitForProcessExit(pid: number): Promise<boolean> {
  const deadline = Date.now() + SERVER_EXIT_TIMEOUT_MS
  while (isProcessAlive(pid)) {
    if (Date.now() >= deadline) {
      return false
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(100)
  }
  return true
}

// A shutdown that exits successfully can still leave the server running, for example with
// `shutdown --iff_heap_size_greater_than` in an rc file.
async function stopBazelServer(pid: number): Promise<boolean> {
  if (await waitForProcessExit(pid)) {
    return true
  }
  try {
    process.kill(pid, 'SIGKILL')
  } catch (e) {
    if (!isErrnoException(e) || e.code !== 'ESRCH') {
      logger.warn(
        `Bazel server ${pid} could not be stopped. ${getErrorCause(e)}`,
      )
      return false
    }
  }
  return await waitForProcessExit(pid)
}

function parseBazelInfo(stdout: string): Map<string, string> {
  const values = new Map<string, string>()
  for (const line of stdout.split(/\r?\n/)) {
    const separator = line.indexOf(': ')
    if (separator > 0) {
      values.set(line.slice(0, separator), line.slice(separator + 2).trim())
    }
  }
  return values
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
