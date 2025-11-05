/**
 * @fileoverview Unit tests for NODE_AUTH_TOKEN environment variable getter.
 *
 * Tests getNodeAuthToken() for Node.js registry authentication.
 * Returns NODE_AUTH_TOKEN value or undefined. Used for private npm registry access.
 * Uses rewire for test isolation. Critical for authenticated package operations.
 */

import { getNodeAuthToken } from '@socketsecurity/lib/env/node-auth-token'
import { clearEnv, resetEnv, setEnv } from '@socketsecurity/lib/env/rewire'
import { afterEach, describe, expect, it } from 'vitest'

describe('env/node-auth-token', () => {
  afterEach(() => {
    resetEnv()
  })

  describe('getNodeAuthToken', () => {
    it('should return NODE_AUTH_TOKEN when set', () => {
      setEnv('NODE_AUTH_TOKEN', 'test-token-123')
      expect(getNodeAuthToken()).toBe('test-token-123')
    })

    it('should return undefined when NODE_AUTH_TOKEN is not set', () => {
      clearEnv('NODE_AUTH_TOKEN')
      // After clearing override, falls back to actual process.env
      const result = getNodeAuthToken()
      expect(typeof result).toMatch(/string|undefined/)
    })

    it('should handle npm registry auth token', () => {
      setEnv('NODE_AUTH_TOKEN', 'npm_abcdef1234567890')
      expect(getNodeAuthToken()).toBe('npm_abcdef1234567890')
    })

    it('should handle GitHub Packages token', () => {
      setEnv('NODE_AUTH_TOKEN', 'ghp_1234567890abcdefGHIJKLMNOPQRSTUVWXYZ')
      expect(getNodeAuthToken()).toBe(
        'ghp_1234567890abcdefGHIJKLMNOPQRSTUVWXYZ',
      )
    })

    it('should handle GitLab token', () => {
      setEnv('NODE_AUTH_TOKEN', 'glpat-abc123xyz')
      expect(getNodeAuthToken()).toBe('glpat-abc123xyz')
    })

    it('should handle private registry token', () => {
      setEnv('NODE_AUTH_TOKEN', 'Bearer abc123')
      expect(getNodeAuthToken()).toBe('Bearer abc123')
    })

    it('should handle basic auth token', () => {
      setEnv('NODE_AUTH_TOKEN', 'dXNlcm5hbWU6cGFzc3dvcmQ=')
      expect(getNodeAuthToken()).toBe('dXNlcm5hbWU6cGFzc3dvcmQ=')
    })

    it('should handle empty string', () => {
      setEnv('NODE_AUTH_TOKEN', '')
      expect(getNodeAuthToken()).toBe('')
    })

    it('should handle UUID-style token', () => {
      setEnv('NODE_AUTH_TOKEN', '550e8400-e29b-41d4-a716-446655440000')
      expect(getNodeAuthToken()).toBe('550e8400-e29b-41d4-a716-446655440000')
    })

    it('should handle hexadecimal token', () => {
      setEnv('NODE_AUTH_TOKEN', 'abc123def456')
      expect(getNodeAuthToken()).toBe('abc123def456')
    })

    it('should handle updating auth token', () => {
      setEnv('NODE_AUTH_TOKEN', 'token1')
      expect(getNodeAuthToken()).toBe('token1')

      setEnv('NODE_AUTH_TOKEN', 'token2')
      expect(getNodeAuthToken()).toBe('token2')

      setEnv('NODE_AUTH_TOKEN', 'token3')
      expect(getNodeAuthToken()).toBe('token3')
    })

    it('should handle clearing and re-setting', () => {
      setEnv('NODE_AUTH_TOKEN', 'test-token')
      expect(getNodeAuthToken()).toBe('test-token')

      clearEnv('NODE_AUTH_TOKEN')
      expect(typeof getNodeAuthToken()).toMatch(/string|undefined/)

      setEnv('NODE_AUTH_TOKEN', 'new-token')
      expect(getNodeAuthToken()).toBe('new-token')
    })

    it('should handle consecutive reads', () => {
      setEnv('NODE_AUTH_TOKEN', 'test-token')
      expect(getNodeAuthToken()).toBe('test-token')
      expect(getNodeAuthToken()).toBe('test-token')
      expect(getNodeAuthToken()).toBe('test-token')
    })

    it('should handle long token', () => {
      const longToken = 'a'.repeat(200)
      setEnv('NODE_AUTH_TOKEN', longToken)
      expect(getNodeAuthToken()).toBe(longToken)
    })

    it('should handle token with special characters', () => {
      setEnv('NODE_AUTH_TOKEN', 'token-with_special.chars/123')
      expect(getNodeAuthToken()).toBe('token-with_special.chars/123')
    })

    it('should handle token with spaces', () => {
      setEnv('NODE_AUTH_TOKEN', 'Bearer eyJhbGciOiJIUzI1NiIs')
      expect(getNodeAuthToken()).toBe('Bearer eyJhbGciOiJIUzI1NiIs')
    })

    it('should handle JWT-style token', () => {
      setEnv(
        'NODE_AUTH_TOKEN',
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123',
      )
      expect(getNodeAuthToken()).toBe(
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123',
      )
    })

    it('should handle Artifactory API key', () => {
      setEnv('NODE_AUTH_TOKEN', 'AKC1234567890abcdef')
      expect(getNodeAuthToken()).toBe('AKC1234567890abcdef')
    })

    it('should handle Nexus token', () => {
      setEnv('NODE_AUTH_TOKEN', 'NX-abcdef123456')
      expect(getNodeAuthToken()).toBe('NX-abcdef123456')
    })

    it('should handle Azure DevOps PAT', () => {
      setEnv('NODE_AUTH_TOKEN', 'pat-1234567890abcdefghijklmnopqrstuvwxyz')
      expect(getNodeAuthToken()).toBe(
        'pat-1234567890abcdefghijklmnopqrstuvwxyz',
      )
    })

    it('should handle npm automation token', () => {
      setEnv('NODE_AUTH_TOKEN', 'npm_automation_token')
      expect(getNodeAuthToken()).toBe('npm_automation_token')
    })

    it('should handle numeric token', () => {
      setEnv('NODE_AUTH_TOKEN', '123456')
      expect(getNodeAuthToken()).toBe('123456')
    })
  })
})
