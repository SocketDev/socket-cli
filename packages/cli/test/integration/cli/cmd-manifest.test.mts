/**
 * Integration tests for `socket manifest` root command.
 *
 * Tests the manifest generation root command which provides access to
 * ecosystem-specific SBOM (Software Bill of Materials) generation.
 *
 * Test Coverage:
 *
 * - Help text display and subcommand listing
 * - Dry-run behavior validation
 * - Subcommand routing
 *
 * Available Subcommands:
 *
 * - Auto: Auto-detect and generate manifests
 * - Conda: Generate conda environment manifests
 * - Gradle: Generate Gradle project manifests
 * - Kotlin: Generate Kotlin project manifests
 * - Scala: Generate Scala/SBT project manifests
 * - Setup: Install manifest generation tools
 *
 * Related Files:
 *
 * - Src/commands/manifest/cmd-manifest.mts - Root command definition
 * - Src/commands/manifest/cmd-manifest-*.mts - Ecosystem-specific commands
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

describe('socket manifest', async () => {
  cmdit(
    ['manifest', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`
        "Generate a dependency manifest for certain ecosystems

          Usage
              $ socket manifest <command>
          
            Commands
              auto                        Auto-detect build and attempt to generate manifest file
              cdxgen                      Run cdxgen for SBOM generation
              conda                       [beta] Convert a Conda environment.yml file to a python requirements.txt
              gradle                      [beta] Use Gradle to generate a manifest file (\`pom.xml\`) for a Gradle/Java/Kotlin/etc project
              kotlin                      [beta] Use Gradle to generate a manifest file (\`pom.xml\`) for a Kotlin project
              scala                       [beta] Generate a manifest file (\`pom.xml\`) from Scala's \`build.sbt\` file
              setup                       Start interactive configurator to customize default flag values for \`socket manifest\` in this dir
          
            Options
          
              --no-banner                 Hide the Socket banner
              --no-spinner                Hide the console spinner
              --quiet                     Route non-essential output (status, progress, warnings) to stderr so stdout carries only the payload. Implied by --json and --markdown."
      `)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _          /---------------
            |   __|___ ___| |_ ___| |_        | CLI: <redacted>
            |__   | . |  _| '_| -_|  _|       | token: <redacted>, org: <redacted>
            |_____|___|___|_,_|___|_|.dev     | Command: \`socket manifest\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain(
        '`socket manifest`',
      )
    },
  )

  cmdit(
    [
      'manifest',
      'mootools',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should reject unknown subcommands even with dry-run',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)

      // Unknown subcommands now error out instead of falling through to the
      // dry-run no-op.
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
