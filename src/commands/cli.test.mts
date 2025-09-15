import { describe, expect } from 'vitest'

import { cmdit, spawnSocketCli } from '../../test/utils.mts'
import constants, { API_V0_URL } from '../constants.mts'

describe('socket root command', async () => {
  const { binCliPath } = constants

  cmdit(['--help', '--config', '{}'], 'should support --help', async cmd => {
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
          socket ci                   Shorthand for \`socket scan create --report --no-interactive\`

        Socket API
          analytics                   Look up analytics data
          audit-log                   Look up the audit log for an organization
          organization                Manage Socket organization account details
          package                     Look up published package details
          repository                  Manage registered repositories
          scan                        Manage Socket scans
          threat-feed                 [Beta] View the threat-feed

        Local tools
          fix                         Update dependencies with "fixable" Socket alerts
          manifest                    Generate a dependency manifest for certain ecosystems
          npm                         Run npm with the Socket wrapper
          npx                         Run npx with the Socket wrapper
          optimize                    Optimize dependencies with @socketregistry overrides
          raw-npm                     Run npm without the Socket wrapper
          raw-npx                     Run npx without the Socket wrapper

        CLI configuration
          config                      Manage Socket CLI configuration
          install                     Install Socket CLI tab completion
          login                       Socket API login and CLI setup
          logout                      Socket API logout
          uninstall                   Uninstall Socket CLI tab completion
          wrapper                     Enable or disable the Socket npm/npx wrapper

        Options
          Note: All commands have these flags even when not displayed in their help

          --config                    Override the local config with this JSON
          --dry-run                   Do input validation for a command and exit 0 when input is ok
          --help                      Print this help
          --max-old-space-size        Set Node's V8 --max-old-space-size (https://nodejs.org/api/cli.html#--max-old-space-sizesize-in-mib) option
          --max-semi-space-size       Set Node's V8 --max-semi-space-size (https://nodejs.org/api/cli.html#--max-semi-space-sizesize-in-mib) option
          --no-banner                 Hide the Socket banner
          --no-spinner                Hide the console spinner
          --version                   Print the app version

        Environment variables
          SOCKET_CLI_API_TOKEN        Set the Socket API token
          SOCKET_CLI_CONFIG           A JSON stringified Socket configuration object
          SOCKET_CLI_GITHUB_API_URL   Change the base URL for GitHub REST API calls
          SOCKET_CLI_GIT_USER_EMAIL   The git config \`user.email\` used by Socket CLI
                                      Defaults: github-actions[bot]@users.noreply.github.com
          SOCKET_CLI_GIT_USER_NAME    The git config \`user.name\` used by Socket CLI
                                      Defaults: github-actions[bot]
          SOCKET_CLI_GITHUB_TOKEN     A classic or fine-grained GitHub personal access token (https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
                                      Aliases: GITHUB_TOKEN
          SOCKET_CLI_NO_API_TOKEN     Make the default API token \`undefined\`
          SOCKET_CLI_NPM_PATH         The absolute location of the npm directory
          SOCKET_CLI_ORG_SLUG         Specify the Socket organization slug

          SOCKET_CLI_ACCEPT_RISKS     Accept risks of a Socket wrapped npm/npx run
          SOCKET_CLI_VIEW_ALL_RISKS   View all risks of a Socket wrapped npm/npx run

        Environment variables for development
          SOCKET_CLI_API_BASE_URL     Change the base URL for Socket API calls
                                      Defaults: The "apiBaseUrl" value of socket/settings local app data
                                      if present, else https://api.socket.dev/v0/
          SOCKET_CLI_API_PROXY        Set the proxy Socket API requests are routed through, e.g. if set to
                                      http://127.0.0.1:9090 (https://docs.proxyman.io/troubleshooting/couldnt-see-any-requests-from-3rd-party-network-libraries) then all request are passed through that proxy
                                      Aliases: HTTPS_PROXY, https_proxy, HTTP_PROXY, and http_proxy
          SOCKET_CLI_API_TIMEOUT      Set the timeout in milliseconds for Socket API requests
          SOCKET_CLI_DEBUG            Enable debug logging in Socket CLI
          DEBUG                       Enable debug logging based on the debug (https://socket.dev/npm/package/debug) package"
    `)
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
    ['mootools', '--dry-run', '--config', '{"apiToken":"fakeToken"}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
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
