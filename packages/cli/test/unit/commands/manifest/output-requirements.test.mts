/**
 * Unit tests for requirements output formatting.
 *
 * Purpose:
 * Tests the output formatting for Conda to requirements.txt conversion results.
 *
 * Test Coverage:
 * - outputRequirements function
 * - JSON output format with file and stdout
 * - Markdown output format with file and stdout
 * - Text output format with file and stdout
 * - Error handling
 *
 * Related Files:
 * - src/commands/manifest/output-requirements.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock fs.
const mockWriteFileSync = vi.hoisted(() => vi.fn())
vi.mock('node:fs', () => ({
  default: {
    writeFileSync: mockWriteFileSync,
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
  mdHeader: (text: string, level = 1) => `${'#'.repeat(level)} ${text}`,
}))

vi.mock('../../../../src/utils/output/result-json.mjs', () => ({
  serializeResultJson: (result: unknown) => JSON.stringify(result, null, 2),
}))

import { outputRequirements } from '../../../../src/commands/manifest/output-requirements.mts'

import type { CResult } from '../../../../src/types.mts'

describe('output-requirements', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  describe('outputRequirements', () => {
    const mockSuccessData = {
      content: 'name: myenv\ndependencies:\n  - numpy\n  - pandas',
      pip: 'numpy\npandas',
    }

    describe('JSON output', () => {
      it('outputs success result as JSON to stdout', async () => {
        const result: CResult<typeof mockSuccessData> = {
          ok: true,
          data: mockSuccessData,
        }

        await outputRequirements(result, 'json', '-')

        expect(mockLogger.log).toHaveBeenCalledWith(
          expect.stringContaining('"ok": true'),
        )
        expect(mockWriteFileSync).not.toHaveBeenCalled()
      })

      it('writes JSON to file when path provided', async () => {
        const result: CResult<typeof mockSuccessData> = {
          ok: true,
          data: mockSuccessData,
        }

        await outputRequirements(result, 'json', '/output/result.json')

        expect(mockWriteFileSync).toHaveBeenCalledWith(
          '/output/result.json',
          expect.stringContaining('"ok": true'),
          'utf8',
        )
        expect(mockLogger.log).not.toHaveBeenCalled()
      })

      it('outputs error result as JSON', async () => {
        const result: CResult<typeof mockSuccessData> = {
          ok: false,
          message: 'Conversion failed',
        }

        await outputRequirements(result, 'json', '-')

        expect(mockLogger.log).toHaveBeenCalledWith(
          expect.stringContaining('"ok": false'),
        )
        expect(process.exitCode).toBe(1)
      })
    })

    describe('Markdown output', () => {
      it('outputs converted conda file as markdown to stdout', async () => {
        const result: CResult<typeof mockSuccessData> = {
          ok: true,
          data: mockSuccessData,
        }

        await outputRequirements(result, 'markdown', '-')

        const loggedMd = mockLogger.log.mock.calls[0]![0]
        expect(loggedMd).toContain('# Converted Conda file')
        expect(loggedMd).toContain('environment.yml')
        expect(loggedMd).toContain('requirements.txt')
        expect(loggedMd).toContain('numpy\npandas')
        expect(loggedMd).toContain('```')
      })

      it('writes markdown to file when path provided', async () => {
        const result: CResult<typeof mockSuccessData> = {
          ok: true,
          data: mockSuccessData,
        }

        await outputRequirements(result, 'markdown', '/output/result.md')

        expect(mockWriteFileSync).toHaveBeenCalledWith(
          '/output/result.md',
          expect.stringContaining('Converted Conda file'),
          'utf8',
        )
        expect(mockLogger.log).not.toHaveBeenCalled()
      })

      it('includes pip content in code block', async () => {
        const result: CResult<typeof mockSuccessData> = {
          ok: true,
          data: { content: 'yaml', pip: 'flask>=2.0\nrequests' },
        }

        await outputRequirements(result, 'markdown', '-')

        const loggedMd = mockLogger.log.mock.calls[0]![0]
        expect(loggedMd).toContain('flask>=2.0\nrequests')
      })
    })

    describe('Text output', () => {
      it('outputs pip content to stdout', async () => {
        const result: CResult<typeof mockSuccessData> = {
          ok: true,
          data: mockSuccessData,
        }

        await outputRequirements(result, 'text', '-')

        expect(mockLogger.log).toHaveBeenCalledWith('numpy\npandas')
        // Also outputs empty line.
        expect(mockLogger.log).toHaveBeenCalledWith('')
      })

      it('writes pip content to file when path provided', async () => {
        const result: CResult<typeof mockSuccessData> = {
          ok: true,
          data: mockSuccessData,
        }

        await outputRequirements(result, 'text', '/output/requirements.txt')

        expect(mockWriteFileSync).toHaveBeenCalledWith(
          '/output/requirements.txt',
          'numpy\npandas',
          'utf8',
        )
        expect(mockLogger.log).not.toHaveBeenCalled()
      })
    })

    describe('Error handling', () => {
      it('outputs error with fail message for non-JSON', async () => {
        const result: CResult<typeof mockSuccessData> = {
          ok: false,
          message: 'Conversion failed',
          cause: 'Invalid YAML format',
        }

        await outputRequirements(result, 'text', '-')

        expect(mockLogger.fail).toHaveBeenCalledWith(
          expect.stringContaining('Conversion failed'),
        )
        expect(process.exitCode).toBe(1)
      })

      it('uses custom exit code when provided', async () => {
        const result: CResult<typeof mockSuccessData> = {
          ok: false,
          message: 'Failed',
          code: 127,
        }

        await outputRequirements(result, 'text', '-')

        expect(process.exitCode).toBe(127)
      })

      it('sets exit code before processing for error result', async () => {
        const result: CResult<typeof mockSuccessData> = {
          ok: false,
          message: 'Failed',
          code: 2,
        }

        await outputRequirements(result, 'json', '-')

        expect(process.exitCode).toBe(2)
      })
    })
  })
})
