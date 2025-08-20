import { describe, expect } from 'vitest'

import constants from '../../../src/constants.mts'
import { cmdit, invokeNpm } from '../../../test/utils.mts'

describe('socket fix', async () => {
  // Lazily access constants.binCliPath.
  const { binCliPath } = constants

  cmdit(
    ['fix', '--help', '--config', '{}'],
    'should support --help',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `
        "Update dependencies with "fixable" Socket alerts

          Usage
            $ socket fix [options] [CWD=.]

          API Token Requirements
            - Quota: 100 units
            - Permissions: packages:list

          Options
            --auto-merge        Enable auto-merge for pull requests that Socket opens.
                                See GitHub documentation (\\u200bhttps://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-auto-merge-for-pull-requests-in-your-repository\\u200b) for managing auto-merge for pull requests in your repository.
            --autopilot         Shorthand for --auto-merge --test
            --limit             The number of fixes to attempt at a time (default 10)
            --min-satisfying    Constrain dependency updates to the minimum satisfying version
            --purl              Provide a list of PURLs (\\u200bhttps://github.com/package-url/purl-spec?tab=readme-ov-file#purl\\u200b) to compute fixes for, as either a comma separated value or as
                                multiple flags, instead of querying the Socket API
            --range-style       Define how dependency version ranges are updated in package.json (default 'preserve').
                                Available styles:
                                  * caret - Use ^ range for compatible updates (e.g. ^1.2.3)
                                  * gt - Use > to allow any newer version (e.g. >1.2.3)
                                  * gte - Use >= to allow any newer version (e.g. >=1.2.3)
                                  * lt - Use < to allow only lower versions (e.g. <1.2.3)
                                  * lte - Use <= to allow only lower versions (e.g. <=1.2.3)
                                  * pin - Use the exact version (e.g. 1.2.3)
                                  * preserve - Retain the existing version range style as-is
                                  * tilde - Use ~ range for patch/minor updates (e.g. ~1.2.3)
            --test              Verify the fix by running unit tests
            --test-script       The test script to run for fix attempts (default 'test')

          Examples
            $ socket fix
            $ socket fix ./proj/tree --auto-merge"
      `,
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket fix\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain('`socket fix`')
    },
  )

  cmdit(
    ['fix', '--dry-run', '--config', '{"apiToken":"fakeToken"}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket fix\`, cwd: <redacted>"
      `)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Not saving"`)
      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )
})
