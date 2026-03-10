/**
 * Unit tests for ci command.
 *
 * Tests the command that creates scans for CI environments.
 *
 * Test Coverage:
 * - Command metadata (description, hidden flag)
 * - --dry-run flag support
 * - --auto-manifest flag support
 * - Handler invocation with correct parameters
 * - Git operation integration (branch, repo name)
 * - Organization slug fetching
 *
 * Testing Approach:
 * - Mock logger to capture output
 * - Mock meowOrExit to control flag values
 * - Mock handleCi to verify handler is called correctly
 * - Mock git operations (gitBranch, detectDefaultBranch, getRepoName)
 * - Mock getDefaultOrgSlug for organization fetching
 * - Mock outputDryRunUpload for dry-run testing
 *
 * Related Files:
 * - src/commands/ci/cmd-ci.mts - Implementation
 * - src/commands/ci/handle-ci.mts - Handler
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
  const actual =
    await importOriginal<typeof import('@socketsecurity/lib/logger')>()
  return {
    ...actual,
    getDefaultLogger: () => mockLogger,
  }
})

// Mock handler.
const mockHandleCi = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/commands/ci/handle-ci.mts', () => ({
  handleCi: mockHandleCi,
}))

// Mock git operations.
const mockGitBranch = vi.hoisted(() => vi.fn(() => Promise.resolve('main')))
const mockDetectDefaultBranch = vi.hoisted(() =>
  vi.fn(() => Promise.resolve('main')),
)
const mockGetRepoName = vi.hoisted(() =>
  vi.fn(() => Promise.resolve('my-repo')),
)

vi.mock('../../../../src/utils/git/operations.mjs', () => ({
  detectDefaultBranch: mockDetectDefaultBranch,
  getRepoName: mockGetRepoName,
  gitBranch: mockGitBranch,
}))

// Mock organization slug fetching.
const mockGetDefaultOrgSlug = vi.hoisted(() =>
  vi.fn(() => Promise.resolve({ ok: true, data: 'my-org' })),
)

vi.mock('../../../../src/commands/ci/fetch-default-org-slug.mts', () => ({
  getDefaultOrgSlug: mockGetDefaultOrgSlug,
}))

// Mock dry-run output.
const mockOutputDryRunUpload = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/utils/dry-run/output.mts', () => ({
  outputDryRunUpload: mockOutputDryRunUpload,
}))

// Mock meowOrExit to prevent actual CLI parsing.
const mockMeowOrExit = vi.hoisted(() =>
  vi.fn((options: { argv: string[] | readonly string[] }) => {
    const argv = options.argv
    const flags: Record<string, unknown> = {}

    // Parse flags from argv.
    if (argv.includes('--dry-run')) {
      flags['dryRun'] = true
    }
    if (argv.includes('--auto-manifest')) {
      flags['autoManifest'] = true
    }

    return {
      flags,
      help: '',
      input: [],
      pkg: {},
    }
  }),
)

vi.mock(
  '../../../../src/utils/cli/with-subcommands.mjs',
  async importOriginal => {
    const actual =
      await importOriginal<
        typeof import('../../../../src/utils/cli/with-subcommands.mjs')
      >()
    return {
      ...actual,
      meowOrExit: mockMeowOrExit,
    }
  },
)

// Import after mocks.
const { cmdCI } = await import('../../../../src/commands/ci/cmd-ci.mts')

describe('cmd-ci', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
    mockGetDefaultOrgSlug.mockResolvedValue({ ok: true, data: 'my-org' })
    mockGitBranch.mockResolvedValue('main')
    mockDetectDefaultBranch.mockResolvedValue('main')
    mockGetRepoName.mockResolvedValue('my-repo')
  })

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(cmdCI.description).toBe(
        'Alias for `socket scan create --report` (creates report and exits with error if unhealthy)',
      )
    })

    it('should not be hidden', () => {
      expect(cmdCI.hidden).toBe(false)
    })
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-ci.mts' }
    const context = { parentName: 'socket' }

    describe('handler invocation', () => {
      it('should call handler with autoManifest false by default', async () => {
        await cmdCI.run([], importMeta, context)

        expect(mockHandleCi).toHaveBeenCalledWith(false)
      })

      it('should call handler with autoManifest true when flag provided', async () => {
        await cmdCI.run(['--auto-manifest'], importMeta, context)

        expect(mockHandleCi).toHaveBeenCalledWith(true)
      })

      it('should call handler exactly once', async () => {
        await cmdCI.run([], importMeta, context)

        expect(mockHandleCi).toHaveBeenCalledTimes(1)
      })
    })

    describe('--dry-run flag', () => {
      it('should show preview without calling handler', async () => {
        await cmdCI.run(['--dry-run'], importMeta, context)

        expect(mockOutputDryRunUpload).toHaveBeenCalledWith('CI scan', {
          autoManifest: false,
          branchName: 'main',
          cwd: process.cwd(),
          organizationSlug: 'my-org',
          repoName: 'my-repo',
          report: true,
          targets: ['.'],
        })
        expect(mockHandleCi).not.toHaveBeenCalled()
      })

      it('should fetch org slug in dry-run', async () => {
        await cmdCI.run(['--dry-run'], importMeta, context)

        expect(mockGetDefaultOrgSlug).toHaveBeenCalled()
      })

      it('should fetch git branch in dry-run', async () => {
        await cmdCI.run(['--dry-run'], importMeta, context)

        expect(mockGitBranch).toHaveBeenCalledWith(process.cwd())
      })

      it('should fetch repo name in dry-run', async () => {
        await cmdCI.run(['--dry-run'], importMeta, context)

        expect(mockGetRepoName).toHaveBeenCalledWith(process.cwd())
      })

      it('should include autoManifest true in dry-run when flag provided', async () => {
        await cmdCI.run(['--dry-run', '--auto-manifest'], importMeta, context)

        expect(mockOutputDryRunUpload).toHaveBeenCalledWith(
          'CI scan',
          expect.objectContaining({
            autoManifest: true,
          }),
        )
      })

      it('should use default branch when git branch fails', async () => {
        mockGitBranch.mockResolvedValue(null)
        mockDetectDefaultBranch.mockResolvedValue('develop')

        await cmdCI.run(['--dry-run'], importMeta, context)

        expect(mockOutputDryRunUpload).toHaveBeenCalledWith(
          'CI scan',
          expect.objectContaining({
            branchName: 'develop',
          }),
        )
      })

      it('should show placeholder when org slug fetch fails', async () => {
        mockGetDefaultOrgSlug.mockResolvedValue({
          ok: false,
          code: 1,
          message: 'Failed',
        })

        await cmdCI.run(['--dry-run'], importMeta, context)

        expect(mockOutputDryRunUpload).toHaveBeenCalledWith(
          'CI scan',
          expect.objectContaining({
            organizationSlug: '(from API token)',
          }),
        )
      })

      it('should show placeholder when repo name is null', async () => {
        mockGetRepoName.mockResolvedValue(null)

        await cmdCI.run(['--dry-run'], importMeta, context)

        expect(mockOutputDryRunUpload).toHaveBeenCalledWith(
          'CI scan',
          expect.objectContaining({
            repoName: '(auto-detected)',
          }),
        )
      })

      it('should show placeholder when branch name is null', async () => {
        mockGitBranch.mockResolvedValue(null)
        mockDetectDefaultBranch.mockResolvedValue(null)

        await cmdCI.run(['--dry-run'], importMeta, context)

        expect(mockOutputDryRunUpload).toHaveBeenCalledWith(
          'CI scan',
          expect.objectContaining({
            branchName: '(default)',
          }),
        )
      })
    })

    describe('--auto-manifest flag', () => {
      it('should default to false', async () => {
        await cmdCI.run([], importMeta, context)

        expect(mockHandleCi).toHaveBeenCalledWith(false)
      })

      it('should pass true when flag provided', async () => {
        await cmdCI.run(['--auto-manifest'], importMeta, context)

        expect(mockHandleCi).toHaveBeenCalledWith(true)
      })

      it('should handle boolean conversion correctly', async () => {
        await cmdCI.run(['--auto-manifest'], importMeta, context)

        const [autoManifest] = mockHandleCi.mock.calls[0]
        expect(typeof autoManifest).toBe('boolean')
        expect(autoManifest).toBe(true)
      })
    })

    describe('git operations', () => {
      it('should call gitBranch with current directory', async () => {
        await cmdCI.run(['--dry-run'], importMeta, context)

        expect(mockGitBranch).toHaveBeenCalledWith(process.cwd())
      })

      it('should fall back to detectDefaultBranch when gitBranch returns null', async () => {
        mockGitBranch.mockResolvedValue(null)

        await cmdCI.run(['--dry-run'], importMeta, context)

        expect(mockDetectDefaultBranch).toHaveBeenCalledWith(process.cwd())
      })

      it('should call getRepoName with current directory', async () => {
        await cmdCI.run(['--dry-run'], importMeta, context)

        expect(mockGetRepoName).toHaveBeenCalledWith(process.cwd())
      })

      it('should use gitBranch result over detectDefaultBranch', async () => {
        mockGitBranch.mockResolvedValue('feature-branch')
        mockDetectDefaultBranch.mockResolvedValue('main')

        await cmdCI.run(['--dry-run'], importMeta, context)

        expect(mockOutputDryRunUpload).toHaveBeenCalledWith(
          'CI scan',
          expect.objectContaining({
            branchName: 'feature-branch',
          }),
        )
      })
    })

    describe('organization slug', () => {
      it('should fetch default org slug', async () => {
        await cmdCI.run(['--dry-run'], importMeta, context)

        expect(mockGetDefaultOrgSlug).toHaveBeenCalled()
      })

      it('should use org slug from successful fetch', async () => {
        mockGetDefaultOrgSlug.mockResolvedValue({
          ok: true,
          data: 'test-org',
        })

        await cmdCI.run(['--dry-run'], importMeta, context)

        expect(mockOutputDryRunUpload).toHaveBeenCalledWith(
          'CI scan',
          expect.objectContaining({
            organizationSlug: 'test-org',
          }),
        )
      })

      it('should handle org slug fetch error', async () => {
        mockGetDefaultOrgSlug.mockResolvedValue({
          ok: false,
          code: 1,
          message: 'Auth failed',
        })

        await cmdCI.run(['--dry-run'], importMeta, context)

        expect(mockOutputDryRunUpload).toHaveBeenCalledWith(
          'CI scan',
          expect.objectContaining({
            organizationSlug: '(from API token)',
          }),
        )
      })
    })

    describe('edge cases', () => {
      it('should handle readonly argv array', async () => {
        const readonlyArgv = Object.freeze([]) as readonly string[]

        await cmdCI.run(readonlyArgv, importMeta, context)

        expect(mockHandleCi).toHaveBeenCalledWith(false)
      })

      it('should handle all git operations returning null', async () => {
        mockGitBranch.mockResolvedValue(null)
        mockDetectDefaultBranch.mockResolvedValue(null)
        mockGetRepoName.mockResolvedValue(null)

        await cmdCI.run(['--dry-run'], importMeta, context)

        expect(mockOutputDryRunUpload).toHaveBeenCalledWith(
          'CI scan',
          expect.objectContaining({
            branchName: '(default)',
            repoName: '(auto-detected)',
          }),
        )
      })

      it('should handle git operations throwing errors gracefully', async () => {
        mockGitBranch.mockRejectedValue(new Error('Git not found'))

        await expect(
          cmdCI.run(['--dry-run'], importMeta, context),
        ).rejects.toThrow('Git not found')
      })

      it('should handle org slug fetch throwing errors', async () => {
        mockGetDefaultOrgSlug.mockRejectedValue(new Error('Network error'))

        await expect(
          cmdCI.run(['--dry-run'], importMeta, context),
        ).rejects.toThrow('Network error')
      })
    })

    describe('dry-run output structure', () => {
      it('should include report true in dry-run', async () => {
        await cmdCI.run(['--dry-run'], importMeta, context)

        expect(mockOutputDryRunUpload).toHaveBeenCalledWith(
          'CI scan',
          expect.objectContaining({
            report: true,
          }),
        )
      })

      it('should include targets array in dry-run', async () => {
        await cmdCI.run(['--dry-run'], importMeta, context)

        expect(mockOutputDryRunUpload).toHaveBeenCalledWith(
          'CI scan',
          expect.objectContaining({
            targets: ['.'],
          }),
        )
      })

      it('should include cwd in dry-run', async () => {
        await cmdCI.run(['--dry-run'], importMeta, context)

        expect(mockOutputDryRunUpload).toHaveBeenCalledWith(
          'CI scan',
          expect.objectContaining({
            cwd: process.cwd(),
          }),
        )
      })
    })
  })
})
