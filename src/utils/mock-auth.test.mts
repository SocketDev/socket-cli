import { describe, expect, it } from 'vitest'

import {
  mockApiTokenAuth,
  mockGenerateApiKey,
  mockGitHubAuth,
  mockInteractiveLogin,
  mockLogout,
  mockOrgSelection,
  mockRefreshToken,
  mockSsoAuth,
  mockTokenValidation,
  mockValidateSession,
} from './mock-auth.mts'

describe('mock-auth', () => {
  describe('mockInteractiveLogin', () => {
    it('should succeed with default options', async () => {
      const result = await mockInteractiveLogin()
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.apiToken).toBe('test-token-123')
        expect(result.data.orgSlug).toBe('test-org')
      }
    })

    it('should fail when shouldSucceed is false', async () => {
      const result = await mockInteractiveLogin({ shouldSucceed: false })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toBe('Login failed')
        expect(result.code).toBe(401)
      }
    })

    it('should use custom values', async () => {
      const result = await mockInteractiveLogin({
        apiToken: 'custom-token',
        orgSlug: 'custom-org',
      })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.apiToken).toBe('custom-token')
        expect(result.data.orgSlug).toBe('custom-org')
      }
    })
  })

  describe('mockApiTokenAuth', () => {
    it('should validate token successfully', async () => {
      const result = await mockApiTokenAuth()
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.valid).toBe(true)
        expect(result.data.user).toBeDefined()
        expect(result.data.user?.scopes).toEqual(['read', 'write'])
      }
    })

    it('should fail with custom error', async () => {
      const result = await mockApiTokenAuth({
        shouldSucceed: false,
        errorMessage: 'Custom error',
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toBe('Custom error')
      }
    })
  })

  describe('mockGitHubAuth', () => {
    it('should authenticate with GitHub', async () => {
      const result = await mockGitHubAuth()
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.accessToken).toContain('gho_')
        expect(result.data.user.login).toBe('testuser')
      }
    })
  })

  describe('mockOrgSelection', () => {
    it('should select first organization by default', async () => {
      const result = await mockOrgSelection()
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.orgSlug).toBe('test-org-1')
        expect(result.data.orgId).toBe('org-1')
      }
    })

    it('should select specified organization', async () => {
      const result = await mockOrgSelection({ selectedIndex: 1 })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.orgSlug).toBe('test-org-2')
        expect(result.data.orgId).toBe('org-2')
      }
    })

    it('should fail with no organizations', async () => {
      const result = await mockOrgSelection({ organizations: [] })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.message).toBe('No organizations available')
        expect(result.code).toBe(404)
      }
    })
  })

  describe('mockTokenValidation', () => {
    it('should validate valid token', async () => {
      const result = await mockTokenValidation('test-valid-token')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toBe(true)
      }
    })

    it('should invalidate short token', async () => {
      const result = await mockTokenValidation('short')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toBe(false)
      }
    })
  })

  describe('mockSsoAuth', () => {
    it('should authenticate with SSO', async () => {
      const result = await mockSsoAuth()
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.apiToken).toContain('sso-token-')
        expect(result.data.user.provider).toBe('okta')
      }
    })
  })

  describe('mockRefreshToken', () => {
    it('should refresh token', async () => {
      const result = await mockRefreshToken('refresh-token-123')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.accessToken).toContain('refreshed-token-')
        expect(result.data.expiresIn).toBe(3600)
      }
    })
  })

  describe('mockLogout', () => {
    it('should logout successfully', async () => {
      const result = await mockLogout()
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toBeUndefined()
      }
    })
  })

  describe('mockGenerateApiKey', () => {
    it('should generate API key', async () => {
      const result = await mockGenerateApiKey()
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.apiKey).toContain('sk_test_')
        expect(result.data.keyId).toContain('key_')
      }
    })
  })

  describe('mockValidateSession', () => {
    it('should validate valid session', async () => {
      const result = await mockValidateSession('sess_123456')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.valid).toBe(true)
        expect(result.data.expiresAt).toBeInstanceOf(Date)
      }
    })

    it('should invalidate invalid session', async () => {
      const result = await mockValidateSession('invalid')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.valid).toBe(false)
        expect(result.data.expiresAt).toBeUndefined()
      }
    })
  })
})