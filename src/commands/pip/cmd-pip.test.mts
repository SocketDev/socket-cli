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
           \\u203c Build/test mode mismatch! Built without VITEST=1 but running in test mode.
        \\u203c This causes snapshot failures. Rebuild with: pnpm run pretest:unit
        \\u203c Build/test mode mismatch! Built without VITEST=1 but running in test mode.
        \\u203c This causes snapshot failures. Rebuild with: pnpm run pretest:unit"
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
           \\u203c Build/test mode mismatch! Built without VITEST=1 but running in test mode.
        \\u203c This causes snapshot failures. Rebuild with: pnpm run pretest:unit
        \\u203c Build/test mode mismatch! Built without VITEST=1 but running in test mode.
        \\u203c This causes snapshot failures. Rebuild with: pnpm run pretest:unit"
      `)
    },
  )
})
