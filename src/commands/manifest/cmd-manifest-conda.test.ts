import path from 'node:path'

import { describe, expect } from 'vitest'

import constants from '../../../src/constants'
import { cmdit, invokeNpm } from '../../../test/utils'

const { CLI } = constants

describe('socket manifest conda', async () => {
  // Lazily access constants.rootBinPath.
  const entryPath = path.join(constants.rootBinPath, `${CLI}.js`)

  cmdit(
    ['manifest', 'conda', '--help', '--config', '{}'],
    'should support --help',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(entryPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `
        "[beta] Convert a Conda environment.yml file to a python requirements.txt

          Usage
            $ socket manifest conda FILE

          Note: FILE can be a dash (-) to indicate stdin. This way you can pipe the
                contents of a file to have it processed.

          Options
            --cwd             Set the cwd, defaults to process.cwd()
            --help            Print this help
            --json            Output result as json
            --markdown        Output result as markdown
            --out             Output target (use \`-\` or omit to print to stdout)
            --verbose         Print debug messages

          Examples

            $ socket manifest conda ./environment.yml"
      `
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket manifest conda\`, cwd: <redacted>
        \\x1b[1m   \\x1b[31mWarning:\\x1b[39m NodeJS version 19 and lower will be \\x1b[31munsupported\\x1b[39m after April 30th, 2025.\\x1b[22m
                    Soon after the Socket CLI will require NodeJS version 20 or higher."
      `)

      expect(code, 'help should exit with code 2').toBe(2)
      expect(stderr, 'banner includes base command').toContain(
        '`socket manifest conda`'
      )
    }
  )

  cmdit(
    ['manifest', 'conda', '--dry-run', '--config', '{}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(entryPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket manifest conda\`, cwd: <redacted>
        \\x1b[1m   \\x1b[31mWarning:\\x1b[39m NodeJS version 19 and lower will be \\x1b[31munsupported\\x1b[39m after April 30th, 2025.\\x1b[22m
                    Soon after the Socket CLI will require NodeJS version 20 or higher.

        \\x1b[31m\\xd7\\x1b[39m \\x1b[41m\\x1b[1m\\x1b[37m Input error: \\x1b[39m\\x1b[22m\\x1b[49m \\x1b[1mPlease review the input requirements and try again\\x1b[22m

          - The FILE arg is required (\\x1b[31mmissing\\x1b[39m)"
      `)

      expect(code, 'dry-run should exit with code 2 if missing input').toBe(2)
    }
  )

  cmdit(
    [
      'manifest',
      'conda',
      'mootools',
      '--dry-run',
      '--config',
      '{"apiToken":"anything"}'
    ],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(entryPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket manifest conda\`, cwd: <redacted>
        \\x1b[1m   \\x1b[31mWarning:\\x1b[39m NodeJS version 19 and lower will be \\x1b[31munsupported\\x1b[39m after April 30th, 2025.\\x1b[22m
                    Soon after the Socket CLI will require NodeJS version 20 or higher."
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    }
  )

  describe('output flags', () => {
    cmdit(
      [
        'manifest',
        'conda',
        './manifest-conda/environment.yml',
        '--config',
        '{}'
      ],
      'should print raw text without flags',
      async cmd => {
        const { stderr, stdout } = await invokeNpm(entryPath, cmd)
        expect(stdout).toMatchInlineSnapshot(`
          "qgrid==1.3.0
          mplstereonet
          pyqt5
          gempy==2.1.0"
        `)
        expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
          "
             _____         _       _        /---------------
            |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
            |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
            |_____|___|___|_,_|___|_|.dev   | Command: \`socket manifest conda\`, cwd: <redacted>
          \\x1b[1m   \\x1b[31mWarning:\\x1b[39m NodeJS version 19 and lower will be \\x1b[31munsupported\\x1b[39m after April 30th, 2025.\\x1b[22m
                      Soon after the Socket CLI will require NodeJS version 20 or higher."
        `)
      }
    )

    cmdit(
      [
        'manifest',
        'conda',
        './manifest-conda/environment.yml',
        '--json',
        '--config',
        '{}'
      ],
      'should print a json blurb with --json flag',
      async cmd => {
        const { stderr, stdout } = await invokeNpm(entryPath, cmd)
        expect(stdout).toMatchInlineSnapshot(`
          "{
            "ok": true,
            "data": {
              "pip": "qgrid==1.3.0\\nmplstereonet\\npyqt5\\ngempy==2.1.0"
            }
          }"
        `)
        expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
          "
             _____         _       _        /---------------
            |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
            |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
            |_____|___|___|_,_|___|_|.dev   | Command: \`socket manifest conda\`, cwd: <redacted>
          \\x1b[1m   \\x1b[31mWarning:\\x1b[39m NodeJS version 19 and lower will be \\x1b[31munsupported\\x1b[39m after April 30th, 2025.\\x1b[22m
                      Soon after the Socket CLI will require NodeJS version 20 or higher."
        `)
      }
    )

    cmdit(
      [
        'manifest',
        'conda',
        './manifest-conda/environment.yml',
        '--markdown',
        '--config',
        '{}'
      ],
      'should print a markdown blurb with --markdown flag',
      async cmd => {
        const { stderr, stdout } = await invokeNpm(entryPath, cmd)
        expect(stdout).toMatchInlineSnapshot(`
          "# Converted Conda file

          This is the Conda \`environment.yml\` file converted to python \`requirements.txt\`:

          \`\`\`file=requirements.txt
          qgrid==1.3.0
          mplstereonet
          pyqt5
          gempy==2.1.0
          \`\`\`"
        `)
        expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
          "
             _____         _       _        /---------------
            |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
            |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
            |_____|___|___|_,_|___|_|.dev   | Command: \`socket manifest conda\`, cwd: <redacted>
          \\x1b[1m   \\x1b[31mWarning:\\x1b[39m NodeJS version 19 and lower will be \\x1b[31munsupported\\x1b[39m after April 30th, 2025.\\x1b[22m
                      Soon after the Socket CLI will require NodeJS version 20 or higher."
        `)
      }
    )
  })
})
