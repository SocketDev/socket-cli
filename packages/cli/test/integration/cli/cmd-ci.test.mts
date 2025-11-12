/**
 * Integration tests for `socket ci` command.
 *
 * Tests the CI command which is an alias for `socket scan create --report`.
 * This command creates a security scan and exits with a non-zero code if
 * the scan detects policy violations, making it ideal for automated CI/CD pipelines.
 *
 * Test Coverage:
 * - Help text display and usage examples
 * - Dry-run behavior validation
 * - Auto-manifest flag support
 * - Exit codes (success vs policy violations)
 *
 * CI/CD Integration:
 * This command is specifically designed for automated builds where security
 * policy enforcement is required. It uses the default organization from the
 * API token and fails the build when issues are detected.
 *
 * Related Files:
 * - src/commands/ci/cmd-ci.mts - Command definition
 * - src/commands/ci/handle-ci.mts - CI handler (delegates to scan create)
 * - src/commands/scan/cmd-scan-create.mts - Underlying scan create command
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

describe('socket ci', async () => {
  cmdit(
    ['ci', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`
        "Alias for \`socket scan create --report\` (creates report and exits with error if unhealthy)

          Usage
                $ socket ci [options]
          
              Options
                --auto-manifest     Auto generate manifest files where detected? See autoManifest flag in \`socket scan create\`
          
              This command is intended to use in CI runs to allow automated systems to
              accept or reject a current build. It will use the default org of the
              Socket API token. The exit code will be non-zero when the scan does not pass
              your security policy.
          
              The --auto-manifest flag does the same as the one from \`socket scan create\`
              but is not enabled by default since the CI is less likely to be set up with
              all the necessary dev tooling. Enable it if you want the scan to include
              locally generated manifests like for gradle and sbt.
          
              Examples
                $ socket ci
                $ socket ci --auto-manifest"
      `)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _          /---------------
            |   __|___ ___| |_ ___| |_        | CLI: <redacted>
            |__   | . |  _| '_| -_|  _|       | token: <redacted>, org: <redacted>
            |_____|___|___|_,_|___|_|.dev     | Command: \`socket ci\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain('`socket ci`')
    },
  )

  cmdit(
    ['ci', FLAG_DRY_RUN, FLAG_CONFIG, '{"apiToken":"fakeToken"}'],
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
            |_____|___|___|_,_|___|_|.dev     | Command: \`socket ci\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )
})
