/**
 * Unit tests for fix command.
 *
 * Tests misplaced-vulnerability-identifier detection and target-directory
 * validation for the command that fixes CVEs in dependencies. Command
 * metadata, flag parsing, and dry-run output cases live in
 * cmd-fix.test.mts.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { cmdFix } from '../../../../src/commands/fix/cmd-fix.mts'

import type * as LoggerModule from '@socketsecurity/lib-stable/logger/default'

// Mock the logger.
const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  fail: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
}))

vi.mock(
  import('@socketsecurity/lib-stable/logger/default'),
  async importOriginal => {
    const actual = await importOriginal<typeof LoggerModule>()
    return {
      ...actual,
      getDefaultLogger: () => mockLogger,
    }
  },
)

// Mock dependencies.
const mockHandleFix = vi.hoisted(() => vi.fn())
const mockGetDefaultOrgSlug = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ ok: true, data: 'test-org' }),
)

vi.mock(import('../../../../src/commands/fix/handle-fix.mts'), () => ({
  handleFix: mockHandleFix,
}))

vi.mock(
  import('../../../../src/commands/ci/fetch-default-org-slug.mts'),
  () => ({
    getDefaultOrgSlug: mockGetDefaultOrgSlug,
  }),
)

describe('cmd-fix', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-fix.mts' }
    const context = { parentName: 'socket' }

    describe('misplaced vulnerability identifier detection', () => {
      // The case matrix handle-fix.mts actually validates downstream:
      //   GHSA: /^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/
      //   CVE:  /^CVE-\d{4}-\d{4,}$/
      // Suggestion must be exactly the form that passes those regexes,
      // otherwise the user follows our advice and still gets an error.
      it.each([
        // [label, input, expectedSuggestion]
        // GHSA: prefix to upper, body to lower, regardless of input casing.
        ['canonical GHSA', 'GHSA-abcd-efgh-ijkl', 'GHSA-abcd-efgh-ijkl'],
        ['lowercase GHSA', 'ghsa-abcd-efgh-ijkl', 'GHSA-abcd-efgh-ijkl'],
        ['mixed-case GHSA', 'GhSa-AbCd-EfGh-IjKl', 'GHSA-abcd-efgh-ijkl'],
        // CVE: prefix to upper, body is digits so case is a no-op.
        ['canonical CVE', 'CVE-2021-23337', 'CVE-2021-23337'],
        ['lowercase CVE', 'cve-2021-23337', 'CVE-2021-23337'],
        // PURL: always lowercase by spec, echo verbatim.
        ['npm PURL', 'pkg:npm/left-pad@1.3.0', 'pkg:npm/left-pad@1.3.0'],
      ])(
        'detects %s and suggests the downstream-valid form',
        async (_label, input, expectedSuggestion) => {
          await cmdFix.run([input], importMeta, context)

          expect(process.exitCode).toBe(1)
          expect(mockHandleFix).not.toHaveBeenCalled()
          expect(mockLogger.fail).toHaveBeenCalledWith(
            expect.stringContaining(
              'looks like a vulnerability identifier, not a directory path',
            ),
          )
          expect(mockLogger.fail).toHaveBeenCalledWith(
            expect.stringContaining(`--id ${expectedSuggestion}`),
          )
        },
      )

      it('validates IDs before resolving the org slug (no API token path)', async () => {
        await cmdFix.run(['GHSA-xxxx-xxxx-xxxx'], importMeta, context)

        // The check must run *before* `getDefaultOrgSlug`, so users without
        // a configured API token still see the helpful message instead of
        // the generic "Unable to resolve org".
        expect(mockGetDefaultOrgSlug).not.toHaveBeenCalled()
      })
    })

    describe('target directory validation', () => {
      it('should fail fast when target directory does not exist', async () => {
        await cmdFix.run(['./this/path/does/not/exist'], importMeta, context)

        expect(process.exitCode).toBe(1)
        expect(mockHandleFix).not.toHaveBeenCalled()
        expect(mockLogger.fail).toHaveBeenCalledWith(
          expect.stringContaining('Target directory does not exist'),
        )
      })

      it('validates the directory before resolving the org slug', async () => {
        await cmdFix.run(['./this/path/does/not/exist'], importMeta, context)

        expect(mockGetDefaultOrgSlug).not.toHaveBeenCalled()
      })

      it('lets a real directory flow through to handleFix', async () => {
        const realDir = process.cwd()
        await cmdFix.run([realDir], importMeta, context)

        expect(mockHandleFix).toHaveBeenCalledWith(
          expect.objectContaining({ cwd: realDir }),
        )
        // Quick: no bail on the happy path.
        expect(mockLogger.fail).not.toHaveBeenCalledWith(
          expect.stringContaining('Target directory does not exist'),
        )
      })
    })
  })
})
