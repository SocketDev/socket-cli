/**
 * Update manager for Socket CLI (npm/pnpm/yarn installations only).
 * Orchestrates update checking, caching, and user notifications for package
 * manager installs.
 *
 * Note: SEA binaries use node-smol's built-in update checker (via
 * --update-config). This manager only handles npm registry update checks for
 * non-SEA installations.
 *
 * Key Functions: - checkForUpdates: Complete update check flow with caching
 * npm only - scheduleUpdateCheck: Non-blocking update check with
 * notifications, npm only.
 *
 * Features: - TTL-based caching to avoid excessive registry requests -
 * Error-resistant implementation - Rate limiting and network timeout handling.
 *
 * Architecture: - Uses checker for npm registry lookups - Uses store for
 * persistent caching - Uses notifier for user messaging - Skips entirely for
 * SEA binaries, node-smol handles it.
 *
 * Usage: - CLI startup update checks, npm installs only - Background update
 * monitoring, npm installs only.
 */

import {
  dlxManifest,
  isPackageEntry,
} from '@socketsecurity/lib-stable/dlx/manifest'
import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { isNonEmptyString } from '@socketsecurity/lib-stable/strings/predicates'

import { checkForUpdates as performUpdateCheck } from './checker.mts'
import {
  scheduleExitNotification,
  showUpdateNotification,
} from './notifier.mts'
import { UPDATE_CHECK_TTL } from '../../constants/cache.mts'
import { isSeaBinary } from '../sea/detect.mts'

import type { AuthInfo, UpdateCheckResult } from './checker.mts'
import type { PackageDetails } from '@socketsecurity/lib-stable/dlx/manifest'

const logger = getDefaultLogger()

// Notification TTL: Show notification at most once per 7 days (604800000 ms).
const NOTIFICATION_TTL_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Perform complete update check flow with caching and notifications. This is
 * the main function that orchestrates the entire update process.
 */
export async function checkForUpdates(
  name: string,
  version: string,
  options?: UpdateManagerOptions | undefined,
): Promise<boolean> {
  const {
    authInfo,
    immediate = false,
    registryUrl,
    ttl = UPDATE_CHECK_TTL,
  } = { __proto__: null, ...options } as UpdateManagerOptions

  const loggerLocal = logger

  // Capture timestamp immediately for accurate TTL calculations.
  const timestamp = Date.now()

  if (!validateUpdateOptions(name, version, { authInfo, registryUrl, ttl })) {
    return false
  }

  let record: UpdateCacheRecord | undefined

  const cacheKey = updateCacheKey(name, version, registryUrl)

  try {
    record = readUpdateCache(cacheKey)

    if (timestamp <= 0) {
      loggerLocal.warn('Invalid system time, using cached data only')
      return notifyCachedUpdate(name, version, record, { immediate })
    }
  } catch (e) {
    loggerLocal.warn(`Failed to access cache: ${errorMessage(e)}`)
    record = undefined
  }

  // Check freshness inline to avoid potential double-read.
  const isFresh = record?.last_check
    ? timestamp - record.last_check < ttl
    : false
  let updateResult: UpdateCheckResult

  if (!isFresh) {
    const fetchedResult = await fetchUpdateResult(
      name,
      version,
      cacheKey,
      record,
      { authInfo, registryUrl },
    )
    if (!fetchedResult) {
      return false
    }
    updateResult = fetchedResult
  } else {
    // Use fresh cached data.
    const cachedVersion = record?.latest_known ?? version
    updateResult = {
      current: version,
      latest: cachedVersion,
      updateAvailable: version !== cachedVersion,
    }
  }

  // Show notification if update is available and not shown recently.
  if (updateResult.updateAvailable && !isFresh) {
    await notifyFreshUpdate(name, cacheKey, record, updateResult, { immediate })
  }

  return updateResult.updateAvailable
}

export async function fetchUpdateResult(
  name: string,
  version: string,
  cacheKey: string,
  record: UpdateCacheRecord | undefined,
  config: UpdateManagerOptions,
): Promise<UpdateCheckResult | undefined> {
  const { authInfo, registryUrl } = {
    __proto__: null,
    ...config,
  } as typeof config
  const loggerLocal = logger
  let updateResult: UpdateCheckResult
  // Need to fetch fresh data from registry.
  try {
    updateResult = await performUpdateCheck(name, version, {
      authInfo,
      registryUrl,
    })

    // Update cache with fresh data.
    // Intentional: Capture timestamp after fetch completes, not before it starts.
    // This extends TTL by network latency (~seconds) but represents when data
    // was actually received, making cache entries slightly "fresher".
    try {
      await writeUpdateCache(cacheKey, version, {
        last_check: Date.now(),
        last_notification: record?.last_notification ?? 0,
        latest_known: updateResult.latest,
      })
    } catch (e) {
      loggerLocal.warn(`Failed to update cache: ${errorMessage(e)}`)
      // Continue anyway - cache update failure is not critical.
    }
  } catch (e) {
    loggerLocal.log(`Failed to fetch latest version: ${errorMessage(e)}`)

    // Use cached version if available.
    if (record) {
      updateResult = {
        current: version,
        latest: record.latest_known,
        updateAvailable: version !== record.latest_known,
      }
    } else {
      loggerLocal.log('No version information available')
      return undefined
    }
  }
  return updateResult
}

export type UpdateCacheRecord = NonNullable<PackageDetails['update_check']>

export interface UpdateManagerOptions {
  authInfo?: AuthInfo | undefined
  /**
   * Whether to show notification immediately or on exit.
   */
  immediate?: boolean | undefined
  registryUrl?: string | undefined
  ttl?: number | undefined
}

export function notifyCachedUpdate(
  name: string,
  version: string,
  record: UpdateCacheRecord | undefined,
  config: UpdateManagerOptions,
): boolean {
  const { immediate } = { __proto__: null, ...config } as typeof config
  if (record) {
    // Validate cached record has a valid timestamp before using.
    if (!record.last_check || record.last_check <= 0 || !record.latest_known) {
      logger.warn(
        'Cached data has invalid timestamp or version, skipping update check',
      )
      return false
    }
    // Use cached data for notification.
    const updateAvailable = version !== record.latest_known
    if (updateAvailable) {
      if (immediate) {
        showUpdateNotification(name, version, record.latest_known)
      } else {
        scheduleExitNotification(name, version, record.latest_known)
      }
    }
    return updateAvailable
  }
  return false
}

export async function notifyFreshUpdate(
  name: string,
  cacheKey: string,
  record: UpdateCacheRecord | undefined,
  updateResult: UpdateCheckResult,
  config: UpdateManagerOptions,
): Promise<void> {
  const { immediate } = { __proto__: null, ...config } as typeof config
  const loggerLocal = logger
  const now = Date.now()
  const lastNotification = record?.last_notification ?? 0
  const timeSinceLastNotification = now - lastNotification

  // Only show notification if it's been more than NOTIFICATION_TTL_MS since last notification.
  if (timeSinceLastNotification >= NOTIFICATION_TTL_MS) {
    try {
      if (immediate) {
        showUpdateNotification(name, updateResult.current, updateResult.latest)
      } else {
        scheduleExitNotification(
          name,
          updateResult.current,
          updateResult.latest,
        )
      }

      // Update last_notification in cache to prevent spam.
      try {
        await writeUpdateCache(cacheKey, updateResult.current, {
          last_check: record?.last_check ?? now,
          last_notification: now,
          latest_known: updateResult.latest,
        })
      } catch (e) {
        loggerLocal.warn(
          `Failed to update notification timestamp: ${errorMessage(e)}`,
        )
      }
    } catch (e) {
      loggerLocal.warn(`Failed to set up notification: ${errorMessage(e)}`)
      // Notification failure is not critical - update is still available.
    }
  }
}

export function readUpdateCache(
  cacheKey: string,
): UpdateCacheRecord | undefined {
  const entry = dlxManifest.getManifestEntry(cacheKey)
  return entry && isPackageEntry(entry) ? entry.details.update_check : undefined
}

/**
 * Schedule a non-blocking update check. This is the recommended way to check
 * for updates during CLI startup.
 *
 * Note: Only runs for npm/pnpm/yarn installations. SEA binaries use node-smol's
 * built-in update checker (embedded via --update-config).
 */
export async function scheduleUpdateCheck(
  name: string,
  version: string,
  options?: UpdateManagerOptions | undefined,
): Promise<void> {
  // Skip update checks for SEA binaries - node-smol handles it via embedded update-config.
  if (isSeaBinary()) {
    return
  }

  // Set immediate to false to show notification on exit.
  const updateOptions = { ...options, immediate: false }

  try {
    await checkForUpdates(name, version, updateOptions)
    /* c8 ignore start - update-check failures are silent and can't be triggered without mocking the entire update pipeline */
  } catch (e) {
    logger.log(`Update check failed: ${errorMessage(e)}`)
  }
  /* c8 ignore stop */
}

export function updateCacheKey(
  name: string,
  version: string,
  registryUrl?: string | undefined,
): string {
  // Include current version and registry in cache key to prevent stale cache.
  // Different registries may have different latest versions.
  // Normalize registry URL to prevent duplicate cache entries for equivalent URLs.
  let normalizedRegistry = ''
  if (registryUrl) {
    try {
      normalizedRegistry = new URL(registryUrl).href
    } catch {
      normalizedRegistry = registryUrl
    }
  }
  const registrySuffix = normalizedRegistry ? `:${normalizedRegistry}` : ''
  return `${name}@${version}${registrySuffix}`
}

export function validateUpdateOptions(
  name: string,
  version: string,
  config: UpdateManagerOptions,
): boolean {
  const {
    authInfo,
    registryUrl,
    ttl = UPDATE_CHECK_TTL,
  } = { __proto__: null, ...config } as typeof config
  const loggerLocal = logger
  // Validate required parameters.
  if (!isNonEmptyString(name)) {
    loggerLocal.warn(
      `checkForUpdates(name) requires a non-empty string (got: ${typeof name === 'string' ? '""' : typeof name}); skipping update check`,
    )
    return false
  }

  if (!isNonEmptyString(version)) {
    loggerLocal.warn(
      `checkForUpdates(name, version) requires version to be a non-empty string (got: ${typeof version === 'string' ? '""' : typeof version}); skipping update check`,
    )
    return false
  }

  if (ttl < 0) {
    loggerLocal.warn(
      `checkForUpdates options.ttl must be >= 0 (saw: ${ttl}); pass a positive number of milliseconds, e.g. 86_400_000 for 24h`,
    )
    return false
  }

  // Validate auth info if provided.
  if (authInfo) {
    if (!isNonEmptyString(authInfo.token) || !isNonEmptyString(authInfo.type)) {
      loggerLocal.warn(
        'Invalid auth info provided, proceeding without authentication',
      )
    }
  }

  /* c8 ignore start - registry URL validation is defensive; isNonEmptyString already truth-checked by the && above */
  if (registryUrl && !isNonEmptyString(registryUrl)) {
    loggerLocal.warn('Invalid registry URL provided, using default')
  }
  /* c8 ignore stop */

  return true
}

export async function writeUpdateCache(
  cacheKey: string,
  version: string,
  updateCheck: UpdateCacheRecord,
): Promise<void> {
  const entry = dlxManifest.getManifestEntry(cacheKey)
  const packageEntry = entry && isPackageEntry(entry) ? entry : undefined
  await dlxManifest.setPackageEntry(
    cacheKey,
    packageEntry?.cache_key ?? cacheKey,
    {
      ...packageEntry?.details,
      installed_version: packageEntry?.details.installed_version ?? version,
      update_check: updateCheck,
    },
  )
}
