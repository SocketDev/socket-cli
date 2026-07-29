/**
 * Regression fixture for a hostile checkout that ships its own tool shims.
 *
 * Purpose: the CLI runs with its working directory inside a repository it did
 * not author. This builds that repository — `git`, `node`, `npm`, `tar`, and
 * `sbt` shims in the checkout root, in a `bin/` directory, and in
 * `node_modules/.bin`, with all three directories ahead of the system directory
 * on PATH — and asserts the resolver never hands any of them back.
 *
 * Test Coverage:
 *
 * - Every shadowed tool resolves to the system copy.
 * - The search path handed to the child names only the system directory.
 * - A tool present only in the checkout does not resolve at all.
 *
 * Related Files:
 *
 * - Src/util/spawn/system-tool.mts (implementation)
 * - Src/util/trusted-executable.mts (the resolver it wraps)
 *
 * The fixture is real files under the OS temp dir: the resolver decides on
 * realpath canonicalization, which an fs mock would erase. One checkout is
 * built for the whole file, so the cost is a handful of writes.
 */

import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'

import {
  clearSystemToolCache,
  findSystemTool,
} from '../../../../src/util/spawn/system-tool.mts'

// The exec bit only gates access() on POSIX; Windows reports every readable
// file as executable, so the system-copy assertions run on POSIX alone.
const EXEC_BIT_IS_ENFORCED = process.platform !== 'win32'

const SHADOWED_TOOLS = ['git', 'node', 'npm', 'sbt', 'tar']

let baseDir = ''
let checkoutRoot = ''
let searchPath = ''
let shimDirs: string[] = []
let systemBin = ''

function writeExecutable(dir: string, name: string): string {
  const filePath = path.join(dir, name)
  writeFileSync(filePath, '#!/bin/sh\nexit 0\n')
  chmodSync(filePath, 0o755)
  return filePath
}

beforeAll(() => {
  baseDir = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), 'socket-hostile-checkout-')),
  )
  checkoutRoot = path.join(baseDir, 'checkout')
  systemBin = path.join(baseDir, 'usr', 'bin')
  const checkoutBin = path.join(checkoutRoot, 'bin')
  const shadowBin = path.join(checkoutRoot, 'node_modules', '.bin')
  shimDirs = [checkoutRoot, checkoutBin, shadowBin]

  mkdirSync(path.join(checkoutRoot, '.git'), { recursive: true })
  mkdirSync(checkoutBin, { recursive: true })
  mkdirSync(shadowBin, { recursive: true })
  mkdirSync(systemBin, { recursive: true })

  for (let i = 0, { length } = shimDirs; i < length; i += 1) {
    const dir = shimDirs[i]!
    for (let i = 0, { length } = SHADOWED_TOOLS; i < length; i += 1) {
      const tool = SHADOWED_TOOLS[i]!
      writeExecutable(dir, tool)
    }
  }
  for (let i = 0, { length } = SHADOWED_TOOLS; i < length; i += 1) {
    const tool = SHADOWED_TOOLS[i]!
    writeExecutable(systemBin, tool)
  }
  // The checkout's own directories come first, the way a poisoned `.envrc` or
  // a `npm run` script would order them.
  searchPath = [...shimDirs, systemBin].join(path.delimiter)
})

afterAll(async () => {
  clearSystemToolCache()
  await safeDelete(baseDir)
})

beforeEach(() => {
  clearSystemToolCache()
})

describe('a checkout that ships its own tool shims', () => {
  it.skipIf(!EXEC_BIT_IS_ENFORCED).each(SHADOWED_TOOLS)(
    'never spawns the checkout copy of %s',
    async tool => {
      const resolution = await findSystemTool(tool, {
        cwd: checkoutRoot,
        env: { PATH: searchPath },
      })

      expect(resolution?.executable).toBe(path.join(systemBin, tool))
      for (let i = 0, { length } = shimDirs; i < length; i += 1) {
        const dir = shimDirs[i]!
        expect(resolution?.executable).not.toContain(dir)
      }
    },
  )

  it.skipIf(!EXEC_BIT_IS_ENFORCED)(
    'hands the child a search path holding only the system directory',
    async () => {
      const resolution = await findSystemTool('git', {
        cwd: checkoutRoot,
        env: { PATH: searchPath },
      })

      expect(resolution?.searchPath).toBe(systemBin)
    },
  )

  it.skipIf(!EXEC_BIT_IS_ENFORCED)(
    'resolves from a nested working directory too',
    async () => {
      const nested = path.join(checkoutRoot, 'packages', 'app')
      mkdirSync(nested, { recursive: true })

      const resolution = await findSystemTool('node', {
        cwd: nested,
        env: { PATH: searchPath },
      })

      expect(resolution?.executable).toBe(path.join(systemBin, 'node'))
    },
  )

  it('refuses a tool the checkout is the only source of', async () => {
    writeExecutable(checkoutRoot, 'socket-only-in-checkout')

    const resolution = await findSystemTool('socket-only-in-checkout', {
      cwd: checkoutRoot,
      env: { PATH: searchPath },
    })

    expect(resolution).toBeUndefined()
  })
})
