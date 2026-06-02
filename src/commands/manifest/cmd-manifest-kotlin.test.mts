import { describe, expect } from 'vitest'

import constants, {
  FLAG_CONFIG,
  FLAG_DRY_RUN,
  FLAG_HELP,
} from '../../../src/constants.mts'
import { cmdit, spawnSocketCli } from '../../../test/utils.mts'

describe('socket manifest kotlin', async () => {
  const { binCliPath } = constants

  cmdit(
    ['manifest', 'kotlin', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `
        "[beta] Generate a Socket facts file (or \`pom.xml\` with --pom) for a Kotlin project

          Usage
            $ socket manifest kotlin [options] [CWD=.]

          Options
            --bin               Location of gradlew binary to use, default: CWD/gradlew
            --configs           With --facts: comma-separated glob patterns matched against Gradle configuration names (case-sensitive, \`*\` and \`?\` wildcards). e.g. \`*CompileClasspath,*RuntimeClasspath\` to skip tooling configs. Default: every resolvable configuration except AGP instrumented-test classpaths
            --facts             Emit a Socket facts JSON file (\`.socket.facts.json\`) describing the resolved dependency graph. This is the default; pass \`--pom\` to generate \`pom.xml\` files instead
            --gradle-opts       Additional options to pass on to ./gradlew, see \`./gradlew --help\`
            --ignore-unresolved  With --facts: warn on unresolved dependencies instead of failing the run (unresolved deps are not emitted to the facts file)
            --pom               Generate \`pom.xml\` manifest file(s) instead of the default Socket facts file (\`.socket.facts.json\`)
            --verbose           Print debug messages

          By default, emits a single \`.socket.facts.json\` describing the resolved
          dependency graph of the whole build, using gradle (preferably your local
          \`gradlew\`). An unresolved dependency is a fatal error. You can pass
          --configs=<comma-separated glob patterns> to restrict resolution to matching
          configurations (e.g. \`*CompileClasspath,*RuntimeClasspath\`), and
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

            $ socket manifest kotlin .
            $ socket manifest kotlin --pom .
            $ socket manifest kotlin --bin=../gradlew ."
      `,
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | CLI: <redacted>
          |__   | * |  _| '_| -_|  _|     | token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket manifest kotlin\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain(
        '`socket manifest kotlin`',
      )
    },
  )

  cmdit(
    ['manifest', 'kotlin', FLAG_DRY_RUN, FLAG_CONFIG, '{}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | CLI: <redacted>
          |__   | * |  _| '_| -_|  _|     | token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket manifest kotlin\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )

  cmdit(
    ['manifest', 'kotlin', '--facts', FLAG_DRY_RUN, FLAG_CONFIG, '{}'],
    'should accept --facts with dry-run',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | CLI: <redacted>
          |__   | * |  _| '_| -_|  _|     | token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket manifest kotlin\`, cwd: <redacted>"
      `)

      expect(code, '--facts --dry-run should exit with code 0').toBe(0)
    },
  )
})
