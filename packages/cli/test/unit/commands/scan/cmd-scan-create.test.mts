/**
 * Unit tests for scan create command.
 *
 * Tests the command that creates new Socket scans.
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

// Mock dependencies.
const mockHandleCreateNewScan = vi.hoisted(() => vi.fn())
const mockOutputCreateNewScan = vi.hoisted(() => vi.fn())
const mockSuggestOrgSlug = vi.hoisted(() =>
  vi.fn().mockResolvedValue('test-org'),
)
const mockSuggestTarget = vi.hoisted(() => vi.fn().mockResolvedValue(['.']))
const mockValidateReachabilityTarget = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    isDirectory: true,
    isInsideCwd: true,
    isValid: true,
    targetExists: true,
  }),
)
const mockDetermineOrgSlug = vi.hoisted(() =>
  vi.fn().mockResolvedValue(['test-org', 'test-org']),
)
const mockHasDefaultApiToken = vi.hoisted(() => vi.fn().mockReturnValue(false))
const mockReadOrDefaultSocketJsonUp = vi.hoisted(() =>
  vi.fn().mockResolvedValue({}),
)
const mockDetectManifestActions = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ count: 0 }),
)
const mockGitBranch = vi.hoisted(() => vi.fn().mockResolvedValue(''))
const mockDetectDefaultBranch = vi.hoisted(() =>
  vi.fn().mockResolvedValue('main'),
)
const mockGetRepoName = vi.hoisted(() => vi.fn().mockResolvedValue('test-repo'))

vi.mock('../../../../src/commands/scan/handle-create-new-scan.mts', () => ({
  handleCreateNewScan: mockHandleCreateNewScan,
}))

vi.mock('../../../../src/commands/scan/output-create-new-scan.mts', () => ({
  outputCreateNewScan: mockOutputCreateNewScan,
}))

vi.mock('../../../../src/commands/scan/suggest-org-slug.mts', () => ({
  suggestOrgSlug: mockSuggestOrgSlug,
}))

vi.mock('../../../../src/commands/scan/suggest_target.mts', () => ({
  suggestTarget: mockSuggestTarget,
}))

vi.mock(
  '../../../../src/commands/scan/validate-reachability-target.mts',
  () => ({
    validateReachabilityTarget: mockValidateReachabilityTarget,
  }),
)

vi.mock('../../../../src/utils/socket/org-slug.mts', () => ({
  determineOrgSlug: mockDetermineOrgSlug,
}))

vi.mock('../../../../src/utils/socket/sdk.mts', async importOriginal => {
  const actual =
    await importOriginal<
      typeof import('../../../../src/utils/socket/sdk.mts')
    >()
  return {
    ...actual,
    hasDefaultApiToken: mockHasDefaultApiToken,
  }
})

vi.mock('../../../../src/utils/socket/json.mts', () => ({
  readOrDefaultSocketJsonUp: mockReadOrDefaultSocketJsonUp,
}))

vi.mock(
  '../../../../src/commands/manifest/detect-manifest-actions.mts',
  () => ({
    detectManifestActions: mockDetectManifestActions,
  }),
)

vi.mock('../../../../src/utils/git/operations.mts', () => ({
  detectDefaultBranch: mockDetectDefaultBranch,
  getRepoName: mockGetRepoName,
  gitBranch: mockGitBranch,
}))

// Import after mocks.
const { cmdScanCreate } =
  await import('../../../../src/commands/scan/cmd-scan-create.mts')

describe('cmd-scan-create', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(cmdScanCreate.description).toBe(
        'Create a new Socket scan and report',
      )
    })

    it('should not be hidden', () => {
      expect(cmdScanCreate.hidden).toBe(false)
    })
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-scan-create.mts' }
    const context = { parentName: 'socket scan' }

    it('should support --dry-run flag', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanCreate.run(
        ['--dry-run', '--org', 'test-org', '.'],
        importMeta,
        context,
      )

      expect(mockHandleCreateNewScan).not.toHaveBeenCalled()
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('DryRun'),
      )
    })

    it('should fail without Socket API token', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(false)

      await cmdScanCreate.run(
        ['--org', 'test-org', '.', '--no-interactive'],
        importMeta,
        context,
      )

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandleCreateNewScan).not.toHaveBeenCalled()
    })

    it('should call handleCreateNewScan with valid inputs', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanCreate.run(
        ['--org', 'test-org', '.', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockHandleCreateNewScan).toHaveBeenCalledWith(
        expect.objectContaining({
          autoManifest: false,
          basics: false,
          branchName: 'main',
          cwd: expect.any(String),
          defaultBranch: false,
          interactive: false,
          orgSlug: 'test-org',
          outputKind: 'text',
          pendingHead: true,
          repoName: 'test-repo',
          report: false,
          tmp: false,
        }),
      )
    })

    it('should pass --org flag to handleCreateNewScan', async () => {
      mockDetermineOrgSlug.mockResolvedValueOnce(['custom-org', 'custom-org'])
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanCreate.run(
        ['--org', 'custom-org', '.', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockDetermineOrgSlug).toHaveBeenCalledWith(
        'custom-org',
        false,
        false,
      )
      expect(mockHandleCreateNewScan).toHaveBeenCalledWith(
        expect.objectContaining({
          orgSlug: 'custom-org',
        }),
      )
    })

    it('should pass --repo flag to handleCreateNewScan', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanCreate.run(
        ['--org', 'test-org', '--repo', 'my-repo', '.', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockHandleCreateNewScan).toHaveBeenCalledWith(
        expect.objectContaining({
          repoName: 'my-repo',
        }),
      )
    })

    it('should pass --branch flag to handleCreateNewScan', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanCreate.run(
        ['--org', 'test-org', '--branch', 'develop', '.', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockHandleCreateNewScan).toHaveBeenCalledWith(
        expect.objectContaining({
          branchName: 'develop',
        }),
      )
    })

    it('should enable reachability analysis with --reach flag', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanCreate.run(
        ['--org', 'test-org', '--reach', '.', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockHandleCreateNewScan).toHaveBeenCalledWith(
        expect.objectContaining({
          reach: expect.objectContaining({
            runReachabilityAnalysis: true,
          }),
        }),
      )
    })

    it('should validate target when --reach is enabled', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)
      mockValidateReachabilityTarget.mockResolvedValueOnce({
        isDirectory: false,
        isInsideCwd: true,
        isValid: true,
        targetExists: true,
      })

      await cmdScanCreate.run(
        ['--org', 'test-org', '--reach', './package.json', '--no-interactive'],
        importMeta,
        context,
      )

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandleCreateNewScan).not.toHaveBeenCalled()
    })

    it('should fail when --reach target does not exist', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)
      mockValidateReachabilityTarget.mockResolvedValueOnce({
        isDirectory: true,
        isInsideCwd: true,
        isValid: true,
        targetExists: false,
      })

      await cmdScanCreate.run(
        ['--org', 'test-org', '--reach', './nonexistent', '--no-interactive'],
        importMeta,
        context,
      )

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandleCreateNewScan).not.toHaveBeenCalled()
    })

    it('should fail when --reach target is outside cwd', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)
      mockValidateReachabilityTarget.mockResolvedValueOnce({
        isDirectory: true,
        isInsideCwd: false,
        isValid: true,
        targetExists: true,
      })

      await cmdScanCreate.run(
        ['--org', 'test-org', '--reach', '../outside', '--no-interactive'],
        importMeta,
        context,
      )

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandleCreateNewScan).not.toHaveBeenCalled()
    })

    it('should pass reachability options when --reach is enabled', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanCreate.run(
        [
          '--org',
          'test-org',
          '--reach',
          '--reach-ecosystems',
          'npm,pypi',
          '--reach-concurrency',
          '4',
          '--reach-debug',
          '.',
          '--no-interactive',
        ],
        importMeta,
        context,
      )

      expect(mockHandleCreateNewScan).toHaveBeenCalledWith(
        expect.objectContaining({
          reach: expect.objectContaining({
            runReachabilityAnalysis: true,
            reachConcurrency: 4,
            reachDebug: true,
            reachEcosystems: ['npm', 'pypi'],
          }),
        }),
      )
    })

    it('should fail if reachability flags used without --reach', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanCreate.run(
        [
          '--org',
          'test-org',
          '--reach-concurrency',
          '4',
          '.',
          '--no-interactive',
        ],
        importMeta,
        context,
      )

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandleCreateNewScan).not.toHaveBeenCalled()
    })

    it('should support --json output mode', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanCreate.run(
        ['--org', 'test-org', '--json', '.', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockHandleCreateNewScan).toHaveBeenCalledWith(
        expect.objectContaining({
          outputKind: 'json',
        }),
      )
    })

    it('should support --markdown output mode', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanCreate.run(
        ['--org', 'test-org', '--markdown', '.', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockHandleCreateNewScan).toHaveBeenCalledWith(
        expect.objectContaining({
          outputKind: 'markdown',
        }),
      )
    })

    it('should fail when both --json and --markdown are set', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanCreate.run(
        ['--org', 'test-org', '--json', '--markdown', '.', '--no-interactive'],
        importMeta,
        context,
      )

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandleCreateNewScan).not.toHaveBeenCalled()
    })

    it('should pass --default-branch flag to handleCreateNewScan', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanCreate.run(
        [
          '--org',
          'test-org',
          '--branch',
          'main',
          '--default-branch',
          '.',
          '--no-interactive',
        ],
        importMeta,
        context,
      )

      expect(mockHandleCreateNewScan).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultBranch: true,
          branchName: 'main',
        }),
      )
    })

    it('should fail when --default-branch is set without --branch', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)
      mockGitBranch.mockResolvedValueOnce('')
      mockDetectDefaultBranch.mockResolvedValueOnce('')

      await cmdScanCreate.run(
        ['--org', 'test-org', '--default-branch', '.', '--no-interactive'],
        importMeta,
        context,
      )

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockHandleCreateNewScan).not.toHaveBeenCalled()
    })

    it('should pass --tmp flag to handleCreateNewScan', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanCreate.run(
        ['--org', 'test-org', '--tmp', '.', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockHandleCreateNewScan).toHaveBeenCalledWith(
        expect.objectContaining({
          tmp: true,
          pendingHead: false,
        }),
      )
    })

    it('should use socket.json defaults for branch', async () => {
      mockReadOrDefaultSocketJsonUp.mockResolvedValueOnce({
        defaults: {
          scan: {
            create: {
              branch: 'develop',
            },
          },
        },
      })
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanCreate.run(
        ['--org', 'test-org', '.', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockHandleCreateNewScan).toHaveBeenCalledWith(
        expect.objectContaining({
          branchName: 'develop',
        }),
      )
    })

    it('should use socket.json defaults for repo', async () => {
      mockReadOrDefaultSocketJsonUp.mockResolvedValueOnce({
        defaults: {
          scan: {
            create: {
              repo: 'my-project',
            },
          },
        },
      })
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanCreate.run(
        ['--org', 'test-org', '.', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockHandleCreateNewScan).toHaveBeenCalledWith(
        expect.objectContaining({
          repoName: 'my-project',
        }),
      )
    })

    it('should use socket.json defaults for autoManifest', async () => {
      mockReadOrDefaultSocketJsonUp.mockResolvedValueOnce({
        defaults: {
          scan: {
            create: {
              autoManifest: true,
            },
          },
        },
      })
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanCreate.run(
        ['--org', 'test-org', '.', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockHandleCreateNewScan).toHaveBeenCalledWith(
        expect.objectContaining({
          autoManifest: true,
        }),
      )
    })

    it('should use socket.json defaults for report', async () => {
      mockReadOrDefaultSocketJsonUp.mockResolvedValueOnce({
        defaults: {
          scan: {
            create: {
              report: true,
            },
          },
        },
      })
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanCreate.run(
        ['--org', 'test-org', '.', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockHandleCreateNewScan).toHaveBeenCalledWith(
        expect.objectContaining({
          report: true,
        }),
      )
    })

    it('should override socket.json defaults with CLI flags', async () => {
      mockReadOrDefaultSocketJsonUp.mockResolvedValueOnce({
        defaults: {
          scan: {
            create: {
              branch: 'main',
              repo: 'default-repo',
              autoManifest: true,
            },
          },
        },
      })
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanCreate.run(
        [
          '--org',
          'test-org',
          '--branch',
          'develop',
          '--repo',
          'cli-repo',
          '--no-auto-manifest',
          '.',
          '--no-interactive',
        ],
        importMeta,
        context,
      )

      expect(mockHandleCreateNewScan).toHaveBeenCalledWith(
        expect.objectContaining({
          branchName: 'develop',
          repoName: 'cli-repo',
          autoManifest: false,
        }),
      )
    })

    it('should validate invalid ecosystem value', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await expect(
        cmdScanCreate.run(
          [
            '--org',
            'test-org',
            '--reach',
            '--reach-ecosystems',
            'invalid-ecosystem',
            '.',
            '--no-interactive',
          ],
          importMeta,
          context,
        ),
      ).rejects.toThrow(/Invalid ecosystem/)
    })

    it('should pass --commit-hash flag to handleCreateNewScan', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanCreate.run(
        [
          '--org',
          'test-org',
          '--commit-hash',
          'abc123',
          '.',
          '--no-interactive',
        ],
        importMeta,
        context,
      )

      expect(mockHandleCreateNewScan).toHaveBeenCalledWith(
        expect.objectContaining({
          commitHash: 'abc123',
        }),
      )
    })

    it('should pass --commit-message flag to handleCreateNewScan', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanCreate.run(
        [
          '--org',
          'test-org',
          '--commit-message',
          'fix: bug',
          '.',
          '--no-interactive',
        ],
        importMeta,
        context,
      )

      expect(mockHandleCreateNewScan).toHaveBeenCalledWith(
        expect.objectContaining({
          commitMessage: 'fix: bug',
        }),
      )
    })

    it('should pass --pull-request flag to handleCreateNewScan', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanCreate.run(
        ['--org', 'test-org', '--pull-request', '123', '.', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockHandleCreateNewScan).toHaveBeenCalledWith(
        expect.objectContaining({
          pullRequest: 123,
        }),
      )
    })

    it('should pass --basics flag to handleCreateNewScan', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanCreate.run(
        ['--org', 'test-org', '--basics', '.', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockHandleCreateNewScan).toHaveBeenCalledWith(
        expect.objectContaining({
          basics: true,
        }),
      )
    })

    it('should default to current directory if no target specified', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanCreate.run(
        ['--org', 'test-org', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockHandleCreateNewScan).toHaveBeenCalledWith(
        expect.objectContaining({
          targets: [expect.any(String)],
        }),
      )
    })
  })
})
