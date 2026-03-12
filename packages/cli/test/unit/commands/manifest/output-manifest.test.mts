/**
 * Unit tests for manifest output formatting.
 *
 * Purpose:
 * Tests the output formatting for manifest generation results.
 *
 * Test Coverage:
 * - outputManifest function
 * - JSON output format with file and stdout
 * - Markdown output format with file and stdout
 * - Error handling
 *
 * Related Files:
 * - src/commands/manifest/output-manifest.mts (implementation)
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

import { outputManifest } from '../../../../src/commands/manifest/output-manifest.mts'

import type { ManifestResult } from '../../../../src/commands/manifest/output-manifest.mts'
import type { CResult } from '../../../../src/types.mts'

describe('output-manifest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  describe('outputManifest', () => {
    const mockGradleResult: ManifestResult = {
      files: ['pom.xml', 'subproject/pom.xml'],
      type: 'gradle',
      success: true,
    }

    const mockSbtResult: ManifestResult = {
      files: ['pom.xml'],
      type: 'sbt',
      success: true,
    }

    describe('JSON output', () => {
      it('outputs success result as JSON to stdout', async () => {
        const result: CResult<ManifestResult> = {
          ok: true,
          data: mockGradleResult,
        }

        await outputManifest(result, 'json', '-')

        expect(mockLogger.log).toHaveBeenCalledWith(
          expect.stringContaining('"ok": true'),
        )
        expect(mockWriteFileSync).not.toHaveBeenCalled()
      })

      it('writes JSON to file when path provided', async () => {
        const result: CResult<ManifestResult> = {
          ok: true,
          data: mockGradleResult,
        }

        await outputManifest(result, 'json', '/output/result.json')

        expect(mockWriteFileSync).toHaveBeenCalledWith(
          '/output/result.json',
          expect.stringContaining('"ok": true'),
          'utf8',
        )
        expect(mockLogger.log).not.toHaveBeenCalled()
      })

      it('outputs error result as JSON', async () => {
        const result: CResult<ManifestResult> = {
          ok: false,
          message: 'Manifest generation failed',
        }

        await outputManifest(result, 'json', '-')

        expect(mockLogger.log).toHaveBeenCalledWith(
          expect.stringContaining('"ok": false'),
        )
        expect(process.exitCode).toBe(1)
      })
    })

    describe('Markdown output', () => {
      it('outputs Gradle manifest to stdout', async () => {
        const result: CResult<ManifestResult> = {
          ok: true,
          data: mockGradleResult,
        }

        await outputManifest(result, 'markdown', '-')

        const loggedMd = mockLogger.log.mock.calls[0]![0]
        expect(loggedMd).toContain('# Gradle Manifest Generation')
        expect(loggedMd).toContain('pom.xml')
        expect(loggedMd).toContain('subproject/pom.xml')
        expect(loggedMd).toContain('2 POM files')
        expect(loggedMd).toContain('## Next Steps')
        expect(loggedMd).toContain('socket scan create')
      })

      it('outputs SBT manifest to stdout', async () => {
        const result: CResult<ManifestResult> = {
          ok: true,
          data: mockSbtResult,
        }

        await outputManifest(result, 'markdown', '-')

        const loggedMd = mockLogger.log.mock.calls[0]![0]
        expect(loggedMd).toContain('# SBT Manifest Generation')
        expect(loggedMd).toContain('1 POM file')
      })

      it('writes markdown to file when path provided', async () => {
        const result: CResult<ManifestResult> = {
          ok: true,
          data: mockGradleResult,
        }

        await outputManifest(result, 'markdown', '/output/result.md')

        expect(mockWriteFileSync).toHaveBeenCalledWith(
          '/output/result.md',
          expect.stringContaining('Gradle Manifest Generation'),
          'utf8',
        )
      })
    })

    describe('Text output', () => {
      it('handles text output mode', async () => {
        const result: CResult<ManifestResult> = {
          ok: true,
          data: mockGradleResult,
        }

        // Text output is handled by converter functions directly.
        await outputManifest(result, 'text', '-')

        // Function should complete without error.
        expect(process.exitCode).toBeUndefined()
      })
    })

    describe('Error handling', () => {
      it('outputs error with fail message for non-JSON', async () => {
        const result: CResult<ManifestResult> = {
          ok: false,
          message: 'Build failed',
          cause: 'Gradle not found',
        }

        await outputManifest(result, 'text', '-')

        expect(mockLogger.fail).toHaveBeenCalledWith(
          expect.stringContaining('Build failed'),
        )
        expect(process.exitCode).toBe(1)
      })

      it('uses custom exit code when provided', async () => {
        const result: CResult<ManifestResult> = {
          ok: false,
          message: 'Failed',
          code: 127,
        }

        await outputManifest(result, 'text', '-')

        expect(process.exitCode).toBe(127)
      })
    })
  })
})
