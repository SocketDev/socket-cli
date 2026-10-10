import crypto from 'node:crypto'
import { access, mkdir, open } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { getSocketCliApiProxy } from '@socketsecurity/lib-stable/env/socket-cli'
import { refreshCliOAuthTokens } from './oauth-refresh.mts'
import { processLock } from '@socketsecurity/lib-stable/process/lock-instance'
import {
  deleteSocketOAuthCredential,
  normalizeSocketOAuthOptions,
  readSocketOAuthCredential,
  socketOAuthAccount,
  storeSocketOAuthTokens,
} from '@socketsecurity/lib-stable/secrets/socket-oauth'

import { API_V0_URL } from '../../constants/socket.mts'
import {
  getConfigDirectory,
  getConfigValueOrUndef,
  isConfigFromFlag,
  updateConfigValue,
} from '../config.mts'
import { assertSafeEndpointUrl } from '../url/safe-endpoint.mts'

import type {
  SocketAuthCredential,
  SocketOAuthCredentialOptions,
  SocketOAuthTokenSet,
} from '@socketsecurity/lib-stable/secrets/socket-oauth'
import { strictDelete } from '@socketsecurity/lib-stable/fs/strict'

export function assertOAuthApiOrigin(issuer: string, apiBaseUrl: string): void {
  if (new URL(issuer).origin !== new URL(apiBaseUrl).origin) {
    throw new Error(
      'Socket OAuth issuer and API endpoint must have the same origin.',
    )
  }
}

export async function clearOAuthSession(): Promise<void> {
  if (isConfigFromFlag()) {
    updateConfigValue('oauthSession', undefined)
    return
  }
  if (!getConfigValueOrUndef('oauthSession')) {
    return
  }
  await withOAuthSessionLock(async () => {
    const config = parseOAuthSessionOptions(
      getConfigValueOrUndef('oauthSession'),
    )
    if (config) {
      await deleteSocketOAuthCredential(config)
      await strictDelete(oauthRefreshMarker(config))
    }
    updateConfigValue('oauthSession', undefined)
    await new Promise<void>(resolve => process.nextTick(resolve))
  })
}

export function oauthRefreshMarker(
  config: SocketOAuthCredentialOptions,
): string {
  const directory = getConfigDirectory()
  if (!directory) {
    throw new Error('Socket settings directory is unavailable.')
  }
  return path.join(
    directory,
    `oauth-refresh-${socketOAuthAccount(config)}.pending`,
  )
}

export function parseOAuthSessionOptions(
  value: unknown,
): SocketOAuthCredentialOptions | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  if (
    typeof value !== 'object' ||
    !('issuer' in value) ||
    typeof value.issuer !== 'string' ||
    !('clientId' in value) ||
    typeof value.clientId !== 'string'
  ) {
    throw new Error('Invalid OAuth session configuration. Run socket login.')
  }
  const config = normalizeSocketOAuthOptions({
    clientId: value.clientId,
    issuer: value.issuer,
  })
  assertSafeEndpointUrl(config.issuer, { label: 'Socket OAuth issuer' })
  return config
}

export async function readOAuthSession(
  apiBaseUrl = API_V0_URL,
  expectedSessionId?: string | undefined,
): Promise<SocketAuthCredential | undefined> {
  if (isConfigFromFlag() || !getConfigValueOrUndef('oauthSession')) {
    return undefined
  }
  return await withOAuthSessionLock(async () => {
    const selection = getConfigValueOrUndef('oauthSession')
    if (expectedSessionId && selection?.sessionId !== expectedSessionId) {
      throw new Error(
        'Socket login changed during this command. Start the command again.',
      )
    }
    const config = parseOAuthSessionOptions(selection)
    if (!config) {
      return undefined
    }
    assertOAuthApiOrigin(config.issuer, apiBaseUrl)
    const proxy =
      getSocketCliApiProxy() || getConfigValueOrUndef('apiProxy') || undefined
    const marker = oauthRefreshMarker(config)
    const pending = await access(marker).then(
      () => true,
      () => false,
    )
    if (pending) {
      await deleteSocketOAuthCredential(config)
      await strictDelete(marker)
      throw new Error(
        'Socket token rotation was interrupted. Run socket login.',
      )
    }
    let credential: SocketAuthCredential | undefined
    try {
      credential = await readSocketOAuthCredential(
        config,
        async refreshToken => {
          const file = await open(marker, 'wx', 0o600)
          try {
            await file.sync()
          } finally {
            await file.close()
          }
          return await refreshCliOAuthTokens(config, refreshToken, proxy)
        },
      )
      await strictDelete(marker)
    } catch {
      await deleteSocketOAuthCredential(config)
      await strictDelete(marker)
      throw new Error(
        'Socket session could not be refreshed. Check your connection and credential store, then run socket login.',
      )
    }
    if (!credential) {
      throw new Error(
        'Socket login has expired or was removed. Run socket login.',
      )
    }
    return credential
  })
}

export async function saveOAuthSession(
  config: SocketOAuthCredentialOptions,
  tokens: SocketOAuthTokenSet,
): Promise<void> {
  if (isConfigFromFlag()) {
    throw new Error('Remove the config override before saving device login.')
  }
  await withOAuthSessionLock(async () => {
    const marker = oauthRefreshMarker(config)
    const pending = await open(marker, 'w', 0o600)
    try {
      await pending.sync()
    } finally {
      await pending.close()
    }
    await storeSocketOAuthTokens(config, tokens)
    updateConfigValue('oauthSession', {
      ...config,
      sessionId: crypto.randomUUID(),
    })
    updateConfigValue('apiToken', undefined)
    await new Promise<void>(resolve => process.nextTick(resolve))
    await strictDelete(marker)
  })
}

export async function withOAuthSessionLock<T>(
  action: () => Promise<T>,
): Promise<T> {
  const directory = getConfigDirectory()
  if (!directory) {
    throw new Error('Socket settings directory is unavailable.')
  }
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const account = crypto
    .createHash('sha256')
    .update(os.userInfo().username)
    .digest('hex')
  return await processLock.withLock(
    path.join(os.tmpdir(), `socket-cli-oauth-session-${account}`),
    action,
    { retries: 120, maxDelayMs: 500, staleMs: 120_000 },
  )
}
