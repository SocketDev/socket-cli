/**
 * Unit tests for scan github command.
 *
 * Tests socket.json default resolution, interactive org selection, and
 * dry-run detail output for the command that creates scans for GitHub
 * repositories.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { cmdScanGithub } from '../../../../src/commands/scan/cmd-scan-github.mts'

import type * as LoggerModule from '@socketsecurity/lib-stable/logger/default'
import type * as SdkModule from '../../../../src/util/socket/sdk.mjs'
import type * as SocketCliModule from '@socketsecurity/lib-stable/env/socket-cli'

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

// Mock environment functions.
vi.mock(
  import('@socketsecurity/lib-stable/env/socket-cli'),
  async importOriginal => {
    const actual = await importOriginal<typeof SocketCliModule>()
    return {
      ...actual,
      getSocketCliGithubToken: vi.fn().mockReturnValue(''),
    }
  },
)

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

vi.mock(
  import('../../../../src/commands/scan/handle-create-github-scan.mts'),
  () => ({
    handleCreateGithubScan: mockHandleCreateGithubScan,
  }),
)

vi.mock(import('../../../../src/commands/scan/output-scan-github.mts'), () => ({
  outputScanGithub: mockOutputScanGithub,
}))

vi.mock(import('../../../../src/commands/scan/suggest-org-slug.mts'), () => ({
  suggestOrgSlug: mockSuggestOrgSlug,
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

vi.mock(import('../../../../src/util/socket/json.mts'), () => ({
  readOrDefaultSocketJson: mockReadOrDefaultSocketJson,
}))

const mockOutputDryRunUpload = vi.hoisted(() => vi.fn())
vi.mock(import('../../../../src/util/dry-run/output.mts'), () => ({
  outputDryRunUpload: mockOutputDryRunUpload,
}))

describe('cmd-scan-github', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-scan-github.mts' }
    const context = { parentName: 'socket scan' }

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

    it('cancels when interactive org selector returns undefined', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)
      mockDetermineOrgSlug.mockResolvedValueOnce(['', ''])
      mockSuggestOrgSlug.mockResolvedValueOnce(undefined)

      await cmdScanGithub.run(['--github-token', 'gh_xxx'], importMeta, context)

      expect(mockOutputScanGithub).toHaveBeenCalledWith(
        expect.objectContaining({
          ok: false,
          message: 'Canceled by user',
        }),
        expect.any(String),
      )
      expect(mockHandleCreateGithubScan).not.toHaveBeenCalled()
    })

    it('uses suggested orgSlug when interactive selector returns one', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)
      mockDetermineOrgSlug.mockResolvedValueOnce(['', ''])
      mockSuggestOrgSlug.mockResolvedValueOnce('suggested-org')

      await cmdScanGithub.run(['--github-token', 'gh_xxx'], importMeta, context)

      expect(mockHandleCreateGithubScan).toHaveBeenCalledWith(
        expect.objectContaining({ orgSlug: 'suggested-org' }),
      )
    })

    it('uses sockJson defaults for orgGithub and repos when CLI flags absent', async () => {
      // Note: githubApiUrl has a flag-level default (DEFAULT_GITHUB_URL),
      // so the sockJson default branch for it doesn't fire here unless the
      // flag's default is also empty.
      mockReadOrDefaultSocketJson.mockReturnValueOnce({
        defaults: {
          scan: {
            github: {
              orgGithub: 'default-org-github',
              repos: 'default-repos',
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
          orgGithub: 'default-org-github',
          repos: 'default-repos',
        }),
      )
    })

    it('outputs dry-run details for --all (scope: all repositories)', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanGithub.run(
        [
          '--github-token',
          'test-token',
          '--all',
          '--dry-run',
          '--no-interactive',
        ],
        importMeta,
        context,
      )

      // Dry-run should call outputDryRunUpload with details containing 'scope'.
      expect(mockOutputDryRunUpload).toHaveBeenCalledWith(
        'GitHub scan',
        expect.objectContaining({ scope: 'all repositories' }),
      )
      expect(mockHandleCreateGithubScan).not.toHaveBeenCalled()
    })

    it('outputs dry-run details for --repos (repositories list)', async () => {
      mockHasDefaultApiToken.mockReturnValueOnce(true)

      await cmdScanGithub.run(
        [
          '--github-token',
          'test-token',
          '--repos',
          'foo,bar',
          '--dry-run',
          '--no-interactive',
        ],
        importMeta,
        context,
      )

      expect(mockOutputDryRunUpload).toHaveBeenCalledWith(
        'GitHub scan',
        expect.objectContaining({ repositories: 'foo,bar' }),
      )
    })
  })
})
