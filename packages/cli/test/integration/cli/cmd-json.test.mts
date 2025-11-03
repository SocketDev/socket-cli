import path from 'node:path'

import { describe, expect } from 'vitest'

import {
  FLAG_CONFIG,
  FLAG_DRY_RUN,
  FLAG_HELP,
} from '../../../src/constants/cli.mts'
import { getBinCliPath } from '../../../src/constants/paths.mts'
import { cmdit, spawnSocketCli, testPath } from '../../utils.mts'

const binCliPath = getBinCliPath()

describe('socket json', async () => {
  cmdit(
    ['json', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`
        "Display the \`socket.json\` that would be applied for target folder

          Usage
                $ socket json [options] [CWD=.]
          
              Display the \`socket.json\` file that would apply when running relevant commands
              in the target directory.
          
              Examples
                $ socket json"
      `)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _          /---------------
            |   __|___ ___| |_ ___| |_        | CLI: <redacted>
            |__   | . |  _| '_| -_|  _|       | token: <redacted>, org: <redacted>
            |_____|___|___|_,_|___|_|.dev     | Command: \`socket json\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain('`socket json`')
    },
  )

  cmdit(
    ['json', FLAG_DRY_RUN, FLAG_CONFIG, '{"apiToken":"fakeToken"}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _          /---------------
            |   __|___ ___| |_ ___| |_        | CLI: <redacted>
            |__   | . |  _| '_| -_|  _|       | token: <redacted>, org: <redacted>
            |_____|___|___|_,_|___|_|.dev     | Command: \`socket json\`, cwd: <redacted>

        i Target cwd: <redacted>
        \\xd7 Not found: <redacted>"
      `)

      expect(code, 'not found is failure').toBe(1)
    },
  )

  cmdit(
    ['json', '.', FLAG_DRY_RUN, FLAG_CONFIG, '{"apiToken":"fakeToken"}'],
    'should print error when file does not exist in folder',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _          /---------------
            |   __|___ ___| |_ ___| |_        | CLI: <redacted>
            |__   | . |  _| '_| -_|  _|       | token: <redacted>, org: <redacted>
            |_____|___|___|_,_|___|_|.dev     | Command: \`socket json\`, cwd: <redacted>

        i Target cwd: <redacted>
        \\xd7 Not found: <redacted>"
      `)

      expect(code, 'not found is failure').toBe(1)
    },
  )

  cmdit(
    [
      'json',
      './doesnotexist',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should print an error when the path to file does not exist',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _          /---------------
            |   __|___ ___| |_ ___| |_        | CLI: <redacted>
            |__   | . |  _| '_| -_|  _|       | token: <redacted>, org: <redacted>
            |_____|___|___|_,_|___|_|.dev     | Command: \`socket json\`, cwd: <redacted>

        i Target cwd: <redacted>
        \\xd7 Not found: <redacted>"
      `)

      expect(code, 'not found is failure').toBe(1)
    },
  )

  cmdit(
    ['json', '.', FLAG_DRY_RUN, FLAG_CONFIG, '{"apiToken":"fakeToken"}'],
    'should print a socket.json when found',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: path.join(testPath, 'fixtures/commands/json'),
      })
      expect(stdout.replace(/(?:\\r|\\x0d)/g, '')).toMatchInlineSnapshot(
        `"<Buffer 7b 0a 20 20 22 20 5f 5f 5f 5f 5f 20 20 20 20 20 20 20 20 20 5f 20 20 20 20 20 20 20 5f 20 20 20 20 20 22 3a 20 22 4c 6f 63 61 6c 20 63 6f 6e 66 69 67 ... 691 more bytes>"`,
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _          /---------------
            |   __|___ ___| |_ ___| |_        | CLI: <redacted>
            |__   | . |  _| '_| -_|  _|       | token: <redacted>, org: <redacted>
            |_____|___|___|_,_|___|_|.dev     | Command: \`socket json\`, cwd: <redacted>

        i Target cwd: <redacted>
        \\u221a This is the contents of <redacted>:"
      `)

      expect(code, 'found is ok').toBe(0)
    },
  )
})
