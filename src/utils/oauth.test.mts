import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'

import nock from 'nock'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('open', () => ({
  default: vi.fn().mockRejectedValue(new Error('browser unavailable')),
}))

import {
  OAUTH_ISSUER,
  OAUTH_RESOURCE,
  beginOAuthLogin,
  logoutOAuth,
  readOAuthCredentials,
  resolveOAuthAccessToken,
  saveOAuthCredentials,
} from './oauth.mts'

import type { OAuthCredentials } from './oauth.mts'

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
function mockDiscoveryAndRegistration() {
  nock('https://mcp.socket.dev')
    .get('/.well-known/oauth-protected-resource')
    .reply(200, {
      resource: OAUTH_RESOURCE,
      authorization_servers: [OAUTH_ISSUER],
      scopes_supported: requiredScopes,
    })
  nock(OAUTH_ISSUER)
    .get('/.well-known/oauth-authorization-server')
    .reply(200, {
      issuer: OAUTH_ISSUER,
      authorization_endpoint: `${OAUTH_ISSUER}/v1/oauth2/authorize`,
      token_endpoint: `${OAUTH_ISSUER}/v1/oauth2/token`,
      registration_endpoint: `${OAUTH_ISSUER}/v1/oauth2/register`,
      revocation_endpoint: `${OAUTH_ISSUER}/v1/oauth2/revoke`,
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
    })
  nock(OAUTH_ISSUER).post('/v1/oauth2/register').reply(201, {
    client_id: 'test-client',
    token_endpoint_auth_method: 'none',
  })
}
function sendMalformedCallback(redirectUri: string): Promise<number> {
  const redirect = new URL(redirectUri)
  return new Promise((resolve, reject) => {
    const socket = createConnection(Number(redirect.port), '127.0.0.1')
    let response = ''
    socket.on('connect', () => {
      socket.write(
        'GET http://[ HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n',
      )
    })
    socket.on('data', chunk => {
      response += chunk.toString('utf8')
    })
    socket.on('end', () =>
      resolve(Number(response.match(/^HTTP\/1\.1 (\d+)/)?.[1])),
    )
    socket.on('error', reject)
  })
}
let dir: string
afterEach(async () => {
  nock.cleanAll()
  if (dir) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe('OAuth credential storage and rotation', () => {
  it('registers a loopback redirect and exchanges an authorization code with PKCE', async () => {
    const resource = nock('https://mcp.socket.dev')
      .get('/.well-known/oauth-protected-resource')
      .reply(200, {
        resource: OAUTH_RESOURCE,
        authorization_servers: [OAUTH_ISSUER],
        scopes_supported: requiredScopes,
      })
    const issuer = nock(OAUTH_ISSUER)
      .get('/.well-known/oauth-authorization-server')
      .reply(200, {
        issuer: OAUTH_ISSUER,
        authorization_endpoint: `${OAUTH_ISSUER}/v1/oauth2/authorize`,
        token_endpoint: `${OAUTH_ISSUER}/v1/oauth2/token`,
        registration_endpoint: `${OAUTH_ISSUER}/v1/oauth2/register`,
        revocation_endpoint: `${OAUTH_ISSUER}/v1/oauth2/revoke`,
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
      })
    let redirect = ''
    let registrationBody = ''
    const registration = nock(OAUTH_ISSUER)
      .post('/v1/oauth2/register')
      .reply(201, (_uri, body) => {
        registrationBody = JSON.stringify(body)
        return { client_id: 'test-client' }
      })
    let tokenBody = ''
    const token = nock(OAUTH_ISSUER)
      .post('/v1/oauth2/token')
      .reply(200, (_uri, body) => {
        tokenBody = String(body)
        return {
          access_token: 'oauth-access',
          token_type: 'Bearer',
          expires_in: 900,
          refresh_token: 'oauth-refresh',
          scope: requiredScopes.join(' '),
        }
      })
    let callbackTask: Promise<void> | undefined
    let codeChallenge = ''
    const resultPromise = beginOAuthLogin({
      openBrowser: false,
      onAuthorizationUrl: url => {
        const auth = new URL(url)
        redirect = auth.searchParams.get('redirect_uri')!
        codeChallenge = auth.searchParams.get('code_challenge')!
        expect(auth.searchParams.get('resource')).toBe(OAUTH_RESOURCE)
        expect(auth.searchParams.get('scope')).toBe(requiredScopes.join(' '))
        expect(auth.searchParams.get('code_challenge_method')).toBe('S256')
        callbackTask = new Promise<void>((resolve, reject) =>
          setTimeout(() => {
            const callback = new URL(redirect)
            void (async () => {
              expect(await sendMalformedCallback(redirect)).toBe(400)
              callback.searchParams.set('state', 'wrong')
              callback.searchParams.set('code', 'ignored')
              expect((await fetch(callback)).status).toBe(400)
              callback.searchParams.set(
                'state',
                auth.searchParams.get('state')!,
              )
              expect((await fetch(callback)).status).toBe(200)
            })().then(resolve, reject)
          }, 0),
        )
      },
    })
    const result = await resultPromise
    await callbackTask
    expect(JSON.parse(registrationBody)).toEqual({
      client_name: 'Socket CLI',
      redirect_uris: [redirect],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    })
    const verifier = new URLSearchParams(tokenBody).get('code_verifier')!
    expect(new URLSearchParams(tokenBody).get('resource')).toBe(OAUTH_RESOURCE)
    expect(createHash('sha256').update(verifier).digest('base64url')).toBe(
      codeChallenge,
    )
    expect(result.accessToken).toBe('oauth-access')
    expect(
      resource.isDone() &&
        issuer.isDone() &&
        registration.isDone() &&
        token.isDone(),
    ).toBe(true)
  })

  it('stores credentials atomically with private permissions', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'socket-oauth-'))
    await saveOAuthCredentials(dir, credentials())
    expect(readOAuthCredentials(dir)?.accessToken).toBe('access-one')
    if (process.platform !== 'win32') {
      expect((await stat(path.join(dir, 'oauth.json'))).mode & 0o777).toBe(
        0o600,
      )
    }
  })

  it('rejects issuer strings that only contain the trusted issuer as a prefix', async () => {
    nock('https://mcp.socket.dev')
      .get('/.well-known/oauth-protected-resource')
      .reply(200, {
        resource: OAUTH_RESOURCE,
        authorization_servers: [`${OAUTH_ISSUER}.evil.example`],
        scopes_supported: requiredScopes,
      })
    await expect(
      beginOAuthLogin({ openBrowser: false, onAuthorizationUrl: () => {} }),
    ).rejects.toThrow('resource metadata could not be verified')
  })

  it('rejects authorization denial and closes the loopback listener', async () => {
    mockDiscoveryAndRegistration()
    let callbackUrl = ''
    let state = ''
    const flow = beginOAuthLogin({
      openBrowser: false,
      onAuthorizationUrl: url => {
        const authorization = new URL(url)
        state = authorization.searchParams.get('state')!
        callbackUrl = authorization.searchParams.get('redirect_uri')!
        setTimeout(() => {
          const callback = new URL(callbackUrl)
          callback.searchParams.set('state', state)
          callback.searchParams.set('error', 'access_denied')
          void fetch(callback)
        }, 0)
      },
    })
    await expect(flow).rejects.toThrow('Authorization was declined')
    const after = new URL(callbackUrl)
    after.searchParams.set('state', state)
    after.searchParams.set('code', 'late')
    await expect(fetch(after)).rejects.toThrow()
  })

  it('cancels after binding and closes the loopback listener', async () => {
    mockDiscoveryAndRegistration()
    const controller = new AbortController()
    let callbackUrl = ''
    const flow = beginOAuthLogin({
      signal: controller.signal,
      openBrowser: false,
      onAuthorizationUrl: url => {
        callbackUrl = new URL(url).searchParams.get('redirect_uri')!
        controller.abort(new Error('user cancelled'))
      },
    })
    await expect(flow).rejects.toThrow('user cancelled')
    const callback = new URL(callbackUrl)
    callback.searchParams.set('state', 'late')
    callback.searchParams.set('code', 'late')
    await expect(fetch(callback)).rejects.toThrow()
  })

  it('accepts manual completion after the browser opener fails', async () => {
    mockDiscoveryAndRegistration()
    nock(OAUTH_ISSUER)
      .post('/v1/oauth2/token')
      .reply(200, {
        access_token: 'oauth-access',
        token_type: 'Bearer',
        expires_in: 900,
        refresh_token: 'oauth-refresh',
        scope: requiredScopes.join(' '),
      })
    let callbackTask: Promise<Response> | undefined
    const result = await beginOAuthLogin({
      onAuthorizationUrl: url => {
        const authorization = new URL(url)
        const callback = new URL(
          authorization.searchParams.get('redirect_uri')!,
        )
        callback.searchParams.set(
          'state',
          authorization.searchParams.get('state')!,
        )
        callback.searchParams.set('code', 'manual-code')
        callbackTask = new Promise(resolve =>
          setTimeout(() => resolve(fetch(callback)), 0),
        )
      },
    })
    expect((await callbackTask)?.status).toBe(200)
    expect(result.accessToken).toBe('oauth-access')
  })

  it('times out a pending browser flow and closes the callback listener', async () => {
    mockDiscoveryAndRegistration()
    vi.useFakeTimers()
    try {
      let callbackUrl = ''
      let announce!: () => void
      const announced = new Promise<void>(resolve => {
        announce = resolve
      })
      const flow = beginOAuthLogin({
        openBrowser: false,
        onAuthorizationUrl: url => {
          callbackUrl = new URL(url).searchParams.get('redirect_uri')!
          announce()
        },
      })
      await announced
      const rejected = expect(flow).rejects.toThrow('Sign-in timed out')
      await vi.advanceTimersByTimeAsync(5 * 60_000)
      await rejected
      const callback = new URL(callbackUrl)
      callback.searchParams.set('state', 'late')
      callback.searchParams.set('code', 'late')
      await expect(fetch(callback)).rejects.toThrow()
    } finally {
      vi.useRealTimers()
    }
  })

  it('coordinates refresh and persists the rotated token before returning', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'socket-oauth-'))
    await saveOAuthCredentials(dir, credentials(Date.now() - 1))
    let refreshBody = ''
    const refresh = nock(OAUTH_ISSUER)
      .post('/v1/oauth2/token')
      .delay(40)
      .reply(200, (_uri, body) => {
        refreshBody = String(body)
        return {
          access_token: 'access-two',
          token_type: 'Bearer',
          expires_in: 900,
          refresh_token: 'refresh-two',
          scope: requiredScopes.join(' '),
        }
      })
    const tokens = await Promise.all([
      resolveOAuthAccessToken(dir),
      resolveOAuthAccessToken(dir),
    ])
    expect(tokens).toEqual(['access-two', 'access-two'])
    expect(new URLSearchParams(refreshBody).get('resource')).toBe(
      OAUTH_RESOURCE,
    )
    expect(readOAuthCredentials(dir)?.refreshToken).toBe('refresh-two')
    expect(refresh.isDone()).toBe(true)
  })

  it('does not replay a rotating refresh token after an ambiguous failure', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'socket-oauth-'))
    await saveOAuthCredentials(dir, credentials(Date.now() - 1))
    nock(OAUTH_ISSUER)
      .post('/v1/oauth2/token')
      .replyWithError('connection reset')
    await expect(resolveOAuthAccessToken(dir)).rejects.toThrow(
      'OAuth request failed',
    )
    expect(readOAuthCredentials(dir)?.refreshToken).toBeUndefined()
    await expect(resolveOAuthAccessToken(dir)).rejects.toThrow(
      'session expired',
    )
  })

  it('preserves the refresh token when resolution starts pre-aborted', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'socket-oauth-'))
    await saveOAuthCredentials(dir, credentials(Date.now() - 1))
    const before = await readFile(path.join(dir, 'oauth.json'), 'utf8')
    const controller = new AbortController()
    controller.abort(new Error('cancelled before start'))
    await expect(
      resolveOAuthAccessToken(dir, { signal: controller.signal }),
    ).rejects.toThrow('cancelled before start')
    expect(await readFile(path.join(dir, 'oauth.json'), 'utf8')).toBe(before)
  })

  it('cancels while waiting for the refresh lock without consuming the refresh token', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'socket-oauth-'))
    await saveOAuthCredentials(dir, credentials(Date.now() - 1))
    await import('node:fs/promises').then(({ mkdir }) =>
      mkdir(path.join(dir, 'oauth.json.lock')),
    )
    const controller = new AbortController()
    const pending = resolveOAuthAccessToken(dir, { signal: controller.signal })
    controller.abort(new Error('cancelled while waiting'))
    await expect(pending).rejects.toThrow('cancelled while waiting')
    expect(readOAuthCredentials(dir)?.refreshToken).toBe('refresh-one')
  })

  it('clears corrupt credentials during logout', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'socket-oauth-'))
    await writeFile(path.join(dir, 'oauth.json'), '{bad json')
    const result = await logoutOAuth(dir)
    expect(result.warning).toContain('invalid')
    await expect(readFile(path.join(dir, 'oauth.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('removes local credentials even when remote revocation fails', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'socket-oauth-'))
    await saveOAuthCredentials(dir, credentials())
    nock(OAUTH_ISSUER).post('/v1/oauth2/revoke').reply(503, '')
    const result = await logoutOAuth(dir)
    expect(result.revoked).toBe(false)
    expect(result.warning).toContain('not confirmed')
    expect(readOAuthCredentials(dir)).toBeUndefined()
  })
})
