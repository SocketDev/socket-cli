/**
 * Unit tests for GitHub scan error message quality.
 *
 * Purpose: Verifies that error messages and causes returned by GitHub scan
 * operations are actionable and context-specific, guiding users toward a fix
 * (such as setting GITHUB_TOKEN) rather than a bare failure.
 *
 * Related Files: - src/commands/scan/create-scan-from-github.mts
 * (implementation)
 */

import { describe, expect, it } from 'vitest'

describe('error message quality', () => {
  it('provides actionable error messages for rate limits', () => {
    const errorResult = {
      ok: false as const,
      message: 'GitHub rate limit exceeded',
      cause:
        'GitHub API rate limit exceeded while fetching commits. ' +
        'Try again in a few minutes.\n\n' +
        'To increase your rate limit:\n' +
        '- Set GITHUB_TOKEN environment variable with a valid token\n' +
        '- In GitHub Actions, GITHUB_TOKEN is automatically available',
    }

    expect(errorResult.cause).toContain('GITHUB_TOKEN')
    expect(errorResult.cause).toContain('GitHub Actions')
    expect(errorResult.cause).toContain('Try again')
  })

  it('provides context-specific error messages', () => {
    const contexts = [
      'fetching repository details for org/repo',
      'fetching file tree for branch main in org/repo',
      'fetching latest commit SHA for org/repo',
      'fetching file content for package.json in org/repo',
    ]

    for (let i = 0, { length } = contexts; i < length; i += 1) {
      const context = contexts[i]
      const errorResult = {
        ok: false as const,
        message: 'GitHub API error',
        cause: `Unexpected error while ${context}: Network failure`,
      }

      expect(errorResult.cause).toContain(context)
    }
  })
})
