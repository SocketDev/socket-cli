import { describe, expect } from 'vitest'

import constants from '../../../src/constants.mts'
import { cmdit, spawnPnpm } from '../../../test/utils.mts'

describe('socket uninstall', async () => {
  const { binCliPath } = constants

  cmdit(
    ['uninstall', '--help', '--config', '{}'],
    'should support --help',
    async cmd => {
      const { code, stderr, stdout } = await spawnPnpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `
        "Uninstall Socket CLI tab completion

          Usage
            $ socket uninstall <command>

          Commands
            completion                  Uninstall bash completion for Socket CLI

          Options

            --no-banner                 Hide the Socket banner
            --no-spinner                Hide the console spinner"
      `,
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket uninstall\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain(
        '`socket uninstall`',
      )
    },
  )

  cmdit(
    ['uninstall', '--dry-run', '--config', '{"apiToken":"fakeToken"}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await spawnPnpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `"[DryRun]: No-op, call a sub-command; ok"`,
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket uninstall\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )
})
