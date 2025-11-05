/**
 * @fileoverview Unit tests for Socket.dev APIs, scopes, organizations, and application names.
 *
 * Tests Socket ecosystem constants:
 * - API URLs: SOCKET_API_BASE_URL, SOCKET_REGISTRY_URL
 * - Application names: socket-cli, socket-npm, socket-firewall
 * - Organization/scope identifiers
 * - Config paths: SOCKET_HOME, SOCKET_CONFIG_FILE
 * Frozen constants for Socket tool configuration.
 */

import { describe, expect, it } from 'vitest'

import {
  CACHE_SOCKET_API_DIR,
  REGISTRY,
  REGISTRY_SCOPE_DELIMITER,
  SOCKET_API_BASE_URL,
  SOCKET_API_TOKENS_URL,
  SOCKET_APP_PREFIX,
  SOCKET_CLI_APP_NAME,
  SOCKET_CONTACT_URL,
  SOCKET_DASHBOARD_URL,
  SOCKET_DLX_APP_NAME,
  SOCKET_DOCS_URL,
  SOCKET_FIREWALL_APP_NAME,
  SOCKET_GITHUB_ORG,
  SOCKET_IPC_HANDSHAKE,
  SOCKET_OVERRIDE_SCOPE,
  SOCKET_PRICING_URL,
  SOCKET_PUBLIC_API_KEY,
  SOCKET_PUBLIC_API_TOKEN,
  SOCKET_REGISTRY_APP_NAME,
  SOCKET_REGISTRY_NPM_ORG,
  SOCKET_REGISTRY_PACKAGE_NAME,
  SOCKET_REGISTRY_REPO_NAME,
  SOCKET_REGISTRY_SCOPE,
  SOCKET_SECURITY_SCOPE,
  SOCKET_STATUS_URL,
  SOCKET_WEBSITE_URL,
} from '@socketsecurity/lib/constants/socket'

describe('constants/socket', () => {
  describe('Socket.dev API', () => {
    it('should export SOCKET_API_BASE_URL', () => {
      expect(SOCKET_API_BASE_URL).toBe('https://api.socket.dev/v0')
    })

    it('should be a valid HTTPS URL', () => {
      expect(SOCKET_API_BASE_URL).toMatch(/^https:\/\//)
    })

    it('should point to api.socket.dev', () => {
      expect(SOCKET_API_BASE_URL).toContain('api.socket.dev')
    })

    it('should include API version', () => {
      expect(SOCKET_API_BASE_URL).toContain('/v0')
    })

    it('should not have trailing slash', () => {
      expect(SOCKET_API_BASE_URL.endsWith('/')).toBe(false)
    })

    it('should be a valid URL', () => {
      expect(() => new URL(SOCKET_API_BASE_URL)).not.toThrow()
    })
  })

  describe('Socket.dev API keys', () => {
    it('should export SOCKET_PUBLIC_API_KEY', () => {
      expect(SOCKET_PUBLIC_API_KEY).toContain('sktsec_')
    })

    it('should export SOCKET_PUBLIC_API_TOKEN', () => {
      expect(SOCKET_PUBLIC_API_TOKEN).toBeDefined()
    })

    it('should have backward compatibility alias', () => {
      expect(SOCKET_PUBLIC_API_TOKEN).toBe(SOCKET_PUBLIC_API_KEY)
    })

    it('should be a string', () => {
      expect(typeof SOCKET_PUBLIC_API_KEY).toBe('string')
    })

    it('should have API key format', () => {
      expect(SOCKET_PUBLIC_API_KEY.startsWith('sktsec_')).toBe(true)
    })
  })

  describe('Socket.dev URLs', () => {
    it('should export SOCKET_WEBSITE_URL', () => {
      expect(SOCKET_WEBSITE_URL).toBe('https://socket.dev')
    })

    it('should export SOCKET_CONTACT_URL', () => {
      expect(SOCKET_CONTACT_URL).toBe('https://socket.dev/contact')
    })

    it('should export SOCKET_DASHBOARD_URL', () => {
      expect(SOCKET_DASHBOARD_URL).toBe('https://socket.dev/dashboard')
    })

    it('should export SOCKET_API_TOKENS_URL', () => {
      expect(SOCKET_API_TOKENS_URL).toBe(
        'https://socket.dev/dashboard/settings/api-tokens',
      )
    })

    it('should export SOCKET_PRICING_URL', () => {
      expect(SOCKET_PRICING_URL).toBe('https://socket.dev/pricing')
    })

    it('should export SOCKET_STATUS_URL', () => {
      expect(SOCKET_STATUS_URL).toBe('https://status.socket.dev')
    })

    it('should export SOCKET_DOCS_URL', () => {
      expect(SOCKET_DOCS_URL).toBe('https://docs.socket.dev')
    })

    it('should all be valid HTTPS URLs', () => {
      const urls = [
        SOCKET_WEBSITE_URL,
        SOCKET_CONTACT_URL,
        SOCKET_DASHBOARD_URL,
        SOCKET_API_TOKENS_URL,
        SOCKET_PRICING_URL,
        SOCKET_STATUS_URL,
        SOCKET_DOCS_URL,
      ]
      urls.forEach(url => {
        expect(url).toMatch(/^https:\/\//)
        expect(() => new URL(url)).not.toThrow()
      })
    })

    it('should all contain socket.dev domain', () => {
      const urls = [
        SOCKET_WEBSITE_URL,
        SOCKET_CONTACT_URL,
        SOCKET_DASHBOARD_URL,
        SOCKET_API_TOKENS_URL,
        SOCKET_PRICING_URL,
        SOCKET_STATUS_URL,
        SOCKET_DOCS_URL,
      ]
      urls.forEach(url => {
        expect(url).toContain('socket.dev')
      })
    })

    it('should not have trailing slashes', () => {
      const urls = [
        SOCKET_WEBSITE_URL,
        SOCKET_CONTACT_URL,
        SOCKET_DASHBOARD_URL,
        SOCKET_API_TOKENS_URL,
        SOCKET_PRICING_URL,
        SOCKET_STATUS_URL,
        SOCKET_DOCS_URL,
      ]
      urls.forEach(url => {
        expect(url.endsWith('/')).toBe(false)
      })
    })

    it('should support URL path construction', () => {
      const orgDashboard = `${SOCKET_DASHBOARD_URL}/org/myorg`
      expect(orgDashboard).toBe('https://socket.dev/dashboard/org/myorg')
    })

    it('should support documentation path construction', () => {
      const guidePath = `${SOCKET_DOCS_URL}/docs/getting-started`
      expect(guidePath).toBe('https://docs.socket.dev/docs/getting-started')
    })
  })

  describe('Socket.dev scopes', () => {
    it('should export SOCKET_REGISTRY_SCOPE', () => {
      expect(SOCKET_REGISTRY_SCOPE).toBe('@socketregistry')
    })

    it('should export SOCKET_SECURITY_SCOPE', () => {
      expect(SOCKET_SECURITY_SCOPE).toBe('@socketsecurity')
    })

    it('should export SOCKET_OVERRIDE_SCOPE', () => {
      expect(SOCKET_OVERRIDE_SCOPE).toBe('@socketoverride')
    })

    it('should all start with @', () => {
      expect(SOCKET_REGISTRY_SCOPE.startsWith('@')).toBe(true)
      expect(SOCKET_SECURITY_SCOPE.startsWith('@')).toBe(true)
      expect(SOCKET_OVERRIDE_SCOPE.startsWith('@')).toBe(true)
    })

    it('should all contain "socket"', () => {
      expect(SOCKET_REGISTRY_SCOPE.toLowerCase()).toContain('socket')
      expect(SOCKET_SECURITY_SCOPE.toLowerCase()).toContain('socket')
      expect(SOCKET_OVERRIDE_SCOPE.toLowerCase()).toContain('socket')
    })

    it('should have unique scope names', () => {
      const scopes = [
        SOCKET_REGISTRY_SCOPE,
        SOCKET_SECURITY_SCOPE,
        SOCKET_OVERRIDE_SCOPE,
      ]
      const uniqueScopes = [...new Set(scopes)]
      expect(uniqueScopes.length).toBe(scopes.length)
    })
  })

  describe('Socket.dev organization and repositories', () => {
    it('should export SOCKET_GITHUB_ORG', () => {
      expect(SOCKET_GITHUB_ORG).toBe('SocketDev')
    })

    it('should export SOCKET_REGISTRY_REPO_NAME', () => {
      expect(SOCKET_REGISTRY_REPO_NAME).toBe('socket-registry')
    })

    it('should export SOCKET_REGISTRY_PACKAGE_NAME', () => {
      expect(SOCKET_REGISTRY_PACKAGE_NAME).toBe('@socketsecurity/registry')
    })

    it('should export SOCKET_REGISTRY_NPM_ORG', () => {
      expect(SOCKET_REGISTRY_NPM_ORG).toBe('socketregistry')
    })

    it('should have consistent naming', () => {
      expect(SOCKET_GITHUB_ORG).toContain('Socket')
      expect(SOCKET_REGISTRY_REPO_NAME).toContain('socket')
      expect(SOCKET_REGISTRY_PACKAGE_NAME).toContain('socket')
    })

    it('should support GitHub URL construction', () => {
      const url = `https://github.com/${SOCKET_GITHUB_ORG}/${SOCKET_REGISTRY_REPO_NAME}`
      expect(url).toBe('https://github.com/SocketDev/socket-registry')
    })
  })

  describe('Socket.dev application names', () => {
    it('should export SOCKET_CLI_APP_NAME', () => {
      expect(SOCKET_CLI_APP_NAME).toBe('socket')
    })

    it('should export SOCKET_DLX_APP_NAME', () => {
      expect(SOCKET_DLX_APP_NAME).toBe('dlx')
    })

    it('should export SOCKET_FIREWALL_APP_NAME', () => {
      expect(SOCKET_FIREWALL_APP_NAME).toBe('sfw')
    })

    it('should export SOCKET_REGISTRY_APP_NAME', () => {
      expect(SOCKET_REGISTRY_APP_NAME).toBe('registry')
    })

    it('should export SOCKET_APP_PREFIX', () => {
      expect(SOCKET_APP_PREFIX).toBe('_')
    })

    it('should all be lowercase', () => {
      expect(SOCKET_CLI_APP_NAME).toBe(SOCKET_CLI_APP_NAME.toLowerCase())
      expect(SOCKET_DLX_APP_NAME).toBe(SOCKET_DLX_APP_NAME.toLowerCase())
      expect(SOCKET_FIREWALL_APP_NAME).toBe(
        SOCKET_FIREWALL_APP_NAME.toLowerCase(),
      )
      expect(SOCKET_REGISTRY_APP_NAME).toBe(
        SOCKET_REGISTRY_APP_NAME.toLowerCase(),
      )
    })

    it('should have unique app names', () => {
      const apps = [
        SOCKET_CLI_APP_NAME,
        SOCKET_DLX_APP_NAME,
        SOCKET_FIREWALL_APP_NAME,
        SOCKET_REGISTRY_APP_NAME,
      ]
      const uniqueApps = [...new Set(apps)]
      expect(uniqueApps.length).toBe(apps.length)
    })
  })

  describe('Socket.dev IPC', () => {
    it('should export SOCKET_IPC_HANDSHAKE', () => {
      expect(SOCKET_IPC_HANDSHAKE).toBe('SOCKET_IPC_HANDSHAKE')
    })

    it('should be uppercase', () => {
      expect(SOCKET_IPC_HANDSHAKE).toBe(SOCKET_IPC_HANDSHAKE.toUpperCase())
    })

    it('should contain IPC and HANDSHAKE', () => {
      expect(SOCKET_IPC_HANDSHAKE).toContain('IPC')
      expect(SOCKET_IPC_HANDSHAKE).toContain('HANDSHAKE')
    })
  })

  describe('Socket.dev cache and registry', () => {
    it('should export CACHE_SOCKET_API_DIR', () => {
      expect(CACHE_SOCKET_API_DIR).toBe('socket-api')
    })

    it('should export REGISTRY', () => {
      expect(REGISTRY).toBe('registry')
    })

    it('should export REGISTRY_SCOPE_DELIMITER', () => {
      expect(REGISTRY_SCOPE_DELIMITER).toBe('__')
    })

    it('should be lowercase for directory names', () => {
      expect(CACHE_SOCKET_API_DIR).toBe(CACHE_SOCKET_API_DIR.toLowerCase())
      expect(REGISTRY).toBe(REGISTRY.toLowerCase())
    })

    it('should not contain path separators', () => {
      expect(CACHE_SOCKET_API_DIR).not.toContain('/')
      expect(CACHE_SOCKET_API_DIR).not.toContain('\\')
      expect(REGISTRY).not.toContain('/')
      expect(REGISTRY).not.toContain('\\')
    })
  })

  describe('constant relationships', () => {
    it('should have registry in multiple constants', () => {
      expect(SOCKET_REGISTRY_SCOPE).toContain('registry')
      expect(SOCKET_REGISTRY_REPO_NAME).toContain('registry')
      expect(SOCKET_REGISTRY_PACKAGE_NAME).toContain('registry')
      expect(SOCKET_REGISTRY_APP_NAME).toContain('registry')
    })

    it('should have socket in API and scope names', () => {
      expect(SOCKET_API_BASE_URL).toContain('socket')
      expect(SOCKET_REGISTRY_SCOPE).toContain('socket')
      expect(SOCKET_SECURITY_SCOPE).toContain('socket')
    })
  })

  describe('real-world usage', () => {
    it('should construct API endpoint URLs', () => {
      const endpoint = `${SOCKET_API_BASE_URL}/packages/npm/lodash`
      expect(endpoint).toContain('https://api.socket.dev/v0')
    })

    it('should construct scoped package names', () => {
      const pkg = `${SOCKET_SECURITY_SCOPE}/package`
      expect(pkg).toBe('@socketsecurity/package')
    })

    it('should construct cache paths', () => {
      const cachePath = `/tmp/${CACHE_SOCKET_API_DIR}/data`
      expect(cachePath).toBe('/tmp/socket-api/data')
    })

    it('should support registry scope delimiter usage', () => {
      const scoped = `@scope${REGISTRY_SCOPE_DELIMITER}package`
      expect(scoped).toBe('@scope__package')
    })
  })

  describe('constant immutability', () => {
    it('should not allow reassignment', () => {
      expect(() => {
        // @ts-expect-error - testing immutability
        SOCKET_API_BASE_URL = 'https://other-api.com'
      }).toThrow()
    })
  })
})
