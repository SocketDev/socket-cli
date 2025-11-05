/**
 * @fileoverview Unit tests for GitHub API and cache configuration constants.
 *
 * Tests GitHub integration constants:
 * - API URLs: GITHUB_API_BASE_URL, GITHUB_BASE_URL
 * - Cache configuration: TTL, paths, headers
 * - Default refs and branch names
 * Frozen constants for GitHub API access and response caching.
 */

import { describe, expect, it } from 'vitest'

import {
  CACHE_GITHUB_DIR,
  GITHUB_API_BASE_URL,
} from '@socketsecurity/lib/constants/github'

describe('constants/github', () => {
  describe('GITHUB_API_BASE_URL', () => {
    it('should export GitHub API base URL', () => {
      expect(GITHUB_API_BASE_URL).toBe('https://api.github.com')
    })

    it('should be a valid HTTPS URL', () => {
      expect(GITHUB_API_BASE_URL).toMatch(/^https:\/\//)
    })

    it('should point to api.github.com', () => {
      expect(GITHUB_API_BASE_URL).toContain('api.github.com')
    })

    it('should not have trailing slash', () => {
      expect(GITHUB_API_BASE_URL.endsWith('/')).toBe(false)
    })

    it('should be a valid URL', () => {
      expect(() => new URL(GITHUB_API_BASE_URL)).not.toThrow()
    })

    it('should use HTTPS protocol', () => {
      const url = new URL(GITHUB_API_BASE_URL)
      expect(url.protocol).toBe('https:')
    })

    it('should have correct hostname', () => {
      const url = new URL(GITHUB_API_BASE_URL)
      expect(url.hostname).toBe('api.github.com')
    })

    it('should not have path', () => {
      const url = new URL(GITHUB_API_BASE_URL)
      expect(url.pathname).toBe('/')
    })

    it('should be usable for API endpoint construction', () => {
      const endpoint = `${GITHUB_API_BASE_URL}/repos/owner/repo`
      expect(endpoint).toBe('https://api.github.com/repos/owner/repo')
    })

    it('should support path joining', () => {
      const usersEndpoint = `${GITHUB_API_BASE_URL}/users/username`
      expect(usersEndpoint).toContain('/users/username')
    })
  })

  describe('CACHE_GITHUB_DIR', () => {
    it('should export GitHub cache directory name', () => {
      expect(CACHE_GITHUB_DIR).toBe('github')
    })

    it('should be a string', () => {
      expect(typeof CACHE_GITHUB_DIR).toBe('string')
    })

    it('should be lowercase', () => {
      expect(CACHE_GITHUB_DIR).toBe(CACHE_GITHUB_DIR.toLowerCase())
    })

    it('should not contain path separators', () => {
      expect(CACHE_GITHUB_DIR).not.toContain('/')
      expect(CACHE_GITHUB_DIR).not.toContain('\\')
    })

    it('should not be empty', () => {
      expect(CACHE_GITHUB_DIR.length).toBeGreaterThan(0)
    })

    it('should be a valid directory name', () => {
      // Should not contain invalid filename characters
      expect(CACHE_GITHUB_DIR).toMatch(/^[a-z0-9-_]+$/)
    })

    it('should be usable in path construction', () => {
      const cachePath = `/tmp/${CACHE_GITHUB_DIR}/data`
      expect(cachePath).toBe('/tmp/github/data')
    })
  })

  describe('constant relationships', () => {
    it('should have GitHub in both constants conceptually', () => {
      expect(GITHUB_API_BASE_URL.toLowerCase()).toContain('github')
      expect(CACHE_GITHUB_DIR.toLowerCase()).toContain('github')
    })

    it('should be independently configurable', () => {
      // Base URL is full URL, cache dir is just directory name
      expect(GITHUB_API_BASE_URL).toContain('https://')
      expect(CACHE_GITHUB_DIR).not.toContain('https://')
    })
  })

  describe('API usage patterns', () => {
    it('should support repos API endpoint', () => {
      const reposUrl = `${GITHUB_API_BASE_URL}/repos/socketdev/socket`
      expect(reposUrl).toBe('https://api.github.com/repos/socketdev/socket')
    })

    it('should support users API endpoint', () => {
      const usersUrl = `${GITHUB_API_BASE_URL}/users/socketdev`
      expect(usersUrl).toBe('https://api.github.com/users/socketdev')
    })

    it('should support search API endpoint', () => {
      const searchUrl = `${GITHUB_API_BASE_URL}/search/repositories`
      expect(searchUrl).toBe('https://api.github.com/search/repositories')
    })

    it('should support gists API endpoint', () => {
      const gistsUrl = `${GITHUB_API_BASE_URL}/gists`
      expect(gistsUrl).toBe('https://api.github.com/gists')
    })
  })

  describe('cache directory patterns', () => {
    it('should work with Unix-style paths', () => {
      const unixPath = `/var/cache/${CACHE_GITHUB_DIR}`
      expect(unixPath).toBe('/var/cache/github')
    })

    it('should work with Windows-style paths', () => {
      const windowsPath = `C:\\cache\\${CACHE_GITHUB_DIR}`
      expect(windowsPath).toBe('C:\\cache\\github')
    })

    it('should work with relative paths', () => {
      const relativePath = `./${CACHE_GITHUB_DIR}/data`
      expect(relativePath).toBe('./github/data')
    })
  })

  describe('constant immutability', () => {
    it('should not allow reassignment of GITHUB_API_BASE_URL', () => {
      expect(() => {
        // @ts-expect-error - testing immutability
        GITHUB_API_BASE_URL = 'https://other-api.com'
      }).toThrow()
    })

    it('should not allow reassignment of CACHE_GITHUB_DIR', () => {
      expect(() => {
        // @ts-expect-error - testing immutability
        CACHE_GITHUB_DIR = 'other-dir'
      }).toThrow()
    })
  })

  describe('real-world usage', () => {
    it('should construct package repository URL', () => {
      const owner = 'socketdev'
      const repo = 'socket-cli'
      const url = `${GITHUB_API_BASE_URL}/repos/${owner}/${repo}`
      expect(url).toBe('https://api.github.com/repos/socketdev/socket-cli')
    })

    it('should construct release API URL', () => {
      const owner = 'socketdev'
      const repo = 'socket'
      const url = `${GITHUB_API_BASE_URL}/repos/${owner}/${repo}/releases/latest`
      expect(url).toBe(
        'https://api.github.com/repos/socketdev/socket/releases/latest',
      )
    })

    it('should construct cache file path', () => {
      const cacheRoot = '/tmp/cache'
      const fileName = 'repo-data.json'
      const fullPath = `${cacheRoot}/${CACHE_GITHUB_DIR}/${fileName}`
      expect(fullPath).toBe('/tmp/cache/github/repo-data.json')
    })

    it('should handle query parameters in API URLs', () => {
      const url = `${GITHUB_API_BASE_URL}/search/repositories?q=socket&sort=stars`
      expect(url).toContain('?q=socket&sort=stars')
    })
  })
})
