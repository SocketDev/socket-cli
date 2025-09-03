import { promises as fs } from 'node:fs'
import path from 'node:path'

import { remove } from '@socketsecurity/registry/lib/fs'
import { parallelEach } from '@socketsecurity/registry/lib/streams'

import constants from '../constants.mts'
import { globStreamNodeModules } from './glob.mts'

export async function removeNodeModules(cwd = process.cwd()) {
  const stream = await globStreamNodeModules(cwd)
  await parallelEach(stream, p => remove(p, { force: true, recursive: true }), {
    concurrency: 8,
  })
}

export type FindUpOptions = {
  cwd?: string | undefined
  onlyDirectories?: boolean | undefined
  onlyFiles?: boolean | undefined
  signal?: AbortSignal | undefined
}

export async function findUp(
  name: string | string[],
  options?: FindUpOptions | undefined,
): Promise<string | undefined> {
  const opts = { __proto__: null, ...options }
  const { cwd = process.cwd(), signal = constants.abortSignal } = opts
  let { onlyDirectories = false, onlyFiles = true } = opts
  if (onlyFiles) {
    onlyDirectories = false
  }
  if (onlyDirectories) {
    onlyFiles = false
  }
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
        if (!onlyDirectories && (stats.isFile() || stats.isSymbolicLink())) {
          return filePath
        }
        if (!onlyFiles && stats.isDirectory()) {
          return filePath
        }
      } catch {}
    }
    dir = path.dirname(dir)
  }
  return undefined
}
