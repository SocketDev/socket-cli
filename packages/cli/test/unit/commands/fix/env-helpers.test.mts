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

import {
  checkCiEnvVars,
  getCiEnvInstructions,
} from '../../../../src/commands/fix/env-helpers.mts'

describe('env-helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetCI.mockReturnValue(false)
    mockGetSocketCliGithubToken.mockReturnValue(undefined)
    mockGitEmail.SOCKET_CLI_GIT_USER_EMAIL = ''
    mockGitUser.SOCKET_CLI_GIT_USER_NAME = ''
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
})
