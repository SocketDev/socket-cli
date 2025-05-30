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
            package           Commands relating to looking up published packages
            raw-npm           Temporarily disable the Socket npm wrapper
            raw-npx           Temporarily disable the Socket npx wrapper
            repos             Repositories related commands
            scan              Scan related commands
            threat-feed       [beta] View the threat feed
            wrapper           Enable or disable the Socket npm/npx wrapper

          Options
            --dryRun          Do input validation for a command and exit 0 when input is ok. Every command should support this flag (not shown on help screens)
            --help            Print this help

          Examples
            $ socket --help"
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
