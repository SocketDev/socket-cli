import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  symlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveBinPathSync, whichBinSync } from './bin.mts'

const mockWhichSync = vi.hoisted(() => vi.fn())
const mockReadFileSync = vi.hoisted(() =>
  vi.fn<typeof import('node:fs').readFileSync>(),
)
const mockReadSync = vi.hoisted(() =>
  vi.fn<typeof import('node:fs').readSync>(),
)

vi.mock('which', () => ({ default: { sync: mockWhichSync } }))
vi.mock('node:fs', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs')>()
  return {
    ...fs,
    readFileSync: mockReadFileSync.mockImplementation(fs.readFileSync),
    readSync: mockReadSync.mockImplementation(fs.readSync),
  }
})

const directories: string[] = []

afterEach(() => {
  vi.unstubAllEnvs()
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
  mockWhichSync.mockReset()
  mockReadFileSync.mockClear()
  mockReadSync.mockClear()
})

function createShim(
  contents: string,
  name = 'pnpm.cmd',
): {
  shim: string
  entry: string
} {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'socket-bin-test-'))
  directories.push(directory)
  const shim = path.join(directory, name)
  const entry = path.join(directory, 'node_modules/pnpm/bin/pnpm.cjs')
  mkdirSync(path.dirname(entry), { recursive: true })
  writeFileSync(shim, contents)
  writeFileSync(entry, '')
  return { shim, entry }
}

function withPlatform<T>(platform: string, run: () => T): T {
  const original = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', {
    configurable: true,
    value: platform,
  })
  try {
    return run()
  } finally {
    if (original) {
      Object.defineProperty(process, 'platform', original)
    }
  }
}

describe('whichBinSync', () => {
  it('resolves quoted sibling-node Windows pnpm shims and skips broken candidates', () => {
    const broken = createShim('@echo off\r\nexit /b 1\r\n')
    const valid = createShim(
      String.raw`@"%~dp0\node.exe" "%~dp0\node_modules\pnpm\bin\pnpm.cjs" %*` +
        '\r\n',
    )
    mockWhichSync.mockReturnValue([broken.shim, valid.shim])

    const paths = withPlatform('win32', () =>
      whichBinSync('pnpm', { all: true, nothrow: true }),
    )

    expect(paths).toEqual([realpathSync.native(valid.entry)])
  })

  it('does not read an unrelated extensionless executable', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'socket-bun-test-'))
    directories.push(directory)
    const bunPath = path.join(directory, 'bun')
    writeFileSync(bunPath, Buffer.from([0, 255, 16, 128]))

    const resolved = withPlatform('linux', () => resolveBinPathSync(bunPath))

    expect(resolved).toBe(realpathSync.native(bunPath))
    expect(mockReadFileSync).not.toHaveBeenCalled()
    expect(mockReadSync).not.toHaveBeenCalled()
  })

  it('reads only a small prefix of a standalone pnpm executable', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'socket-pnpm-test-'))
    directories.push(directory)
    const pnpmPath = path.join(directory, 'pnpm')
    const binary = Buffer.alloc(256 * 1024)
    // ELF header followed by a string that would match a pnpm shim.
    binary.write('\u007fELF', 'ascii')
    binary.write('node "$basedir/node_modules/pnpm/bin/pnpm.cjs" "$@"', 64)
    writeFileSync(pnpmPath, binary)

    const resolved = withPlatform('linux', () => resolveBinPathSync(pnpmPath))

    expect(resolved).toBe(realpathSync.native(pnpmPath))
    expect(mockReadFileSync).not.toHaveBeenCalled()
    expect(mockReadSync).toHaveBeenCalledTimes(1)
    expect(mockReadSync.mock.results[0]?.value).toBeLessThanOrEqual(16 * 1024)
  })

  it('preserves Volta pnpm shim names for version dispatch', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'socket-volta-test-'))
    directories.push(directory)
    const voltaHome = path.join(directory, 'volta')
    const shimDirectory = path.join(voltaHome, 'bin')
    mkdirSync(shimDirectory, { recursive: true })
    const shim = path.join(shimDirectory, 'pnpm')
    const launcher = path.join(directory, 'volta-shim')
    writeFileSync(launcher, '')
    symlinkSync(launcher, shim)
    vi.stubEnv('VOLTA_HOME', voltaHome)

    const resolved = withPlatform('linux', () => resolveBinPathSync(shim))

    expect(path.normalize(resolved)).toBe(shim)
  })

  it('resolves a pnpm shell shim to its Node entrypoint', () => {
    const { shim, entry } = createShim(
      '#!/bin/sh\nexec node "$basedir/node_modules/pnpm/bin/pnpm.cjs" "$@"\n',
      'pnpm',
    )
    const resolved = withPlatform('linux', () => resolveBinPathSync(shim))

    expect(resolved).toBe(realpathSync.native(entry))
  })

  it.each(['linux', 'win32'])(
    'resolves the setup-pnpm shell shim to the sibling package on %s',
    platform => {
      const directory = mkdtempSync(path.join(os.tmpdir(), 'socket-bin-test-'))
      directories.push(directory)
      const shim = path.join(directory, 'node_modules/.bin/pnpm')
      const entry = path.join(directory, 'node_modules/pnpm/bin/pnpm.cjs')
      mkdirSync(path.dirname(shim), { recursive: true })
      mkdirSync(path.dirname(entry), { recursive: true })
      writeFileSync(
        shim,
        '#!/bin/sh\nexec node "$basedir/pnpm/bin/pnpm.cjs" "$@"\n',
      )
      writeFileSync(entry, '')
      mockWhichSync.mockReturnValue(shim)

      const resolved = withPlatform(platform, () =>
        whichBinSync('pnpm', { nothrow: true }),
      )

      expect(resolved).toBe(realpathSync.native(entry))
    },
  )
})
