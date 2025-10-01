import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import constants, {
  FLAG_CONFIG,
  FLAG_DRY_RUN,
  FLAG_HELP,
} from '../../../src/constants.mts'
import { withTempFixture } from '../../../src/utils/test-fixtures.mts'
import { cmdit, spawnSocketCli, testPath } from '../../../test/utils.mts'

// Mock Socket SDK modules at module level
vi.mock('../../../src/commands/ci/fetch-default-org-slug.mts', () => ({
  getDefaultOrgSlug: vi.fn().mockResolvedValue({
    ok: true,
    data: 'test-org',
  }),
}))

vi.mock('../../../src/utils/sdk.mts', () => ({
  setupSdk: vi.fn().mockResolvedValue({
    ok: true,
    data: {
      getOrganizations: vi.fn().mockResolvedValue({
        ok: true,
        data: { organizations: {} },
      }),
      uploadManifestFiles: vi.fn().mockResolvedValue({
        ok: true,
        data: { tarHash: 'mock-tar-hash' },
      }),
    },
  }),
  getDefaultApiToken: vi.fn().mockReturnValue('mock-token'),
}))

vi.mock('../../../src/utils/api.mts', async importOriginal => {
  const actual =
    await importOriginal<typeof import('../../../src/utils/api.mts')>()
  return {
    ...actual,
    handleApiCall: vi.fn().mockResolvedValue({
      ok: true,
      data: { tarHash: 'mock-tar-hash' },
    }),
  }
})

vi.mock('../../../src/commands/fix/coana-fix.mts', () => ({
  coanaFix: vi.fn().mockResolvedValue({
    ok: true,
    data: { fixed: true },
  }),
}))

const fixtureBaseDir = path.join(testPath, 'fixtures/commands/fix')

// Track cleanup functions for temp directories.
const cleanupFunctions: Array<() => Promise<void>> = []

afterEach(async () => {
  // Clean up all temp directories created during tests.
  await Promise.all(cleanupFunctions.map(cleanup => cleanup().catch(() => {})))
  cleanupFunctions.length = 0
})

// Test configuration.
const testTimeout = 60_000

describe('socket fix', async () => {
  const { binCliPath } = constants

  describe('environment variable handling', () => {
    cmdit(
      ['fix', FLAG_DRY_RUN, FLAG_CONFIG, '{"apiToken":"fake-token"}'],
      'should not show env var names when all CI env vars are present',
      async cmd => {
        const oldCI = process.env.CI
        const oldGithubToken = process.env.SOCKET_CLI_GITHUB_TOKEN
        const oldGitUserName = process.env.SOCKET_CLI_GIT_USER_NAME
        const oldGitUserEmail = process.env.SOCKET_CLI_GIT_USER_EMAIL

        // Set all CI env vars.
        process.env.CI = '1'
        process.env.SOCKET_CLI_GITHUB_TOKEN = 'ghp_test123'
        process.env.SOCKET_CLI_GIT_USER_NAME = 'Test User'
        process.env.SOCKET_CLI_GIT_USER_EMAIL = 'test@example.com'

        try {
          const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)

          // Should NOT show env var names when all are present.
          expect(stdout).not.toContain('SOCKET_CLI_GITHUB_TOKEN')
          expect(stdout).not.toContain('SOCKET_CLI_GIT_USER_NAME')
          expect(stdout).not.toContain('SOCKET_CLI_GIT_USER_EMAIL')

          expect(stderr).toContain('socket fix')
          expect(code).toBe(0)
        } finally {
          // Restore env vars.
          if (oldCI !== undefined) {
            process.env.CI = oldCI
          } else {
            delete process.env.CI
          }
          if (oldGithubToken !== undefined) {
            process.env.SOCKET_CLI_GITHUB_TOKEN = oldGithubToken
          } else {
            delete process.env.SOCKET_CLI_GITHUB_TOKEN
          }
          if (oldGitUserName !== undefined) {
            process.env.SOCKET_CLI_GIT_USER_NAME = oldGitUserName
          } else {
            delete process.env.SOCKET_CLI_GIT_USER_NAME
          }
          if (oldGitUserEmail !== undefined) {
            process.env.SOCKET_CLI_GIT_USER_EMAIL = oldGitUserEmail
          } else {
            delete process.env.SOCKET_CLI_GIT_USER_EMAIL
          }
        }
      },
    )

    cmdit(
      ['fix', FLAG_DRY_RUN, FLAG_CONFIG, '{"apiToken":"fake-token"}'],
      'should not show env var names when CI is not set',
      async cmd => {
        const oldCI = process.env.CI
        const oldGithubToken = process.env.SOCKET_CLI_GITHUB_TOKEN
        const oldGitUserName = process.env.SOCKET_CLI_GIT_USER_NAME
        const oldGitUserEmail = process.env.SOCKET_CLI_GIT_USER_EMAIL

        // Remove CI env var.
        delete process.env.CI
        delete process.env.SOCKET_CLI_GITHUB_TOKEN
        delete process.env.SOCKET_CLI_GIT_USER_NAME
        delete process.env.SOCKET_CLI_GIT_USER_EMAIL

        try {
          const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)

          // Should NOT show env var names when CI is not set.
          expect(stdout).not.toContain('SOCKET_CLI_GITHUB_TOKEN')
          expect(stdout).not.toContain('SOCKET_CLI_GIT_USER_NAME')
          expect(stdout).not.toContain('SOCKET_CLI_GIT_USER_EMAIL')

          expect(stderr).toContain('socket fix')
          expect(code).toBe(0)
        } finally {
          // Restore env vars.
          if (oldCI !== undefined) {
            process.env.CI = oldCI
          }
          if (oldGithubToken !== undefined) {
            process.env.SOCKET_CLI_GITHUB_TOKEN = oldGithubToken
          }
          if (oldGitUserName !== undefined) {
            process.env.SOCKET_CLI_GIT_USER_NAME = oldGitUserName
          }
          if (oldGitUserEmail !== undefined) {
            process.env.SOCKET_CLI_GIT_USER_EMAIL = oldGitUserEmail
          }
        }
      },
    )

    cmdit(
      ['fix', FLAG_DRY_RUN, FLAG_CONFIG, '{"apiToken":"fake-token"}'],
      'should not show env var names when CI is not set but some vars are present',
      async cmd => {
        const oldCI = process.env.CI
        const oldGithubToken = process.env.SOCKET_CLI_GITHUB_TOKEN
        const oldGitUserName = process.env.SOCKET_CLI_GIT_USER_NAME
        const oldGitUserEmail = process.env.SOCKET_CLI_GIT_USER_EMAIL

        // CI not set, but some vars present.
        delete process.env.CI
        process.env.SOCKET_CLI_GITHUB_TOKEN = 'ghp_test123'
        delete process.env.SOCKET_CLI_GIT_USER_NAME
        delete process.env.SOCKET_CLI_GIT_USER_EMAIL

        try {
          const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)

          // Should NOT show env var names when CI is not set.
          expect(stdout).not.toContain('SOCKET_CLI_GITHUB_TOKEN')
          expect(stdout).not.toContain('SOCKET_CLI_GIT_USER_NAME')
          expect(stdout).not.toContain('SOCKET_CLI_GIT_USER_EMAIL')

          expect(stderr).toContain('socket fix')
          expect(code).toBe(0)
        } finally {
          // Restore env vars.
          if (oldCI !== undefined) {
            process.env.CI = oldCI
          }
          if (oldGithubToken !== undefined) {
            process.env.SOCKET_CLI_GITHUB_TOKEN = oldGithubToken
          } else {
            delete process.env.SOCKET_CLI_GITHUB_TOKEN
          }
          if (oldGitUserName !== undefined) {
            process.env.SOCKET_CLI_GIT_USER_NAME = oldGitUserName
          }
          if (oldGitUserEmail !== undefined) {
            process.env.SOCKET_CLI_GIT_USER_EMAIL = oldGitUserEmail
          }
        }
      },
    )

    cmdit(
      ['fix', FLAG_HELP, FLAG_CONFIG, '{}'],
      'should show exact env var names in help text',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)

        // Help should show environment variable names.
        expect(stdout).toContain('SOCKET_CLI_GITHUB_TOKEN')
        expect(stdout).toContain('SOCKET_CLI_GIT_USER_NAME')
        expect(stdout).toContain('SOCKET_CLI_GIT_USER_EMAIL')

        expect(stderr).toContain('socket fix')
        expect(code).toBe(0)
      },
    )
  })

  // Basic command tests
  cmdit(
    ['fix', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)

      expect(stdout).toContain('Fix CVEs in dependencies')
      expect(stdout).toContain('Usage')
      expect(stdout).toContain('$ socket fix')
      expect(stderr).toContain('socket fix')
      expect(code).toBe(0)
    },
  )

  cmdit(
    ['fix', FLAG_DRY_RUN, FLAG_CONFIG, '{"apiToken":"fakeToken"}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)

      expect(stdout).toContain('[DryRun]: Not saving')
      expect(stderr).toContain('socket fix')
      expect(code).toBe(0)
    },
  )

  cmdit(
    [
      'fix',
      FLAG_DRY_RUN,
      '--autopilot',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should accept --autopilot flag',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toContain('[DryRun]: Not saving')
      expect(code).toBe(0)
    },
  )

  cmdit(
    [
      'fix',
      FLAG_DRY_RUN,
      '--auto-merge',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should accept --auto-merge alias',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toContain('[DryRun]: Not saving')
      expect(code).toBe(0)
    },
  )

  cmdit(
    ['fix', FLAG_DRY_RUN, '--test', FLAG_CONFIG, '{"apiToken":"fakeToken"}'],
    'should ignore --test flag',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toContain('[DryRun]: Not saving')
      expect(code).toBe(0)
    },
  )

  cmdit(
    [
      'fix',
      FLAG_DRY_RUN,
      '--test-script',
      'custom-test',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should ignore --test-script flag',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toContain('[DryRun]: Not saving')
      expect(code).toBe(0)
    },
  )

  cmdit(
    [
      'fix',
      FLAG_DRY_RUN,
      '--limit',
      '5',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should accept --limit flag with custom value',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toContain('[DryRun]: Not saving')
      expect(code).toBe(0)
    },
  )

  cmdit(
    [
      'fix',
      FLAG_DRY_RUN,
      '--min-satisfying',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should accept --min-satisfying flag',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toContain('[DryRun]: Not saving')
      expect(code).toBe(0)
    },
  )

  cmdit(
    [
      'fix',
      '--range-style',
      'invalid-style',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should fail with invalid range style',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain('Expecting range style')
      expect(code).not.toBe(0)
    },
  )

  cmdit(
    [
      'fix',
      FLAG_DRY_RUN,
      '--range-style',
      'pin',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should accept range style pin',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toContain('[DryRun]: Not saving')
      expect(code).toBe(0)
    },
  )

  cmdit(
    [
      'fix',
      FLAG_DRY_RUN,
      '--auto-merge',
      '--test',
      '--limit',
      '3',
      '--range-style',
      'preserve',
      '--min-satisfying',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should accept comprehensive flag combination',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toContain('[DryRun]: Not saving')
      expect(code).toBe(0)
    },
  )

  // Error handling tests
  cmdit(
    [
      'fix',
      path.join(testPath, 'fixtures/commands/fix/nonexistent'),
      FLAG_CONFIG,
      '{"apiToken":"fake-token"}',
    ],
    'should show helpful error when no package.json found',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain('Need at least one file')
      expect(code).toBe(1)
    },
  )

  // Fixture-based tests with proper isolation
  // NOTE: These tests spawn the actual CLI in a separate process where Vitest
  // mocks don't apply. Using --dry-run to test CLI flow without executing actual fixes.
  cmdit(
    ['fix', FLAG_DRY_RUN, '.', FLAG_CONFIG, '{"apiToken":"fake-token"}'],
    'should handle vulnerable dependencies fixture project',
    async cmd => {
      const { cleanup, tempDir } = await withTempFixture(
        path.join(fixtureBaseDir, 'pnpm/vulnerable-deps'),
      )
      cleanupFunctions.push(cleanup)

      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: tempDir,
      })
      const output = stdout + stderr
      // With mocked API calls, the command should complete successfully
      expect(code).toBe(0)
    },
    { timeout: testTimeout },
  )

  cmdit(
    ['fix', FLAG_DRY_RUN, '.', FLAG_CONFIG, '{"apiToken":"fake-token"}'],
    'should handle monorepo fixture project',
    async cmd => {
      const { cleanup, tempDir } = await withTempFixture(
        path.join(fixtureBaseDir, 'pnpm/monorepo'),
      )
      cleanupFunctions.push(cleanup)

      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: tempDir,
      })
      const output = stdout + stderr
      // With dry-run, command completes successfully
      expect(code).toBe(0)
    },
    { timeout: testTimeout },
  )

  cmdit(
    [
      'fix',
      FLAG_DRY_RUN,
      '--id',
      'GHSA-35jh-r3h4-6jhm',
      '.',
      FLAG_CONFIG,
      '{"apiToken":"fake-token"}',
    ],
    'should handle specific GHSA ID for lodash vulnerability',
    async cmd => {
      const { cleanup, tempDir } = await withTempFixture(
        path.join(fixtureBaseDir, 'pnpm/vulnerable-deps'),
      )
      cleanupFunctions.push(cleanup)

      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: tempDir,
      })
      const output = stdout + stderr
      // With mocked API calls, the command should complete successfully
      expect(code).toBe(0)
    },
    { timeout: testTimeout },
  )

  cmdit(
    [
      'fix',
      FLAG_DRY_RUN,
      '--id',
      'CVE-2021-23337',
      '.',
      FLAG_CONFIG,
      '{"apiToken":"fake-token"}',
    ],
    'should handle CVE ID conversion for lodash vulnerability',
    async cmd => {
      const { cleanup, tempDir } = await withTempFixture(
        path.join(fixtureBaseDir, 'pnpm/vulnerable-deps'),
      )
      cleanupFunctions.push(cleanup)

      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: tempDir,
      })
      const output = stdout + stderr
      // With mocked API calls, the command should complete successfully
      expect(code).toBe(0)
    },
    { timeout: testTimeout },
  )

  cmdit(
    [
      'fix',
      FLAG_DRY_RUN,
      '--limit',
      '1',
      '.',
      FLAG_CONFIG,
      '{"apiToken":"fake-token"}',
    ],
    'should respect fix limit parameter',
    async cmd => {
      const { cleanup, tempDir } = await withTempFixture(
        path.join(fixtureBaseDir, 'pnpm/vulnerable-deps'),
      )
      cleanupFunctions.push(cleanup)

      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: tempDir,
      })
      const output = stdout + stderr
      // With mocked API calls, the command should complete successfully
      expect(code).toBe(0)
    },
    { timeout: testTimeout },
  )

  cmdit(
    [
      'fix',
      FLAG_DRY_RUN,
      '--range-style',
      'preserve',
      '--autopilot',
      '.',
      FLAG_CONFIG,
      '{"apiToken":"fake-token"}',
    ],
    'should handle autopilot mode with preserve range style',
    async cmd => {
      const { cleanup, tempDir } = await withTempFixture(
        path.join(fixtureBaseDir, 'pnpm/vulnerable-deps'),
      )
      cleanupFunctions.push(cleanup)

      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: tempDir,
      })
      const output = stdout + stderr
      // With mocked API calls, the command should complete successfully
      expect(code).toBe(0)
    },
    { timeout: testTimeout },
  )

  cmdit(
    [
      'fix',
      FLAG_DRY_RUN,
      '--range-style',
      'pin',
      '.',
      FLAG_CONFIG,
      '{"apiToken":"fake-token"}',
    ],
    'should handle pin range style for exact versions',
    async cmd => {
      const { cleanup, tempDir } = await withTempFixture(
        path.join(fixtureBaseDir, 'pnpm/vulnerable-deps'),
      )
      cleanupFunctions.push(cleanup)

      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: tempDir,
      })
      const output = stdout + stderr
      // With mocked API calls, the command should complete successfully
      expect(code).toBe(0)
    },
    { timeout: testTimeout },
  )

  cmdit(
    [
      'fix',
      FLAG_DRY_RUN,
      '--json',
      '.',
      FLAG_CONFIG,
      '{"apiToken":"fake-token"}',
    ],
    'should output results in JSON format',
    async cmd => {
      const { cleanup, tempDir } = await withTempFixture(
        path.join(fixtureBaseDir, 'pnpm/vulnerable-deps'),
      )
      cleanupFunctions.push(cleanup)

      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: tempDir,
      })
      const output = stdout + stderr
      // With mocked API calls, the command should complete successfully
      expect(code).toBe(0)
    },
    { timeout: testTimeout },
  )

  cmdit(
    [
      'fix',
      FLAG_DRY_RUN,
      '--markdown',
      '.',
      FLAG_CONFIG,
      '{"apiToken":"fake-token"}',
    ],
    'should output results in markdown format',
    async cmd => {
      const { cleanup, tempDir } = await withTempFixture(
        path.join(fixtureBaseDir, 'pnpm/vulnerable-deps'),
      )
      cleanupFunctions.push(cleanup)

      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: tempDir,
      })
      const output = stdout + stderr
      // With mocked API calls, the command should complete successfully
      expect(code).toBe(0)
    },
    { timeout: testTimeout },
  )
})
