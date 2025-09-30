import { describe, expect } from 'vitest'

import constants, {
  FLAG_CONFIG,
  FLAG_DRY_RUN,
  FLAG_HELP,
} from '../../../src/constants.mts'
import { cmdit, spawnSocketCli } from '../../../test/utils.mts'

describe('socket config', async () => {
  const { binCliPath } = constants

  cmdit(
    ['config', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           "
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain(
        '`socket config`',
      )
    },
  )

  cmdit(
    ['config', FLAG_DRY_RUN, FLAG_CONFIG, '{"apiToken":"fakeToken"}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `""`,
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           "
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )

  describe('config override', () => {
    cmdit(
      ['config', 'get', 'apiToken'],
      'should print nice error when env config override cannot be parsed',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
          // This will be parsed first. If it fails it should fallback to flag or empty.
          env: { SOCKET_CLI_CONFIG: '{apiToken:invalidjson}' },
        })
        expect(stdout).toMatchInlineSnapshot(`""`)
        expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
          "
             "
        `)

        expect(stderr.includes('Could not parse Config as JSON')).toBe(true)
        expect(code, 'bad config input should exit with code 2 ').toBe(2)
      },
    )

    cmdit(
      ['config', 'get', 'apiToken', FLAG_CONFIG, '{apiToken:invalidjson}'],
      'should print nice error when flag config override cannot be parsed',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
        expect(stdout).toMatchInlineSnapshot(`""`)
        expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
          "
             "
        `)

        expect(stderr.includes('Could not parse Config as JSON')).toBe(true)
        expect(code, 'bad config input should exit with code 2 ').toBe(2)
      },
    )
  })
})
