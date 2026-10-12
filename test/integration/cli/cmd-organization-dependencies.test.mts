/**
 * Integration tests for `socket organization dependencies` command.
 *
 * Tests viewing all dependencies across an organization's repositories.
 * Provides a consolidated view of package usage for security auditing.
 *
 * Test Coverage: - Help text display and usage examples - Dry-run behavior
 * validation - Organization dependency listing - Output format support (JSON,
 * markdown)
 *
 * Related Files: - src/command/organization/cmd-organization-dependencies.mts.
 *
 * - Command definition -
 *   src/command/organization/handle-organization-dependencies.mts - Logic -
 *   src/command/organization/output-organization-dependencies.mts -
 *   Formatting.
 */

import { describe, expect } from 'vitest'

import {
  FLAG_CONFIG,
  FLAG_DRY_RUN,
  FLAG_HELP,
} from '../../../src/constants/cli.mts'
import { getBinCliPath } from '../../../src/constants/paths.mts'
import { cmdit, spawnSocketCli } from '../../utils.mts'

const binCliPath = getBinCliPath()

describe('socket organization dependencies', async () => {
  cmdit(
    ['organization', 'dependencies', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`
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
                --quiet             Route non-essential output (status, progress, warnings) to stderr so stdout carries only the payload. Implied by --json and --markdown.
          
              Examples
                socket organization dependencies
                socket organization dependencies --limit 20 --offset 10
                socket organization dependencies --purls 'pkg:npm/minimist@0.0.4'"
      `)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _          /---------------
            |   __|___ ___| |_ ___| |_        | CLI: <redacted>
            |__   | . |  _| '_| -_|  _|       | token: <redacted>, org: <redacted>
            |_____|___|___|_,_|___|_|.dev     | Command: \`socket organization dependencies\`, cwd: <redacted>"
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
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _          /---------------
            |   __|___ ___| |_ ___| |_        | CLI: <redacted>
            |__   | . |  _| '_| -_|  _|       | token: <redacted>, org: <redacted>
            |_____|___|___|_,_|___|_|.dev     | Command: \`socket organization dependencies\`, cwd: <redacted>


        [DryRun]: Would fetch organization dependencies

          Query parameters:
            limit: 50
            offset: 0

          This is a read-only operation that does not modify any data.
          Run without --dry-run to fetch and display the data."
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
      '--purls',
      'pkg:generic/example.package',
      '--json',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should preview repeated PURL filters without emitting JSON payload data',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      const expectedPurls = JSON.stringify([
        'pkg:npm/minimist@0.0.4',
        'pkg:pypi/requests',
        'pkg:generic/example.package',
      ])
      expect(code).toBe(0)
      expect(stdout).toBe('')
      expect(stderr).toContain(`purls: ${expectedPurls}`)
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
      const { code, stderr } = await spawnSocketCli(binCliPath, cmd)
      expect(code).not.toBe(0)
      expect(stderr).toContain('Invalid PURL "minimist"')
      expect(stderr).not.toContain('Would fetch organization dependencies')
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
    'should reject a bare PURL flag instead of searching all dependencies',
    async cmd => {
      const { code, stderr } = await spawnSocketCli(binCliPath, cmd)
      expect(code).not.toBe(0)
      expect(stderr).not.toContain('Would fetch organization dependencies')
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
      const { code, stderr } = await spawnSocketCli(binCliPath, cmd)
      expect(code).not.toBe(0)
      expect(stderr).not.toContain('Would fetch organization dependencies')
    },
  )
})
