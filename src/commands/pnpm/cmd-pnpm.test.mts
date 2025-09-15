import { describe, expect } from 'vitest'

import constants from '../../../src/constants.mts'
import { cmdit, spawnSocketCli } from '../../../test/utils.mts'

describe('socket pnpm', async () => {
  const { binCliPath } = constants

  cmdit(
    ['pnpm', '--help', '--config', '{}'],
    'should support --help',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `
        "Run pnpm with the Socket wrapper

          Usage
            $ socket pnpm ...

          API Token Requirements
            (none)

          Note: Everything after "pnpm" is passed to the pnpm command.
                Only the \`--dry-run\` and \`--help\` flags are caught here.

          Use \`socket wrapper on\` to alias this command as \`pnpm\`.

          Examples
            $ socket pnpm
            $ socket pnpm install
            $ socket pnpm add package-name
            $ socket pnpm dlx package-name"
      `,
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket pnpm\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain('`socket pnpm`')
    },
  )

  cmdit(
    ['pnpm', '--dry-run', '--config', '{"apiToken":"fakeToken"}'],
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
      'pnpm',
      'add',
      'lodash',
      '--dry-run',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should handle add with --dry-run flag',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd, {
        timeout: 30_000,
      })

      expect(stdout).toMatchInlineSnapshot('"[DryRun]: Bailing now"')
      expect(code, 'dry-run add should exit with code 0').toBe(0)
    },
  )

  cmdit(
    ['pnpm', 'install', '--dry-run', '--config', '{"apiToken":"fakeToken"}'],
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
      'pnpm',
      'add',
      '@types/node@^20.0.0',
      '--dry-run',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should handle scoped packages with version',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd, {
        timeout: 30_000,
      })

      expect(stdout).toMatchInlineSnapshot('"[DryRun]: Bailing now"')
      expect(code, 'dry-run add scoped package should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'pnpm',
      'dlx',
      '--silent',
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
})
