import path from 'node:path'

import { describe, expect } from 'vitest'

import constants from '../../../src/constants.mts'
import { cmdit, invokeNpm } from '../../../test/utils.mts'

describe('socket json', async () => {
  // Lazily access constants.binCliPath.
  const { binCliPath } = constants

  cmdit(
    ['json', '--help', '--config', '{}'],
    'should support --help',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `
        "Display the \`socket.json\` that would be applied for target folder

          Usage
            $ socket json [CWD=.]

          Display the \`socket.json\` file that would apply when running relevant commands
          in the target directory."
      `,
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket json\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain('`socket json`')
    },
  )

  cmdit(
    ['json', '--dry-run', '--config', '{"apiToken":"anything"}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket json\`, cwd: <redacted>

        \\x1b[34mi\\x1b[39m Target cwd: <redacted>
        \\x1b[31m\\xd7\\x1b[39m Not found: <redacted>"
      `)

      expect(code, 'not found is failure').toBe(1)
    },
  )

  cmdit(
    ['json', '.', '--dry-run', '--config', '{"apiToken":"anything"}'],
    'should print error when file does not exist in folder',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket json\`, cwd: <redacted>

        \\x1b[34mi\\x1b[39m Target cwd: <redacted>
        \\x1b[31m\\xd7\\x1b[39m Not found: <redacted>"
      `)

      expect(code, 'not found is failure').toBe(1)
    },
  )

  cmdit(
    [
      'json',
      './doesnotexist',
      '--dry-run',
      '--config',
      '{"apiToken":"anything"}',
    ],
    'should print an error when the path to file does not exist',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket json\`, cwd: <redacted>

        \\x1b[34mi\\x1b[39m Target cwd: <redacted>
        \\x1b[31m\\xd7\\x1b[39m Not found: <redacted>"
      `)

      expect(code, 'not found is failure').toBe(1)
    },
  )

  cmdit(
    ['json', './sjtest', '--dry-run', '--config', '{"apiToken":"anything"}'],
    'should print a socket.json when found',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`
        "{
          " _____         _       _     ": "Local config file for Socket CLI tool ( https://npmjs.org/socket ), to work with https://socket.dev",
          "|   __|___ ___| |_ ___| |_   ": "     The config in this file is used to set as defaults for flags or cmmand args when using the CLI",
          "|__   | . |  _| '_| -_|  _|  ": "     in this dir, often a repo root. You can choose commit or .ignore this file, both works.",
          "|_____|___|___|_,_|___|_|.dev": "Warning: This file may be overwritten without warning by \`socket manifest setup\` or other commands",
          "version": 1,
          "defaults": {
            "manifest": {
              "sbt": {
                "bin": "/bin/sbt",
                "outfile": "sbt.pom.xml",
                "stdout": false,
                "verbose": true
              }
            }
          }
        }"
      `)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket json\`, cwd: <redacted>

        \\x1b[34mi\\x1b[39m Target cwd: <redacted>
        \\x1b[32m\\u221a\\x1b[39m This is the contents of <redacted>:"
      `)

      expect(code, 'found is ok').toBe(0)
    },
  )
})
