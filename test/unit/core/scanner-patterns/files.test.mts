import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, expect, it } from 'vitest'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'

import {
  discoverScannerPatternFiles,
  readScannerPatternText,
} from '../../../../src/core/scanner-patterns/files.mts'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.allSettled(temporaryDirectories.splice(0).map(safeDelete))
})

async function createFixture(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'scanner-patterns-'))
  temporaryDirectories.push(directory)
  await mkdir(path.join(directory, '.github', 'workflows'), { recursive: true })
  await mkdir(path.join(directory, 'node_modules', 'example-package'), {
    recursive: true,
  })
  await writeFile(
    path.join(directory, '.github', 'workflows', 'ci.yml'),
    'name: CI',
  )
  await writeFile(path.join(directory, 'example.txt'), 'hello')
  await writeFile(
    path.join(directory, 'node_modules', 'example-package', 'ignored.txt'),
    'ignored',
  )
  return directory
}

it('discovers scanner-specific files and excludes dependency trees', async () => {
  const directory = await createFixture()
  expect(
    await discoverScannerPatternFiles('workflows', ['.'], directory),
  ).toEqual([path.join(directory, '.github', 'workflows', 'ci.yml')])
  expect(
    await discoverScannerPatternFiles('secrets', ['.'], directory),
  ).toEqual([
    path.join(directory, '.github', 'workflows', 'ci.yml'),
    path.join(directory, 'example.txt'),
  ])
})

it('accepts direct files and skips binary content', async () => {
  const directory = await createFixture()
  const textFile = path.join(directory, 'example.txt')
  const binaryFile = path.join(directory, 'example.bin')
  await writeFile(binaryFile, Buffer.from([0, 1, 2]))
  expect(
    await discoverScannerPatternFiles('skills', [textFile], directory),
  ).toEqual([textFile])
  expect(await readScannerPatternText(textFile)).toBe('hello')
  expect(await readScannerPatternText(binaryFile)).toBeUndefined()
})

it('skips files larger than the scanner limit', async () => {
  const directory = await createFixture()
  const largeFile = path.join(directory, 'large.txt')
  await writeFile(largeFile, Buffer.alloc(1024 * 1024 + 1, 65))
  expect(await readScannerPatternText(largeFile)).toBeUndefined()
})
