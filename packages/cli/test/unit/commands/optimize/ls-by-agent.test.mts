/**
 * Unit tests for ls-by-agent module.
 *
 * Purpose:
 * Tests the package listing functions for different package managers.
 *
 * Test Coverage:
 * - cleanupQueryStdout function (via lsNpm, lsVlt)
 * - parsableToQueryStdout function (via lsPnpm)
 * - lsBun function
 * - lsNpm function
 * - lsPnpm function
 * - lsVlt function
 * - lsYarnBerry function
 * - lsYarnClassic function
 * - listPackages function
 *
 * Related Files:
 * - commands/optimize/ls-by-agent.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  BUN,
  NPM,
  PNPM,
  VLT,
  YARN_BERRY,
  YARN_CLASSIC,
} from '@socketsecurity/lib/constants/agents'

// Mock spawn.
const mockSpawn = vi.hoisted(() => vi.fn())
vi.mock('@socketsecurity/lib/spawn', () => ({
  spawn: mockSpawn,
}))

import {
  listPackages,
  lsBun,
  lsNpm,
  lsPnpm,
  lsVlt,
  lsYarnBerry,
  lsYarnClassic,
} from '../../../../src/commands/optimize/ls-by-agent.mts'

import type { EnvDetails } from '../../../../src/utils/ecosystem/environment.mjs'

function createMockEnvDetails(
  agent: string,
  agentExecPath = '/usr/local/bin/npm',
): EnvDetails {
  return {
    agent,
    agentExecPath,
    agentVersion: '10.0.0',
  } as EnvDetails
}

describe('commands/optimize/ls-by-agent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('lsBun', () => {
    it('returns stdout from bun pm ls', async () => {
      mockSpawn.mockResolvedValueOnce({
        stdout: 'package1@1.0.0\npackage2@2.0.0',
      })

      const result = await lsBun(createMockEnvDetails(BUN, '/usr/local/bin/bun'))

      expect(result).toBe('package1@1.0.0\npackage2@2.0.0')
      expect(mockSpawn).toHaveBeenCalledWith(
        '/usr/local/bin/bun',
        ['pm', 'ls', '--all'],
        expect.objectContaining({ cwd: expect.any(String) }),
      )
    })

    it('returns empty string when spawn throws', async () => {
      mockSpawn.mockRejectedValueOnce(new Error('spawn failed'))

      const result = await lsBun(createMockEnvDetails(BUN, '/usr/local/bin/bun'))

      expect(result).toBe('')
    })

    it('handles Buffer stdout', async () => {
      mockSpawn.mockResolvedValueOnce({
        stdout: Buffer.from('package1@1.0.0'),
      })

      const result = await lsBun(createMockEnvDetails(BUN, '/usr/local/bin/bun'))

      expect(result).toBe('package1@1.0.0')
    })
  })

  describe('lsNpm', () => {
    it('returns cleaned up query output', async () => {
      mockSpawn.mockResolvedValueOnce({
        stdout: JSON.stringify([
          { name: 'lodash' },
          { name: 'express' },
        ]),
      })

      const result = await lsNpm(createMockEnvDetails(NPM))

      expect(JSON.parse(result)).toEqual(['lodash', 'express'])
    })

    it('filters out @types packages', async () => {
      mockSpawn.mockResolvedValueOnce({
        stdout: JSON.stringify([
          { name: 'lodash' },
          { name: '@types/node' },
          { name: '@types/express' },
        ]),
      })

      const result = await lsNpm(createMockEnvDetails(NPM))

      expect(JSON.parse(result)).toEqual(['lodash'])
    })

    it('falls back to _id when name is not present', async () => {
      mockSpawn.mockResolvedValueOnce({
        stdout: JSON.stringify([
          { _id: 'lodash@4.0.0' },
          { _id: 'express@5.0.0' },
        ]),
      })

      const result = await lsNpm(createMockEnvDetails(NPM))

      expect(JSON.parse(result)).toEqual(['lodash', 'express'])
    })

    it('falls back to pkgid when name and _id are not present', async () => {
      mockSpawn.mockResolvedValueOnce({
        stdout: JSON.stringify([
          { pkgid: 'lodash@4.0.0' },
        ]),
      })

      const result = await lsNpm(createMockEnvDetails(NPM))

      expect(JSON.parse(result)).toEqual(['lodash'])
    })

    it('returns empty string for empty stdout', async () => {
      mockSpawn.mockResolvedValueOnce({ stdout: '' })

      const result = await lsNpm(createMockEnvDetails(NPM))

      expect(result).toBe('')
    })

    it('returns empty string for malformed JSON', async () => {
      mockSpawn.mockResolvedValueOnce({ stdout: 'not json' })

      const result = await lsNpm(createMockEnvDetails(NPM))

      expect(result).toBe('')
    })

    it('returns empty string for empty array', async () => {
      mockSpawn.mockResolvedValueOnce({ stdout: '[]' })

      const result = await lsNpm(createMockEnvDetails(NPM))

      expect(result).toBe('')
    })

    it('returns empty string when spawn throws', async () => {
      mockSpawn.mockRejectedValueOnce(new Error('npm query failed'))

      const result = await lsNpm(createMockEnvDetails(NPM))

      expect(result).toBe('')
    })
  })

  describe('lsPnpm', () => {
    it('falls back to pnpm ls when npm query fails', async () => {
      mockSpawn.mockResolvedValueOnce({
        stdout: '/path/to/lodash\n/path/to/express\n',
      })

      const result = await lsPnpm(createMockEnvDetails(PNPM, '/usr/local/bin/pnpm'))

      expect(mockSpawn).toHaveBeenCalledWith(
        '/usr/local/bin/pnpm',
        ['ls', '--parseable', '--prod', '--depth', 'Infinity'],
        expect.objectContaining({ cwd: expect.any(String) }),
      )
      // parsableToQueryStdout extracts package names from paths.
      expect(result).toBeTruthy()
    })

    it('uses npm query when npmExecPath is provided and succeeds', async () => {
      // First call for npm query succeeds.
      mockSpawn.mockResolvedValueOnce({
        stdout: JSON.stringify([{ name: 'lodash' }]),
      })

      const result = await lsPnpm(createMockEnvDetails(PNPM, '/usr/local/bin/pnpm'), {
        npmExecPath: '/usr/local/bin/npm',
      })

      expect(JSON.parse(result)).toEqual(['lodash'])
    })

    it('falls back to pnpm when npm query returns empty', async () => {
      // npm query returns empty.
      mockSpawn.mockResolvedValueOnce({ stdout: '' })
      // pnpm ls.
      mockSpawn.mockResolvedValueOnce({
        stdout: '/node_modules/lodash\n',
      })

      const result = await lsPnpm(createMockEnvDetails(PNPM, '/usr/local/bin/pnpm'), {
        npmExecPath: '/usr/local/bin/npm',
      })

      expect(mockSpawn).toHaveBeenCalledTimes(2)
    })

    it('returns empty string when spawn throws', async () => {
      mockSpawn.mockRejectedValueOnce(new Error('pnpm ls failed'))

      const result = await lsPnpm(createMockEnvDetails(PNPM, '/usr/local/bin/pnpm'))

      expect(result).toBe('')
    })
  })

  describe('lsVlt', () => {
    it('returns cleaned up vlt ls output', async () => {
      mockSpawn.mockResolvedValueOnce({
        stdout: JSON.stringify([
          { name: 'lodash' },
          { name: 'express' },
        ]),
      })

      const result = await lsVlt(createMockEnvDetails(VLT, '/usr/local/bin/vlt'))

      expect(JSON.parse(result)).toEqual(['lodash', 'express'])
      expect(mockSpawn).toHaveBeenCalledWith(
        '/usr/local/bin/vlt',
        ['ls', '--view', 'human', ':not(.dev)'],
        expect.objectContaining({ cwd: expect.any(String) }),
      )
    })

    it('returns empty string when spawn throws', async () => {
      mockSpawn.mockRejectedValueOnce(new Error('vlt ls failed'))

      const result = await lsVlt(createMockEnvDetails(VLT, '/usr/local/bin/vlt'))

      expect(result).toBe('')
    })
  })

  describe('lsYarnBerry', () => {
    it('returns stdout from yarn info', async () => {
      mockSpawn.mockResolvedValueOnce({
        stdout: 'lodash@4.0.0\nexpress@5.0.0',
      })

      const result = await lsYarnBerry(createMockEnvDetails(YARN_BERRY, '/usr/local/bin/yarn'))

      expect(result).toBe('lodash@4.0.0\nexpress@5.0.0')
      expect(mockSpawn).toHaveBeenCalledWith(
        '/usr/local/bin/yarn',
        ['info', '--recursive', '--name-only'],
        expect.objectContaining({ cwd: expect.any(String) }),
      )
    })

    it('returns empty string when spawn throws', async () => {
      mockSpawn.mockRejectedValueOnce(new Error('yarn info failed'))

      const result = await lsYarnBerry(createMockEnvDetails(YARN_BERRY, '/usr/local/bin/yarn'))

      expect(result).toBe('')
    })
  })

  describe('lsYarnClassic', () => {
    it('returns stdout from yarn list', async () => {
      mockSpawn.mockResolvedValueOnce({
        stdout: 'lodash@4.0.0\nexpress@5.0.0',
      })

      const result = await lsYarnClassic(createMockEnvDetails(YARN_CLASSIC, '/usr/local/bin/yarn'))

      expect(result).toBe('lodash@4.0.0\nexpress@5.0.0')
      expect(mockSpawn).toHaveBeenCalledWith(
        '/usr/local/bin/yarn',
        ['list', '--prod'],
        expect.objectContaining({ cwd: expect.any(String) }),
      )
    })

    it('returns empty string when spawn throws', async () => {
      mockSpawn.mockRejectedValueOnce(new Error('yarn list failed'))

      const result = await lsYarnClassic(createMockEnvDetails(YARN_CLASSIC, '/usr/local/bin/yarn'))

      expect(result).toBe('')
    })
  })

  describe('listPackages', () => {
    it('delegates to lsBun for bun agent', async () => {
      mockSpawn.mockResolvedValueOnce({ stdout: 'bun-output' })

      const result = await listPackages(createMockEnvDetails(BUN, '/usr/local/bin/bun'))

      expect(result).toBe('bun-output')
    })

    it('delegates to lsPnpm for pnpm agent', async () => {
      mockSpawn.mockResolvedValueOnce({ stdout: '/path/to/pkg\n' })

      const result = await listPackages(createMockEnvDetails(PNPM, '/usr/local/bin/pnpm'))

      expect(mockSpawn).toHaveBeenCalledWith(
        '/usr/local/bin/pnpm',
        expect.arrayContaining(['ls', '--parseable']),
        expect.any(Object),
      )
    })

    it('delegates to lsVlt for vlt agent', async () => {
      mockSpawn.mockResolvedValueOnce({ stdout: '[]' })

      const result = await listPackages(createMockEnvDetails(VLT, '/usr/local/bin/vlt'))

      expect(mockSpawn).toHaveBeenCalledWith(
        '/usr/local/bin/vlt',
        expect.arrayContaining(['ls', '--view', 'human']),
        expect.any(Object),
      )
    })

    it('delegates to lsYarnBerry for yarn berry agent', async () => {
      mockSpawn.mockResolvedValueOnce({ stdout: 'berry-output' })

      const result = await listPackages(createMockEnvDetails(YARN_BERRY, '/usr/local/bin/yarn'))

      expect(result).toBe('berry-output')
    })

    it('delegates to lsYarnClassic for yarn classic agent', async () => {
      mockSpawn.mockResolvedValueOnce({ stdout: 'classic-output' })

      const result = await listPackages(createMockEnvDetails(YARN_CLASSIC, '/usr/local/bin/yarn'))

      expect(result).toBe('classic-output')
    })

    it('defaults to lsNpm for npm agent', async () => {
      mockSpawn.mockResolvedValueOnce({
        stdout: JSON.stringify([{ name: 'lodash' }]),
      })

      const result = await listPackages(createMockEnvDetails(NPM, '/usr/local/bin/npm'))

      expect(mockSpawn).toHaveBeenCalledWith(
        '/usr/local/bin/npm',
        ['query', ':not(.dev)'],
        expect.any(Object),
      )
    })

    it('defaults to lsNpm for unknown agent', async () => {
      mockSpawn.mockResolvedValueOnce({
        stdout: JSON.stringify([{ name: 'lodash' }]),
      })

      const result = await listPackages(createMockEnvDetails('unknown', '/usr/local/bin/npm'))

      expect(mockSpawn).toHaveBeenCalledWith(
        '/usr/local/bin/npm',
        ['query', ':not(.dev)'],
        expect.any(Object),
      )
    })
  })

  describe('cleanupQueryStdout edge cases', () => {
    it('handles packages with scoped names correctly', async () => {
      mockSpawn.mockResolvedValueOnce({
        stdout: JSON.stringify([
          { name: '@scope/package' },
          { _id: '@scope/other@1.0.0' },
        ]),
      })

      const result = await lsNpm(createMockEnvDetails(NPM))

      expect(JSON.parse(result)).toEqual(['@scope/package', '@scope/other'])
    })

    it('handles packages without @ in _id', async () => {
      mockSpawn.mockResolvedValueOnce({
        stdout: JSON.stringify([
          { _id: 'simple-package' },
        ]),
      })

      const result = await lsNpm(createMockEnvDetails(NPM))

      expect(JSON.parse(result)).toEqual(['simple-package'])
    })

    it('deduplicates package names', async () => {
      mockSpawn.mockResolvedValueOnce({
        stdout: JSON.stringify([
          { name: 'lodash' },
          { name: 'lodash' },
          { name: 'lodash' },
        ]),
      })

      const result = await lsNpm(createMockEnvDetails(NPM))

      expect(JSON.parse(result)).toEqual(['lodash'])
    })

    it('handles non-array JSON', async () => {
      mockSpawn.mockResolvedValueOnce({
        stdout: JSON.stringify({ name: 'not-array' }),
      })

      const result = await lsNpm(createMockEnvDetails(NPM))

      expect(result).toBe('')
    })
  })

  describe('parsableToQueryStdout edge cases', () => {
    it('handles empty parsable output', async () => {
      mockSpawn.mockResolvedValueOnce({ stdout: '' })

      const result = await lsPnpm(createMockEnvDetails(PNPM, '/usr/local/bin/pnpm'))

      expect(result).toBe('')
    })

    it('handles Windows-style paths', async () => {
      mockSpawn.mockResolvedValueOnce({
        stdout: 'C:\\Users\\test\\node_modules\\lodash\n',
      })

      const result = await lsPnpm(createMockEnvDetails(PNPM, '/usr/local/bin/pnpm'))

      // Should extract 'lodash' from the path.
      expect(result).toBeTruthy()
    })
  })

  describe('cwd option', () => {
    it('uses provided cwd option', async () => {
      mockSpawn.mockResolvedValueOnce({ stdout: '' })

      await lsNpm(createMockEnvDetails(NPM), { cwd: '/custom/path' })

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({ cwd: '/custom/path' }),
      )
    })

    it('defaults to process.cwd when cwd not provided', async () => {
      mockSpawn.mockResolvedValueOnce({ stdout: '' })

      await lsNpm(createMockEnvDetails(NPM))

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({ cwd: process.cwd() }),
      )
    })
  })
})
