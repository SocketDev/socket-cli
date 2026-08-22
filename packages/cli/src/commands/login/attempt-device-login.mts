import { request as nodeHttpRequest } from 'node:http'
import { request as nodeHttpsRequest } from 'node:https'
import { setTimeout as sleep } from 'node:timers/promises'

import { HttpProxyAgent, HttpsProxyAgent } from 'hpagent'
import open from 'open'

import { joinAnd } from '@socketsecurity/lib-stable/arrays/join'
import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { httpRequest } from '@socketsecurity/lib-stable/http-request/request'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { getDefaultSpinner } from '@socketsecurity/lib-stable/spinner/default'
import { isUrl } from '@socketsecurity/lib-stable/url/predicates'

import { applyLogin } from './apply-login.mts'
import {
  API_V1_OAUTH_URL,
  SOCKET_CLI_OAUTH_CLIENT_ID,
} from '../../constants/socket.mts'
import { CONFIG_KEY_DEFAULT_ORG } from '../../constants/config.mts'
import { isConfigFromFlag, updateConfigValue } from '../../util/config.mts'
import { getSocketCliOauthBaseUrl } from '../../env/socket-cli-oauth-base-url.mts'
import { getSocketCliOauthClientIdOverride } from '../../env/socket-cli-oauth-client-id.mts'
import { getEnterpriseOrgs, getOrgSlugs } from '../../util/organization.mts'
import { getDefaultProxyUrl, setupSdk } from '../../util/socket/sdk.mts'
import { assertSafeEndpointUrl } from '../../util/url/safe-endpoint.mts'
import { fetchOrganization } from '../organization/fetch-organization-list.mts'

import type { CResult } from '../../types.mts'
import type { HttpResponse } from '@socketsecurity/lib-stable/http-request/response-types'

const logger = getDefaultLogger()

// RFC 8628 3.2: the server SHOULD return interval; when it omits one, the
// client MUST default to 5 seconds.
const DEFAULT_POLL_INTERVAL_SECONDS = 5

// Reasonable default read scopes for a first-party CLI session. The exact
// set should be confirmed against depscan's scope catalog by whoever
// registers the `socket-cli` OAuth client.
const DEFAULT_DEVICE_LOGIN_SCOPES = [
  'alerts:list',
  'dependencies:list',
  'full-scans:list',
  'diff-scans:list',
  'packages:list',
  'repo:list',
].join(' ')

export interface DeviceAuthorizationResponse {
  device_code: string
  user_code: string
  verification_uri: string
  verification_uri_complete: string
  expires_in: number
  interval?: number | undefined
}

export interface DeviceTokenSuccessResponse {
  access_token: string
  token_type: string
  expires_in: number
  refresh_token?: string | undefined
  scope?: string | undefined
}

export interface OAuthErrorResponse {
  error: string
  error_description?: string | undefined
}

export class DeviceLoginError extends Error {
  oauthError: string

  constructor(oauthError: string, description?: string | undefined) {
    super(description ?? oauthError)
    this.oauthError = oauthError
  }
}

export async function attemptDeviceLogin(
  apiBaseUrl: string | undefined,
  apiProxy: string | undefined,
): Promise<CResult<void>> {
  const effectiveApiProxy = isUrl(apiProxy) ? apiProxy : getDefaultProxyUrl()
  const oauthBaseUrl = resolveOauthBaseUrl()
  const clientId = resolveOauthClientId()

  let deviceAuthorizationUrl: URL
  let tokenUrl: URL
  try {
    const base = assertSafeEndpointUrl(oauthBaseUrl, {
      label: 'Socket OAuth base URL',
      source: 'SOCKET_CLI_OAUTH_BASE_URL or the built-in default',
    })
    deviceAuthorizationUrl = new URL('device-authorization', base)
    tokenUrl = new URL('token', base)
  } catch (e) {
    const result: CResult<void> = {
      ok: false,
      message: 'Invalid OAuth base URL',
      cause: errorMessage(e),
    }
    logger.fail(result.message)
    process.exitCode = 1
    return result
  }

  const spinner = getDefaultSpinner()

  let deviceAuth: DeviceAuthorizationResponse
  try {
    spinner?.start('Requesting a device code from Socket…')
    deviceAuth = await postForm<DeviceAuthorizationResponse>(
      deviceAuthorizationUrl,
      new URLSearchParams({
        client_id: clientId,
        scope: DEFAULT_DEVICE_LOGIN_SCOPES,
      }),
      effectiveApiProxy,
    )
    spinner?.successAndStop('Requested a device code from Socket')
  } catch (e) {
    spinner?.failAndStop('Failed to request a device code from Socket')
    const result: CResult<void> = {
      ok: false,
      message: 'Device authorization request failed',
      cause: errorMessage(e),
    }
    logger.fail(result.message)
    process.exitCode = 1
    return result
  }

  logger.log('')
  logger.log(`First, enter this code: ${deviceAuth.user_code}`)
  logger.log(`Then approve it at: ${deviceAuth.verification_uri}`)
  logger.log('')

  try {
    await open(deviceAuth.verification_uri_complete)
  } catch {
    // Best-effort; the printed URL above is the fallback.
  }

  let tokenResponse: DeviceTokenSuccessResponse
  try {
    spinner?.start('Waiting for approval in your browser…')
    tokenResponse = await pollForDeviceToken(
      tokenUrl,
      clientId,
      deviceAuth.device_code,
      deviceAuth.interval || DEFAULT_POLL_INTERVAL_SECONDS,
      deviceAuth.expires_in,
      effectiveApiProxy,
    )
    spinner?.successAndStop('Approved')
  } catch (e) {
    spinner?.failAndStop('Device login was not approved')
    const result: CResult<void> = {
      ok: false,
      message: 'Device login failed',
      cause: errorMessage(e),
    }
    logger.fail(result.message)
    process.exitCode = 1
    return result
  }

  const apiToken = tokenResponse.access_token

  const sockSdkCResult = await setupSdk({
    apiBaseUrl,
    apiProxy: effectiveApiProxy,
    apiToken,
  })
  if (!sockSdkCResult.ok) {
    logger.fail(sockSdkCResult.message)
    process.exitCode = 1
    return sockSdkCResult
  }

  const orgsCResult = await fetchOrganization({
    description: 'token verification',
    sdk: sockSdkCResult.data,
  })
  if (!orgsCResult.ok) {
    logger.fail(orgsCResult.message)
    process.exitCode = 1
    return orgsCResult
  }

  const { organizations } = orgsCResult.data
  const orgSlugs = getOrgSlugs(organizations)

  if (!orgSlugs.length) {
    const result: CResult<void> = {
      ok: false,
      message:
        'No organizations found. Please contact Socket support to set up your account.',
    }
    logger.fail(result.message)
    process.exitCode = 1
    return result
  }

  logger.success(`API token verified: ${joinAnd(orgSlugs)}`)

  const enterpriseOrgs = getEnterpriseOrgs(organizations)
  const enforcedOrgs =
    enterpriseOrgs.length === 1 ? [enterpriseOrgs[0]!['id']] : []

  const defaultOrg = orgSlugs[0]?.trim()
  if (defaultOrg) {
    updateConfigValue(CONFIG_KEY_DEFAULT_ORG, defaultOrg)
  }

  applyLogin(apiToken, enforcedOrgs, apiBaseUrl, effectiveApiProxy)
  logger.success('API credentials set')
  if (isConfigFromFlag()) {
    logger.log('')
    logger.warn(
      'Note: config is in read-only mode, at least one key was overridden through flag/env, so the login was not persisted!',
    )
  }

  return { ok: true, data: undefined }
}

export async function pollForDeviceToken(
  tokenUrl: URL,
  clientId: string,
  deviceCode: string,
  intervalSeconds: number,
  expiresInSeconds: number,
  apiProxy?: string | undefined,
): Promise<DeviceTokenSuccessResponse> {
  const deadline = Date.now() + expiresInSeconds * 1000
  let currentInterval = intervalSeconds

  for (;;) {
    if (Date.now() >= deadline) {
      throw new DeviceLoginError(
        'expired_token',
        'The device code expired before it was approved',
      )
    }

    await sleep(currentInterval * 1000)

    try {
      return await postForm<DeviceTokenSuccessResponse>(
        tokenUrl,
        new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          client_id: clientId,
          device_code: deviceCode,
        }),
        apiProxy,
      )
    } catch (e) {
      if (!(e instanceof DeviceLoginError)) {
        throw e
      }
      if (e.oauthError === 'authorization_pending') {
        continue
      }
      if (e.oauthError === 'slow_down') {
        // RFC 8628 3.5: increase the polling interval by 5 seconds.
        currentInterval += 5
        continue
      }
      throw e
    }
  }
}

export async function postForm<T>(
  url: URL,
  body: URLSearchParams,
  apiProxy?: string | undefined,
): Promise<T> {
  const response: HttpResponse | { status: number; text: () => string } =
    apiProxy
      ? await postFormViaProxy(url, body, apiProxy)
      : await httpRequest(url.toString(), {
          body: body.toString(),
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          method: 'POST',
        })
  const json = JSON.parse(response.text()) as T | OAuthErrorResponse
  if (response.status < 200 || response.status >= 300) {
    const oauthError = json as OAuthErrorResponse
    throw new DeviceLoginError(oauthError.error, oauthError.error_description)
  }
  return json as T
}

/**
 * `httpRequest` has no proxy/agent option (it uses node:http/node:https
 * directly with no hook for one), so a configured proxy needs a raw request
 * built with the same hpagent agents sdk.mts uses for the SDK's own client.
 */
export function postFormViaProxy(
  url: URL,
  body: URLSearchParams,
  apiProxy: string,
): Promise<{ status: number; text: () => string }> {
  return new Promise((resolve, reject) => {
    const isHttp = url.protocol === 'http:'
    const AgentCtor = isHttp ? HttpProxyAgent : HttpsProxyAgent
    const agent = new AgentCtor({ proxy: apiProxy })
    const requestFn = isHttp ? nodeHttpRequest : nodeHttpsRequest
    const bodyString = body.toString()
    const req = requestFn(
      url,
      {
        method: 'POST',
        agent,
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'content-length': Buffer.byteLength(bodyString),
        },
      },
      res => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            text: () => Buffer.concat(chunks).toString('utf8'),
          })
        })
      },
    )
    req.on('error', reject)
    req.write(bodyString)
    req.end()
  })
}

export function resolveOauthBaseUrl(): string {
  return getSocketCliOauthBaseUrl() || API_V1_OAUTH_URL
}

export function resolveOauthClientId(): string {
  return getSocketCliOauthClientIdOverride() || SOCKET_CLI_OAUTH_CLIENT_ID
}
