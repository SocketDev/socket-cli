/** @fileoverview Simple test for Socket SDK upload manifest files method to improve coverage. */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'

import nock from 'nock'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { SocketSdk } from '../src/index'
import { setupNockEnvironment } from './utils/environment.mts'
import { FAST_TEST_CONFIG } from './utils/fast-test-config.mts'

describe('SocketSdk - Upload Manifest Coverage', () => {
  setupNockEnvironment()

  let tempDir: string
  let packageJsonPath: string
  let sdk: SocketSdk

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'socket-sdk-upload-coverage-'))
    packageJsonPath = path.join(tempDir, 'package.json')

    writeFileSync(
      packageJsonPath,
      JSON.stringify({ name: 'test-pkg', version: '1.0.0' }),
    )

    sdk = new SocketSdk('test-token', FAST_TEST_CONFIG)
  })

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  describe('uploadManifestFiles', () => {
    it(
      'should successfully execute upload manifest files method',
      { retry: 2 },
      async () => {
        nock('https://api.socket.dev')
          .post('/v0/orgs/test-org/upload-manifest-files')
          .reply(200, {
            tarHash: 'abc123def456',
            unmatchedFiles: [],
          })

        const result = await sdk.uploadManifestFiles('test-org', [
          packageJsonPath,
        ])

        expect(result.success).toBe(true)
        expect(result.status).toBe(200)
        if (result.success) {
          expect(result.data.tarHash).toBe('abc123def456')
          expect(result.data.unmatchedFiles).toEqual([])
        }
      },
    )

    it(
      'should handle errors in uploadManifestFiles',
      { retry: 2 },
      async () => {
        nock('https://api.socket.dev')
          .post('/v0/orgs/test-org/upload-manifest-files')
          .reply(400, {
            error: {
              message: 'Invalid manifest files',
            },
          })

        const result = await sdk.uploadManifestFiles('test-org', [
          packageJsonPath,
        ])

        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.status).toBe(400)
          expect(result.error).toContain('Invalid manifest files')
        }
      },
    )
  })
})
