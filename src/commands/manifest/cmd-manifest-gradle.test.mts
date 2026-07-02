import { describe, expect } from 'vitest'

import constants, {
  FLAG_CONFIG,
  FLAG_DRY_RUN,
  FLAG_HELP,
} from '../../../src/constants.mts'
import { cmdit, spawnSocketCli } from '../../../test/utils.mts'

describe('socket manifest gradle', async () => {
  const { binCliPath } = constants

  cmdit(
    ['manifest', 'gradle', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `
        "[beta] Generate a Socket facts file (or \`pom.xml\` with --pom) for a Gradle/Java/Kotlin/etc project

          Usage
            $ socket manifest gradle [options] [CWD=.]

          Options
            --bin               Location of the gradle binary to use, default: ./gradlew if present, else gradle on PATH
            --exclude-configs   When generating facts: comma-separated glob patterns; Gradle configurations matching any pattern are skipped (applied after --include-configs)
            --facts             Emit a Socket facts JSON file (\`.socket.facts.json\`) describing the resolved dependency graph. This is the default; pass \`--pom\` to generate \`pom.xml\` files instead
            --gradle-opts       Additional options to pass on to ./gradlew, see \`./gradlew --help\`
            --ignore-unresolved  When generating facts: warn on unresolved dependencies instead of failing the run (unresolved deps are not emitted to the facts file)
            --include-configs   When generating facts: comma-separated glob patterns matched against Gradle configuration names (case-sensitive; \`*\`, \`?\`, and \`[...]\` wildcards). Only configurations matching at least one pattern are resolved. e.g. \`*CompileClasspath,*RuntimeClasspath\`. Default: every resolvable configuration
            --pom               Generate \`pom.xml\` manifest file(s) instead of the default Socket facts file (\`.socket.facts.json\`)
            --verbose           Print debug messages

          By default, emits a single \`.socket.facts.json\` describing the resolved
          dependency graph of the whole build, using gradle (preferably your local
          \`gradlew\`). An unresolved dependency is a fatal error. You can pass
          --include-configs / --exclude-configs (comma-separated glob patterns) to
          control which configurations are resolved (e.g.
          --include-configs=\`*CompileClasspath,*RuntimeClasspath\`), and
          --ignore-unresolved to warn on unresolved dependencies instead of failing.

          Pass --pom to instead generate \`pom.xml\` manifest files via gradle (one per
          task). The \`pom.xml\` is a manifest file similar to \`package.json\` for npm
          (or requirements.txt for PyPi), but specifically for Maven, which is
          Java's dependency repository. Caveats of the \`pom.xml\` conversion:

          - each task generates its own xml file (one per task by default)

          - certain features may not translate well into the xml; reach out if
            something you need is missing

          - it works with your \`gradlew\` from your repo and local settings and config

          Support is beta. Please report issues or give us feedback on what's missing.

          Examples

            $ socket manifest gradle .
            $ socket manifest gradle --pom .
            $ socket manifest gradle --bin=../gradlew ."
      `,
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | CLI: <redacted>
          |__   | * |  _| '_| -_|  _|     | token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket manifest gradle\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain(
        '`socket manifest gradle`',
      )
    },
  )

  cmdit(
    ['manifest', 'gradle', FLAG_DRY_RUN, FLAG_CONFIG, '{}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | CLI: <redacted>
          |__   | * |  _| '_| -_|  _|     | token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket manifest gradle\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )

  cmdit(
    ['manifest', 'gradle', '--facts', FLAG_DRY_RUN, FLAG_CONFIG, '{}'],
    'should accept --facts with dry-run',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | CLI: <redacted>
          |__   | * |  _| '_| -_|  _|     | token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket manifest gradle\`, cwd: <redacted>"
      `)

      expect(code, '--facts --dry-run should exit with code 0').toBe(0)
    },
  )
})
