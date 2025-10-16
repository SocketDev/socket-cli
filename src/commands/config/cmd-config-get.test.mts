import semver from 'semver'
import { describe, expect } from 'vitest'

import { NODE_VERSION } from '@socketsecurity/registry/constants/node'
import { WIN32 } from '@socketsecurity/registry/constants/platform'

import { cmdit, spawnSocketCli } from '../../../test/utils.mts'
import { FLAG_CONFIG, FLAG_DRY_RUN, FLAG_HELP } from '../constants/cli.mts'
import { getBinCliPath } from '../constants/paths.mts'

const binCliPath = getBinCliPath()

describe('socket config get', async () => {cmdit(
    ['config', 'get', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      // Node 24 on Windows currently fails this test with added stderr:
      // Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 76
      const skipOnWin32Node24 =
        WIN32 && semver.parse(NODE_VERSION)?.major >= 24
      if (!skipOnWin32Node24) {
        expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
          "
             "
        `)
        expect(code, 'explicit help should exit with code 0').toBe(0)
      }

      expect(stderr, 'banner includes base command').toContain(
        '`socket config get`',
      )
    },
  )

  cmdit(
    ['config', 'get', FLAG_DRY_RUN, FLAG_CONFIG, '{}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           "
      `)

      expect(code, 'dry-run should exit with code 2 if missing input').toBe(2)
    },
  )

  cmdit(
    [
      'config',
      'test',
      'test',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           "
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )

  describe('env vars', () => {
    describe('token', () => {
      cmdit(
        ['config', 'get', 'apiToken', FLAG_CONFIG, '{"apiToken":null}'],
        'should return undefined when token not set in config',
        async cmd => {
          const { stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
          expect(stdout).toMatchInlineSnapshot(`""`)
          expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
            "
               "
          `)

          expect(stdout.includes('apiToken: null')).toBe(true)
        },
      )

      cmdit(
        ['config', 'get', 'apiToken', FLAG_CONFIG, '{"apiToken":null}'],
        'should return the env var token when set',
        async cmd => {
          const { stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
            env: { SOCKET_CLI_API_TOKEN: 'abc' },
          })
          expect(stdout).toMatchInlineSnapshot(`""`)
          expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
            "
               "
          `)

          expect(stdout.includes('apiToken: abc')).toBe(true)
        },
      )

      // Migrate this away...?
      cmdit(
        ['config', 'get', 'apiToken', FLAG_CONFIG, '{"apiToken":null}'],
        'should back compat support for API token as well env var',
        async cmd => {
          const { stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
            env: { SOCKET_SECURITY_API_KEY: 'abc' },
          })
          expect(stdout).toMatchInlineSnapshot(`""`)
          expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
            "
               "
          `)

          expect(stdout.includes('apiToken: abc')).toBe(true)
        },
      )

      cmdit(
        ['config', 'get', 'apiToken', FLAG_CONFIG, '{"apiToken":null}'],
        'should be nice and support cli prefixed env var for token as well',
        async cmd => {
          const { stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
            env: { SOCKET_CLI_API_TOKEN: 'abc' },
          })
          expect(stdout).toMatchInlineSnapshot(`""`)
          expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
            "
               "
          `)

          expect(stdout.includes('apiToken: abc')).toBe(true)
        },
      )

      // Migrate this away...?
      cmdit(
        ['config', 'get', 'apiToken', FLAG_CONFIG, '{"apiToken":null}'],
        'should be very nice and support cli prefixed env var for key as well since it is an easy mistake to make',
        async cmd => {
          const { stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
            env: { SOCKET_CLI_API_KEY: 'abc' },
          })
          expect(stdout).toMatchInlineSnapshot(`""`)
          expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
            "
               "
          `)

          expect(stdout.includes('apiToken: abc')).toBe(true)
        },
      )

      cmdit(
        [
          'config',
          'get',
          'apiToken',
          FLAG_CONFIG,
          '{"apiToken":"ignoremebecausetheenvvarshouldbemoreimportant"}',
        ],
        'should use the env var token when the config override also has a token set',
        async cmd => {
          const { stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
            env: { SOCKET_CLI_API_KEY: 'abc' },
          })
          expect(stdout).toMatchInlineSnapshot(`""`)
          expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
            "
               "
          `)

          expect(stdout.includes('apiToken: abc')).toBe(true)
        },
      )

      cmdit(
        [
          'config',
          'get',
          'apiToken',
          FLAG_CONFIG,
          '{"apiToken":"pickmepickme"}',
        ],
        'should use the config override when there is no env var',
        async cmd => {
          const { stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
          expect(stdout).toMatchInlineSnapshot(`""`)
          expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
            "
               "
          `)

          expect(stdout.includes('apiToken: pickmepickme')).toBe(true)
        },
      )

      cmdit(
        ['config', 'get', 'apiToken', FLAG_CONFIG, '{}'],
        'should yield no token when override has none',
        async cmd => {
          const { stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
          expect(stdout).toMatchInlineSnapshot(`""`)
          expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
            "
               "
          `)

          expect(stdout.includes('apiToken: undefined')).toBe(true)
        },
      )
    })
  })
})
