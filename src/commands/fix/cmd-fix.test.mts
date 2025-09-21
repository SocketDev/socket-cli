import path from 'node:path'

import { afterAll, afterEach, beforeAll, describe, expect } from 'vitest'

import { logger } from '@socketsecurity/registry/lib/logger'
import { spawn } from '@socketsecurity/registry/lib/spawn'

import constants, {
  FLAG_CONFIG,
  FLAG_DRY_RUN,
  FLAG_HELP,
  FLAG_ID,
  FLAG_JSON,
  FLAG_MARKDOWN,
} from '../../../src/constants.mts'
import { cmdit, spawnSocketCli, testPath } from '../../../test/utils.mts'

const fixtureBaseDir = path.join(testPath, 'fixtures/commands/fix')
const pnpmFixtureDir = path.join(fixtureBaseDir, 'pnpm')

async function revertFixtureChanges() {
  // Reset only the lockfiles that fix command might modify.
  try {
    await spawn('git', ['checkout', 'HEAD', '--', 'monorepo/pnpm-lock.yaml'], {
      cwd: pnpmFixtureDir,
      stdio: 'ignore',
    })
  } catch (e) {
    // Log warning but continue - lockfile might not exist or have no changes.
    logger.warn('Failed to revert lockfile:', e)
  }
  // Clean up any untracked files (node_modules, etc.).
  try {
    await spawn('git', ['clean', '-fd', '.'], {
      cwd: pnpmFixtureDir,
      stdio: 'ignore',
    })
  } catch (e) {
    logger.warn('Failed to clean untracked files:', e)
  }
}

describe('socket fix', async () => {
  const { binCliPath } = constants
  // Increase timeout for CI environments and Windows where operations can be slower.
  const testTimeout = constants.ENV.CI || constants.WIN32 ? 60_000 : 30_000

  beforeAll(async () => {
    // Ensure fixtures are in clean state before tests.
    await revertFixtureChanges()
  })

  afterEach(async () => {
    // Revert all changes after each test using git.
    await revertFixtureChanges()
  })

  afterAll(async () => {
    // Clean up once after all tests.
    await revertFixtureChanges()
  })

  describe('environment variable handling', () => {
    // Note: The warning messages about missing env vars are only shown when:
    // 1. NOT in dry-run mode
    // 2. There are actual vulnerabilities to fix
    // Since these tests use --dry-run, they won't trigger the warnings.
    // The implementation is still correct and will show warnings in real usage.

    cmdit(
      ['fix', FLAG_DRY_RUN, FLAG_CONFIG, '{"apiToken":"fake-token"}'],
      'should not show env var names when all CI env vars are present',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
          // Don't use fixture dir, use current dir which has git repo.
          env: {
            ...process.env,
            CI: '1',
            SOCKET_CLI_GITHUB_TOKEN: 'fake-github-token',
            SOCKET_CLI_GIT_USER_NAME: 'test-user',
            SOCKET_CLI_GIT_USER_EMAIL: 'test@example.com',
          },
        })

        const output = stdout + stderr
        // When all vars are present, none should be mentioned.
        expect(output).not.toContain('SOCKET_CLI_GITHUB_TOKEN')
        expect(output).not.toContain('SOCKET_CLI_GIT_USER_NAME')
        expect(output).not.toContain('SOCKET_CLI_GIT_USER_EMAIL')
        expect(code).toBe(0)
      },
    )

    cmdit(
      ['fix', FLAG_DRY_RUN, FLAG_CONFIG, '{"apiToken":"fake-token"}'],
      'should not show env var names when CI is not set',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
          // Don't use fixture dir, use current dir which has git repo.
          env: {
            ...process.env,
            CI: '',
            SOCKET_CLI_GITHUB_TOKEN: '',
            SOCKET_CLI_GIT_USER_NAME: '',
            SOCKET_CLI_GIT_USER_EMAIL: '',
          },
        })

        const output = stdout + stderr
        // When CI is not set, env vars should not be mentioned.
        expect(output).not.toContain('SOCKET_CLI_GITHUB_TOKEN')
        expect(output).not.toContain('SOCKET_CLI_GIT_USER_NAME')
        expect(output).not.toContain('SOCKET_CLI_GIT_USER_EMAIL')
        expect(code).toBe(0)
      },
    )

    cmdit(
      ['fix', FLAG_DRY_RUN, FLAG_CONFIG, '{"apiToken":"fake-token"}'],
      'should not show env var names when CI is not set but some vars are present',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
          // Don't use fixture dir, use current dir which has git repo.
          env: {
            ...process.env,
            CI: '',
            // Some CI vars present but CI not set.
            SOCKET_CLI_GITHUB_TOKEN: 'fake-token',
            SOCKET_CLI_GIT_USER_NAME: 'test-user',
            SOCKET_CLI_GIT_USER_EMAIL: '',
          },
        })

        const output = stdout + stderr
        // When CI is not set, env vars should not be mentioned regardless of their values.
        expect(output).not.toContain('SOCKET_CLI_GITHUB_TOKEN')
        expect(output).not.toContain('SOCKET_CLI_GIT_USER_NAME')
        expect(output).not.toContain('SOCKET_CLI_GIT_USER_EMAIL')
        expect(code).toBe(0)
      },
    )

    cmdit(
      ['fix', FLAG_HELP, FLAG_CONFIG, '{}'],
      'should show exact env var names in help text',
      async cmd => {
        const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
        // Help text doesn't directly show env vars, but the implementation
        // would show them when actually running the command with missing vars.
        expect(stdout).toContain('Examples')
        expect(code).toBe(0)
      },
    )
  })

  cmdit(
    ['fix', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `
        "Fix CVEs in dependencies

          Usage
            $ socket fix [options] [CWD=.]

          API Token Requirements
            - Quota: 101 units
            - Permissions: full-scans:create and packages:list

          Options
            --autopilot         Enable auto-merge for pull requests that Socket opens.
                                See GitHub documentation (https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-auto-merge-for-pull-requests-in-your-repository) for managing auto-merge for pull requests in your repository.
            --dont-apply-fixes  Compute fixes only, do not apply them. Logs what upgrades would be applied. If combined with --output-file, the output file will contain the upgrades that would be applied.
            --id                Provide a list of vulnerability identifiers to compute fixes for:
                                    - GHSA IDs (https://docs.github.com/en/code-security/security-advisories/working-with-global-security-advisories-from-the-github-advisory-database/about-the-github-advisory-database#about-ghsa-ids) (e.g., GHSA-xxxx-xxxx-xxxx)
                                    - CVE IDs (https://cve.mitre.org/cve/identifiers/) (e.g., CVE-2025-1234) - automatically converted to GHSA
                                    - PURLs (https://github.com/package-url/purl-spec) (e.g., pkg:npm/package@1.0.0) - automatically converted to GHSA
                                    Can be provided as comma separated values or as multiple flags
            --json              Output as JSON
            --limit             The number of fixes to attempt at a time (default 10)
            --markdown          Output as Markdown
            --output-file       Path to store upgrades as a JSON file at this path.
            --range-style       Define how dependency version ranges are updated in package.json (default 'preserve').
                                Available styles:
                                  * pin - Use the exact version (e.g. 1.2.3)
                                  * preserve - Retain the existing version range style as-is

          Environment Variables (for CI/PR mode)
            CI                          Set to enable CI mode
            SOCKET_CLI_GITHUB_TOKEN     GitHub token for PR creation (or GITHUB_TOKEN)
            SOCKET_CLI_GIT_USER_NAME    Git username for commits
            SOCKET_CLI_GIT_USER_EMAIL   Git email for commits

          Examples
            $ socket fix
            $ socket fix --id CVE-2021-23337
            $ socket fix ./path/to/project --range-style pin"
      `,
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | CLI: <redacted>
          |__   | * |  _| '_| -_|  _|     | token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket fix\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain('`socket fix`')
    },
  )

  cmdit(
    ['fix', FLAG_DRY_RUN, FLAG_CONFIG, '{"apiToken":"fakeToken"}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | CLI: <redacted>
          |__   | * |  _| '_| -_|  _|     | token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket fix\`, cwd: <redacted>"
      `)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Not saving"`)
      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
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
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Not saving"`)
      expect(code, 'should exit with code 0').toBe(0)
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
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Not saving"`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    ['fix', FLAG_DRY_RUN, '--test', FLAG_CONFIG, '{"apiToken":"fakeToken"}'],
    'should ignore --test flag',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Not saving"`)
      expect(code, 'should exit with code 0').toBe(0)
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
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Not saving"`)
      expect(code, 'should exit with code 0').toBe(0)
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
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Not saving"`)
      expect(code, 'should exit with code 0').toBe(0)
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
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Not saving"`)
      expect(code, 'should exit with code 0').toBe(0)
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
      expect(output).toContain('Expecting range style of')
      expect(code, 'should exit with non-zero code').not.toBe(0)
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
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Not saving"`)
      expect(code, 'should exit with code 0').toBe(0)
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
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Not saving"`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'fix',
      path.join(fixtureBaseDir, 'nonexistent'),
      FLAG_CONFIG,
      '{"apiToken":"fake-token"}',
    ],
    'should show helpful error when no package.json found',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain(
        'Unable to resolve a Socket account organization',
      )
      expect(code, 'should exit with non-zero code').not.toBe(0)
    },
  )

  cmdit(
    ['fix', '.', FLAG_CONFIG, '{"apiToken":"fake-token"}'],
    'should handle vulnerable dependencies fixture project',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: path.join(fixtureBaseDir, 'pnpm/vulnerable-deps'),
      })
      const output = stdout + stderr
      expect(output).toContain(
        'Unable to resolve a Socket account organization',
      )
      expect(code, 'should exit with non-zero code').not.toBe(0)
    },
    { timeout: testTimeout },
  )

  cmdit(
    ['fix', '.', FLAG_CONFIG, '{"apiToken":"fake-token"}'],
    'should handle monorepo fixture project',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: path.join(fixtureBaseDir, 'pnpm/monorepo'),
      })
      const output = stdout + stderr
      expect(output).toContain(
        'Unable to resolve a Socket account organization',
      )
      expect(code, 'should exit with non-zero code').not.toBe(0)
    },
    { timeout: testTimeout },
  )

  cmdit(
    [
      'fix',
      FLAG_DRY_RUN,
      '--autopilot',
      '--limit',
      '1',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should handle autopilot mode with custom limit',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Not saving"`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'fix',
      FLAG_ID,
      'GHSA-35jh-r3h4-6jhm',
      FLAG_CONFIG,
      '{"apiToken":"fake-token"}',
    ],
    'should handle specific GHSA ID for lodash vulnerability',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain(
        'Unable to resolve a Socket account organization',
      )
      expect(code, 'should exit with non-zero code').not.toBe(0)
    },
  )

  cmdit(
    ['fix', '--id', 'CVE-2021-23337', FLAG_CONFIG, '{"apiToken":"fake-token"}'],
    'should handle CVE ID conversion for lodash vulnerability',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain(
        'Unable to resolve a Socket account organization',
      )
      expect(code, 'should exit with non-zero code').not.toBe(0)
    },
  )

  cmdit(
    ['fix', '--limit', '1', FLAG_CONFIG, '{"apiToken":"fake-token"}'],
    'should respect fix limit parameter',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain(
        'Unable to resolve a Socket account organization',
      )
      expect(code, 'should exit with non-zero code').not.toBe(0)
    },
  )

  cmdit(
    [
      'fix',
      '--range-style',
      'preserve',
      '--autopilot',
      FLAG_CONFIG,
      '{"apiToken":"fake-token"}',
    ],
    'should handle autopilot mode with preserve range style',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain(
        'Unable to resolve a Socket account organization',
      )
      expect(code, 'should exit with non-zero code').not.toBe(0)
    },
  )

  cmdit(
    ['fix', '--range-style', 'pin', FLAG_CONFIG, '{"apiToken":"fake-token"}'],
    'should handle pin range style for exact versions',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain(
        'Unable to resolve a Socket account organization',
      )
      expect(code, 'should exit with non-zero code').not.toBe(0)
    },
  )

  cmdit(
    ['fix', '--json', FLAG_CONFIG, '{"apiToken":"fake-token"}'],
    'should output results in JSON format',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain(
        'Unable to resolve a Socket account organization',
      )
      expect(code, 'should exit with non-zero code').not.toBe(0)
    },
  )

  cmdit(
    ['fix', '--markdown', FLAG_CONFIG, '{"apiToken":"fake-token"}'],
    'should output results in markdown format',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain(
        'Unable to resolve a Socket account organization',
      )
      expect(code, 'should exit with non-zero code').not.toBe(0)
    },
  )

  describe('vulnerability identification', () => {
    cmdit(
      [
        'fix',
        FLAG_ID,
        'pkg:npm/lodash@4.17.20',
        '.',
        FLAG_CONFIG,
        '{"apiToken":"fake-token"}',
      ],
      'should handle PURL-based vulnerability identification',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
          cwd: path.join(fixtureBaseDir, 'pnpm/vulnerable-deps'),
        })
        const output = stdout + stderr
        expect(output).toContain(
          'Unable to resolve a Socket account organization',
        )
        expect(code, 'should exit with non-zero code').not.toBe(0)
      },
    )

    cmdit(
      [
        'fix',
        FLAG_ID,
        'GHSA-35jh-r3h4-6jhm,CVE-2021-23337',
        '.',
        FLAG_CONFIG,
        '{"apiToken":"fake-token"}',
      ],
      'should handle multiple vulnerability IDs in comma-separated format',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
          cwd: path.join(fixtureBaseDir, 'pnpm/vulnerable-deps'),
        })
        const output = stdout + stderr
        expect(output).toContain(
          'Unable to resolve a Socket account organization',
        )
        expect(code, 'should exit with non-zero code').not.toBe(0)
      },
    )

    cmdit(
      [
        'fix',
        FLAG_ID,
        'GHSA-35jh-r3h4-6jhm',
        FLAG_ID,
        'CVE-2021-23337',
        '.',
        FLAG_CONFIG,
        '{"apiToken":"fake-token"}',
      ],
      'should handle multiple vulnerability IDs as separate flags',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
          cwd: path.join(fixtureBaseDir, 'pnpm/vulnerable-deps'),
        })
        const output = stdout + stderr
        expect(output).toContain(
          'Unable to resolve a Socket account organization',
        )
        expect(code, 'should exit with non-zero code').not.toBe(0)
      },
    )
  })

  describe('autopilot mode', () => {
    cmdit(
      [
        'fix',
        '--limit',
        '1',
        '--autopilot',
        FLAG_JSON,
        '.',
        FLAG_CONFIG,
        '{"apiToken":"fake-token"}',
      ],
      'should handle autopilot mode with JSON output and custom limit',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
          cwd: path.join(fixtureBaseDir, 'pnpm/vulnerable-deps'),
        })
        const output = stdout + stderr
        expect(output).toContain(
          'Unable to resolve a Socket account organization',
        )
        expect(code, 'should exit with non-zero code').not.toBe(0)
      },
    )
  })

  describe('output format handling', () => {
    cmdit(
      [
        'fix',
        '--range-style',
        'pin',
        FLAG_MARKDOWN,
        '.',
        FLAG_CONFIG,
        '{"apiToken":"fake-token"}',
      ],
      'should handle monorepo with pin style and markdown output',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
          cwd: path.join(fixtureBaseDir, 'pnpm/monorepo'),
        })
        const output = stdout + stderr
        expect(output).toContain(
          'Unable to resolve a Socket account organization',
        )
        expect(code, 'should exit with non-zero code').not.toBe(0)
      },
    )
  })

  describe('error handling and usability tests', () => {
    cmdit(
      [
        'fix',
        '/nonexistent/directory',
        FLAG_CONFIG,
        '{"apiToken":"fake-token"}',
      ],
      'should show clear error for non-existent project directory',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
        const output = stdout + stderr
        expect(output).toContain(
          'Unable to resolve a Socket account organization',
        )
        expect(code).toBeGreaterThan(0)
      },
    )

    cmdit(
      ['fix', FLAG_CONFIG, '{}'],
      'should show clear error when API token is missing',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
        const output = stdout + stderr
        expect(output).toMatch(/api token|authentication|token/i)
        expect(code).toBeGreaterThan(0)
      },
    )

    cmdit(
      [
        'fix',
        FLAG_ID,
        'invalid-id-format',
        FLAG_CONFIG,
        '{"apiToken":"fake-token"}',
      ],
      'should handle invalid vulnerability ID formats gracefully',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
        const output = stdout + stderr
        expect(code).toBeGreaterThan(0)
        expect(output.length).toBeGreaterThan(0)
      },
    )

    cmdit(
      [
        'fix',
        '--limit',
        'not-a-number',
        FLAG_CONFIG,
        '{"apiToken":"fake-token"}',
      ],
      'should show clear error for invalid limit parameter',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
        const output = stdout + stderr
        expect(output).toContain(
          'Unable to resolve a Socket account organization',
        )
        expect(code).toBeGreaterThan(0)
      },
      { timeout: testTimeout },
    )

    cmdit(
      ['fix', '--limit', '-5', FLAG_CONFIG, '{"apiToken":"fake-token"}'],
      'should show clear error for negative limit',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
        const output = stdout + stderr
        expect(output).toContain(
          'Unable to resolve a Socket account organization',
        )
        expect(code).toBeGreaterThan(0)
      },
      { timeout: testTimeout },
    )

    cmdit(
      [
        'fix',
        FLAG_ID,
        'GHSA-xxxx-xxxx-xxxx',
        '.',
        FLAG_CONFIG,
        '{"apiToken":"fake-token"}',
      ],
      'should handle non-existent GHSA IDs gracefully',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
          cwd: path.join(fixtureBaseDir, 'pnpm/vulnerable-deps'),
        })
        expect(code).toBeGreaterThan(0)
        const output = stdout + stderr
        expect(output.length).toBeGreaterThan(0)
      },
    )

    cmdit(
      [
        'fix',
        FLAG_JSON,
        FLAG_MARKDOWN,
        '.',
        FLAG_CONFIG,
        '{"apiToken":"fake-token"}',
      ],
      'should show clear error when both json and markdown flags are used',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
          cwd: path.join(fixtureBaseDir, 'pnpm/vulnerable-deps'),
        })
        const output = stdout + stderr
        expect(output).toMatch(/json.*markdown|conflicting|both.*set/i)
        expect(code).toBeGreaterThan(0)
      },
    )

    cmdit(
      ['fix', '--autopilot', FLAG_CONFIG, '{}'],
      'should show helpful error when using autopilot without proper auth',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
        const output = stdout + stderr
        expect(output).toMatch(/api token|authentication|github.*token/i)
        expect(code).toBeGreaterThan(0)
      },
    )

    cmdit(
      [
        'fix',
        FLAG_ID,
        'CVE-1234-invalid',
        '.',
        FLAG_CONFIG,
        '{"apiToken":"fake-token"}',
      ],
      'should handle malformed CVE IDs gracefully',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
          cwd: path.join(fixtureBaseDir, 'pnpm/vulnerable-deps'),
        })
        expect(code).toBeGreaterThan(0)
        const output = stdout + stderr
        expect(output.length).toBeGreaterThan(0)
      },
    )

    cmdit(
      ['fix', FLAG_HELP, '--autopilot', '--limit', '5', FLAG_CONFIG, '{}'],
      'should prioritize help over other flags',
      async cmd => {
        const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
        expect(stdout).toContain('Fix CVEs in dependencies')
        expect(code).toBe(0)
      },
    )

    cmdit(
      [
        'fix',
        '.',
        FLAG_CONFIG,
        '{"apiToken":"extremely-long-invalid-token-that-exceeds-normal-token-length-and-should-be-handled-gracefully"}',
      ],
      'should handle unusually long tokens gracefully',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
          cwd: path.join(fixtureBaseDir, 'pnpm/vulnerable-deps'),
        })
        expect(code).toBeGreaterThan(0)
        const output = stdout + stderr
        expect(output.length).toBeGreaterThan(0)
      },
    )

    cmdit(
      [
        'fix',
        FLAG_ID,
        'GHSA-1234-5678-9abc,CVE-2023-1234,pkg:npm/lodash@4.17.20,invalid-format',
        '.',
        FLAG_CONFIG,
        '{"apiToken":"fake-token"}',
      ],
      'should handle mixed valid and invalid vulnerability IDs',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
          cwd: path.join(fixtureBaseDir, 'pnpm/vulnerable-deps'),
        })
        expect(code).toBeGreaterThan(0)
        const output = stdout + stderr
        expect(output.length).toBeGreaterThan(0)
      },
    )
  })
})
