import { describe, expect } from 'vitest'

import constants, {
  FLAG_CONFIG,
  FLAG_DRY_RUN,
  FLAG_HELP,
} from '../../../src/constants.mts'
import { cmdit, spawnSocketCli } from '../../../test/utils.mts'

describe('socket manifest scala', async () => {
  const { binCliPath } = constants

  cmdit(
    ['manifest', 'scala', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `
        "[beta] Generate a Socket facts file (or \`pom.xml\` with --pom) from a Scala \`build.sbt\` project

          Usage
            $ socket manifest scala [options] [CWD=.]

          Options
            --bin               Location of sbt binary to use
            --exclude-configs   When generating facts: comma-separated glob patterns; sbt configurations matching any pattern are skipped (applied after --include-configs)
            --facts             Emit a Socket facts JSON file (\`.socket.facts.json\`) describing the resolved dependency graph. This is the default; pass \`--pom\` to generate \`pom.xml\` files instead
            --ignore-unresolved  When generating facts: warn on unresolved dependencies instead of failing the run (unresolved deps are not emitted to the facts file)
            --include-configs   When generating facts: comma-separated glob patterns matched against sbt configuration names (case-sensitive; \`*\`, \`?\`, and \`[...]\` wildcards). Only configurations matching at least one pattern are resolved. e.g. \`compile,test\`. Default: compile,optional,provided,runtime,test
            --out               Only with --pom: path of the output \`pom.xml\`, see also --stdout. Does not apply when generating Socket facts (always written to the project root as \`.socket.facts.json\`)
            --pom               Generate \`pom.xml\` manifest file(s) instead of the default Socket facts file (\`.socket.facts.json\`)
            --sbt-opts          Additional options to pass on to sbt, as per \`sbt --help\`
            --stdout            Only with --pom: print the resulting \`pom.xml\` to stdout (supersedes --out). Does not apply when generating Socket facts
            --verbose           Print debug messages

          By default, emits a single \`.socket.facts.json\` describing the resolved
          dependency graph of the whole build. It reads dependency metadata only and
          never downloads artifacts; an unresolved dependency is a fatal error. You
          can pass --include-configs / --exclude-configs (comma-separated glob
          patterns) to control which sbt configurations are resolved (e.g.
          --include-configs=\`compile,test\`), and --ignore-unresolved to warn on
          unresolved dependencies instead of failing the run.

          Pass --pom to instead generate a \`pom.xml\` via \`sbt makePom\` from your
          \`build.sbt\`. The xml is the dependency manifest (like a package.json for
          Node.js or requirements.txt for PyPi), but specifically for Scala.
          Caveats of the \`build.sbt\` to \`pom.xml\` conversion:

          - the xml is exported as pom.xml at the project root so Socket scan picks
            it up; sbt itself first writes it inside your /target/sbt<version> folder
            (as a different name). Use --out to override if you already have a
            hand-authored pom.xml at the project root.

          - the pom.xml format (standard by Scala) does not support certain sbt features
            - \`excludeAll()\`, \`dependencyOverrides\`, \`force()\`, \`relativePath\`
            - For details: https://www.scala-sbt.org/1.x/docs/Library-Management.html

          - it uses your sbt settings and local configuration verbatim

          - it can only export one target per run, so if you have multiple targets like
            development and production, you must run them separately.

          You can specify --bin to override the path to the \`sbt\` binary to invoke.

          Support is beta. Please report issues or give us feedback on what's missing.

          This is only for SBT. If your Scala setup uses gradle, please see the help
          sections for \`socket manifest gradle\` or \`socket cdxgen\`.

          Examples

            $ socket manifest scala
            $ socket manifest scala --pom .
            $ socket manifest scala ./proj --bin=/usr/bin/sbt --file=boot.sbt"
      `,
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | CLI: <redacted>
          |__   | * |  _| '_| -_|  _|     | token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket manifest scala\`, cwd: <redacted>"
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
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | CLI: <redacted>
          |__   | * |  _| '_| -_|  _|     | token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket manifest scala\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )

  cmdit(
    ['manifest', 'scala', '--facts', FLAG_DRY_RUN, FLAG_CONFIG, '{}'],
    'should accept --facts with dry-run',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | CLI: <redacted>
          |__   | * |  _| '_| -_|  _|     | token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket manifest scala\`, cwd: <redacted>"
      `)

      expect(code, '--facts --dry-run should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'manifest',
      'scala',
      '--facts',
      '--out',
      'pom.xml',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{}',
    ],
    'should reject --out when generating Socket facts',
    async cmd => {
      const { code, stderr } = await spawnSocketCli(binCliPath, cmd)
      expect(stderr, 'rejects --out in facts mode').toContain(
        'The `--out` and `--stdout` options only apply with `--pom`',
      )
      expect(code, '--facts --out should exit with usage error code 2').toBe(2)
    },
  )
})
