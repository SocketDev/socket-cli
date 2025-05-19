import { promises as fs, readFileSync as fsReadFileSync } from 'node:fs'
import path from 'node:path'

import { remove } from '@socketsecurity/registry/lib/fs'

import constants from '../constants.mts'
import { globNodeModules } from './glob.mts'

import type { Remap } from '@socketsecurity/registry/lib/objects'
import type { Abortable } from 'node:events'
import type {
  ObjectEncodingOptions,
  OpenMode,
  PathLike,
  PathOrFileDescriptor,
} from 'node:fs'
import type { FileHandle } from 'node:fs/promises'

const { abortSignal } = constants

export async function removeNodeModules(cwd = process.cwd()) {
  const nodeModulesPaths = await globNodeModules(cwd)
  await Promise.all(nodeModulesPaths.map(p => remove(p)))
}

export type FindUpOptions = {
  cwd?: string | undefined
  signal?: AbortSignal | undefined
}

export async function findUp(
  name: string | string[],
  { cwd = process.cwd(), signal = abortSignal }: FindUpOptions,
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
    signal: abortSignal,
    ...options,
    encoding: 'binary',
  } as ReadFileOptions)) as Buffer
}

export async function readFileUtf8(
  filepath: PathLike | FileHandle,
  options?: ReadFileOptions | undefined,
): Promise<string> {
  return await fs.readFile(filepath, {
    signal: abortSignal,
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
      signal: abortSignal,
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
): ReturnType<typeof fsReadFileSync> | undefined {
  try {
    return fsReadFileSync(filepath, {
      encoding: 'utf8',
      ...(typeof options === 'string' ? { encoding: options } : options),
    })
  } catch {}
  return undefined
}
