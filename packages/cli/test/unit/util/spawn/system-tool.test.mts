/**
 * Unit tests for trusted system-tool resolution.
 *
 * Purpose: prove that a bare tool name never resolves to an executable the
 * scanned checkout supplies, and that the environment handed to the child
 * carries a PATH the checkout cannot reach either.
 *
 * Test Coverage:
 *
 * - A repository-local shim loses to the system copy of the same tool.
 * - The lookup directory that served a repository-local hit is stripped from the
 *   returned search path.
 * - A tool that exists only inside the checkout does not resolve at all.
 * - Resolution is memoized per tool, protected root, and PATH.
 * - `buildSystemToolEnv` pins PATH and collapses a lowercase `Path` key.
 * - `describeSystemToolFailure` names the tool, the directory, the protected
 *   root, and the fix.
 *
 * Related Files: - src/util/spawn/system-tool.mts (implementation)
 *
 * Fixtures are real directories under the OS temp dir with real executables;
 * mocking `fs` would mock away the realpath canonicalization the module is
 * built on.
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

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'

import {
  buildSystemToolEnv,
  clearSystemToolCache,
  describeSystemToolFailure,
  findSystemTool,
} from '../../../../src/util/spawn/system-tool.mts'

// The exec bit only gates access() on POSIX; Windows reports every readable
// file as executable, so the shim fixtures behave differently there.
const EXEC_BIT_IS_ENFORCED = process.platform !== 'win32'

const TOOL_NAME = 'socket-fake-tool'

const tempDirs: string[] = []

type ToolFixture = {
  repoBin: string
  repoRoot: string
  searchPath: string
  systemBin: string
  systemTool: string
}

/**
 * A checkout that ships its own copy of `TOOL_NAME` in a directory it also put
 * on PATH, ahead of the system directory holding the real one.
 */
function makeShadowedToolFixture(): ToolFixture {
  const base = makeTempDir()
  const repoRoot = path.join(base, 'checkout')
  const repoBin = path.join(repoRoot, 'bin')
  const systemBin = path.join(base, 'usr', 'bin')
  mkdirSync(path.join(repoRoot, '.git'), { recursive: true })
  mkdirSync(repoBin, { recursive: true })
  mkdirSync(systemBin, { recursive: true })
  writeExecutable(repoBin, TOOL_NAME)
  const systemTool = writeExecutable(systemBin, TOOL_NAME)
  return {
    repoBin,
    repoRoot,
    searchPath: [repoBin, systemBin].join(path.delimiter),
    systemBin,
    systemTool,
  }
}

function makeTempDir(): string {
  const dir = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), 'socket-system-tool-')),
  )
  tempDirs.push(dir)
  return dir
}

function writeExecutable(dir: string, name: string): string {
  const filePath = path.join(dir, name)
  writeFileSync(filePath, '#!/bin/sh\nexit 0\n')
  chmodSync(filePath, 0o755)
  return filePath
}

beforeEach(() => {
  clearSystemToolCache()
})

afterEach(async () => {
  clearSystemToolCache()
  const dirs = tempDirs.splice(0)
  for (let i = 0, { length } = dirs; i < length; i += 1) {
    await safeDelete(dirs[i]!)
  }
})

describe('buildSystemToolEnv', () => {
  it('pins PATH to the sanitized search path', () => {
    const result = buildSystemToolEnv(
      { HOME: '/home/user', PATH: '/checkout/bin:/usr/bin' },
      '/usr/bin',
    )

    expect(result).toStrictEqual({ HOME: '/home/user', PATH: '/usr/bin' })
  })

  it('replaces a lowercase path key rather than leaving both', () => {
    expect(
      buildSystemToolEnv({ Path: '/checkout/bin' }, '/usr/bin'),
    ).toStrictEqual({ PATH: '/usr/bin' })
  })

  it('leaves the source environment untouched', () => {
    const env = { PATH: '/checkout/bin' }
    buildSystemToolEnv(env, '/usr/bin')

    expect(env).toStrictEqual({ PATH: '/checkout/bin' })
  })
})

describe('describeSystemToolFailure', () => {
  it('names the tool, the directory, the protected root, and the fix', async () => {
    const { repoRoot } = makeShadowedToolFixture()

    const message = await describeSystemToolFailure('tar', {
      cwd: path.join(repoRoot, 'packages', 'app'),
      installHint: 'Install tar and re-run.',
    })

    expect(message).toContain('Cannot resolve a trusted tar executable.')
    expect(message).toContain(repoRoot)
    expect(message).toContain('Install tar and re-run.')
  })

  it('falls back to a generic install instruction', async () => {
    const { repoRoot } = makeShadowedToolFixture()

    const message = await describeSystemToolFailure('sbt', { cwd: repoRoot })

    expect(message).toContain(
      'Install sbt outside the repository and put its directory on PATH.',
    )
  })
})

describe('findSystemTool', () => {
  it.skipIf(!EXEC_BIT_IS_ENFORCED)(
    'skips the checkout shim and resolves the system copy',
    async () => {
      const { repoRoot, searchPath, systemTool } = makeShadowedToolFixture()

      const resolution = await findSystemTool(TOOL_NAME, {
        cwd: repoRoot,
        env: { PATH: searchPath },
      })

      expect(resolution?.executable).toBe(systemTool)
    },
  )

  it.skipIf(!EXEC_BIT_IS_ENFORCED)(
    'strips the checkout directory from the search path handed to the child',
    async () => {
      const { repoBin, repoRoot, searchPath, systemBin } =
        makeShadowedToolFixture()

      const resolution = await findSystemTool(TOOL_NAME, {
        cwd: repoRoot,
        env: { PATH: searchPath },
      })

      expect(resolution?.searchPath).toBe(systemBin)
      expect(resolution?.searchPath).not.toContain(repoBin)
    },
  )

  it.skipIf(!EXEC_BIT_IS_ENFORCED)(
    'protects the outermost checkout, not the nested one',
    async () => {
      const { repoRoot, searchPath, systemTool } = makeShadowedToolFixture()
      const nested = path.join(repoRoot, 'vendor', 'inner')
      mkdirSync(path.join(nested, '.git'), { recursive: true })

      const resolution = await findSystemTool(TOOL_NAME, {
        cwd: nested,
        env: { PATH: searchPath },
      })

      expect(resolution?.executable).toBe(systemTool)
    },
  )

  it('returns undefined when the tool exists only inside the checkout', async () => {
    const { repoBin, repoRoot } = makeShadowedToolFixture()

    const resolution = await findSystemTool(TOOL_NAME, {
      cwd: repoRoot,
      env: { PATH: repoBin },
    })

    expect(resolution).toBeUndefined()
  })

  it('returns undefined when PATH is empty rather than falling back to the bare name', async () => {
    const { repoRoot } = makeShadowedToolFixture()

    const resolution = await findSystemTool(TOOL_NAME, {
      cwd: repoRoot,
      env: {},
    })

    expect(resolution).toBeUndefined()
  })

  it.skipIf(!EXEC_BIT_IS_ENFORCED)(
    're-resolves when PATH changes',
    async () => {
      const first = makeShadowedToolFixture()
      const second = makeShadowedToolFixture()

      const fromFirst = await findSystemTool(TOOL_NAME, {
        cwd: first.repoRoot,
        env: { PATH: first.searchPath },
      })
      const fromSecond = await findSystemTool(TOOL_NAME, {
        cwd: first.repoRoot,
        env: { PATH: second.systemBin },
      })

      expect(fromFirst?.executable).toBe(first.systemTool)
      expect(fromSecond?.executable).toBe(second.systemTool)
    },
  )

  it.skipIf(!EXEC_BIT_IS_ENFORCED)(
    'serves a repeat lookup from the cache',
    async () => {
      const { repoRoot, searchPath } = makeShadowedToolFixture()
      const env = { PATH: searchPath }

      const first = await findSystemTool(TOOL_NAME, { cwd: repoRoot, env })
      const second = await findSystemTool(TOOL_NAME, { cwd: repoRoot, env })

      expect(second).toBe(first)
    },
  )
})
