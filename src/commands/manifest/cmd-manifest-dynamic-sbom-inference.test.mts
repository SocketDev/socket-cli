import { describe, expect } from 'vitest'

import constants, {
  FLAG_CONFIG,
  FLAG_DRY_RUN,
  FLAG_HELP,
} from '../../../src/constants.mts'
import { cmdit, spawnSocketCli, testPath } from '../../../test/utils.mts'

describe('socket manifest dynamic-sbom-inference', async () => {
  const { binCliPath } = constants

  cmdit(
    ['manifest', 'dynamic-sbom-inference', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: testPath,
      })
      expect(stdout).toMatchInlineSnapshot(`
        "Recursively discover gradle/sbt/maven build roots and generate a Socket facts SBOM for each

          Usage
            $ socket manifest dynamic-sbom-inference [options] [CWD=.]

          Recursively walks CWD, discovers independent gradle, sbt, and maven build
          roots, and generates a Socket facts SBOM for each
          (pom.xml.socket.facts.json, gradle.socket.facts.json, or
          sbt.socket.facts.json, so builds sharing a directory never overwrite each
          other),
          skipping build roots whose build file a parent build already reports for
          one of its subprojects. Unlike \`socket manifest auto\`, this looks beyond
          CWD itself.

          Options
            --exclude-paths     List of glob patterns to exclude from manifest/facts generation. Patterns are anchored micromatch globs matched relative to CWD (\`--cwd\` if set): \`tests\` matches only \`<cwd>/tests\`; use \`**/tests\` to match at any depth. Negation patterns (\`!path\`) are not supported. Accepts a comma-separated value or multiple flags. A JVM build module excluded this way gets no project of its own, but its code is still analysed as part of the projects that depend on it.
            --ignore-unresolved  Warn on unresolved dependencies instead of failing the run (unresolved deps are not emitted to the facts files); overrides each build's socket.json setting
            --json              Output as JSON
            --markdown          Output as Markdown
            --verbose           Print debug messages

          Examples

            $ socket manifest dynamic-sbom-inference
            $ socket manifest dynamic-sbom-inference ./monorepo"
      `)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | CLI: <redacted>
          |__   | * |  _| '_| -_|  _|     | token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket manifest dynamic-sbom-inference\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain(
        '`socket manifest dynamic-sbom-inference`',
      )
    },
  )

  cmdit(
    ['manifest', 'dynamic-sbom-inference', FLAG_DRY_RUN, FLAG_CONFIG, '{}'],
    'should exit with dry-run message before touching disk',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: testPath,
      })
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | CLI: <redacted>
          |__   | * |  _| '_| -_|  _|     | token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket manifest dynamic-sbom-inference\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )
})
