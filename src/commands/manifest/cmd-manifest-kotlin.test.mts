import { describe, expect } from 'vitest'

import constants from '../../../src/constants.mts'
import { cmdit, invokeNpm } from '../../../test/utils.mts'

describe('socket manifest kotlin', async () => {
  // Lazily access constants.binCliPath.
  const { binCliPath } = constants

  cmdit(
    ['manifest', 'kotlin', '--help', '--config', '{}'],
    'should support --help',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `
        "[beta] Use Gradle to generate a manifest file (\`pom.xml\`) for a Kotlin project

          Usage
            $ socket manifest kotlin [options] [CWD=.]

          Options
            --bin             Location of gradlew binary to use, default: CWD/gradlew
            --gradle-opts     Additional options to pass on to ./gradlew, see \`./gradlew --help\`
            --verbose         Print debug messages

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

          Support is beta. Please report issues or give us feedback on what's missing.

          Examples

            $ socket manifest kotlin .
            $ socket manifest kotlin --bin=../gradlew ."
      `,
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket manifest kotlin\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain(
        '`socket manifest kotlin`',
      )
    },
  )

  cmdit(
    ['manifest', 'kotlin', '--dry-run', '--config', '{}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket manifest kotlin\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )
})
