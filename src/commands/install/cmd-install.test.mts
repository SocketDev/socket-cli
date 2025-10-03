import { describe, expect } from 'vitest'

import constants, {
  FLAG_CONFIG,
  FLAG_DRY_RUN,
  FLAG_HELP,
} from '../../../src/constants.mts'
import { cmdit, spawnSocketCli } from '../../../test/utils.mts'

describe('socket install', async () => {
  const { binCliPath } = constants

  cmdit(
    ['install', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`
        "Install Socket CLI tab completion

          Usage
            $ socket install <command>

          Commands
            completion                  Install bash completion for Socket CLI

          Options

            --no-banner                 Hide the Socket banner
            --no-spinner                Hide the console spinner"
      `)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | CLI: <redacted>
          |__   | * |  _| '_| -_|  _|     | token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket install\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain(
        '`socket install`',
      )
    },
  )

  cmdit(
    ['install', FLAG_DRY_RUN, FLAG_CONFIG, '{"apiToken":"fakeToken"}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `"[DryRun]: No-op, call a sub-command; ok"`,
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           usage: socketcli [-h] [--api-token <token>] [--repo <owner/repo>]
                         [--repo-is-public] [--branch <name>] [--integration <type>]
                         [--owner <name>] [--pr-number <number>]
                         [--commit-message <message>] [--commit-sha <sha>]
                         [--committers [<name> ...]] [--target-path <path>]
                         [--sbom-file <path>] [--license-file-name <string>]
                         [--save-submitted-files-list <path>]
                         [--save-manifest-tar <path>] [--files <json>]
                         [--sub-path <path>] [--workspace-name <name>]
                         [--excluded-ecosystems EXCLUDED_ECOSYSTEMS]
                         [--default-branch] [--pending-head] [--generate-license]
                         [--enable-debug] [--enable-json] [--enable-sarif]
                         [--disable-overview] [--exclude-license-details]
                         [--allow-unverified] [--disable-security-issue]
                         [--ignore-commit-files] [--disable-blocking] [--enable-diff]
                         [--scm <type>] [--timeout <seconds>]
                         [--include-module-folders] [--version]
        socketcli: error: unrecognized arguments: --dry-run --config {"apiToken":"fakeToken"}
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | CLI: <redacted>
          |__   | * |  _| '_| -_|  _|     | token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket install\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )
})
