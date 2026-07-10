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
        "[beta] Generate a Socket facts file for a .NET (C#/F#/VB) project

          Usage
            $ socket manifest dotnet [options] [CWD=.]

          Options
            --bin               Location of the dotnet binary to use, default: dotnet on PATH
            --dotnet-opts       MSBuild property tokens (\`-p:Key=Value\`) applied to the whole facts session: project evaluation, restore, and reading the restore output all see the same properties
            --exclude-target-frameworks  Comma-separated glob patterns; target frameworks matching any pattern are skipped (applied after --target-frameworks)
            --ignore-unresolved  Warn on restore/resolution failures instead of failing the run (unresolved deps are not emitted to the facts file)
            --target-frameworks  Comma-separated glob patterns matched against target framework names (case-sensitive; \`*\`, \`?\`, and \`[...]\` wildcards). Only target frameworks matching at least one pattern are included, e.g. \`net8.0\` or \`net*\`. Default: every restored target framework
            --verbose           Print debug messages

          Emits a single \`.socket.facts.json\` describing the resolved dependency
          graph of the .NET solutions/projects at the top level of the given
          directory. A bundled tool runs one MSBuild session \\u2014 evaluate, restore,
          read the restore output via NuGet's own APIs \\u2014 so results reflect exactly
          what NuGet resolved. A restore failure is a fatal error; pass
          --ignore-unresolved to warn instead.

          Each target framework a project restores is resolved separately: pass
          --target-frameworks / --exclude-target-frameworks (comma-separated glob
          patterns) to control which target frameworks are included (e.g.
          --target-frameworks='net8.0'). RID-specific targets like net8.0/win-x64
          match under their base target framework.

          --dotnet-opts takes MSBuild property tokens (\`-p:Key=Value\`), applied to
          the WHOLE session so evaluation, restore, and the emitted graph can never
          disagree. Restore-specific settings have property forms, e.g.
          \`-p:RestoreSources=<url>\` or \`-p:RestoreConfigFile=<path>\`.

          Requires a .NET SDK (6.0 or newer). Legacy \`packages.config\` projects
          are supported from the manifest itself (it pins the full closure): the
          graph is flat \\u2014 every package is listed as a direct dependency \\u2014 and
          \`developmentDependency="true"\` packages are marked dev. No restore is
          attempted for them.

          Support is beta. Please report issues or give us feedback on what's missing.

          Examples

            $ socket manifest dotnet .
            $ socket manifest dotnet --target-frameworks='net8.0' .
            $ socket manifest dotnet --dotnet-opts='-p:Configuration=Release' ."
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
    'should bail on dry-run before running the tool',
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
