/**
 * Integration tests for `socket raw-npx` command.
 *
 * Tests running npx without Socket security scanning wrapper.
 * This command provides an escape hatch for operations that must bypass scanning.
 *
 * Test Coverage:
 * - Help text display and usage examples
 * - Dry-run behavior validation
 * - Unwrapped npx execution
 * - Pass-through of npx flags and arguments
 *
 * Use Cases:
 * - Testing npx behavior without Socket intervention
 * - CI/CD scenarios requiring unwrapped npx
 * - Debugging wrapper-related issues
 *
 * Related Files:
 * - src/commands/wrapper/raw-npx.mts - Unwrapped npx command
 * - test/integration/cli/cmd-npx.test.mts - Wrapped npx tests
 */

import { describe, expect } from 'vitest'

import {
  FLAG_CONFIG,
  FLAG_DRY_RUN,
  FLAG_HELP,
} from '../../../src/constants/cli.mts'
import { getBinCliPath } from '../../../src/constants/paths.mts'
import { expectDryRunOutput } from '../../helpers/output-assertions.mts'
import { cmdit, spawnSocketCli } from '../../utils.mts'

const binCliPath = getBinCliPath()

describe('socket raw-npx', async () => {
  cmdit(
    ['raw-npx', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`
        "Run npx without the Socket wrapper

          Usage
                $ socket raw-npx ...
          
              Execute \`npx\` without gating installs through the Socket API.
              Useful when  \`socket wrapper on\` is enabled and you want to bypass
              the Socket wrapper. Use at your own risk.
          
              Note: Everything after "raw-npx" is passed to the npx command.
                    Only the \`--dry-run\` and \`--help\` flags are caught here.
          
              Examples
                $ socket raw-npx cowsay"
      `)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _          /---------------
            |   __|___ ___| |_ ___| |_        | CLI: <redacted>
            |__   | . |  _| '_| -_|  _|       | token: <redacted>, org: <redacted>
            |_____|___|___|_,_|___|_|.dev     | Command: \`socket raw-npx\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain(
        '`socket raw-npx`',
      )
    },
  )

  cmdit(
    ['raw-npx', FLAG_DRY_RUN, FLAG_CONFIG, '{"apiToken":"fakeToken"}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)

      // Validate dry-run output to prevent flipped snapshots.
      expectDryRunOutput(stdout)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _          /---------------
            |   __|___ ___| |_ ___| |_        | CLI: <redacted>
            |__   | . |  _| '_| -_|  _|       | token: <redacted>, org: <redacted>
            |_____|___|___|_,_|___|_|.dev     | Command: \`socket raw-npx\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )
})
