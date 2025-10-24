import { describe, expect } from 'vitest'

import {
  cleanOutput,
  cmdit,
  spawnSocketCli,
  testPath,
} from '../../../test/utils.mts'
import { FLAG_CONFIG, FLAG_DRY_RUN, FLAG_HELP } from '../../constants/cli.mts'
import { getBinCliPath } from '../../constants/paths.mts'

const binCliPath = getBinCliPath()

describe('socket manifest conda', async () => {
  cmdit(
    ['manifest', 'conda', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const {
        code,
        stderr: _stderr,
        stdout,
      } = await spawnSocketCli(binCliPath, cmd, {
        cwd: testPath,
      })
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           "
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
      const {
        code,
        stderr: _stderr,
        stdout,
      } = await spawnSocketCli(binCliPath, cmd, {
        cwd: testPath,
      })
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           "
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
          stderr: _stderr,
          stdout,
        } = await spawnSocketCli(binCliPath, cmd, {
          cwd: testPath,
        })
        expect(stdout).toMatchInlineSnapshot(`""`)
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
        expect(cleanOutput(stdout)).toMatchInlineSnapshot(`""`)
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
          stderr: _stderr,
          stdout,
        } = await spawnSocketCli(binCliPath, cmd, {
          cwd: testPath,
        })
        expect(cleanOutput(stdout)).toMatchInlineSnapshot(`""`)
        expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
          "
             "
        `)
      },
    )
  })
})
