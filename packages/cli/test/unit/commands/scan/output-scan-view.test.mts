/**
 * Unit tests for scan view output formatting.
 *
 * Purpose:
 * Tests the output formatting for scan view results.
 *
 * Test Coverage:
 * - outputScanView function
 * - JSON output format
 * - Markdown/Text output format
 * - File writing
 * - Error handling
 *
 * Related Files:
 * - src/commands/scan/output-scan-view.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock fs.
const mockWriteFile = vi.hoisted(() => vi.fn())
vi.mock('node:fs/promises', () => ({
  default: {
    writeFile: mockWriteFile,
  },
}))

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
  mdTable: <T,>(data: T[], _columns: string[]) =>
    `| Table with ${(data as T[]).length} rows |`,
}))

vi.mock('../../../../src/utils/output/result-json.mjs', () => ({
  serializeResultJson: (result: unknown) => JSON.stringify(result, null, 2),
}))

vi.mock('../../../../src/utils/terminal/link.mts', () => ({
  fileLink: (path: string) => path,
}))

import { outputScanView } from '../../../../src/commands/scan/output-scan-view.mts'

import type { CResult } from '../../../../src/types.mts'
import type { SocketArtifact } from '../../../../src/utils/alert/artifact.mts'

describe('output-scan-view', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  describe('outputScanView', () => {
    const mockArtifacts: SocketArtifact[] = [
      {
        type: 'npm',
        name: 'lodash',
        version: '4.17.21',
        author: ['John Dalton'],
        score: { overall: 0.8 } as any,
      } as SocketArtifact,
    ]

    describe('JSON output', () => {
      it('outputs success result as JSON', async () => {
        const result: CResult<SocketArtifact[]> = {
          ok: true,
          data: mockArtifacts,
        }

        await outputScanView(result, 'my-org', 'scan-123', '', 'json')

        expect(mockLogger.log).toHaveBeenCalledWith(
          expect.stringContaining('"ok": true'),
        )
      })

      it('outputs error result as JSON', async () => {
        const result: CResult<SocketArtifact[]> = {
          ok: false,
          message: 'Scan not found',
        }

        await outputScanView(result, 'my-org', 'scan-123', '', 'json')

        expect(mockLogger.log).toHaveBeenCalledWith(
          expect.stringContaining('"ok": false'),
        )
      })

      it('writes JSON to file when path provided', async () => {
        mockWriteFile.mockResolvedValue(undefined)
        const result: CResult<SocketArtifact[]> = {
          ok: true,
          data: mockArtifacts,
        }

        await outputScanView(result, 'my-org', 'scan-123', '/output.json', 'json')

        expect(mockWriteFile).toHaveBeenCalled()
        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.stringContaining('/output.json'),
        )
      })

      it('handles file write errors', async () => {
        mockWriteFile.mockRejectedValue(new Error('Permission denied'))
        const result: CResult<SocketArtifact[]> = {
          ok: true,
          data: mockArtifacts,
        }

        await outputScanView(result, 'my-org', 'scan-123', '/output.json', 'json')

        expect(mockLogger.fail).toHaveBeenCalledWith(
          expect.stringContaining('error'),
        )
        expect(process.exitCode).toBe(1)
      })
    })

    describe('Text output', () => {
      it('outputs scan details', async () => {
        const result: CResult<SocketArtifact[]> = {
          ok: true,
          data: mockArtifacts,
        }

        await outputScanView(result, 'my-org', 'scan-123', '', 'text')

        const logs = mockLogger.log.mock.calls.map(c => c[0]).join('')
        expect(logs).toContain('Scan Details')
        expect(logs).toContain('scan-123')
      })

      it('handles artifacts with array authors', async () => {
        const result: CResult<SocketArtifact[]> = {
          ok: true,
          data: [
            {
              type: 'npm',
              name: 'test-pkg',
              version: '1.0.0',
              author: ['Author 1', 'Author 2'],
              score: { overall: 0.9 } as any,
            } as SocketArtifact,
          ],
        }

        await outputScanView(result, 'my-org', 'scan-123', '', 'text')

        // Should show "et.al." for multiple authors.
        expect(mockLogger.log).toHaveBeenCalled()
      })

      it('handles artifacts with empty author array', async () => {
        const result: CResult<SocketArtifact[]> = {
          ok: true,
          data: [
            {
              type: 'npm',
              name: 'test-pkg',
              version: '1.0.0',
              author: [],
              score: { overall: 0.9 } as any,
            } as SocketArtifact,
          ],
        }

        await outputScanView(result, 'my-org', 'scan-123', '', 'text')

        expect(mockLogger.log).toHaveBeenCalled()
      })

      it('writes to file when path provided', async () => {
        mockWriteFile.mockResolvedValue(undefined)
        const result: CResult<SocketArtifact[]> = {
          ok: true,
          data: mockArtifacts,
        }

        await outputScanView(result, 'my-org', 'scan-123', '/output.md', 'text')

        expect(mockWriteFile).toHaveBeenCalled()
      })

      it('outputs error with fail message', async () => {
        const result: CResult<SocketArtifact[]> = {
          ok: false,
          message: 'Scan failed',
        }

        await outputScanView(result, 'my-org', 'scan-123', '', 'text')

        expect(mockLogger.fail).toHaveBeenCalledWith(
          expect.stringContaining('Scan failed'),
        )
      })
    })

    describe('Exit code handling', () => {
      it('sets exit code on error', async () => {
        const result: CResult<SocketArtifact[]> = {
          ok: false,
          message: 'Failed',
        }

        await outputScanView(result, 'my-org', 'scan-123', '', 'text')

        expect(process.exitCode).toBe(1)
      })

      it('uses custom exit code when provided', async () => {
        const result: CResult<SocketArtifact[]> = {
          ok: false,
          message: 'Failed',
          code: 2,
        }

        await outputScanView(result, 'my-org', 'scan-123', '', 'text')

        expect(process.exitCode).toBe(2)
      })
    })
  })
})
