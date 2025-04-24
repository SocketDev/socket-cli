import path from 'node:path'

import { describe, expect } from 'vitest'

import constants from '../../../src/constants'
import { cmdit, invokeNpm } from '../../../test/utils'

const { CLI } = constants

describe('socket dependencies', async () => {
  // Lazily access constants.rootBinPath.
  const entryPath = path.join(constants.rootBinPath, `${CLI}.js`)

  cmdit(
    ['dependencies', '--help', '--config', '{}'],
    'should support --help',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(entryPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `
        "Search for any dependency that is being used in your organization

          Usage
            socket dependencies

          API Token Requirements
            - Quota: 1 unit
            - Permissions: none (does need token with access to target org)

          Options
            --help            Print this help
            --json            Output result as json
            --limit           Maximum number of dependencies returned
            --markdown        Output result as markdown
            --offset          Page number

          Examples
            socket dependencies --limit 20 --offset 10"
      `
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket dependencies\`, cwd: <redacted>
        \\x1b[1m   \\x1b[31mWarning:\\x1b[39m NodeJS version 19 and lower will be \\x1b[31munsupported\\x1b[39m after April 30th, 2025.\\x1b[22m
                    Soon after the Socket CLI will require NodeJS version 20 or higher."
      `)

      expect(code, 'help should exit with code 2').toBe(2)
      expect(stderr, 'banner includes base command').toContain(
        '`socket dependencies`'
      )
    }
  )

  cmdit(
    ['dependencies', '--dry-run', '--config', '{"apiToken":"anything"}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(entryPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket dependencies\`, cwd: <redacted>
        \\x1b[1m   \\x1b[31mWarning:\\x1b[39m NodeJS version 19 and lower will be \\x1b[31munsupported\\x1b[39m after April 30th, 2025.\\x1b[22m
                    Soon after the Socket CLI will require NodeJS version 20 or higher."
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    }
  )
})
