/** @fileoverview Tests for batch package fetch and streaming operations. */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'

import nock from 'nock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SocketSdk } from '../src/index'
import { setupNockEnvironment } from './utils/environment.mts'
import { FAST_TEST_CONFIG, NO_RETRY_CONFIG } from './utils/fast-test-config.mts'

import type { IncomingHttpHeaders } from 'node:http'

describe('SocketSdk - Batch Operations', () => {
  describe('Reachability', () => {
    setupNockEnvironment()

    it('should detect reachable packages in batch fetch', async () => {
      const mockResponse = {
        purl: 'pkg:npm/express@4.19.2',
        name: 'express',
        version: '4.19.2',
        type: 'npm',
        alertKeysToReachabilityTypes: {
          malware: ['direct'],
          criticalCVE: ['transitive'],
        },
        alertKeysToReachabilitySummaries: {
          malware: {
            reachable: true,
            directlyReachable: true,
            transitivelyReachable: false,
          },
          criticalCVE: {
            reachable: true,
            directlyReachable: false,
            transitivelyReachable: true,
          },
        },
        alerts: [
          {
            type: 'malware',
            severity: 'critical',
            key: 'malware',
            props: {},
          },
          {
            type: 'criticalCVE',
            severity: 'high',
            key: 'criticalCVE',
            props: {},
          },
        ],
      }

      nock('https://api.socket.dev')
        .post('/v0/purl')
        .reply(200, `${JSON.stringify(mockResponse)}\n`)

      const client = new SocketSdk('test-token', FAST_TEST_CONFIG)
      const res = await client.batchPackageFetch({
        components: [{ purl: 'pkg:npm/express@4.19.2' }],
      })

      expect(res.success).toBe(true)
      if (res.success) {
        expect(res.data).toHaveLength(1)
        const artifact = (res.data as any[])[0]
        expect(artifact.alertKeysToReachabilitySummaries).toBeDefined()
        expect(
          artifact.alertKeysToReachabilitySummaries.malware.reachable,
        ).toBe(true)
        expect(
          artifact.alertKeysToReachabilitySummaries.malware.directlyReachable,
        ).toBe(true)
        expect(
          artifact.alertKeysToReachabilitySummaries.criticalCVE
            .transitivelyReachable,
        ).toBe(true)
      }
    })

    it('should handle unreachable packages', async () => {
      const mockResponse = {
        purl: 'pkg:npm/lodash@4.17.21',
        name: 'lodash',
        version: '4.17.21',
        type: 'npm',
        alertKeysToReachabilityTypes: {},
        alertKeysToReachabilitySummaries: {},
        alerts: [
          {
            type: 'unpopularPackage',
            severity: 'low',
            key: 'unpopularPackage',
            props: {},
          },
        ],
      }

      nock('https://api.socket.dev')
        .post('/v0/purl')
        .reply(200, `${JSON.stringify(mockResponse)}\n`)

      const client = new SocketSdk('test-token', NO_RETRY_CONFIG)
      const res = await client.batchPackageFetch({
        components: [{ purl: 'pkg:npm/lodash@4.17.21' }],
      })

      expect(res.success).toBe(true)
      if (res.success) {
        const artifact = (res.data as any[])[0]
        expect(artifact.alertKeysToReachabilitySummaries).toEqual({})
        expect(artifact.alertKeysToReachabilityTypes).toEqual({})
      }
    })

    it('should handle mixed reachability in batch requests', async () => {
      const responses = [
        {
          purl: 'pkg:npm/react@18.0.0',
          name: 'react',
          version: '18.0.0',
          type: 'npm',
          alertKeysToReachabilitySummaries: {
            cve: {
              reachable: true,
              directlyReachable: true,
              transitivelyReachable: false,
            },
          },
          alerts: [{ type: 'cve', severity: 'medium', key: 'cve' }],
        },
        {
          purl: 'pkg:npm/vue@3.0.0',
          name: 'vue',
          version: '3.0.0',
          type: 'npm',
          alertKeysToReachabilitySummaries: {},
          alerts: [],
        },
      ]

      nock('https://api.socket.dev')
        .post('/v0/purl')
        .reply(200, responses.map(r => JSON.stringify(r)).join('\n'))

      const client = new SocketSdk('test-token', NO_RETRY_CONFIG)
      const res = await client.batchPackageFetch({
        components: [
          { purl: 'pkg:npm/react@18.0.0' },
          { purl: 'pkg:npm/vue@3.0.0' },
        ],
      })

      expect(res.success).toBe(true)
      if (res.success) {
        expect(res.data).toHaveLength(2)
        const data = res.data as any[]
        expect(data[0].alertKeysToReachabilitySummaries.cve.reachable).toBe(
          true,
        )
        expect(data[1].alertKeysToReachabilitySummaries).toEqual({})
      }
    })

    it.sequential(
      'should handle network timeouts for reachability checks',
      async () => {
        // Use fake timers to avoid actual delay
        vi.useFakeTimers()

        nock('https://api.socket.dev')
          .post('/v0/purl')
          .delayConnection(6000)
          .reply(200, {})

        const client = new SocketSdk('test-token', {
          ...FAST_TEST_CONFIG,
          timeout: 5000,
        })

        const promise = client.batchPackageFetch({
          components: [{ purl: 'pkg:npm/test@1.0.0' }],
        })

        // Advance timers to trigger timeout
        await vi.advanceTimersByTimeAsync(5001)

        await expect(promise).rejects.toThrow()

        vi.useRealTimers()
      },
      10_000,
    )

    it('should handle partial response data', async () => {
      nock('https://api.socket.dev')
        .post('/v0/purl')
        .reply(200, '{"purl":"pkg:npm/test@1.0.0","na')

      const client = new SocketSdk('test-token', NO_RETRY_CONFIG)
      const res = await client.batchPackageFetch({
        components: [{ purl: 'pkg:npm/test@1.0.0' }],
      })

      expect(res.success).toBe(true)
      if (res.success) {
        expect(res.data).toEqual([])
      }
    })

    it('should handle batch streaming with error responses', async () => {
      const errorResponse = {
        error: 'Package not found',
        purl: 'pkg:npm/nonexistent@1.0.0',
      }

      nock('https://api.socket.dev')
        .post('/v0/purl')
        .reply(200, `${JSON.stringify(errorResponse)}\n`)

      const client = new SocketSdk('test-token', FAST_TEST_CONFIG)

      // Use the streaming method directly
      const stream = client.batchPackageStream({
        components: [{ purl: 'pkg:npm/nonexistent@1.0.0' }],
      })

      const results = []
      for await (const item of stream) {
        results.push(item)
      }

      expect(results).toHaveLength(1)
      // The stream returns wrapped results, not raw error responses
      expect(results[0]).toBeDefined()
      if (results[0] && 'data' in results[0]) {
        expect(results[0].data).toEqual(errorResponse)
      }
    })

    it('should handle empty batch response', async () => {
      nock('https://api.socket.dev').post('/v0/purl').reply(200, '')

      const client = new SocketSdk('test-token', FAST_TEST_CONFIG)
      const res = await client.batchPackageFetch({
        components: [{ purl: 'pkg:npm/empty@1.0.0' }],
      })

      expect(res.success).toBe(true)
      if (res.success) {
        expect(res.data).toEqual([])
      }
    })

    it('should handle newline-separated JSON responses', async () => {
      const responses = [
        { purl: 'pkg:npm/pkg1@1.0.0', name: 'pkg1', version: '1.0.0' },
        { purl: 'pkg:npm/pkg2@2.0.0', name: 'pkg2', version: '2.0.0' },
      ]

      nock('https://api.socket.dev')
        .post('/v0/purl')
        .reply(200, `${responses.map(r => JSON.stringify(r)).join('\n')}\n`)

      const client = new SocketSdk('test-token', FAST_TEST_CONFIG)
      const res = await client.batchPackageFetch({
        components: [
          { purl: 'pkg:npm/pkg1@1.0.0' },
          { purl: 'pkg:npm/pkg2@2.0.0' },
        ],
      })

      expect(res.success).toBe(true)
      if (res.success) {
        expect(res.data).toHaveLength(2)
        expect((res.data as any[])[0].name).toBe('pkg1')
        expect((res.data as any[])[1].name).toBe('pkg2')
      }
    })

    it('should handle compact mode in batch fetch', async () => {
      const mockResponse = {
        purl: 'pkg:npm/express@4.19.2',
        name: 'express',
        version: '4.19.2',
        type: 'npm',
      }

      nock('https://api.socket.dev')
        .post('/v0/purl?compact=true')
        .reply(200, `${JSON.stringify(mockResponse)}\n`)

      const client = new SocketSdk('test-token', FAST_TEST_CONFIG)
      const res = await client.batchPackageFetch(
        {
          components: [{ purl: 'pkg:npm/express@4.19.2' }],
        },
        { compact: 'true' },
      )

      expect(res.success).toBe(true)
      if (res.success) {
        expect(res.data).toHaveLength(1)
        const artifact = (res.data as any[])[0]
        expect(artifact.name).toBe('express')
      }
    })

    it('should handle responses with empty lines', async () => {
      const responses = [
        { purl: 'pkg:npm/pkg1@1.0.0', name: 'pkg1', version: '1.0.0' },
        { purl: 'pkg:npm/pkg2@2.0.0', name: 'pkg2', version: '2.0.0' },
      ]

      // Response with empty lines between results
      const responseText =
        JSON.stringify(responses[0]) +
        '\n\n' +
        JSON.stringify(responses[1]) +
        '\n'

      nock('https://api.socket.dev').post('/v0/purl').reply(200, responseText)

      const client = new SocketSdk('test-token', NO_RETRY_CONFIG)
      const res = await client.batchPackageFetch({
        components: [
          { purl: 'pkg:npm/pkg1@1.0.0' },
          { purl: 'pkg:npm/pkg2@2.0.0' },
        ],
      })

      expect(res.success).toBe(true)
      if (res.success) {
        expect(res.data).toHaveLength(2)
        expect((res.data as any[])[0].name).toBe('pkg1')
        expect((res.data as any[])[1].name).toBe('pkg2')
      }
    })
  })

  describe('Multi-part Upload', () => {
    setupNockEnvironment()

    let tempDir: string
    let packageJsonPath: string
    let packageLockPath: string

    beforeEach(() => {
      // Create a temporary directory for test files
      tempDir = mkdtempSync(path.join(tmpdir(), 'socket-sdk-test-'))

      // Create test manifest files
      packageJsonPath = path.join(tempDir, 'package.json')
      packageLockPath = path.join(tempDir, 'package-lock.json')

      writeFileSync(
        packageJsonPath,
        JSON.stringify(
          {
            name: 'test-project',
            version: '1.0.0',
            dependencies: {
              express: '^4.18.0',
              lodash: '^4.17.21',
            },
          },
          null,
          2,
        ),
      )

      writeFileSync(
        packageLockPath,
        JSON.stringify(
          {
            name: 'test-project',
            version: '1.0.0',
            lockfileVersion: 2,
            requires: true,
            packages: {
              '': {
                name: 'test-project',
                version: '1.0.0',
                dependencies: {
                  express: '^4.18.0',
                  lodash: '^4.17.21',
                },
              },
            },
          },
          null,
          2,
        ),
      )
    })

    afterEach(() => {
      // Clean up temporary files
      if (tempDir) {
        rmSync(tempDir, { recursive: true, force: true })
      }
    })

    it('should upload files with createDependenciesSnapshot', async () => {
      let capturedHeaders: IncomingHttpHeaders = {}

      nock('https://api.socket.dev')
        .post('/v0/dependencies/upload')
        .reply(function () {
          capturedHeaders = this.req.headers
          return [
            200,
            {
              id: 'snapshot-123',
              status: 'complete',
              files: ['package.json', 'package-lock.json'],
            },
          ]
        })

      const client = new SocketSdk('test-token', NO_RETRY_CONFIG)
      const res = await client.createDependenciesSnapshot(
        [packageJsonPath, packageLockPath],
        { pathsRelativeTo: tempDir },
      )

      expect(res.success).toBe(true)
      if (res.success) {
        expect(res.data['id']).toBe('snapshot-123')
        expect(res.data['files']).toContain('package.json')
        expect(res.data['files']).toContain('package-lock.json')
      }

      // Verify multipart headers
      expect(capturedHeaders['content-type']).toBeDefined()
      const contentType = Array.isArray(capturedHeaders['content-type'])
        ? capturedHeaders['content-type'][0]
        : capturedHeaders['content-type']
      expect(contentType).toContain('multipart/form-data')
      expect(contentType).toContain('boundary=')
    })

    it('should upload files with createFullScan', async () => {
      let capturedHeaders: IncomingHttpHeaders = {}

      nock('https://api.socket.dev')
        .post('/v0/orgs/test-org/full-scans')
        .query({ repo: 'test-repo' })
        .reply(function () {
          capturedHeaders = this.req.headers
          return [
            200,
            {
              id: 'org-scan-456',
              organization_slug: 'test-org',
              status: 'complete',
              files: ['package.json', 'package-lock.json'],
            },
          ]
        })

      const client = new SocketSdk('test-token', NO_RETRY_CONFIG)
      const res = await client.createFullScan(
        'test-org',
        [packageJsonPath, packageLockPath],
        { pathsRelativeTo: tempDir, repo: 'test-repo' },
      )

      expect(res.success).toBe(true)
      if (res.success) {
        expect(res.data.id).toBe('org-scan-456')
        expect(res.data.organization_slug).toBe('test-org')
      }

      // Verify multipart headers
      const contentType = Array.isArray(capturedHeaders['content-type'])
        ? capturedHeaders['content-type'][0]
        : capturedHeaders['content-type']
      expect(contentType).toContain('multipart/form-data')
      expect(contentType).toContain('boundary=')
    })

    it('should handle connection interruption during upload', async () => {
      nock('https://api.socket.dev')
        .post('/v0/dependencies/upload')
        .replyWithError(new Error('socket hang up'))

      const client = new SocketSdk('test-token', NO_RETRY_CONFIG)

      await expect(
        client.createDependenciesSnapshot([packageJsonPath], {
          pathsRelativeTo: tempDir,
        }),
      ).rejects.toThrow()
    })

    it('should handle non-existent file paths', async () => {
      const nonExistentPath = path.join(tempDir, 'non-existent.json')

      // The SDK validates files and returns an error result for unreadable files
      const client = new SocketSdk('test-token', NO_RETRY_CONFIG)

      const res = await client.createDependenciesSnapshot([nonExistentPath], {
        pathsRelativeTo: tempDir,
      })

      expect(res.success).toBe(false)
      if (!res.success) {
        expect(res.error).toBe('No readable manifest files found')
        expect(res.status).toBe(400)
      }
    })
  })
})
