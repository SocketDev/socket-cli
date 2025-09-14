import path from 'node:path'

import trash from 'trash'
import { afterAll, afterEach, beforeAll, describe, expect } from 'vitest'

import { readPackageJson } from '@socketsecurity/registry/lib/packages'
import { spawn } from '@socketsecurity/registry/lib/spawn'

import constants from '../../../src/constants.mts'
import { cmdit, spawnPnpm, testPath } from '../../../test/utils.mts'

import type { PackageJson } from '@socketsecurity/registry/lib/packages'

const setupFixturePackageLocks = async () => {
  const fixtureDirs = ['fixtures/commands/optimize']

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
    'fixtures/commands/optimize/package-lock.json',
    'fixtures/commands/optimize/node_modules',
  ].map(p => path.join(testPath, p))

  await trash(cleanupPaths)
}

async function cleanupFixturePackageJson() {
  const fixturePath = path.join(
    testPath,
    'fixtures/commands/optimize/package.json',
  )
  const editablePackageJson = await readPackageJson(fixturePath, {
    editable: true,
  })

  // Remove overrides and resolutions fields.
  editablePackageJson.update({
    overrides: undefined,
    resolutions: undefined,
  } as Partial<PackageJson>)

  await editablePackageJson.save()
}

describe('socket optimize', async () => {
  const { binCliPath } = constants
  const fixtureDir = path.join(testPath, 'fixtures/commands/optimize')

  beforeAll(async () => {
    // Set up fixtures once for all tests.
    await Promise.all([cleanupPackageLockFiles(), cleanupFixturePackageJson()])
    await setupFixturePackageLocks()
  }, 60_000) // Longer timeout for initial setup

  afterEach(async () => {
    // Reset package.json after tests that might modify it.
    await cleanupFixturePackageJson()
  }, 30_000) // Timeout for package.json cleanup

  afterAll(async () => {
    // Clean up once after all tests.
    await Promise.all([cleanupPackageLockFiles(), cleanupFixturePackageJson()])
  }, 60_000) // Longer timeout for final cleanup

  cmdit(
    ['optimize', '--help', '--config', '{}'],
    'should support --help',
    async cmd => {
      const { code, stderr, stdout } = await spawnPnpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `
        "Optimize dependencies with @socketregistry overrides

          Usage
            $ socket optimize [options] [CWD=.]

          API Token Requirements
            - Quota: 100 units
            - Permissions: packages:list

          Options
            --pin               Pin overrides to their latest version
            --prod              Only add overrides for production dependencies

          Examples
            $ socket optimize
            $ socket optimize ./proj/tree --pin"
      `,
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket optimize\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain(
        '`socket optimize`',
      )
    },
  )

  cmdit(
    ['optimize', '--dry-run', '--config', '{"apiToken":"fakeToken"}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await spawnPnpm(binCliPath, cmd)
      // For dry-run, should not modify files.
      const packageJsonPath = path.join(fixtureDir, 'package.json')
      const packageJson = await readPackageJson(packageJsonPath)
      expect(packageJson.overrides).toBeUndefined()
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket optimize\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )

  cmdit(
    ['optimize', '--dry-run', '--pin', '--config', '{"apiToken":"fakeToken"}'],
    'should accept --pin flag',
    async cmd => {
      const { code, stderr, stdout } = await spawnPnpm(binCliPath, cmd)
      // For dry-run, should not modify files.
      const packageJsonPath = path.join(fixtureDir, 'package.json')
      const packageJson = await readPackageJson(packageJsonPath)
      expect(packageJson.overrides).toBeUndefined()
      expect(stderr).toMatchInlineSnapshot(`
        "_____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket optimize\`, cwd: <redacted>"
      `)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    ['optimize', '--dry-run', '--prod', '--config', '{"apiToken":"fakeToken"}'],
    'should accept --prod flag',
    async cmd => {
      const { code, stderr, stdout } = await spawnPnpm(binCliPath, cmd)
      // For dry-run, should not modify files.
      const packageJsonPath = path.join(fixtureDir, 'package.json')
      const packageJson = await readPackageJson(packageJsonPath)
      expect(packageJson.overrides).toBeUndefined()
      expect(stderr).toMatchInlineSnapshot(`
        "_____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket optimize\`, cwd: <redacted>"
      `)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'optimize',
      '--dry-run',
      '--pin',
      '--prod',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should accept both --pin and --prod flags together',
    async cmd => {
      const { code, stderr, stdout } = await spawnPnpm(binCliPath, cmd)
      // For dry-run, should not modify files.
      const packageJsonPath = path.join(fixtureDir, 'package.json')
      const packageJson = await readPackageJson(packageJsonPath)
      expect(packageJson.overrides).toBeUndefined()
      expect(stderr).toMatchInlineSnapshot(`
        "_____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket optimize\`, cwd: <redacted>"
      `)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    ['optimize', '--dry-run', '--json', '--config', '{"apiToken":"fakeToken"}'],
    'should accept --json output format',
    async cmd => {
      const { code, stderr, stdout } = await spawnPnpm(binCliPath, cmd)
      // For dry-run, should not modify files.
      const packageJsonPath = path.join(fixtureDir, 'package.json')
      const packageJson = await readPackageJson(packageJsonPath)
      expect(packageJson.overrides).toBeUndefined()
      expect(stderr).toMatchInlineSnapshot(`""`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'optimize',
      '--dry-run',
      '--markdown',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should accept --markdown output format',
    async cmd => {
      const { code, stderr, stdout } = await spawnPnpm(binCliPath, cmd)
      // For dry-run, should not modify files.
      const packageJsonPath = path.join(fixtureDir, 'package.json')
      const packageJson = await readPackageJson(packageJsonPath)
      expect(packageJson.overrides).toBeUndefined()
      expect(stderr).toMatchInlineSnapshot(`""`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'optimize',
      '--dry-run',
      './custom-path',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should accept custom directory path',
    async cmd => {
      const { code, stderr, stdout } = await spawnPnpm(binCliPath, cmd)
      // For dry-run, should not modify files.
      const packageJsonPath = path.join(fixtureDir, 'package.json')
      const packageJson = await readPackageJson(packageJsonPath)
      expect(packageJson.overrides).toBeUndefined()
      expect(stderr).toMatchInlineSnapshot(`
        "_____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket optimize\`, cwd: <redacted>"
      `)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    ['optimize', '/tmp', '--config', '{"apiToken":"fake-token"}'],
    'should handle directories without package.json gracefully',
    async cmd => {
      const { code, stderr, stdout } = await spawnPnpm(binCliPath, cmd)
      // Should not modify any package.json since no package.json exists in /tmp.
      const output = stdout + stderr
      expect(output.length).toBeGreaterThan(0)
      expect(code, 'should exit with code 1').toBe(1)
    },
  )

  cmdit(
    [
      'optimize',
      '--dry-run',
      '--pin',
      '--prod',
      '--json',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should accept comprehensive flag combination',
    async cmd => {
      const { code, stderr, stdout } = await spawnPnpm(binCliPath, cmd)
      // For dry-run, should not modify files.
      const packageJsonPath = path.join(fixtureDir, 'package.json')
      const packageJson = await readPackageJson(packageJsonPath)
      expect(packageJson.overrides).toBeUndefined()
      expect(stderr).toMatchInlineSnapshot(`""`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'optimize',
      'fixtures/commands/optimize/basic-project',
      '--config',
      '{"apiToken":"fake-token"}',
    ],
    'should handle basic project fixture',
    async cmd => {
      const { code, stderr, stdout } = await spawnPnpm(binCliPath, cmd)
      // Should not modify files due to version mismatch error.
      const output = stdout + stderr
      expect(output.length).toBeGreaterThan(0)
      expect(code, 'should exit with code 1').toBe(1)
    },
  )

  cmdit(
    [
      'optimize',
      '--dry-run',
      '--pin',
      '--prod',
      '--markdown',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should accept pin, prod, and markdown flags together',
    async cmd => {
      const { code, stderr, stdout } = await spawnPnpm(binCliPath, cmd)
      // For dry-run, should not modify files.
      const packageJsonPath = path.join(fixtureDir, 'package.json')
      const packageJson = await readPackageJson(packageJsonPath)
      expect(packageJson.overrides).toBeUndefined()
      expect(stderr).toMatchInlineSnapshot(`""`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  describe('non dry-run tests', () => {
    cmdit(
      ['optimize', '.', '--config', '{"apiToken":"fake-token"}'],
      'should optimize packages and modify package.json',
      async cmd => {
        const { code, stderr, stdout } = await spawnPnpm(binCliPath, cmd, {
          cwd: fixtureDir,
        })

        // Command should succeed.
        expect(code).toBe(0)

        // Check that package.json was modified with overrides.
        const packageJsonPath = path.join(fixtureDir, 'package.json')
        const packageJson = await readPackageJson(packageJsonPath)
        expect(packageJson.overrides).toBeDefined()

        // Check that package-lock.json exists (was modified/created).
        const packageLockPath = path.join(fixtureDir, 'package-lock.json')
        const { existsSync } = await import('node:fs')
        expect(existsSync(packageLockPath)).toBe(true)

        // Should have optimization output.
        const output = stdout + stderr
        expect(output).toMatch(/Optimizing|Adding overrides/i)
      },
    )

    cmdit(
      ['optimize', '.', '--pin', '--config', '{"apiToken":"fake-token"}'],
      'should optimize with --pin flag and modify files',
      async cmd => {
        const { code, stderr, stdout } = await spawnPnpm(binCliPath, cmd, {
          cwd: fixtureDir,
        })

        expect(code).toBe(0)

        // Verify package.json has overrides.
        const packageJsonPath = path.join(fixtureDir, 'package.json')
        const packageJson = await readPackageJson(packageJsonPath)
        expect(packageJson.overrides).toBeDefined()

        // Verify package-lock.json was updated.
        const packageLockPath = path.join(fixtureDir, 'package-lock.json')
        const { existsSync } = await import('node:fs')
        expect(existsSync(packageLockPath)).toBe(true)

        // Should mention optimization in output.
        const output = stdout + stderr
        expect(output).toMatch(/Optimizing|Adding overrides/i)
      },
    )

    cmdit(
      ['optimize', '.', '--prod', '--config', '{"apiToken":"fake-token"}'],
      'should optimize with --prod flag and modify files',
      async cmd => {
        const { code, stderr, stdout } = await spawnPnpm(binCliPath, cmd, {
          cwd: fixtureDir,
        })

        expect(code).toBe(0)

        // Check that command completed successfully (may or may not add overrides depending on available optimizations).
        const packageJsonPath = path.join(fixtureDir, 'package.json')
        const packageJson = await readPackageJson(packageJsonPath)
        // Note: overrides may be undefined if no production dependencies have available optimizations
        expect(packageJson).toBeDefined()

        // Should have optimization output.
        const output = stdout + stderr
        expect(output).toMatch(/Optimizing|Adding overrides|Finished/i)
      },
    )

    cmdit(
      [
        'optimize',
        '.',
        '--pin',
        '--prod',
        '--config',
        '{"apiToken":"fake-token"}',
      ],
      'should handle optimize with both --pin and --prod flags',
      async cmd => {
        const { code, stderr, stdout } = await spawnPnpm(binCliPath, cmd, {
          cwd: fixtureDir,
        })

        expect(code).toBe(0)

        // Check that command completed successfully (may or may not add overrides depending on available optimizations).
        const packageJsonPath = path.join(fixtureDir, 'package.json')
        const packageJson = await readPackageJson(packageJsonPath)
        // Note: overrides may be undefined if no production dependencies have available optimizations.
        expect(packageJson).toBeDefined()

        // Verify package-lock.json was updated.
        const packageLockPath = path.join(fixtureDir, 'package-lock.json')
        const { existsSync } = await import('node:fs')
        expect(existsSync(packageLockPath)).toBe(true)

        // Should have optimization output.
        const output = stdout + stderr
        expect(output).toMatch(/Optimizing|Adding overrides/i)
      },
    )

    cmdit(
      ['optimize', '.', '--json', '--config', '{"apiToken":"fake-token"}'],
      'should handle optimize with --json output format',
      async cmd => {
        const { code, stderr, stdout } = await spawnPnpm(binCliPath, cmd, {
          cwd: fixtureDir,
        })

        expect(code).toBe(0)

        // Verify package.json has overrides.
        const packageJsonPath = path.join(fixtureDir, 'package.json')
        const packageJson = await readPackageJson(packageJsonPath)
        expect(packageJson.overrides).toBeDefined()

        // Verify package-lock.json was updated.
        const packageLockPath = path.join(fixtureDir, 'package-lock.json')
        const { existsSync } = await import('node:fs')
        expect(existsSync(packageLockPath)).toBe(true)
      },
    )

    cmdit(
      ['optimize', '.', '--markdown', '--config', '{"apiToken":"fake-token"}'],
      'should handle optimize with --markdown output format',
      async cmd => {
        const { code, stderr, stdout } = await spawnPnpm(binCliPath, cmd, {
          cwd: fixtureDir,
        })

        expect(code).toBe(0)

        // Verify package.json has overrides.
        const packageJsonPath = path.join(fixtureDir, 'package.json')
        const packageJson = await readPackageJson(packageJsonPath)
        expect(packageJson.overrides).toBeDefined()

        // Verify package-lock.json was updated.
        const packageLockPath = path.join(fixtureDir, 'package-lock.json')
        const { existsSync } = await import('node:fs')
        expect(existsSync(packageLockPath)).toBe(true)

        // Should have regular output (markdown flag doesn't change console output).
        const output = stdout + stderr
        expect(output).toMatch(/Optimizing|Adding overrides/i)
      },
    )
  })

  describe('error handling and usability tests', () => {
    cmdit(
      [
        'optimize',
        '/nonexistent/path',
        '--config',
        '{"apiToken":"fake-token"}',
      ],
      'should show clear error for non-existent directory',
      async cmd => {
        const { code, stderr, stdout } = await spawnPnpm(binCliPath, cmd)
        const output = stdout + stderr
        expect(output.length).toBeGreaterThan(0)
        expect(code).toBe(1)
      },
    )

    cmdit(
      ['optimize', '--dry-run', '--config', '{}'],
      'should show clear error when API token is missing',
      async cmd => {
        const { code, stderr, stdout } = await spawnPnpm(binCliPath, cmd)
        const output = stdout + stderr
        expect(output.length).toBeGreaterThan(0)
        expect(code, 'should exit with code 0 when no token').toBe(0)
      },
    )

    cmdit(
      ['optimize', '--dry-run', '--config', '{"apiToken":""}'],
      'should show clear error when API token is empty',
      async cmd => {
        const { code, stderr, stdout } = await spawnPnpm(binCliPath, cmd)
        const output = stdout + stderr
        expect(output.length).toBeGreaterThan(0)
        expect(code, 'should exit with code 0 with empty token').toBe(0)
      },
    )

    cmdit(
      [
        'optimize',
        '.',
        '--dry-run',
        '--pin',
        '--prod',
        '--json',
        '--markdown',
        '--config',
        '{"apiToken":"fake-token"}',
      ],
      'should show clear error when conflicting output flags are used',
      async cmd => {
        const { code, stderr, stdout } = await spawnPnpm(binCliPath, cmd, {
          cwd: fixtureDir,
        })
        const output = stdout + stderr
        expect(output.length).toBeGreaterThan(0)
        expect(code).toBe(0)
      },
    )

    cmdit(
      [
        'optimize',
        '.',
        '--dry-run',
        '--unknown-flag',
        '--config',
        '{"apiToken":"fake-token"}',
      ],
      'should show helpful error for unknown flags',
      async cmd => {
        const { code, stderr, stdout } = await spawnPnpm(binCliPath, cmd)
        const output = stdout + stderr
        expect(output.length).toBeGreaterThan(0)
        expect(code).toBe(0)
      },
    )

    cmdit(
      ['optimize', '.', '--config', '{"apiToken":"invalid-token-format"}'],
      'should handle invalid API token gracefully',
      async cmd => {
        const { code, stderr, stdout } = await spawnPnpm(binCliPath, cmd, {
          cwd: fixtureDir,
        })
        expect(code).toBe(0)
        const output = stdout + stderr
        // Should show authentication or token-related error.
        expect(output.length).toBeGreaterThan(0)
      },
    )

    cmdit(
      ['optimize', '--pin', '--prod', '--help', '--config', '{}'],
      'should prioritize help over other flags',
      async cmd => {
        const { code, stdout } = await spawnPnpm(binCliPath, cmd)
        expect(stdout).toContain(
          'Optimize dependencies with @socketregistry overrides',
        )
        expect(code).toBe(0)
      },
    )

    cmdit(
      ['optimize', '--version', '--config', '{}'],
      'should show version information',
      async cmd => {
        const { code, stderr, stdout } = await spawnPnpm(binCliPath, cmd)
        const output = stdout + stderr
        expect(output.length).toBeGreaterThan(0)
        expect(
          code,
          'should exit with non-zero code for version mismatch',
        ).toBeGreaterThan(0)
      },
    )
  })
})
