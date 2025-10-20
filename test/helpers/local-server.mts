/**
 * Local server detection and configuration for testing against local depscan.
 *
 * This helper detects if a local depscan server is running and configures
 * the Socket SDK to use it for integration testing.
 *
 * Usage:
 * ```typescript
 * import { withLocalServer, isLocalServerRunning } from '../helpers/local-server.mts'
 *
 * describe('patches API', () => {
 *   it('should fetch patches from scan', async () => {
 *     const localUrl = await withLocalServer()
 *     if (!localUrl) {
 *       console.log('Skipping test: local server not running')
 *       return
 *     }
 *
 *     // Test code here will use local server at localUrl
 *   })
 * })
 * ```
 */

import { ENV } from '../../src/constants/env.mts'

/**
 * Default local server configurations to check.
 * The depscan API server runs on port 8866 by default.
 * See: depscan/workspaces/api-v0/e2e-tests/common.js
 */
const DEFAULT_LOCAL_SERVERS = [
  'http://localhost:8866',
  'http://127.0.0.1:8866',
]

/**
 * Check if a URL is reachable by making a HEAD request.
 */
async function isUrlReachable(url: string): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 1000)

    const response = await fetch(`${url}/health`, {
      method: 'HEAD',
      signal: controller.signal,
    })

    clearTimeout(timeoutId)
    return response.ok
  } catch {
    return false
  }
}

/**
 * Check if local depscan server is running.
 * Returns the URL if found, undefined otherwise.
 */
export async function isLocalServerRunning(
  customUrls: string[] = [],
): Promise<string | undefined> {
  // Check if explicitly set via environment variable.
  if (ENV.SOCKET_CLI_API_BASE_URL) {
    const isReachable = await isUrlReachable(ENV.SOCKET_CLI_API_BASE_URL)
    if (isReachable) {
      return ENV.SOCKET_CLI_API_BASE_URL
    }
  }

  // Check custom URLs first, then defaults.
  const urlsToCheck = [...customUrls, ...DEFAULT_LOCAL_SERVERS]

  for (const url of urlsToCheck) {
    // eslint-disable-next-line no-await-in-loop
    const isReachable = await isUrlReachable(url)
    if (isReachable) {
      return url
    }
  }

  return undefined
}

/**
 * Configure environment to use local server if available.
 * Returns the local server URL if found and configured.
 *
 * @param customUrls - Additional URLs to check beyond defaults
 * @returns Local server URL if running, undefined otherwise
 */
export async function withLocalServer(
  customUrls: string[] = [],
): Promise<string | undefined> {
  const localUrl = await isLocalServerRunning(customUrls)

  if (localUrl) {
    // Set environment variable for SDK to use.
    process.env['SOCKET_CLI_API_BASE_URL'] = localUrl
    console.log(`✓ Using local depscan server at ${localUrl}`)
  }

  return localUrl
}

/**
 * Restore original API base URL after test.
 * Call this in afterEach or test cleanup.
 */
export function restoreApiBaseUrl(originalUrl?: string): void {
  if (originalUrl) {
    process.env['SOCKET_CLI_API_BASE_URL'] = originalUrl
  } else {
    delete process.env['SOCKET_CLI_API_BASE_URL']
  }
}

/**
 * Helper for test setup with local server detection.
 * Returns original URL for restoration.
 *
 * Example:
 * ```typescript
 * let originalUrl: string | undefined
 *
 * beforeEach(async () => {
 *   originalUrl = await setupLocalServer()
 * })
 *
 * afterEach(() => {
 *   cleanupLocalServer(originalUrl)
 * })
 * ```
 */
export async function setupLocalServer(
  customUrls: string[] = [],
): Promise<string | undefined> {
  const originalUrl = ENV.SOCKET_CLI_API_BASE_URL
  await withLocalServer(customUrls)
  return originalUrl
}

/**
 * Cleanup helper for test teardown.
 */
export function cleanupLocalServer(originalUrl?: string): void {
  restoreApiBaseUrl(originalUrl)
}
