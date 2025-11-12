/**
 * Integration tests for `socket manifest auto` command.
 *
 * Tests automatic manifest generation with ecosystem detection.
 * This command analyzes the project structure and generates appropriate
 * manifest files for detected ecosystems.
 *
 * Test Coverage:
 * - Help text display and usage examples
 * - Dry-run behavior validation
 * - Ecosystem auto-detection
 * - Multi-ecosystem project support
 *
 * Supported Ecosystems:
 * - npm (package.json)
 * - pnpm (pnpm-lock.yaml)
 * - yarn (yarn.lock)
 * - Gradle (build.gradle, build.gradle.kts)
 * - SBT (build.sbt)
 * - Conda (environment.yml)
 *
 * Related Files:
 * - src/commands/manifest/cmd-manifest-auto.mts - Command definition
 * - src/commands/manifest/handle-manifest-auto.mts - Auto-detection logic
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

describe('socket manifest auto', async () => {
  cmdit(
    ['manifest', 'auto', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`
        "Auto-detect build and attempt to generate manifest file

          Usage
                $ socket manifest auto [options] [CWD=.]
          
              Options
                --verbose           Enable debug output (only for auto itself; sub-steps need to have it pre-configured), may help when running into errors
          
              Tries to figure out what language your target repo uses. If it finds a
              supported case then it will try to generate the manifest file for that
              language with the default or detected settings.
          
              Note: you can exclude languages from being auto-generated if you don't want
                    them to. Run \`socket manifest setup\` in the same dir to disable it.
          
              Examples
          
                $ socket manifest auto
                $ socket manifest auto ./project/foo"
      `)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _          /---------------
            |   __|___ ___| |_ ___| |_        | CLI: <redacted>
            |__   | . |  _| '_| -_|  _|       | token: <redacted>, org: <redacted>
            |_____|___|___|_,_|___|_|.dev     | Command: \`socket manifest auto\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain(
        '`socket manifest auto`',
      )
    },
  )

  cmdit(
    ['manifest', 'auto', FLAG_DRY_RUN, FLAG_CONFIG, '{"apiToken":"fakeToken"}'],
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
            |_____|___|___|_,_|___|_|.dev     | Command: \`socket manifest auto\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )
})
