/**
 * Unit tests for setup-scan-config helpers.
 *
 * The full setupScanConfig flow is interactive (prompts the user), but the
 * helpers `canceledByUser` and `notCanceled` are pure and easy to pin.
 *
 * Related Files:
 * - src/commands/scan/setup-scan-config.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockLogger = vi.hoisted(() => ({
  fail: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => mockLogger,
}))

import {
  canceledByUser,
  notCanceled,
} from '../../../../src/commands/scan/setup-scan-config.mts'

describe('setup-scan-config helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('canceledByUser', () => {
    it('returns ok=true with canceled=true', () => {
      const result = canceledByUser()
      expect(result).toEqual({ ok: true, data: { canceled: true } })
    })

    it('logs an info line', () => {
      canceledByUser()
      expect(mockLogger.info).toHaveBeenCalledWith('User canceled')
    })
  })

  describe('notCanceled', () => {
    it('returns ok=true with canceled=false', () => {
      const result = notCanceled()
      expect(result).toEqual({ ok: true, data: { canceled: false } })
    })

    it('does not log', () => {
      notCanceled()
      expect(mockLogger.info).not.toHaveBeenCalled()
    })
  })
})
