/**
 * Integration tests for `socket manifest conda` command.
 *
 * Tests Conda environment manifest generation for Python/data science projects.
 *
 * Test Coverage:
 * - Help text display and usage examples
 * - Dry-run behavior validation
 * - environment.yml parsing
 * - Dependency resolution
 *
 * Related Files:
 * - src/commands/manifest/cmd-manifest-conda.mts - Command definition
 * - src/commands/manifest/handle-manifest-conda.mts - Conda manifest logic
 */

import { describe, expect } from 'vitest'

import {
  FLAG_CONFIG,
  FLAG_DRY_RUN,
  FLAG_HELP,
} from '../../../src/constants/cli.mts'
import { getBinCliPath } from '../../../src/constants/paths.mts'
import { cleanOutput, cmdit, spawnSocketCli, testPath } from '../../utils.mts'

const binCliPath = getBinCliPath()

describe('socket manifest conda', async () => {
  cmdit(
    ['manifest', 'conda', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: testPath,
      })
      expect(stdout).toMatchInlineSnapshot(`
        "[beta] Convert a Conda environment.yml file to a python requirements.txt

          Usage
                $ socket manifest conda [options] [CWD=.]
          
              Warning: While we don't support Conda necessarily, this tool extracts the pip
                       block from an environment.yml and outputs it as a requirements.txt
                       which you can scan as if it were a PyPI package.
          
              USE AT YOUR OWN RISK
          
              Note: FILE can be a dash (-) to indicate stdin. This way you can pipe the
                    contents of a file to have it processed.
          
              Options
                --file              Input file name (by default for Conda this is "environment.yml"), relative to cwd
                --json              Output as JSON
                --markdown          Output as Markdown
                --out               Output path (relative to cwd)
                --stdin             Read the input from stdin (supersedes --file)
                --stdout            Print resulting requirements.txt to stdout (supersedes --out)
                --verbose           Print debug messages
          
              Examples
          
                $ socket manifest conda
                $ socket manifest conda ./project/foo --file environment.yaml"
      `)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _          /---------------
            |   __|___ ___| |_ ___| |_        | CLI: <redacted>
            |__   | . |  _| '_| -_|  _|       | token: <redacted>, org: <redacted>
            |_____|___|___|_,_|___|_|.dev     | Command: \`socket manifest conda\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain(
        '`socket manifest conda`',
      )
    },
  )

  cmdit(
    ['manifest', 'conda', FLAG_DRY_RUN, FLAG_CONFIG, '{}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: testPath,
      })
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _          /---------------
            |   __|___ ___| |_ ___| |_        | CLI: <redacted>
            |__   | . |  _| '_| -_|  _|       | token: <redacted>, org: <redacted>
            |_____|___|___|_,_|___|_|.dev     | Command: \`socket manifest conda\`, cwd: <redacted>

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
        'fixtures/commands/manifest/conda',
        '--stdout',
        FLAG_CONFIG,
        '{}',
      ],
      'should print raw text without flags',
      async cmd => {
        const {
          code: _code,
          stderr,
          stdout,
        } = await spawnSocketCli(binCliPath, cmd, {
          cwd: testPath,
        })
        expect(stdout).toMatchInlineSnapshot(`
          "qgrid==1.3.0
          mplstereonet
          pyqt5
          gempy==2.1.0"
        `)
        expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
          "
             _____         _       _          /---------------
              |   __|___ ___| |_ ___| |_        | CLI: <redacted>
              |__   | . |  _| '_| -_|  _|       | token: <redacted>, org: <redacted>
              |_____|___|___|_,_|___|_|.dev     | Command: \`socket manifest conda\`, cwd: <redacted>

          \\u203c Warning: This will approximate your Conda dependencies using PyPI. We do not yet officially support Conda. Use at your own risk."
        `)
      },
    )

    cmdit(
      [
        'manifest',
        'conda',
        'fixtures/commands/manifest/conda',
        '--json',
        '--stdout',
        FLAG_CONFIG,
        '{}',
      ],
      'should print a json blurb with --json flag',
      async cmd => {
        const { stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
          cwd: testPath,
        })
        expect(cleanOutput(stdout)).toMatchInlineSnapshot(`
          "{
            "ok": true,
            "data": {
              "content": "name: my_stuff\\n\\nchannels:\\n  - conda-thing\\n  - defaults\\ndependencies:\\n  - python=3.8\\n  - pandas=1.3.4\\n  - numpy=1.19.0\\n  - scipy\\n  - mkl-service\\n  - libpython\\n  - m2w64-toolchain\\n  - pytest\\n  - requests\\n  - pip\\n  - pip:\\n      - qgrid==1.3.0\\n      - mplstereonet\\n      - pyqt5\\n      - gempy==2.1.0\\n",
              "pip": "qgrid==1.3.0\\nmplstereonet\\npyqt5\\ngempy==2.1.0"
            }
          }"
        `)
        expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
          "
             \\u203c Warning: This will approximate your Conda dependencies using PyPI. We do not yet officially support Conda. Use at your own risk."
        `)
      },
    )

    cmdit(
      [
        'manifest',
        'conda',
        'fixtures/commands/manifest/conda',
        '--markdown',
        '--stdout',
        FLAG_CONFIG,
        '{}',
      ],
      'should print a markdown blurb with --markdown flag',
      async cmd => {
        const {
          code: _code,
          stderr,
          stdout,
        } = await spawnSocketCli(binCliPath, cmd, {
          cwd: testPath,
        })
        expect(cleanOutput(stdout)).toMatchInlineSnapshot(`
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
             \\u203c Warning: This will approximate your Conda dependencies using PyPI. We do not yet officially support Conda. Use at your own risk."
        `)
      },
    )
  })
})
