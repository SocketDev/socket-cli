/**
 * Update checking utilities for Socket CLI.
 * Handles version comparison and registry lookups for available updates.
 *
 * Key Functions:
 * - checkForUpdates: Check registry for available updates
 * - isUpdateAvailable: Compare current vs latest versions
 * - fetchLatestVersion: Get latest version from npm registry
 *
 * Features:
 * - Robust version comparison using semver
 * - Network error handling and timeouts
 * - Registry authentication support
 * - Retry mechanism with exponential backoff
 *
 * Usage:
 * - CLI update checking
 * - Automated update notifications
 * - Version compatibility checks
 */

import semver from 'semver'

import { logger } from '@socketsecurity/registry/lib/logger'
import { onExit } from '@socketsecurity/registry/lib/signal-exit'
import { isNonEmptyString } from '@socketsecurity/registry/lib/strings'

import { NPM_REGISTRY_URL, UPDATE_NOTIFIER_TIMEOUT } from '../../constants.mts'

export interface AuthInfo {
  token: string
  type: string
}

// Type compatibility with registry-auth-token.
interface NpmCredentials {
  token: string
  type: string
}

export interface UpdateCheckOptions {
  authInfo?: AuthInfo | NpmCredentials | undefined
  name: string
  registryUrl?: string | undefined
  version: string
}

export interface UpdateCheckResult {
  current: string
  latest: string
  updateAvailable: boolean
}

interface FetchOptions {
  authInfo?: AuthInfo | NpmCredentials | undefined
}

interface GetLatestVersionOptions {
  authInfo?: AuthInfo | NpmCredentials | undefined
  registryUrl?: string | undefined
}

/**
 * Version comparison using semver library.
 */
function isUpdateAvailable(current: string, latest: string): boolean {
  try {
    // Use semver for robust version comparison.
    const currentClean = semver.clean(current)
    const latestClean = semver.clean(latest)

    if (!currentClean || !latestClean) {
      // Fallback to string comparison if semver parsing fails.
      return latest !== current
    }

    return semver.gt(latestClean, currentClean)
  } catch {
    // Fallback to string comparison on any error.
    return latest !== current
  }
}

/**
 * Network utilities with robust error handling and timeouts.
 */
const NetworkUtils = {
  /**
   * Fetch package information from npm registry.
   */
  async fetch(
    url: string,
    options: FetchOptions = {},
    timeoutMs = UPDATE_NOTIFIER_TIMEOUT,
  ): Promise<{ version?: string }> {
    if (!isNonEmptyString(url)) {
      throw new Error('Invalid URL provided to fetch')
    }

    const { authInfo } = { __proto__: null, ...options } as FetchOptions
    const headers = new Headers({
      Accept:
        'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*',
      'User-Agent': 'socket-cli-updater/1.0',
    })

    if (
      authInfo &&
      isNonEmptyString(authInfo.token) &&
      isNonEmptyString(authInfo.type)
    ) {
      headers.set('Authorization', `${authInfo.type} ${authInfo.token}`)
    }

    const aborter = new AbortController()
    const signal = aborter.signal

    // Set up timeout.
    const timeout = setTimeout(() => {
      aborter.abort()
    }, timeoutMs)

    // Also listen for process exit.
    const exitHandler = () => aborter.abort()
    onExit(exitHandler)

    try {
      const request = await fetch(url, {
        headers,
        signal,
        // Additional fetch options for reliability.
        redirect: 'follow',
        keepalive: false,
      })

      if (!request.ok) {
        throw new Error(`HTTP ${request.status}: ${request.statusText}`)
      }

      const contentType = request.headers.get('content-type')
      if (!contentType || !contentType.includes('application/json')) {
        logger.warn(`Unexpected content type: ${contentType}`)
      }

      const json = await request.json()

      if (!json || typeof json !== 'object') {
        throw new Error('Invalid JSON response from registry')
      }

      return json as { version?: string }
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new Error(`Request timed out after ${timeoutMs}ms`)
        }
        throw new Error(`Network request failed: ${error.message}`)
      }
      throw new Error(`Unknown network error: ${String(error)}`)
    } finally {
      clearTimeout(timeout)
    }
  },

  /**
   * Get the latest version of a package from npm registry.
   */
  async getLatestVersion(
    name: string,
    options: GetLatestVersionOptions = {},
  ): Promise<string | undefined> {
    if (!isNonEmptyString(name)) {
      throw new Error('Package name must be a non-empty string')
    }

    const { authInfo, registryUrl = NPM_REGISTRY_URL } = {
      __proto__: null,
      ...options,
    } as GetLatestVersionOptions

    if (!isNonEmptyString(registryUrl)) {
      throw new Error('Registry URL must be a non-empty string')
    }

    let normalizedRegistryUrl: string
    try {
      const url = new URL(registryUrl)
      normalizedRegistryUrl = url.toString()
    } catch {
      throw new Error(`Invalid registry URL: ${registryUrl}`)
    }

    const maybeSlash = normalizedRegistryUrl.endsWith('/') ? '' : '/'
    const latestUrl = `${normalizedRegistryUrl}${maybeSlash}${encodeURIComponent(name)}/latest`

    let attempts = 0
    const maxAttempts = 3
    const baseDelay = 1_000 // 1 second

    while (attempts < maxAttempts) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const json = await NetworkUtils.fetch(
          latestUrl,
          authInfo ? { authInfo } : {},
        )

        if (!json || !isNonEmptyString(json.version)) {
          throw new Error('Invalid version data in registry response')
        }

        return json.version
      } catch (error) {
        attempts++
        const isLastAttempt = attempts === maxAttempts

        if (isLastAttempt) {
          logger.warn(
            `Failed to fetch version after ${maxAttempts} attempts: ${error instanceof Error ? error.message : String(error)}`,
          )
          throw error
        }

        // Exponential backoff.
        const delay = baseDelay * Math.pow(2, attempts - 1)
        logger.log(
          `Attempt ${attempts} failed, retrying in ${delay}ms: ${error instanceof Error ? error.message : String(error)}`,
        )

        // eslint-disable-next-line no-await-in-loop
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }

    return undefined
  },
}

/**
 * Check for available updates for a package.
 * Fetches latest version from registry and compares with current.
 */
async function checkForUpdates(
  options: UpdateCheckOptions,
): Promise<UpdateCheckResult> {
  const { authInfo, name, registryUrl, version } = {
    __proto__: null,
    ...options,
  } as UpdateCheckOptions

  if (!isNonEmptyString(name)) {
    throw new Error('Package name must be a non-empty string')
  }

  if (!isNonEmptyString(version)) {
    throw new Error('Current version must be a non-empty string')
  }

  try {
    const latest = await NetworkUtils.getLatestVersion(name, {
      ...(authInfo ? { authInfo } : {}),
      ...(registryUrl ? { registryUrl } : {}),
    })

    if (!isNonEmptyString(latest)) {
      throw new Error('No version information available from registry')
    }

    const updateAvailable = isUpdateAvailable(version, latest)

    return {
      current: version,
      latest,
      updateAvailable,
    }
  } catch (error) {
    logger.log(
      `Failed to check for updates: ${error instanceof Error ? error.message : String(error)}`,
    )
    throw error
  }
}

export { checkForUpdates, isUpdateAvailable, NetworkUtils }
