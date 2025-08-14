import { describe, expect } from 'vitest'

import constants from '../../../src/constants.mts'
import { cmdit, invokeNpm } from '../../../test/utils.mts'

describe('socket scan setup', async () => {
  // Lazily access constants.binCliPath.
  const { binCliPath } = constants

  cmdit(
    ['scan', 'setup', '--help', '--config', '{}'],
    'should support --help',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `
        "Start interactive configurator to customize default flag values for \`socket scan\` in this dir

          Usage
            $ socket scan setup [options] [CWD=.]

          Options
            --default-on-read-error  If reading the socket.json fails, just use a default config? Warning: This might override the existing json file!

          Interactive configurator to create a local json file in the target directory
          that helps to set flag defaults for \`socket scan create\`.

          This helps to configure the (Socket reported) repo and branch names, as well
          as which branch name is the "default branch" (main, master, etc). This way
          you don't have to specify these flags when creating a scan in this dir.

          This generated configuration file will only be used locally by the CLI. You
          can commit it to the repo (useful for collaboration) or choose to add it to
          your .gitignore all the same. Only this CLI will use it.

          Examples

            $ socket scan setup
            $ socket scan setup ./proj"
      `,
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket scan setup\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain(
        '`socket scan setup`',
      )
    },
  )

  cmdit(
    [
      'scan',
      'setup',
      'fakeOrg',
      'scanidee',
      '--dry-run',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket scan setup\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )
})
