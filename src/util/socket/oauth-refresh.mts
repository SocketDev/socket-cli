import { request } from 'node:https'

import { HttpsProxyAgent } from 'hpagent'

import {
  refreshSocketOAuthTokens,
  SocketOAuthError,
  validateSocketOAuthTokens,
} from '@socketsecurity/lib-stable/secrets/socket-oauth'

import type {
  SocketOAuthCredentialOptions,
  SocketOAuthTokenSet,
} from '@socketsecurity/lib-stable/secrets/socket-oauth'

export function parseOAuthRefreshResponse(
  status: number,
  body: string,
): SocketOAuthTokenSet {
  const payload: unknown = JSON.parse(body)
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('Invalid Socket OAuth refresh response')
  }
  if (status < 200 || status >= 300) {
    const code =
      'error' in payload && typeof payload.error === 'string'
        ? payload.error
        : 'oauth_error'
    throw new SocketOAuthError(
      code,
      'Socket OAuth refresh failed. Run socket login if the session has expired.',
    )
  }
  if (
    !('access_token' in payload) ||
    typeof payload.access_token !== 'string' ||
    !('token_type' in payload) ||
    typeof payload.token_type !== 'string' ||
    !('expires_in' in payload) ||
    typeof payload.expires_in !== 'number' ||
    !('refresh_token' in payload) ||
    typeof payload.refresh_token !== 'string'
  ) {
    throw new Error('Invalid Socket OAuth refresh response')
  }
  const tokens = {
    accessToken: payload.access_token,
    tokenType: payload.token_type,
    expiresIn: payload.expires_in,
    refreshToken: payload.refresh_token,
  }
  validateSocketOAuthTokens(tokens, { requireRefreshToken: true })
  return tokens
}

export async function refreshCliOAuthTokens(
  config: SocketOAuthCredentialOptions,
  refreshToken: string,
  apiProxy: string | undefined,
): Promise<SocketOAuthTokenSet> {
  if (!apiProxy) {
    const tokens = await refreshSocketOAuthTokens(config, refreshToken)
    validateSocketOAuthTokens(tokens, { requireRefreshToken: true })
    return tokens
  }
  const url = new URL('token', config.issuer)
  if (url.protocol !== 'https:') {
    throw new Error('Socket OAuth proxy refresh requires an HTTPS issuer.')
  }
  const body = new URLSearchParams({
    client_id: config.clientId,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  }).toString()
  return await new Promise((resolve, reject) => {
    const agent = new HttpsProxyAgent({ proxy: apiProxy })
    const req = request(
      url,
      {
        agent,
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'content-length': Buffer.byteLength(body),
        },
      },
      res => {
        const chunks: Buffer[] = []
        let size = 0
        res.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > 65_536) {
            req.destroy(
              new Error('Socket OAuth response exceeds the size limit.'),
            )
            return
          }
          chunks.push(chunk)
        })
        res.on('error', reject)
        res.on('end', () => {
          try {
            resolve(
              parseOAuthRefreshResponse(
                res.statusCode ?? 0,
                Buffer.concat(chunks).toString('utf8'),
              ),
            )
          } catch (error) {
            reject(error)
          }
        })
      },
    )
    const timer = setTimeout(
      () => req.destroy(new Error('Socket OAuth refresh timed out.')),
      30_000,
    )
    req.on('close', () => {
      clearTimeout(timer)
      agent.destroy()
    })
    req.on('error', reject)
    req.end(body)
  })
}
