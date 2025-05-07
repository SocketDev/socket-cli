import path from 'node:path'

import { describe, expect } from 'vitest'

import constants from '../../../src/constants.mts'
import { cmdit, invokeNpm } from '../../../test/utils.mts'

const { CLI } = constants

describe('socket config get', async () => {
  // Lazily access constants.rootBinPath.
  const entryPath = path.join(constants.rootBinPath, `${CLI}.js`)

  cmdit(
    ['config', 'get', '--help', '--config', '{}'],
    'should support --help',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(entryPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `
        "Get the value of a local CLI config item

          Usage
            $ socket config get <org slug>

          Options
            --help            Print this help
            --json            Output result as json
            --markdown        Output result as markdown

          Keys:

           - apiBaseUrl -- Base URL of the API endpoint
           - apiProxy -- A proxy through which to access the API
           - apiToken -- The API token required to access most API endpoints
           - defaultOrg -- The default org slug to use; usually the org your API token has access to. When set, all orgSlug arguments are implied to be this value.
           - enforcedOrgs -- Orgs in this list have their security policies enforced on this machine
           - isTestingV1 -- For development of testing the next major bump

          Examples
            $ socket config get FakeOrg --repoName=test-repo"
      `
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket config get\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain(
        '`socket config get`'
      )
    }
  )

  cmdit(
    ['config', 'get', '--dry-run', '--config', '{}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(entryPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket config get\`, cwd: <redacted>

        \\x1b[31m\\xd7\\x1b[39m \\x1b[41m\\x1b[1m\\x1b[37m Input error: \\x1b[39m\\x1b[22m\\x1b[49m \\x1b[1mPlease review the input requirements and try again

          - Config key should be the first arg (\\x1b[31mmissing\\x1b[39m)
        \\x1b[22m"
      `)

      expect(code, 'dry-run should exit with code 2 if missing input').toBe(2)
    }
  )

  cmdit(
    [
      'config',
      'test',
      'test',
      '--dry-run',
      '--config',
      '{"apiToken":"anything"}'
    ],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(entryPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `"[DryRun]: No-op, call a sub-command; ok"`
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket config\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    }
  )

  describe('env vars', () => {
    describe('token', () => {
      cmdit(
        ['config', 'get', 'apiToken', '--config', '{"apiToken":null}'],
        'should return undefined when token not set in config',
        async cmd => {
          const { stderr, stdout } = await invokeNpm(entryPath, cmd, {})
          expect(stdout).toMatchInlineSnapshot(
            `
            "apiToken: null

            Note: the config is in read-only mode, meaning at least one key was temporarily overridden from an env var or command flag."
          `
          )
          expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
            "
               _____         _       _        /---------------
              |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
              |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
              |_____|___|___|_,_|___|_|.dev   | Command: \`socket config get\`, cwd: <redacted>"
          `)

          expect(stdout.includes('apiToken: null')).toBe(true)
        }
      )

      cmdit(
        ['config', 'get', 'apiToken', '--config', '{"apiToken":null}'],
        'should return the env var token when set',
        async cmd => {
          const { stderr, stdout } = await invokeNpm(entryPath, cmd, {
            SOCKET_SECURITY_API_TOKEN: 'abc'
          })
          expect(stdout).toMatchInlineSnapshot(
            `
            "apiToken: abc

            Note: the config is in read-only mode, meaning at least one key was temporarily overridden from an env var or command flag."
          `
          )
          expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
            "
               _____         _       _        /---------------
              |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
              |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
              |_____|___|___|_,_|___|_|.dev   | Command: \`socket config get\`, cwd: <redacted>"
          `)

          expect(stdout.includes('apiToken: abc')).toBe(true)
        }
      )

      // Migrate this away...?
      cmdit(
        ['config', 'get', 'apiToken', '--config', '{"apiToken":null}'],
        'should backwards compat support api key as well env var',
        async cmd => {
          const { stderr, stdout } = await invokeNpm(entryPath, cmd, {
            SOCKET_SECURITY_API_KEY: 'abc'
          })
          expect(stdout).toMatchInlineSnapshot(
            `
            "apiToken: abc

            Note: the config is in read-only mode, meaning at least one key was temporarily overridden from an env var or command flag."
          `
          )
          expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
            "
               _____         _       _        /---------------
              |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
              |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
              |_____|___|___|_,_|___|_|.dev   | Command: \`socket config get\`, cwd: <redacted>"
          `)

          expect(stdout.includes('apiToken: abc')).toBe(true)
        }
      )

      cmdit(
        ['config', 'get', 'apiToken', '--config', '{"apiToken":null}'],
        'should be nice and support cli prefixed env var for token as well',
        async cmd => {
          const { stderr, stdout } = await invokeNpm(entryPath, cmd, {
            SOCKET_CLI_API_TOKEN: 'abc'
          })
          expect(stdout).toMatchInlineSnapshot(
            `
            "apiToken: abc

            Note: the config is in read-only mode, meaning at least one key was temporarily overridden from an env var or command flag."
          `
          )
          expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
            "
               _____         _       _        /---------------
              |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
              |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
              |_____|___|___|_,_|___|_|.dev   | Command: \`socket config get\`, cwd: <redacted>"
          `)

          expect(stdout.includes('apiToken: abc')).toBe(true)
        }
      )

      // Migrate this away...?
      cmdit(
        ['config', 'get', 'apiToken', '--config', '{"apiToken":null}'],
        'should be very nice and support cli prefixed env var for key as well since it is an easy mistake to make',
        async cmd => {
          const { stderr, stdout } = await invokeNpm(entryPath, cmd, {
            SOCKET_CLI_API_KEY: 'abc'
          })
          expect(stdout).toMatchInlineSnapshot(
            `
            "apiToken: abc

            Note: the config is in read-only mode, meaning at least one key was temporarily overridden from an env var or command flag."
          `
          )
          expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
            "
               _____         _       _        /---------------
              |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
              |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
              |_____|___|___|_,_|___|_|.dev   | Command: \`socket config get\`, cwd: <redacted>"
          `)

          expect(stdout.includes('apiToken: abc')).toBe(true)
        }
      )

      cmdit(
        [
          'config',
          'get',
          'apiToken',
          '--config',
          '{"apiToken":"ignoremebecausetheenvvarshouldbemoreimportant"}'
        ],
        'should use the env var token when the config override also has a token set',
        async cmd => {
          const { stderr, stdout } = await invokeNpm(entryPath, cmd, {
            SOCKET_CLI_API_KEY: 'abc'
          })
          expect(stdout).toMatchInlineSnapshot(
            `
            "apiToken: abc

            Note: the config is in read-only mode, meaning at least one key was temporarily overridden from an env var or command flag."
          `
          )
          expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
            "
               _____         _       _        /---------------
              |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
              |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
              |_____|___|___|_,_|___|_|.dev   | Command: \`socket config get\`, cwd: <redacted>"
          `)

          expect(stdout.includes('apiToken: abc')).toBe(true)
        }
      )

      cmdit(
        [
          'config',
          'get',
          'apiToken',
          '--config',
          '{"apiToken":"pickmepickme"}'
        ],
        'should use the config override when there is no env var',
        async cmd => {
          const { stderr, stdout } = await invokeNpm(entryPath, cmd, {})
          expect(stdout).toMatchInlineSnapshot(
            `
            "apiToken: pickmepickme

            Note: the config is in read-only mode, meaning at least one key was temporarily overridden from an env var or command flag."
          `
          )
          expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
            "
               _____         _       _        /---------------
              |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
              |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
              |_____|___|___|_,_|___|_|.dev   | Command: \`socket config get\`, cwd: <redacted>"
          `)

          expect(stdout.includes('apiToken: pickmepickme')).toBe(true)
        }
      )

      cmdit(
        ['config', 'get', 'apiToken', '--config', '{}'],
        'should yield no token when override has none',
        async cmd => {
          const { stderr, stdout } = await invokeNpm(entryPath, cmd, {})
          expect(stdout).toMatchInlineSnapshot(
            `
            "apiToken: undefined

            Note: the config is in read-only mode, meaning at least one key was temporarily overridden from an env var or command flag."
          `
          )
          expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
            "
               _____         _       _        /---------------
              |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
              |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
              |_____|___|___|_,_|___|_|.dev   | Command: \`socket config get\`, cwd: <redacted>"
          `)

          expect(stdout.includes('apiToken: undefined')).toBe(true)
        }
      )
    })
  })
})
