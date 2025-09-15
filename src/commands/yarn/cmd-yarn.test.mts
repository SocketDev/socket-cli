import { describe, expect } from 'vitest'

import constants from '../../../src/constants.mts'
import { cmdit, spawnSocketCli } from '../../../test/utils.mts'

describe('socket yarn', async () => {
  const { binCliPath } = constants

  cmdit(
    ['yarn', '--help', '--config', '{}'],
    'should support --help',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `
        "Run yarn with the Socket wrapper

          Usage
            $ socket yarn ...

          API Token Requirements
            (none)

          Note: Everything after "yarn" is passed to the yarn command.
                Only the \`--dry-run\` and \`--help\` flags are caught here.

          Use \`socket wrapper on\` to alias this command as \`yarn\`.

          Examples
            $ socket yarn
            $ socket yarn install
            $ socket yarn add package-name
            $ socket yarn dlx package-name"
      `,
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket yarn\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain('`socket yarn`')
    },
  )

  cmdit(
    ['yarn', '--dry-run', '--config', '{"apiToken":"fakeToken"}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
        timeout: 30_000,
      })

      expect(stdout).toMatchInlineSnapshot('"[DryRun]: Bailing now"')
      expect(stderr).toContain('Socket.dev CLI')
      expect(code, 'dry-run without args should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'yarn',
      'add',
      'lodash',
      '--dry-run',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should handle add with --dry-run flag',
    async cmd => {
      const { code } = await spawnSocketCli(binCliPath, cmd, {
        timeout: 30_000,
      })

      expect(code, 'dry-run add should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'yarn',
      'dlx',
      '--quiet',
      'cowsay@^1.6.0',
      'hello',
      '--dry-run',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should handle dlx with version',
    async cmd => {
      const { code } = await spawnSocketCli(binCliPath, cmd, {
        timeout: 30_000,
      })

      expect(code, 'dry-run dlx should exit with code 0').toBe(0)
    },
  )

  cmdit(
    ['yarn', 'install', '--dry-run', '--config', '{"apiToken":"fakeToken"}'],
    'should handle install with --dry-run flag',
    async cmd => {
      const { code } = await spawnSocketCli(binCliPath, cmd, {
        timeout: 30_000,
      })

      expect(code, 'dry-run install should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'yarn',
      'add',
      '@types/node@^20.0.0',
      '--dry-run',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should handle scoped packages with version',
    async cmd => {
      const { code } = await spawnSocketCli(binCliPath, cmd, {
        timeout: 30_000,
      })

      expect(code, 'dry-run add scoped package should exit with code 0').toBe(0)
    },
  )
})
