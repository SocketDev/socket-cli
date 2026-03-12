/**
 * Unit tests for apply-optimization.
 *
 * Purpose:
 * Tests the applyOptimization function that applies Socket registry overrides.
 *
 * Test Coverage:
 * - Successful optimization
 * - Update dependencies failure
 * - npm buggy overrides handling
 * - Spinner behavior
 *
 * Related Files:
 * - commands/optimize/apply-optimization.mts (implementation)
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
}))

const mockAddOverrides = vi.hoisted(() => vi.fn())
const mockUpdateDependencies = vi.hoisted(() => vi.fn())

vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => mockLogger,
}))

vi.mock('@socketsecurity/lib/spinner', () => ({
  getDefaultSpinner: () => mockSpinner,
}))

vi.mock('../../../../src/commands/optimize/add-overrides.mts', () => ({
  addOverrides: mockAddOverrides,
}))

vi.mock('../../../../src/commands/optimize/update-dependencies.mts', () => ({
  updateDependencies: mockUpdateDependencies,
}))

vi.mock('../../../../src/commands/optimize/shared.mts', () => ({
  CMD_NAME: 'optimize',
}))

import { applyOptimization } from '../../../../src/commands/optimize/apply-optimization.mts'

import type { EnvDetails } from '../../../../src/utils/ecosystem/environment.mjs'

describe('apply-optimization', () => {
  const mockEnvDetails = {
    agent: 'npm',
    agentVersion: '10.0.0',
    pkgPath: '/test/project',
    manifestPath: '/test/project/package.json',
    lockfilePath: '/test/project/package-lock.json',
    features: {
      npmBuggyOverrides: false,
    },
  } as unknown as EnvDetails

  beforeEach(() => {
    vi.clearAllMocks()
    mockAddOverrides.mockResolvedValue({
      added: new Set(),
      addedInWorkspaces: new Set(),
      updated: new Set(),
      updatedInWorkspaces: new Set(),
      warnedPnpmWorkspaceRequiresNpm: false,
    })
    mockUpdateDependencies.mockResolvedValue({ ok: true })
  })

  describe('applyOptimization', () => {
    it('returns success with no changes when nothing added or updated', async () => {
      const result = await applyOptimization(mockEnvDetails, {
        pin: false,
        prod: false,
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.addedCount).toBe(0)
        expect(result.data.updatedCount).toBe(0)
        expect(result.data.pkgJsonChanged).toBe(false)
      }
      expect(mockSpinner.start).toHaveBeenCalled()
      expect(mockSpinner.stop).toHaveBeenCalled()
    })

    it('returns success with changes when packages added', async () => {
      mockAddOverrides.mockResolvedValue({
        added: new Set(['pkg1', 'pkg2']),
        addedInWorkspaces: new Set(['workspace1']),
        updated: new Set(['pkg3']),
        updatedInWorkspaces: new Set(),
        warnedPnpmWorkspaceRequiresNpm: false,
      })

      const result = await applyOptimization(mockEnvDetails, {
        pin: true,
        prod: false,
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.addedCount).toBe(2)
        expect(result.data.updatedCount).toBe(1)
        expect(result.data.pkgJsonChanged).toBe(true)
        expect(result.data.addedInWorkspaces).toBe(1)
      }
      expect(mockUpdateDependencies).toHaveBeenCalled()
    })

    it('calls updateDependencies when packages changed', async () => {
      mockAddOverrides.mockResolvedValue({
        added: new Set(['pkg1']),
        addedInWorkspaces: new Set(),
        updated: new Set(),
        updatedInWorkspaces: new Set(),
        warnedPnpmWorkspaceRequiresNpm: false,
      })

      await applyOptimization(mockEnvDetails, { pin: false, prod: false })

      expect(mockUpdateDependencies).toHaveBeenCalledWith(
        mockEnvDetails,
        expect.objectContaining({
          cmdName: 'optimize',
          logger: mockLogger,
        }),
      )
    })

    it('returns error when updateDependencies fails', async () => {
      mockAddOverrides.mockResolvedValue({
        added: new Set(['pkg1']),
        addedInWorkspaces: new Set(),
        updated: new Set(),
        updatedInWorkspaces: new Set(),
        warnedPnpmWorkspaceRequiresNpm: false,
      })
      mockUpdateDependencies.mockResolvedValue({
        ok: false,
        message: 'Install failed',
        code: 1,
      })

      const result = await applyOptimization(mockEnvDetails, {
        pin: false,
        prod: false,
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toBe('Install failed')
      }
      expect(mockSpinner.stop).toHaveBeenCalled()
    })

    it('calls updateDependencies when npmBuggyOverrides is true even with no changes', async () => {
      const envWithBuggyOverrides = {
        ...mockEnvDetails,
        features: {
          npmBuggyOverrides: true,
        },
      } as unknown as EnvDetails

      await applyOptimization(envWithBuggyOverrides, { pin: false, prod: false })

      expect(mockUpdateDependencies).toHaveBeenCalled()
    })

    it('passes pin and prod options to addOverrides', async () => {
      await applyOptimization(mockEnvDetails, { pin: true, prod: true })

      expect(mockAddOverrides).toHaveBeenCalledWith(
        mockEnvDetails,
        '/test/project',
        expect.objectContaining({
          pin: true,
          prod: true,
        }),
      )
    })

    it('handles workspace updates correctly', async () => {
      mockAddOverrides.mockResolvedValue({
        added: new Set(),
        addedInWorkspaces: new Set(['ws1', 'ws2', 'ws3']),
        updated: new Set(['pkg1']),
        updatedInWorkspaces: new Set(['ws1', 'ws2']),
        warnedPnpmWorkspaceRequiresNpm: false,
      })

      const result = await applyOptimization(mockEnvDetails, {
        pin: false,
        prod: false,
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.addedInWorkspaces).toBe(3)
        expect(result.data.updatedInWorkspaces).toBe(2)
      }
    })

    it('does not call updateDependencies when no changes and no buggy overrides', async () => {
      await applyOptimization(mockEnvDetails, { pin: false, prod: false })

      expect(mockUpdateDependencies).not.toHaveBeenCalled()
    })
  })
})
