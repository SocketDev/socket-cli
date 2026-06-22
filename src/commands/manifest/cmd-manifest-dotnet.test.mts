import { describe, expect } from 'vitest'

import constants, {
  FLAG_CONFIG,
  FLAG_DRY_RUN,
  FLAG_HELP,
} from '../../../src/constants.mts'
import { cmdit, spawnSocketCli } from '../../../test/utils.mts'

describe('socket manifest dotnet', async () => {
  const { binCliPath } = constants

  cmdit(
    ['manifest', 'dotnet', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`
        "[beta] Generate a Socket facts file from a .NET project (\`.csproj\`/\`.sln\`/etc)

          Usage
            $ socket manifest dotnet [options] [CWD=.]

          Options
            --bin               Location of the dotnet host to use, default: dotnet on PATH
            --dotnet-opts       Additional options to pass on to the bundled dotnet tool
            --ignore-unresolved  Warn on unresolved dependencies instead of failing the run (unresolved deps are not emitted to the facts file)
            --verbose           Print debug messages

          Emits a single \`.socket.facts.json\` describing the resolved dependency
          graph of your .NET project, using the \`dotnet\` host on PATH to run a
          bundled NuGet/MSBuild resolver (SDK-style projects and legacy
          \`packages.config\` are both supported). An unresolved dependency is a fatal
          error; pass --ignore-unresolved to warn and continue instead.

          Unlike the JVM generators there are no configuration filters: .NET
          resolution has no equivalent of Gradle/Maven configurations, so
          --include-configs / --exclude-configs do not apply.

          You can specify --bin to override the path to the \`dotnet\` host to invoke,
          and --dotnet-opts to pass extra options through to the bundled tool.

          Support is beta. Please report issues or give us feedback on what's missing.

          Examples

            $ socket manifest dotnet .
            $ socket manifest dotnet --bin=/usr/local/share/dotnet/dotnet ."
      `)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | CLI: <redacted>
          |__   | * |  _| '_| -_|  _|     | token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket manifest dotnet\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain(
        '`socket manifest dotnet`',
      )
    },
  )

  cmdit(
    ['manifest', 'dotnet', FLAG_DRY_RUN, FLAG_CONFIG, '{}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | CLI: <redacted>
          |__   | * |  _| '_| -_|  _|     | token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket manifest dotnet\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )
})
