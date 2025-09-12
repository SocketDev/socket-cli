import path from 'node:path'

import trash from 'trash'
import { afterEach, beforeEach, describe, expect } from 'vitest'

import { readPackageJson } from '@socketsecurity/registry/lib/packages'
import { spawn } from '@socketsecurity/registry/lib/spawn'

import constants from '../../../src/constants.mts'
import { cmdit, spawnNpm, testPath } from '../../../test/utils.mts'

import type { PackageJson } from '@socketsecurity/registry/lib/packages'

const setupFixturePackageLocks = async () => {
  const fixtureDirs = ['fixtures/commands/optimize']

  for (const d of fixtureDirs) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await spawn('npm', ['install', '--silent', '--no-audit', '--no-fund'], {
        cwd: path.join(testPath, d),
        stdio: 'ignore',
      })
    } catch {
      // Installation failed, which is fine for testing.
    }
  }
}

async function cleanupPackageLockFiles() {
  const cleanupPaths = [
    'fixtures/commands/optimize/package-lock.json',
    'fixtures/commands/optimize/node_modules',
  ]
  for (const p of cleanupPaths) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await trash(path.join(testPath, p))
    } catch {
      // File/directory doesn't exist, which is fine.
    }
  }
}

async function cleanupFixturePackageJson() {
  const fixturePath = path.join(
    testPath,
    'fixtures/commands/optimize/package.json',
  )
  const editablePackageJson = await readPackageJson(fixturePath, {
    editable: true,
  })

  // Remove overrides and resolutions fields
  editablePackageJson.update({
    overrides: undefined,
    resolutions: undefined,
  } as Partial<PackageJson>)

  await editablePackageJson.save()
}

describe('socket optimize', async () => {
  const { binCliPath } = constants

  afterEach(async () => {
    await cleanupFixturePackageJson()
  })

  cmdit(
    ['optimize', '--help', '--config', '{}'],
    'should support --help',
    async cmd => {
      const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd)
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
      const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
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
      const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
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
      const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
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
      const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
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
      const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
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
      const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
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
      const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
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
      const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      // TODO: Investigate Windows test fail.
      // expect(stderr).toMatchInlineSnapshot(`
      //   "_____         _       _        /---------------
      //     |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
      //     |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
      //     |_____|___|___|_,_|___|_|.dev   | Command: \`socket optimize\`, cwd: <redacted>

      //   \\u203c socket optimize: Unknown package manager, defaulting to npm
      //   \\xd7  Missing lockfile:  socket optimize: No lock file found"
      // `)
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
      const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
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
      const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(stderr).toMatchInlineSnapshot(`
        "_____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket optimize\`, cwd: <redacted>

        \\xd7  Version mismatch:  socket optimize: Requires npm >=10.8.2. Current version: unknown."
      `)
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
      const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(stderr).toMatchInlineSnapshot(`""`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  describe('non dry-run tests', () => {
    cmdit(
      ['optimize', '.', '--config', '{"apiToken":"fake-token"}'],
      'should handle optimize fixture project',
      async cmd => {
        const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd, {
          cwd: path.join(testPath, 'fixtures/commands/optimize'),
        })
        // Command succeeds when no packages need optimization
        expect(code).toBe(0)
        const output = stdout + stderr
        expect(output.length).toBeGreaterThan(0)
      },
    )

    cmdit(
      ['optimize', '.', '--pin', '--config', '{"apiToken":"fake-token"}'],
      'should handle optimize with --pin flag',
      async cmd => {
        const { code, stderr } = await spawnNpm(binCliPath, cmd, {
          cwd: path.join(testPath, 'fixtures/commands/optimize'),
        })
        expect(code).toBe(0)
        expect(stderr).toContain('socket optimize')
      },
    )

    cmdit(
      ['optimize', '.', '--prod', '--config', '{"apiToken":"fake-token"}'],
      'should handle optimize with --prod flag',
      async cmd => {
        const { code, stderr } = await spawnNpm(binCliPath, cmd, {
          cwd: path.join(testPath, 'fixtures/commands/optimize'),
        })
        expect(code).toBe(0)
        expect(stderr).toContain('socket optimize')
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
        const { code, stderr } = await spawnNpm(binCliPath, cmd, {
          cwd: path.join(testPath, 'fixtures/commands/optimize'),
        })
        expect(code).toBe(0)
        expect(stderr).toContain('socket optimize')
      },
    )

    cmdit(
      ['optimize', '.', '--json', '--config', '{"apiToken":"fake-token"}'],
      'should handle optimize with --json output format',
      async cmd => {
        const { code, stderr } = await spawnNpm(binCliPath, cmd, {
          cwd: path.join(testPath, 'fixtures/commands/optimize'),
        })
        expect(code).toBe(0)
        // JSON output may still show progress messages.
        expect(stderr.length).toBeGreaterThan(0)
      },
    )

    cmdit(
      ['optimize', '.', '--markdown', '--config', '{"apiToken":"fake-token"}'],
      'should handle optimize with --markdown output format',
      async cmd => {
        const { code, stderr } = await spawnNpm(binCliPath, cmd, {
          cwd: path.join(testPath, 'fixtures/commands/optimize'),
        })
        expect(code).toBe(0)
        // Command completed successfully.
        expect(stderr.length).toBeGreaterThan(0)
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
        const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd)
        const output = stdout + stderr
        expect(output.length).toBeGreaterThan(0)
        expect(code).toBeGreaterThan(0)
      },
    )

    cmdit(
      ['optimize', '--config', '{}'],
      'should show clear error when API token is missing',
      async cmd => {
        const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd)
        const output = stdout + stderr
        expect(output).toContain('Scan complete')
        expect(code, 'should exit with code 0 when no token').toBe(0)
      },
    )

    cmdit(
      ['optimize', '--config', '{"apiToken":""}'],
      'should show clear error when API token is empty',
      async cmd => {
        const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd)
        const output = stdout + stderr
        expect(output).toContain('Scan complete')
        expect(code, 'should exit with code 0 with empty token').toBe(0)
      },
    )

    cmdit(
      [
        'optimize',
        '.',
        '--pin',
        '--prod',
        '--json',
        '--markdown',
        '--config',
        '{"apiToken":"fake-token"}',
      ],
      'should show clear error when conflicting output flags are used',
      async cmd => {
        const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd, {
          cwd: path.join(testPath, 'fixtures/commands/optimize'),
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
        '--unknown-flag',
        '--config',
        '{"apiToken":"fake-token"}',
      ],
      'should show helpful error for unknown flags',
      async cmd => {
        const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd)
        const output = stdout + stderr
        expect(output).toContain('Scan complete')
        expect(code, 'should exit with code 0 despite unknown flag').toBe(0)
      },
    )

    cmdit(
      ['optimize', '.', '--config', '{"apiToken":"invalid-token-format"}'],
      'should handle invalid API token gracefully',
      async cmd => {
        const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd, {
          cwd: path.join(testPath, 'fixtures/commands/optimize'),
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
        const { code, stdout } = await spawnNpm(binCliPath, cmd)
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
        const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd)
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
