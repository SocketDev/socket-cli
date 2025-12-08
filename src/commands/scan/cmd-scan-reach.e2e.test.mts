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
  reachability?: Array<{
    ghsa_id: string
    reachability: Array<{
      type: string
      affectedPurls: string[]
      workspacePath: string
      subprojectPath: string
    }>
  }>
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
  const testTimeout = 120_000
  const apiToken = process.env['SOCKET_CLI_API_TOKEN']
  const orgSlug = process.env['SOCKET_ORG'] || 'SocketDev'

  if (!apiToken) {
    logger.warn(
      'Skipping E2E tests: SOCKET_CLI_API_TOKEN environment variable not set',
    )
    return
  }

  describe('npm-test-workspace-mono', () => {
    cmdit(
      ['scan', 'reach', '.', '--no-interactive'],
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

          // lodash@3.10.1 in package-b should have GHSA-35jh-r3h4-6jhm.
          expect(ghsaIds).toContain('GHSA-35jh-r3h4-6jhm')

          // Verify lodash@3.10.1 is present and has vulnerabilities.
          const lodash = findComponent(facts, 'lodash', '3.10.1')
          expect(lodash, 'lodash@3.10.1 should be present').toBeDefined()
          expect(
            lodash?.vulnerabilities?.length,
            'lodash@3.10.1 should have vulnerabilities',
          ).toBeGreaterThan(0)

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
      { timeout: testTimeout },
    )

    cmdit(
      [
        'scan',
        'reach',
        '.',
        '--no-interactive',
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
})
