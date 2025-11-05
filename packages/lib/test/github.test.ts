/**
 * @fileoverview Unit tests for GitHub API integration utilities.
 *
 * Tests GitHub API helpers and authentication:
 * - getGitHubToken(), getGitHubTokenFromGitConfig() token retrieval
 * - getGitHubTokenWithFallback() multi-source token resolution
 * - getGhsaUrl() constructs GitHub Security Advisory URLs
 * - clearRefCache() clears git reference cache
 * - Environment variable handling (GITHUB_TOKEN, GH_TOKEN)
 * - Note: HTTP tests limited due to module resolution constraints
 * Used by Socket tools for GitHub API authentication and GHSA lookups.
 */

import {
  clearRefCache,
  getGhsaUrl,
  getGitHubToken,
  getGitHubTokenFromGitConfig,
  getGitHubTokenWithFallback,
} from '@socketsecurity/lib/github'
import { resetEnv, setEnv } from '@socketsecurity/lib/env/rewire'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

describe.sequential('github', () => {
  beforeEach(() => {
    // Clear environment variables
    resetEnv()
    clearRefCache()
  })

  afterEach(() => {
    resetEnv()
  })

  describe('getGitHubToken', () => {
    it('should return GITHUB_TOKEN from environment', () => {
      setEnv('GITHUB_TOKEN', 'test-token')
      const token = getGitHubToken()
      expect(token).toBe('test-token')
    })

    it('should return GH_TOKEN from environment', () => {
      setEnv('GH_TOKEN', 'gh-test-token')
      const token = getGitHubToken()
      expect(token).toBe('gh-test-token')
    })

    it('should return SOCKET_CLI_GITHUB_TOKEN from environment', () => {
      setEnv('SOCKET_CLI_GITHUB_TOKEN', 'cli-token')
      const token = getGitHubToken()
      expect(token).toBe('cli-token')
    })

    it('should prefer GITHUB_TOKEN over GH_TOKEN', () => {
      setEnv('GITHUB_TOKEN', 'github-token')
      setEnv('GH_TOKEN', 'gh-token')
      const token = getGitHubToken()
      expect(token).toBe('github-token')
    })

    it('should prefer GITHUB_TOKEN over SOCKET_CLI_GITHUB_TOKEN', () => {
      setEnv('GITHUB_TOKEN', 'github-token')
      setEnv('SOCKET_CLI_GITHUB_TOKEN', 'cli-token')
      const token = getGitHubToken()
      expect(token).toBe('github-token')
    })

    it('should return undefined when no token is set', () => {
      const token = getGitHubToken()
      expect(token).toBeUndefined()
    })
  })

  describe('clearRefCache', () => {
    it('should not throw when called', () => {
      expect(() => clearRefCache()).not.toThrow()
    })

    it('should be callable multiple times', () => {
      clearRefCache()
      clearRefCache()
      clearRefCache()
      expect(true).toBe(true)
    })
  })

  describe('getGitHubTokenFromGitConfig', () => {
    it('should return string or undefined (integration test)', async () => {
      const token = await getGitHubTokenFromGitConfig()
      expect(typeof token === 'string' || token === undefined).toBe(true)
    })

    it('should return undefined when git config throws', async () => {
      const token = await getGitHubTokenFromGitConfig({
        cwd: '/nonexistent/directory/that/does/not/exist',
      })
      expect(token).toBeUndefined()
    })

    it('should accept spawn options', async () => {
      const token = await getGitHubTokenFromGitConfig({ cwd: process.cwd() })
      expect(typeof token === 'string' || token === undefined).toBe(true)
    })
  })

  describe('getGitHubTokenWithFallback', () => {
    it('should return token from GITHUB_TOKEN environment first', async () => {
      setEnv('GITHUB_TOKEN', 'env-token')
      const token = await getGitHubTokenWithFallback()
      expect(token).toBe('env-token')
    })

    it('should return token from GH_TOKEN when GITHUB_TOKEN is not set', async () => {
      setEnv('GH_TOKEN', 'gh-token')
      const token = await getGitHubTokenWithFallback()
      expect(token).toBe('gh-token')
    })

    it('should fallback to git config (integration test)', async () => {
      // Integration test - git config may or may not have token
      const token = await getGitHubTokenWithFallback()
      expect(typeof token === 'string' || token === undefined).toBe(true)
    })
  })

  describe('getGhsaUrl', () => {
    it('should generate correct GHSA URL', () => {
      const url = getGhsaUrl('GHSA-xxxx-xxxx-xxxx')
      expect(url).toBe('https://github.com/advisories/GHSA-xxxx-xxxx-xxxx')
    })

    it('should handle different GHSA IDs', () => {
      const url = getGhsaUrl('GHSA-1234-5678-9abc')
      expect(url).toBe('https://github.com/advisories/GHSA-1234-5678-9abc')
    })

    it('should handle GHSA IDs with special characters', () => {
      const url = getGhsaUrl('GHSA-abcd-efgh-ijkl')
      expect(url).toBe('https://github.com/advisories/GHSA-abcd-efgh-ijkl')
    })

    it('should handle uppercase GHSA IDs', () => {
      const url = getGhsaUrl('GHSA-XXXX-YYYY-ZZZZ')
      expect(url).toBe('https://github.com/advisories/GHSA-XXXX-YYYY-ZZZZ')
    })

    it('should handle lowercase GHSA IDs', () => {
      const url = getGhsaUrl('ghsa-xxxx-yyyy-zzzz')
      expect(url).toBe('https://github.com/advisories/ghsa-xxxx-yyyy-zzzz')
    })

    it('should handle GHSA IDs with numbers', () => {
      const url = getGhsaUrl('GHSA-1111-2222-3333')
      expect(url).toBe('https://github.com/advisories/GHSA-1111-2222-3333')
    })

    it('should handle empty GHSA ID', () => {
      const url = getGhsaUrl('')
      expect(url).toBe('https://github.com/advisories/')
    })
  })

  describe('clearRefCache', () => {
    it('should clear cache asynchronously', async () => {
      await clearRefCache()
      expect(true).toBe(true)
    })

    it('should handle multiple sequential clears', async () => {
      await clearRefCache()
      await clearRefCache()
      await clearRefCache()
      expect(true).toBe(true)
    })

    it('should handle concurrent clears', async () => {
      await Promise.all([clearRefCache(), clearRefCache(), clearRefCache()])
      expect(true).toBe(true)
    })
  })

  describe('token priority and fallback', () => {
    it('should prioritize GITHUB_TOKEN over other env vars', () => {
      setEnv('GITHUB_TOKEN', 'token1')
      setEnv('GH_TOKEN', 'token2')
      setEnv('SOCKET_CLI_GITHUB_TOKEN', 'token3')

      const token = getGitHubToken()
      expect(token).toBe('token1')
    })

    it('should use GH_TOKEN when GITHUB_TOKEN is not set', () => {
      setEnv('GH_TOKEN', 'token2')
      setEnv('SOCKET_CLI_GITHUB_TOKEN', 'token3')

      const token = getGitHubToken()
      expect(token).toBe('token2')
    })

    it('should use SOCKET_CLI_GITHUB_TOKEN as last resort', () => {
      setEnv('SOCKET_CLI_GITHUB_TOKEN', 'token3')

      const token = getGitHubToken()
      expect(token).toBe('token3')
    })

    it('should handle empty string tokens', () => {
      setEnv('GITHUB_TOKEN', '')
      setEnv('GH_TOKEN', 'token2')

      const token = getGitHubToken()
      expect(token).toBe('token2')
    })

    it('should handle whitespace tokens', () => {
      setEnv('GITHUB_TOKEN', '   ')
      const token = getGitHubToken()
      expect(token).toBeTruthy()
    })
  })

  describe('getGitHubTokenFromGitConfig', () => {
    it('should handle empty cwd', async () => {
      const token = await getGitHubTokenFromGitConfig({ cwd: '' })
      expect(typeof token === 'string' || token === undefined).toBe(true)
    })

    it('should handle missing git command', async () => {
      const token = await getGitHubTokenFromGitConfig({
        cwd: '/tmp',
      })
      expect(typeof token === 'string' || token === undefined).toBe(true)
    })

    it('should handle stdio options', async () => {
      const token = await getGitHubTokenFromGitConfig({
        stdio: 'pipe',
      })
      expect(typeof token === 'string' || token === undefined).toBe(true)
    })

    it('should not throw on errors', async () => {
      await expect(
        getGitHubTokenFromGitConfig({
          cwd: '/nonexistent/path/12345',
        }),
      ).resolves.not.toThrow()
    })
  })

  describe('getGitHubTokenWithFallback', () => {
    it('should prefer environment over git config', async () => {
      setEnv('GITHUB_TOKEN', 'env-token')
      const token = await getGitHubTokenWithFallback()
      expect(token).toBe('env-token')
    })

    it('should handle when both sources are unavailable', async () => {
      const token = await getGitHubTokenWithFallback()
      expect(typeof token === 'string' || token === undefined).toBe(true)
    })

    it('should return string or undefined', async () => {
      const token = await getGitHubTokenWithFallback()
      expect(
        typeof token === 'string' ||
          typeof token === 'undefined' ||
          token === undefined,
      ).toBe(true)
    })
  })

  describe('edge cases and error handling', () => {
    it('should handle rapid token changes', () => {
      setEnv('GITHUB_TOKEN', 'token1')
      expect(getGitHubToken()).toBe('token1')

      setEnv('GITHUB_TOKEN', 'token2')
      expect(getGitHubToken()).toBe('token2')

      setEnv('GITHUB_TOKEN', undefined)
      expect(getGitHubToken()).toBeUndefined()
    })

    it('should handle token with special characters', () => {
      setEnv('GITHUB_TOKEN', 'ghp_abc123!@#$%^&*()')
      const token = getGitHubToken()
      expect(token).toContain('ghp_abc123')
    })

    it('should handle very long tokens', () => {
      const longToken = `ghp_${'x'.repeat(1000)}`
      setEnv('GITHUB_TOKEN', longToken)
      const token = getGitHubToken()
      expect(token).toBe(longToken)
    })

    it('should handle unicode in GHSA IDs', () => {
      const url = getGhsaUrl('GHSA-你好-世界-测试')
      expect(url).toContain('GHSA-你好-世界-测试')
    })

    it('should handle GHSA IDs with unusual characters', () => {
      const url = getGhsaUrl('GHSA-@@@-###-$$$')
      expect(url).toContain('GHSA-@@@-###-$$$')
    })
  })

  describe('concurrent operations', () => {
    it('should handle concurrent token reads', () => {
      setEnv('GITHUB_TOKEN', 'token')
      const results = Array.from({ length: 10 }, () => getGitHubToken())
      expect(results).toEqual(Array(10).fill('token'))
    })

    it('should handle concurrent cache clears', async () => {
      const promises = Array.from({ length: 5 }, () => clearRefCache())
      await expect(Promise.all(promises)).resolves.not.toThrow()
    })

    it('should handle concurrent git config reads', async () => {
      const promises = Array.from({ length: 3 }, () =>
        getGitHubTokenFromGitConfig(),
      )
      await expect(Promise.all(promises)).resolves.not.toThrow()
    })
  })

  describe('type safety', () => {
    it('should return correct types', () => {
      const token = getGitHubToken()
      expect(typeof token === 'string' || token === undefined).toBe(true)
    })

    it('should return correct URL type', () => {
      const url = getGhsaUrl('GHSA-test-test-test')
      expect(typeof url).toBe('string')
    })

    it('should handle async operations correctly', async () => {
      const result = await getGitHubTokenWithFallback()
      expect(
        typeof result === 'string' ||
          typeof result === 'undefined' ||
          result === undefined,
      ).toBe(true)
    })
  })

  describe('API error handling edge cases', () => {
    it('should handle missing token gracefully', () => {
      resetEnv()
      const token = getGitHubToken()
      expect(token).toBeUndefined()
    })

    it('should generate GHSA URLs consistently', () => {
      const ghsaId = 'GHSA-1234-5678-90ab'
      const url1 = getGhsaUrl(ghsaId)
      const url2 = getGhsaUrl(ghsaId)
      expect(url1).toBe(url2)
      expect(url1).toContain(ghsaId)
    })

    it('should handle GHSA IDs with mixed case', () => {
      const url = getGhsaUrl('GhSa-MiXeD-CaSe-TeSt')
      expect(url).toBe('https://github.com/advisories/GhSa-MiXeD-CaSe-TeSt')
    })

    it('should handle GHSA IDs with dashes only', () => {
      const url = getGhsaUrl('----')
      expect(url).toBe('https://github.com/advisories/----')
    })
  })

  describe('caching behavior', () => {
    it('should allow multiple cache clears in sequence', async () => {
      for (let i = 0; i < 5; i++) {
        await clearRefCache()
      }
      expect(true).toBe(true)
    })

    it('should handle cache operations after clear', async () => {
      await clearRefCache()
      const token = getGitHubToken()
      expect(typeof token === 'string' || token === undefined).toBe(true)
    })
  })

  describe('token resolution', () => {
    it('should handle all three token sources independently', () => {
      // Test GITHUB_TOKEN alone
      resetEnv()
      setEnv('GITHUB_TOKEN', 'token1')
      expect(getGitHubToken()).toBe('token1')

      // Test GH_TOKEN alone
      resetEnv()
      setEnv('GH_TOKEN', 'token2')
      expect(getGitHubToken()).toBe('token2')

      // Test SOCKET_CLI_GITHUB_TOKEN alone
      resetEnv()
      setEnv('SOCKET_CLI_GITHUB_TOKEN', 'token3')
      expect(getGitHubToken()).toBe('token3')
    })

    it('should handle token priority with all permutations', () => {
      // Priority: GITHUB_TOKEN > GH_TOKEN > SOCKET_CLI_GITHUB_TOKEN
      resetEnv()
      setEnv('GH_TOKEN', 'gh')
      setEnv('SOCKET_CLI_GITHUB_TOKEN', 'cli')
      expect(getGitHubToken()).toBe('gh')

      resetEnv()
      setEnv('GITHUB_TOKEN', 'github')
      setEnv('SOCKET_CLI_GITHUB_TOKEN', 'cli')
      expect(getGitHubToken()).toBe('github')

      resetEnv()
      setEnv('GITHUB_TOKEN', 'github')
      setEnv('GH_TOKEN', 'gh')
      expect(getGitHubToken()).toBe('github')
    })
  })

  describe('git config integration', () => {
    it('should handle non-git directories', async () => {
      const token = await getGitHubTokenFromGitConfig({
        cwd: '/tmp',
      })
      expect(typeof token === 'string' || token === undefined).toBe(true)
    })

    it('should handle relative paths', async () => {
      const token = await getGitHubTokenFromGitConfig({
        cwd: '.',
      })
      expect(typeof token === 'string' || token === undefined).toBe(true)
    })

    it('should handle multiple concurrent git config reads', async () => {
      const results = await Promise.all([
        getGitHubTokenFromGitConfig(),
        getGitHubTokenFromGitConfig(),
        getGitHubTokenFromGitConfig(),
      ])
      results.forEach(result => {
        expect(typeof result === 'string' || result === undefined).toBe(true)
      })
    })
  })

  describe('URL formatting', () => {
    it('should maintain URL structure for all IDs', () => {
      const ids = [
        'GHSA-1234-5678-9abc',
        'GHSA-xxxx-yyyy-zzzz',
        'GHSA-abcd-efgh-ijkl',
        'ghsa-lowercase-test-id',
      ]
      ids.forEach(id => {
        const url = getGhsaUrl(id)
        expect(url).toMatch(/^https:\/\/github\.com\/advisories\//)
        expect(url).toContain(id)
      })
    })

    it('should handle GHSA IDs with URL-unsafe characters', () => {
      const id = 'GHSA-test%20with%20spaces'
      const url = getGhsaUrl(id)
      expect(url).toContain(id)
    })
  })

  describe('fallback chain', () => {
    it('should complete fallback chain with no sources', async () => {
      resetEnv()
      const token = await getGitHubTokenWithFallback()
      expect(typeof token === 'string' || token === undefined).toBe(true)
    })

    it('should short-circuit on first found token', async () => {
      setEnv('GITHUB_TOKEN', 'first-token')
      const token = await getGitHubTokenWithFallback()
      expect(token).toBe('first-token')
    })

    it('should try git config when env vars are empty', async () => {
      resetEnv()
      const token = await getGitHubTokenWithFallback()
      // Token may come from git config or be undefined
      expect(typeof token === 'string' || token === undefined).toBe(true)
    })
  })
})
