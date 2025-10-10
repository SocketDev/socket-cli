import { describe, expect } from 'vitest'

import constants, {
  FLAG_CONFIG,
  FLAG_DRY_RUN,
  FLAG_HELP,
} from '../../../src/constants.mts'
import { cmdit, spawnSocketCli } from '../../../test/utils.mts'

describe('socket config', async () => {
  const { binCliPath } = constants

  cmdit(
    ['config', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`
        "What can I help you with?

        Help Topics:
          scan       - Scan projects for vulnerabilities and security issues
          fix        - Auto-fix vulnerabilities and apply security patches
          pm         - Enhanced npm, npx, yarn, and pnpm wrappers
          pkg        - Analyze package security and get security scores
          org        - Manage organizations and repositories
          config     - CLI settings and configuration management
          env        - Environment variables for advanced configuration
          flags      - Global command-line flags and options
          ask        - Use plain English to interact with Socket
          all        - Complete list of all available commands
          quick      - Get started with Socket CLI in minutes

        Use: socket --help=<topic>

        \\ud83d\\udca1 Tip: Run in an interactive terminal for a better experience"
      `)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | CLI: <redacted>
          |__   | * |  _| '_| -_|  _|     | token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket config\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain(
        '`socket config`',
      )
    },
  )

  cmdit(
    ['config', FLAG_DRY_RUN, FLAG_CONFIG, '{"apiToken":"fakeToken"}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `"[DryRun]: No-op, call a sub-command; ok"`,
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | CLI: <redacted>
          |__   | * |  _| '_| -_|  _|     | token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket config\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )

  describe('config override', () => {
    cmdit(
      ['config', 'get', 'apiToken'],
      'should print nice error when env config override cannot be parsed',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
          // This will be parsed first. If it fails it should fallback to flag or empty.
          env: { SOCKET_CLI_CONFIG: '{apiToken:invalidjson}' },
        })
        expect(stdout).toMatchInlineSnapshot(`""`)
        expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
          "
             _____         _       _        /---------------
            |   __|___ ___| |_ ___| |_      | CLI: <redacted>
            |__   | * |  _| '_| -_|  _|     | token: <redacted>, org: <redacted>
            |_____|___|___|_,_|___|_|.dev   | Command: \`socket\`, cwd: <redacted>


          \\xd7 Could not parse Config as JSON"
        `)

        expect(stderr.includes('Could not parse Config as JSON')).toBe(true)
        expect(code, 'bad config input should exit with code 2 ').toBe(2)
      },
    )

    cmdit(
      ['config', 'get', 'apiToken', FLAG_CONFIG, '{apiToken:invalidjson}'],
      'should print nice error when flag config override cannot be parsed',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
        expect(stdout).toMatchInlineSnapshot(`""`)
        expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
          "
             _____         _       _        /---------------
            |   __|___ ___| |_ ___| |_      | CLI: <redacted>
            |__   | * |  _| '_| -_|  _|     | token: <redacted>, org: <redacted>
            |_____|___|___|_,_|___|_|.dev   | Command: \`socket\`, cwd: <redacted>


          \\xd7 Could not parse Config as JSON"
        `)

        expect(stderr.includes('Could not parse Config as JSON')).toBe(true)
        expect(code, 'bad config input should exit with code 2 ').toBe(2)
      },
    )
  })
})
