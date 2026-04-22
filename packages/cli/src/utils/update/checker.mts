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

import https from 'node:https'
import { URL } from 'node:url'

import semver from 'semver'

import { NPM_REGISTRY_URL } from '@socketsecurity/lib/constants/agents'
import { debug } from '@socketsecurity/lib/debug'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { onExit } from '@socketsecurity/lib/signal-exit'
import { isNonEmptyString } from '@socketsecurity/lib/strings'

import { UPDATE_NOTIFIER_TIMEOUT } from '../../constants/cache.mts'

const logger = getDefaultLogger()

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
   * Fetch package information from npm registry using https.request().
   * Uses Node.js built-in https module to avoid keep-alive connection pooling
   * that causes 30-second delays in process exit.
   */
  async fetch(
    url: string,
    options: FetchOptions = {},
    timeoutMs = UPDATE_NOTIFIER_TIMEOUT,
  ): Promise<{ version?: string }> {
    if (!isNonEmptyString(url)) {
      throw new Error(
        `UpdateChecker.fetch(url) requires a non-empty string (got: ${typeof url === 'string' ? '""' : typeof url}); pass a valid registry URL like https://registry.npmjs.org/<package>`,
      )
    }

    const { authInfo } = { __proto__: null, ...options } as FetchOptions

    const parsedUrl = new URL(url)
    const headers: Record<string, string> = {
      Accept:
        'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*',
      'User-Agent': 'socket-cli-updater/1.0',
    }

    if (
      authInfo &&
      isNonEmptyString(authInfo.token) &&
      isNonEmptyString(authInfo.type)
    ) {
      headers['Authorization'] = `${authInfo.type} ${authInfo.token}`
    }

    return new Promise((resolve, reject) => {
      // Cleanup function to remove exit handler and prevent memory leak.
      const exitHandler = () => req.destroy()
      const removeExitHandler = onExit(exitHandler)

      const cleanup = () => {
        removeExitHandler()
      }

      const req = https.request(
        {
          agent: false, // Disable connection pooling.
          headers,
          hostname: parsedUrl.hostname,
          method: 'GET',
          path: parsedUrl.pathname + parsedUrl.search,
          port: parsedUrl.port,
          timeout: timeoutMs,
        },
        res => {
          let data = ''

          res.on('data', chunk => {
            data += chunk
          })

          res.on('end', () => {
            cleanup()
            try {
              if (res.statusCode !== 200) {
                reject(
                  new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`),
                )
                return
              }

              const json = JSON.parse(data) as unknown

              if (!json || typeof json !== 'object') {
                reject(new Error('Invalid JSON response from registry'))
                return
              }

              resolve(json as { version?: string })
            } catch (parseError) {
              const contentType = res.headers['content-type']
              if (!contentType || !contentType.includes('application/json')) {
                debug(`Unexpected content type: ${contentType}`)
              }
              reject(
                new Error(
                  `Failed to parse JSON response: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
                ),
              )
            }
          })
        },
      )

      req.on('timeout', () => {
        cleanup()
        req.destroy()
        reject(new Error(`Request timed out after ${timeoutMs}ms`))
      })

      req.on('error', error => {
        cleanup()
        reject(new Error(`Network request failed: ${error.message}`))
      })

      req.end()
    })
  },

  /**
   * Get the latest version of a package from npm registry.
   */
  async getLatestVersion(
    name: string,
    options: GetLatestVersionOptions = {},
  ): Promise<string | undefined> {
    if (!isNonEmptyString(name)) {
      throw new Error(
        `getLatestVersion(name) requires a non-empty string (got: ${typeof name === 'string' ? '""' : typeof name}); pass an npm package name like "socket" or "@socketsecurity/cli"`,
      )
    }

    const { authInfo, registryUrl = NPM_REGISTRY_URL } = {
      __proto__: null,
      ...options,
    } as GetLatestVersionOptions

    if (!isNonEmptyString(registryUrl)) {
      throw new Error(
        `getLatestVersion options.registryUrl must be a non-empty string (got: ${typeof registryUrl === 'string' ? '""' : typeof registryUrl}); omit it to default to ${NPM_REGISTRY_URL}`,
      )
    }

    let normalizedRegistryUrl: string
    try {
      const url = new URL(registryUrl)
      normalizedRegistryUrl = url.toString()
    } catch {
      throw new Error(
        `options.registryUrl "${registryUrl}" is not a valid URL (new URL() threw); pass an absolute http(s) URL like ${NPM_REGISTRY_URL}`,
      )
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
          throw new Error(
            `${latestUrl} responded without a .version string (got: ${JSON.stringify(json)?.slice(0, 200) ?? 'null'}); the registry may be misconfigured or ${name} may not exist — verify the URL in a browser`,
          )
        }

        return json.version
      } catch (e) {
        attempts++
        const isLastAttempt = attempts === maxAttempts

        if (isLastAttempt) {
          logger.warn(
            `Failed to fetch version after ${maxAttempts} attempts: ${e instanceof Error ? e.message : String(e)}`,
          )
          throw e
        }

        // Exponential backoff with cap to prevent integer overflow.
        const delay = Math.min(baseDelay * 2 ** (attempts - 1), 60_000)
        logger.log(
          `Attempt ${attempts} failed, retrying in ${delay}ms: ${e instanceof Error ? e.message : String(e)}`,
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
    throw new Error(
      `checkForUpdates options.name requires a non-empty string (got: ${typeof name === 'string' ? '""' : typeof name}); pass an npm package name like "socket" or "@socketsecurity/cli"`,
    )
  }

  if (!isNonEmptyString(version)) {
    throw new Error(
      `checkForUpdates options.version requires a non-empty string (got: ${typeof version === 'string' ? '""' : typeof version}); pass the currently-installed semver like "1.2.3"`,
    )
  }

  try {
    const latest = await NetworkUtils.getLatestVersion(name, {
      ...(authInfo ? { authInfo } : {}),
      ...(registryUrl ? { registryUrl } : {}),
    })

    if (!isNonEmptyString(latest)) {
      throw new Error(
        `registry returned no latest version for ${name} (getLatestVersion resolved to ${JSON.stringify(latest)}); check that ${name} exists on ${registryUrl || NPM_REGISTRY_URL}`,
      )
    }

    const updateAvailable = isUpdateAvailable(version, latest)

    return {
      current: version,
      latest,
      updateAvailable,
    }
  } catch (e) {
    logger.log(
      `Failed to check for updates: ${e instanceof Error ? e.message : String(e)}`,
    )
    throw e
  }
}

export { checkForUpdates, isUpdateAvailable, NetworkUtils }
