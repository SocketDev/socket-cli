import path from 'node:path'

import { describe, expect } from 'vitest'

import constants from '../../../dist/constants.js'
import { cmdit, invokeNpm } from '../../../test/utils'

const { CLI } = constants

describe('socket manifest', async () => {
  // Lazily access constants.rootBinPath.
  const entryPath = path.join(constants.rootBinPath, `${CLI}.js`)

  cmdit(
    ['manifest', '--help', '--config', '{}'],
    'should support --help',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(entryPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `
        "Generate a dependency manifest for given file or dir

          Usage
            $ socket manifest <command>

          Commands
            auto              Auto-detect build and attempt to generate manifest file
            conda             [beta] Convert a Conda environment.yml file to a python requirements.txt
            gradle            [beta] Use Gradle to generate a manifest file (\`pom.xml\`) for a Gradle/Java/Kotlin/etc project
            kotlin            [beta] Use Gradle to generate a manifest file (\`pom.xml\`) for a Kotlin project
            scala             [beta] Generate a manifest file (\`pom.xml\`) from Scala's \`build.sbt\` file

          Options
            --help            Print this help

          Examples
            $ socket manifest --help"
      `
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket manifest\`, cwd: <redacted>"
      `)

      expect(code, 'help should exit with code 2').toBe(2)
      expect(stderr, 'banner includes base command').toContain(
        '`socket manifest`'
      )
    }
  )

  cmdit(
    [
      'manifest',
      'mootools',
      '--dry-run',
      '--config',
      '{"apiToken":"anything"}'
    ],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(entryPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `"[DryRun]: No-op, call a sub-command; ok"`
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token set: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket manifest\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    }
  )
})
