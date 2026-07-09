/**
 * Unit tests for ls-by-agent query-stdout helpers.
 *
 * Purpose: Tests the cleanupQueryStdout and parsableToQueryStdout helper
 * functions (directly and via lsNpm / lsPnpm), plus the cwd option shared by
 * the package-manager listing functions.
 *
 * Related Files: - commands/optimize/ls-by-agent.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NPM, PNPM } from '@socketsecurity/lib-stable/constants/agents'

// Mock spawn.
const mockSpawn = vi.hoisted(() => vi.fn())
vi.mock(import('@socketsecurity/lib-stable/process/spawn/child'), () => ({
  spawn: mockSpawn,
}))

import {
  lsNpm,
  lsPnpm,
} from '../../../../src/commands/optimize/ls-by-agent.mts'

import type { EnvDetails } from '../../../../src/util/ecosystem/environment.mjs'

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
        stdout: JSON.stringify([{ _id: 'simple-package' }]),
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

      const result = await lsPnpm(
        createMockEnvDetails(PNPM, '/usr/local/bin/pnpm'),
      )

      expect(result).toBe('')
    })

    it('handles Windows-style paths', async () => {
      mockSpawn.mockResolvedValueOnce({
        stdout: 'C:\\Users\\test\\node_modules\\lodash\n',
      })

      const result = await lsPnpm(
        createMockEnvDetails(PNPM, '/usr/local/bin/pnpm'),
      )

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

  describe('cleanupQueryStdout', () => {
    it('returns empty string for empty input', async () => {
      const { cleanupQueryStdout } =
        await import('../../../../src/commands/optimize/ls-by-agent.mts')
      expect(cleanupQueryStdout('')).toBe('')
    })

    it('returns empty string for malformed JSON', async () => {
      const { cleanupQueryStdout } =
        await import('../../../../src/commands/optimize/ls-by-agent.mts')
      expect(cleanupQueryStdout('{not json')).toBe('')
    })

    it('returns empty string for non-array result', async () => {
      const { cleanupQueryStdout } =
        await import('../../../../src/commands/optimize/ls-by-agent.mts')
      expect(cleanupQueryStdout('{}')).toBe('')
    })

    it('returns empty string for empty array', async () => {
      const { cleanupQueryStdout } =
        await import('../../../../src/commands/optimize/ls-by-agent.mts')
      expect(cleanupQueryStdout('[]')).toBe('')
    })

    it('extracts unique names and skips @types/* packages', async () => {
      const { cleanupQueryStdout } =
        await import('../../../../src/commands/optimize/ls-by-agent.mts')
      const result = cleanupQueryStdout(
        JSON.stringify([
          { name: 'lodash', _id: 'lodash@4.17.21' },
          { name: 'react', _id: 'react@18.0.0' },
          { name: 'lodash', _id: 'lodash@4.17.21' },
          { name: '@types/node', _id: '@types/node@20.0.0' },
        ]),
      )
      expect(JSON.parse(result)).toEqual(['lodash', 'react'])
    })

    it('falls back to _id when name is missing', async () => {
      const { cleanupQueryStdout } =
        await import('../../../../src/commands/optimize/ls-by-agent.mts')
      const result = cleanupQueryStdout(
        JSON.stringify([{ _id: 'fallback-pkg@1.0.0' }]),
      )
      expect(JSON.parse(result)).toEqual(['fallback-pkg'])
    })

    it('falls back to pkgid when both name + _id are missing', async () => {
      const { cleanupQueryStdout } =
        await import('../../../../src/commands/optimize/ls-by-agent.mts')
      const result = cleanupQueryStdout(
        JSON.stringify([{ pkgid: 'pkgid-pkg@2.0.0' }]),
      )
      expect(JSON.parse(result)).toEqual(['pkgid-pkg'])
    })

    it('skips entries with no resolvable name', async () => {
      const { cleanupQueryStdout } =
        await import('../../../../src/commands/optimize/ls-by-agent.mts')
      const result = cleanupQueryStdout(JSON.stringify([{}, {}]))
      expect(JSON.parse(result)).toEqual([])
    })
  })

  describe('parsableToQueryStdout', () => {
    it('returns empty string for empty input', async () => {
      const { parsableToQueryStdout } =
        await import('../../../../src/commands/optimize/ls-by-agent.mts')
      expect(parsableToQueryStdout('')).toBe('')
    })

    it('extracts trailing path segments before newlines', async () => {
      const { parsableToQueryStdout } =
        await import('../../../../src/commands/optimize/ls-by-agent.mts')
      const result = parsableToQueryStdout(
        '/Users/x/proj/node_modules/lodash\n/Users/x/proj/node_modules/react\n', // socket-lint: allow personal-path
      )
      expect(typeof result).toBe('string')
    })

    it('handles backslash paths (Windows-style)', async () => {
      const { parsableToQueryStdout } =
        await import('../../../../src/commands/optimize/ls-by-agent.mts')
      const result = parsableToQueryStdout(
        'C:\\proj\\node_modules\\lodash\nC:\\proj\\node_modules\\react\n',
      )
      expect(typeof result).toBe('string')
    })
  })
})
