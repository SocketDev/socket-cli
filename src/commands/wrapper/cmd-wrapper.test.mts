import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import constants, {
  FLAG_CONFIG,
  FLAG_DRY_RUN,
  FLAG_HELP,
} from '../../../src/constants.mts'
import { cmdit, spawnSocketCli } from '../../../test/utils.mts'

describe('socket wrapper', async () => {
  const { binCliPath } = constants

  it('prints the supported command to disable the wrapper', async () => {
    const temporaryHome = await fs.mkdtemp(
      path.join(os.tmpdir(), 'socket-wrapper-'),
    )
    const profilePath = path.join(temporaryHome, '.bashrc')
    const configDirectory = path.join(temporaryHome, 'config')
    const env = {
      HOME: temporaryHome,
      USERPROFILE: temporaryHome,
      XDG_CONFIG_HOME: configDirectory,
    }

    try {
      await fs.mkdir(configDirectory)
      await fs.writeFile(profilePath, '')

      const enabled = await spawnSocketCli(
        binCliPath,
        ['wrapper', 'on', FLAG_CONFIG, '{}'],
        { env },
      )
      expect(enabled.code).toBe(0)
      expect(`${enabled.stdout}\n${enabled.stderr}`).toContain(
        '`socket wrapper off`',
      )
      expect(`${enabled.stdout}\n${enabled.stderr}`).not.toContain(
        '`socket wrapper --disable`',
      )
      expect(await fs.readFile(profilePath, 'utf8')).toContain(
        'alias npm="socket npm"',
      )

      const disabled = await spawnSocketCli(
        binCliPath,
        ['wrapper', 'off', FLAG_CONFIG, '{}'],
        { env },
      )
      expect(disabled.code).toBe(0)
      expect(await fs.readFile(profilePath, 'utf8')).not.toContain(
        'alias npm="socket npm"',
      )
      expect(await fs.readFile(profilePath, 'utf8')).not.toContain(
        'alias npx="socket npx"',
      )
    } finally {
      await fs.rm(temporaryHome, { force: true, recursive: true })
    }
  })

  cmdit(
    ['wrapper', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `
        "Enable or disable the Socket npm/npx wrapper

          Usage
            $ socket wrapper <"on" | "off">

          Options
            (none)

          While enabled, the wrapper makes it so that when you call npm/npx on your
          machine, it will automatically actually run \`socket npm\` / \`socket npx\`
          instead.

          Examples
            $ socket wrapper on
            $ socket wrapper off"
      `,
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | CLI: <redacted>
          |__   | * |  _| '_| -_|  _|     | token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket wrapper\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain(
        '`socket wrapper`',
      )
    },
  )

  cmdit(
    ['wrapper', FLAG_DRY_RUN, FLAG_CONFIG, '{}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | CLI: <redacted>
          |__   | * |  _| '_| -_|  _|     | token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket wrapper\`, cwd: <redacted>

        \\xd7  Input error:  Please review the input requirements and try again

          \\xd7 Must specify "on" or "off" argument (missing)"
      `)

      expect(code, 'dry-run should exit with code 2 if missing input').toBe(2)
    },
  )

  cmdit(
    ['wrapper', FLAG_DRY_RUN, 'on', FLAG_CONFIG, '{"apiToken":"fakeToken"}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | CLI: <redacted>
          |__   | * |  _| '_| -_|  _|     | token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket wrapper\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )
})
