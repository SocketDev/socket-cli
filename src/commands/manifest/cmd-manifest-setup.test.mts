import { describe, expect } from 'vitest'

import constants from '../../../src/constants.mts'
import { cmdit, invokeNpm } from '../../../test/utils.mts'

describe('socket manifest setup', async () => {
  // Lazily access constants.binCliPath.
  const { binCliPath } = constants

  cmdit(
    ['manifest', 'setup', '--help', '--config', '{}'],
    'should support --help',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `
        "Start interactive configurator to customize default flag values for \`socket manifest\` in this dir

          Usage
            $ socket manifest setup [CWD=.]

          Options
            --default-on-read-error  If reading the socket.json fails, just use a default config? Warning: This might override the existing json file!

          This command will try to detect all supported ecosystems in given CWD. Then
          it starts a configurator where you can setup default values for certain flags
          when creating manifest files in that dir. These configuration details are
          then stored in a local \`socket.json\` file (which you may or may not commit
          to the repo). Next time you run \`socket manifest ...\` it will load this
          json file and any flags which are not explicitly set in the command but which
          have been registered in the json file will get the default value set to that
          value you stored rather than the hardcoded defaults.

          This helps with for example when your build binary is in a particular path
          or when your build tool needs specific opts and you don't want to specify
          them when running the command every time.

          You can also disable manifest generation for certain ecosystems.

          This generated configuration file will only be used locally by the CLI. You
          can commit it to the repo (useful for collaboration) or choose to add it to
          your .gitignore all the same. Only this CLI will use it.

          Examples
            $ socket manifest setup
            $ socket manifest setup ./proj"
      `,
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket manifest setup\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain(
        '`socket manifest setup`',
      )
    },
  )

  cmdit(
    ['manifest', 'setup', '--dry-run', '--config', '{}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket manifest setup\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )
})
