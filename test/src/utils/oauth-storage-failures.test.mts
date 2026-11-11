import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import nock from 'nock'
import { afterEach, describe, expect, it, vi } from 'vitest'

const fsFault = vi.hoisted(() => ({
  failRenameAt: 0,
  renameCalls: 0,
}))
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    promises: {
      ...actual.promises,
      rename: async (...args: Parameters<typeof actual.promises.rename>) => {
        fsFault.renameCalls += 1
        if (fsFault.failRenameAt === fsFault.renameCalls) {
          throw new Error('injected rename failure')
        }
        return await actual.promises.rename(...args)
      },
    },
  }
})

import {
  OAUTH_ISSUER,
  OAUTH_RESOURCE,
  readOAuthCredentials,
  resolveOAuthAccessToken,
  saveOAuthCredentials,
} from '../../../src/utils/oauth.mts'

import type { OAuthCredentials } from '../../../src/utils/oauth.mts'

const requiredScopes = ['packages:list', 'alerts:list', 'threat-feed:list']
const credentials = (expiresAt = Date.now() + 60_000): OAuthCredentials => ({
  version: 1,
  issuer: OAUTH_ISSUER,
  resource: OAUTH_RESOURCE,
  apiOrigin: OAUTH_ISSUER,
  clientId: 'public-client',
  accessToken: 'access-one',
  refreshToken: 'refresh-one',
  expiresAt,
  scopes: requiredScopes,
  tokenEndpoint: `${OAUTH_ISSUER}/v1/oauth2/token`,
  revocationEndpoint: `${OAUTH_ISSUER}/v1/oauth2/revoke`,
})

let dir: string
afterEach(async () => {
  nock.cleanAll()
  fsFault.failRenameAt = 0
  fsFault.renameCalls = 0
  if (dir) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe('OAuth credential failure safety', () => {
  it('does not restore a consumed refresh token after a request timeout', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'socket-oauth-'))
    await saveOAuthCredentials(dir, credentials(Date.now() - 1))
    const refresh = nock(OAUTH_ISSUER)
      .post('/v1/oauth2/token')
      .delay(500)
      .reply(200, {
        access_token: 'access-two',
        token_type: 'Bearer',
        expires_in: 900,
        refresh_token: 'refresh-two',
        scope: requiredScopes.join(' '),
      })
    await expect(
      resolveOAuthAccessToken(dir, { requestTimeoutMs: 100 }),
    ).rejects.toThrow('timed out')
    expect(readOAuthCredentials(dir)?.refreshToken).toBeUndefined()
    expect(refresh.isDone()).toBe(true)
    await expect(resolveOAuthAccessToken(dir)).rejects.toThrow(
      'session expired',
    )
  })

  it('does not replay a rotating refresh token after invalid_grant', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'socket-oauth-'))
    await saveOAuthCredentials(dir, credentials(Date.now() - 1))
    const refresh = nock(OAUTH_ISSUER)
      .post('/v1/oauth2/token')
      .reply(400, { error: 'invalid_grant' })

    await expect(resolveOAuthAccessToken(dir)).rejects.toThrow(
      'expired or was revoked',
    )
    expect(readOAuthCredentials(dir)?.refreshToken).toBeUndefined()
    expect(refresh.isDone()).toBe(true)
    await expect(resolveOAuthAccessToken(dir)).rejects.toThrow(
      'session expired',
    )
  })

  it('preserves credentials and releases the lock when discarding the token fails', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'socket-oauth-'))
    await saveOAuthCredentials(dir, credentials(Date.now() - 1))
    const file = path.join(dir, 'oauth.json')
    const original = await readFile(file, 'utf8')
    const unusedRefresh = nock(OAUTH_ISSUER)
      .post('/v1/oauth2/token')
      .reply(200, {})
    fsFault.renameCalls = 0
    fsFault.failRenameAt = 1

    await expect(resolveOAuthAccessToken(dir)).rejects.toThrow(
      'injected rename failure',
    )
    expect(await readFile(file, 'utf8')).toBe(original)
    await expect(stat(`${file}.lock`)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(unusedRefresh.isDone()).toBe(false)
  })

  it('does not restore a consumed token when saving the refresh response fails', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'socket-oauth-'))
    await saveOAuthCredentials(dir, credentials(Date.now() - 1))
    const refresh = nock(OAUTH_ISSUER)
      .post('/v1/oauth2/token')
      .reply(200, {
        access_token: 'access-two',
        token_type: 'Bearer',
        expires_in: 900,
        refresh_token: 'refresh-two',
        scope: requiredScopes.join(' '),
      })
    fsFault.renameCalls = 0
    fsFault.failRenameAt = 2

    await expect(resolveOAuthAccessToken(dir)).rejects.toThrow(
      'injected rename failure',
    )
    expect(readOAuthCredentials(dir)?.refreshToken).toBeUndefined()
    await expect(stat(path.join(dir, 'oauth.json.lock'))).rejects.toMatchObject(
      { code: 'ENOENT' },
    )
    expect(refresh.isDone()).toBe(true)
    fsFault.failRenameAt = 0
    await expect(resolveOAuthAccessToken(dir)).rejects.toThrow(
      'session expired',
    )
  })

  it.each([
    `${OAUTH_ISSUER}.evil.example/v1/oauth2/token`,
    'https://api.socket.dev:444/v1/oauth2/token',
    'https://user:pass@api.socket.dev/v1/oauth2/token',
    'http://api.socket.dev/v1/oauth2/token',
  ])('rejects an untrusted credential endpoint: %s', async tokenEndpoint => {
    dir = await mkdtemp(path.join(tmpdir(), 'socket-oauth-'))
    await expect(
      saveOAuthCredentials(dir, { ...credentials(), tokenEndpoint }),
    ).rejects.toThrow('Refusing to save invalid OAuth credentials')
    expect(readOAuthCredentials(dir)).toBeUndefined()
  })
})
