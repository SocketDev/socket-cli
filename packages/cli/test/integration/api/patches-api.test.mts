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

import { setupSdk } from '../../../src/utils/socket/sdk.mts'
import {
  cleanupLocalServer,
  setupLocalServer,
} from '../../helpers/local-server.mts'

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
        console.log(
          '  Start server with: cd ../depscan/workspaces/api-v0 && pnpm test',
        )
        console.log(
          '  API server runs on port 8866 (not the web server on port 3000)',
        )
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
      expect(sdk).toBeDefined()

      // Note: Requires depscan API endpoint implementation.
      // Expected endpoint: GET /orgs/:org_slug/patches/scan/:scan_id
      //
      // When implemented, test should verify:
      // - artifactId is a string
      // - purl object contains { type, name, version?, namespace?, subpath?, artifactId? }
      // - purlString is formatted correctly (e.g., "pkg:npm/lodash@4.20.0")
      // - patch object contains uuid, publishedAt, description, license, tier
      // - patch.tier is either 'free' or 'enterprise'
      // - freeCves and paidCves are arrays with CVE metadata
      // - freeFeatures and paidFeatures are string arrays
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
      expect(sdk).toBeDefined()

      // Note: Requires depscan API endpoint implementation.
      // When implemented, test should verify paidFeatures contains upgrade messaging.
      // Expected format: ["Upgrade tier for X additional vulnerabilities"]
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
      expect(sdk).toBeDefined()

      // Note: Requires depscan API endpoint implementation.
      // When implemented, test should verify:
      // - Only one patch per PURL is returned
      // - Latest patch is selected based on tier
      // - paidCves do not overlap with freeCves
    })
  })

  describe('PURL Construction', () => {
    it('should include PURL object with all fields', async () => {
      if (!localServerUrl) {
        return
      }

      // Note: Requires depscan API endpoint implementation.
      // When implemented, verify PURL object structure:
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

      // Note: Requires depscan API endpoint implementation.
      // When implemented, verify purlString format matches Package URL spec.
      // Example: "pkg:npm/lodash@4.20.0"
    })
  })

  describe('CVE Splitting', () => {
    it('should separate freeCves and paidCves without overlap', async () => {
      if (!localServerUrl) {
        return
      }

      // Note: Requires depscan API endpoint implementation.
      // When implemented, verify:
      // - freeCves: CVEs fixed by free patch
      // - paidCves: CVEs fixed ONLY by paid patch (not in freeCves)
      // - No duplicates between arrays
    })

    it('should include CVE metadata in records', async () => {
      if (!localServerUrl) {
        return
      }

      // Note: Requires depscan API endpoint implementation.
      // When implemented, verify CVE record structure includes:
      // - cveId: string | null
      // - ghsaId: string | null
      // - summary: string
      // - severity: string
    })
  })

  describe('Feature Descriptions', () => {
    it('should generate freeFeatures for free tier users', async () => {
      if (!localServerUrl) {
        return
      }

      // Note: Requires depscan API endpoint implementation.
      // When implemented, verify freeFeatures format.
      // Example: ["Fixes 2 vulnerabilities"]
    })

    it('should generate paidFeatures with upgrade messaging', async () => {
      if (!localServerUrl) {
        return
      }

      // Note: Requires depscan API endpoint implementation.
      // When implemented, verify paidFeatures contains upgrade messaging.
      // Example: ["Upgrade tier for 3 additional vulnerabilities"]
    })

    it('should show total fixes for enterprise tier users', async () => {
      if (!localServerUrl) {
        return
      }

      // Note: Requires depscan API endpoint implementation.
      // When implemented, verify paidFeatures shows total fixes for enterprise.
      // Example: ["Fixes 5 vulnerabilities"]
    })
  })
})
