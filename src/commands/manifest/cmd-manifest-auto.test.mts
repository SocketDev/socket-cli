import { describe, expect } from 'vitest'

import constants from '../../../src/constants.mts'
import { cmdit, spawnPnpm } from '../../../test/utils.mts'

describe('socket manifest auto', async () => {
  const { binCliPath } = constants

  cmdit(
    ['manifest', 'auto', '--help', '--config', '{}'],
    'should support --help',
    async cmd => {
      const { code, stderr, stdout } = await spawnPnpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `
        "Auto-detect build and attempt to generate manifest file

          Usage
            $ socket manifest auto [options] [CWD=.]

          Options
            --verbose           Enable debug output (only for auto itself; sub-steps need to have it pre-configured), may help when running into errors

          Tries to figure out what language your target repo uses. If it finds a
          supported case then it will try to generate the manifest file for that
          language with the default or detected settings.

          Note: you can exclude languages from being auto-generated if you don't want
                them to. Run \`socket manifest setup\` in the same dir to disable it.

          Examples

            $ socket manifest auto
            $ socket manifest auto ./project/foo"
      `,
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket manifest auto\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain(
        '`socket manifest auto`',
      )
    },
  )

  cmdit(
    ['manifest', 'auto', '--dry-run', '--config', '{"apiToken":"fakeToken"}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await spawnPnpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket manifest auto\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )
})
