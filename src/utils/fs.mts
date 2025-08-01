import { existsSync, promises as fs, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { remove } from '@socketsecurity/registry/lib/fs'
import { pEach } from '@socketsecurity/registry/lib/promises'

import constants from '../constants.mts'
import { globNodeModules } from './glob.mts'

import type { Remap } from '@socketsecurity/registry/lib/objects'
import type { Abortable } from 'node:events'
import type {
  BigIntStats,
  ObjectEncodingOptions,
  OpenMode,
  PathLike,
  PathOrFileDescriptor,
  StatSyncOptions,
  Stats,
} from 'node:fs'
import type { FileHandle } from 'node:fs/promises'

export async function removeNodeModules(cwd = process.cwd()) {
  const nodeModulesPaths = await globNodeModules(cwd)
  await pEach(
    nodeModulesPaths,
    3,
    p => remove(p, { force: true, recursive: true }),
    { retries: 3 },
  )
}

export type FindUpOptions = {
  cwd?: string | undefined
  signal?: AbortSignal | undefined
}

export async function findUp(
  name: string | string[],
  {
    cwd = process.cwd(),
    // Lazily access constants.abortSignal.
    signal = constants.abortSignal,
  }: FindUpOptions,
): Promise<string | undefined> {
  let dir = path.resolve(cwd)
  const { root } = path.parse(dir)
  const names = [name].flat()
  while (dir && dir !== root) {
    for (const name of names) {
      if (signal?.aborted) {
        return undefined
      }
      const filePath = path.join(dir, name)
      try {
        // eslint-disable-next-line no-await-in-loop
        const stats = await fs.stat(filePath)
        if (stats.isFile()) {
          return filePath
        }
      } catch {}
    }
    dir = path.dirname(dir)
  }
  return undefined
}

export function isDirectorySync(filepath: string): boolean {
  return existsSync(filepath) && !!safeStatsSync(filepath)?.isDirectory()
}

export type ReadFileOptions = Remap<
  ObjectEncodingOptions &
    Abortable & {
      flag?: OpenMode | undefined
    }
>

export async function readFileBinary(
  filepath: PathLike | FileHandle,
  options?: ReadFileOptions | undefined,
): Promise<Buffer> {
  return (await fs.readFile(filepath, {
    // Lazily access constants.abortSignal.
    signal: constants.abortSignal,
    ...options,
    encoding: 'binary',
  } as ReadFileOptions)) as Buffer
}

export async function readFileUtf8(
  filepath: PathLike | FileHandle,
  options?: ReadFileOptions | undefined,
): Promise<string> {
  return await fs.readFile(filepath, {
    // Lazily access constants.abortSignal.
    signal: constants.abortSignal,
    ...options,
    encoding: 'utf8',
  })
}

export async function safeReadFile(
  filepath: PathLike | FileHandle,
  options?: 'utf8' | 'utf-8' | { encoding: 'utf8' | 'utf-8' } | undefined,
): Promise<string | undefined>

export async function safeReadFile(
  filepath: PathLike | FileHandle,
  options?: ReadFileOptions | NodeJS.BufferEncoding | undefined,
): Promise<Awaited<ReturnType<typeof fs.readFile>> | undefined> {
  try {
    return await fs.readFile(filepath, {
      encoding: 'utf8',
      // Lazily access constants.abortSignal.
      signal: constants.abortSignal,
      ...(typeof options === 'string' ? { encoding: options } : options),
    })
  } catch {}
  return undefined
}

export function safeReadFileSync(
  filepath: PathOrFileDescriptor,
  options?: 'utf8' | 'utf-8' | { encoding: 'utf8' | 'utf-8' } | undefined,
): string | undefined

export function safeReadFileSync(
  filepath: PathOrFileDescriptor,
  options?:
    | {
        encoding?: NodeJS.BufferEncoding | undefined
        flag?: string | undefined
      }
    | NodeJS.BufferEncoding
    | undefined,
): ReturnType<typeof readFileSync> | undefined {
  try {
    return readFileSync(filepath, {
      encoding: 'utf8',
      ...(typeof options === 'string' ? { encoding: options } : options),
    })
  } catch {}
  return undefined
}

export function safeStatsSync(
  filepath: PathLike,
  options?: undefined,
): Stats | undefined

export function safeStatsSync(
  filepath: PathLike,
  options?: StatSyncOptions & {
    bigint?: false | undefined
  },
): Stats | undefined

export function safeStatsSync(
  filepath: PathLike,
  options: StatSyncOptions & {
    bigint: true
  },
): BigIntStats | undefined

export function safeStatsSync(
  filepath: PathLike,
  options: StatSyncOptions & {
    bigint: boolean
  },
): Stats | BigIntStats | undefined

export function safeStatsSync(
  filepath: PathLike,
  options?: StatSyncOptions,
): Stats | BigIntStats | undefined {
  try {
    return statSync(filepath, { throwIfNoEntry: false, ...options })
  } catch {}
  return undefined
}
