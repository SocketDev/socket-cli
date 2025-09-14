import { describe, expect } from 'vitest'

import constants from '../../../src/constants.mts'
import { cmdit, spawnPnpm } from '../../../test/utils.mts'

describe('socket ci', async () => {
  const { binCliPath } = constants

  cmdit(
    ['ci', '--help', '--config', '{}'],
    'should support --help',
    async cmd => {
      const { code, stderr, stdout } = await spawnPnpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `
        "Shorthand for \`socket scan create --report --no-interactive\`

          Usage
            $ socket ci [options]

          Options
            --auto-manifest     Auto generate manifest files where detected? See autoManifest flag in \`socket scan create\`

          This command is intended to use in CI runs to allow automated systems to
          accept or reject a current build. It will use the default org of the
          Socket API token. The exit code will be non-zero when the scan does not pass
          your security policy.

          The --auto-manifest flag does the same as the one from \`socket scan create\`
          but is not enabled by default since the CI is less likely to be set up with
          all the necessary dev tooling. Enable it if you want the scan to include
          locally generated manifests like for gradle and sbt.

          Examples
            $ socket ci
            $ socket ci --auto-manifest"
      `,
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket ci\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain('`socket ci`')
    },
  )

  cmdit(
    ['ci', '--dry-run', '--config', '{"apiToken":"fakeToken"}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await spawnPnpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket ci\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )
})
