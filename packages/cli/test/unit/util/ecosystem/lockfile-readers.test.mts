/**
 * Unit tests for the LOCKS map and per-agent lockfile readers.
 *
 * Most callers exercise these through detectPackageEnvironment integration
 * tests; this file covers the bun-specific reader paths that the higher-level
 * tests don't reach (.lock vs .lockb dispatch, parseBunLockb fallback to
 * spawning `bun`, and the wrapReader catch-returns-undefined branch).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockReadFileBinary = vi.hoisted(() => vi.fn())
const mockReadFileUtf8 = vi.hoisted(() => vi.fn())
const mockSpawn = vi.hoisted(() => vi.fn())
const mockParseBunLockb = vi.hoisted(() => vi.fn())

vi.mock('@socketsecurity/lib-stable/fs/read-file', () => ({
  readFileBinary: mockReadFileBinary,
  readFileUtf8: mockReadFileUtf8,
}))

vi.mock('@socketsecurity/lib-stable/spawn/spawn', () => ({
  spawn: mockSpawn,
}))

vi.mock('@socketregistry/hyrious__bun.lockb/index.cjs', () => ({
  parse: mockParseBunLockb,
}))

import {
  LOCKS,
  readLockFileByAgent,
} from '../../../../src/util/ecosystem/lockfile-readers.mts'

describe('lockfile-readers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('LOCKS', () => {
    it('maps bun lockfiles to bun', () => {
      expect(LOCKS['bun.lock']).toBe('bun')
      expect(LOCKS['bun.lockb']).toBe('bun')
    })

    it('maps npm lockfiles to npm', () => {
      expect(LOCKS['package-lock.json']).toBe('npm')
      expect(LOCKS['npm-shrinkwrap.json']).toBe('npm')
    })

    it('maps pnpm lockfile to pnpm', () => {
      expect(LOCKS['pnpm-lock.yaml']).toBe('pnpm')
    })

    it('maps yarn.lock to yarn/classic', () => {
      // Agent name uses '/' as the separator between flavor variants.
      expect(LOCKS['yarn.lock']).toBe('yarn/classic')
    })

    it('maps the hidden .package-lock.json to npm', () => {
      expect(LOCKS['node_modules/.package-lock.json']).toBe('npm')
    })

    it('iterates in significant order: bun first, hidden npm last', () => {
      const keys = Object.keys(LOCKS)
      expect(keys[0]).toBe('bun.lock')
      expect(keys[keys.length - 1]).toBe('node_modules/.package-lock.json')
    })
  })

  describe('readLockFileByAgent (npm/pnpm/etc.)', () => {
    it('returns the utf8 content for npm', async () => {
      mockReadFileUtf8.mockResolvedValue('{"lockfileVersion": 3}')
      const reader = readLockFileByAgent.get('npm')!
      const result = await reader(
        '/repo/package-lock.json',
        '/usr/bin/npm',
        '/repo',
      )
      expect(result).toBe('{"lockfileVersion": 3}')
    })

    it('returns undefined when the underlying read throws (catch branch)', async () => {
      mockReadFileUtf8.mockRejectedValue(new Error('EACCES'))
      const reader = readLockFileByAgent.get('pnpm')!
      const result = await reader(
        '/repo/pnpm-lock.yaml',
        '/usr/bin/pnpm',
        '/repo',
      )
      expect(result).toBeUndefined()
    })
  })

  describe('readLockFileByAgent.bun (.lock)', () => {
    it('uses the default utf8 reader for bun.lock files', async () => {
      mockReadFileUtf8.mockResolvedValue('bun lockfile contents')
      const reader = readLockFileByAgent.get('bun')!
      const result = await reader('/repo/bun.lock', '/usr/bin/bun', '/repo')
      expect(result).toBe('bun lockfile contents')
      expect(mockReadFileUtf8).toHaveBeenCalledWith('/repo/bun.lock')
    })
  })

  describe('readLockFileByAgent.bun (.lockb)', () => {
    it('parses the lockfile via parseBunLockb when the buffer is readable', async () => {
      const buffer = Buffer.from('binary-lockfile-content')
      mockReadFileBinary.mockResolvedValue(buffer)
      mockParseBunLockb.mockReturnValue('parsed yaml output')
      const reader = readLockFileByAgent.get('bun')!
      const result = await reader('/repo/bun.lockb', '/usr/bin/bun', '/repo')
      expect(mockParseBunLockb).toHaveBeenCalledWith(buffer)
      expect(result).toBe('parsed yaml output')
    })

    it('falls back to spawning bun bun.lockb when the parser throws', async () => {
      const buffer = Buffer.from('corrupt-binary')
      mockReadFileBinary.mockResolvedValue(buffer)
      mockParseBunLockb.mockImplementation(() => {
        throw new Error('parse failed')
      })
      mockSpawn.mockResolvedValue({
        stdout: 'spawned bun output',
        stderr: '',
        code: 0,
      })
      const reader = readLockFileByAgent.get('bun')!
      const result = await reader('/repo/bun.lockb', '/usr/bin/bun', '/repo')
      expect(mockSpawn).toHaveBeenCalledWith(
        '/usr/bin/bun',
        ['/repo/bun.lockb'],
        expect.objectContaining({ cwd: '/repo' }),
      )
      expect(result).toBe('spawned bun output')
    })

    it('falls back to spawning when readFileBinary returns nothing', async () => {
      mockReadFileBinary.mockResolvedValue(undefined)
      mockSpawn.mockResolvedValue({
        stdout: 'spawned',
        stderr: '',
        code: 0,
      })
      const reader = readLockFileByAgent.get('bun')!
      const result = await reader('/repo/bun.lockb', '/usr/bin/bun', '/repo')
      expect(mockParseBunLockb).not.toHaveBeenCalled()
      expect(result).toBe('spawned')
    })
  })

  describe('readLockFileByAgent.bun (unknown extension)', () => {
    it('returns undefined for an unrecognized extension', async () => {
      const reader = readLockFileByAgent.get('bun')!
      const result = await reader('/repo/bun.json', '/usr/bin/bun', '/repo')
      expect(result).toBeUndefined()
    })
  })
})
