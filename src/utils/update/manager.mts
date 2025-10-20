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

import { logger } from '@socketsecurity/lib/logger'
import { isNonEmptyString } from '@socketsecurity/lib/strings'

import { checkForUpdates as performUpdateCheck } from './checker.mts'
import {
  scheduleExitNotification,
  showUpdateNotification,
} from './notifier.mts'
import { updateStore } from './store.mts'
import { UPDATE_CHECK_TTL } from '../../constants/cache.mts'

import type { AuthInfo } from './checker.mts'
import type { StoreRecord } from './store.mts'


interface UpdateManagerOptions {
  authInfo?: AuthInfo | undefined
  name: string
  registryUrl?: string | undefined
  ttl?: number | undefined
  version: string
  /**
   * Whether to show notification immediately or on exit.
   */
  immediate?: boolean | undefined
}

/**
 * Perform complete update check flow with caching and notifications.
 * This is the main function that orchestrates the entire update process.
 */
async function checkForUpdates(
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

  // Validate required parameters.
  if (!isNonEmptyString(name)) {
    logger.warn('Package name must be a non-empty string')
    return false
  }

  if (!isNonEmptyString(version)) {
    logger.warn('Current version must be a non-empty string')
    return false
  }

  if (ttl < 0) {
    logger.warn('TTL must be a non-negative number')
    return false
  }

  // Validate auth info if provided.
  if (authInfo) {
    if (!isNonEmptyString(authInfo.token) || !isNonEmptyString(authInfo.type)) {
      logger.warn(
        'Invalid auth info provided, proceeding without authentication',
      )
    }
  }

  // Validate registry URL if provided.
  if (registryUrl && !isNonEmptyString(registryUrl)) {
    logger.warn('Invalid registry URL provided, using default')
  }

  let record: StoreRecord | undefined
  let timestamp: number

  try {
    record = updateStore.get(name)
    timestamp = Date.now()

    if (timestamp <= 0) {
      logger.warn('Invalid system time, using cached data only')
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
    logger.warn(
      `Failed to access cache: ${error instanceof Error ? error.message : String(error)}`,
    )
    timestamp = Date.now()
  }

  const isFresh = updateStore.isFresh(record, ttl)
  let updateResult

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
        await updateStore.set(name, {
          timestampFetch: timestamp,
          timestampNotification: record?.timestampNotification ?? 0,
          version: updateResult.latest,
        })
      } catch (error) {
        logger.warn(
          `Failed to update cache: ${error instanceof Error ? error.message : String(error)}`,
        )
        // Continue anyway - cache update failure is not critical.
      }
    } catch (error) {
      logger.log(
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
        logger.log('No version information available')
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
      logger.warn(
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
async function scheduleUpdateCheck(
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

export { checkForUpdates, scheduleUpdateCheck }
export type { UpdateManagerOptions }
