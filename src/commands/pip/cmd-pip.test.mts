import { describe, expect } from 'vitest'

import constants, { FLAG_CONFIG, FLAG_HELP } from '../../../src/constants.mts'
import { cmdit, spawnSocketCli } from '../../../test/utils.mts'

describe('socket pip', async () => {
  const { binCliPath } = constants

  cmdit(
    ['pip', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`
        "Run pip with Socket Firewall security

          Usage
            $ socket pip ...

          Note: Everything after "pip" is forwarded to Socket Firewall (sfw).
                Socket Firewall provides real-time security scanning for pip packages.

          Examples
            $ socket pip install flask
            $ socket pip install -r requirements.txt
            $ socket pip list"
      `)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | CLI: <redacted>
          |__   | * |  _| '_| -_|  _|     | token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket pip\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain('`socket pip`')
    },
  )

  cmdit(
    ['pip', '--version', FLAG_CONFIG, '{"apiToken":"fakeToken"}'],
    'should forward --version to sfw',
    async cmd => {
      const { stderr } = await spawnSocketCli(binCliPath, cmd)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | CLI: <redacted>
          |__   | * |  _| '_| -_|  _|     | token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket pip\`, cwd: <redacted>


        Unknown flag
        --version"
      `)
    },
  )
})
