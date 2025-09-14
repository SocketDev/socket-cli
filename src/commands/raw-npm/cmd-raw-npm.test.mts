import { describe, expect } from 'vitest'

import constants from '../../../src/constants.mts'
import { cmdit, spawnPnpm } from '../../../test/utils.mts'

describe('socket raw-npm', async () => {
  const { binCliPath } = constants

  cmdit(
    ['raw-npm', '--help', '--config', '{}'],
    'should support --help',
    async cmd => {
      const { code, stderr, stdout } = await spawnPnpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `
        "Run npm without the Socket wrapper

          Usage
            $ socket raw-npm ...

          Execute \`npm\` without gating installs through the Socket API.
          Useful when  \`socket wrapper on\` is enabled and you want to bypass
          the Socket wrapper. Use at your own risk.

          Note: Everything after "raw-npm" is passed to the npm command.
                Only the \`--dry-run\` and \`--help\` flags are caught here.

          Examples
            $ socket raw-npm install -g cowsay"
      `,
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket raw-npm\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain(
        '`socket raw-npm`',
      )
    },
  )

  cmdit(
    ['raw-npm', '--dry-run', '--config', '{"apiToken":"fakeToken"}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await spawnPnpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket raw-npm\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )
})
