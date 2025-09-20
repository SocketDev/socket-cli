import { describe, expect } from 'vitest'

import constants, {
  FLAG_CONFIG,
  FLAG_DRY_RUN,
  FLAG_HELP,
} from '../../../src/constants.mts'
import { cmdit, spawnSocketCli } from '../../../test/utils.mts'

describe('socket wrapper', async () => {
  const { binCliPath } = constants

  cmdit(
    ['wrapper', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `
        "Enable or disable the Socket npm/npx wrapper

          Usage
            $ socket wrapper <"on" | "off">

          Options
            (none)

          While enabled, the wrapper makes it so that when you call npm/npx on your
          machine, it will automatically actually run \`socket npm\` / \`socket npx\`
          instead.

          Examples
            $ socket wrapper on
            $ socket wrapper off"
      `,
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev (https://socket.dev) CLI: <redacted>
          |__   | * |  _| '_| -_|  _|     | token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket wrapper\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain(
        '`socket wrapper`',
      )
    },
  )

  cmdit(
    ['wrapper', FLAG_DRY_RUN, FLAG_CONFIG, '{}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev (https://socket.dev) CLI: <redacted>
          |__   | * |  _| '_| -_|  _|     | token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket wrapper\`, cwd: <redacted>

        \\xd7  Input error:  Please review the input requirements and try again

          \\xd7 Must specify "on" or "off" argument (missing)"
      `)

      expect(code, 'dry-run should exit with code 2 if missing input').toBe(2)
    },
  )

  cmdit(
    ['wrapper', FLAG_DRY_RUN, 'on', FLAG_CONFIG, '{"apiToken":"fakeToken"}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev (https://socket.dev) CLI: <redacted>
          |__   | * |  _| '_| -_|  _|     | token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket wrapper\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )
})
