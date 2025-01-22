import {
  promises as fs,
  existsSync as fsExistsSync,
  readFileSync as fsReadFileSync
} from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import type { Abortable } from 'node:events'
import type { ObjectEncodingOptions, OpenMode, PathLike } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'

export async function findUp(
  name: string | string[],
  { cwd = process.cwd() }: { cwd: string | undefined }
): Promise<string | undefined> {
  let dir = path.resolve(cwd)
  const { root } = path.parse(dir)
  const names = [name].flat()
  while (dir && dir !== root) {
    for (const name of names) {
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

export type ReadFileOptions = ObjectEncodingOptions &
  Abortable & {
    flag?: OpenMode | undefined
  }

export async function readFileBinary(
  filepath: PathLike | FileHandle,
  options?: ReadFileOptions
): Promise<Buffer> {
  return <Buffer>await fs.readFile(filepath, <ReadFileOptions>{
    ...options,
    encoding: 'binary'
  })
}

export async function readFileUtf8(
  filepath: PathLike | FileHandle,
  options?: ReadFileOptions
): Promise<string> {
  return <string>await fs.readFile(filepath, <ReadFileOptions>{
    ...options,
    encoding: 'utf8'
  })
}

export function safeExistsSync(filepath: PathLike | undefined): boolean {
  try {
    return filepath ? fsExistsSync(filepath) : false
  } catch {}
  return false
}

export function safeReadFile(
  ...args: Parameters<typeof fs.readFile>
): ReturnType<typeof fs.readFile> | undefined {
  try {
    return fs.readFile(...args)
  } catch {}
  return undefined
}

export function safeReadFileSync(
  ...args: Parameters<typeof fsReadFileSync>
): ReturnType<typeof fsReadFileSync> | undefined {
  try {
    return fsReadFileSync(...args)
  } catch {}
  return undefined
}
