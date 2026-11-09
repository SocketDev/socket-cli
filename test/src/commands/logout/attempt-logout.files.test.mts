import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import nock from 'nock'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mockAppDataPath = vi.hoisted(() => ({ value: '' }))
const mockLogger = vi.hoisted(() => ({
  fail: vi.fn(),
  log: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
}))
const mockProxyUrl = vi.hoisted(() => vi.fn(() => undefined))

vi.mock('../../../../src/constants.mts', async importOriginal => {
  const original =
    await importOriginal<typeof import('../../../../src/constants.mts')>()
  return {
    ...original,
    default: new Proxy(original.default, {
      get(target, key, receiver) {
        if (key === 'socketAppDataPath') {
          return mockAppDataPath.value
        }
        if (key === 'ENV') {
          return {
            ...Reflect.get(target, key, receiver),
            SOCKET_CLI_API_TOKEN: '',
          }
        }
        return Reflect.get(target, key, receiver)
      },
    }),
  }
})
vi.mock('@socketsecurity/registry/lib/logger', () => ({ logger: mockLogger }))
vi.mock('../../../../src/utils/sdk.mts', () => ({
  getDefaultProxyUrl: mockProxyUrl,
}))

import { attemptLogout } from '../../../../src/commands/logout/attempt-logout.mts'
import { resetConfigForTesting } from '../../../../src/utils/config.mts'

let appDataPath: string | undefined

afterEach(() => {
  resetConfigForTesting()
  if (appDataPath) {
    rmSync(appDataPath, { recursive: true, force: true })
    appDataPath = undefined
  }
  mockAppDataPath.value = ''
  vi.clearAllMocks()
  nock.cleanAll()
})

describe('attemptLogout filesystem integration', () => {
  it.each([
    { status: 200, warning: undefined },
    {
      status: 503,
      warning:
        'Local sign-out completed. Remote session revocation was not confirmed.',
    },
  ])(
    'clears local credentials after remote revocation returns $status',
    async ({ status, warning }) => {
      appDataPath = mkdtempSync(path.join(os.tmpdir(), 'socket-cli-logout-'))
      mockAppDataPath.value = appDataPath

      const configPath = path.join(appDataPath, 'config.json')
      const oauthPath = path.join(appDataPath, 'oauth.json')
      const config = {
        apiToken: 'local-test-token',
        authType: 'oauth',
        apiBaseUrl: 'https://api.socket.dev',
        apiProxy: 'http://127.0.0.1:1',
        enforcedOrgs: ['local-test-org'],
        defaultOrg: 'keep-this-unrelated-setting',
      }
      writeFileSync(
        configPath,
        Buffer.from(JSON.stringify(config)).toString('base64'),
      )
      writeFileSync(
        oauthPath,
        JSON.stringify({
          version: 1,
          issuer: 'https://api.socket.dev',
          resource: 'https://mcp.socket.dev/',
          apiOrigin: 'https://api.socket.dev',
          clientId: 'local-test-client',
          accessToken: 'local-test-access-token',
          refreshToken: 'local-test-refresh-token',
          expiresAt: Date.now() + 60_000,
          scopes: ['packages:list', 'alerts:list', 'threat-feed:list'],
          tokenEndpoint: 'https://api.socket.dev/oauth/token',
          revocationEndpoint: 'https://api.socket.dev/oauth/revoke',
        }),
      )

      const revocation = nock('https://api.socket.dev')
        .post('/oauth/revoke')
        .reply(status)

      await attemptLogout()
      await new Promise(resolve => setImmediate(resolve))

      const persistedConfig = JSON.parse(
        Buffer.from(readFileSync(configPath, 'utf8'), 'base64').toString(),
      ) as Record<string, unknown>
      expect(persistedConfig).toEqual({
        apiToken: null,
        authType: null,
        apiBaseUrl: null,
        apiProxy: null,
        enforcedOrgs: null,
        defaultOrg: 'keep-this-unrelated-setting',
      })
      expect(() => readFileSync(oauthPath)).toThrow(
        expect.objectContaining({ code: 'ENOENT' }),
      )
      expect(() => readFileSync(`${oauthPath}.lock`)).toThrow(
        expect.objectContaining({ code: 'ENOENT' }),
      )
      expect(revocation.isDone()).toBe(true)
      expect(mockLogger.success).toHaveBeenCalledWith('Successfully logged out')
      if (warning) {
        expect(mockLogger.warn).toHaveBeenCalledWith(warning)
      } else {
        expect(mockLogger.warn).not.toHaveBeenCalled()
      }
      expect(mockLogger.fail).not.toHaveBeenCalled()
    },
  )
})
