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
        "Setup persistent options for generating manifest files with the \`socket manifest\` command

          Usage
            $ socket manifest setup [CWD=.]

          Options
            --defaultOnReadErrorIf reading the socket.json fails, just use a default config? Warning: This might override the existing json file!
            --help            Print this help

          This command will try to detect all supported ecosystems in given dir and
          start a configuration setup for every one it finds. These configuration
          details are then stored in a local file (which you may or may not commit
          to the repo) and which are loaded when you run \`socket manifest\` for that
          particular dir.

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
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
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
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket manifest setup\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )
})
