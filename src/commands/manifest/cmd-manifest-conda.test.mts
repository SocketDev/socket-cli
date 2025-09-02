import { describe, expect } from 'vitest'

import constants from '../../../src/constants.mts'
import { cmdit, invokeNpm } from '../../../test/utils.mts'

describe('socket manifest conda', async () => {
  const { binCliPath } = constants

  cmdit(
    ['manifest', 'conda', '--help', '--config', '{}'],
    'should support --help',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `
        "[beta] Convert a Conda environment.yml file to a python requirements.txt

          Usage
            $ socket manifest conda [options] [CWD=.]

          Warning: While we don't support Conda necessarily, this tool extracts the pip
                   block from an environment.yml and outputs it as a requirements.txt
                   which you can scan as if it were a pypi package.

          USE AT YOUR OWN RISK

          Note: FILE can be a dash (-) to indicate stdin. This way you can pipe the
                contents of a file to have it processed.

          Options
            --file              Input file name (by default for Conda this is "environment.yml"), relative to cwd
            --json              Output result as json
            --markdown          Output result as markdown
            --out               Output path (relative to cwd)
            --stdin             Read the input from stdin (supersedes --file)
            --stdout            Print resulting requirements.txt to stdout (supersedes --out)
            --verbose           Print debug messages

          Examples

            $ socket manifest conda
            $ socket manifest conda ./project/foo --file environment.yaml"
      `,
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket manifest conda\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain(
        '`socket manifest conda`',
      )
    },
  )

  cmdit(
    ['manifest', 'conda', '--dry-run', '--config', '{}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket manifest conda\`, cwd: <redacted>

        \\u203c Warning: This will approximate your Conda dependencies using PyPI. We do not yet officially support Conda. Use at your own risk."
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )

  describe('output flags', () => {
    cmdit(
      [
        'manifest',
        'conda',
        'two',
        'three', // this triggers the error
        '--config',
        '{}',
      ],
      'should print raw text without flags',
      async cmd => {
        const { stderr, stdout } = await invokeNpm(binCliPath, cmd)
        expect(stdout).toMatchInlineSnapshot(`""`)
        expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
          "
             _____         _       _        /---------------
            |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
            |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
            |_____|___|___|_,_|___|_|.dev   | Command: \`socket manifest conda\`, cwd: <redacted>

          \\xd7  Input error:  Please review the input requirements and try again

            \\xd7 Can only accept one DIR (make sure to escape spaces!) (received 2)"
        `)
      },
    )

    cmdit(
      [
        'manifest',
        'conda',
        'two',
        'three', // this triggers the error
        '--json',
        '--config',
        '{}',
      ],
      'should print a json blurb with --json flag',
      async cmd => {
        const { stderr, stdout } = await invokeNpm(binCliPath, cmd)
        expect(stdout).toMatchInlineSnapshot(`
          "{
            "ok": false,
            "message": "Input error",
            "data": "Please review the input requirements and try again\\n\\n  \\xd7 Can only accept one DIR (make sure to escape spaces!) (received 2)"
          }"
        `)
        expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
          "
             "
        `)
      },
    )

    cmdit(
      [
        'manifest',
        'conda',
        'two',
        'three', // this triggers the error
        '--markdown',
        '--config',
        '{}',
      ],
      'should print a markdown blurb with --markdown flag',
      async cmd => {
        const { stderr, stdout } = await invokeNpm(binCliPath, cmd)
        expect(stdout).toMatchInlineSnapshot(`""`)
        expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
          "
             \\xd7  Input error:  Please review the input requirements and try again

            \\xd7 Can only accept one DIR (make sure to escape spaces!) (received 2)"
        `)
      },
    )
  })
})
