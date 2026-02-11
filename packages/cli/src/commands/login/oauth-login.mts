import { createHash, randomBytes } from 'node:crypto'
import http from 'node:http'
import { setTimeout as wait } from 'node:timers/promises'

import open from 'open'

import {
  exchangeAuthorizationCodeForToken,
  fetchOAuthAuthorizationServerMetadata,
} from '../../utils/auth/oauth.mts'

import type { CResult } from '../../types.mts'

type OAuthLoginResult = {
  accessToken: string
  refreshToken: string
  expiresAt: number
  scope?: string | undefined
}

function randomBase64Url(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

function sha256Base64Url(value: string): string {
  return createHash('sha256').update(value).digest('base64url')
}

function buildAuthorizeUrl(params: {
  authorizationEndpoint: string
  clientId: string
  redirectUri: string
  scopes: string[]
  state: string
  codeChallenge: string
}): string {
  const url = new URL(params.authorizationEndpoint)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', params.clientId)
  url.searchParams.set('redirect_uri', params.redirectUri)
  if (params.scopes.length) {
    url.searchParams.set('scope', params.scopes.join(' '))
  }
  url.searchParams.set('state', params.state)
  url.searchParams.set('code_challenge', params.codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  return url.toString()
}

async function waitForCallback(params: {
  redirectUri: string
  expectedState: string
  timeoutMs: number
}): Promise<{
  ready: Promise<CResult<undefined>>
  result: Promise<CResult<{ code: string }>>
  close: () => void
}> {
  let redirect: URL
  try {
    redirect = new URL(params.redirectUri)
  } catch {
    return {
      ready: Promise.resolve({
        ok: false,
        message: 'Invalid OAuth redirect URI',
        cause: `Not a valid URL: ${params.redirectUri}`,
      }),
      result: Promise.resolve({
        ok: false,
        message: 'Invalid OAuth redirect URI',
        cause: `Not a valid URL: ${params.redirectUri}`,
      }),
      close: () => {},
    }
  }

  if (redirect.protocol !== 'http:') {
    const err: CResult<any> = {
      ok: false,
      message: 'Invalid OAuth redirect URI',
      cause: 'Redirect URI must use http:// for loopback redirect handling',
    }
    return {
      ready: Promise.resolve(err),
      result: Promise.resolve(err),
      close: () => {},
    }
  }

  const port = redirect.port ? Number(redirect.port) : 80
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    const err: CResult<any> = {
      ok: false,
      message: 'Invalid OAuth redirect URI',
      cause: `Invalid port in redirect URI: ${redirect.port || '(empty)'}`,
    }
    return {
      ready: Promise.resolve(err),
      result: Promise.resolve(err),
      close: () => {},
    }
  }

  const expectedPath = redirect.pathname || '/'
  const host = redirect.hostname || '127.0.0.1'
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    const err: CResult<any> = {
      ok: false,
      message: 'Invalid OAuth redirect URI',
      cause: `Redirect hostname must be a loopback address (got: ${host})`,
    }
    return {
      ready: Promise.resolve(err),
      result: Promise.resolve(err),
      close: () => {},
    }
  }

  let resolved = false

  let readyResolve: ((value: CResult<undefined>) => void) | undefined
  const ready = new Promise<CResult<undefined>>(resolve => {
    readyResolve = resolve
  })

  let resultResolve: ((value: CResult<{ code: string }>) => void) | undefined
  const result = new Promise<CResult<{ code: string }>>(resolve => {
    resultResolve = resolve
  })

  const server = http.createServer((req, res) => {
    if (resolved) {
      res.statusCode = 200
      res.end()
      return
    }

    if (!req.url) {
      res.statusCode = 400
      res.end()
      return
    }

    const reqUrl = new URL(req.url, `http://${host}:${port}`)
    if (req.method !== 'GET' || reqUrl.pathname !== expectedPath) {
      res.statusCode = 404
      res.end()
      return
    }

    const state = reqUrl.searchParams.get('state') || ''
    const code = reqUrl.searchParams.get('code') || ''
    if (!code) {
      res.statusCode = 400
      res.setHeader('content-type', 'text/plain; charset=utf-8')
      res.end('Missing OAuth code')
      return
    }
    if (state !== params.expectedState) {
      res.statusCode = 400
      res.setHeader('content-type', 'text/plain; charset=utf-8')
      res.end('Invalid OAuth state')
      return
    }

    resolved = true
    res.statusCode = 200
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end(
      '<!doctype html><meta charset="utf-8"><title>Socket CLI Login</title><h1>Login complete</h1><p>You can close this tab and return to the Socket CLI.</p>',
    )

    server.close(() => {
      resultResolve?.({ ok: true, data: { code } })
    })
  })

  server.on('error', err => {
    if (resolved) {
      return
    }
    resolved = true
    const failure: CResult<any> = {
      ok: false,
      message: 'Failed to start OAuth callback server',
      cause: err instanceof Error ? err.message : String(err),
    }
    readyResolve?.(failure)
    resultResolve?.(failure)
  })

  server.listen(port, host, () => {
    readyResolve?.({ ok: true, data: undefined })
    void wait(params.timeoutMs).then(() => {
      if (resolved) {
        return
      }
      resolved = true
      server.close(() => {
        resultResolve?.({
          ok: false,
          message: 'OAuth login timed out',
          cause: `No callback received within ${Math.round(params.timeoutMs / 1000)}s`,
        })
      })
    })
  })

  return {
    ready,
    result,
    close: () => {
      if (resolved) {
        return
      }
      resolved = true
      server.close(() => {
        resultResolve?.({
          ok: false,
          message: 'OAuth login canceled',
          cause: 'OAuth callback server was closed before receiving a code',
        })
      })
    },
  }
}

export async function oauthLogin(params: {
  authBaseUrl: string
  clientId: string
  redirectUri: string
  scopes: string[]
  apiProxy?: string | undefined
  timeoutMs?: number | undefined
}): Promise<CResult<OAuthLoginResult>> {
  const timeoutMs = params.timeoutMs ?? 5 * 60 * 1000
  const metaResult = await fetchOAuthAuthorizationServerMetadata({
    authBaseUrl: params.authBaseUrl,
    apiProxy: params.apiProxy,
  })
  if (!metaResult.ok) {
    return metaResult
  }

  const {
    authorization_endpoint: authorizationEndpoint,
    token_endpoint: tokenEndpoint,
  } = metaResult.data

  const codeVerifier = randomBase64Url(32)
  const codeChallenge = sha256Base64Url(codeVerifier)
  const state = randomBase64Url(16)

  const authorizeUrl = buildAuthorizeUrl({
    authorizationEndpoint,
    clientId: params.clientId,
    redirectUri: params.redirectUri,
    scopes: params.scopes,
    state,
    codeChallenge,
  })

  const callbackWaiter = await waitForCallback({
    redirectUri: params.redirectUri,
    expectedState: state,
    timeoutMs,
  })
  const readyResult = await callbackWaiter.ready
  if (!readyResult.ok) {
    return readyResult
  }

  try {
    await open(authorizeUrl, { wait: false })
  } catch (e) {
    callbackWaiter.close()
    return {
      ok: false,
      message: 'Failed to open browser for OAuth login',
      cause: e instanceof Error ? e.message : String(e),
    }
  }

  const callbackResult = await callbackWaiter.result
  if (!callbackResult.ok) {
    return callbackResult
  }
  const { code } = callbackResult.data

  const tokenResult = await exchangeAuthorizationCodeForToken({
    tokenEndpoint,
    clientId: params.clientId,
    code,
    redirectUri: params.redirectUri,
    codeVerifier,
    apiProxy: params.apiProxy,
  })
  if (!tokenResult.ok) {
    return tokenResult
  }

  const token = tokenResult.data
  if (!token.refresh_token) {
    return {
      ok: false,
      message: 'OAuth login failed',
      cause: 'Server did not return a refresh token',
    }
  }

  const expiresAt = Date.now() + Math.max(0, token.expires_in) * 1000
  return {
    ok: true,
    data: {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt,
      scope: token.scope,
    },
  }
}
