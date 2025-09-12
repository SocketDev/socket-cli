import path from 'node:path'

import trash from 'trash'
import { afterEach, beforeEach, describe, expect } from 'vitest'

import { spawn } from '@socketsecurity/registry/lib/spawn'

import constants from '../../../src/constants.mts'
import { cmdit, spawnNpm, testPath } from '../../../test/utils.mts'

async function setupFixturePackageLocks() {
  const fixtureDirs = [
    'fixtures/commands/fix/vulnerable-deps',
    'fixtures/commands/fix/monorepo',
  ]

  await Promise.all(
    fixtureDirs.map(d =>
      spawn('npm', ['install', '--silent', '--no-audit', '--no-fund'], {
        cwd: path.join(testPath, d),
        stdio: 'ignore',
      }),
    ),
  )
}

async function cleanupPackageLockFiles() {
  const cleanupPaths = [
    'fixtures/commands/fix/vulnerable-deps/package-lock.json',
    'fixtures/commands/fix/vulnerable-deps/node_modules',
    'fixtures/commands/fix/monorepo/package-lock.json',
    'fixtures/commands/fix/monorepo/node_modules',
    'fixtures/commands/fix/monorepo/packages/app/package-lock.json',
    'fixtures/commands/fix/monorepo/packages/app/node_modules',
    'fixtures/commands/fix/monorepo/packages/lib/package-lock.json',
    'fixtures/commands/fix/monorepo/packages/lib/node_modules',
  ]
  await trash(cleanupPaths.map(p => path.join(testPath, p)))
}

describe('socket fix', async () => {
  const { binCliPath } = constants

  // No setup/cleanup needed for these tests

  cmdit(
    ['fix', '--help', '--config', '{}'],
    'should support --help',
    async cmd => {
      const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `
        "Update dependencies with "fixable" Socket alerts

          Usage
            $ socket fix [options] [CWD=.]

          API Token Requirements
            - Quota: 101 units
            - Permissions: full-scans:create and packages:list

          Options
            --autopilot         Enable auto-merge for pull requests that Socket opens.
                                See GitHub documentation (https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-auto-merge-for-pull-requests-in-your-repository) for managing auto-merge for pull requests in your repository.
            --id                Provide a list of vulnerability identifiers to compute fixes for:
                                    - GHSA IDs (https://docs.github.com/en/code-security/security-advisories/working-with-global-security-advisories-from-the-github-advisory-database/about-the-github-advisory-database#about-ghsa-ids) (e.g., GHSA-xxxx-xxxx-xxxx)
                                    - CVE IDs (https://cve.mitre.org/cve/identifiers/) (e.g., CVE-2025-1234) - automatically converted to GHSA
                                    - PURLs (https://github.com/package-url/purl-spec) (e.g., pkg:npm/package@1.0.0) - automatically converted to GHSA
                                    Can be provided as comma separated values or as multiple flags
            --json              Output result as json
            --limit             The number of fixes to attempt at a time (default 10)
            --markdown          Output result as markdown
            --range-style       Define how dependency version ranges are updated in package.json (default 'preserve').
                                Available styles:
                                  * pin - Use the exact version (e.g. 1.2.3)
                                  * preserve - Retain the existing version range style as-is

          Examples
            $ socket fix
            $ socket fix ./proj/tree --auto-merge"
      `,
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket fix\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain('`socket fix`')
    },
  )

  cmdit(
    ['fix', '--dry-run', '--config', '{"apiToken":"fakeToken"}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket fix\`, cwd: <redacted>"
      `)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Not saving"`)
      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )

  cmdit(
    ['fix', '--dry-run', '--autopilot', '--config', '{"apiToken":"fakeToken"}'],
    'should accept --autopilot flag',
    async cmd => {
      const { code, stdout } = await spawnNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Not saving"`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )
  cmdit(
    [
      'fix',
      '--dry-run',
      '--auto-merge',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should accept --auto-merge alias',
    async cmd => {
      const { code, stdout } = await spawnNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Not saving"`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    ['fix', '--dry-run', '--test', '--config', '{"apiToken":"fakeToken"}'],
    'should ignore --test flag',
    async cmd => {
      const { code, stdout } = await spawnNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Not saving"`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'fix',
      '--dry-run',
      '--test-script',
      'custom-test',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should ignore --test-script flag',
    async cmd => {
      const { code, stdout } = await spawnNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Not saving"`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'fix',
      '--dry-run',
      '--limit',
      '5',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should accept --limit flag with custom value',
    async cmd => {
      const { code, stdout } = await spawnNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Not saving"`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'fix',
      '--dry-run',
      '--min-satisfying',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should accept --min-satisfying flag',
    async cmd => {
      const { code, stdout } = await spawnNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Not saving"`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'fix',
      '--range-style',
      'invalid-style',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should fail with invalid range style',
    async cmd => {
      const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain('Expecting range style of')
      expect(code, 'should exit with non-zero code').not.toBe(0)
    },
  )

  cmdit(
    [
      'fix',
      '--dry-run',
      '--range-style',
      'pin',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should accept range style pin',
    async cmd => {
      const { code, stdout } = await spawnNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Not saving"`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'fix',
      '--dry-run',
      '--auto-merge',
      '--test',
      '--limit',
      '3',
      '--range-style',
      'preserve',
      '--min-satisfying',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should accept comprehensive flag combination',
    async cmd => {
      const { code, stdout } = await spawnNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Not saving"`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    ['fix', '/tmp', '--config', '{"apiToken":"fake-token"}'],
    'should show helpful error when no package.json found',
    async cmd => {
      const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain(
        'Unable to resolve a Socket account organization',
      )
      expect(code, 'should exit with non-zero code').not.toBe(0)
    },
  )

  cmdit(
    ['fix', '.', '--config', '{"apiToken":"fake-token"}'],
    'should handle vulnerable dependencies fixture project',
    async cmd => {
      const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd, {
        cwd: path.join(testPath, 'fixtures/commands/fix/vulnerable-deps'),
      })
      const output = stdout + stderr
      expect(output).toContain(
        'Unable to resolve a Socket account organization',
      )
      expect(code, 'should exit with non-zero code').not.toBe(0)
    },
  )

  cmdit(
    ['fix', '.', '--config', '{"apiToken":"fake-token"}'],
    'should handle monorepo fixture project',
    async cmd => {
      const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd, {
        cwd: path.join(testPath, 'fixtures/commands/fix/monorepo'),
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
      '--dry-run',
      '--autopilot',
      '--limit',
      '1',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should handle autopilot mode with custom limit',
    async cmd => {
      const { code, stdout } = await spawnNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Not saving"`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'fix',
      '--id',
      'GHSA-35jh-r3h4-6jhm',
      '--config',
      '{"apiToken":"fake-token"}',
    ],
    'should handle specific GHSA ID for lodash vulnerability',
    async cmd => {
      const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain(
        'Unable to resolve a Socket account organization',
      )
      expect(code, 'should exit with non-zero code').not.toBe(0)
    },
  )

  cmdit(
    ['fix', '--id', 'CVE-2021-23337', '--config', '{"apiToken":"fake-token"}'],
    'should handle CVE ID conversion for lodash vulnerability',
    async cmd => {
      const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain(
        'Unable to resolve a Socket account organization',
      )
      expect(code, 'should exit with non-zero code').not.toBe(0)
    },
  )

  cmdit(
    ['fix', '--limit', '1', '--config', '{"apiToken":"fake-token"}'],
    'should respect fix limit parameter',
    async cmd => {
      const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd)
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
      '--config',
      '{"apiToken":"fake-token"}',
    ],
    'should handle autopilot mode with preserve range style',
    async cmd => {
      const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain(
        'Unable to resolve a Socket account organization',
      )
      expect(code, 'should exit with non-zero code').not.toBe(0)
    },
  )

  cmdit(
    ['fix', '--range-style', 'pin', '--config', '{"apiToken":"fake-token"}'],
    'should handle pin range style for exact versions',
    async cmd => {
      const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain(
        'Unable to resolve a Socket account organization',
      )
      expect(code, 'should exit with non-zero code').not.toBe(0)
    },
  )

  cmdit(
    ['fix', '--json', '--config', '{"apiToken":"fake-token"}'],
    'should output results in JSON format',
    async cmd => {
      const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain(
        'Unable to resolve a Socket account organization',
      )
      expect(code, 'should exit with non-zero code').not.toBe(0)
    },
  )

  cmdit(
    ['fix', '--markdown', '--config', '{"apiToken":"fake-token"}'],
    'should output results in markdown format',
    async cmd => {
      const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd)
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
        '--id',
        'pkg:npm/lodash@4.17.20',
        '.',
        '--config',
        '{"apiToken":"fake-token"}',
      ],
      'should handle PURL-based vulnerability identification',
      async cmd => {
        const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd, {
          cwd: path.join(testPath, 'fixtures/commands/fix/vulnerable-deps'),
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
        '--id',
        'GHSA-35jh-r3h4-6jhm,CVE-2021-23337',
        '.',
        '--config',
        '{"apiToken":"fake-token"}',
      ],
      'should handle multiple vulnerability IDs in comma-separated format',
      async cmd => {
        const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd, {
          cwd: path.join(testPath, 'fixtures/commands/fix/vulnerable-deps'),
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
        '--id',
        'GHSA-35jh-r3h4-6jhm',
        '--id',
        'CVE-2021-23337',
        '.',
        '--config',
        '{"apiToken":"fake-token"}',
      ],
      'should handle multiple vulnerability IDs as separate flags',
      async cmd => {
        const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd, {
          cwd: path.join(testPath, 'fixtures/commands/fix/vulnerable-deps'),
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
        '--json',
        '.',
        '--config',
        '{"apiToken":"fake-token"}',
      ],
      'should handle autopilot mode with JSON output and custom limit',
      async cmd => {
        const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd, {
          cwd: path.join(testPath, 'fixtures/commands/fix/vulnerable-deps'),
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
        '--markdown',
        '.',
        '--config',
        '{"apiToken":"fake-token"}',
      ],
      'should handle monorepo with pin style and markdown output',
      async cmd => {
        const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd, {
          cwd: path.join(testPath, 'fixtures/commands/fix/monorepo'),
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
        '--config',
        '{"apiToken":"fake-token"}',
      ],
      'should show clear error for non-existent project directory',
      async cmd => {
        const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd)
        const output = stdout + stderr
        expect(output).toContain(
          'Unable to resolve a Socket account organization',
        )
        expect(code).toBeGreaterThan(0)
      },
    )

    cmdit(
      ['fix', '--config', '{}'],
      'should show clear error when API token is missing',
      async cmd => {
        const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd)
        const output = stdout + stderr
        expect(output).toMatch(/api token|authentication|token/i)
        expect(code).toBeGreaterThan(0)
      },
    )

    cmdit(
      [
        'fix',
        '--id',
        'invalid-id-format',
        '--config',
        '{"apiToken":"fake-token"}',
      ],
      'should handle invalid vulnerability ID formats gracefully',
      async cmd => {
        const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd)
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
        '--config',
        '{"apiToken":"fake-token"}',
      ],
      'should show clear error for invalid limit parameter',
      async cmd => {
        const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd)
        const output = stdout + stderr
        expect(output).toContain(
          'Unable to resolve a Socket account organization',
        )
        expect(code).toBeGreaterThan(0)
      },
    )

    cmdit(
      ['fix', '--limit', '-5', '--config', '{"apiToken":"fake-token"}'],
      'should show clear error for negative limit',
      async cmd => {
        const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd)
        const output = stdout + stderr
        expect(output).toContain(
          'Unable to resolve a Socket account organization',
        )
        expect(code).toBeGreaterThan(0)
      },
    )

    cmdit(
      [
        'fix',
        '--id',
        'GHSA-xxxx-xxxx-xxxx',
        '.',
        '--config',
        '{"apiToken":"fake-token"}',
      ],
      'should handle non-existent GHSA IDs gracefully',
      async cmd => {
        const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd, {
          cwd: path.join(testPath, 'fixtures/commands/fix/vulnerable-deps'),
        })
        expect(code).toBeGreaterThan(0)
        const output = stdout + stderr
        expect(output.length).toBeGreaterThan(0)
      },
    )

    cmdit(
      [
        'fix',
        '--json',
        '--markdown',
        '.',
        '--config',
        '{"apiToken":"fake-token"}',
      ],
      'should show clear error when both json and markdown flags are used',
      async cmd => {
        const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd, {
          cwd: path.join(testPath, 'fixtures/commands/fix/vulnerable-deps'),
        })
        const output = stdout + stderr
        expect(output).toMatch(/json.*markdown|conflicting|both.*set/i)
        expect(code).toBeGreaterThan(0)
      },
    )

    cmdit(
      ['fix', '--autopilot', '--config', '{}'],
      'should show helpful error when using autopilot without proper auth',
      async cmd => {
        const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd)
        const output = stdout + stderr
        expect(output).toMatch(/api token|authentication|github.*token/i)
        expect(code).toBeGreaterThan(0)
      },
    )

    cmdit(
      [
        'fix',
        '--id',
        'CVE-1234-invalid',
        '.',
        '--config',
        '{"apiToken":"fake-token"}',
      ],
      'should handle malformed CVE IDs gracefully',
      async cmd => {
        const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd, {
          cwd: path.join(testPath, 'fixtures/commands/fix/vulnerable-deps'),
        })
        expect(code).toBeGreaterThan(0)
        const output = stdout + stderr
        expect(output.length).toBeGreaterThan(0)
      },
    )

    cmdit(
      ['fix', '--help', '--autopilot', '--limit', '5', '--config', '{}'],
      'should prioritize help over other flags',
      async cmd => {
        const { code, stdout } = await spawnNpm(binCliPath, cmd)
        expect(stdout).toContain(
          'Update dependencies with "fixable" Socket alerts',
        )
        expect(code).toBe(0)
      },
    )

    cmdit(
      [
        'fix',
        '.',
        '--config',
        '{"apiToken":"extremely-long-invalid-token-that-exceeds-normal-token-length-and-should-be-handled-gracefully"}',
      ],
      'should handle unusually long tokens gracefully',
      async cmd => {
        const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd, {
          cwd: path.join(testPath, 'fixtures/commands/fix/vulnerable-deps'),
        })
        expect(code).toBeGreaterThan(0)
        const output = stdout + stderr
        expect(output.length).toBeGreaterThan(0)
      },
    )

    cmdit(
      [
        'fix',
        '--id',
        'GHSA-1234-5678-9abc,CVE-2023-1234,pkg:npm/lodash@4.17.20,invalid-format',
        '.',
        '--config',
        '{"apiToken":"fake-token"}',
      ],
      'should handle mixed valid and invalid vulnerability IDs',
      async cmd => {
        const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd, {
          cwd: path.join(testPath, 'fixtures/commands/fix/vulnerable-deps'),
        })
        expect(code).toBeGreaterThan(0)
        const output = stdout + stderr
        expect(output.length).toBeGreaterThan(0)
      },
    )
  })
})
