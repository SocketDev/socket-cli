import nock from 'nock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { convertIdsToGhsas } from './handle-fix.mts'

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
}))

vi.mock('@socketsecurity/registry/lib/logger', () => ({
  logger: mockLogger,
}))

describe('Socket fix --id functionality', () => {
  beforeEach(() => {
    nock.cleanAll()
    nock.disableNetConnect()
    vi.clearAllMocks()

    // Set up environment for GitHub API
    process.env.DISABLE_GITHUB_CACHE = 'true'
    process.env.SOCKET_CLI_GITHUB_TOKEN = 'test-token'
    process.env.GITHUB_API_URL = 'https://api.github.com'
  })

  afterEach(() => {
    if (!nock.isDone()) {
      throw new Error(`pending nock mocks: ${nock.pendingMocks()}`)
    }
    vi.clearAllMocks()
  })

  describe('GHSA ID validation', () => {
    it('should accept valid GHSA IDs', async () => {
      const validGhsas = [
        'GHSA-1234-5678-9abc',
        'GHSA-abcd-efgh-ijkl',
        'GHSA-0000-0000-0000',
      ]

      const result = await convertIdsToGhsas(validGhsas)
      expect(result).toEqual(validGhsas)
    })

    it('should reject invalid GHSA formats', async () => {
      const invalidGhsas = [
        'GHSA-123',
        'GHSA-1234-5678-9ab',
        'GHSA-1234-5678-9abcd',
        'GHSA-ABCD-EFGH-IJKL', // uppercase not allowed
        'ghsa-1234-5678-9abc', // lowercase prefix not allowed
      ]

      const result = await convertIdsToGhsas(invalidGhsas)
      expect(result).toEqual([])
    })

    it('should trim whitespace from GHSA IDs', async () => {
      const ghsasWithWhitespace = [
        '  GHSA-1234-5678-9abc  ',
        '\tGHSA-abcd-efgh-ijkl\n',
      ]

      const result = await convertIdsToGhsas(ghsasWithWhitespace)
      expect(result).toEqual(['GHSA-1234-5678-9abc', 'GHSA-abcd-efgh-ijkl'])
    })
  })

  describe('CVE ID validation and conversion', () => {
    it('should convert valid CVE IDs to GHSA IDs', async () => {
      const lodashCve = 'CVE-2021-23337'
      const expectedGhsa = 'GHSA-35jh-r3h4-6jhm'

      // Mock the GitHub API call for CVE to GHSA conversion
      nock('https://api.github.com')
        .get('/advisories')
        .query({ cve_id: lodashCve, per_page: 1 })
        .reply(200, [
          {
            ghsa_id: expectedGhsa,
            summary: 'lodash command injection vulnerability',
          },
        ])

      const result = await convertIdsToGhsas([lodashCve])
      expect(result).toEqual([expectedGhsa])
    })

    it('should reject invalid CVE formats', async () => {
      const invalidCves = [
        'CVE-123-456',
        'CVE-2021-123',
        'cve-2021-1234',
        'CVE-21-1234',
        'CVE-2021-ABC',
      ]

      const result = await convertIdsToGhsas(invalidCves)
      expect(result).toEqual([])
    })

    it('should handle CVE not found scenarios', async () => {
      const nonExistentCve = 'CVE-2025-9999'

      // Mock the GitHub API to return empty results
      nock('https://api.github.com')
        .get('/advisories')
        .query({ cve_id: nonExistentCve, per_page: 1 })
        .reply(200, [])

      const result = await convertIdsToGhsas([nonExistentCve])
      expect(result).toEqual([])
    })
  })

  describe('PURL validation and conversion (with pkg: prefix)', () => {
    it('should convert valid PURLs with pkg: prefix to GHSA IDs', async () => {
      const lodashPurl = 'pkg:npm/lodash@4.17.20'
      const expectedGhsas = ['GHSA-35jh-r3h4-6jhm', 'GHSA-4xc9-xhrj-v574']

      // Mock the GitHub API call for PURL to GHSA conversion
      nock('https://api.github.com')
        .get('/advisories')
        .query({ ecosystem: 'npm', affects: 'lodash@4.17.20' })
        .reply(200, [
          {
            ghsa_id: 'GHSA-35jh-r3h4-6jhm',
            package: { name: 'lodash', ecosystem: 'npm' },
            vulnerable_version_range: '<= 4.17.20',
          },
          {
            ghsa_id: 'GHSA-4xc9-xhrj-v574',
            package: { name: 'lodash', ecosystem: 'npm' },
            vulnerable_version_range: '<= 4.17.20',
          },
        ])

      const result = await convertIdsToGhsas([lodashPurl])
      expect(result).toEqual(expectedGhsas)
    })

    it('should handle scoped packages with pkg: prefix', async () => {
      const scopedPurl = 'pkg:npm/@types/lodash@4.14.165'

      // Mock the GitHub API call - note: current implementation only uses name part
      // This is likely a bug that should be fixed to use full scoped package name
      nock('https://api.github.com')
        .get('/advisories')
        .query({ ecosystem: 'npm', affects: 'lodash@4.14.165' })
        .reply(200, [])

      const result = await convertIdsToGhsas([scopedPurl])
      expect(result).toEqual([])
    })
  })

  describe('PURL validation and conversion (without pkg: prefix)', () => {
    it('should handle PURLs without pkg: prefix as unsupported format', async () => {
      const purlWithoutPrefix = 'npm/lodash@4.17.20'

      const result = await convertIdsToGhsas([purlWithoutPrefix])
      expect(result).toEqual([])
    })
  })

  describe('Mixed ID inputs', () => {
    it('should handle mixed valid ID types', async () => {
      const mixedIds = [
        'GHSA-1234-5678-9abc',
        'CVE-2021-23337',
        'pkg:npm/lodash@4.17.20',
      ]

      // Mock GitHub API calls
      nock('https://api.github.com')
        .get('/advisories')
        .query({ cve_id: 'CVE-2021-23337', per_page: 1 })
        .reply(200, [{ ghsa_id: 'GHSA-35jh-r3h4-6jhm' }])

      nock('https://api.github.com')
        .get('/advisories')
        .query({ ecosystem: 'npm', affects: 'lodash@4.17.20' })
        .reply(200, [
          {
            ghsa_id: 'GHSA-4xc9-xhrj-v574',
            package: { name: 'lodash', ecosystem: 'npm' },
            vulnerable_version_range: '<= 4.17.20',
          },
        ])

      const result = await convertIdsToGhsas(mixedIds)
      expect(result).toEqual([
        'GHSA-1234-5678-9abc',
        'GHSA-35jh-r3h4-6jhm',
        'GHSA-4xc9-xhrj-v574',
      ])
    })

    it('should handle mixed valid and invalid IDs', async () => {
      const mixedIds = [
        'GHSA-1234-5678-9abc', // valid
        'invalid-id', // invalid
        'CVE-123', // invalid CVE format
        'pkg:npm/lodash@4.17.20', // valid
      ]

      // Mock GitHub API call for the valid PURL
      nock('https://api.github.com')
        .get('/advisories')
        .query({ ecosystem: 'npm', affects: 'lodash@4.17.20' })
        .reply(200, [
          {
            ghsa_id: 'GHSA-4xc9-xhrj-v574',
            package: { name: 'lodash', ecosystem: 'npm' },
            vulnerable_version_range: '<= 4.17.20',
          },
        ])

      const result = await convertIdsToGhsas(mixedIds)
      expect(result).toEqual(['GHSA-1234-5678-9abc', 'GHSA-4xc9-xhrj-v574'])
    })
  })

  describe('Invalid ID formats', () => {
    it('should reject completely invalid ID formats', async () => {
      const invalidIds = [
        'random-string',
        'VULN-2021-1234',
        'npm/lodash', // missing version
        'pkg:maven/com.fasterxml.jackson.core/jackson-databind', // missing version
        '',
        '   ',
      ]

      // Mock GitHub API call for the Maven PURL (which will return no results)
      nock('https://api.github.com')
        .get('/advisories')
        .query({ ecosystem: 'maven', affects: 'jackson-databind' })
        .reply(200, [])

      const result = await convertIdsToGhsas(invalidIds)
      expect(result).toEqual([])
    })

    it('should handle empty input array', async () => {
      const result = await convertIdsToGhsas([])
      expect(result).toEqual([])
    })
  })

  describe('Error handling', () => {
    it('should handle GitHub API errors gracefully', async () => {
      const cveId = 'CVE-2021-23337'

      // Mock GitHub API to return error
      nock('https://api.github.com')
        .get('/advisories')
        .query({ cve_id: cveId, per_page: 1 })
        .reply(500, { message: 'Internal Server Error' })

      const result = await convertIdsToGhsas([cveId])
      expect(result).toEqual([])
    })

    it('should handle network timeouts', async () => {
      const purlId = 'pkg:npm/lodash@4.17.20'

      // Mock GitHub API to timeout
      nock('https://api.github.com')
        .get('/advisories')
        .query({ ecosystem: 'npm', affects: 'lodash@4.17.20' })
        .replyWithError('ETIMEDOUT')

      const result = await convertIdsToGhsas([purlId])
      expect(result).toEqual([])
    })
  })
})
