import { describe, expect } from 'vitest'

import constants, {
  FLAG_CONFIG,
  FLAG_DRY_RUN,
  FLAG_HELP,
} from '../../../src/constants.mts'
import { cmdit, spawnSocketCli } from '../../../test/utils.mts'

describe('socket install completion', async () => {
  const { binCliPath } = constants

  cmdit(
    ['install', 'completion', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `
        "Install bash completion for Socket CLI

          Usage
            $ socket install completion [options] [NAME=socket]

          Installs bash completion for the Socket CLI. This will:
          1. Source the completion script in your current shell
          2. Add the source command to your ~/.bashrc if it's not already there

          This command will only setup tab completion, nothing else.

          Afterwards you should be able to type \`socket \` and then press tab to
          have bash auto-complete/suggest the sub/command or flags.

          Currently only supports bash.

          The optional name argument allows you to enable tab completion on a command
          name other than "socket". Mostly for debugging but also useful if you use a
          different alias for socket on your system.

          Options
            (none)

          Examples

            $ socket install completion
            $ socket install completion sd
            $ socket install completion ./sd"
      `,
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket install completion\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain(
        '`socket install completion`',
      )
    },
  )

  cmdit(
    [
      'install',
      'completion',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket install completion\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )
})
