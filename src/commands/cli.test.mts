import path from 'node:path'

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

        Commands
          analytics         Look up analytics data
          audit-log         Look up the audit log for an organization
          dependencies      Search for any dependency that is being used in your organization
          fix               Update dependencies with "fixable" Socket alerts
          login             Socket API login
          logout            Socket API logout
          manifest          Generate a dependency manifest for given file or dir
          npm               npm wrapper functionality
          npx               npx wrapper functionality
          optimize          Optimize dependencies with @socketregistry overrides
          organization      Account details
          package           Commands relating to looking up published packages
          raw-npm           Temporarily disable the Socket npm wrapper
          raw-npx           Temporarily disable the Socket npx wrapper
          repos             Repositories related commands
          scan              Scan related commands
          threat-feed       [beta] View the threat feed
          wrapper           Enable or disable the Socket npm/npx wrapper

        Options       (Note: all CLI commands have these flags even when not displayed in their help)

          --config          Allows you to temp overrides the internal CLI config
          --dryRun          Do input validation for a sub-command and then exit
          --help            Give you detailed help information about any sub-command
          --version         Show version of CLI

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
        |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
        |_____|___|___|_,_|___|_|.dev   | Command: \`socket\`, cwd: <redacted>"
    `)

    expect(code, 'explicit help should exit with code 0').toBe(0)
    expect(stderr, 'banner includes base command').toContain('`socket`')
  })

  cmdit(
    ['--help', '--config', '{"isTestingV1": true}'],
    'should support v1 --help',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `
        "CLI for Socket.dev

          Usage
            $ socket <command>


            All commands have their own --help page

          Main commands

            socket login             Setup the CLI with an API Token and defaults
            socket scan create       Create a new Scan and report
            socket package score     Request the (shallow) security score of a particular package
            socket ci                Shorthand for CI; socket scan create --report --no-interactive

          Socket API

            analytics                Look up analytics data
            audit-log                Look up the audit log for an organization
            organization             Manage organization account details
            package                  Look up published package details
            repository               Manage registered repositories
            scan                     Manage Socket scans
            threat-feed              [beta] View the threat feed

          Local tools

            fix                      Update dependencies with "fixable" Socket alerts
            manifest                 Generate a dependency manifest for certain languages
            npm                      npm wrapper functionality
            npx                      npx wrapper functionality
            optimize                 Optimize dependencies with @socketregistry overrides
            raw-npm                  Temporarily disable the Socket npm wrapper
            raw-npx                  Temporarily disable the Socket npx wrapper

          CLI configuration

            config                   Manage the CLI configuration directly
            install                  Manually install CLI tab completion on your system
            login                    Socket API login and CLI setup
            logout                   Socket API logout
            uninstall                Remove the CLI tab completion from your system
            wrapper                  Enable or disable the Socket npm/npx wrapper

          Options       (Note: all CLI commands have these flags even when not displayed in their help)

            --config                 Allows you to temp overrides the internal CLI config
            --dryRun                 Do input validation for a sub-command and then exit
            --help                   Give you detailed help information about any sub-command
            --version                Show version of CLI

          Examples
            $ socket --help
            $ socket scan create --json
            $ socket package score npm left-pad --markdown"
      `,
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           \\x1b[31m\\xd7\\x1b[39m Found commands in the list that were not marked as public or were not defined at all: [ 'config', 'install', 'uninstall' ]
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted> (is testing v1)
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket\`, cwd: <redacted>
        \\x1b[32m   (Thank you for testing the v1 bump! Please send us any feedback you might have!)
        \\x1b[39m"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain('`socket`')
    },
  )

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
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )
})
