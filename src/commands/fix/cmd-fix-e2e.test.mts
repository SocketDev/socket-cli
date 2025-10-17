import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { describe, expect } from 'vitest'

import { logger } from '@socketsecurity/registry/lib/logger'

import { cmdit, spawnSocketCli, testPath } from '../../../test/utils.mts'
import constants, { FLAG_ID } from '../../constants.mts'

const fixtureBaseDir = path.join(testPath, 'fixtures/commands/fix')

/**
 * Get environment variables for E2E test subprocess.
 * Includes API token and explicitly unsets proxy variables that Vitest sets.
 */
function getTestEnv(apiToken: string): Record<string, string | undefined> {
  return {
    SOCKET_CLI_API_TOKEN: apiToken,
    // Vitest sets HTTP_PROXY/HTTPS_PROXY for internal use, but we need to unset them
    // for E2E tests to hit the real Socket API directly.
    HTTP_PROXY: undefined,
    HTTPS_PROXY: undefined,
    http_proxy: undefined,
    https_proxy: undefined,
    SOCKET_CLI_API_PROXY: undefined,
  }
}

/**
 * Create a temporary copy of a fixture directory for testing.
 * This allows tests to modify the fixture without affecting the original.
 */
async function createTempFixtureCopy(
  fixtureName: string,
): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const sourceDir = path.join(fixtureBaseDir, fixtureName)
  const tempDir = path.join(fixtureBaseDir, `${fixtureName}-temp-${Date.now()}`)

  await fs.cp(sourceDir, tempDir, { recursive: true })

  return {
    path: tempDir,
    cleanup: async () => {
      try {
        await fs.rm(tempDir, { force: true, recursive: true })
      } catch (e) {
        logger.warn(`Failed to clean up temp dir ${tempDir}:`, e)
      }
    },
  }
}

/**
 * Read and parse package.json from a directory.
 */
async function readPackageJson(dir: string): Promise<{
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}> {
  const packageJsonPath = path.join(dir, 'package.json')
  const content = await fs.readFile(packageJsonPath, 'utf8')
  return JSON.parse(content)
}

/**
 * Read requirements.txt from a directory.
 */
async function readRequirementsTxt(dir: string): Promise<string[]> {
  const requirementsPath = path.join(dir, 'requirements.txt')
  const content = await fs.readFile(requirementsPath, 'utf8')
  return content
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
}

/**
 * Extract version from a dependency string.
 * Examples:
 *   "^1.2.3" -> "1.2.3"
 *   "~4.17.20" -> "4.17.20"
 *   "4.17.20" -> "4.17.20"
 */
function extractVersion(versionStr: string): string {
  return versionStr.replace(/^[\^~>=<]/, '').trim()
}

/**
 * Compare two semantic versions.
 * Returns:
 *   1 if v1 > v2
 *   0 if v1 === v2
 *  -1 if v1 < v2
 */
function compareVersions(v1: string, v2: string): number {
  const v1Parts = v1.split('.').map(Number)
  const v2Parts = v2.split('.').map(Number)
  const maxLength = Math.max(v1Parts.length, v2Parts.length)

  for (let i = 0; i < maxLength; i += 1) {
    const v1Part = v1Parts[i] || 0
    const v2Part = v2Parts[i] || 0

    if (v1Part > v2Part) {
      return 1
    }
    if (v1Part < v2Part) {
      return -1
    }
  }

  return 0
}

describe('socket fix (E2E tests)', async () => {
  const { binCliPath } = constants
  const testTimeout = 120_000
  const apiToken = process.env['SOCKET_CLI_API_TOKEN']

  if (!apiToken) {
    logger.warn(
      'Skipping E2E tests: SOCKET_CLI_API_TOKEN environment variable not set',
    )
    return
  }

  describe('JavaScript projects', () => {
    cmdit(
      ['fix', '.'],
      'should fix all vulnerabilities in JavaScript project',
      async cmd => {
        const tempFixture = await createTempFixtureCopy('e2e-test-js')

        try {
          const beforePkg = await readPackageJson(tempFixture.path)
          const beforeLodashVersion = beforePkg.dependencies?.['lodash']

          expect(beforeLodashVersion).toBe('4.17.20')

          const { code, stderr, stdout } = await spawnSocketCli(
            binCliPath,
            cmd,
            {
              cwd: tempFixture.path,
              env: getTestEnv(apiToken),
            },
          )

          if (code !== 0) {
            logger.error(`Command failed with code ${code}`)
            logger.error('stdout:', stdout)
            logger.error('stderr:', stderr)
          }

          expect(code, 'should exit with code 0').toBe(0)

          const afterPkg = await readPackageJson(tempFixture.path)
          const afterLodashVersion = afterPkg.dependencies?.['lodash']

          expect(afterLodashVersion).toBeDefined()

          const beforeVersion = extractVersion(beforeLodashVersion!)
          const afterVersion = extractVersion(afterLodashVersion!)
          const comparison = compareVersions(afterVersion, beforeVersion)

          expect(
            comparison,
            `lodash should be upgraded from ${beforeVersion} to ${afterVersion}`,
          ).toBeGreaterThan(0)

          expect(
            existsSync(path.join(tempFixture.path, 'package-lock.json')),
            'package-lock.json should exist',
          ).toBe(true)

          logger.info(
            `\nSuccessfully upgraded lodash from ${beforeVersion} to ${afterVersion}`,
          )
        } finally {
          await tempFixture.cleanup()
        }
      },
      { timeout: testTimeout },
    )

    cmdit(
      ['fix', '--output-file', 'socket-fix-output.json', '.'],
      'should fix vulnerabilities and write output file with fixes result',
      async cmd => {
        const tempFixture = await createTempFixtureCopy('e2e-test-js')

        try {
          const beforePkg = await readPackageJson(tempFixture.path)
          const beforeLodashVersion = beforePkg.dependencies?.['lodash']

          expect(beforeLodashVersion).toBe('4.17.20')

          const outputFilePath = path.join(
            tempFixture.path,
            'socket-fix-output.json',
          )

          const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
            cwd: tempFixture.path,
            env: getTestEnv(apiToken),
          })

          if (code !== 0) {
            logger.error(`Command failed with code ${code}`)
            logger.error('stdout:', stdout)
            logger.error('stderr:', stderr)
          }

          expect(code, 'should exit with code 0').toBe(0)

          const afterPkg = await readPackageJson(tempFixture.path)
          const afterLodashVersion = afterPkg.dependencies?.['lodash']

          expect(afterLodashVersion).toBeDefined()

          const beforeVersion = extractVersion(beforeLodashVersion!)
          const afterVersion = extractVersion(afterLodashVersion!)
          const comparison = compareVersions(afterVersion, beforeVersion)

          expect(
            comparison,
            `lodash should be upgraded from ${beforeVersion} to ${afterVersion}`,
          ).toBeGreaterThan(0)

          // Verify that the output file exists and contains valid JSON.
          expect(existsSync(outputFilePath), 'output file should exist').toBe(
            true,
          )

          const outputContent = await fs.readFile(outputFilePath, 'utf8')
          const outputJson = JSON.parse(outputContent)

          // Verify that the output contains fix result data, not just { fixed: true }.
          expect(outputJson).toBeDefined()
          expect(typeof outputJson).toBe('object')

          // The output should contain at least some structure indicating fixes were performed.
          // We can't assert exact structure as it depends on Coana's output format,
          // but we can verify it's not empty and is more than just a boolean.
          expect(Object.keys(outputJson).length).toBeGreaterThan(0)

          logger.info(
            `\nSuccessfully upgraded lodash from ${beforeVersion} to ${afterVersion} and wrote output file`,
          )
        } finally {
          await tempFixture.cleanup()
        }
      },
      { timeout: testTimeout },
    )

    cmdit(
      ['fix', FLAG_ID, 'GHSA-35jh-r3h4-6jhm', '.'],
      'should fix specific GHSA vulnerability in JavaScript project',
      async cmd => {
        const tempFixture = await createTempFixtureCopy('e2e-test-js')

        try {
          const beforePkg = await readPackageJson(tempFixture.path)
          const beforeLodashVersion = beforePkg.dependencies?.['lodash']

          expect(beforeLodashVersion).toBe('4.17.20')

          const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
            cwd: tempFixture.path,
            env: getTestEnv(apiToken),
          })

          if (code !== 0) {
            logger.error(`Command failed with code ${code}`)
            logger.error('stdout:', stdout)
            logger.error('stderr:', stderr)
          }

          expect(code, 'should exit with code 0').toBe(0)

          const afterPkg = await readPackageJson(tempFixture.path)
          const afterLodashVersion = afterPkg.dependencies?.['lodash']

          expect(afterLodashVersion).toBeDefined()

          const beforeVersion = extractVersion(beforeLodashVersion!)
          const afterVersion = extractVersion(afterLodashVersion!)
          const comparison = compareVersions(afterVersion, beforeVersion)

          expect(
            comparison,
            `lodash should be upgraded from ${beforeVersion} to ${afterVersion}`,
          ).toBeGreaterThan(0)

          logger.info(
            `\nSuccessfully fixed GHSA-35jh-r3h4-6jhm by upgrading lodash from ${beforeVersion} to ${afterVersion}`,
          )
        } finally {
          await tempFixture.cleanup()
        }
      },
      { timeout: testTimeout },
    )

    cmdit(
      ['fix', FLAG_ID, 'CVE-2021-23337', '.'],
      'should convert CVE to GHSA and fix JavaScript project',
      async cmd => {
        const tempFixture = await createTempFixtureCopy('e2e-test-js')

        try {
          const beforePkg = await readPackageJson(tempFixture.path)
          const beforeLodashVersion = beforePkg.dependencies?.['lodash']

          expect(beforeLodashVersion).toBe('4.17.20')

          const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
            cwd: tempFixture.path,
            env: getTestEnv(apiToken),
          })

          if (code !== 0) {
            logger.error(`Command failed with code ${code}`)
            logger.error('stdout:', stdout)
            logger.error('stderr:', stderr)
          }

          expect(code, 'should exit with code 0').toBe(0)

          const afterPkg = await readPackageJson(tempFixture.path)
          const afterLodashVersion = afterPkg.dependencies?.['lodash']

          expect(afterLodashVersion).toBeDefined()

          const beforeVersion = extractVersion(beforeLodashVersion!)
          const afterVersion = extractVersion(afterLodashVersion!)
          const comparison = compareVersions(afterVersion, beforeVersion)

          expect(
            comparison,
            `lodash should be upgraded from ${beforeVersion} to ${afterVersion}`,
          ).toBeGreaterThan(0)

          logger.info(
            `\nSuccessfully converted CVE-2021-23337 to GHSA and fixed by upgrading lodash from ${beforeVersion} to ${afterVersion}`,
          )
        } finally {
          await tempFixture.cleanup()
        }
      },
      { timeout: testTimeout },
    )
  })

  describe('Python projects', () => {
    cmdit(
      ['fix', '.'],
      'should fix all vulnerabilities in Python project',
      async cmd => {
        const tempFixture = await createTempFixtureCopy('e2e-test-py')

        try {
          const beforeReqs = await readRequirementsTxt(tempFixture.path)
          const beforeDjango = beforeReqs.find(line =>
            line.startsWith('django'),
          )

          expect(beforeDjango).toBeDefined()
          expect(beforeDjango).toContain('3.0.0')

          const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
            cwd: tempFixture.path,
            env: getTestEnv(apiToken),
          })

          if (code !== 0) {
            logger.error(`Command failed with code ${code}`)
            logger.error('stdout:', stdout)
            logger.error('stderr:', stderr)
          }

          expect(code, 'should exit with code 0').toBe(0)

          const afterReqs = await readRequirementsTxt(tempFixture.path)
          const afterDjango = afterReqs.find(line => line.startsWith('django'))

          expect(afterDjango).toBeDefined()

          const beforeMatch = beforeDjango!.match(/django==([0-9.]+)/)
          const afterMatch = afterDjango!.match(/django==([0-9.]+)/)

          expect(beforeMatch).toBeDefined()
          expect(afterMatch).toBeDefined()

          const beforeVersion = beforeMatch![1]!
          const afterVersion = afterMatch![1]!
          const comparison = compareVersions(afterVersion, beforeVersion)

          expect(
            comparison,
            `django should be upgraded from ${beforeVersion} to ${afterVersion}`,
          ).toBeGreaterThan(0)

          logger.info(
            `\nSuccessfully upgraded django from ${beforeVersion} to ${afterVersion}`,
          )
        } finally {
          await tempFixture.cleanup()
        }
      },
      { timeout: testTimeout },
    )
  })
})
