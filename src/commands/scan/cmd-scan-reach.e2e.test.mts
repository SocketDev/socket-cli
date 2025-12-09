import { randomUUID } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect } from 'vitest'

import { logger } from '@socketsecurity/registry/lib/logger'

import { cmdit, spawnSocketCli, testPath } from '../../../test/utils.mts'
import constants from '../../constants.mts'

const fixtureBaseDir = path.join(testPath, 'fixtures/commands/scan')
const systemTmpDir = tmpdir()

// Types for .socket.facts.json structure.
type Vulnerability = {
  ghsaId: string
  severity: string
  range: string
  reachabilityData?: unknown
}

type ReachabilityEntry = {
  type: 'reachable' | 'unreachable' | string
  workspacePath: string
  subprojectPath: string
  affectedPurls?: Array<{ type: string; name: string; version: string }>
  analysisLevel?: string
  matches?: Array<
    Array<{
      package: string
      sourceLocation: {
        start: { line: number; column: number }
        end: { line: number; column: number }
        filename: string
      }
      confidence: number
    }>
  >
}

type ComponentReachability = {
  ghsa_id: string
  reachability: ReachabilityEntry[]
}

type Component = {
  id: string
  name: string
  version: string
  type: string
  direct: boolean
  dev: boolean
  dead: boolean
  dependencies: string[]
  manifestFiles: Array<{ file: string; start: number; end: number }>
  vulnerabilities?: Vulnerability[]
  reachability?: ComponentReachability[]
}

type WorkspaceDiagnostic = {
  subprojectPath: string
  workspacePath: string
  purl_type: string
  diagnostics: {
    sourceFilesDetected: string
    preinstalledDependencies: string
    warnings: Array<{ type: string; message: string; severity: string }>
  }
}

type SocketFactsJson = {
  components: Component[]
  tier1ReachabilityScanId?: string
  workspaceDiagnostics: WorkspaceDiagnostic[]
}

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
 * Uses system temp directory with a unique identifier.
 */
async function createTempFixtureCopy(
  fixtureName: string,
): Promise<{ cleanup: () => Promise<void>; path: string }> {
  const sourceDir = path.join(fixtureBaseDir, fixtureName)
  const uniqueId = randomUUID()
  const tempDir = path.join(
    systemTmpDir,
    `socket-cli-e2e-${fixtureName}-${uniqueId}`,
  )

  await fs.cp(sourceDir, tempDir, { recursive: true })

  return {
    cleanup: async () => {
      try {
        await fs.rm(tempDir, { force: true, recursive: true })
      } catch (e) {
        logger.warn(`Failed to clean up temp dir ${tempDir}:`, e)
      }
    },
    path: tempDir,
  }
}

/**
 * Create a temporary mono project containing multiple fixture subdirectories.
 * This allows testing multi-ecosystem scenarios.
 */
async function createTempMonoProject(
  fixtureNames: string[],
): Promise<{ cleanup: () => Promise<void>; path: string }> {
  const uniqueId = randomUUID()
  const tempDir = path.join(systemTmpDir, `socket-cli-e2e-mono-${uniqueId}`)

  await fs.mkdir(tempDir, { recursive: true })

  // Copy each fixture into a subdirectory.
  await Promise.all(
    fixtureNames.map(async fixtureName => {
      const sourceDir = path.join(fixtureBaseDir, fixtureName)
      const destDir = path.join(tempDir, fixtureName)
      await fs.cp(sourceDir, destDir, { recursive: true })
    }),
  )

  return {
    cleanup: async () => {
      try {
        await fs.rm(tempDir, { force: true, recursive: true })
      } catch (e) {
        logger.warn(`Failed to clean up temp dir ${tempDir}:`, e)
      }
    },
    path: tempDir,
  }
}

/**
 * Read and parse the .socket.facts.json file from a directory.
 */
async function readSocketFactsJson(dir: string): Promise<SocketFactsJson> {
  const factsPath = path.join(dir, constants.DOT_SOCKET_DOT_FACTS_JSON)
  const content = await fs.readFile(factsPath, 'utf8')
  return JSON.parse(content) as SocketFactsJson
}

/**
 * Get components that have vulnerabilities.
 */
function getVulnerableComponents(facts: SocketFactsJson): Component[] {
  return facts.components.filter(
    c => c.vulnerabilities && c.vulnerabilities.length > 0,
  )
}

/**
 * Get all unique GHSA IDs from vulnerable components.
 */
function getAllGhsaIds(facts: SocketFactsJson): string[] {
  const ghsaIds = new Set<string>()
  for (const component of facts.components) {
    if (component.vulnerabilities) {
      for (const vuln of component.vulnerabilities) {
        ghsaIds.add(vuln.ghsaId)
      }
    }
  }
  return [...ghsaIds].sort()
}

/**
 * Find a component by name and version.
 */
function findComponent(
  facts: SocketFactsJson,
  name: string,
  version: string,
): Component | undefined {
  return facts.components.find(c => c.name === name && c.version === version)
}

/**
 * Find reachability entry for a specific GHSA ID and workspace path.
 */
function findReachabilityForGhsa(
  component: Component,
  ghsaId: string,
  workspacePath: string,
): ReachabilityEntry | undefined {
  if (!component.reachability) {
    return undefined
  }
  const ghsaReachability = component.reachability.find(
    r => r.ghsa_id === ghsaId,
  )
  if (!ghsaReachability) {
    return undefined
  }
  return ghsaReachability.reachability.find(
    r => r.workspacePath === workspacePath,
  )
}

/**
 * Helper to log command output for debugging.
 * Logs stdout and stderr to help diagnose test failures.
 */
function logCommandOutput(code: number, stdout: string, stderr: string): void {
  logger.error(`Command failed with code ${code}`)
  logger.error('stdout:', stdout)
  logger.error('stderr:', stderr)
}

describe('socket scan reach (E2E tests)', async () => {
  const { binCliPath } = constants
  // Standard timeout for most tests.
  const testTimeout = 120_000
  // Longer timeout for full workspace scans which are more resource-intensive.
  const longTestTimeout = 300_000
  const apiToken = process.env['SOCKET_CLI_API_TOKEN']
  const orgSlug = process.env['SOCKET_ORG'] ?? 'SocketDev'

  if (!apiToken) {
    throw new Error('SOCKET_CLI_API_TOKEN environment variable not set')
  }

  describe('npm-test-workspace-mono', () => {
    cmdit(
      ['scan', 'reach', '.', '--no-interactive', '--reach-disable-analytics'],
      'should run reachability analysis on workspace mono project',
      async cmd => {
        const tempFixture = await createTempFixtureCopy(
          'npm-test-workspace-mono',
        )
        let stdout = ''
        let stderr = ''
        let code = -1

        try {
          const result = await spawnSocketCli(
            binCliPath,
            [...cmd, '--org', orgSlug],
            {
              cwd: tempFixture.path,
              env: getTestEnv(apiToken),
            },
          )
          stdout = result.stdout
          stderr = result.stderr
          code = result.code

          if (code !== 0) {
            logCommandOutput(code, stdout, stderr)
          }

          expect(code, 'should exit with code 0').toBe(0)

          // Verify the .socket.facts.json file was created.
          const factsPath = path.join(
            tempFixture.path,
            constants.DOT_SOCKET_DOT_FACTS_JSON,
          )
          expect(existsSync(factsPath), '.socket.facts.json should exist').toBe(
            true,
          )

          // Read and validate the facts file structure.
          const facts = await readSocketFactsJson(tempFixture.path)

          // Verify top-level structure.
          expect(facts).toHaveProperty('components')
          expect(facts).toHaveProperty('workspaceDiagnostics')
          expect(Array.isArray(facts.components)).toBe(true)
          expect(Array.isArray(facts.workspaceDiagnostics)).toBe(true)

          // Verify workspace diagnostics includes all 3 subprojects.
          const subprojectPaths = facts.workspaceDiagnostics.map(
            d => d.subprojectPath,
          )
          expect(subprojectPaths).toContain('.')
          expect(subprojectPaths).toContain('packages/package-a')
          expect(subprojectPaths).toContain('packages/package-b')
          expect(facts.workspaceDiagnostics).toHaveLength(3)

          // Verify components count is reasonable (should be > 100 for this workspace).
          expect(facts.components.length).toBeGreaterThan(100)

          // Verify vulnerable components are detected.
          const vulnerableComponents = getVulnerableComponents(facts)
          expect(
            vulnerableComponents.length,
            'should detect vulnerable components',
          ).toBeGreaterThan(0)

          // Verify specific known vulnerabilities are detected.
          const ghsaIds = getAllGhsaIds(facts)

          // lodash@3.10.1 in package-b should have GHSA-fvqr-27wr-82fm.
          expect(ghsaIds).toContain('GHSA-fvqr-27wr-82fm')

          // Verify lodash@3.10.1 is present and has vulnerabilities.
          const lodash3 = findComponent(facts, 'lodash', '3.10.1')
          expect(lodash3, 'lodash@3.10.1 should be present').toBeDefined()
          expect(
            lodash3?.vulnerabilities?.length,
            'lodash@3.10.1 should have vulnerabilities',
          ).toBeGreaterThan(0)

          // Verify reachability analysis was performed on lodash@3.10.1.
          expect(
            lodash3?.reachability,
            'lodash@3.10.1 should have reachability data',
          ).toBeDefined()
          expect(
            lodash3?.reachability?.length,
            'lodash@3.10.1 should have reachability entries',
          ).toBeGreaterThan(0)

          // Verify GHSA-fvqr-27wr-82fm is reachable in packages/package-b.
          const ghsaFvqrReachabilityPkgB = findReachabilityForGhsa(
            lodash3!,
            'GHSA-fvqr-27wr-82fm',
            'packages/package-b',
          )
          expect(
            ghsaFvqrReachabilityPkgB,
            'GHSA-fvqr-27wr-82fm should have reachability data for packages/package-b',
          ).toBeDefined()
          expect(
            ghsaFvqrReachabilityPkgB?.type,
            'GHSA-fvqr-27wr-82fm should be reachable in packages/package-b',
          ).toBe('reachable')
          expect(ghsaFvqrReachabilityPkgB?.analysisLevel).toBe('function-level')
          expect(ghsaFvqrReachabilityPkgB?.matches).toBeDefined()

          // Verify GHSA-35jh-r3h4-6jhm is unreachable in packages/package-b.
          const ghsaFvqrReachabilityPkgA = findReachabilityForGhsa(
            lodash3!,
            'GHSA-35jh-r3h4-6jhm',
            'packages/package-b',
          )
          expect(
            ghsaFvqrReachabilityPkgA,
            'GHSA-35jh-r3h4-6jhm should have reachability data for packages/package-b',
          ).toBeDefined()
          expect(
            ghsaFvqrReachabilityPkgA?.type,
            'GHSA-35jh-r3h4-6jhm should be unreachable in packages/package-b',
          ).toBe('unreachable')

          // Verify component structure.
          for (const component of facts.components.slice(0, 5)) {
            expect(component).toHaveProperty('id')
            expect(component).toHaveProperty('name')
            expect(component).toHaveProperty('version')
            expect(component).toHaveProperty('type')
            expect(component.type).toBe('npm')
          }

          logger.info('\nReachability analysis completed successfully')
        } catch (e) {
          if (code !== 0) {
            logCommandOutput(code, stdout, stderr)
          }
          throw e
        } finally {
          await tempFixture.cleanup()
        }
      },
      { timeout: longTestTimeout },
    )

    cmdit(
      [
        'scan',
        'reach',
        '.',
        '--no-interactive',
        '--reach-disable-analytics',
        '--reach-exclude-paths',
        'packages/package-b',
      ],
      'should run reachability analysis with excluded paths',
      async cmd => {
        const tempFixture = await createTempFixtureCopy(
          'npm-test-workspace-mono',
        )
        let stdout = ''
        let stderr = ''
        let code = -1

        try {
          const result = await spawnSocketCli(
            binCliPath,
            [...cmd, '--org', orgSlug],
            {
              cwd: tempFixture.path,
              env: getTestEnv(apiToken),
            },
          )
          stdout = result.stdout
          stderr = result.stderr
          code = result.code

          if (code !== 0) {
            logCommandOutput(code, stdout, stderr)
          }

          expect(code, 'should exit with code 0').toBe(0)

          // Verify the .socket.facts.json file was created.
          const factsPath = path.join(
            tempFixture.path,
            constants.DOT_SOCKET_DOT_FACTS_JSON,
          )
          expect(existsSync(factsPath), '.socket.facts.json should exist').toBe(
            true,
          )

          // Read and validate the facts file structure.
          const facts = await readSocketFactsJson(tempFixture.path)

          // Verify top-level structure.
          expect(facts).toHaveProperty('components')
          expect(facts).toHaveProperty('workspaceDiagnostics')
          expect(Array.isArray(facts.components)).toBe(true)
          expect(Array.isArray(facts.workspaceDiagnostics)).toBe(true)

          // Note: --reach-exclude-paths excludes paths from analysis but the
          // workspaceDiagnostics may still list all discovered workspaces.
          // The key difference is in the reachability analysis results.

          // Verify we still have components (analysis ran successfully).
          expect(facts.components.length).toBeGreaterThan(50)

          // Verify lodash@3.10.1 (from package-b) exists but should have
          // different reachability data when package-b is excluded from analysis.
          const lodash = findComponent(facts, 'lodash', '3.10.1')
          if (lodash) {
            // If lodash is present, verify it has the expected structure.
            expect(lodash).toHaveProperty('name', 'lodash')
            expect(lodash).toHaveProperty('version', '3.10.1')
          }

          // Verify component structure for sampled components.
          for (const component of facts.components.slice(0, 5)) {
            expect(component).toHaveProperty('id')
            expect(component).toHaveProperty('name')
            expect(component).toHaveProperty('version')
            expect(component).toHaveProperty('type')
            expect(component.type).toBe('npm')
          }

          logger.info(
            '\nReachability analysis with excluded paths completed successfully',
          )
        } catch (e) {
          if (code !== 0) {
            logCommandOutput(code, stdout, stderr)
          }
          throw e
        } finally {
          await tempFixture.cleanup()
        }
      },
      { timeout: testTimeout },
    )
  })

  describe('target and cwd flags', () => {
    cmdit(
      [
        'scan',
        'reach',
        'packages/package-a',
        '--no-interactive',
        '--reach-disable-analytics',
      ],
      'should only scan files within the target directory',
      async cmd => {
        const tempFixture = await createTempFixtureCopy(
          'npm-test-workspace-mono',
        )
        let stdout = ''
        let stderr = ''
        let code = -1

        try {
          const result = await spawnSocketCli(
            binCliPath,
            [...cmd, '--org', orgSlug],
            {
              cwd: tempFixture.path,
              env: getTestEnv(apiToken),
            },
          )
          stdout = result.stdout
          stderr = result.stderr
          code = result.code

          if (code !== 0) {
            logCommandOutput(code, stdout, stderr)
          }

          expect(code, 'should exit with code 0').toBe(0)

          // Verify the .socket.facts.json file was created.
          const factsPath = path.join(
            tempFixture.path,
            constants.DOT_SOCKET_DOT_FACTS_JSON,
          )
          expect(existsSync(factsPath), '.socket.facts.json should exist').toBe(
            true,
          )

          // Read and validate the facts file structure.
          const facts = await readSocketFactsJson(tempFixture.path)

          // Verify top-level structure.
          expect(facts).toHaveProperty('components')
          expect(facts).toHaveProperty('workspaceDiagnostics')

          // When target is packages/package-a, only that subproject should be analyzed.
          // The workspaceDiagnostics should only include package-a, not package-b or root.
          const subprojectPaths = facts.workspaceDiagnostics.map(
            d => d.subprojectPath,
          )
          expect(
            subprojectPaths,
            'should have . representing the package-a subproject',
          ).toContain('.')
          expect(
            subprojectPaths,
            'should NOT have packages/package-b when targeting package-a',
          ).not.toContain('packages/package-b')
          expect(
            subprojectPaths,
            "should NOT have packages/package-a since it's represented by the . subproject",
          ).not.toContain('packages/package-a')

          // Verify we have components.
          expect(
            facts.components.length,
            'should have components from package-a',
          ).toBeGreaterThan(0)

          // When targeting packages/package-a, we should NOT find lodash@3.10.1
          // which is only a dependency of package-b (not package-a).
          // package-a depends on lodash@4, not lodash@3.10.1.
          const lodash3 = findComponent(facts, 'lodash', '3.10.1')
          expect(
            lodash3,
            'lodash@3.10.1 (from package-b) should NOT be present when targeting package-a',
          ).toBeUndefined()

          // package-a depends on lodash@4, so we should find a lodash version starting with 4.
          const lodash4Components = facts.components.filter(
            c => c.name === 'lodash' && c.version.startsWith('4'),
          )
          expect(
            lodash4Components.length,
            'should have lodash@4.x from package-a',
          ).toBeGreaterThan(0)

          logger.info(
            '\nReachability analysis with target restriction completed successfully',
          )
        } catch (e) {
          if (code !== 0) {
            logCommandOutput(code, stdout, stderr)
          }
          throw e
        } finally {
          await tempFixture.cleanup()
        }
      },
      { timeout: testTimeout },
    )

    cmdit(
      ['scan', 'reach', '.', '--no-interactive', '--reach-disable-analytics'],
      'should use --cwd to set the working directory',
      async cmd => {
        const tempFixture = await createTempFixtureCopy(
          'npm-test-workspace-mono',
        )
        let stdout = ''
        let stderr = ''
        let code = -1

        try {
          // Run from system temp dir but point --cwd to the fixture.
          const result = await spawnSocketCli(
            binCliPath,
            [...cmd, '--org', orgSlug, '--cwd', tempFixture.path],
            {
              cwd: systemTmpDir,
              env: getTestEnv(apiToken),
            },
          )
          stdout = result.stdout
          stderr = result.stderr
          code = result.code

          if (code !== 0) {
            logCommandOutput(code, stdout, stderr)
          }

          expect(code, 'should exit with code 0').toBe(0)

          // Verify the .socket.facts.json file was created in the --cwd directory, not process.cwd().
          const factsInCwd = path.join(
            tempFixture.path,
            constants.DOT_SOCKET_DOT_FACTS_JSON,
          )

          expect(
            existsSync(factsInCwd),
            '.socket.facts.json should exist in --cwd directory',
          ).toBe(true)

          // Read and validate the facts file structure.
          const facts = await readSocketFactsJson(tempFixture.path)

          // Verify all workspace subprojects are found when using --cwd.
          const subprojectPaths = facts.workspaceDiagnostics.map(
            d => d.subprojectPath,
          )
          expect(subprojectPaths).toContain('.')
          expect(subprojectPaths).toContain('packages/package-a')
          expect(subprojectPaths).toContain('packages/package-b')

          // Verify we have components.
          expect(facts.components.length).toBeGreaterThan(100)

          logger.info(
            '\nReachability analysis with --cwd flag completed successfully',
          )
        } catch (e) {
          if (code !== 0) {
            logCommandOutput(code, stdout, stderr)
          }
          throw e
        } finally {
          await tempFixture.cleanup()
        }
      },
      { timeout: testTimeout },
    )

    cmdit(
      [
        'scan',
        'reach',
        'packages/package-b',
        '--no-interactive',
        '--reach-disable-analytics',
      ],
      'should work with --cwd and target together',
      async cmd => {
        const tempFixture = await createTempFixtureCopy(
          'npm-test-workspace-mono',
        )
        let stdout = ''
        let stderr = ''
        let code = -1

        try {
          // Run from system temp dir but point --cwd to the fixture.
          // Target is relative to --cwd.
          const result = await spawnSocketCli(
            binCliPath,
            [...cmd, '--org', orgSlug, '--cwd', tempFixture.path],
            {
              cwd: systemTmpDir,
              env: getTestEnv(apiToken),
            },
          )
          stdout = result.stdout
          stderr = result.stderr
          code = result.code

          if (code !== 0) {
            logCommandOutput(code, stdout, stderr)
          }

          expect(code, 'should exit with code 0').toBe(0)

          // Verify the .socket.facts.json file was created in the --cwd directory.
          const factsPath = path.join(
            tempFixture.path,
            constants.DOT_SOCKET_DOT_FACTS_JSON,
          )
          expect(
            existsSync(factsPath),
            '.socket.facts.json should exist in --cwd directory',
          ).toBe(true)

          // Read and validate the facts file structure.
          const facts = await readSocketFactsJson(tempFixture.path)

          // When target is packages/package-b with --cwd, only that subproject should be analyzed.
          const subprojectPaths = facts.workspaceDiagnostics.map(
            d => d.subprojectPath,
          )
          expect(
            subprojectPaths,
            'should have . representing the package-b subproject',
          ).toContain('.')
          expect(
            subprojectPaths,
            'should NOT have packages/package-a when targeting package-b',
          ).not.toContain('packages/package-a')
          expect(
            subprojectPaths,
            "should NOT have packages/package-b since it's represented by the . subproject",
          ).not.toContain('packages/package-b')

          // Verify we have components.
          expect(
            facts.components.length,
            'should have components when using --cwd and target together',
          ).toBeGreaterThan(0)

          // Verify lodash@3.10.1 (from package-b) IS present.
          // This confirms that package-b was scanned when using target with --cwd.
          const lodash3 = findComponent(facts, 'lodash', '3.10.1')
          expect(
            lodash3,
            'lodash@3.10.1 should be present when targeting package-b',
          ).toBeDefined()

          logger.info(
            '\nReachability analysis with --cwd and target completed successfully',
          )
        } catch (e) {
          if (code !== 0) {
            logCommandOutput(code, stdout, stderr)
          }
          throw e
        } finally {
          await tempFixture.cleanup()
        }
      },
      { timeout: testTimeout },
    )

    cmdit(
      [
        'scan',
        'reach',
        '../outside-dir',
        '--no-interactive',
        '--reach-disable-analytics',
      ],
      'should fail when target is outside cwd',
      async cmd => {
        const tempFixture = await createTempFixtureCopy(
          'npm-test-workspace-mono',
        )
        let code = -1

        try {
          const result = await spawnSocketCli(
            binCliPath,
            [...cmd, '--org', orgSlug],
            {
              cwd: tempFixture.path,
              env: getTestEnv(apiToken),
            },
          )
          code = result.code

          // Should fail with a non-zero exit code.
          expect(
            code,
            'should exit with non-zero code when target is outside cwd',
          ).not.toBe(0)

          // Verify no .socket.facts.json file was created.
          const factsPath = path.join(
            tempFixture.path,
            constants.DOT_SOCKET_DOT_FACTS_JSON,
          )
          expect(
            existsSync(factsPath),
            '.socket.facts.json should NOT exist when target validation fails',
          ).toBe(false)

          // Check that the error message mentions the target constraint.
          expect(
            result.stderr + result.stdout,
            'should mention target must be inside working directory',
          ).toMatch(/inside.*working|working.*directory|target.*directory/i)

          logger.info('\nTarget outside cwd correctly rejected')
        } finally {
          await tempFixture.cleanup()
        }
      },
      { timeout: testTimeout },
    )

    cmdit(
      ['scan', 'reach', '.', '--no-interactive', '--reach-disable-analytics'],
      'should write output to cwd when running from subdirectory',
      async cmd => {
        const tempFixture = await createTempFixtureCopy(
          'npm-test-workspace-mono',
        )
        let stdout = ''
        let stderr = ''
        let code = -1

        try {
          // Run from packages/package-a subdirectory with target '.'.
          const targetPath = path.join(tempFixture.path, 'packages/package-a')
          const result = await spawnSocketCli(
            binCliPath,
            [...cmd, '--org', orgSlug],
            {
              cwd: targetPath,
              env: getTestEnv(apiToken),
            },
          )
          stdout = result.stdout
          stderr = result.stderr
          code = result.code

          if (code !== 0) {
            logCommandOutput(code, stdout, stderr)
          }

          expect(code, 'should exit with code 0').toBe(0)

          // Verify the .socket.facts.json file was created in the cwd (packages/package-a).
          const factsPath = path.join(
            targetPath,
            constants.DOT_SOCKET_DOT_FACTS_JSON,
          )
          expect(
            existsSync(factsPath),
            '.socket.facts.json should exist in cwd directory',
          ).toBe(true)

          // Read and validate the facts file structure.
          const facts = await readSocketFactsJson(targetPath)

          // When running from packages/package-a subdirectory with target '.', the
          // workspaceDiagnostics should show '.' as the subprojectPath.
          const subprojectPaths = facts.workspaceDiagnostics.map(
            d => d.subprojectPath,
          )
          expect(
            subprojectPaths,
            'should have current directory as subproject',
          ).toContain('.')
          expect(
            facts.workspaceDiagnostics.length,
            'should only have one workspace diagnostic entry',
          ).toBe(1)

          // Verify we have components.
          expect(
            facts.components.length,
            'should have components',
          ).toBeGreaterThan(0)

          logger.info(
            '\nReachability analysis output location verified successfully',
          )
        } catch (e) {
          if (code !== 0) {
            logCommandOutput(code, stdout, stderr)
          }
          throw e
        } finally {
          await tempFixture.cleanup()
        }
      },
      { timeout: testTimeout },
    )
  })

  describe('multi-ecosystem filtering', () => {
    cmdit(
      [
        'scan',
        'reach',
        '.',
        '--no-interactive',
        '--reach-ecosystems',
        'pypi',
        '--reach-disable-analytics',
      ],
      'should only analyze pypi ecosystem when --reach-ecosystems pypi is specified',
      async cmd => {
        // Create a mono project with both npm and pypi projects.
        const tempFixture = await createTempMonoProject([
          'simple-npm',
          'plain-requirements-txt',
        ])
        let stdout = ''
        let stderr = ''
        let code = -1

        try {
          const result = await spawnSocketCli(
            binCliPath,
            [...cmd, '--org', orgSlug],
            {
              cwd: tempFixture.path,
              env: getTestEnv(apiToken),
            },
          )
          stdout = result.stdout
          stderr = result.stderr
          code = result.code

          if (code !== 0) {
            logCommandOutput(code, stdout, stderr)
          }

          expect(code, 'should exit with code 0').toBe(0)

          // Verify the .socket.facts.json file was created.
          const factsPath = path.join(
            tempFixture.path,
            constants.DOT_SOCKET_DOT_FACTS_JSON,
          )
          expect(existsSync(factsPath), '.socket.facts.json should exist').toBe(
            true,
          )

          // Read and validate the facts file structure.
          const facts = await readSocketFactsJson(tempFixture.path)

          // Verify top-level structure.
          expect(facts).toHaveProperty('components')
          expect(facts).toHaveProperty('workspaceDiagnostics')
          expect(Array.isArray(facts.components)).toBe(true)

          // Note: --reach-ecosystems controls which ecosystems get reachability
          // analysis, but all components are still discovered. The key is that
          // only pypi workspaces should have analysis performed.

          // Verify we have components from both ecosystems (discovery still happens).
          const componentTypes = new Set(facts.components.map(c => c.type))
          expect(facts.components.length).toBeGreaterThan(0)

          // Verify workspaceDiagnostics includes pypi workspaces.
          const pypiWorkspaces = facts.workspaceDiagnostics.filter(
            d => d.purl_type === 'pypi',
          )
          expect(
            pypiWorkspaces.length,
            'should have pypi workspaces',
          ).toBeGreaterThan(0)

          // If we have pypi components, verify their structure.
          if (componentTypes.has('pypi')) {
            const pypiComponents = facts.components.filter(
              c => c.type === 'pypi',
            )
            for (const component of pypiComponents.slice(0, 3)) {
              expect(component).toHaveProperty('name')
              expect(component).toHaveProperty('version')
              expect(component.type).toBe('pypi')
            }
          }

          logger.info(
            '\nReachability analysis with pypi ecosystem filter completed successfully',
          )
        } catch (e) {
          if (code !== 0) {
            logCommandOutput(code, stdout, stderr)
          }
          throw e
        } finally {
          await tempFixture.cleanup()
        }
      },
      { timeout: testTimeout },
    )

    cmdit(
      [
        'scan',
        'reach',
        '.',
        '--no-interactive',
        '--reach-ecosystems',
        'npm',
        '--reach-disable-analytics',
      ],
      'should only analyze npm ecosystem when --reach-ecosystems npm is specified',
      async cmd => {
        // Create a mono project with both npm and pypi projects.
        const tempFixture = await createTempMonoProject([
          'simple-npm',
          'plain-requirements-txt',
        ])
        let stdout = ''
        let stderr = ''
        let code = -1

        try {
          const result = await spawnSocketCli(
            binCliPath,
            [...cmd, '--org', orgSlug],
            {
              cwd: tempFixture.path,
              env: getTestEnv(apiToken),
            },
          )
          stdout = result.stdout
          stderr = result.stderr
          code = result.code

          if (code !== 0) {
            logCommandOutput(code, stdout, stderr)
          }

          expect(code, 'should exit with code 0').toBe(0)

          // Verify the .socket.facts.json file was created.
          const factsPath = path.join(
            tempFixture.path,
            constants.DOT_SOCKET_DOT_FACTS_JSON,
          )
          expect(existsSync(factsPath), '.socket.facts.json should exist').toBe(
            true,
          )

          // Read and validate the facts file structure.
          const facts = await readSocketFactsJson(tempFixture.path)

          // Verify top-level structure.
          expect(facts).toHaveProperty('components')
          expect(facts).toHaveProperty('workspaceDiagnostics')
          expect(Array.isArray(facts.components)).toBe(true)

          // Note: --reach-ecosystems controls which ecosystems get reachability
          // analysis, but all components are still discovered. The key is that
          // only npm workspaces should have analysis performed.

          // Verify we have components.
          const componentTypes = new Set(facts.components.map(c => c.type))
          expect(facts.components.length).toBeGreaterThan(0)

          // Verify workspaceDiagnostics includes npm workspaces.
          const npmWorkspaces = facts.workspaceDiagnostics.filter(
            d => d.purl_type === 'npm',
          )
          expect(
            npmWorkspaces.length,
            'should have npm workspaces',
          ).toBeGreaterThan(0)

          // If we have npm components, verify their structure.
          if (componentTypes.has('npm')) {
            const npmComponents = facts.components.filter(c => c.type === 'npm')
            for (const component of npmComponents.slice(0, 3)) {
              expect(component).toHaveProperty('name')
              expect(component).toHaveProperty('version')
              expect(component.type).toBe('npm')
            }
          }

          logger.info(
            '\nReachability analysis with npm ecosystem filter completed successfully',
          )
        } catch (e) {
          if (code !== 0) {
            logCommandOutput(code, stdout, stderr)
          }
          throw e
        } finally {
          await tempFixture.cleanup()
        }
      },
      { timeout: testTimeout },
    )
  })
})
