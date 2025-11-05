/**
 * @fileoverview Tests for v3.0 strict type system.
 * Validates that new strict types properly reflect API responses.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import nock from 'nock'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { SocketSdk } from '../src/socket-sdk-class'
import { setupTestEnvironment } from './utils/environment.mts'

import type {
  FullScanItem,
  FullScanListResult,
  FullScanResult,
  OrganizationsResult,
} from '../src/types-strict'

describe('Strict Types - v3.0', () => {
  const baseUrl = 'https://api.socket.dev/v0'

  setupTestEnvironment()

  beforeEach(() => {
    nock.cleanAll()
  })

  afterEach(() => {
    nock.cleanAll()
  })

  describe('FullScanListResult', () => {
    it('should have guaranteed required fields', async () => {
      const mockResponse = {
        results: [
          {
            id: 'scan-123',
            created_at: '2025-01-01T00:00:00Z',
            updated_at: '2025-01-01T00:00:00Z',
            organization_id: 'org-456',
            organization_slug: 'test-org',
            repository_id: 'repo-789',
            repository_slug: 'test-repo',
            repo: 'test-repo',
            html_report_url: 'https://socket.dev/report/123',
            api_url: 'https://api.socket.dev/v0/scans/123',
            integration_type: 'github',
            integration_repo_url: 'https://github.com/org/repo',
            branch: 'main',
            commit_message: 'Test commit',
            commit_hash: 'abc123',
            pull_request: null,
            committers: [],
            html_url: null,
            integration_branch_url: null,
            integration_commit_url: null,
            integration_pull_request_url: null,
            scan_state: 'pending',
          },
        ],
        nextPageCursor: null,
        nextPage: null,
      }

      nock(baseUrl)
        .get('/orgs/test-org/full-scans')
        .query(true)
        .reply(200, mockResponse)

      const client = new SocketSdk('test-token', { baseUrl, retries: 0 })
      const result = await client.listFullScans('test-org')

      expect(result.success).toBe(true)

      if (result.success) {
        // Type assertion to verify TypeScript types
        const typedResult: FullScanListResult = result

        // Verify required fields are present and correctly typed
        expect(typedResult.data.results).toHaveLength(1)

        const scan = typedResult.data.results[0]
        expect(scan).toBeDefined()
        if (!scan) {
          return
        }

        // Required string fields
        expect(typeof scan.id).toBe('string')
        expect(typeof scan.created_at).toBe('string')
        expect(typeof scan.updated_at).toBe('string')
        expect(typeof scan.organization_id).toBe('string')
        expect(typeof scan.organization_slug).toBe('string')
        expect(typeof scan.repository_id).toBe('string')
        expect(typeof scan.repository_slug).toBe('string')
        expect(typeof scan.repo).toBe('string')
        expect(typeof scan.html_report_url).toBe('string')
        expect(typeof scan.api_url).toBe('string')
        expect(typeof scan.integration_type).toBe('string')
        expect(typeof scan.integration_repo_url).toBe('string')

        // Optional/nullable fields
        expect(scan.branch === null || typeof scan.branch === 'string').toBe(
          true,
        )
        expect(
          scan.commit_message === null ||
            typeof scan.commit_message === 'string',
        ).toBe(true)
        expect(
          scan.commit_hash === null || typeof scan.commit_hash === 'string',
        ).toBe(true)
        expect(
          scan.pull_request === null || typeof scan.pull_request === 'number',
        ).toBe(true)

        // Array fields
        expect(Array.isArray(scan.committers)).toBe(true)

        // Pagination fields
        expect(
          typedResult.data.nextPageCursor === null ||
            typeof typedResult.data.nextPageCursor === 'string',
        ).toBe(true)
        expect(
          typedResult.data.nextPage === null ||
            typeof typedResult.data.nextPage === 'number',
        ).toBe(true)
      }
    })
  })

  describe('FullScanResult', () => {
    it('should have guaranteed required fields from createFullScan', async () => {
      const mockResponse = {
        id: 'scan-new',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
        organization_id: 'org-456',
        organization_slug: 'test-org',
        repository_id: 'repo-789',
        repository_slug: 'test-repo',
        repo: 'test-repo',
        html_report_url: 'https://socket.dev/report/new',
        api_url: 'https://api.socket.dev/v0/scans/new',
        integration_type: 'api',
        integration_repo_url: 'https://github.com/org/repo',
        branch: null,
        commit_message: null,
        commit_hash: null,
        pull_request: null,
        committers: [],
        html_url: null,
        integration_branch_url: null,
        integration_commit_url: null,
        integration_pull_request_url: null,
        scan_state: 'pending',
      }

      // Create temporary directory and test file
      const tempDir = mkdtempSync(join(tmpdir(), 'socket-sdk-test-'))
      const testFile = join(tempDir, 'package.json')
      writeFileSync(
        testFile,
        JSON.stringify({ name: 'test-pkg', version: '1.0.0' }),
      )

      nock(baseUrl)
        .post('/orgs/test-org/full-scans')
        .query({ repo: 'test-repo' })
        .reply(200, mockResponse)

      try {
        const client = new SocketSdk('test-token', { baseUrl, retries: 0 })
        const result = await client.createFullScan('test-org', [testFile], {
          pathsRelativeTo: tempDir,
          repo: 'test-repo',
        })

        expect(result.success).toBe(true)

        if (result.success) {
          const typedResult: FullScanResult = result

          // Verify all required fields exist
          expect(typedResult.data.id).toBe('scan-new')
          expect(typedResult.data.created_at).toBeTruthy()
          expect(typedResult.data.organization_id).toBeTruthy()
          expect(typedResult.data.repository_slug).toBeTruthy()
        }
      } finally {
        // Clean up temporary directory
        rmSync(tempDir, { recursive: true })
      }
    })

    it('should handle getFullScan response', async () => {
      const mockResponse = {
        id: 'scan-get',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
        organization_id: 'org-456',
        organization_slug: 'test-org',
        repository_id: 'repo-789',
        repository_slug: 'test-repo',
        repo: 'test-repo',
        html_report_url: 'https://socket.dev/report/get',
        api_url: 'https://api.socket.dev/v0/scans/get',
        integration_type: 'github',
        integration_repo_url: 'https://github.com/org/repo',
        branch: 'main',
        commit_message: 'Test',
        commit_hash: 'abc',
        pull_request: 42,
        committers: ['user@example.com'],
        html_url: 'https://socket.dev',
        integration_branch_url: 'https://github.com/org/repo/tree/main',
        integration_commit_url: 'https://github.com/org/repo/commit/abc',
        integration_pull_request_url: 'https://github.com/org/repo/pull/42',
        scan_state: 'scan',
      }

      nock(baseUrl)
        .get('/orgs/test-org/full-scans/scan-get')
        .query(true)
        .reply(200, mockResponse)

      const client = new SocketSdk('test-token', { baseUrl, retries: 0 })
      const result = await client.getFullScan('test-org', 'scan-get')

      expect(result.success).toBe(true)

      if (result.success) {
        const typedResult: FullScanResult = result

        // Verify scan has all required fields
        expect(typedResult.data.id).toBe('scan-get')
        expect(typedResult.data.branch).toBe('main')
        expect(typedResult.data.pull_request).toBe(42)
        expect(typedResult.data.scan_state).toBe('scan')
      }
    })
  })

  describe('OrganizationsResult', () => {
    it('should have guaranteed organization fields', async () => {
      const mockResponse = {
        organizations: [
          {
            id: 'org-1',
            name: 'Test Org',
            slug: 'test-org',
            created_at: '2025-01-01T00:00:00Z',
            updated_at: '2025-01-01T00:00:00Z',
            plan: 'pro',
          },
          {
            id: 'org-2',
            name: 'Another Org',
            slug: 'another-org',
            created_at: '2025-01-01T00:00:00Z',
            updated_at: '2025-01-01T00:00:00Z',
            plan: 'free',
          },
        ],
      }

      nock(baseUrl).get('/organizations').query(true).reply(200, mockResponse)

      const client = new SocketSdk('test-token', { baseUrl, retries: 0 })
      const result = await client.listOrganizations()

      expect(result.success).toBe(true)

      if (result.success) {
        const typedResult: OrganizationsResult = result

        expect(typedResult.data.organizations).toHaveLength(2)

        typedResult.data.organizations.forEach(org => {
          // All fields should be present and correctly typed
          expect(typeof org.id).toBe('string')
          expect(typeof org.name).toBe('string')
          expect(typeof org.slug).toBe('string')
          expect(typeof org.created_at).toBe('string')
          expect(typeof org.updated_at).toBe('string')
          expect(typeof org.plan).toBe('string')
        })

        // Specific value checks
        const firstOrg = typedResult.data.organizations[0]
        const secondOrg = typedResult.data.organizations[1]
        expect(firstOrg).toBeDefined()
        expect(secondOrg).toBeDefined()
        if (firstOrg && secondOrg) {
          expect(firstOrg.name).toBe('Test Org')
          expect(secondOrg.slug).toBe('another-org')
        }
      }
    })
  })

  describe('Error Responses', () => {
    it('should return StrictErrorResult on failure', async () => {
      nock(baseUrl).get('/orgs/test-org/full-scans').query(true).reply(404, {
        error: 'Not Found',
        message: 'Organization not found',
      })

      const client = new SocketSdk('test-token', { baseUrl, retries: 0 })
      const result = await client.listFullScans('test-org')

      expect(result.success).toBe(false)

      if (!result.success) {
        expect(typeof result.error).toBe('string')
        expect(result.status).toBe(404)
        expect(result.data).toBeUndefined()
      }
    })
  })

  describe('Type Safety', () => {
    it('should enforce correct types at compile time', () => {
      // This test validates TypeScript compilation, not runtime behavior
      // If this compiles without errors, type safety is working

      const mockFullScanItem: FullScanItem = {
        id: 'test',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
        organization_id: 'org',
        organization_slug: 'org-slug',
        repository_id: 'repo',
        repository_slug: 'repo-slug',
        repo: 'repo',
        html_report_url: 'https://example.com',
        api_url: 'https://api.example.com',
        integration_type: 'api',
        integration_repo_url: 'https://example.com',
        branch: null,
        commit_message: null,
        commit_hash: null,
        pull_request: null,
        committers: [],
        html_url: null,
        integration_branch_url: null,
        integration_commit_url: null,
        integration_pull_request_url: null,
        scan_state: null,
      }

      // TypeScript will catch if required fields are missing
      expect(mockFullScanItem.id).toBeDefined()
      expect(mockFullScanItem.created_at).toBeDefined()
    })
  })
})
