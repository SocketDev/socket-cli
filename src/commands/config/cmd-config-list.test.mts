import path from 'node:path'

import { describe, expect } from 'vitest'

import constants, {
  FLAG_CONFIG,
  FLAG_DRY_RUN,
  FLAG_HELP,
} from '../../../src/constants.mts'
import { cmdit, spawnSocketCli } from '../../../test/utils.mts'

describe('socket config get', async () => {
  const { binCliPath } = constants

  cmdit(
    ['config', 'list', FLAG_HELP, FLAG_CONFIG, '{}'],
    'should support --help',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `
        "Show all local CLI config items and their values

          Usage
            $ socket config list [options]

          Options
            --full              Show full tokens in plaintext (unsafe)
            --json              Output result as json
            --markdown          Output result as markdown

          Examples
            $ socket config list"
      `,
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket config list\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain(
        '`socket config list`',
      )
    },
  )

  cmdit(
    ['config', 'list', FLAG_DRY_RUN, FLAG_CONFIG, '{"apiToken":"fakeToken"}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket config list\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )
})
