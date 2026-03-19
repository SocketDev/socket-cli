/**
 * Update manager for Socket CLI (npm/pnpm/yarn installations only).
 * Orchestrates update checking, caching, and user notifications for package manager installs.
 *
 * Note: SEA binaries use node-smol's built-in update checker (via --update-config).
 * This manager only handles npm registry update checks for non-SEA installations.
 *
 * Key Functions:
 * - checkForUpdates: Complete update check flow with caching (npm only)
 * - scheduleUpdateCheck: Non-blocking update check with notifications (npm only)
 *
 * Features:
 * - TTL-based caching to avoid excessive registry requests
 * - Error-resistant implementation
 * - Rate limiting and network timeout handling
 *
 * Architecture:
 * - Uses checker for npm registry lookups
 * - Uses store for persistent caching
 * - Uses notifier for user messaging
 * - Skips entirely for SEA binaries (node-smol handles it)
 *
 * Usage:
 * - CLI startup update checks (npm installs only)
 * - Background update monitoring (npm installs only)
 */

import { dlxManifest } from '@socketsecurity/lib/dlx/manifest'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { isNonEmptyString } from '@socketsecurity/lib/strings'

import { checkForUpdates as performUpdateCheck } from './checker.mts'
import {
  scheduleExitNotification,
  showUpdateNotification,
} from './notifier.mts'
import { UPDATE_CHECK_TTL } from '../../constants/cache.mts'
import { isSeaBinary } from '../sea/detect.mts'

import type { AuthInfo, UpdateCheckResult } from './checker.mts'
import type { StoreRecord } from '@socketsecurity/lib/dlx/manifest'

const logger = getDefaultLogger()

// Notification TTL: Show notification at most once per 7 days (604800000 ms).
const NOTIFICATION_TTL_MS = 7 * 24 * 60 * 60 * 1000

export interface UpdateManagerOptions {
  authInfo?: AuthInfo | undefined
  name: string
  version: string
  /**
   * Whether to show notification immediately or on exit.
   */
  immediate?: boolean | undefined
  registryUrl?: string | undefined
  ttl?: number | undefined
}

/**
 * Perform complete update check flow with caching and notifications.
 * This is the main function that orchestrates the entire update process.
 */
export async function checkForUpdates(
  options: UpdateManagerOptions,
): Promise<boolean> {
  const {
    authInfo,
    immediate = false,
    name,
    registryUrl,
    ttl = UPDATE_CHECK_TTL,
    version,
  } = { __proto__: null, ...options } as UpdateManagerOptions

  const loggerLocal = getDefaultLogger()

  // Capture timestamp immediately for accurate TTL calculations.
  const timestamp = Date.now()

  // Validate required parameters.
  if (!isNonEmptyString(name)) {
    loggerLocal.warn('Package name must be a non-empty string')
    return false
  }

  if (!isNonEmptyString(version)) {
    loggerLocal.warn('Current version must be a non-empty string')
    return false
  }

  if (ttl < 0) {
    loggerLocal.warn('TTL must be a non-negative number')
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

  // Validate registry URL if provided.
  if (registryUrl && !isNonEmptyString(registryUrl)) {
    loggerLocal.warn('Invalid registry URL provided, using default')
  }

  let record: StoreRecord | undefined

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
  const cacheKey = `${name}@${version}${registrySuffix}`

  try {
    // Note: dlxManifest.get() is not lock-protected, which can cause a race condition
    // where concurrent CLI invocations read stale cache simultaneously and both fetch
    // fresh data. This only wastes network resources during TTL expiration; no data
    // corruption occurs since both writes contain the same fresh data. Acceptable tradeoff
    // for simplicity vs. adding in-memory deduplication layer.
    record = dlxManifest.get(cacheKey)

    if (timestamp <= 0) {
      loggerLocal.warn('Invalid system time, using cached data only')
      if (record) {
        // Validate cached record has a valid timestamp before using.
        if (
          !record.timestampFetch ||
          record.timestampFetch <= 0 ||
          !record.version
        ) {
          loggerLocal.warn(
            'Cached data has invalid timestamp or version, skipping update check',
          )
          return false
        }
        // Use cached data for notification.
        const updateAvailable = version !== record.version
        if (updateAvailable) {
          const notificationOptions = {
            name,
            current: version,
            latest: record.version,
          }

          if (immediate) {
            showUpdateNotification(notificationOptions)
          } else {
            scheduleExitNotification(notificationOptions)
          }
        }
        return updateAvailable
      }
      return false
    }
  } catch (e) {
    loggerLocal.warn(
      `Failed to access cache: ${e instanceof Error ? e.message : String(e)}`,
    )
    record = undefined
  }

  // Check freshness inline to avoid potential double-read.
  const isFresh =
    record && record.timestampFetch
      ? timestamp - record.timestampFetch < ttl
      : false
  let updateResult: UpdateCheckResult

  if (!isFresh) {
    // Need to fetch fresh data from registry.
    try {
      updateResult = await performUpdateCheck({
        authInfo,
        name,
        registryUrl,
        version,
      })

      // Update cache with fresh data.
      // Intentional: Capture timestamp after fetch completes, not before it starts.
      // This extends TTL by network latency (~seconds) but represents when data
      // was actually received, making cache entries slightly "fresher".
      try {
        await dlxManifest.set(cacheKey, {
          timestampFetch: Date.now(),
          timestampNotification: record?.timestampNotification ?? 0,
          version: updateResult.latest,
        })
      } catch (e) {
        loggerLocal.warn(
          `Failed to update cache: ${e instanceof Error ? e.message : String(e)}`,
        )
        // Continue anyway - cache update failure is not critical.
      }
    } catch (e) {
      loggerLocal.log(
        `Failed to fetch latest version: ${e instanceof Error ? e.message : String(e)}`,
      )

      // Use cached version if available.
      if (record) {
        updateResult = {
          current: version,
          latest: record.version,
          updateAvailable: version !== record.version,
        }
      } else {
        loggerLocal.log('No version information available')
        return false
      }
    }
  } else {
    // Use fresh cached data.
    updateResult = {
      current: version,
      latest: record?.version ?? version,
      updateAvailable: version !== (record?.version ?? version),
    }
  }

  // Show notification if update is available and not shown recently.
  if (updateResult.updateAvailable && !isFresh) {
    const now = Date.now()
    const lastNotification = record?.timestampNotification ?? 0
    const timeSinceLastNotification = now - lastNotification

    // Only show notification if it's been more than NOTIFICATION_TTL_MS since last notification.
    if (timeSinceLastNotification >= NOTIFICATION_TTL_MS) {
      try {
        const notificationOptions = {
          name,
          current: updateResult.current,
          latest: updateResult.latest,
        }

        if (immediate) {
          showUpdateNotification(notificationOptions)
        } else {
          scheduleExitNotification(notificationOptions)
        }

        // Update timestampNotification in cache to prevent spam.
        try {
          await dlxManifest.set(cacheKey, {
            timestampFetch: record?.timestampFetch ?? now,
            timestampNotification: now,
            version: updateResult.latest,
          })
        } catch (e) {
          loggerLocal.warn(
            `Failed to update notification timestamp: ${e instanceof Error ? e.message : String(e)}`,
          )
        }
      } catch (e) {
        loggerLocal.warn(
          `Failed to set up notification: ${e instanceof Error ? e.message : String(e)}`,
        )
        // Notification failure is not critical - update is still available.
      }
    }
  }

  return updateResult.updateAvailable
}

/**
 * Schedule a non-blocking update check.
 * This is the recommended way to check for updates during CLI startup.
 *
 * Note: Only runs for npm/pnpm/yarn installations. SEA binaries use
 * node-smol's built-in update checker (embedded via --update-config).
 */
export async function scheduleUpdateCheck(
  options: UpdateManagerOptions,
): Promise<void> {
  // Skip update checks for SEA binaries - node-smol handles it via embedded update-config.
  if (isSeaBinary()) {
    return
  }

  // Set immediate to false to show notification on exit.
  const updateOptions = { ...options, immediate: false }

  try {
    await checkForUpdates(updateOptions)
  } catch (e) {
    // Silent failure - update checks should never block the main CLI.
    logger.log(
      `Update check failed: ${e instanceof Error ? e.message : String(e)}`,
    )
  }
}
