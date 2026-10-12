import { describe, expect } from 'vitest'

import constants, {
  FLAG_CONFIG,
  FLAG_DRY_RUN,
  FLAG_HELP,
} from '../../../src/constants.mts'
import { cmdit, spawnSocketCli } from '../../../test/utils.mts'

describe('socket organization dependencies', async () => {
  const { binCliPath } = constants

  cmdit(
    ['organization', 'dependencies', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `
        "Search for any dependency that is being used in your organization

          Usage
            socket organization dependencies [options]

          API Token Requirements
            - Quota: 1 unit

          Options
            --json              Output as JSON
            --limit             Maximum number of dependencies returned
            --markdown          Output as Markdown
            --offset            Number of dependencies to skip
            --purls             Search for a full PURL; repeat this flag for more PURLs

          Examples
            socket organization dependencies
            socket organization dependencies --limit 20 --offset 10
            socket organization dependencies --purls 'pkg:npm/minimist@0.0.4'"
      `,
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | CLI: <redacted>
          |__   | * |  _| '_| -_|  _|     | token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket organization dependencies\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain(
        '`socket organization dependencies`',
      )
    },
  )

  cmdit(
    [
      'organization',
      'dependencies',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | CLI: <redacted>
          |__   | * |  _| '_| -_|  _|     | token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket organization dependencies\`, cwd: <redacted>"
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )

  cmdit(
    [
      'organization',
      'dependencies',
      FLAG_DRY_RUN,
      '--purls',
      'pkg:npm/minimist@0.0.4',
      '--purls',
      'pkg:pypi/requests',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should accept repeated PURL filters in a dry run',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(code).toBe(0)
      expect(stdout).toContain('[DryRun]: Bailing now')
    },
  )

  cmdit(
    [
      'organization',
      'dependencies',
      FLAG_DRY_RUN,
      '--purls',
      'minimist',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should reject invalid PURLs before dry-run success',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(code).not.toBe(0)
      expect(`${stdout}\n${stderr}`).toContain('Invalid PURL "minimist"')
      expect(stdout).not.toContain('[DryRun]: Bailing now')
    },
  )

  cmdit(
    [
      'organization',
      'dependencies',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
      '--purls',
    ],
    'should reject a bare PURL flag',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(code).not.toBe(0)
      expect(stdout).not.toContain('[DryRun]: Bailing now')
    },
  )

  cmdit(
    [
      'organization',
      'dependencies',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
      '--purls=',
    ],
    'should reject an explicitly empty PURL filter',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(code).not.toBe(0)
      expect(stdout).not.toContain('[DryRun]: Bailing now')
    },
  )
})
