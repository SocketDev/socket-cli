/**
 * @fileoverview Unit tests for GitHub environment variable getters.
 *
 * Tests GitHub Actions environment variable accessors:
 * - getGithubToken() / getGhToken() - authentication tokens (GITHUB_TOKEN, GH_TOKEN)
 * - getGithubRepository() - repository slug (owner/repo)
 * - getGithubApiUrl() - API endpoint URL
 * - getGithubServerUrl() - GitHub server URL
 * - getGithubRefName() / getGithubRefType() / getGithubBaseRef() - Git ref information
 * Uses rewire for test isolation. Critical for GitHub Actions integration.
 */

import {
  getGhToken,
  getGithubApiUrl,
  getGithubBaseRef,
  getGithubRefName,
  getGithubRefType,
  getGithubRepository,
  getGithubServerUrl,
  getGithubToken,
} from '@socketsecurity/lib/env/github'
import { resetEnv, setEnv } from '@socketsecurity/lib/env/rewire'
import { afterEach, describe, expect, it } from 'vitest'

describe('github env', () => {
  afterEach(() => {
    resetEnv()
  })

  describe('getGithubApiUrl', () => {
    it('should return API URL when set', () => {
      setEnv('GITHUB_API_URL', 'https://api.github.com')
      expect(getGithubApiUrl()).toBe('https://api.github.com')
    })

    it('should return undefined when not set', () => {
      setEnv('GITHUB_API_URL', undefined)
      expect(getGithubApiUrl()).toBeUndefined()
    })
  })

  describe('getGithubBaseRef', () => {
    it('should return base ref when set', () => {
      setEnv('GITHUB_BASE_REF', 'main')
      expect(getGithubBaseRef()).toBe('main')
    })

    it('should return undefined when not set', () => {
      setEnv('GITHUB_BASE_REF', undefined)
      expect(getGithubBaseRef()).toBeUndefined()
    })
  })

  describe('getGithubRefName', () => {
    it('should return ref name when set', () => {
      setEnv('GITHUB_REF_NAME', 'feature-branch')
      expect(getGithubRefName()).toBe('feature-branch')
    })

    it('should return undefined when not set', () => {
      setEnv('GITHUB_REF_NAME', undefined)
      expect(getGithubRefName()).toBeUndefined()
    })
  })

  describe('getGithubRefType', () => {
    it('should return ref type when set to branch', () => {
      setEnv('GITHUB_REF_TYPE', 'branch')
      expect(getGithubRefType()).toBe('branch')
    })

    it('should return ref type when set to tag', () => {
      setEnv('GITHUB_REF_TYPE', 'tag')
      expect(getGithubRefType()).toBe('tag')
    })

    it('should return undefined when not set', () => {
      setEnv('GITHUB_REF_TYPE', undefined)
      expect(getGithubRefType()).toBeUndefined()
    })
  })

  describe('getGithubRepository', () => {
    it('should return repository name when set', () => {
      setEnv('GITHUB_REPOSITORY', 'owner/repo')
      expect(getGithubRepository()).toBe('owner/repo')
    })

    it('should return undefined when not set', () => {
      setEnv('GITHUB_REPOSITORY', undefined)
      expect(getGithubRepository()).toBeUndefined()
    })
  })

  describe('getGithubServerUrl', () => {
    it('should return server URL when set', () => {
      setEnv('GITHUB_SERVER_URL', 'https://github.com')
      expect(getGithubServerUrl()).toBe('https://github.com')
    })

    it('should return undefined when not set', () => {
      setEnv('GITHUB_SERVER_URL', undefined)
      expect(getGithubServerUrl()).toBeUndefined()
    })
  })

  describe('getGithubToken', () => {
    it('should return token when set', () => {
      setEnv('GITHUB_TOKEN', 'ghp_test123')
      expect(getGithubToken()).toBe('ghp_test123')
    })

    it('should return undefined when not set', () => {
      setEnv('GITHUB_TOKEN', undefined)
      expect(getGithubToken()).toBeUndefined()
    })
  })

  describe('getGhToken', () => {
    it('should return GH_TOKEN when set', () => {
      setEnv('GH_TOKEN', 'ghp_alt_token')
      expect(getGhToken()).toBe('ghp_alt_token')
    })

    it('should return undefined when not set', () => {
      setEnv('GH_TOKEN', undefined)
      expect(getGhToken()).toBeUndefined()
    })
  })
})
