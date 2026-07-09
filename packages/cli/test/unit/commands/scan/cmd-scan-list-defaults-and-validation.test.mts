/**
 * Unit tests for scan list command — flag validation and defaults.
 *
 * Tests the command that lists scans for an organization.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { cmdScanList } from '../../../../src/commands/scan/cmd-scan-list.mts'

import type * as LoggerModule from '@socketsecurity/lib-stable/logger/default'
import type * as SdkModule from '../../../../src/util/socket/sdk.mjs'

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
const mockHandleListScans = vi.hoisted(() => vi.fn())
const mockDetermineOrgSlug = vi.hoisted(() =>
  vi.fn().mockResolvedValue(['test-org', 'test-org']),
)
const mockHasDefaultApiToken = vi.hoisted(() => vi.fn().mockReturnValue(false))

vi.mock(import('../../../../src/commands/scan/handle-list-scans.mts'), () => ({
  handleListScans: mockHandleListScans,
}))

vi.mock(import('../../../../src/util/socket/org-slug.mjs'), () => ({
  determineOrgSlug: mockDetermineOrgSlug,
}))

vi.mock(import('../../../../src/util/socket/sdk.mjs'), async importOriginal => {
  const actual = await importOriginal<typeof SdkModule>()
  return {
    ...actual,
    hasDefaultApiToken: mockHasDefaultApiToken,
  }
})

describe('cmd-scan-list', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-scan-list.mts' }
    const context = { parentName: 'socket scan' }

    it('throws InputError when --page is not a positive integer', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await expect(
        cmdScanList.run(
          ['--org', 'test-org', '--page', 'not-a-number'],
          importMeta,
          context,
        ),
      ).rejects.toThrow(/--page must be a positive integer/)
    })

    it('throws InputError when --per-page is not a positive integer', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await expect(
        cmdScanList.run(
          ['--org', 'test-org', '--per-page', 'oops'],
          importMeta,
          context,
        ),
      ).rejects.toThrow(/--per-page must be a positive integer/)
    })

    it('passes flag-default direction and sort to handleListScans', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanList.run(
        ['--org', 'test-org', '--no-interactive'],
        importMeta,
        context,
      )

      // The CLI flag schema sets defaults (direction=desc, sort=created_at).
      expect(mockHandleListScans).toHaveBeenCalledWith(
        expect.objectContaining({
          direction: 'desc',
          sort: 'created_at',
        }),
      )
    })

    it('uses default sort=created_at and direction=desc in dry-run output', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanList.run(
        ['--org', 'test-org', '--dry-run', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockHandleListScans).not.toHaveBeenCalled()
      // Defaults should appear in the dry-run output via outputDryRunFetch.
      const errors = mockLogger.error.mock.calls.flat().join(' ')
      expect(errors).toContain('created_at')
      expect(errors).toContain('desc')
    })
  })
})
