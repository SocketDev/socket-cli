/**
 * Unit tests for scan metadata output formatting.
 *
 * Purpose:
 * Tests the output formatting for scan metadata results.
 *
 * Test Coverage:
 * - outputScanMetadata function
 * - JSON output format
 * - Markdown output format
 * - Text output format
 * - Exit code handling
 *
 * Related Files:
 * - src/commands/scan/output-scan-metadata.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock logger.
const mockLogger = vi.hoisted(() => ({
  log: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  fail: vi.fn(),
  success: vi.fn(),
  info: vi.fn(),
}))
vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => mockLogger,
}))

// Mock utilities.
vi.mock('../../../../src/utils/error/fail-msg-with-badge.mts', () => ({
  failMsgWithBadge: (msg: string, cause?: string) =>
    cause ? `${msg}: ${cause}` : msg,
}))

vi.mock('../../../../src/utils/output/markdown.mts', () => ({
  mdHeader: (text: string) => `# ${text}`,
  mdKeyValue: (key: string, value: string) => `**${key}**: ${value}`,
}))

vi.mock('../../../../src/utils/output/result-json.mjs', () => ({
  serializeResultJson: (result: unknown) => JSON.stringify(result, null, 2),
}))

import { outputScanMetadata } from '../../../../src/commands/scan/output-scan-metadata.mts'

import type { CResult } from '../../../../src/types.mts'

describe('output-scan-metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  describe('outputScanMetadata', () => {
    const mockMetadata = {
      id: 'scan-123',
      updated_at: '2025-01-01',
      organization_id: 'org-1',
      repository_id: 'repo-1',
      commit_hash: 'abc123',
      html_report_url: 'https://socket.dev/report',
      name: 'my-project',
      status: 'completed',
    }

    describe('JSON output', () => {
      it('outputs success result as JSON', async () => {
        const result: CResult<typeof mockMetadata> = {
          ok: true,
          data: mockMetadata,
        }

        await outputScanMetadata(result, 'scan-123', 'json')

        expect(mockLogger.log).toHaveBeenCalledWith(
          expect.stringContaining('"ok": true'),
        )
      })

      it('outputs error result as JSON', async () => {
        const result: CResult<unknown> = {
          ok: false,
          message: 'Scan not found',
        }

        await outputScanMetadata(result as any, 'scan-123', 'json')

        expect(mockLogger.log).toHaveBeenCalledWith(
          expect.stringContaining('"ok": false'),
        )
      })
    })

    describe('Markdown output', () => {
      it('outputs metadata in markdown format', async () => {
        const result: CResult<typeof mockMetadata> = {
          ok: true,
          data: mockMetadata,
        }

        await outputScanMetadata(result, 'scan-123', 'markdown')

        const logs = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
        expect(logs).toContain('# Scan meta data')
        expect(logs).toContain('scan-123')
        expect(logs).toContain('name')
        expect(logs).toContain('my-project')
      })

      it('excludes certain fields from output', async () => {
        const result: CResult<typeof mockMetadata> = {
          ok: true,
          data: mockMetadata,
        }

        await outputScanMetadata(result, 'scan-123', 'markdown')

        const logs = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
        // Check that excluded fields are not in key-value pairs.
        expect(logs).not.toMatch(/- id: scan-123/)
        expect(logs).not.toMatch(/- organization_id:/)
        expect(logs).not.toMatch(/- repository_id:/)
        expect(logs).not.toMatch(/- commit_hash:/)
      })

      it('includes report URL', async () => {
        const result: CResult<typeof mockMetadata> = {
          ok: true,
          data: mockMetadata,
        }

        await outputScanMetadata(result, 'scan-123', 'markdown')

        const logs = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
        expect(logs).toContain('https://socket.dev/report')
      })
    })

    describe('Text output', () => {
      it('outputs metadata in text format', async () => {
        const result: CResult<typeof mockMetadata> = {
          ok: true,
          data: mockMetadata,
        }

        await outputScanMetadata(result, 'scan-123', 'text')

        const logs = mockLogger.log.mock.calls.map(c => c[0]).join(' ')
        expect(logs).toContain('Scan ID: scan-123')
      })

      it('outputs error with fail message', async () => {
        const result: CResult<unknown> = {
          ok: false,
          message: 'Scan not found',
          cause: 'Invalid ID',
        }

        await outputScanMetadata(result as any, 'scan-123', 'text')

        expect(mockLogger.fail).toHaveBeenCalledWith(
          expect.stringContaining('Scan not found'),
        )
      })
    })

    describe('Exit code handling', () => {
      it('sets exit code on error', async () => {
        const result: CResult<unknown> = {
          ok: false,
          message: 'Failed',
        }

        await outputScanMetadata(result as any, 'scan-123', 'text')

        expect(process.exitCode).toBe(1)
      })

      it('uses custom exit code when provided', async () => {
        const result: CResult<unknown> = {
          ok: false,
          message: 'Failed',
          code: 2,
        }

        await outputScanMetadata(result as any, 'scan-123', 'text')

        expect(process.exitCode).toBe(2)
      })
    })
  })
})
