import http from 'node:http'
import https from 'node:https'

import { HttpProxyAgent, HttpsProxyAgent } from 'hpagent'

import { isNonEmptyString } from '@socketsecurity/lib/strings'
import { isUrl } from '@socketsecurity/lib/url'

import type { CResult } from '../../types.mts'

export type OAuthAuthorizationServerMetadata = {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  introspection_endpoint?: string | undefined
  response_types_supported?: string[] | undefined
  grant_types_supported?: string[] | undefined
  code_challenge_methods_supported?: string[] | undefined
  token_endpoint_auth_methods_supported?: string[] | undefined
}

export type OAuthTokenResponse = {
  access_token: string
  token_type: 'Bearer'
  expires_in: number
  refresh_token?: string | undefined
  scope?: string | undefined
}

export function normalizeUrlBase(value: string): string {
  return value.replace(/\/+$/u, '')
}

export function joinUrl(base: string, path: string): string {
  const normalizedBase = normalizeUrlBase(base)
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${normalizedBase}${normalizedPath}`
}

export function deriveAuthBaseUrlFromApiBaseUrl(
  apiBaseUrl: string | undefined,
): string | undefined {
  if (!apiBaseUrl) {
    return undefined
  }
  if (!isUrl(apiBaseUrl)) {
    return undefined
  }
  const url = new URL(apiBaseUrl)

  const normalizedPath = url.pathname.replace(/\/+$/u, '')
  const strippedPath = normalizedPath.replace(/\/v0$/u, '')

  url.pathname = strippedPath || '/'
  url.search = ''
  url.hash = ''
  return normalizeUrlBase(url.toString())
}

function createProxyDispatcher(params: {
  url: string
  apiProxy: string | undefined
}): HttpProxyAgent | HttpsProxyAgent | undefined {
  const { apiProxy, url } = params
  if (!apiProxy || !isUrl(apiProxy)) {
    return undefined
  }
  const ProxyAgent = url.startsWith('http:') ? HttpProxyAgent : HttpsProxyAgent
  return new ProxyAgent({ proxy: apiProxy })
}

async function requestText(params: {
  url: string
  method: 'GET' | 'POST'
  apiProxy?: string | undefined
  headers?: Record<string, string> | undefined
  body?: string | undefined
}): Promise<CResult<{ status: number; statusText: string; text: string }>> {
  try {
    const agent = createProxyDispatcher({
      url: params.url,
      apiProxy: params.apiProxy,
    })
    const url = new URL(params.url)
    const transport = url.protocol === 'http:' ? http : https

    const body = params.body ?? ''
    const headers: Record<string, string> = {
      ...(params.headers ?? {}),
      ...(params.method === 'POST'
        ? { 'content-length': Buffer.byteLength(body).toString() }
        : {}),
    }

    return await new Promise(resolve => {
      const req = transport.request(
        url,
        {
          method: params.method,
          headers,
          ...(agent ? { agent } : {}),
        },
        res => {
          const chunks: Buffer[] = []
          res.on('data', chunk =>
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
          )
          res.on('end', () => {
            resolve({
              ok: true,
              data: {
                status: res.statusCode ?? 0,
                statusText: res.statusMessage ?? '',
                text: Buffer.concat(chunks).toString('utf8'),
              },
            })
          })
        },
      )

      req.on('error', e => {
        resolve({
          ok: false,
          message: 'OAuth request failed',
          cause: e instanceof Error ? e.message : String(e),
        })
      })

      if (params.method === 'POST') {
        req.write(body)
      }
      req.end()
    })
  } catch (e) {
    return {
      ok: false,
      message: 'OAuth request failed',
      cause: e instanceof Error ? e.message : String(e),
    }
  }
}

async function postFormJson<T>(params: {
  url: string
  apiProxy?: string | undefined
  body: URLSearchParams
}): Promise<CResult<T>> {
  const resResult = await requestText({
    url: params.url,
    method: 'POST',
    apiProxy: params.apiProxy,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: params.body.toString(),
  })
  if (!resResult.ok) {
    return resResult
  }

  const { status, statusText, text } = resResult.data
  if (status < 200 || status >= 300) {
    return {
      ok: false,
      message: `OAuth request failed (HTTP ${status})`,
      cause: isNonEmptyString(text) ? text : statusText,
    }
  }

  try {
    return { ok: true, data: JSON.parse(text) as T }
  } catch {
    return {
      ok: false,
      message: 'OAuth request failed',
      cause: 'Server returned invalid JSON',
    }
  }
}

export async function fetchOAuthAuthorizationServerMetadata(params: {
  authBaseUrl: string
  apiProxy?: string | undefined
}): Promise<CResult<OAuthAuthorizationServerMetadata>> {
  const url = joinUrl(
    params.authBaseUrl,
    '/.well-known/oauth-authorization-server',
  )
  const resResult = await requestText({
    url,
    method: 'GET',
    apiProxy: params.apiProxy,
  })
  if (!resResult.ok) {
    return {
      ok: false,
      message: 'OAuth metadata request failed',
      cause: resResult.cause,
    }
  }

  const { status, statusText, text } = resResult.data
  if (status < 200 || status >= 300) {
    return {
      ok: false,
      message: `OAuth metadata request failed (HTTP ${status})`,
      cause: isNonEmptyString(text) ? text : statusText,
    }
  }

  try {
    return {
      ok: true,
      data: JSON.parse(text) as OAuthAuthorizationServerMetadata,
    }
  } catch {
    return {
      ok: false,
      message: 'OAuth metadata request failed',
      cause: 'Server returned invalid JSON',
    }
  }
}

export async function exchangeAuthorizationCodeForToken(params: {
  tokenEndpoint: string
  clientId: string
  code: string
  redirectUri: string
  codeVerifier: string
  apiProxy?: string | undefined
}): Promise<CResult<OAuthTokenResponse>> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: params.clientId,
    code: params.code,
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
  })

  return await postFormJson<OAuthTokenResponse>({
    url: params.tokenEndpoint,
    apiProxy: params.apiProxy,
    body,
  })
}

export async function refreshOAuthAccessToken(params: {
  tokenEndpoint: string
  clientId: string
  refreshToken: string
  apiProxy?: string | undefined
}): Promise<CResult<OAuthTokenResponse>> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: params.clientId,
    refresh_token: params.refreshToken,
  })

  return await postFormJson<OAuthTokenResponse>({
    url: params.tokenEndpoint,
    apiProxy: params.apiProxy,
    body,
  })
}
