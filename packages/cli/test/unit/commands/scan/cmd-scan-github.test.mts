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
  const actual =
    await importOriginal<typeof import('@socketsecurity/lib/logger')>()
  return {
    ...actual,
    getDefaultLogger: () => mockLogger,
  }
})

// Mock environment functions.
vi.mock('@socketsecurity/lib/env/socket-cli', async importOriginal => {
  const actual =
    await importOriginal<typeof import('@socketsecurity/lib/env/socket-cli')>()
  return {
    ...actual,
    getSocketCliGithubToken: vi.fn().mockReturnValue(''),
  }
})

// Mock dependencies.
const mockHandleCreateGithubScan = vi.hoisted(() => vi.fn())
const mockOutputScanGithub = vi.hoisted(() => vi.fn())
const mockSuggestOrgSlug = vi.hoisted(() =>
  vi.fn().mockResolvedValue('test-org'),
)
const mockDetermineOrgSlug = vi.hoisted(() =>
  vi.fn().mockResolvedValue(['test-org', 'test-org']),
)
const mockHasDefaultApiToken = vi.hoisted(() => vi.fn().mockReturnValue(false))
const mockReadOrDefaultSocketJson = vi.hoisted(() =>
  vi.fn().mockReturnValue({}),
)

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
  const actual =
    await importOriginal<
      typeof import('../../../../src/utils/socket/sdk.mjs')
    >()
  return {
    ...actual,
    hasDefaultApiToken: mockHasDefaultApiToken,
  }
})

vi.mock('../../../../src/utils/socket/json.mts', () => ({
  readOrDefaultSocketJson: mockReadOrDefaultSocketJson,
}))

// Import after mocks.
const { cmdScanGithub } =
  await import('../../../../src/commands/scan/cmd-scan-github.mts')

describe('cmd-scan-github', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(cmdScanGithub.description).toBe(
        'Create a scan for given GitHub repo',
      )
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
      expect(mockLogger.error).toHaveBeenCalledWith(
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
          all: false,
          githubApiUrl: 'https://api.github.com',
          githubToken: 'test-token',
          interactive: false,
          orgSlug: 'test-org',
          orgGithub: 'test-org',
          outputKind: 'text',
          repos: '',
        }),
      )
    })

    it('should pass --all flag to handleCreateGithubScan', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanGithub.run(
        ['--github-token', 'test-token', '--all', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockHandleCreateGithubScan).toHaveBeenCalledWith(
        expect.objectContaining({
          all: true,
        }),
      )
    })

    it('should pass --repos flag to handleCreateGithubScan', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanGithub.run(
        [
          '--github-token',
          'test-token',
          '--repos',
          'repo1,repo2',
          '--no-interactive',
        ],
        importMeta,
        context,
      )

      expect(mockHandleCreateGithubScan).toHaveBeenCalledWith(
        expect.objectContaining({
          repos: 'repo1,repo2',
        }),
      )
    })

    it('should pass --org flag to handleCreateGithubScan', async () => {
      mockDetermineOrgSlug.mockResolvedValueOnce(['custom-org', 'custom-org'])
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanGithub.run(
        [
          '--github-token',
          'test-token',
          '--org',
          'custom-org',
          '--no-interactive',
        ],
        importMeta,
        context,
      )

      expect(mockDetermineOrgSlug).toHaveBeenCalledWith(
        'custom-org',
        false,
        false,
      )
      expect(mockHandleCreateGithubScan).toHaveBeenCalledWith(
        expect.objectContaining({
          orgSlug: 'custom-org',
        }),
      )
    })

    it('should pass --org-github flag to handleCreateGithubScan', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanGithub.run(
        [
          '--github-token',
          'test-token',
          '--org-github',
          'github-org',
          '--no-interactive',
        ],
        importMeta,
        context,
      )

      expect(mockHandleCreateGithubScan).toHaveBeenCalledWith(
        expect.objectContaining({
          orgGithub: 'github-org',
        }),
      )
    })

    it('should pass --github-api-url flag to handleCreateGithubScan', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanGithub.run(
        [
          '--github-token',
          'test-token',
          '--github-api-url',
          'https://custom.github.com',
          '--no-interactive',
        ],
        importMeta,
        context,
      )

      expect(mockHandleCreateGithubScan).toHaveBeenCalledWith(
        expect.objectContaining({
          githubApiUrl: 'https://custom.github.com',
        }),
      )
    })

    it('should use socket.json defaults for all flag', async () => {
      mockReadOrDefaultSocketJson.mockReturnValueOnce({
        defaults: {
          scan: {
            github: {
              all: true,
            },
          },
        },
      })
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanGithub.run(
        ['--github-token', 'test-token', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockHandleCreateGithubScan).toHaveBeenCalledWith(
        expect.objectContaining({
          all: true,
        }),
      )
    })

    it('should use socket.json defaults for repos', async () => {
      mockReadOrDefaultSocketJson.mockReturnValueOnce({
        defaults: {
          scan: {
            github: {
              repos: 'default-repo1,default-repo2',
            },
          },
        },
      })
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanGithub.run(
        ['--github-token', 'test-token', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockHandleCreateGithubScan).toHaveBeenCalledWith(
        expect.objectContaining({
          repos: 'default-repo1,default-repo2',
        }),
      )
    })

    it('should use socket.json defaults for orgGithub', async () => {
      mockReadOrDefaultSocketJson.mockReturnValueOnce({
        defaults: {
          scan: {
            github: {
              orgGithub: 'default-github-org',
            },
          },
        },
      })
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanGithub.run(
        ['--github-token', 'test-token', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockHandleCreateGithubScan).toHaveBeenCalledWith(
        expect.objectContaining({
          orgGithub: 'default-github-org',
        }),
      )
    })

    it('should support --json output mode', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanGithub.run(
        ['--github-token', 'test-token', '--json', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockHandleCreateGithubScan).toHaveBeenCalledWith(
        expect.objectContaining({
          outputKind: 'json',
        }),
      )
    })

    it('should support --markdown output mode', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanGithub.run(
        ['--github-token', 'test-token', '--markdown', '--no-interactive'],
        importMeta,
        context,
      )

      expect(mockHandleCreateGithubScan).toHaveBeenCalledWith(
        expect.objectContaining({
          outputKind: 'markdown',
        }),
      )
    })

    it('should override socket.json defaults with CLI flags', async () => {
      mockReadOrDefaultSocketJson.mockReturnValueOnce({
        defaults: {
          scan: {
            github: {
              all: true,
              repos: 'default-repo',
              githubApiUrl: 'https://default.github.com',
            },
          },
        },
      })
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanGithub.run(
        [
          '--github-token',
          'test-token',
          '--no-all',
          '--repos',
          'cli-repo',
          '--github-api-url',
          'https://cli.github.com',
          '--no-interactive',
        ],
        importMeta,
        context,
      )

      expect(mockHandleCreateGithubScan).toHaveBeenCalledWith(
        expect.objectContaining({
          all: false,
          repos: 'cli-repo',
          githubApiUrl: 'https://cli.github.com',
        }),
      )
    })
  })
})
