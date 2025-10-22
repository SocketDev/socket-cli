import { describe, expect } from 'vitest'

import { cmdit, spawnSocketCli } from '../../../test/utils.mts'
import { FLAG_CONFIG, FLAG_HELP } from '../constants/cli.mts'
import { getBinCliPath } from '../constants/paths.mts'

const binCliPath = getBinCliPath()

describe('socket pip', async () => {
  cmdit(
    ['pip', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           "
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
           "
      `)
    },
  )
})
