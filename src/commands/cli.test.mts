import { describe, expect } from 'vitest'

import { cmdit, spawnSocketCli } from '../../test/utils.mts'
import constants, {
  API_V0_URL,
  FLAG_CONFIG,
  FLAG_DRY_RUN,
  FLAG_HELP,
} from '../constants.mts'

describe('socket root command', async () => {
  const { binCliPath } = constants

  cmdit(
    [FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`
        "CLI for Socket.dev

          Usage
            $ socket <command>
            $ socket scan create --json
            $ socket package score npm lodash --markdown

          Note: All commands have their own --help

          Main commands
            socket login                Setup Socket CLI with an API token and defaults
            socket scan create          Create a new Socket scan and report
            socket npm/lodash@4.17.21   Request the Socket score of a package
            socket fix                  Fix CVEs in dependencies
            socket optimize             Optimize dependencies with @socketregistry overrides
            socket cdxgen               Run cdxgen for SBOM generation
            socket ci                   Alias for \`socket scan create --report\` (creates report and exits with error if unhealthy)

          Socket API
            analytics                   Look up analytics data
            audit-log                   Look up the audit log for an organization
            organization                Manage Socket organization account details
            package                     Look up published package details
            repository                  Manage registered repositories
            scan                        Manage Socket scans
            threat-feed                 [Beta] View the threat-feed

          Local tools
            manifest                    Generate a dependency manifest for certain ecosystems
            npm                         Wraps npm with Socket security scanning
            npx                         Wraps npx with Socket security scanning
            raw-npm                     Run npm without the Socket wrapper
            raw-npx                     Run npx without the Socket wrapper

          CLI configuration
            config                      Manage Socket CLI configuration
            install                     Install Socket CLI tab completion
            login                       Socket API login and CLI setup
            logout                      Socket API logout
            uninstall                   Uninstall Socket CLI tab completion
            whoami                      Check Socket CLI authentication status
            wrapper                     Enable or disable the Socket npm/npx wrapper

          Options
            Note: All commands have these flags even when not displayed in their help

            --compact-header            Use compact single-line header format (auto-enabled in CI)
            --config                    Override the local config with this JSON
            --dry-run                   Run without uploading
            --help                      Show help
            --help-full                 Show full help including environment variables
            --no-banner                 Hide the Socket banner
            --no-spinner                Hide the console spinner
            --version                   Print the app version

          Environment variables [more...]
            Use --help-full to view all environment variables"
      `)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | CLI: <redacted>
          |__   | * |  _| '_| -_|  _|     | token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain('`socket`')
    },
  )

  cmdit(
    ['mootools', FLAG_DRY_RUN, FLAG_CONFIG, '{"apiToken":"fakeToken"}'],
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
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )
})
