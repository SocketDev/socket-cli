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
