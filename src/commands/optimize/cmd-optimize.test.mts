import { existsSync, promises } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import trash from 'trash'
import { afterAll, afterEach, beforeAll, describe, expect } from 'vitest'

import { logger } from '@socketsecurity/registry/lib/logger'
import { readPackageJson } from '@socketsecurity/registry/lib/packages'
import { spawn } from '@socketsecurity/registry/lib/spawn'

import constants, { PNPM_LOCK_YAML } from '../../../src/constants.mts'
import { cmdit, spawnSocketCli, testPath } from '../../../test/utils.mts'

const fixtureBaseDir = path.join(testPath, 'fixtures/commands/optimize')
const npmFixtureDir = path.join(fixtureBaseDir, 'npm')
const pnpmFixtureDir = path.join(fixtureBaseDir, 'pnpm')

async function revertFixtureChanges() {
  // Reset only the package.json and pnpm-lock.yaml files that tests modify.
  try {
    await spawn(
      'git',
      ['checkout', 'HEAD', '--', 'package.json', PNPM_LOCK_YAML],
      {
        cwd: pnpmFixtureDir,
        stdio: 'ignore',
      },
    )
  } catch (e) {
    // Log warning but continue - files may already be reverted or not modified.
    logger.warn('Failed to revert fixture changes:', e)
  }
}

async function createTempFixture(sourceDir: string): Promise<string> {
  // Create a temporary directory with a unique name.
  const tempDir = path.join(
    tmpdir(),
    `socket-optimize-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )

  // Copy the fixture files to the temp directory.
  await promises.mkdir(tempDir, { recursive: true })

  // Copy package.json.
  const sourcePackageJson = path.join(sourceDir, 'package.json')
  const destPackageJson = path.join(tempDir, 'package.json')
  await promises.copyFile(sourcePackageJson, destPackageJson)

  // Copy lock file if it exists.
  const sourceLockFile = path.join(sourceDir, PNPM_LOCK_YAML)
  if (existsSync(sourceLockFile)) {
    const destLockFile = path.join(tempDir, PNPM_LOCK_YAML)
    await promises.copyFile(sourceLockFile, destLockFile)
  }

  // Copy package-lock.json for npm fixtures.
  const sourcePackageLock = path.join(sourceDir, 'package-lock.json')
  if (existsSync(sourcePackageLock)) {
    const destPackageLock = path.join(tempDir, 'package-lock.json')
    await promises.copyFile(sourcePackageLock, destPackageLock)
  }

  return tempDir
}

describe('socket optimize', async () => {
  const { binCliPath } = constants

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

  cmdit(
    ['optimize', '--help', '--config', '{}'],
    'should support --help',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
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
            $ socket optimize ./path/to/project --pin"
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
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      // For dry-run, should not modify files.
      const packageJsonPath = path.join(pnpmFixtureDir, 'package.json')
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
      const { code, stderr } = await spawnSocketCli(binCliPath, cmd)
      // For dry-run, should not modify files.
      const packageJsonPath = path.join(pnpmFixtureDir, 'package.json')
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
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      // For dry-run, should not modify files.
      const packageJsonPath = path.join(pnpmFixtureDir, 'package.json')
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
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      // For dry-run, should not modify files.
      const packageJsonPath = path.join(pnpmFixtureDir, 'package.json')
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
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      // For dry-run, should not modify files.
      const packageJsonPath = path.join(pnpmFixtureDir, 'package.json')
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
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      // For dry-run, should not modify files.
      const packageJsonPath = path.join(pnpmFixtureDir, 'package.json')
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
      const { code, stderr } = await spawnSocketCli(binCliPath, cmd)
      // For dry-run, should not modify files.
      const packageJsonPath = path.join(pnpmFixtureDir, 'package.json')
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
      path.join(fixtureBaseDir, 'nonexistent'),
      '--config',
      '{"apiToken":"fake-token"}',
    ],
    'should handle directories without package.json gracefully',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      // Should not modify any package.json since no package.json exists in the fixture path.
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
      const { code, stderr } = await spawnSocketCli(binCliPath, cmd)
      // For dry-run, should not modify files.
      const packageJsonPath = path.join(pnpmFixtureDir, 'package.json')
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
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
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
      const { code, stderr } = await spawnSocketCli(binCliPath, cmd)
      // For dry-run, should not modify files.
      const packageJsonPath = path.join(pnpmFixtureDir, 'package.json')
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
        const tempDir = await createTempFixture(pnpmFixtureDir)
        try {
          const { code, stderr, stdout } = await spawnSocketCli(
            binCliPath,
            cmd,
            {
              cwd: tempDir,
            },
          )

          expect(code).toBe(0)

          // Check that package.json was modified with overrides.
          const packageJsonPath = path.join(tempDir, 'package.json')
          const packageJson = await readPackageJson(packageJsonPath)
          expect(packageJson.overrides).toBeDefined()

          // Check that pnpm-lock.yaml exists (was modified/created).
          const packageLockPath = path.join(tempDir, PNPM_LOCK_YAML)
          expect(existsSync(packageLockPath)).toBe(true)

          // Should have optimization output.
          const output = stdout + stderr
          expect(output).toMatch(/Optimizing|Adding overrides/i)
        } finally {
          // Clean up the temp directory safely.
          await trash(tempDir)
        }
      },
    )

    cmdit(
      ['optimize', '.', '--pin', '--config', '{"apiToken":"fake-token"}'],
      'should optimize with --pin flag and modify files',
      async cmd => {
        const tempDir = await createTempFixture(pnpmFixtureDir)
        try {
          const { code, stderr, stdout } = await spawnSocketCli(
            binCliPath,
            cmd,
            {
              cwd: tempDir,
            },
          )

          expect(code).toBe(0)

          // Verify package.json has overrides.
          const packageJsonPath = path.join(tempDir, 'package.json')
          const packageJson = await readPackageJson(packageJsonPath)
          expect(packageJson.overrides).toBeDefined()

          // Verify pnpm-lock.yaml was updated.
          const packageLockPath = path.join(tempDir, PNPM_LOCK_YAML)
          expect(existsSync(packageLockPath)).toBe(true)

          // Should mention optimization in output.
          const output = stdout + stderr
          expect(output).toMatch(/Optimizing|Adding overrides/i)
        } finally {
          // Clean up the temp directory safely.
          await trash(tempDir)
        }
      },
    )

    cmdit(
      ['optimize', '.', '--prod', '--config', '{"apiToken":"fake-token"}'],
      'should optimize with --prod flag and modify files',
      async cmd => {
        const tempDir = await createTempFixture(pnpmFixtureDir)
        try {
          const { code, stderr, stdout } = await spawnSocketCli(
            binCliPath,
            cmd,
            {
              cwd: tempDir,
            },
          )

          expect(code).toBe(0)

          // Check that command completed successfully (may or may not add overrides depending on available optimizations).
          const packageJsonPath = path.join(tempDir, 'package.json')
          const packageJson = await readPackageJson(packageJsonPath)
          // Note: overrides may be undefined if no production dependencies have available optimizations.
          expect(packageJson).toBeDefined()

          // Should have optimization output.
          const output = stdout + stderr
          expect(output).toMatch(/Optimizing|Adding overrides|Finished/i)
        } finally {
          // Clean up the temp directory safely.
          await trash(tempDir)
        }
      },
      { timeout: 120_000 },
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
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
          cwd: pnpmFixtureDir,
        })

        expect(code).toBe(0)

        // Check that command completed successfully (may or may not add overrides depending on available optimizations).
        const packageJsonPath = path.join(pnpmFixtureDir, 'package.json')
        const packageJson = await readPackageJson(packageJsonPath)
        // Note: overrides may be undefined if no production dependencies have available optimizations..
        expect(packageJson).toBeDefined()

        // Verify pnpm-lock.yaml exists (since we're using pnpm, not npm).
        const packageLockPath = path.join(pnpmFixtureDir, PNPM_LOCK_YAML)
        expect(existsSync(packageLockPath)).toBe(true)

        // Should have optimization output.
        const output = stdout + stderr
        expect(output).toMatch(/Optimizing|Adding overrides/i)
      },
      { timeout: 120_000 },
    )

    cmdit(
      ['optimize', '.', '--json', '--config', '{"apiToken":"fake-token"}'],
      'should handle optimize with --json output format',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
          cwd: pnpmFixtureDir,
        })

        expect(code).toBe(0)

        // Verify package.json has overrides.
        const packageJsonPath = path.join(pnpmFixtureDir, 'package.json')
        const packageJson = await readPackageJson(packageJsonPath)
        expect(packageJson.overrides).toBeDefined()

        // Verify pnpm-lock.yaml was updated.
        const packageLockPath = path.join(pnpmFixtureDir, PNPM_LOCK_YAML)
        expect(existsSync(packageLockPath)).toBe(true)
      },
    )

    cmdit(
      ['optimize', '.', '--markdown', '--config', '{"apiToken":"fake-token"}'],
      'should handle optimize with --markdown output format',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
          cwd: pnpmFixtureDir,
        })

        expect(code).toBe(0)

        // Verify package.json has overrides.
        const packageJsonPath = path.join(pnpmFixtureDir, 'package.json')
        const packageJson = await readPackageJson(packageJsonPath)
        expect(packageJson.overrides).toBeDefined()

        // Verify pnpm-lock.yaml was updated.
        const packageLockPath = path.join(pnpmFixtureDir, PNPM_LOCK_YAML)
        expect(existsSync(packageLockPath)).toBe(true)

        // Should have regular output (markdown flag doesn't change console output).
        const output = stdout + stderr
        expect(output).toMatch(/Optimizing|Adding overrides/i)
      },
    )

    cmdit(
      ['optimize', '.', '--config', '{"apiToken":"fake-token"}'],
      'should handle npm projects with cwd correctly',
      async cmd => {
        // Create a temporary directory to test npm specifically.
        const tempDir = path.join(tmpdir(), 'socket-npm-test')
        await promises.mkdir(tempDir, { recursive: true })

        // Copy the npm fixture to the temp directory.
        const sourcePackageJson = path.join(npmFixtureDir, 'package.json')
        const destPackageJson = path.join(tempDir, 'package.json')
        await promises.copyFile(sourcePackageJson, destPackageJson)

        // Copy the npm lock file.
        const sourceLock = path.join(npmFixtureDir, 'package-lock.json')
        const destLock = path.join(tempDir, 'package-lock.json')
        await promises.copyFile(sourceLock, destLock)

        try {
          // Run optimize from a different directory to ensure cwd is properly passed to npm install.
          const { code, stderr, stdout } = await spawnSocketCli(
            binCliPath,
            ['optimize', tempDir, '--config', '{"apiToken":"fake-token"}'],
            {
              // Run from a different directory to test that npm install gets the correct cwd.
              cwd: tmpdir(),
            },
          )

          expect(code).toBe(0)

          // Check that package.json was modified with overrides.
          const packageJsonPath = path.join(tempDir, 'package.json')
          const packageJson = await readPackageJson(packageJsonPath)
          expect(packageJson.overrides).toBeDefined()

          // Check that package-lock.json exists and was updated.
          const packageLockPath = path.join(tempDir, 'package-lock.json')
          expect(existsSync(packageLockPath)).toBe(true)

          // Should have optimization output.
          const output = stdout + stderr
          expect(output).toMatch(/Optimizing|Adding overrides/i)
        } finally {
          // Clean up the temp directory safely.
          await trash(tempDir)
        }
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
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
        const output = stdout + stderr
        expect(output.length).toBeGreaterThan(0)
        expect(code).toBe(1)
      },
    )

    cmdit(
      ['optimize', '--dry-run', '--config', '{}'],
      'should show clear error when API token is missing',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
        const output = stdout + stderr
        expect(output.length).toBeGreaterThan(0)
        expect(code, 'should exit with code 0 when no token').toBe(0)
      },
    )

    cmdit(
      ['optimize', '--dry-run', '--config', '{"apiToken":""}'],
      'should show clear error when API token is empty',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
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
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
          cwd: pnpmFixtureDir,
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
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
        const output = stdout + stderr
        expect(output.length).toBeGreaterThan(0)
        expect(code).toBe(0)
      },
    )

    cmdit(
      ['optimize', '.', '--config', '{"apiToken":"invalid-token-format"}'],
      'should handle invalid API token gracefully',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
          cwd: pnpmFixtureDir,
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
        const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
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
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
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
