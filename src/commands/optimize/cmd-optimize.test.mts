import { describe, expect } from 'vitest'

import constants from '../../../src/constants.mts'
import { cmdit, invokeNpm } from '../../../test/utils.mts'

describe('socket optimize', async () => {
  const { binCliPath } = constants

  cmdit(
    ['optimize', '--help', '--config', '{}'],
    'should support --help',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
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
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
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
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
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
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
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
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
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
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
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
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
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
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
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
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
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
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(stderr).toMatchInlineSnapshot(`""`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'optimize',
      'test/fixtures/commands/optimize/basic-project',
      '--config',
      '{"apiToken":"fake-token"}',
    ],
    'should handle basic project fixture',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
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
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(stderr).toMatchInlineSnapshot(`""`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )
})
