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
        "[beta] Generate Socket facts files from .NET solutions and projects

          Usage
            $ socket manifest dotnet [options] [CWD=.|FILE]

          Options
            --bin               Location of the dotnet binary to use, default: dotnet on PATH
            --dotnet-opts       Additional options to pass on to \`dotnet restore\`, e.g. \`-p:Configuration=Release --configfile nuget.config\`. MSBuild properties among them also apply to project evaluation
            --exclude-configs   Comma-separated glob patterns; target frameworks matching any pattern are skipped (applied after --include-configs)
            --exclude-paths     List of glob patterns to exclude from manifest/facts generation. Patterns are anchored micromatch globs matched relative to CWD (\`--cwd\` if set): \`tests\` matches only \`<cwd>/tests\`; use \`**/tests\` to match at any depth. Negation patterns (\`!path\`) are not supported. Accepts a comma-separated value or multiple flags. An excluded JVM build module or .NET project is not analysed as a project of its own, but where a project that is not excluded depends on it, its code is analysed as part of that project.
            --ignore-unresolved  Warn on unresolved dependencies instead of failing the run (unresolved deps are not emitted to the facts file)
            --include-configs   Comma-separated glob patterns matched against target frameworks (case-sensitive; \`*\`, \`?\`, and \`[...]\` wildcards). Only target frameworks matching at least one pattern are read, e.g. \`net8.0\`. A runtime-specific target (\`net8.0/win-x64\`) also matches its framework. Default: every target framework
            --verbose           Print debug messages

          Emits a \`<file>.socket.facts.json\` per solution or project describing its
          resolved NuGet dependency graph. Given a directory, it builds every
          solution (.sln, .slnx) and project (.csproj, .fsproj, .vbproj) at its top
          level, solutions first, skipping projects a solution already covers; given
          a file, just that one (a .slnf solution filter too).

          Dependencies come from your own \`dotnet restore\` (same SDK, global.json,
          nuget.config and credential providers), so a build that restores for you
          restores here. PackageReference projects (central package management and
          lock files included) and packages.config projects are supported. An
          unresolved dependency is a fatal error unless --ignore-unresolved.

          Support is beta. Please report issues or give us feedback on what's missing.

          Examples

            $ socket manifest dotnet .
            $ socket manifest dotnet ./App.sln
            $ socket manifest dotnet --dotnet-opts="-p:Configuration=Release" ."
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
