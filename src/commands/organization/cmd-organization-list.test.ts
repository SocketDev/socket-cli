import path from 'node:path'

import { describe, expect } from 'vitest'

import constants from '../../../src/constants'
import { cmdit, invokeNpm } from '../../../test/utils'

const { CLI } = constants

describe('socket organization list', async () => {
  // Lazily access constants.rootBinPath.
  const entryPath = path.join(constants.rootBinPath, `${CLI}.js`)

  cmdit(
    ['organization', 'list', '--help', '--config', '{}'],
    'should support --help',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(entryPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `
        "List organizations associated with the API key used

          Usage
            $ socket organization list

          API Token Requirements
            - Quota: 1 unit
            - Permissions: none (does need a token)

          Options
            --help            Print this help
            --json            Output result as json
            --markdown        Output result as markdown"
      `
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket organization list\`, cwd: <redacted>
        \\x1b[1m   \\x1b[31mWarning:\\x1b[39m NodeJS version 19 and lower will be \\x1b[31munsupported\\x1b[39m after April 30th, 2025.\\x1b[22m
                    Soon after the Socket CLI will require NodeJS version 20 or higher."
      `)

      expect(code, 'help should exit with code 2').toBe(2)
      expect(stderr, 'banner includes base command').toContain(
        '`socket organization list`'
      )
    }
  )

  cmdit(
    [
      'organization',
      'list',
      '--dry-run',
      '--config',
      '{"apiToken":"anything"}'
    ],
    'should be ok with org name and id',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(entryPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket organization list\`, cwd: <redacted>
        \\x1b[1m   \\x1b[31mWarning:\\x1b[39m NodeJS version 19 and lower will be \\x1b[31munsupported\\x1b[39m after April 30th, 2025.\\x1b[22m
                    Soon after the Socket CLI will require NodeJS version 20 or higher."
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    }
  )
})
