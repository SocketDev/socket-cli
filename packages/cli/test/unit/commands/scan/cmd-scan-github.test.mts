/**
 * Unit tests for scan github command.
 *
 * Tests the command that creates scans for GitHub repositories.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the logger.
const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  fail: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
}))

vi.mock('@socketsecurity/lib/logger', async importOriginal => {
  const actual = await importOriginal<typeof import('@socketsecurity/lib/logger')>()
  return {
    ...actual,
    getDefaultLogger: () => mockLogger,
  }
})

// Mock environment functions.
vi.mock('@socketsecurity/lib/env/socket-cli', async importOriginal => {
  const actual = await importOriginal<typeof import('@socketsecurity/lib/env/socket-cli')>()
  return {
    ...actual,
    getSocketCliGithubToken: vi.fn().mockReturnValue(''),
  }
})

// Mock dependencies.
const mockHandleCreateGithubScan = vi.hoisted(() => vi.fn())
const mockOutputScanGithub = vi.hoisted(() => vi.fn())
const mockSuggestOrgSlug = vi.hoisted(() => vi.fn().mockResolvedValue('test-org'))
const mockDetermineOrgSlug = vi.hoisted(() =>
  vi.fn().mockResolvedValue(['test-org', 'test-org']),
)
const mockHasDefaultApiToken = vi.hoisted(() => vi.fn().mockReturnValue(false))

vi.mock('../../../../src/commands/scan/handle-create-github-scan.mts', () => ({
  handleCreateGithubScan: mockHandleCreateGithubScan,
}))

vi.mock('../../../../src/commands/scan/output-scan-github.mts', () => ({
  outputScanGithub: mockOutputScanGithub,
}))

vi.mock('../../../../src/commands/scan/suggest-org-slug.mts', () => ({
  suggestOrgSlug: mockSuggestOrgSlug,
}))

vi.mock('../../../../src/utils/socket/org-slug.mjs', () => ({
  determineOrgSlug: mockDetermineOrgSlug,
}))

vi.mock('../../../../src/utils/socket/sdk.mjs', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../../src/utils/socket/sdk.mjs')>()
  return {
    ...actual,
    hasDefaultApiToken: mockHasDefaultApiToken,
  }
})

vi.mock('../../../../src/utils/socket/json.mts', () => ({
  readOrDefaultSocketJson: vi.fn().mockReturnValue({}),
}))

// Import after mocks.
const { cmdScanGithub } = await import(
  '../../../../src/commands/scan/cmd-scan-github.mts'
)

describe('cmd-scan-github', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(cmdScanGithub.description).toBe('Create a scan for given GitHub repo')
    })

    it('should be hidden', () => {
      expect(cmdScanGithub.hidden).toBe(true)
    })
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-scan-github.mts' }
    const context = { parentName: 'socket scan' }

    it('should support --dry-run flag', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanGithub.run(
        ['--dry-run', '--github-token', 'test-token'],
        importMeta,
        context,
      )

      expect(mockHandleCreateGithubScan).not.toHaveBeenCalled()
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('DryRun'),
      )
    })

    it('should fail without Socket API token', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(false)

      await cmdScanGithub.run(
        ['--github-token', 'test-token', '--no-interactive'],
        importMeta,
        context,
      )

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandleCreateGithubScan).not.toHaveBeenCalled()
    })

    it('should fail without GitHub token', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanGithub.run(['--no-interactive'], importMeta, context)

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandleCreateGithubScan).not.toHaveBeenCalled()
    })

    it('should call handleCreateGithubScan with valid tokens', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanGithub.run(
        ['--github-token', 'test-token', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockHandleCreateGithubScan).toHaveBeenCalledWith(
        expect.objectContaining({
          githubToken: 'test-token',
          orgSlug: 'test-org',
        }),
      )
    })
  })
})
