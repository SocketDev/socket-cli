/**
 * Unit tests for update-dependencies.
 *
 * Purpose:
 * Tests the updateDependencies function that runs package manager install.
 *
 * Test Coverage:
 * - Successful install
 * - Install failure
 * - npm buggy overrides logging
 * - Spinner behavior
 *
 * Related Files:
 * - commands/optimize/update-dependencies.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock dependencies.
const mockLogger = vi.hoisted(() => ({
  fail: vi.fn(),
  log: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

const mockSpinner = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  text: vi.fn(),
  isSpinning: false,
}))

const mockDefaultSpinner = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
}))

const mockRunAgentInstall = vi.hoisted(() => vi.fn())

vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => mockLogger,
}))

vi.mock('@socketsecurity/lib/spinner', () => ({
  getDefaultSpinner: () => mockDefaultSpinner,
}))

vi.mock('@socketsecurity/lib/debug', () => ({
  debug: vi.fn(),
  debugDir: vi.fn(),
}))

vi.mock('../../../../src/commands/optimize/agent-installer.mts', () => ({
  runAgentInstall: mockRunAgentInstall,
}))

vi.mock('../../../../src/constants/packages.mts', () => ({
  NPM_BUGGY_OVERRIDES_PATCHED_VERSION: '10.9.0',
}))

vi.mock('../../../../src/utils/process/cmd.mts', () => ({
  cmdPrefixMessage: (cmd: string, msg: string) => (cmd ? `${cmd}: ${msg}` : msg),
}))

import { updateDependencies } from '../../../../src/commands/optimize/update-dependencies.mts'

import type { EnvDetails } from '../../../../src/utils/ecosystem/environment.mjs'

describe('update-dependencies', () => {
  const mockEnvDetails = {
    agent: 'npm',
    agentVersion: '10.0.0',
    lockName: 'package-lock.json',
    pkgPath: '/test/project',
    features: {
      npmBuggyOverrides: false,
    },
  } as unknown as EnvDetails

  beforeEach(() => {
    vi.clearAllMocks()
    mockRunAgentInstall.mockResolvedValue(undefined)
    mockSpinner.isSpinning = false
  })

  describe('updateDependencies', () => {
    it('returns success on successful install', async () => {
      const result = await updateDependencies(mockEnvDetails, {
        cmdName: 'optimize',
        logger: mockLogger,
        spinner: mockSpinner,
      })

      expect(result.ok).toBe(true)
      expect(mockRunAgentInstall).toHaveBeenCalledWith(
        mockEnvDetails,
        { spinner: mockSpinner },
      )
      expect(mockSpinner.start).toHaveBeenCalledWith(
        'Updating package-lock.json...',
      )
      expect(mockSpinner.stop).toHaveBeenCalled()
    })

    it('returns error on install failure', async () => {
      mockRunAgentInstall.mockRejectedValue(new Error('Install failed'))

      const result = await updateDependencies(mockEnvDetails, {
        cmdName: 'optimize',
        logger: mockLogger,
        spinner: mockSpinner,
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toBe('Dependencies update failed')
        expect(result.cause).toContain('npm install failed')
      }
      expect(mockSpinner.stop).toHaveBeenCalled()
    })

    it('logs message when npmBuggyOverrides is true', async () => {
      const envWithBuggyOverrides = {
        ...mockEnvDetails,
        features: {
          npmBuggyOverrides: true,
        },
      } as unknown as EnvDetails

      await updateDependencies(envWithBuggyOverrides, {
        cmdName: 'optimize',
        logger: mockLogger,
        spinner: mockSpinner,
      })

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('Re-run optimize'),
      )
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('10.9.0'),
      )
    })

    it('works without spinner', async () => {
      const result = await updateDependencies(mockEnvDetails, {
        cmdName: 'test',
        logger: mockLogger,
      })

      expect(result.ok).toBe(true)
      expect(mockRunAgentInstall).toHaveBeenCalled()
    })

    it('restarts spinner if it was spinning before error', async () => {
      mockSpinner.isSpinning = true
      mockRunAgentInstall.mockRejectedValue(new Error('Install failed'))

      await updateDependencies(mockEnvDetails, {
        cmdName: 'optimize',
        logger: mockLogger,
        spinner: mockSpinner,
      })

      expect(mockDefaultSpinner.start).toHaveBeenCalled()
    })

    it('restarts spinner if it was spinning after success', async () => {
      mockSpinner.isSpinning = true

      await updateDependencies(mockEnvDetails, {
        cmdName: 'optimize',
        logger: mockLogger,
        spinner: mockSpinner,
      })

      expect(mockDefaultSpinner.start).toHaveBeenCalled()
    })

    it('does not restart spinner if it was not spinning', async () => {
      mockSpinner.isSpinning = false

      await updateDependencies(mockEnvDetails, {
        cmdName: 'optimize',
        logger: mockLogger,
        spinner: mockSpinner,
      })

      expect(mockDefaultSpinner.start).not.toHaveBeenCalled()
    })

    it('handles different package managers', async () => {
      const pnpmEnvDetails = {
        ...mockEnvDetails,
        agent: 'pnpm',
        lockName: 'pnpm-lock.yaml',
      } as unknown as EnvDetails

      const result = await updateDependencies(pnpmEnvDetails, {
        cmdName: 'optimize',
        logger: mockLogger,
        spinner: mockSpinner,
      })

      expect(result.ok).toBe(true)
      expect(mockSpinner.start).toHaveBeenCalledWith(
        'Updating pnpm-lock.yaml...',
      )
    })

    it('works with empty cmdName', async () => {
      const envWithBuggyOverrides = {
        ...mockEnvDetails,
        features: {
          npmBuggyOverrides: true,
        },
      } as unknown as EnvDetails

      await updateDependencies(envWithBuggyOverrides, {
        cmdName: '',
        logger: mockLogger,
        spinner: mockSpinner,
      })

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('Re-run '),
      )
    })
  })
})
