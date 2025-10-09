import { describe, expect } from 'vitest'

import constants, {
  ENVIRONMENT_YAML,
  ENVIRONMENT_YML,
  FLAG_CONFIG,
  FLAG_DRY_RUN,
  FLAG_HELP,
  REQUIREMENTS_TXT,
} from '../../../src/constants.mts'
import {
  cleanOutput,
  cmdit,
  spawnSocketCli,
  testPath,
} from '../../../test/utils.mts'

describe('socket manifest conda', async () => {
  const { binCliPath } = constants

  cmdit(
    ['manifest', 'conda', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: testPath,
      })
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           node:internal/modules/cjs/loader:1423
          throw err;
          ^

        Error: Cannot find module './external/ink'
        Require stack:
        - /Users/jdalton/projects/socket-cli/dist/utils.js
        - /Users/jdalton/projects/socket-cli/dist/cli.js
            at Module._resolveFilename (node:internal/modules/cjs/loader:1420:15)
            at defaultResolveImpl (node:internal/modules/cjs/loader:1058:19)
            at resolveForCJSWithHooks (node:internal/modules/cjs/loader:1063:22)
            at Module._load (node:internal/modules/cjs/loader:1226:37)
            at TracingChannel.traceSync (node:diagnostics_channel:322:14)
            at wrapModuleLoad (node:internal/modules/cjs/loader:244:24)
            at Module.require (node:internal/modules/cjs/loader:1503:12)
            at require (node:internal/modules/helpers:152:16)
            at Object.<anonymous> (/Users/jdalton/projects/socket-cli/dist/utils.js:1:2437)
            at Module._compile (node:internal/modules/cjs/loader:1760:14) {
          code: 'MODULE_NOT_FOUND',
          requireStack: [
            '/Users/jdalton/projects/socket-cli/dist/utils.js',
            '/Users/jdalton/projects/socket-cli/dist/cli.js'
          ]
        }

        Node.js v24.8.0"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain(
        '`socket manifest conda`',
      )
    },
  )

  cmdit(
    ['manifest', 'conda', FLAG_DRY_RUN, FLAG_CONFIG, '{}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: testPath,
      })
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           node:internal/modules/cjs/loader:1423
          throw err;
          ^

        Error: Cannot find module './external/ink'
        Require stack:
        - /Users/jdalton/projects/socket-cli/dist/utils.js
        - /Users/jdalton/projects/socket-cli/dist/cli.js
            at Module._resolveFilename (node:internal/modules/cjs/loader:1420:15)
            at defaultResolveImpl (node:internal/modules/cjs/loader:1058:19)
            at resolveForCJSWithHooks (node:internal/modules/cjs/loader:1063:22)
            at Module._load (node:internal/modules/cjs/loader:1226:37)
            at TracingChannel.traceSync (node:diagnostics_channel:322:14)
            at wrapModuleLoad (node:internal/modules/cjs/loader:244:24)
            at Module.require (node:internal/modules/cjs/loader:1503:12)
            at require (node:internal/modules/helpers:152:16)
            at Object.<anonymous> (/Users/jdalton/projects/socket-cli/dist/utils.js:1:2437)
            at Module._compile (node:internal/modules/cjs/loader:1760:14) {
          code: 'MODULE_NOT_FOUND',
          requireStack: [
            '/Users/jdalton/projects/socket-cli/dist/utils.js',
            '/Users/jdalton/projects/socket-cli/dist/cli.js'
          ]
        }

        Node.js v24.8.0"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )

  describe('output flags', () => {
    cmdit(
      [
        'manifest',
        'conda',
        'fixtures/commands/manifest/conda',
        '--stdout',
        FLAG_CONFIG,
        '{}',
      ],
      'should print raw text without flags',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
          cwd: testPath,
        })
        expect(stdout).toMatchInlineSnapshot(`""`)
        expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
          "
             node:internal/modules/cjs/loader:1423
            throw err;
            ^

          Error: Cannot find module './external/ink'
          Require stack:
          - /Users/jdalton/projects/socket-cli/dist/utils.js
          - /Users/jdalton/projects/socket-cli/dist/cli.js
              at Module._resolveFilename (node:internal/modules/cjs/loader:1420:15)
              at defaultResolveImpl (node:internal/modules/cjs/loader:1058:19)
              at resolveForCJSWithHooks (node:internal/modules/cjs/loader:1063:22)
              at Module._load (node:internal/modules/cjs/loader:1226:37)
              at TracingChannel.traceSync (node:diagnostics_channel:322:14)
              at wrapModuleLoad (node:internal/modules/cjs/loader:244:24)
              at Module.require (node:internal/modules/cjs/loader:1503:12)
              at require (node:internal/modules/helpers:152:16)
              at Object.<anonymous> (/Users/jdalton/projects/socket-cli/dist/utils.js:1:2437)
              at Module._compile (node:internal/modules/cjs/loader:1760:14) {
            code: 'MODULE_NOT_FOUND',
            requireStack: [
              '/Users/jdalton/projects/socket-cli/dist/utils.js',
              '/Users/jdalton/projects/socket-cli/dist/cli.js'
            ]
          }

          Node.js v24.8.0"
        `)
      },
    )

    cmdit(
      [
        'manifest',
        'conda',
        'fixtures/commands/manifest/conda',
        '--json',
        '--stdout',
        FLAG_CONFIG,
        '{}',
      ],
      'should print a json blurb with --json flag',
      async cmd => {
        const { stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
          cwd: testPath,
        })
        expect(cleanOutput(stdout)).toMatchInlineSnapshot(`""`)
        expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
          "
             node:internal/modules/cjs/loader:1423
            throw err;
            ^

          Error: Cannot find module './external/ink'
          Require stack:
          - /Users/jdalton/projects/socket-cli/dist/utils.js
          - /Users/jdalton/projects/socket-cli/dist/cli.js
              at Module._resolveFilename (node:internal/modules/cjs/loader:1420:15)
              at defaultResolveImpl (node:internal/modules/cjs/loader:1058:19)
              at resolveForCJSWithHooks (node:internal/modules/cjs/loader:1063:22)
              at Module._load (node:internal/modules/cjs/loader:1226:37)
              at TracingChannel.traceSync (node:diagnostics_channel:322:14)
              at wrapModuleLoad (node:internal/modules/cjs/loader:244:24)
              at Module.require (node:internal/modules/cjs/loader:1503:12)
              at require (node:internal/modules/helpers:152:16)
              at Object.<anonymous> (/Users/jdalton/projects/socket-cli/dist/utils.js:1:2437)
              at Module._compile (node:internal/modules/cjs/loader:1760:14) {
            code: 'MODULE_NOT_FOUND',
            requireStack: [
              '/Users/jdalton/projects/socket-cli/dist/utils.js',
              '/Users/jdalton/projects/socket-cli/dist/cli.js'
            ]
          }

          Node.js v24.8.0"
        `)
      },
    )

    cmdit(
      [
        'manifest',
        'conda',
        'fixtures/commands/manifest/conda',
        '--markdown',
        '--stdout',
        FLAG_CONFIG,
        '{}',
      ],
      'should print a markdown blurb with --markdown flag',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
          cwd: testPath,
        })
        expect(cleanOutput(stdout)).toMatchInlineSnapshot(`""`)
        expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
          "
             node:internal/modules/cjs/loader:1423
            throw err;
            ^

          Error: Cannot find module './external/ink'
          Require stack:
          - /Users/jdalton/projects/socket-cli/dist/utils.js
          - /Users/jdalton/projects/socket-cli/dist/cli.js
              at Module._resolveFilename (node:internal/modules/cjs/loader:1420:15)
              at defaultResolveImpl (node:internal/modules/cjs/loader:1058:19)
              at resolveForCJSWithHooks (node:internal/modules/cjs/loader:1063:22)
              at Module._load (node:internal/modules/cjs/loader:1226:37)
              at TracingChannel.traceSync (node:diagnostics_channel:322:14)
              at wrapModuleLoad (node:internal/modules/cjs/loader:244:24)
              at Module.require (node:internal/modules/cjs/loader:1503:12)
              at require (node:internal/modules/helpers:152:16)
              at Object.<anonymous> (/Users/jdalton/projects/socket-cli/dist/utils.js:1:2437)
              at Module._compile (node:internal/modules/cjs/loader:1760:14) {
            code: 'MODULE_NOT_FOUND',
            requireStack: [
              '/Users/jdalton/projects/socket-cli/dist/utils.js',
              '/Users/jdalton/projects/socket-cli/dist/cli.js'
            ]
          }

          Node.js v24.8.0"
        `)
      },
    )
  })
})
