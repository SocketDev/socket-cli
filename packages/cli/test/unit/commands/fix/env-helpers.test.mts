/**
 * Unit Tests: CI Environment Variable Helper Functions
 *
 * Purpose:
 * Tests environment variable instruction generation for CI-based automated fix workflows.
 * Validates that the helper functions correctly format and document required environment
 * variables for enabling automatic pull request creation in CI environments.
 *
 * Test Coverage:
 * - Environment variable instruction generation with exact var names
 * - Instruction formatting and consistency validation
 * - CI environment variable checking
 *
 * Testing Approach:
 * Uses direct function invocation without mocks since env-helpers.mts provides pure
 * instruction generation functions. Tests verify string output format and content.
 * Actual environment variable checking is tested via integration tests.
 *
 * Related Files:
 * - src/commands/fix/env-helpers.mts - Environment variable helper functions
 * - src/commands/fix/handle-fix.mts - Main fix command handler that uses env helpers
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock @socketsecurity/lib/env/ci.
const mockGetCI = vi.hoisted(() => vi.fn())
vi.mock('@socketsecurity/lib/env/ci', () => ({
  getCI: mockGetCI,
}))

// Mock @socketsecurity/lib/env/socket-cli.
const mockGetSocketCliGithubToken = vi.hoisted(() => vi.fn())
vi.mock('@socketsecurity/lib/env/socket-cli', async importOriginal => {
  const actual =
    (await importOriginal()) as typeof import('@socketsecurity/lib/env/socket-cli')
  return {
    ...actual,
    getSocketCliGithubToken: mockGetSocketCliGithubToken,
  }
})

// Mock SOCKET_CLI_GIT_USER_EMAIL.
const mockGitEmail = vi.hoisted(() => ({ SOCKET_CLI_GIT_USER_EMAIL: '' }))
vi.mock('../../../../src/env/socket-cli-git-user-email.mts', () => mockGitEmail)

// Mock SOCKET_CLI_GIT_USER_NAME.
const mockGitUser = vi.hoisted(() => ({ SOCKET_CLI_GIT_USER_NAME: '' }))
vi.mock('../../../../src/env/socket-cli-git-user-name.mts', () => mockGitUser)

// Mock GITHUB_REPOSITORY.
const mockGithubRepo = vi.hoisted(() => ({ GITHUB_REPOSITORY: '' }))
vi.mock('../../../../src/env/github-repository.mts', () => mockGithubRepo)

// Mock git operations.
const mockGetBaseBranch = vi.hoisted(() =>
  vi.fn().mockResolvedValue('main'),
)
const mockGetRepoInfo = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ owner: 'test-owner', repo: 'test-repo' }),
)
vi.mock('../../../../src/utils/git/operations.mts', () => ({
  getBaseBranch: mockGetBaseBranch,
  getRepoInfo: mockGetRepoInfo,
}))

// Mock pull-request functions.
const mockGetSocketFixPrs = vi.hoisted(() => vi.fn().mockResolvedValue([]))
vi.mock('../../../../src/commands/fix/pull-request.mts', () => ({
  getSocketFixPrs: mockGetSocketFixPrs,
}))

// Mock logger.
const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  fail: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
}))
vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => mockLogger,
}))

// Mock debug.
const mockDebug = vi.hoisted(() => vi.fn())
const mockIsDebug = vi.hoisted(() => vi.fn(() => false))
vi.mock('@socketsecurity/lib/debug', () => ({
  debug: mockDebug,
  isDebug: mockIsDebug,
}))

import {
  checkCiEnvVars,
  getCiEnvInstructions,
  getFixEnv,
} from '../../../../src/commands/fix/env-helpers.mts'

describe('env-helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetCI.mockReturnValue(false)
    mockGetSocketCliGithubToken.mockReturnValue(undefined)
    mockGitEmail.SOCKET_CLI_GIT_USER_EMAIL = ''
    mockGitUser.SOCKET_CLI_GIT_USER_NAME = ''
    mockGithubRepo.GITHUB_REPOSITORY = ''
    mockGetBaseBranch.mockResolvedValue('main')
    mockGetRepoInfo.mockResolvedValue({ owner: 'test-owner', repo: 'test-repo' })
    mockGetSocketFixPrs.mockResolvedValue([])
    mockIsDebug.mockReturnValue(false)
  })

  describe('getCiEnvInstructions', () => {
    it('should return instructions with exact env var names', () => {
      const instructions = getCiEnvInstructions()

      // Check that exact env var names appear in instructions.
      expect(instructions).toContain('CI=1')
      expect(instructions).toContain('SOCKET_CLI_GITHUB_TOKEN')
      expect(instructions).toContain('SOCKET_CLI_GIT_USER_NAME')
      expect(instructions).toContain('SOCKET_CLI_GIT_USER_EMAIL')
    })

    it('should format env var names consistently', () => {
      const instructions = getCiEnvInstructions()
      const lines = instructions.split('\n')

      // First line is intro text.
      expect(lines[0]).toContain('To enable automatic pull request creation')

      // Check that each env var line contains the env var name.
      expect(lines[1]).toContain('CI=1')
      expect(lines[2]).toContain('SOCKET_CLI_GITHUB_TOKEN=')
      expect(lines[3]).toContain('SOCKET_CLI_GIT_USER_NAME=')
      expect(lines[4]).toContain('SOCKET_CLI_GIT_USER_EMAIL=')
    })
  })

  describe('checkCiEnvVars', () => {
    it('should return all missing when no env vars are set', () => {
      mockGetCI.mockReturnValue(false)
      mockGetSocketCliGithubToken.mockReturnValue(undefined)
      mockGitEmail.SOCKET_CLI_GIT_USER_EMAIL = ''
      mockGitUser.SOCKET_CLI_GIT_USER_NAME = ''

      const result = checkCiEnvVars()

      expect(result.missing).toHaveLength(4)
      expect(result.present).toHaveLength(0)
      expect(result.missing).toContain('CI')
      expect(result.missing).toContain('SOCKET_CLI_GIT_USER_EMAIL')
      expect(result.missing).toContain('SOCKET_CLI_GIT_USER_NAME')
      expect(result.missing).toContain(
        'SOCKET_CLI_GITHUB_TOKEN (or GITHUB_TOKEN)',
      )
    })

    it('should return CI as present when in CI environment', () => {
      mockGetCI.mockReturnValue(true)

      const result = checkCiEnvVars()

      expect(result.present).toContain('CI')
      expect(result.missing).not.toContain('CI')
    })

    it('should return GitHub token as present when set', () => {
      mockGetSocketCliGithubToken.mockReturnValue('ghp_test_token')

      const result = checkCiEnvVars()

      expect(result.present).toContain(
        'SOCKET_CLI_GITHUB_TOKEN (or GITHUB_TOKEN)',
      )
      expect(result.missing).not.toContain(
        'SOCKET_CLI_GITHUB_TOKEN (or GITHUB_TOKEN)',
      )
    })

    it('should return git user name as present when set', () => {
      mockGitUser.SOCKET_CLI_GIT_USER_NAME = 'test-user'

      const result = checkCiEnvVars()

      expect(result.present).toContain('SOCKET_CLI_GIT_USER_NAME')
      expect(result.missing).not.toContain('SOCKET_CLI_GIT_USER_NAME')
    })

    it('should return git email as present when set', () => {
      mockGitEmail.SOCKET_CLI_GIT_USER_EMAIL = 'test@example.com'

      const result = checkCiEnvVars()

      expect(result.present).toContain('SOCKET_CLI_GIT_USER_EMAIL')
      expect(result.missing).not.toContain('SOCKET_CLI_GIT_USER_EMAIL')
    })

    it('should return all present when all env vars are set', () => {
      mockGetCI.mockReturnValue(true)
      mockGetSocketCliGithubToken.mockReturnValue('ghp_test_token')
      mockGitUser.SOCKET_CLI_GIT_USER_NAME = 'test-user'
      mockGitEmail.SOCKET_CLI_GIT_USER_EMAIL = 'test@example.com'

      const result = checkCiEnvVars()

      expect(result.missing).toHaveLength(0)
      expect(result.present).toHaveLength(4)
    })
  })

  describe('getFixEnv', () => {
    it('should return basic fix env when not in CI', async () => {
      mockGetCI.mockReturnValue(false)

      const result = await getFixEnv()

      expect(result.isCi).toBe(false)
      expect(result.baseBranch).toBe('main')
      expect(result.prs).toEqual([])
      expect(result.repoInfo).toEqual({ owner: 'test-owner', repo: 'test-repo' })
    })

    it('should return isCi true when all CI vars are set', async () => {
      mockGetCI.mockReturnValue(true)
      mockGetSocketCliGithubToken.mockReturnValue('ghp_test_token')
      mockGitUser.SOCKET_CLI_GIT_USER_NAME = 'test-user'
      mockGitEmail.SOCKET_CLI_GIT_USER_EMAIL = 'test@example.com'
      mockGithubRepo.GITHUB_REPOSITORY = 'owner/repo'

      const result = await getFixEnv()

      expect(result.isCi).toBe(true)
      expect(result.gitUser).toBe('test-user')
      expect(result.gitEmail).toBe('test@example.com')
      expect(result.githubToken).toBe('ghp_test_token')
    })

    it('should use GITHUB_REPOSITORY env var for repoInfo in CI', async () => {
      mockGetCI.mockReturnValue(true)
      mockGetSocketCliGithubToken.mockReturnValue('ghp_test_token')
      mockGitUser.SOCKET_CLI_GIT_USER_NAME = 'test-user'
      mockGitEmail.SOCKET_CLI_GIT_USER_EMAIL = 'test@example.com'
      mockGithubRepo.GITHUB_REPOSITORY = 'my-owner/my-repo'

      const result = await getFixEnv()

      expect(result.repoInfo).toEqual({ owner: 'my-owner', repo: 'my-repo' })
      // Should not call getRepoInfo when GITHUB_REPOSITORY is valid.
      expect(mockGetRepoInfo).not.toHaveBeenCalled()
    })

    it('should fall back to getRepoInfo when GITHUB_REPOSITORY is invalid', async () => {
      mockGetCI.mockReturnValue(true)
      mockGetSocketCliGithubToken.mockReturnValue('ghp_test_token')
      mockGitUser.SOCKET_CLI_GIT_USER_NAME = 'test-user'
      mockGitEmail.SOCKET_CLI_GIT_USER_EMAIL = 'test@example.com'
      // Invalid GITHUB_REPOSITORY (no slash).
      mockGithubRepo.GITHUB_REPOSITORY = 'invalid-repo'

      const result = await getFixEnv()

      expect(result.repoInfo).toEqual({ owner: 'test-owner', repo: 'test-repo' })
      expect(mockGetRepoInfo).toHaveBeenCalled()
    })

    it('should fall back to getRepoInfo when GITHUB_REPOSITORY is empty', async () => {
      mockGetCI.mockReturnValue(true)
      mockGetSocketCliGithubToken.mockReturnValue('ghp_test_token')
      mockGitUser.SOCKET_CLI_GIT_USER_NAME = 'test-user'
      mockGitEmail.SOCKET_CLI_GIT_USER_EMAIL = 'test@example.com'
      mockGithubRepo.GITHUB_REPOSITORY = ''

      const result = await getFixEnv()

      expect(mockGetRepoInfo).toHaveBeenCalled()
    })

    it('should warn when CI is set but other vars are missing', async () => {
      mockGetCI.mockReturnValue(true)
      // Missing: githubToken, gitUser, gitEmail.
      mockGetSocketCliGithubToken.mockReturnValue(undefined)
      mockGitUser.SOCKET_CLI_GIT_USER_NAME = ''
      mockGitEmail.SOCKET_CLI_GIT_USER_EMAIL = ''

      await getFixEnv()

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('CI mode detected'),
      )
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Missing:'),
      )
    })

    it('should not warn when not in CI', async () => {
      mockGetCI.mockReturnValue(false)

      await getFixEnv()

      expect(mockLogger.warn).not.toHaveBeenCalled()
    })

    it('should log debug message when not in CI but some vars are set', async () => {
      mockGetCI.mockReturnValue(false)
      mockGetSocketCliGithubToken.mockReturnValue('ghp_test_token')
      mockIsDebug.mockReturnValue(true)

      await getFixEnv()

      expect(mockDebug).toHaveBeenCalledWith(
        expect.stringContaining('isCi is false'),
      )
    })

    it('should fetch PRs when in CI mode', async () => {
      mockGetCI.mockReturnValue(true)
      mockGetSocketCliGithubToken.mockReturnValue('ghp_test_token')
      mockGitUser.SOCKET_CLI_GIT_USER_NAME = 'test-user'
      mockGitEmail.SOCKET_CLI_GIT_USER_EMAIL = 'test@example.com'
      mockGithubRepo.GITHUB_REPOSITORY = 'owner/repo'
      mockGetSocketFixPrs.mockResolvedValue([
        { number: 1, title: 'Fix PR' },
      ])

      const result = await getFixEnv()

      expect(mockGetSocketFixPrs).toHaveBeenCalledWith('owner', 'repo', {
        author: 'test-user',
        states: 'all',
      })
      expect(result.prs).toEqual([{ number: 1, title: 'Fix PR' }])
    })

    it('should not fetch PRs when not in CI mode', async () => {
      mockGetCI.mockReturnValue(false)

      await getFixEnv()

      expect(mockGetSocketFixPrs).not.toHaveBeenCalled()
    })

    it('should return gitEmail and gitUser from env vars', async () => {
      mockGitUser.SOCKET_CLI_GIT_USER_NAME = 'custom-user'
      mockGitEmail.SOCKET_CLI_GIT_USER_EMAIL = 'custom@example.com'

      const result = await getFixEnv()

      expect(result.gitUser).toBe('custom-user')
      expect(result.gitEmail).toBe('custom@example.com')
    })

    it('should return undefined for gitEmail and gitUser when not set', async () => {
      mockGitUser.SOCKET_CLI_GIT_USER_NAME = ''
      mockGitEmail.SOCKET_CLI_GIT_USER_EMAIL = ''

      const result = await getFixEnv()

      expect(result.gitUser).toBe('')
      expect(result.gitEmail).toBe('')
    })
  })
})
