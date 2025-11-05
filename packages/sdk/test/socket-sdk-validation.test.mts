/** @fileoverview Tests for SocketSdk parameter validation and error handling (no HTTP mocking). */
import { describe, expect, it } from 'vitest'

import { SocketSdk } from '../src/index'
import { setupTestClient } from './utils/environment.mts'

describe('SocketSdk Validation & Error Handling', () => {
  describe('Constructor Validation', () => {
    it('creates a valid SDK instance with API token', () => {
      const client = new SocketSdk('valid-token')
      expect(client).toBeInstanceOf(SocketSdk)
    })

    it('rejects empty API token', () => {
      expect(() => new SocketSdk('')).toThrow('cannot be empty')
    })

    it('rejects whitespace-only API token', () => {
      expect(() => new SocketSdk('   ')).toThrow('cannot be empty')
    })

    it('rejects null API token', () => {
      // @ts-expect-error - testing invalid input
      expect(() => new SocketSdk(null)).toThrow()
    })

    it('rejects undefined API token', () => {
      // @ts-expect-error - testing invalid input
      expect(() => new SocketSdk(undefined)).toThrow()
    })

    it('rejects excessively long API token', () => {
      const longToken = 'a'.repeat(1025)
      expect(() => new SocketSdk(longToken)).toThrow('exceeds maximum length')
    })

    it('accepts maximum length API token', () => {
      const maxToken = 'a'.repeat(1024)
      const client = new SocketSdk(maxToken)
      expect(client).toBeInstanceOf(SocketSdk)
    })

    it('trims whitespace from API token', () => {
      const client = new SocketSdk('  token  ')
      expect(client).toBeInstanceOf(SocketSdk)
    })
  })

  describe('Configuration Options Validation', () => {
    it('accepts valid timeout', () => {
      const client = new SocketSdk('token', { timeout: 5000 })
      expect(client).toBeInstanceOf(SocketSdk)
    })

    it('rejects timeout below minimum', () => {
      expect(() => new SocketSdk('token', { timeout: 4999 })).toThrow(
        'must be a number between',
      )
    })

    it('rejects timeout above maximum', () => {
      expect(() => new SocketSdk('token', { timeout: 301_000 })).toThrow(
        'must be a number between',
      )
    })

    it('accepts minimum timeout', () => {
      const client = new SocketSdk('token', { timeout: 5000 })
      expect(client).toBeInstanceOf(SocketSdk)
    })

    it('accepts maximum timeout', () => {
      const client = new SocketSdk('token', { timeout: 300_000 })
      expect(client).toBeInstanceOf(SocketSdk)
    })

    it('rejects non-numeric timeout', () => {
      // @ts-expect-error - testing invalid input
      expect(() => new SocketSdk('token', { timeout: 'fast' })).toThrow()
    })

    it('accepts retries option', () => {
      const client = new SocketSdk('token', { retries: 5 })
      expect(client).toBeInstanceOf(SocketSdk)
    })

    it('accepts cache option', () => {
      const client = new SocketSdk('token', { cache: true })
      expect(client).toBeInstanceOf(SocketSdk)
    })

    it('accepts userAgent option', () => {
      const client = new SocketSdk('token', { userAgent: 'CustomAgent/1.0' })
      expect(client).toBeInstanceOf(SocketSdk)
    })

    it('accepts baseUrl option', () => {
      const client = new SocketSdk('token', {
        baseUrl: 'https://custom.api.com',
      })
      expect(client).toBeInstanceOf(SocketSdk)
    })

    it('accepts agent option with https agent', async () => {
      const https = await import('node:https')
      const agent = new https.Agent({ keepAlive: true })
      const client = new SocketSdk('token', { agent })
      expect(client).toBeInstanceOf(SocketSdk)
    })

    it('accepts agent option with http agent', async () => {
      const http = await import('node:http')
      const agent = new http.Agent({ keepAlive: true })
      const client = new SocketSdk('token', { agent })
      expect(client).toBeInstanceOf(SocketSdk)
    })

    it('accepts agent option in Got-style format', async () => {
      const https = await import('node:https')
      const agent = new https.Agent({ keepAlive: true })
      const client = new SocketSdk('token', { agent: { https: agent } })
      expect(client).toBeInstanceOf(SocketSdk)
    })

    it('accepts cacheTtl option', () => {
      const client = new SocketSdk('token', { cacheTtl: 5000 })
      expect(client).toBeInstanceOf(SocketSdk)
    })
  })

  describe('Public Method Existence', () => {
    const getClient = setupTestClient('test-token', { retries: 0 })

    const publicMethods = [
      'batchPackageFetch',
      'batchPackageStream',
      'createDependenciesSnapshot',
      'createFullScan',
      'createOrgDiffScanFromIds',
      'createRepository',
      'createRepositoryLabel',
      'deleteFullScan',
      'deleteOrgDiffScan',
      'deleteRepository',
      'deleteRepositoryLabel',
      'exportCDX',
      'exportSPDX',
      'getAPITokens',
      'getAuditLogEvents',
      'getDiffScanById',
      'getFullScan',
      'getFullScanMetadata',
      'getIssuesByNpmPackage',
      'getOrgAnalytics',
      'getOrgLicensePolicy',
      'getOrgSecurityPolicy',
      'getOrgTriage',
      'getQuota',
      'getRepoAnalytics',
      'getRepository',
      'getRepositoryLabel',
      'getScoreByNpmPackage',
      'getSupportedScanFiles',
      'listFullScans',
      'listOrganizations',
      'listOrgDiffScans',
      'listRepositories',
      'listRepositoryLabels',
      'postAPIToken',
      'postSettings',
      'searchDependencies',
      'streamFullScan',
      'streamPatchesFromScan',
      'updateOrgLicensePolicy',
      'updateRepository',
      'updateRepositoryLabel',
      'updateOrgSecurityPolicy',
      'viewPatch',
    ]

    publicMethods.forEach(method => {
      it(`has ${method} method`, () => {
        const client = getClient() as unknown as Record<string, unknown>
        expect(typeof client[method]).toBe('function')
      })
    })
  })
})
