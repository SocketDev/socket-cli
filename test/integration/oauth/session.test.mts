// oxlint-disable-next-line socket/prefer-async-spawn -- isolated child env
import { spawn as spawnIsolatedProcess } from 'node:child_process'
import crypto from 'node:crypto'
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { getEnvValue } from '@socketsecurity/lib-stable/env/rewire'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { refreshCliOAuthTokens } from '../../../src/util/socket/oauth-refresh.mts'
import { supportsOAuthSdk } from '../../../src/util/socket/sdk.mts'

const processFixture = fileURLToPath(
  new URL('./session-process.mts', import.meta.url),
)
let directory = ''
let issuer = ''
let clientId = ''
let mode = 'success'
let refreshRequests = 0
let apiRequests = 0
const requests: URLSearchParams[] = []
const server = createServer(async (request, response) => {
  if (request.url === '/v1/oauth2/token') {
    refreshRequests += 1
    let body = ''
    for await (const chunk of request) {
      body += String(chunk)
    }
    requests.push(new URLSearchParams(body))
    if (mode === 'drop') {
      request.socket.destroy()
      return
    }
    if (mode === 'redirect') {
      response.writeHead(307, { location: '/unexpected-token' })
      response.end('{}')
      return
    }
    if (mode === 'invalid-json') {
      response.end('{')
      return
    }
    if (mode === 'oversized') {
      response.end(JSON.stringify({ extra: 'x'.repeat(65_537) }))
      return
    }
    response.setHeader('content-type', 'application/json')
    response.statusCode = mode === 'revoked' ? 400 : 200
    response.end(
      JSON.stringify(
        mode === 'revoked'
          ? { error: 'invalid_grant' }
          : {
              access_token: 'REDACTED_ROTATED_ACCESS',
              refresh_token:
                mode === 'missing-rotation'
                  ? undefined
                  : 'REDACTED_ROTATED_REFRESH',
              expires_in: 900,
              token_type: 'Bearer',
            },
      ),
    )
    return
  }
  apiRequests += 1
  if (request.headers.authorization !== 'Bearer REDACTED_ROTATED_ACCESS') {
    response.writeHead(401)
    response.end('{}')
    return
  }
  response.setHeader('content-type', 'application/json')
  response.end('{"organizations":{}}')
})

async function createKeychainFixture(): Promise<void> {
  const bin = path.join(directory, 'bin')
  await mkdir(bin, { mode: 0o700 })
  await mkdir(path.join(directory, 'keychain'), { mode: 0o700 })
  await symlink(process.execPath, path.join(bin, 'node'))
  const executable = `#!/usr/bin/env node
import { runKeychainFixture } from ${JSON.stringify(pathToFileURL(processFixture).href)}
await runKeychainFixture()
`
  for (const name of ['security', 'secret-tool']) {
    const target = path.join(bin, name)
    await writeFile(target, executable, { mode: 0o700 })
    await chmod(target, 0o700)
  }
}

async function runSession(action: string): Promise<void> {
  const buildEnvironment = Object.fromEntries(
    [
      'INLINED_COANA_VERSION',
      'INLINED_HOMEPAGE',
      'INLINED_NAME',
      'INLINED_OPENGREP_VERSION',
      'INLINED_PUBLISHED_BUILD',
      'INLINED_PYCLI_VERSION',
      'INLINED_PYTHON_BUILD_TAG',
      'INLINED_PYTHON_VERSION',
      'INLINED_SOCKET_PATCH_VERSION',
      'INLINED_TRIVY_VERSION',
      'INLINED_TRUFFLEHOG_VERSION',
      'INLINED_VERSION',
      'INLINED_VERSION_HASH',
    ].map(name => [name, getEnvValue(name)]),
  )
  await new Promise<void>((resolve, reject) => {
    const child = spawnIsolatedProcess(
      process.execPath,
      [processFixture, action, issuer, clientId],
      {
        timeout: 30_000,
        killSignal: 'SIGKILL',
        stdio: ['ignore', 'ignore', 'pipe'],
        env: {
          ...buildEnvironment,
          PATH: path.join(directory, 'bin'),
          HOME: directory,
          XDG_DATA_HOME: directory,
          LOCALAPPDATA: directory,
          SOCKET_OAUTH_TEST_KEYCHAIN: path.join(directory, 'keychain'),
          SOCKET_OAUTH_TEST_ACCOUNT: crypto
            .createHash('sha256')
            .update(`${issuer}\n${clientId}`)
            .digest('hex'),
          SOCKET_CLI_ALLOWED_PRIVATE_HOSTS: '127.0.0.1',
          SOCKET_CLI_API_BASE_URL: new URL('/v0/', issuer).href,
          VITEST: 'true',
        },
      },
    )
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', chunk => {
      stderr += String(chunk)
    })
    child.on('error', reject)
    child.on('close', (code, signal) => {
      if (code === 0) {
        resolve()
      } else {
        reject(
          new Error(
            `OAuth fixture ${action} failed (${code ?? signal}): ${stderr}`,
          ),
        )
      }
    })
  })
}

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'socket-oauth-integration-'))
  if (['darwin', 'linux'].includes(process.platform)) {
    await createKeychainFixture()
  }
  clientId = `socket-cli-integration-${crypto.randomUUID()}`
  mode = 'success'
  refreshRequests = 0
  apiRequests = 0
  requests.length = 0
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('OAuth fixture server did not bind')
  }
  issuer = `http://127.0.0.1:${address.port}/v1/oauth2/`
})

afterEach(async () => {
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) =>
    server.close(error => {
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    }),
  )
  await safeDelete(directory)
})

describe('OAuth refresh HTTP transport', () => {
  it('posts the refresh grant and preserves rotated credentials', async () => {
    const tokens = await refreshCliOAuthTokens(
      { issuer, clientId },
      'REDACTED_INITIAL_REFRESH',
      undefined,
    )
    expect(tokens.refreshToken).toBe('REDACTED_ROTATED_REFRESH')
    expect(refreshRequests).toBe(1)
    expect(requests[0]?.get('grant_type')).toBe('refresh_token')
    expect(requests[0]?.get('client_id')).toBe(clientId)
    expect(requests[0]?.get('refresh_token')).toBe('REDACTED_INITIAL_REFRESH')
  })

  it.each([
    'drop',
    'revoked',
    'redirect',
    'invalid-json',
    'missing-rotation',
    'oversized',
  ])('does not replay a %s refresh', async failure => {
    mode = failure
    await expect(
      refreshCliOAuthTokens(
        { issuer, clientId },
        'REDACTED_INITIAL_REFRESH',
        undefined,
      ),
    ).rejects.toThrow()
    expect(refreshRequests).toBe(1)
    expect(apiRequests).toBe(0)
  })
})

describe.skipIf(!['darwin', 'linux'].includes(process.platform))(
  'OAuth session with an OS credential boundary double',
  () => {
    afterEach(async () => {
      await runSession('cleanup')
      const operations = await readFile(
        path.join(directory, 'keychain', 'operations'),
        'utf8',
      )
      expect(operations.split(/\r?\n/)).toEqual(
        expect.arrayContaining(['read', 'write', 'delete']),
      )
    })

    it('uses current bearer credentials for raw requests', async () => {
      await runSession('save-fresh')
      await runSession('raw')
      expect(apiRequests).toBe(2)
      expect(refreshRequests).toBe(0)
      await runSession('logout')
    })

    const sdkSupportsOAuth = supportsOAuthSdk('bearer')
    it(
      sdkSupportsOAuth
        ? 'uses current SDK bearer credentials and fences logout'
        : 'rejects an SDK without dynamic bearer support before requests',
      async () => {
        await runSession('save-fresh')
        await runSession(sdkSupportsOAuth ? 'sdk' : 'sdk-unsupported')
        expect(apiRequests).toBe(sdkSupportsOAuth ? 2 : 0)
        expect(refreshRequests).toBe(0)
      },
    )

    it('rotates once across processes and persists credentials', async () => {
      await runSession('save')
      const results = await Promise.allSettled([
        runSession('read'),
        runSession('read'),
      ])
      for (const result of results) {
        if (result.status === 'rejected') {
          throw result.reason
        }
      }
      expect(refreshRequests).toBe(1)
      await runSession('read')
      expect(refreshRequests).toBe(1)
      await runSession('logout')
      expect(apiRequests).toBe(0)
      expect(refreshRequests).toBe(1)
    })

    it.each(['drop', 'revoked'])(
      'removes %s credentials without replay',
      async failure => {
        await runSession('save')
        mode = failure
        await runSession('missing')
        await runSession('missing')
        expect(refreshRequests).toBe(1)
      },
    )

    it.skipIf(process.platform === 'win32')(
      'fails closed when the rotation marker cannot be read',
      async () => {
        await runSession('save')
        await runSession('blocked-marker')
        expect(refreshRequests).toBe(0)
      },
    )

    it('refuses interrupted rotation before sending the stale token', async () => {
      await runSession('save')
      await runSession('pending')
      await runSession('missing')
      expect(refreshRequests).toBe(0)
      await runSession('logout')
    })
  },
)
