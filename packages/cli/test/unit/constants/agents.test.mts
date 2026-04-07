/**
 * Unit tests for agent constants.
 *
 * Purpose:
 * Tests the agent-specific constants and utility functions.
 *
 * Test Coverage:
 * - Agent name constants
 * - Minimum version by agent
 * - Execution path functions
 *
 * Related Files:
 * - constants/agents.mts (implementation)
 */

import fs from 'node:fs'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock dependencies using hoisted mocks.
const mockWhichReal = vi.hoisted(() => vi.fn())

vi.mock('@socketsecurity/lib/bin', () => ({
  whichReal: mockWhichReal,
}))

import {
  BUN,
  getMinimumVersionByAgent,
  getNpmExecPath,
  getPnpmExecPath,
  NPM,
  NPX,
  PNPM,
  VLT,
  YARN,
  YARN_BERRY,
  YARN_CLASSIC,
} from '../../../src/constants/agents.mts'

describe('agents constants', () => {
  let mockExistsSync: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    mockExistsSync = vi.spyOn(fs, 'existsSync')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('agent name constants', () => {
    it('has BUN constant', () => {
      expect(BUN).toBe('bun')
    })

    it('has NPM constant', () => {
      expect(NPM).toBe('npm')
    })

    it('has NPX constant', () => {
      expect(NPX).toBe('npx')
    })

    it('has PNPM constant', () => {
      expect(PNPM).toBe('pnpm')
    })

    it('has VLT constant', () => {
      expect(VLT).toBe('vlt')
    })

    it('has YARN constant', () => {
      expect(YARN).toBe('yarn')
    })

    it('has YARN_BERRY constant', () => {
      expect(YARN_BERRY).toBe('yarn/berry')
    })

    it('has YARN_CLASSIC constant', () => {
      expect(YARN_CLASSIC).toBe('yarn/classic')
    })
  })

  describe('getMinimumVersionByAgent', () => {
    it('returns minimum version for BUN', () => {
      const result = getMinimumVersionByAgent('bun')
      expect(result).toBe('1.1.39')
    })

    it('returns minimum version for NPM', () => {
      const result = getMinimumVersionByAgent('npm')
      expect(result).toBe('10.8.2')
    })

    it('returns minimum version for PNPM', () => {
      const result = getMinimumVersionByAgent('pnpm')
      expect(result).toBe('8.15.7')
    })

    it('returns minimum version for YARN_BERRY', () => {
      const result = getMinimumVersionByAgent('yarn/berry')
      expect(result).toBe('4.0.0')
    })

    it('returns minimum version for YARN_CLASSIC', () => {
      const result = getMinimumVersionByAgent('yarn/classic')
      expect(result).toBe('1.22.22')
    })

    it('returns * for VLT (any version)', () => {
      const result = getMinimumVersionByAgent('vlt')
      expect(result).toBe('*')
    })

    it('returns * for unknown agent', () => {
      const result = getMinimumVersionByAgent('unknown' as any)
      expect(result).toBe('*')
    })
  })

  describe('getNpmExecPath', () => {
    it('returns npm path from node directory if exists', async () => {
      mockExistsSync.mockReturnValue(true)

      const result = await getNpmExecPath()

      expect(result).toContain('npm')
      expect(mockWhichReal).not.toHaveBeenCalled()
    })

    it('falls back to whichReal if npm not in node directory', async () => {
      mockExistsSync.mockReturnValue(false)
      mockWhichReal.mockResolvedValue('/usr/bin/npm')

      const result = await getNpmExecPath()

      expect(result).toBe('/usr/bin/npm')
      expect(mockWhichReal).toHaveBeenCalledWith('npm', { nothrow: true })
    })

    it('handles array result from whichReal', async () => {
      mockExistsSync.mockReturnValue(false)
      mockWhichReal.mockResolvedValue(['/usr/local/bin/npm', '/usr/bin/npm'])

      const result = await getNpmExecPath()

      expect(result).toBe('/usr/local/bin/npm')
    })

    it('returns "npm" if whichReal returns null', async () => {
      mockExistsSync.mockReturnValue(false)
      mockWhichReal.mockResolvedValue(null)

      const result = await getNpmExecPath()

      expect(result).toBe('npm')
    })
  })

  describe('getPnpmExecPath', () => {
    it('returns pnpm path from whichReal', async () => {
      mockWhichReal.mockResolvedValue('/usr/bin/pnpm')

      const result = await getPnpmExecPath()

      expect(result).toBe('/usr/bin/pnpm')
      expect(mockWhichReal).toHaveBeenCalledWith('pnpm', { nothrow: true })
    })

    it('handles array result from whichReal', async () => {
      mockWhichReal.mockResolvedValue(['/usr/local/bin/pnpm', '/usr/bin/pnpm'])

      const result = await getPnpmExecPath()

      expect(result).toBe('/usr/local/bin/pnpm')
    })

    it('returns "pnpm" if whichReal returns null', async () => {
      mockWhichReal.mockResolvedValue(null)

      const result = await getPnpmExecPath()

      expect(result).toBe('pnpm')
    })
  })
})
