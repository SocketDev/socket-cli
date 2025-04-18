import path from 'node:path'

import { describe, expect } from 'vitest'

import constants from '../../../src/constants'
import { cmdit, invokeNpm } from '../../../test/utils'

const { CLI } = constants

describe('socket fix', async () => {
  // Lazily access constants.rootBinPath.
  const entryPath = path.join(constants.rootBinPath, `${CLI}.js`)

  cmdit(
    ['fix', '--help', '--config', '{}'],
    'should support --help',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(entryPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `
        "Fix "fixable" Socket alerts

              Usage
                $ socket fix

              Options
                --autoMerge       Enable auto-merge for pull requests that Socket opens.
                                  See GitHub documentation (\\u200bhttps://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-auto-merge-for-pull-requests-in-your-repository\\u200b) for managing auto-merge for pull requests in your repository.
                --autoPilot       Shorthand for --autoMerge --test
                --help            Print this help
                --purl            User provided PURL to fix
                --rangeStyle      Define how updated dependency versions should be written in package.json.
          Available styles:
            *\\x09caret - Use ^ range for compatible updates (e.g. ^1.2.3)
            *\\x09gt - Use >= to allow any newer version (e.g. >=1.2.3)
            *\\x09lt - Use < to allow only lower versions (e.g. <1.2.3)
            *\\x09pin - Use the exact version (e.g. 1.2.3)
            *\\x09preserve - Retain the existing version range as-is
            *\\x09tilde - Use ~ range for patch/minor updates (e.g. ~1.2.3)
                --test            Verify the fix by running unit tests
                --testScript      The test script to run for each fix attempt"
      `
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket fix\`, cwd: <redacted>"
      `)

      expect(code, 'help should exit with code 2').toBe(2)
      expect(stderr, 'banner includes base command').toContain('`socket fix`')
    }
  )

  cmdit(
    ['fix', '--dry-run', '--config', '{"apiToken":"anything"}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(entryPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket fix\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    }
  )
})
