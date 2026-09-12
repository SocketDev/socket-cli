import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'

/**
 * Creates a temporary copy of a fixture directory for testing. The temporary
 * directory is automatically cleaned up when tests complete.
 *
 * @param fixturePath - Path to the fixture directory to copy.
 * @param cleanupHook - Optional function to register cleanup (e.g., afterEach).
 *
 * @returns Path to the temporary fixture copy.
 */
export async function createTempFixture(
  fixturePath: string,
  cleanupHook?: ((cleanup: () => Promise<void>) => void) | undefined,
): Promise<string> {
  // Create a unique temporary directory.
  const tempBaseDir = os.tmpdir()
  const tempDirName = `socket-cli-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const tempDir = path.join(tempBaseDir, tempDirName)

  // Copy fixture to temp directory recursively.
  await fs.cp(fixturePath, tempDir, {
    recursive: true,
    // Preserve file permissions and timestamps.
    preserveTimestamps: true,
  })

  // Register cleanup if hook provided.
  if (cleanupHook) {
    cleanupHook(async () => {
      try {
        await safeDelete(tempDir)
      } catch {
        // Ignore cleanup errors in tests.
      }
    })
  }

  return tempDir
}

/**
 * Helper to create a temporary fixture with automatic cleanup in afterEach.
 * Designed for use in test suites that use afterEach hooks.
 *
 * @param fixturePath - Path to the fixture directory.
 *
 * @returns Object with tempDir path and cleanup function.
 */
export async function withTempFixture(fixturePath: string): Promise<{
  tempDir: string
  cleanup: () => Promise<void>
}> {
  const tempDir = await createTempFixture(fixturePath)

  const cleanup = async () => {
    try {
      await safeDelete(tempDir)
    } catch {
      // Ignore cleanup errors.
    }
  }

  return { tempDir, cleanup }
}
