import { describe, expect, it, vi } from 'vitest'

import {
  getPkgFullNameFromPurl,
  getSocketDevAlertUrl,
  getSocketDevPackageOverviewUrl,
  getSocketDevPackageOverviewUrlFromPurl,
} from '../../../../../src/utils/socket/url.mts'

// Mock constants.
vi.mock('../constants.mts', () => ({
  default: {
    SOCKET_WEBSITE_URL: 'https://socket.dev',
  },
}))

// Mock purl.
vi.mock('../purl/parse.mts', () => ({
  getPurlObject: vi.fn(purl => {
    if (typeof purl === 'string') {
      // Simple parsing for tests.
      const parts = purl.split('/')
      const typePart = parts[0]?.replace('pkg:', '')
      const namePart = parts[1]
      const [name, version] = namePart?.split('@') || []

      if (namePart?.startsWith('@')) {
        // Scoped package.
        const [scope, pkg] = namePart.split('/')
        const [pkgName, ver] = pkg?.split('@') || []
        return {
          type: typePart,
          namespace: scope,
          name: pkgName,
          version: ver,
        }
      }

      return {
        type: typePart,
        namespace: undefined,
        name,
        version,
      }
    }
    return purl
  }),
}))

describe('socket-url utilities', () => {
  describe('getPkgFullNameFromPurl', () => {
    it('returns name for packages without namespace', () => {
      const result = getPkgFullNameFromPurl('pkg:npm/express@4.18.0')
      expect(result).toBe('express')
    })

    it('returns scoped name for npm packages', async () => {
      const purlObj = {
        type: 'npm',
        namespace: '@babel',
        name: 'core',
        version: '7.0.0',
      }
      const { getPurlObject } = vi.mocked(await import('../../../../../src/utils/purl/parse.mts'))
      getPurlObject.mockReturnValue(purlObj as any)

      const result = getPkgFullNameFromPurl('pkg:npm/@babel/core@7.0.0')
      expect(result).toBe('@babel/core')
    })

    it('handles maven packages with colon separator', async () => {
      const purlObj = {
        type: 'maven',
        namespace: 'org.apache',
        name: 'commons',
        version: '3.0',
      }
      const { getPurlObject } = vi.mocked(await import('../../../../../src/utils/purl/parse.mts'))
      getPurlObject.mockReturnValue(purlObj as any)

      const result = getPkgFullNameFromPurl(purlObj as any)
      expect(result).toBe('org.apache:commons')
    })

    it('handles other packages with slash separator', async () => {
      const purlObj = {
        type: 'pypi',
        namespace: 'django',
        name: 'rest-framework',
        version: '3.0',
      }
      const { getPurlObject } = vi.mocked(await import('../../../../../src/utils/purl/parse.mts'))
      getPurlObject.mockReturnValue(purlObj as any)

      const result = getPkgFullNameFromPurl(purlObj as any)
      expect(result).toBe('django/rest-framework')
    })
  })

  describe('getSocketDevAlertUrl', () => {
    it('generates alert URL', () => {
      const result = getSocketDevAlertUrl('prototype-pollution')
      expect(result).toBe('https://socket.dev/alerts/prototype-pollution')
    })

    it('handles different alert types', () => {
      expect(getSocketDevAlertUrl('supply-chain-risk')).toBe(
        'https://socket.dev/alerts/supply-chain-risk',
      )
      expect(getSocketDevAlertUrl('typosquat')).toBe(
        'https://socket.dev/alerts/typosquat',
      )
      expect(getSocketDevAlertUrl('malware')).toBe(
        'https://socket.dev/alerts/malware',
      )
    })
  })

  describe('getSocketDevPackageOverviewUrl', () => {
    it('generates npm package URL without version', () => {
      const result = getSocketDevPackageOverviewUrl('npm', 'express')
      expect(result).toBe('https://socket.dev/npm/package/express')
    })

    it('generates npm package URL with version', () => {
      const result = getSocketDevPackageOverviewUrl('npm', 'express', '4.18.0')
      expect(result).toBe(
        'https://socket.dev/npm/package/express/overview/4.18.0',
      )
    })

    it('generates golang package URL with query params', () => {
      const result = getSocketDevPackageOverviewUrl(
        'golang',
        'github.com/gin-gonic/gin',
        'v1.9.0',
      )
      expect(result).toBe(
        'https://socket.dev/golang/package/github.com/gin-gonic/gin?section=overview&version=v1.9.0',
      )
    })

    it('generates golang package URL without version', () => {
      const result = getSocketDevPackageOverviewUrl(
        'golang',
        'github.com/gin-gonic/gin',
      )
      expect(result).toBe(
        'https://socket.dev/golang/package/github.com/gin-gonic/gin',
      )
    })

    it('handles other ecosystems', () => {
      expect(getSocketDevPackageOverviewUrl('pypi', 'flask', '2.0.0')).toBe(
        'https://socket.dev/pypi/package/flask/overview/2.0.0',
      )
      expect(getSocketDevPackageOverviewUrl('gem', 'rails', '7.0.0')).toBe(
        'https://socket.dev/gem/package/rails/overview/7.0.0',
      )
    })
  })

  describe('getSocketDevPackageOverviewUrlFromPurl', () => {
    it('generates URL from PURL string', async () => {
      const { getPurlObject } = vi.mocked(await import('../../../../../src/utils/purl/parse.mts'))
      getPurlObject.mockReturnValue({
        type: 'npm',
        namespace: undefined,
        name: 'express',
        version: '4.18.0',
      } as any)

      const result = getSocketDevPackageOverviewUrlFromPurl(
        'pkg:npm/express@4.18.0',
      )
      expect(result).toBe(
        'https://socket.dev/npm/package/express/overview/4.18.0',
      )
    })
  })
})
