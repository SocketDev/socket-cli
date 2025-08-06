import { describe, expect } from 'vitest'

import { cmdit, invokeNpm } from '../../test/utils.mts'
import constants from '../constants.mts'

describe('socket root command', async () => {
  // Lazily access constants.binCliPath.
  const { binCliPath } = constants

  cmdit(['--help', '--config', '{}'], 'should support --help', async cmd => {
    const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
    expect(stdout).toMatchInlineSnapshot(
      `
      "CLI for Socket.dev

        Usage
          $ socket <command>

          All commands have their own --help page

        Main commands

          socket login              Setup Socket CLI with an API token and defaults
          socket scan create        Create a new Socket scan and report
          socket npm/eslint@1.0.0   Request the Socket score of a package
          socket ci                 Shorthand for CI; socket scan create --report --no-interactive

        Socket API

          analytics                 Look up analytics data
          audit-log                 Look up the audit log for an organization
          organization              Manage Socket organization account details
          package                   Look up published package details
          repository                Manage registered repositories
          scan                      Manage Socket scans
          threat-feed               [beta] View the threat feed

        Local tools

          fix                       Update dependencies with "fixable" Socket alerts
          manifest                  Generate a dependency manifest for certain languages
          npm                       npm wrapper functionality
          npx                       npx wrapper functionality
          optimize                  Optimize dependencies with @socketregistry overrides
          raw-npm                   Run npm without the Socket npm wrapper
          raw-npx                   Run npx without the Socket npx wrapper

        CLI configuration

          config                    Manage Socket CLI configuration directly
          install                   Install Socket CLI tab completion on your system
          login                     Socket API login and CLI setup
          logout                    Socket API logout
          uninstall                 Remove Socket CLI tab completion from your system
          wrapper                   Enable or disable the Socket npm/npx wrapper

        Options       (Note: All CLI commands have these flags even when not displayed in their help)

          --config                 Override the local config with this JSON
          --dry-run                Do input validation for a command and exit 0 when input is ok
          --help                   Print this help
          --max-old-space-size     Set the max memory size of V8's old memory section in megabytes
          --max-semi-space-size    Set the maximum semi-space size for V8's scavenge garbage collector in megabytes
          --version                Print the app version

        Examples
          $ socket --help
          $ socket scan create --json
          $ socket package score npm left-pad --markdown"
    `,
    )
    expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
      "
         _____         _       _        /---------------
        |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
        |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket\`, cwd: <redacted>"
    `)

    expect(code, 'explicit help should exit with code 0').toBe(0)
    expect(stderr, 'banner includes base command').toContain('`socket`')
  })

  cmdit(
    ['mootools', '--dry-run', '--config', '{"apiToken":"anything"}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `"[DryRun]: No-op, call a sub-command; ok"`,
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )
})
