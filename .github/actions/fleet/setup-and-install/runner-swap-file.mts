import { constants } from 'node:fs'
import type { Stats } from 'node:fs'
import {
  lstat,
  mkdtemp,
  open,
  realpath,
  rmdir,
  statfs,
  unlink,
} from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import os from 'node:os'
import nodePath from 'node:path'
import process from 'node:process'

import { selectRunnerResourceScratch } from './runner-resource-runtime.mts'
import type { RunnerResourceScratch } from './runner-resource-runtime.mts'

export const RUNNER_SWAP_HEADER_ALLOWANCE = 65_536
export const RUNNER_SWAP_LIMIT = 8 * 1024 ** 3

export type OwnedSwap = {
  path: string
  directory: string
  device: number
  inode: number
  bytes: number
}

export type RunnerResourceDisk = {
  mount: string
  path: string
  device: number
  availableBytes: number
  filesystemType: number
}

export function refuseRunnerResource(reason: string): never {
  throw new Error(
    `Runner resource preparation failed. Where: hosted Linux setup. Saw ${reason}; wanted verified memory and swap capacity. Fix: use a runner with sufficient resources and a visible cgroup v2 hierarchy.`,
  )
}

function validRunnerSwapFile(
  file: Stats,
  swap: OwnedSwap,
  uid: number,
): boolean {
  return (
    file.isFile() &&
    file.uid === uid &&
    (file.mode & 0o777) === 0o600 &&
    file.nlink === 1 &&
    file.dev === swap.device &&
    file.ino === swap.inode &&
    file.size === swap.bytes &&
    file.blocks * 512 >= file.size
  )
}

export async function validateRunnerSwap(swap: OwnedSwap): Promise<void> {
  const directory = await lstat(swap.directory)
  const file = await lstat(swap.path)
  const uid = process.getuid?.()
  if (
    uid === undefined ||
    uid === 0 ||
    !directory.isDirectory() ||
    directory.uid !== uid ||
    (directory.mode & 0o777) !== 0o700 ||
    !validRunnerSwapFile(file, swap, uid) ||
    (await realpath(swap.directory)) !== swap.directory ||
    nodePath.dirname(swap.path) !== swap.directory
  ) {
    refuseRunnerResource('unsafe owned swap file')
  }
}

async function writeRunnerSwap(
  descriptor: FileHandle,
  bytes: number,
  deadline: number,
  now: () => number,
): Promise<void> {
  const buffer = Buffer.alloc(Math.min(1024 ** 2, bytes))
  let written = 0
  while (written < bytes) {
    if (now() >= deadline) {
      refuseRunnerResource('expired swap allocation deadline')
    }
    const result = await descriptor.write(
      buffer,
      0,
      Math.min(buffer.length, bytes - written),
      written,
    )
    if (!result.bytesWritten) {
      refuseRunnerResource('incomplete swap allocation')
    }
    written += result.bytesWritten
  }
  await descriptor.sync()
  if (now() >= deadline) {
    refuseRunnerResource('expired swap allocation deadline')
  }
}

export async function createRunnerSwap(
  bytes: number,
  now = performance.now.bind(performance),
  temporaryDirectory = os.tmpdir(),
): Promise<OwnedSwap> {
  if (
    !Number.isSafeInteger(bytes) ||
    bytes < RUNNER_SWAP_HEADER_ALLOWANCE ||
    bytes > RUNNER_SWAP_LIMIT
  ) {
    refuseRunnerResource('invalid swap allocation size')
  }
  if (process.getuid?.() === 0) {
    refuseRunnerResource('privileged allocation identity')
  }
  const deadline = now() + 120_000
  const directory = await mkdtemp(
    nodePath.join(await realpath(temporaryDirectory), 'fleet-runner-swap-'),
  )
  const path = nodePath.join(directory, 'swapfile')
  let created: { dev: number; ino: number } | undefined
  try {
    const descriptor = await open(
      path,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_RDWR |
        constants.O_NOFOLLOW,
      0o600,
    )
    try {
      // oxlint-disable-next-line socket/prefer-exists-sync -- inode identity
      const { dev, ino } = await descriptor.stat()
      created = { dev, ino }
      await writeRunnerSwap(descriptor, bytes, deadline, now)
      const stat = await descriptor.stat()
      const swap = { path, directory, device: stat.dev, inode: stat.ino, bytes }
      await validateRunnerSwap(swap)
      return swap
    } finally {
      await descriptor.close()
    }
  } catch {
    if (created) {
      const directoryStat = await lstat(directory)
      const file = await lstat(path)
      if (
        !directoryStat.isDirectory() ||
        (await realpath(directory)) !== directory ||
        !file.isFile() ||
        file.dev !== created.dev ||
        file.ino !== created.ino
      ) {
        refuseRunnerResource('unsafe allocation cleanup')
      }
      // oxlint-disable-next-line socket/prefer-safe-delete -- nonrecursive
      await unlink(path)
    }
    // oxlint-disable-next-line socket/prefer-safe-delete -- empty directory
    await rmdir(directory)
    return refuseRunnerResource('failed unprivileged swap allocation')
  }
}

export function createRunnerResourceStorage(candidates: string[]): {
  freeDisk: () => Promise<RunnerResourceDisk>
  create: (bytes: number) => Promise<OwnedSwap>
} {
  let scratch: RunnerResourceScratch | undefined
  return {
    async freeDisk() {
      if (!scratch) {
        scratch = await selectRunnerResourceScratch(candidates)
      }
      const stats = await statfs(scratch.path, { bigint: true })
      const availableBytes = Number(stats.bavail * stats.bsize)
      const filesystemType = Number(stats.type)
      if (
        !Number.isSafeInteger(availableBytes) ||
        availableBytes < 0 ||
        !Number.isSafeInteger(filesystemType)
      ) {
        refuseRunnerResource('invalid runner temporary directory capacity')
      }
      return {
        __proto__: null,
        mount: scratch.mount,
        path: scratch.path,
        device: scratch.device,
        availableBytes,
        filesystemType,
      }
    },
    async create(bytes) {
      if (!scratch) {
        refuseRunnerResource('unmeasured runner temporary directory')
      }
      const stat = await lstat(scratch.path)
      if (
        !stat.isDirectory() ||
        stat.dev !== scratch.device ||
        stat.ino !== scratch.inode ||
        (await realpath(scratch.path)) !== scratch.path
      ) {
        refuseRunnerResource('changed runner temporary directory')
      }
      return createRunnerSwap(bytes, undefined, scratch.path)
    },
  }
}
