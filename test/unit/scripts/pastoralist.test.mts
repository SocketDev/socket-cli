import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'

import { copyPastoralistAssets } from '../../../scripts/repo/cli-build/pastoralist.mts'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await safeDelete(temporaryDirectories.splice(0))
})

describe('copyPastoralistAssets', () => {
  it('copies the executable module closure and license', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pastoralist-assets-'))
    temporaryDirectories.push(root)
    const sourcePackage = path.join(root, 'source')
    const sourceDist = path.join(sourcePackage, 'dist')
    const packageRoot = path.join(root, 'package')
    await fs.mkdir(sourceDist, { recursive: true })
    const files = new Map([
      [path.join(sourcePackage, 'LICENSE'), 'Example license\n'],
      [
        path.join(sourcePackage, 'package.json'),
        '{"name":"pastoralist","type":"module"}\n',
      ],
      [
        path.join(sourceDist, 'index.js'),
        'import "./shared-a1.js"\nawait import("./command-b2.js")\n',
      ],
      [path.join(sourceDist, 'shared-a1.js'), 'export const value = 1\n'],
      [path.join(sourceDist, 'command-b2.js'), 'export const run = true\n'],
      [path.join(sourceDist, 'unused.js'), 'throw new Error("unused")\n'],
    ])
    for (const [file, contents] of files) {
      await fs.writeFile(file, contents)
    }

    const copied = await copyPastoralistAssets(packageRoot, {
      sourceEntry: path.join(sourceDist, 'index.js'),
    })

    expect(copied).toEqual(['command-b2.js', 'index.js', 'shared-a1.js'])
    const destination = path.join(packageRoot, 'dist', 'pastoralist')
    expect((await fs.readdir(destination)).toSorted()).toEqual([
      'LICENSE',
      'command-b2.js',
      'index.js',
      'package.json',
      'shared-a1.js',
    ])
  })
})
