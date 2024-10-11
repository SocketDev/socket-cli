import { existsSync as existsSync_, promises as fs } from 'node:fs'
import path from 'node:path'

import type { Abortable } from 'node:events'
import type { Mode, ObjectEncodingOptions, OpenMode, PathLike } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'

export function existsSync(filepath: any): filepath is PathLike {
  try {
    return filepath ? existsSync_(filepath) : false
  } catch {}
  return false
}

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

export type WriteFileData = Parameters<typeof fs.writeFile>[1]

export type WriteFileOptions = ObjectEncodingOptions & {
  mode?: Mode | undefined
  flag?: OpenMode | undefined
  flush?: boolean | undefined
} & Abortable

export async function writeFileUtf8(
  filepath: PathLike | FileHandle,
  data: WriteFileData,
  options?: WriteFileOptions
): Promise<void> {
  await fs.writeFile(filepath, data, <WriteFileOptions>{
    ...options,
    encoding: 'utf8'
  })
}
