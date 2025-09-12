import { describe, expect } from 'vitest'

import constants from '../../../src/constants.mts'
import { cmdit, spawnNpm } from '../../../test/utils.mts'

describe('socket manifest', async () => {
  const { binCliPath } = constants

  cmdit(
    ['manifest', '--help', '--config', '{}'],
    'should support --help',
    async cmd => {
      const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `
        "Generate a dependency manifest for certain ecosystems

          Usage
            $ socket manifest <command>

          Commands
            auto                        Auto-detect build and attempt to generate manifest file
            cdxgen                      Create an SBOM with CycloneDX generator (cdxgen)
            conda                       [beta] Convert a Conda environment.yml file to a python requirements.txt
            gradle                      [beta] Use Gradle to generate a manifest file (\`pom.xml\`) for a Gradle/Java/Kotlin/etc project
            kotlin                      [beta] Use Gradle to generate a manifest file (\`pom.xml\`) for a Kotlin project
            scala                       [beta] Generate a manifest file (\`pom.xml\`) from Scala's \`build.sbt\` file
            setup                       Start interactive configurator to customize default flag values for \`socket manifest\` in this dir

          Options

            --no-spinner                Hide the console spinner"
      `,
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket manifest\`, cwd: <redacted>"
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
      '--dry-run',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await spawnNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `"[DryRun]: No-op, call a sub-command; ok"`,
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket manifest\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )
})
