/**
 * Integration tests for Socket CLI root command.
 *
 * Tests the main entry point (`socket`) behavior including help output, command
 * discovery, and graceful handling of unrecognized input.
 *
 * Test Coverage: - Help text display (--help flag) - Banner output format and
 * content - Command list structure and categories - Dry-run behavior with
 * package specs - Exit codes for valid invocations.
 *
 * Command Categories Validated: - Main commands (login, scan, fix, optimize,
 * cdxgen, ci) - Socket API commands (analytics, audit-log, organization,
 * package, repository, scan, threat-feed) - Local tools (manifest, npm, npx,
 * raw-npm, raw-npx) - CLI configuration (config, install, login, logout,
 * uninstall, whoami, wrapper) - Global flags (--compact-header, --config,
 * --dry-run, --help, --version, etc.)
 *
 * Related Files: - src/cli.mts - Main CLI entry point - src/constants/cli.mts -
 * CLI flag constants - test/utils.mts - Test utilities (cmdit, spawnSocketCli)
 */

import { describe, expect } from 'vitest'

import {
  FLAG_CONFIG,
  FLAG_DRY_RUN,
  FLAG_HELP,
} from '../../../src/constants/cli.mts'
import { getBinCliPath } from '../../../src/constants/paths.mts'
import { cmdit, spawnSocketCli } from '../../utils.mts'

const binCliPath = getBinCliPath()

describe('socket root command', async () => {
  cmdit(
    [FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`
        "Usage
              $ socket <command>
              $ socket scan create --json
              $ socket package score npm lodash --markdown
          
            Note: All commands have their own --help
          
            Main commands
              socket login                Setup Socket CLI with an API token and defaults
              socket scan create          Create a new Socket scan and report
              socket npm/lodash@4.17.21   Request the Socket score of a package
              cdxgen                      Run cdxgen for SBOM generation
              ci                          Alias for \`socket scan create --report\` (creates report and exits with error if unhealthy)
              fix                         Fix CVEs in dependencies
              optimize                    Optimize dependencies with @socketregistry overrides
          
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
              npm                         Run npm with Socket Firewall security
              npx                         Run pnpm exec with Socket Firewall security
              pycli                       Run Socket Python CLI (socketsecurity) directly
              raw-npm                     Run npm without the Socket wrapper
              raw-npx                     Run pnpm exec without the Socket wrapper
              sfw                         Run Socket Firewall directly (alias: firewall)
          
            CLI configuration
              config                      Manage Socket CLI configuration
              install                     Install Socket CLI tab completion
              login                       Setup Socket CLI with an API token and defaults
              logout                      Socket API logout
              uninstall                   Uninstall Socket CLI tab completion
              whoami                      Check Socket CLI authentication status
              wrapper                     Enable or disable the Socket npm/pnpm exec wrapper
          
          
            Options
              Note: All commands have these flags even when not displayed in their help
          
              --compact-header            Use compact single-line header format (auto-enabled in CI)
              --config                    Override the local config with this JSON
              --dry-run                   Run without uploading
              --help                      Show help
              --help-full                 Show full help including environment variables
              --no-banner                 Hide the Socket banner
              --no-spinner                Hide the console spinner
              --quiet                     Route non-essential output (status, progress, warnings) to stderr so stdout carries only the payload. Implied by --json and --markdown.
              --version                   Print the app version
          
            Environment variables [more\\u2026]
              Use --help-full to view all environment variables"
      `)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _          /---------------
            |   __|___ ___| |_ ___| |_        | CLI: <redacted>
            |__   | . |  _| '_| -_|  _|       | token: <redacted>, org: <redacted>
            |_____|___|___|_,_|___|_|.dev     | Command: \`socket\`, cwd: <redacted>"
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
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           \\xd7 Unknown command "mootools".
        i Tip: Use \`socket pycli\` to invoke the Python CLI directly."
      `)

      expect(code, 'unknown command should exit with code 2').toBe(2)
    },
  )
})
