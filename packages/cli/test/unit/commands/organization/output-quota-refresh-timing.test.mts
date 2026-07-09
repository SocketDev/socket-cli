/**
 * Unit Tests: API Token Quota Output Formatter — refresh timing.
 *
 * Purpose: Tests the "next refresh" duration rendering in the quota output
 * formatter across boundary conditions (sub-minute, hour boundary, invalid
 * date, past timestamp, minutes, and days).
 *
 * Testing Approach: Uses vi.doMock to reset module state between tests, mocking
 * the logger. Tests verify output content for the rendered refresh duration.
 *
 * Related Files: - src/commands/organization/output-quota.mts - Output
 * formatter - src/commands/organization/handle-quota.mts - Command handler -
 * src/commands/organization/fetch-quota.mts - Quota fetcher.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createSuccessResult } from '../../../../test/helpers/index.mts'

describe('outputQuota', () => {
  beforeEach(async () => {
    vi.resetModules()
  })

  it('formats nextWindowRefresh when provided', async () => {
    const mockLogger = {
      fail: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }

    vi.doMock(import('@socketsecurity/lib-stable/logger/default'), () => ({
      getDefaultLogger: () => mockLogger,
      logger: mockLogger,
    }))

    const { outputQuota } =
      await import('../../../../src/commands/organization/output-quota.mts')

    const result = createSuccessResult({
      quota: 100,
      maxQuota: 1000,
      nextWindowRefresh: '2099-01-01T00:00:00.000Z',
    })

    process.exitCode = undefined
    await outputQuota(result as unknown, 'text')

    // Exact "in X d" count is time-sensitive; just confirm it rendered the ISO date.
    const calls = mockLogger.log.mock.calls.map((c: unknown[]) => c[0])
    expect(
      calls.some(
        (c: unknown) =>
          typeof c === 'string' && c.includes('2099-01-01T00:00:00.000Z'),
      ),
    ).toBe(true)
  })

  it('shows <1 min when refresh is within 60 seconds', async () => {
    // Regression: Math.round(diffMs / 60_000) used to produce "in 0 min"
    // for 1–29,999 ms.
    const mockLogger = {
      fail: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }

    vi.doMock(import('@socketsecurity/lib-stable/logger/default'), () => ({
      getDefaultLogger: () => mockLogger,
      logger: mockLogger,
    }))

    const { outputQuota } =
      await import('../../../../src/commands/organization/output-quota.mts')

    const soon = new Date(Date.now() + 5000).toISOString()
    const result = createSuccessResult({
      quota: 10,
      maxQuota: 1000,
      nextWindowRefresh: soon,
    })

    process.exitCode = undefined
    await outputQuota(result as unknown, 'text')

    const calls = mockLogger.log.mock.calls.map((c: unknown[]) => c[0])
    expect(
      calls.some((c: unknown) => typeof c === 'string' && c.includes('<1 min')),
    ).toBe(true)
    expect(
      calls.some((c: unknown) => typeof c === 'string' && c.includes('0 min')),
    ).toBe(false)
  })

  it('promotes to hours before producing "in 60 min" at the boundary', async () => {
    // Regression: at diffMs ~= 59.5 min, Math.round rounded up to 60,
    // giving "in 60 min" instead of "in 1 h".
    const mockLogger = {
      fail: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }

    vi.doMock(import('@socketsecurity/lib-stable/logger/default'), () => ({
      getDefaultLogger: () => mockLogger,
      logger: mockLogger,
    }))

    const { outputQuota } =
      await import('../../../../src/commands/organization/output-quota.mts')

    const near = new Date(Date.now() + 59.8 * 60_000).toISOString()
    const result = createSuccessResult({
      quota: 10,
      maxQuota: 1000,
      nextWindowRefresh: near,
    })

    process.exitCode = undefined
    await outputQuota(result as unknown, 'text')

    const calls = mockLogger.log.mock.calls.map((c: unknown[]) => c[0])
    expect(
      calls.some((c: unknown) => typeof c === 'string' && c.includes('60 min')),
    ).toBe(false)
    expect(
      calls.some((c: unknown) => typeof c === 'string' && c.includes('1 h')),
    ).toBe(true)
  })

  it('returns the raw refresh string when Date.parse yields NaN', async () => {
    const mockLogger = {
      fail: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }
    vi.doMock(import('@socketsecurity/lib-stable/logger/default'), () => ({
      getDefaultLogger: () => mockLogger,
      logger: mockLogger,
    }))

    const { outputQuota } =
      await import('../../../../src/commands/organization/output-quota.mts')

    const result = createSuccessResult({
      quota: 10,
      maxQuota: 100,
      nextWindowRefresh: 'not-a-date',
    })

    process.exitCode = undefined
    await outputQuota(result as unknown, 'text')

    const calls = mockLogger.log.mock.calls.map((c: unknown[]) => c[0])
    expect(
      calls.some(
        (c: unknown) => typeof c === 'string' && c.includes('not-a-date'),
      ),
    ).toBe(true)
  })

  it('emits "due now" when refresh timestamp has passed', async () => {
    const mockLogger = {
      fail: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }
    vi.doMock(import('@socketsecurity/lib-stable/logger/default'), () => ({
      getDefaultLogger: () => mockLogger,
      logger: mockLogger,
    }))

    const { outputQuota } =
      await import('../../../../src/commands/organization/output-quota.mts')

    const past = new Date(Date.now() - 60_000).toISOString()
    const result = createSuccessResult({
      quota: 10,
      maxQuota: 100,
      nextWindowRefresh: past,
    })

    process.exitCode = undefined
    await outputQuota(result as unknown, 'text')

    const calls = mockLogger.log.mock.calls.map((c: unknown[]) => c[0])
    expect(
      calls.some(
        (c: unknown) => typeof c === 'string' && c.includes('due now'),
      ),
    ).toBe(true)
  })

  it('emits "in N min" for refresh windows under an hour', async () => {
    const mockLogger = {
      fail: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }
    vi.doMock(import('@socketsecurity/lib-stable/logger/default'), () => ({
      getDefaultLogger: () => mockLogger,
      logger: mockLogger,
    }))

    const { outputQuota } =
      await import('../../../../src/commands/organization/output-quota.mts')

    const tenMin = new Date(Date.now() + 10 * 60_000).toISOString()
    const result = createSuccessResult({
      quota: 10,
      maxQuota: 100,
      nextWindowRefresh: tenMin,
    })

    process.exitCode = undefined
    await outputQuota(result as unknown, 'text')

    const calls = mockLogger.log.mock.calls.map((c: unknown[]) => c[0])
    expect(
      calls.some((c: unknown) => typeof c === 'string' && /in \d+ min/.test(c)),
    ).toBe(true)
  })

  it('emits "in N d" for refresh windows over 1.97 days', async () => {
    const mockLogger = {
      fail: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }
    vi.doMock(import('@socketsecurity/lib-stable/logger/default'), () => ({
      getDefaultLogger: () => mockLogger,
      logger: mockLogger,
    }))

    const { outputQuota } =
      await import('../../../../src/commands/organization/output-quota.mts')

    const days = new Date(Date.now() + 5 * 86_400_000).toISOString()
    const result = createSuccessResult({
      quota: 10,
      maxQuota: 100,
      nextWindowRefresh: days,
    })

    process.exitCode = undefined
    await outputQuota(result as unknown, 'text')

    const calls = mockLogger.log.mock.calls.map((c: unknown[]) => c[0])
    expect(
      calls.some((c: unknown) => typeof c === 'string' && /in \d+ d/.test(c)),
    ).toBe(true)
  })
})
