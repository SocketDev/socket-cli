import path from 'node:path'

import { describe, expect } from 'vitest'

import constants from '../../../src/constants'
import { cmdit, invokeNpm } from '../../../test/utils'

const { CLI } = constants

describe('socket manifest kotlin', async () => {
  // Lazily access constants.rootBinPath.
  const entryPath = path.join(constants.rootBinPath, `${CLI}.js`)

  cmdit(
    ['manifest', 'kotlin', '--help', '--config', '{}'],
    'should support --help',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(entryPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `
        "[beta] Use Gradle to generate a manifest file (\`pom.xml\`) for a Kotlin project

          Usage
            $ socket manifest kotlin [--bin=path/to/gradle/binary] [--out=path/to/result] DIR

          Options
            --bin             Location of gradlew binary to use, default: CWD/gradlew
            --cwd             Set the cwd, defaults to process.cwd()
            --gradleOpts      Additional options to pass on to ./gradlew, see \`./gradlew --help\`
            --help            Print this help
            --task            Task to target. By default targets all
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
      `
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket manifest kotlin\`, cwd: <redacted>"
      `)

      expect(code, 'help should exit with code 2').toBe(2)
      expect(stderr, 'banner includes base command').toContain(
        '`socket manifest kotlin`'
      )
    }
  )

  cmdit(
    ['manifest', 'kotlin', '--dry-run', '--config', '{}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(entryPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket manifest kotlin\`, cwd: <redacted>

        \\x1b[31m\\xd7\\x1b[39m \\x1b[41m\\x1b[1m\\x1b[37m Input error: \\x1b[39m\\x1b[22m\\x1b[49m \\x1b[1mPlease review the input requirements and try again

          - The DIR arg is required (\\x1b[31mmissing\\x1b[39m)
        \\x1b[22m"
      `)

      expect(code, 'dry-run should exit with code 2 if missing input').toBe(2)
    }
  )

  cmdit(
    [
      'manifest',
      'kotlin',
      'mootools',
      '--dry-run',
      '--config',
      '{"apiToken":"anything"}'
    ],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(entryPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket manifest kotlin\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    }
  )
})
