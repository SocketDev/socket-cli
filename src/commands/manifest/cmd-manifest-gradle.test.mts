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
        "[beta] Use Gradle to generate a manifest file (\`pom.xml\`) for a Gradle/Java/Kotlin/etc project

          Usage
            $ socket manifest gradle [options] [CWD=.]

          Options
            --bin               Location of gradlew binary to use, default: CWD/gradlew
            --configs           With --facts: comma-separated glob patterns matched against Gradle configuration names (case-sensitive, \`*\` and \`?\` wildcards). e.g. \`*CompileClasspath,*RuntimeClasspath\` to skip tooling configs. Default: every resolvable configuration except AGP instrumented-test classpaths
            --facts             Emit a Socket facts JSON file (\`.socket.facts.json\`) describing the resolved dependency graph instead of generating \`pom.xml\` files
            --gradle-opts       Additional options to pass on to ./gradlew, see \`./gradlew --help\`
            --ignore-unresolved  With --facts: skip dependencies that fail to resolve instead of failing the run
            --verbose           Print debug messages

          Uses gradle, preferably through your local project \`gradlew\`, to generate a
          \`pom.xml\` file for each task. If you have no \`gradlew\` you can try the
          global \`gradle\` binary but that may not work (hard to predict).

          The \`pom.xml\` is a manifest file similar to \`package.json\` for npm or
          or requirements.txt for PyPi), but specifically for Maven, which is Java's
          dependency repository. Languages like Kotlin and Scala piggy back on it too.

          There are some caveats with the gradle to \`pom.xml\` conversion:

          - each task will generate its own xml file and by default it generates one xml
            for every task. (This may be a good thing!)

          - it's possible certain features don't translate well into the xml. If you
            think something is missing that could be supported please reach out.

          - it works with your \`gradlew\` from your repo and local settings and config

          Pass --facts to instead emit a single \`.socket.facts.json\` describing the
          resolved dependency graph of the whole build (no \`pom.xml\` files). An
          unresolved dependency is a fatal error. With --facts you can pass
          --configs=<comma-separated glob patterns> to restrict resolution to
          matching configurations (e.g. \`*CompileClasspath,*RuntimeClasspath\`),
          and --ignore-unresolved to skip dependencies that fail to resolve.

          Support is beta. Please report issues or give us feedback on what's missing.

          Examples

            $ socket manifest gradle .
            $ socket manifest gradle --facts .
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
