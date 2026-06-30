import { describe, expect } from 'vitest'

import constants, {
  FLAG_CONFIG,
  FLAG_DRY_RUN,
  FLAG_HELP,
} from '../../../src/constants.mts'
import { cmdit, spawnSocketCli } from '../../../test/utils.mts'

describe('socket manifest maven', async () => {
  const { binCliPath } = constants

  cmdit(
    ['manifest', 'maven', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`
        "[beta] Generate a Socket facts file from a Maven \`pom.xml\` project

          Usage
            $ socket manifest maven [options] [CWD=.]

          Options
            --bin               Location of the maven binary to use, default: ./mvnw if present, else mvn on PATH
            --exclude-configs   Comma-separated glob patterns; Maven scopes matching any pattern are skipped (applied after --include-configs)
            --ignore-unresolved  Warn on unresolved dependencies instead of failing the run (unresolved deps are not emitted to the facts file)
            --include-configs   Comma-separated glob patterns matched against Maven dependency scopes (case-sensitive, \`*\` and \`?\` wildcards). Only scopes matching at least one pattern are resolved. e.g. \`compile,runtime\`. Default: every scope
            --maven-opts        Additional options to pass on to maven, e.g. \`-P <profile> -s <settings.xml>\`
            --verbose           Print debug messages

          Emits a single \`.socket.facts.json\` describing the resolved dependency
          graph of your Maven project, using maven (\`mvn\` on PATH by default). It
          reads dependency metadata only and never downloads artifacts; an unresolved
          dependency is a fatal error. You can pass --include-configs /
          --exclude-configs (comma-separated glob patterns) to control which Maven
          scopes are resolved (e.g. --include-configs=\`compile,runtime\`), and
          --ignore-unresolved to warn on unresolved dependencies instead of failing.

          You can specify --bin to override the path to the \`mvn\` binary to invoke
          (e.g. a project \`./mvnw\` wrapper), and --maven-opts to pass extra options
          through to maven (e.g. \`-P <profile> -s <settings.xml>\`).

          Support is beta. Please report issues or give us feedback on what's missing.

          Examples

            $ socket manifest maven .
            $ socket manifest maven --bin=./mvnw .
            $ socket manifest maven --maven-opts="-P release" ."
      `)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | CLI: <redacted>
          |__   | * |  _| '_| -_|  _|     | token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket manifest maven\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain(
        '`socket manifest maven`',
      )
    },
  )

  cmdit(
    ['manifest', 'maven', FLAG_DRY_RUN, FLAG_CONFIG, '{}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | CLI: <redacted>
          |__   | * |  _| '_| -_|  _|     | token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket manifest maven\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )
})
