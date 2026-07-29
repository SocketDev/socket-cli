/**
 * Integration tests for `socket manifest scala` command.
 *
 * Tests Scala/SBT project manifest generation.
 *
 * Test Coverage: - Help text display and usage examples - Dry-run behavior
 * validation - build.sbt parsing - Multi-project build support.
 *
 * Related Files: - src/commands/manifest/cmd-manifest-scala.mts - Command
 * definition - src/commands/manifest/handle-manifest-scala.mts - Scala/SBT
 * manifest logic.
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

describe('socket manifest scala', async () => {
  cmdit(
    ['manifest', 'scala', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`
        "[beta] Generate a Socket facts file (or \`pom.xml\` with --pom) from a Scala \`build.sbt\` project

          Usage
                $ socket manifest scala [options] [CWD=.]
          
              Options
                --bin               Location of sbt binary to use
                --exclude-configs   When generating facts: comma-separated glob patterns; sbt configurations matching any pattern are skipped (applied after --include-configs)
                --exclude-paths     List of glob patterns to exclude from the scan, including SCA/SBOM manifest discovery and (when --reach is enabled) Tier 1 reachability analysis. Patterns are matched relative to the project root. Bare directory names are auto-extended to recursive globs (e.g. \`tests\` becomes \`tests/**\`). Trailing slashes are stripped. Negation patterns (\`!path\`) are not supported. Accepts a comma-separated value or multiple flags.
                --facts             Emit a Socket facts JSON file (\`.socket.facts.json\`) describing the resolved dependency graph. This is the default; pass \`--pom\` to generate \`pom.xml\` files instead
                --ignore-unresolved  When generating facts: warn on unresolved dependencies instead of failing the run (unresolved deps are not emitted to the facts file)
                --include-configs   When generating facts: comma-separated glob patterns matched against sbt configuration names (case-sensitive; \`*\`, \`?\`, and \`[...]\` wildcards). Only configurations matching at least one pattern are resolved. e.g. \`compile,test\`. Default: compile,optional,provided,runtime,test
                --out               Only with --pom: path of the output \`pom.xml\`, see also --stdout. Does not apply when generating Socket facts (always written to the project root as \`.socket.facts.json\`)
                --pom               Generate \`pom.xml\` manifest file(s) instead of the default Socket facts file (\`.socket.facts.json\`)
                --quiet             Route non-essential output (status, progress, warnings) to stderr so stdout carries only the payload. Implied by --json and --markdown.
                --sbt-opts          Additional options to pass on to sbt, as per \`sbt --help\`
                --stdout            Only with --pom: print the resulting \`pom.xml\` to stdout (supersedes --out). Does not apply when generating Socket facts
                --trust-socket-json  Run the binary and options declared in socket.json. Off by default because the scanned repository controls that file.
                --verbose           Print debug messages
          
              By default, emits a single \`.socket.facts.json\` describing the resolved
              dependency graph of your sbt build, using the bundled sbt plugin. It never
              downloads artifacts; an unresolved dependency is a fatal error. You can pass
              --include-configs / --exclude-configs (comma-separated glob patterns) to
              control which configurations are resolved, and --ignore-unresolved to warn
              on unresolved dependencies instead of failing.
          
              The default binary is the \`sbt\` on your PATH. A socket.json that points
              \`bin\` somewhere else, or that sets \`sbtOpts\`, is refused unless you pass
              --trust-socket-json: those values choose what gets executed and the
              repository being scanned owns that file. Pass --bin and --sbt-opts yourself
              to override the defaults without trusting socket.json.
          
              Pass --pom to instead generate a \`pom.xml\` via \`sbt makePom\` from your
              \`build.sbt\`. This xml file is the dependency manifest (like a package.json
              for Node.js or requirements.txt for PyPi), but specifically for Scala.
              Caveats of the \`build.sbt\` to \`pom.xml\` conversion:
          
              - the xml is exported as pom.xml at the project root so Socket scan picks
                it up, but it will first hit your /target/sbt<version> folder (as a
                different name). Use --out to override if you already have a
                hand-authored pom.xml at the project root.
          
              - the pom.xml format (standard by Scala) does not support certain sbt features
                - \`excludeAll()\`, \`dependencyOverrides\`, \`force()\`, \`relativePath\`
                - For details: https://www.scala-sbt.org/1.x/docs/Library-Management.html
          
              - it uses your sbt settings and local configuration verbatim
          
              - it can only export one target per run, so if you have multiple targets like
                development and production, you must run them separately.
          
              Support is beta. Please report issues or give us feedback on what's missing.
          
              This is only for SBT. If your Scala setup uses gradle, please see the help
              sections for \`socket manifest gradle\` or \`socket cdxgen\`.
          
              Examples
          
                $ socket manifest scala .
                $ socket manifest scala --pom .
                $ socket manifest scala ./proj --bin=/usr/bin/sbt"
      `)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _          /---------------
            |   __|___ ___| |_ ___| |_        | CLI: <redacted>
            |__   | . |  _| '_| -_|  _|       | token: <redacted>, org: <redacted>
            |_____|___|___|_,_|___|_|.dev     | Command: \`socket manifest scala\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain(
        '`socket manifest scala`',
      )
    },
  )

  cmdit(
    ['manifest', 'scala', FLAG_DRY_RUN, FLAG_CONFIG, '{}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)

      // Validate dry-run output to prevent flipped snapshots.
      expectDryRunOutput(stderr)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _          /---------------
            |   __|___ ___| |_ ___| |_        | CLI: <redacted>
            |__   | . |  _| '_| -_|  _|       | token: <redacted>, org: <redacted>
            |_____|___|___|_,_|___|_|.dev     | Command: \`socket manifest scala\`, cwd: <redacted>


        [DryRun]: Would execute generate .socket.facts.json from Scala project

          Command: sbt
          Arguments: [PROJECT] --bin sbt --out ./pom.xml

          Run without --dry-run to execute this command."
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )
})
