import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import trash from 'trash'

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
        await trash(tempDir)
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

  for (const { 0: name, 1: fixturePath } of Object.entries(fixtures)) {
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
          trash(dir).catch(() => {
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
      await trash(tempDir)
    } catch {
      // Ignore cleanup errors.
    }
  }

  return { tempDir, cleanup }
}

/**
 * Helper to create a temporary fixture with git repository initialized.
 * Used for tests that require a git repository to function properly.
 *
 * @param fixturePath - Path to the fixture directory.
 * @returns Object with tempDir path and cleanup function.
 */
export async function withTempFixtureGit(fixturePath: string): Promise<{
  tempDir: string
  cleanup: () => Promise<void>
}> {
  const { cleanup, tempDir } = await withTempFixture(fixturePath)

  // Initialize git repo in temp dir for CI tests.
  await new Promise<void>((resolve, reject) => {
    const { spawn } = require('node:child_process')
    const git = spawn('git', ['init'], { cwd: tempDir, stdio: 'ignore' })
    git.on('close', (code: number) =>
      code === 0
        ? resolve()
        : reject(new Error(`git init failed with code ${code}`)),
    )
  })

  return { tempDir, cleanup }
}
