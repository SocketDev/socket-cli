/**
 * Update cache storage utilities for Socket CLI.
 * Manages persistent caching of update check results with TTL support
 * and atomic file operations.
 *
 * Key Functions:
 * - get: Retrieve cached update information
 * - set: Store update information with timestamp
 * - clear: Remove cached data
 *
 * Features:
 * - TTL-based cache expiration
 * - Atomic file operations with locking
 * - JSON-based persistent storage
 * - Error-resistant implementation
 *
 * Storage Format:
 * - Stores in ~/.socket/_socket/updater/state.json
 * - Per-package update records with timestamps
 * - Thread-safe operations using process lock utility
 *
 * Usage:
 * - Update check caching
 * - Rate limiting registry requests
 * - Offline update information
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { readFileUtf8Sync } from '@socketsecurity/registry/lib/fs'
import { logger } from '@socketsecurity/registry/lib/logger'

import { UPDATE_STORE_DIR, UPDATE_STORE_FILE_NAME } from '../constants.mts'
import { getSocketCliUpdaterStateJsonPath } from './paths.mts'
import { processLock } from './process-lock.mts'

interface StoreRecord {
  timestampFetch: number
  timestampNotification: number
  version: string
}

interface UpdateStoreOptions {
  /**
   * Custom store file path (defaults to ~/.socket/_socket/updater/state.json)
   */
  storePath?: string | undefined
}

/**
 * Update cache storage manager with atomic operations.
 */
class UpdateStore {
  private readonly storePath: string
  private readonly lockPath: string

  constructor(options: UpdateStoreOptions = {}) {
    this.storePath = options.storePath ?? getSocketCliUpdaterStateJsonPath()
    this.lockPath = `${this.storePath}.lock`
    this.migrateOldStore()
  }

  /**
   * Migrate data from old store location to new location.
   * Old location: ~/.socket/_socket/update-store.json
   * New location: ~/.socket/_socket/updater/state.json
   */
  private migrateOldStore(): void {
    const oldStorePath = path.join(
      os.homedir(),
      UPDATE_STORE_DIR,
      UPDATE_STORE_FILE_NAME,
    )

    if (oldStorePath === this.storePath || !existsSync(oldStorePath)) {
      return
    }

    try {
      if (existsSync(this.storePath)) {
        logger.info(
          'New store file exists, skipping migration from old location',
        )
        return
      }

      const content = readFileSync(oldStorePath, 'utf8')
      if (!content.trim()) {
        unlinkSync(oldStorePath)
        return
      }

      const storeDir = path.dirname(this.storePath)
      mkdirSync(storeDir, { recursive: true })
      writeFileSync(this.storePath, content, 'utf8')
      unlinkSync(oldStorePath)

      logger.info(
        `Migrated update store from ${oldStorePath} to ${this.storePath}`,
      )
    } catch (error) {
      logger.warn(
        `Failed to migrate old store: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  /**
   * Get cached update information for a package.
   */
  get(name: string): StoreRecord | undefined {
    try {
      if (!existsSync(this.storePath)) {
        return undefined
      }

      const rawContent = readFileUtf8Sync(this.storePath)
      const content = (
        typeof rawContent === 'string' ? rawContent : rawContent.toString()
      ).trim()
      if (!content) {
        return undefined
      }

      const data = JSON.parse(content) as Record<string, StoreRecord>
      return data[name]
    } catch (error) {
      logger.warn(
        `Failed to read update cache: ${error instanceof Error ? error.message : String(error)}`,
      )
      return undefined
    }
  }

  /**
   * Store update information for a package.
   * Uses atomic file operations with locking to prevent corruption.
   */
  async set(name: string, record: StoreRecord): Promise<void> {
    await processLock.withLock(this.lockPath, async () => {
      let data: Record<string, StoreRecord> = Object.create(null)

      // Read existing data.
      try {
        if (existsSync(this.storePath)) {
          const content = readFileSync(this.storePath, 'utf8')
          if (content.trim()) {
            data = JSON.parse(content) as Record<string, StoreRecord>
          }
        }
      } catch (error) {
        logger.warn(
          `Failed to read existing store: ${error instanceof Error ? error.message : String(error)}`,
        )
      }

      // Update record.
      data[name] = record

      // Ensure directory exists.
      const storeDir = path.dirname(this.storePath)
      try {
        mkdirSync(storeDir, { recursive: true })
      } catch (error) {
        logger.warn(
          `Failed to create store directory: ${error instanceof Error ? error.message : String(error)}`,
        )
      }

      // Write atomically.
      const content = JSON.stringify(data, null, 2)
      const tempPath = `${this.storePath}.tmp`

      try {
        writeFileSync(tempPath, content, 'utf8')
        writeFileSync(this.storePath, content, 'utf8')

        // Clean up temp file.
        try {
          if (existsSync(tempPath)) {
            unlinkSync(tempPath)
          }
        } catch {
          // Cleanup failed, not critical.
        }
      } catch (error) {
        // Clean up temp file on error.
        try {
          if (existsSync(tempPath)) {
            unlinkSync(tempPath)
          }
        } catch {
          // Best effort cleanup.
        }
        throw error
      }
    })
  }

  /**
   * Clear cached data for a specific package.
   */
  async clear(name: string): Promise<void> {
    await processLock.withLock(this.lockPath, async () => {
      try {
        if (!existsSync(this.storePath)) {
          return
        }

        const content = readFileSync(this.storePath, 'utf8')
        if (!content.trim()) {
          return
        }

        const data = JSON.parse(content) as Record<string, StoreRecord>
        delete data[name]

        const updatedContent = JSON.stringify(data, null, 2)
        writeFileSync(this.storePath, updatedContent, 'utf8')
      } catch (error) {
        logger.warn(
          `Failed to clear cache for ${name}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    })
  }

  /**
   * Clear all cached data.
   */
  async clearAll(): Promise<void> {
    await processLock.withLock(this.lockPath, async () => {
      try {
        if (existsSync(this.storePath)) {
          unlinkSync(this.storePath)
        }
      } catch (error) {
        logger.warn(
          `Failed to clear all cache: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    })
  }

  /**
   * Check if cached data is fresh based on TTL.
   */
  isFresh(record: StoreRecord | undefined, ttlMs: number): boolean {
    if (!record) {
      return false
    }

    const age = Date.now() - record.timestampFetch
    return age < ttlMs
  }

  /**
   * Get all cached package names.
   */
  getAllPackages(): string[] {
    try {
      if (!existsSync(this.storePath)) {
        return []
      }

      const rawContent = readFileUtf8Sync(this.storePath)
      const content = (
        typeof rawContent === 'string' ? rawContent : rawContent.toString()
      ).trim()
      if (!content) {
        return []
      }

      const data = JSON.parse(content) as Record<string, StoreRecord>
      return Object.keys(data)
    } catch (error) {
      logger.warn(
        `Failed to get package list: ${error instanceof Error ? error.message : String(error)}`,
      )
      return []
    }
  }
}

// Export singleton instance using default store location
const updateStore = new UpdateStore()

export { UpdateStore, updateStore }
export type { StoreRecord, UpdateStoreOptions }
