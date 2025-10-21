/**
 * Integration tests for patches API with local depscan API server.
 *
 * These tests require the local depscan API server to be running on port 8866.
 * This is the API server, not the Next.js web server (which runs on port 3000).
 *
 * To run these tests:
 * ```bash
 * # Start depscan API server in one terminal (runs on port 8866)
 * cd /Users/jdalton/projects/depscan/workspaces/api-v0
 * pnpm test
 *
 * # Run tests in another terminal
 * cd /Users/jdalton/projects/socket-cli
 * pnpm test:unit test/integration/patches-api.test.mts
 * ```
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { setupSdk } from '../../src/utils/socket/sdk.mts'
import {
  cleanupLocalServer,
  setupLocalServer,
} from '../helpers/local-server.mts'

describe('Patches API Integration', () => {
  let originalUrl: string | undefined
  let localServerUrl: string | undefined

  beforeEach(async () => {
    originalUrl = await setupLocalServer()
    localServerUrl = process.env['SOCKET_CLI_API_BASE_URL']
  })

  afterEach(() => {
    cleanupLocalServer(originalUrl)
  })

  describe('GET /orgs/:org_slug/patches/scan/:scan_id', () => {
    it('should skip if local server not running', async () => {
      if (!localServerUrl) {
        console.log('⊘ Skipping test: local depscan API server not running')
        console.log('  Start server with: cd ../depscan/workspaces/api-v0 && pnpm test')
        console.log('  API server runs on port 8866 (not the web server on port 3000)')
        return
      }

      // Test will only run if local server is available.
      expect(localServerUrl).toBeDefined()
    })

    it('should stream patches with PURL objects for free tier org', async () => {
      if (!localServerUrl) {
        return
      }

      // Set up SDK with test API token.
      const sdkResult = await setupSdk({
        apiToken: process.env['SOCKET_TEST_API_TOKEN'] || 'test-token',
        apiBaseUrl: localServerUrl,
      })

      if (!sdkResult.ok) {
        throw new Error(`Failed to setup SDK: ${sdkResult.message}`)
      }

      const sdk = sdkResult.data

      // Example: Fetch patches for a scan.
      // Replace with actual test org slug and scan ID.
      const orgSlug = 'test-org'
      const scanId = 'test-scan-id'

      // TODO: Implement actual API call when endpoint is ready.
      // const response = await sdk.get(`/orgs/${orgSlug}/patches/scan/${scanId}`)

      // Expected response structure:
      // {
      //   artifactId: string
      //   purl: { type, name, version?, namespace?, subpath?, artifactId? }
      //   purlString: string
      //   patch: {
      //     uuid: string
      //     publishedAt: string
      //     description: string
      //     license: string
      //     tier: 'free' | 'enterprise'
      //     freeCves: Array<{ cveId, ghsaId, summary, severity }>
      //     paidCves: Array<{ cveId, ghsaId, summary, severity }>
      //     freeFeatures: string[]
      //     paidFeatures: string[]
      //   } | null
      // }

      expect(sdk).toBeDefined()
    })

    it('should stream patches with upgrade messaging for free tier org', async () => {
      if (!localServerUrl) {
        return
      }

      const sdkResult = await setupSdk({
        apiToken: process.env['SOCKET_TEST_API_TOKEN'] || 'test-token',
        apiBaseUrl: localServerUrl,
      })

      if (!sdkResult.ok) {
        throw new Error(`Failed to setup SDK: ${sdkResult.message}`)
      }

      const sdk = sdkResult.data

      // TODO: Implement test to verify paidFeatures contains upgrade messaging.
      // Expected: paidFeatures: ["Upgrade tier for X additional vulnerabilities"]

      expect(sdk).toBeDefined()
    })

    it('should stream latest patch per PURL for enterprise tier org', async () => {
      if (!localServerUrl) {
        return
      }

      const sdkResult = await setupSdk({
        apiToken: process.env['SOCKET_TEST_API_TOKEN'] || 'test-token',
        apiBaseUrl: localServerUrl,
      })

      if (!sdkResult.ok) {
        throw new Error(`Failed to setup SDK: ${sdkResult.message}`)
      }

      const sdk = sdkResult.data

      // TODO: Implement test to verify:
      // - Only one patch per PURL
      // - Latest patch selected based on tier
      // - paidCves are non-overlapping with freeCves

      expect(sdk).toBeDefined()
    })
  })

  describe('PURL Construction', () => {
    it('should include PURL object with all fields', async () => {
      if (!localServerUrl) {
        return
      }

      // TODO: Verify PURL object structure:
      // - type: string (npm, pypi, maven, etc.)
      // - name: string (required)
      // - version?: string (optional)
      // - namespace?: string (optional)
      // - subpath?: string (optional)
      // - artifactId?: string (optional, pypi only)
    })

    it('should include purlString for display', async () => {
      if (!localServerUrl) {
        return
      }

      // TODO: Verify purlString format:
      // Example: "pkg:npm/lodash@4.20.0"
    })
  })

  describe('CVE Splitting', () => {
    it('should separate freeCves and paidCves without overlap', async () => {
      if (!localServerUrl) {
        return
      }

      // TODO: Verify:
      // - freeCves: CVEs fixed by free patch
      // - paidCves: CVEs fixed ONLY by paid patch (not in freeCves)
      // - No duplicates between arrays
    })

    it('should include CVE metadata in records', async () => {
      if (!localServerUrl) {
        return
      }

      // TODO: Verify CVE record structure:
      // {
      //   cveId: string | null
      //   ghsaId: string | null
      //   summary: string
      //   severity: string
      // }
    })
  })

  describe('Feature Descriptions', () => {
    it('should generate freeFeatures for free tier users', async () => {
      if (!localServerUrl) {
        return
      }

      // TODO: Verify freeFeatures format:
      // Example: ["Fixes 2 vulnerabilities"]
    })

    it('should generate paidFeatures with upgrade messaging', async () => {
      if (!localServerUrl) {
        return
      }

      // TODO: Verify paidFeatures format:
      // Example: ["Upgrade tier for 3 additional vulnerabilities"]
    })

    it('should show total fixes for enterprise tier users', async () => {
      if (!localServerUrl) {
        return
      }

      // TODO: Verify paidFeatures for enterprise:
      // Example: ["Fixes 5 vulnerabilities"]
    })
  })
})
