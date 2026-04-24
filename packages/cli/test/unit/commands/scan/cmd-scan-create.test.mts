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
      expect(mockLogger.error).toHaveBeenCalledWith(
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

    describe('--tmp flag', () => {
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

      it('should support -t short flag', async () => {
        mockHasDefaultApiToken.mockReturnValueOnce(true)

        await cmdScanCreate.run(
          ['--org', 'test-org', '-t', '.', '--no-interactive'],
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

      it('should force pendingHead=false even when --set-as-alerts-page is set', async () => {
        mockHasDefaultApiToken.mockReturnValueOnce(true)

        await cmdScanCreate.run(
          [
            '--org',
            'test-org',
            '--tmp',
            '--set-as-alerts-page',
            '.',
            '--no-interactive',
          ],
          importMeta,
          context,
        )

        // --tmp overrides --set-as-alerts-page.
        expect(mockHandleCreateNewScan).toHaveBeenCalledWith(
          expect.objectContaining({
            tmp: true,
            pendingHead: false,
          }),
        )
      })

      it('should support explicit --no-tmp', async () => {
        mockHasDefaultApiToken.mockReturnValueOnce(true)

        await cmdScanCreate.run(
          ['--org', 'test-org', '--no-tmp', '.', '--no-interactive'],
          importMeta,
          context,
        )

        expect(mockHandleCreateNewScan).toHaveBeenCalledWith(
          expect.objectContaining({
            tmp: false,
            pendingHead: true,
          }),
        )
      })

      it('should default tmp to false when not specified', async () => {
        mockHasDefaultApiToken.mockReturnValueOnce(true)

        await cmdScanCreate.run(
          ['--org', 'test-org', '.', '--no-interactive'],
          importMeta,
          context,
        )

        expect(mockHandleCreateNewScan).toHaveBeenCalledWith(
          expect.objectContaining({
            tmp: false,
          }),
        )
      })
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

    it('should use socket.json defaults for workspace', async () => {
      mockReadOrDefaultSocketJsonUp.mockResolvedValueOnce({
        defaults: {
          scan: {
            create: {
              workspace: 'my-workspace',
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
          workspace: 'my-workspace',
        }),
      )
    })

    it('should pass --workspace flag to handleCreateNewScan', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanCreate.run(
        [
          '--org',
          'test-org',
          '--workspace',
          'cli-workspace',
          '.',
          '--no-interactive',
        ],
        importMeta,
        context,
      )

      expect(mockHandleCreateNewScan).toHaveBeenCalledWith(
        expect.objectContaining({
          workspace: 'cli-workspace',
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
      ).rejects.toThrow(/--reach-ecosystems must be one of/)
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

    describe('numeric flag validation', () => {
      it('should validate --reach-analysis-memory-limit is a number', async () => {
        mockHasDefaultApiToken.mockReturnValueOnce(true)

        await expect(
          cmdScanCreate.run(
            [
              '--org',
              'test-org',
              '--reach',
              '--reach-analysis-memory-limit',
              'invalid',
              '.',
              '--no-interactive',
            ],
            importMeta,
            context,
          ),
        ).rejects.toThrow(/--reach-analysis-memory-limit must be a number of megabytes/)
      })

      it('should validate --reach-analysis-timeout is a number', async () => {
        mockHasDefaultApiToken.mockReturnValueOnce(true)

        await expect(
          cmdScanCreate.run(
            [
              '--org',
              'test-org',
              '--reach',
              '--reach-analysis-timeout',
              'invalid',
              '.',
              '--no-interactive',
            ],
            importMeta,
            context,
          ),
        ).rejects.toThrow(/--reach-analysis-timeout must be a number of seconds/)
      })

      it('should validate --reach-concurrency is a number', async () => {
        mockHasDefaultApiToken.mockReturnValueOnce(true)

        await expect(
          cmdScanCreate.run(
            [
              '--org',
              'test-org',
              '--reach',
              '--reach-concurrency',
              'invalid',
              '.',
              '--no-interactive',
            ],
            importMeta,
            context,
          ),
        ).rejects.toThrow(/--reach-concurrency must be a positive integer/)
      })
    })

    describe('interactive mode and suggestions', () => {
      it('should suggest org when interactive and no org set', async () => {
        mockHasDefaultApiToken.mockReturnValueOnce(true)
        mockDetermineOrgSlug.mockResolvedValueOnce(['', ''])
        mockSuggestOrgSlug.mockResolvedValueOnce('suggested-org')

        await cmdScanCreate.run(['.', '--interactive'], importMeta, context)

        expect(mockSuggestOrgSlug).toHaveBeenCalled()
        expect(mockHandleCreateNewScan).toHaveBeenCalledWith(
          expect.objectContaining({
            orgSlug: 'suggested-org',
          }),
        )
      })

      it('should output error when org suggestion is canceled', async () => {
        mockHasDefaultApiToken.mockReturnValueOnce(true)
        mockDetermineOrgSlug.mockResolvedValueOnce(['', ''])
        mockSuggestOrgSlug.mockResolvedValueOnce(undefined)

        await cmdScanCreate.run(['.', '--interactive'], importMeta, context)

        expect(mockOutputCreateNewScan).toHaveBeenCalledWith(
          expect.objectContaining({
            ok: false,
            message: 'Canceled by user',
          }),
          expect.any(Object),
        )
        expect(mockHandleCreateNewScan).not.toHaveBeenCalled()
      })

      it('should show manifest detection info when count > 0', async () => {
        mockHasDefaultApiToken.mockReturnValueOnce(true)
        mockDetectManifestActions.mockResolvedValueOnce({ count: 3 })

        await cmdScanCreate.run(
          ['--org', 'test-org', '.', '--no-interactive'],
          importMeta,
          context,
        )

        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.stringContaining('Detected 3 manifest targets'),
        )
      })

      it('should suggest targets when interactive with no targets', async () => {
        mockHasDefaultApiToken.mockReturnValueOnce(true)

        await cmdScanCreate.run(['--org', 'test-org'], importMeta, context)

        // With interactive true and no targets, defaults to cwd.
        expect(mockHandleCreateNewScan).toHaveBeenCalledWith(
          expect.objectContaining({
            targets: expect.any(Array),
          }),
        )
      })
    })

    describe('--cwd flag', () => {
      it('should use custom cwd when provided', async () => {
        mockHasDefaultApiToken.mockReturnValueOnce(true)

        await cmdScanCreate.run(
          ['--org', 'test-org', '--cwd', '/tmp/project', '.', '--no-interactive'],
          importMeta,
          context,
        )

        expect(mockHandleCreateNewScan).toHaveBeenCalledWith(
          expect.objectContaining({
            cwd: expect.stringContaining('/tmp/project'),
          }),
        )
      })
    })

    describe('--read-only flag', () => {
      it('should pass readOnly flag to handler', async () => {
        mockHasDefaultApiToken.mockReturnValueOnce(true)

        await cmdScanCreate.run(
          ['--org', 'test-org', '--read-only', '.', '--no-interactive'],
          importMeta,
          context,
        )

        expect(mockHandleCreateNewScan).toHaveBeenCalledWith(
          expect.objectContaining({
            readOnly: true,
          }),
        )
      })
    })

    describe('--report-level flag', () => {
      it('should pass reportLevel flag to handler', async () => {
        mockHasDefaultApiToken.mockReturnValueOnce(true)

        await cmdScanCreate.run(
          ['--org', 'test-org', '--report-level', 'warn', '.', '--no-interactive'],
          importMeta,
          context,
        )

        expect(mockHandleCreateNewScan).toHaveBeenCalledWith(
          expect.objectContaining({
            reportLevel: 'warn',
          }),
        )
      })
    })

    describe('--committers flag', () => {
      it('should pass committers flag to handler', async () => {
        mockHasDefaultApiToken.mockReturnValueOnce(true)

        await cmdScanCreate.run(
          [
            '--org',
            'test-org',
            '--committers',
            'user@example.com',
            '.',
            '--no-interactive',
          ],
          importMeta,
          context,
        )

        expect(mockHandleCreateNewScan).toHaveBeenCalledWith(
          expect.objectContaining({
            committers: 'user@example.com',
          }),
        )
      })
    })

    describe('dry-run with details', () => {
      it('should include repo and branch in dry-run output', async () => {
        mockHasDefaultApiToken.mockReturnValueOnce(true)

        await cmdScanCreate.run(
          [
            '--dry-run',
            '--org',
            'test-org',
            '--repo',
            'my-repo',
            '--branch',
            'develop',
            '.',
          ],
          importMeta,
          context,
        )

        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.stringContaining('DryRun'),
        )
      })

      it('should include reach info in dry-run output when --reach enabled', async () => {
        mockHasDefaultApiToken.mockReturnValueOnce(true)

        await cmdScanCreate.run(
          [
            '--dry-run',
            '--org',
            'test-org',
            '--reach',
            '.',
          ],
          importMeta,
          context,
        )

        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.stringContaining('DryRun'),
        )
      })
    })

    describe('reachability options', () => {
      it('should pass --reach-exclude-paths to handler', async () => {
        mockHasDefaultApiToken.mockReturnValueOnce(true)

        await cmdScanCreate.run(
          [
            '--org',
            'test-org',
            '--reach',
            '--reach-exclude-paths',
            'node_modules,dist',
            '--no-interactive',
          ],
          importMeta,
          context,
        )

        expect(mockHandleCreateNewScan).toHaveBeenCalledWith(
          expect.objectContaining({
            reach: expect.objectContaining({
              reachExcludePaths: ['node_modules', 'dist'],
            }),
          }),
        )
      })

      it('should pass --reach-lazy-mode to handler', async () => {
        mockHasDefaultApiToken.mockReturnValueOnce(true)

        await cmdScanCreate.run(
          [
            '--org',
            'test-org',
            '--reach',
            '--reach-lazy-mode',
            '.',
            '--no-interactive',
          ],
          importMeta,
          context,
        )

        expect(mockHandleCreateNewScan).toHaveBeenCalledWith(
          expect.objectContaining({
            reach: expect.objectContaining({
              reachLazyMode: true,
            }),
          }),
        )
      })

      it('should pass --reach-skip-cache to handler', async () => {
        mockHasDefaultApiToken.mockReturnValueOnce(true)

        await cmdScanCreate.run(
          [
            '--org',
            'test-org',
            '--reach',
            '--reach-skip-cache',
            '.',
            '--no-interactive',
          ],
          importMeta,
          context,
        )

        expect(mockHandleCreateNewScan).toHaveBeenCalledWith(
          expect.objectContaining({
            reach: expect.objectContaining({
              reachSkipCache: true,
            }),
          }),
        )
      })

      it('should pass --reach-enable-analysis-splitting to handler', async () => {
        mockHasDefaultApiToken.mockReturnValueOnce(true)

        await cmdScanCreate.run(
          [
            '--org',
            'test-org',
            '--reach',
            '--reach-enable-analysis-splitting',
            '.',
            '--no-interactive',
          ],
          importMeta,
          context,
        )

        expect(mockHandleCreateNewScan).toHaveBeenCalledWith(
          expect.objectContaining({
            reach: expect.objectContaining({
              reachEnableAnalysisSplitting: true,
            }),
          }),
        )
      })

      it('should pass --reach-disable-analytics to handler', async () => {
        mockHasDefaultApiToken.mockReturnValueOnce(true)

        await cmdScanCreate.run(
          [
            '--org',
            'test-org',
            '--reach',
            '--reach-disable-analytics',
            '.',
            '--no-interactive',
          ],
          importMeta,
          context,
        )

        expect(mockHandleCreateNewScan).toHaveBeenCalledWith(
          expect.objectContaining({
            reach: expect.objectContaining({
              reachDisableAnalytics: true,
            }),
          }),
        )
      })

      it('should pass --reach-min-severity to handler', async () => {
        mockHasDefaultApiToken.mockReturnValueOnce(true)

        await cmdScanCreate.run(
          [
            '--org',
            'test-org',
            '--reach',
            '--reach-min-severity',
            'high',
            '.',
            '--no-interactive',
          ],
          importMeta,
          context,
        )

        expect(mockHandleCreateNewScan).toHaveBeenCalledWith(
          expect.objectContaining({
            reach: expect.objectContaining({
              reachMinSeverity: 'high',
            }),
          }),
        )
      })

      it('should pass --reach-use-only-pregenerated-sboms to handler', async () => {
        mockHasDefaultApiToken.mockReturnValueOnce(true)

        await cmdScanCreate.run(
          [
            '--org',
            'test-org',
            '--reach',
            '--reach-use-only-pregenerated-sboms',
            '.',
            '--no-interactive',
          ],
          importMeta,
          context,
        )

        expect(mockHandleCreateNewScan).toHaveBeenCalledWith(
          expect.objectContaining({
            reach: expect.objectContaining({
              reachUseOnlyPregeneratedSboms: true,
            }),
          }),
        )
      })

      it('should pass --reach-use-unreachable-from-precomputation to handler', async () => {
        mockHasDefaultApiToken.mockReturnValueOnce(true)

        await cmdScanCreate.run(
          [
            '--org',
            'test-org',
            '--reach',
            '--reach-use-unreachable-from-precomputation',
            '.',
            '--no-interactive',
          ],
          importMeta,
          context,
        )

        expect(mockHandleCreateNewScan).toHaveBeenCalledWith(
          expect.objectContaining({
            reach: expect.objectContaining({
              reachUseUnreachableFromPrecomputation: true,
            }),
          }),
        )
      })
    })

    describe('--set-as-alerts-page flag', () => {
      it('should pass setAsAlertsPage=false with --no-set-as-alerts-page', async () => {
        mockHasDefaultApiToken.mockReturnValueOnce(true)

        await cmdScanCreate.run(
          ['--org', 'test-org', '--no-set-as-alerts-page', '.', '--no-interactive'],
          importMeta,
          context,
        )

        expect(mockHandleCreateNewScan).toHaveBeenCalledWith(
          expect.objectContaining({
            pendingHead: false,
          }),
        )
      })
    })

    describe('validation edge cases', () => {
      it('should fail when --pending-head is set without --branch', async () => {
        mockHasDefaultApiToken.mockReturnValueOnce(true)
        mockGitBranch.mockResolvedValueOnce('')
        mockDetectDefaultBranch.mockResolvedValueOnce('')

        await cmdScanCreate.run(
          ['--org', 'test-org', '--set-as-alerts-page', '.', '--no-interactive'],
          importMeta,
          context,
        )

        // Exit code 2 = invalid usage/validation failure.
        expect(process.exitCode).toBe(2)
        expect(mockHandleCreateNewScan).not.toHaveBeenCalled()
      })

      it('should fail when target not valid for reachability', async () => {
        mockHasDefaultApiToken.mockReturnValueOnce(true)
        mockValidateReachabilityTarget.mockResolvedValueOnce({
          isDirectory: true,
          isInsideCwd: true,
          isValid: false,
          targetExists: true,
        })

        await cmdScanCreate.run(
          ['--org', 'test-org', '--reach', '.', 'other', '--no-interactive'],
          importMeta,
          context,
        )

        // Exit code 2 = invalid usage/validation failure.
        expect(process.exitCode).toBe(2)
        expect(mockHandleCreateNewScan).not.toHaveBeenCalled()
      })
    })

    describe('--default-branch misuse detection', () => {
      it('fails when --default-branch=<name> is passed with a branch name', async () => {
        await cmdScanCreate.run(
          ['--org', 'test-org', '--default-branch=main', '.'],
          importMeta,
          context,
        )

        expect(process.exitCode).toBe(2)
        expect(mockHandleCreateNewScan).not.toHaveBeenCalled()
        expect(mockLogger.fail).toHaveBeenCalledWith(
          expect.stringContaining(
            '"--default-branch=main" looks like you meant to name the branch "main"',
          ),
        )
        expect(mockLogger.fail).toHaveBeenCalledWith(
          expect.stringContaining('--branch main --make-default-branch'),
        )
      })

      it('also catches the camelCase --defaultBranch=<name> variant', async () => {
        await cmdScanCreate.run(
          ['--org', 'test-org', '--defaultBranch=main', '.'],
          importMeta,
          context,
        )

        expect(process.exitCode).toBe(2)
        expect(mockHandleCreateNewScan).not.toHaveBeenCalled()
        expect(mockLogger.fail).toHaveBeenCalledWith(
          expect.stringContaining(
            'looks like you meant to name the branch "main"',
          ),
        )
        expect(mockLogger.fail).toHaveBeenCalledWith(
          expect.stringContaining('"--defaultBranch=main"'),
        )
      })

      it('catches the legacy space-separated --default-branch <name> form', async () => {
        await cmdScanCreate.run(
          ['--org', 'test-org', '--default-branch', 'main', '.'],
          importMeta,
          context,
        )

        expect(process.exitCode).toBe(2)
        expect(mockHandleCreateNewScan).not.toHaveBeenCalled()
        expect(mockLogger.fail).toHaveBeenCalledWith(
          expect.stringContaining(
            '"--default-branch main" looks like you meant to name the branch "main"',
          ),
        )
      })

      it('leaves the space-separated form alone when --branch is also passed', async () => {
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

        expect(mockLogger.fail).not.toHaveBeenCalledWith(
          expect.stringContaining('looks like you meant'),
        )
      })

      it('does not misfire when the next token looks like a target path', async () => {
        mockHasDefaultApiToken.mockReturnValueOnce(true)

        // `./some/dir` has path separators, so it is a positional target,
        // not a mistyped branch name.
        await cmdScanCreate.run(
          [
            '--org',
            'test-org',
            '--default-branch',
            './some/dir',
            '--no-interactive',
          ],
          importMeta,
          context,
        )

        expect(mockLogger.fail).not.toHaveBeenCalledWith(
          expect.stringContaining('looks like you meant'),
        )
      })

      it.each([
        '--default-branch=true',
        '--default-branch=false',
        '--default-branch=TRUE',
      ])('allows %s (explicit boolean form)', async arg => {
        mockHasDefaultApiToken.mockReturnValueOnce(true)

        await cmdScanCreate.run(
          [
            '--org',
            'test-org',
            '--branch',
            'main',
            arg,
            '.',
            '--no-interactive',
          ],
          importMeta,
          context,
        )

        expect(mockLogger.fail).not.toHaveBeenCalledWith(
          expect.stringContaining('looks like you meant the branch name'),
        )
      })

      it('allows bare --default-branch (default truthy form)', async () => {
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

        expect(mockLogger.fail).not.toHaveBeenCalledWith(
          expect.stringContaining('looks like you meant the branch name'),
        )
      })

      it('catches --make-default-branch=<name> misuse on the primary flag', async () => {
        await cmdScanCreate.run(
          ['--org', 'test-org', '--make-default-branch=main', '.'],
          importMeta,
          context,
        )

        expect(process.exitCode).toBe(2)
        expect(mockHandleCreateNewScan).not.toHaveBeenCalled()
        expect(mockLogger.fail).toHaveBeenCalledWith(
          expect.stringContaining(
            '"--make-default-branch=main" looks like you meant to name the branch "main"',
          ),
        )
      })
    })

    describe('--make-default-branch primary flag', () => {
      it('passes --make-default-branch through to handleCreateNewScan', async () => {
        mockHasDefaultApiToken.mockReturnValueOnce(true)

        await cmdScanCreate.run(
          [
            '--org',
            'test-org',
            '--branch',
            'main',
            '--make-default-branch',
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

      it('does not emit the deprecation warning for the primary name', async () => {
        mockHasDefaultApiToken.mockReturnValueOnce(true)

        await cmdScanCreate.run(
          [
            '--org',
            'test-org',
            '--branch',
            'main',
            '--make-default-branch',
            '.',
            '--no-interactive',
          ],
          importMeta,
          context,
        )

        expect(mockLogger.warn).not.toHaveBeenCalledWith(
          expect.stringContaining('--default-branch is deprecated'),
        )
      })
    })

    describe('--default-branch deprecation warning', () => {
      it('warns when the legacy --default-branch flag is used', async () => {
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

        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.stringContaining('--default-branch is deprecated'),
        )
        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.stringContaining('use --make-default-branch'),
        )
      })

      it('warns on the legacy camelCase --defaultBranch name', async () => {
        mockHasDefaultApiToken.mockReturnValueOnce(true)

        await cmdScanCreate.run(
          [
            '--org',
            'test-org',
            '--branch',
            'main',
            '--defaultBranch',
            '.',
            '--no-interactive',
          ],
          importMeta,
          context,
        )

        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.stringContaining('--default-branch is deprecated'),
        )
      })

      it('still wires the legacy flag through to handleCreateNewScan (back-compat)', async () => {
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
    })
  })
})
