/**
 * Unit tests for the outputAnalytics dispatcher.
 *
 * The format/render helpers have their own tests; this suite covers the
 * top-level outputAnalytics() function: error handling, JSON/markdown
 * file write paths, and iocraft fallback for text mode.
 *
 * Related Files:
 * - src/commands/analytics/output-analytics.mts
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockLogger = vi.hoisted(() => ({
  log: vi.fn(),
  fail: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}))
const mockWriteFile = vi.hoisted(() => vi.fn())
const mockDisplayAnalyticsWithIocraft = vi.hoisted(() => vi.fn())
const mockDebugFileOp = vi.hoisted(() => vi.fn())

vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => mockLogger,
}))
vi.mock('node:fs/promises', () => ({
  default: { writeFile: mockWriteFile },
  writeFile: mockWriteFile,
}))
vi.mock('../../../../src/commands/analytics/AnalyticsRenderer.mts', () => ({
  displayAnalyticsWithIocraft: mockDisplayAnalyticsWithIocraft,
}))
vi.mock('../../../../src/utils/debug.mts', () => ({
  debugFileOp: mockDebugFileOp,
}))

import { outputAnalytics } from '../../../../src/commands/analytics/output-analytics.mts'

const sampleData = [
  {
    created_at: '2025-04-19T04:50:00Z',
    top_five_alert_types: { foo: 1 },
    total_critical_alerts: 1,
    total_high_alerts: 1,
    total_medium_alerts: 1,
    total_low_alerts: 1,
    total_critical_added: 1,
    total_high_added: 1,
    total_medium_added: 1,
    total_low_added: 1,
    total_critical_prevented: 1,
    total_high_prevented: 1,
    total_medium_prevented: 1,
    total_low_prevented: 1,
  },
] as any

describe('outputAnalytics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
    mockWriteFile.mockResolvedValue(undefined)
  })

  it('sets exit code and prints JSON for failed result in JSON mode', async () => {
    await outputAnalytics(
      { ok: false, message: 'failed', code: 5 },
      { filepath: '', outputKind: 'json', repo: 'r', scope: 'org', time: 7 },
    )

    expect(process.exitCode).toBe(5)
    expect(mockLogger.log).toHaveBeenCalled()
    expect(mockLogger.fail).not.toHaveBeenCalled()
  })

  it('sets exit code and uses logger.fail for failed result in text mode', async () => {
    await outputAnalytics(
      { ok: false, message: 'failed' },
      { filepath: '', outputKind: 'text', repo: 'r', scope: 'org', time: 7 },
    )

    expect(process.exitCode).toBe(1)
    expect(mockLogger.fail).toHaveBeenCalled()
  })

  it('writes JSON to disk when filepath is provided', async () => {
    await outputAnalytics(
      { ok: true, data: sampleData },
      {
        filepath: '/tmp/analytics.json',
        outputKind: 'json',
        repo: 'r',
        scope: 'org',
        time: 7,
      },
    )

    expect(mockWriteFile).toHaveBeenCalledWith(
      '/tmp/analytics.json',
      expect.any(String),
      'utf8',
    )
    expect(mockLogger.success).toHaveBeenCalledWith(
      expect.stringContaining('Data successfully written'),
    )
  })

  it('handles JSON write failure gracefully', async () => {
    mockWriteFile.mockRejectedValueOnce(new Error('disk full'))

    await outputAnalytics(
      { ok: true, data: sampleData },
      {
        filepath: '/tmp/analytics.json',
        outputKind: 'json',
        repo: 'r',
        scope: 'org',
        time: 7,
      },
    )

    expect(process.exitCode).toBe(1)
    expect(mockLogger.log).toHaveBeenCalledWith(
      expect.stringContaining('File Write Failure'),
    )
  })

  it('logs JSON to stdout when no filepath is provided', async () => {
    await outputAnalytics(
      { ok: true, data: sampleData },
      { filepath: '', outputKind: 'json', repo: 'r', scope: 'org', time: 7 },
    )

    expect(mockWriteFile).not.toHaveBeenCalled()
    expect(mockLogger.log).toHaveBeenCalled()
  })

  it('writes markdown to disk when filepath is provided', async () => {
    await outputAnalytics(
      { ok: true, data: sampleData },
      {
        filepath: '/tmp/analytics.md',
        outputKind: 'markdown',
        repo: 'r',
        scope: 'org',
        time: 7,
      },
    )

    expect(mockWriteFile).toHaveBeenCalledWith(
      '/tmp/analytics.md',
      expect.any(String),
      'utf8',
    )
    expect(mockLogger.success).toHaveBeenCalled()
  })

  it('handles markdown write failure gracefully', async () => {
    mockWriteFile.mockRejectedValueOnce(new Error('disk full'))

    await outputAnalytics(
      { ok: true, data: sampleData },
      {
        filepath: '/tmp/analytics.md',
        outputKind: 'markdown',
        repo: 'r',
        scope: 'org',
        time: 7,
      },
    )

    expect(mockLogger.error).toHaveBeenCalled()
  })

  it('logs markdown to stdout when no filepath is provided', async () => {
    await outputAnalytics(
      { ok: true, data: sampleData },
      {
        filepath: '',
        outputKind: 'markdown',
        repo: 'r',
        scope: 'org',
        time: 7,
      },
    )

    expect(mockWriteFile).not.toHaveBeenCalled()
    expect(mockLogger.log).toHaveBeenCalled()
  })

  it('uses iocraft renderer for text mode', async () => {
    await outputAnalytics(
      { ok: true, data: sampleData },
      { filepath: '', outputKind: 'text', repo: 'r', scope: 'org', time: 7 },
    )

    expect(mockDisplayAnalyticsWithIocraft).toHaveBeenCalled()
  })

  it('uses formatDataRepo for repo scope', async () => {
    // The renderer receives the formatted data; just verify it's called.
    await outputAnalytics(
      { ok: true, data: sampleData },
      { filepath: '', outputKind: 'text', repo: 'my-repo', scope: 'repo', time: 7 },
    )

    expect(mockDisplayAnalyticsWithIocraft).toHaveBeenCalled()
  })
})
