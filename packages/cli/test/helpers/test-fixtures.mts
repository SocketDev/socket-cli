import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { safeDelete } from '@socketsecurity/lib/fs'

/**
 * Creates a temporary copy of a fixture directory for testing.
 * The temporary directory is automatically cleaned up when tests complete.
 *
 * @param fixturePath - Path to the fixture directory to copy.
 * @param cleanupHook - Optional function to register cleanup (e.g., afterEach).
 * @returns Path to the temporary fixture copy.
 */
export async function createTempFixture(
  fixturePath: string,
  cleanupHook?: (cleanup: () => Promise<void>) => void,
): Promise<string> {
  // Create a unique temporary directory.
  const tempBaseDir = tmpdir()
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
 * Creates multiple temporary fixture copies at once.
 *
 * @param fixtures - Map of fixture name to fixture path.
 * @param cleanupHook - Optional function to register cleanup.
 * @returns Map of fixture name to temporary path.
 */
export async function createTempFixtures(
  fixtures: Record<string, string>,
  cleanupHook?: (cleanup: () => Promise<void>) => void,
): Promise<Record<string, string>> {
  const tempFixtures = Object.create(null) as Record<string, string>
  const tempDirs: string[] = []

  for (const [name, fixturePath] of Object.entries(fixtures)) {
    // eslint-disable-next-line no-await-in-loop
    const tempDir = await createTempFixture(fixturePath)
    tempFixtures[name] = tempDir
    tempDirs.push(tempDir)
  }

  // Register cleanup for all temp directories.
  if (cleanupHook) {
    cleanupHook(async () => {
      await Promise.all(
        tempDirs.map(dir =>
          safeDelete(dir).catch(() => {
            // Ignore cleanup errors.
          }),
        ),
      )
    })
  }

  return tempFixtures
}

/**
 * Helper to create a temporary fixture with automatic cleanup in afterEach.
 * Designed for use in test suites that use afterEach hooks.
 *
 * @param fixturePath - Path to the fixture directory.
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
