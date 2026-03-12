/**
 * Unit tests for organization list output formatting.
 *
 * Purpose:
 * Tests the output formatting for organization list results.
 *
 * Test Coverage:
 * - outputOrganizationList function
 * - JSON output format
 * - Text output format
 * - Markdown output format
 * - Error handling
 *
 * Related Files:
 * - src/commands/organization/output-organization-list.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock yoctocolors.
vi.mock('yoctocolors-cjs', () => ({
  default: {
    bold: (s: string) => s,
    italic: (s: string) => s,
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
  mdHeader: (text: string) => `# ${text}`,
}))

vi.mock('../../../../src/utils/output/result-json.mjs', () => ({
  serializeResultJson: (result: unknown) => JSON.stringify(result, null, 2),
}))

const mockGetVisibleTokenPrefix = vi.hoisted(() => vi.fn(() => 'sk_live_'))
vi.mock('../../../../src/utils/socket/sdk.mjs', () => ({
  getVisibleTokenPrefix: mockGetVisibleTokenPrefix,
}))

import { outputOrganizationList } from '../../../../src/commands/organization/output-organization-list.mts'

import type { OrganizationsCResult } from '../../../../src/commands/organization/fetch-organization-list.mts'

describe('output-organization-list', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  describe('outputOrganizationList', () => {
    const mockOrganizations = [
      { id: 'org-1', name: 'My Org', slug: 'my-org', plan: 'pro' },
      { id: 'org-2', name: 'Other Org', slug: 'other-org', plan: 'free' },
    ]

    describe('JSON output', () => {
      it('outputs success result as JSON', async () => {
        const result: OrganizationsCResult = {
          ok: true,
          data: { organizations: mockOrganizations },
        }

        await outputOrganizationList(result, 'json')

        expect(mockLogger.log).toHaveBeenCalledWith(
          expect.stringContaining('"ok": true'),
        )
      })

      it('outputs error result as JSON', async () => {
        const result: OrganizationsCResult = {
          ok: false,
          message: 'Failed to fetch',
        }

        await outputOrganizationList(result, 'json')

        expect(mockLogger.log).toHaveBeenCalledWith(
          expect.stringContaining('"ok": false'),
        )
        expect(process.exitCode).toBe(1)
      })
    })

    describe('Text output', () => {
      it('outputs organization list in text format', async () => {
        const result: OrganizationsCResult = {
          ok: true,
          data: { organizations: mockOrganizations },
        }

        await outputOrganizationList(result, 'text')

        const logs = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
        expect(logs).toContain('sk_live_')
        expect(logs).toContain('My Org')
        expect(logs).toContain('Other Org')
      })

      it('outputs error with fail message', async () => {
        const result: OrganizationsCResult = {
          ok: false,
          message: 'Authentication failed',
          cause: 'Invalid token',
        }

        await outputOrganizationList(result, 'text')

        expect(mockLogger.fail).toHaveBeenCalledWith(
          expect.stringContaining('Authentication failed'),
        )
        expect(process.exitCode).toBe(1)
      })

      it('uses custom exit code when provided', async () => {
        const result: OrganizationsCResult = {
          ok: false,
          message: 'Rate limited',
          code: 429,
        }

        await outputOrganizationList(result, 'text')

        expect(process.exitCode).toBe(429)
      })
    })

    describe('Markdown output', () => {
      it('outputs organization list as markdown table', async () => {
        const result: OrganizationsCResult = {
          ok: true,
          data: { organizations: mockOrganizations },
        }

        await outputOrganizationList(result, 'markdown')

        const logs = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
        expect(logs).toContain('# Organizations')
        expect(logs).toContain('Name')
        expect(logs).toContain('ID')
        expect(logs).toContain('Plan')
        expect(logs).toContain('My Org')
        expect(logs).toContain('org-1')
      })

      it('handles organizations with missing name', async () => {
        const result: OrganizationsCResult = {
          ok: true,
          data: {
            organizations: [
              { id: 'org-1', name: undefined as any, slug: 'my-org', plan: 'pro' },
            ],
          },
        }

        await outputOrganizationList(result, 'markdown')

        // Should not throw.
        expect(mockLogger.log).toHaveBeenCalled()
      })
    })

    describe('Default output', () => {
      it('defaults to text output', async () => {
        const result: OrganizationsCResult = {
          ok: true,
          data: { organizations: mockOrganizations },
        }

        await outputOrganizationList(result)

        const logs = mockLogger.log.mock.calls.map(c => c[0]).join('\n')
        expect(logs).toContain('Name:')
        expect(logs).toContain('ID:')
        expect(logs).toContain('Plan:')
      })
    })
  })
})
