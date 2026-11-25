import { describe, expect } from 'vitest'

import constants, {
  FLAG_CONFIG,
  FLAG_DRY_RUN,
  FLAG_HELP,
} from '../../../src/constants.mts'
import { cmdit, spawnSocketCli } from '../../../test/utils.mts'

describe('socket ci', async () => {
  const { binCliPath } = constants

  cmdit(
    ['ci', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `
        "Alias for \`socket scan create --report\` (creates report and exits with error if unhealthy)

          Usage
            $ socket ci [options]

          Options
            --auto-manifest     Auto generate manifest files where detected? See autoManifest flag in \`socket scan create\`
            --disable-blocking  Return success for findings and infrastructure failures, but keep usage errors non-zero.
            --exit-code-on-api-error  Exit code for Socket API errors (default: 3). Ignored with --disable-blocking.

          This command is intended to use in CI runs to allow automated systems to
          accept or reject a current build. It will use the default org of the
          Socket API token. Exit codes are 0 for success, 1 for blocking findings, 2
          for usage errors, 3 for infrastructure errors, and 130 for interruption.
          --disable-blocking returns 0 for findings and runtime failures, but not
          usage errors. --exit-code-on-api-error changes the API failure code.

          The --auto-manifest flag does the same as the one from \`socket scan create\`
          but is not enabled by default since the CI is less likely to be set up with
          all the necessary dev tooling. Enable it if you want the scan to include
          locally generated manifests like for gradle and sbt.

          Examples
            $ socket ci
            $ socket ci --auto-manifest
            $ socket ci --disable-blocking
            $ socket ci --exit-code-on-api-error 5"
      `,
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | CLI: <redacted>
          |__   | * |  _| '_| -_|  _|     | token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket ci\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain('`socket ci`')
    },
  )

  cmdit(
    ['ci', FLAG_DRY_RUN, FLAG_CONFIG, '{"apiToken":"fakeToken"}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | CLI: <redacted>
          |__   | * |  _| '_| -_|  _|     | token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket ci\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )
})
