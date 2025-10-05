/**
 * Process locking utilities for Socket CLI.
 * Provides cross-platform inter-process locking without external dependencies.
 *
 * Key Functions:
 * - acquire: Get exclusive file lock with retry mechanism
 * - release: Release lock and cleanup
 * - withLock: Execute function with automatic lock management
 *
 * Implementation:
 * - Uses mkdir for atomic lock creation (POSIX standard)
 * - Handles stale lock detection and cleanup
 * - Process exit cleanup using socket-registry helpers
 * - Cross-platform network filesystem compatibility
 *
 * Features:
 * - Stale lock detection (10 second timeout)
 * - Automatic process exit cleanup
 * - Exponential backoff retry strategy
 * - Error-resistant implementation
 *
 * Usage:
 * - File coordination between processes
 * - Update cache protection
 * - Atomic write operations
 */

import { existsSync, mkdirSync, statSync } from 'node:fs'
import path from 'node:path'

import { removeSync } from '@socketsecurity/registry/lib/fs'
import { logger } from '@socketsecurity/registry/lib/logger'
import promises from '@socketsecurity/registry/lib/promises'
import { onExit } from '@socketsecurity/registry/lib/signal-exit'

/**
 * Lock acquisition options.
 */
interface LockOptions {
  /**
   * Maximum number of retry attempts.
   */
  retries?: number | undefined
  /**
   * Base delay between retries in milliseconds.
   */
  baseDelayMs?: number | undefined
  /**
   * Maximum delay between retries in milliseconds.
   */
  maxDelayMs?: number | undefined
  /**
   * Stale lock timeout in milliseconds.
   */
  staleMs?: number | undefined
}

/**
 * Process lock manager with stale detection and exit cleanup.
 */
class ProcessLockManager {
  private activeLocks = new Set<string>()
  private exitHandlerRegistered = false

  /**
   * Ensure process exit handler is registered for cleanup.
   */
  private ensureExitHandler(): void {
    if (this.exitHandlerRegistered) {
      return
    }

    onExit(() => {
      // Clean up all active locks on exit.
      for (const lockPath of this.activeLocks) {
        try {
          if (existsSync(lockPath)) {
            removeSync(lockPath)
          }
        } catch {
          // Best effort cleanup - don't throw on exit.
        }
      }
    })

    this.exitHandlerRegistered = true
  }

  /**
   * Check if a lock is stale based on mtime.
   */
  private isStale(lockPath: string, staleMs: number): boolean {
    try {
      if (!existsSync(lockPath)) {
        return false
      }

      const stats = statSync(lockPath)
      const age = Date.now() - stats.mtime.getTime()
      return age > staleMs
    } catch {
      return false
    }
  }

  /**
   * Acquire a lock using mkdir for atomic operation.
   * Handles stale locks and includes exit cleanup.
   */
  async acquire(
    lockPath: string,
    options: LockOptions = {},
  ): Promise<() => void> {
    const {
      baseDelayMs = 100,
      maxDelayMs = 1_000,
      retries = 3,
      staleMs = 10_000,
    } = options

    this.ensureExitHandler()

    const release = await promises.pRetry(
      async (): Promise<() => void> => {
        try {
          // Check for stale locks and remove them.
          if (existsSync(lockPath) && this.isStale(lockPath, staleMs)) {
            // Removing stale lock.
            try {
              removeSync(lockPath)
            } catch {
              // If we can't remove it, someone else might be using it.
            }
          }

          // Ensure parent directory exists.
          const parentDir = path.dirname(lockPath)
          mkdirSync(parentDir, { recursive: true })

          // Use mkdir for atomic lock creation - will fail if already exists.
          mkdirSync(lockPath, { recursive: false })

          // Track for cleanup.
          this.activeLocks.add(lockPath)

          // Acquired lock.

          // Return release function.
          return () => this.release(lockPath)
        } catch (error) {
          if (error instanceof Error && (error as any).code === 'EEXIST') {
            // Lock already exists, check if stale.
            if (this.isStale(lockPath, staleMs)) {
              // Stale lock detected, will be handled on next retry.
              throw new Error(`Stale lock detected: ${lockPath}`)
            }
            throw new Error(`Lock already exists: ${lockPath}`)
          }
          // Other errors are permanent.
          throw error
        }
      },
      {
        retries,
        baseDelayMs,
        maxDelayMs,
        jitter: true,
      },
    )
    if (!release) {
      throw new Error(`Failed to acquire lock: ${lockPath}`)
    }
    return release
  }

  /**
   * Release a lock and remove from tracking.
   */
  release(lockPath: string): void {
    try {
      if (existsSync(lockPath)) {
        removeSync(lockPath)
      }
      this.activeLocks.delete(lockPath)
      // Released lock.
    } catch (error) {
      logger.warn(
        `Failed to release lock ${lockPath}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  /**
   * Execute a function with exclusive lock protection.
   * Automatically handles lock acquisition, execution, and cleanup.
   */
  async withLock<T>(
    lockPath: string,
    fn: () => Promise<T>,
    options?: LockOptions | undefined,
  ): Promise<T> {
    const release = await this.acquire(lockPath, options)

    try {
      return await fn()
    } finally {
      release()
    }
  }
}

// Export singleton instance.
const processLockManager = new ProcessLockManager()

export { processLockManager as processLock }
export type { LockOptions }
