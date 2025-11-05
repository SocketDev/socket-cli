/**
 * Update manager for Socket CLI.
 * Orchestrates update checking, caching, and user notifications.
 * Main entry point that coordinates all update-related functionality.
 *
 * Key Functions:
 * - checkForUpdates: Complete update check flow with caching
 * - scheduleUpdateCheck: Non-blocking update check with notifications
 *
 * Features:
 * - TTL-based caching to avoid excessive registry requests
 * - SEA vs npm aware notifications
 * - Error-resistant implementation
 * - Rate limiting and network timeout handling
 *
 * Architecture:
 * - Uses checker for registry lookups
 * - Uses store for persistent caching
 * - Uses notifier for user messaging
 * - Coordinates between all update utilities
 *
 * Usage:
 * - CLI startup update checks
 * - Background update monitoring
 * - User-triggered update checks
 */

import { dlxManifest } from '@socketsecurity/lib-internal/dlx-manifest'
import { getDefaultLogger } from '@socketsecurity/lib-internal/logger'
import { isNonEmptyString } from '@socketsecurity/lib-internal/strings'

const logger = getDefaultLogger()

import { checkForUpdates as performUpdateCheck } from './checker.mts'
import {
  scheduleExitNotification,
  showUpdateNotification,
} from './notifier.mts'
import { UPDATE_CHECK_TTL } from '../../constants/cache.mts'

import type { AuthInfo } from './checker.mts'
import type { StoreRecord } from '@socketsecurity/lib-internal/dlx-manifest'

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
  let timestamp: number

  try {
    record = dlxManifest.get(name)
    timestamp = Date.now()

    if (timestamp <= 0) {
      loggerLocal.warn('Invalid system time, using cached data only')
      if (record) {
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
  } catch (error) {
    loggerLocal.warn(
      `Failed to access cache: ${error instanceof Error ? error.message : String(error)}`,
    )
    timestamp = Date.now()
  }

  const isFresh = dlxManifest.isFresh(record, ttl)
  let updateResult: any

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
      try {
        await dlxManifest.set(name, {
          timestampFetch: timestamp,
          timestampNotification: record?.timestampNotification ?? 0,
          version: updateResult.latest,
        })
      } catch (error) {
        loggerLocal.warn(
          `Failed to update cache: ${error instanceof Error ? error.message : String(error)}`,
        )
        // Continue anyway - cache update failure is not critical.
      }
    } catch (error) {
      loggerLocal.log(
        `Failed to fetch latest version: ${error instanceof Error ? error.message : String(error)}`,
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

  // Show notification if update is available.
  if (updateResult.updateAvailable && !isFresh) {
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
    } catch (error) {
      loggerLocal.warn(
        `Failed to set up notification: ${error instanceof Error ? error.message : String(error)}`,
      )
      // Notification failure is not critical - update is still available.
    }
  }

  return updateResult.updateAvailable
}

/**
 * Schedule a non-blocking update check.
 * This is the recommended way to check for updates during CLI startup.
 */
export async function scheduleUpdateCheck(
  options: UpdateManagerOptions,
): Promise<void> {
  // Set immediate to false to show notification on exit.
  const updateOptions = { ...options, immediate: false }

  try {
    await checkForUpdates(updateOptions)
  } catch (error) {
    // Silent failure - update checks should never block the main CLI.
    logger.log(
      `Update check failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}
