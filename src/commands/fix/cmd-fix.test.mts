import { describe, expect } from 'vitest'

import constants from '../../../src/constants.mts'
import { cmdit, invokeNpm } from '../../../test/utils.mts'

describe('socket fix', async () => {
  const { binCliPath } = constants

  cmdit(
    ['fix', '--help', '--config', '{}'],
    'should support --help',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(
        `
        "Update dependencies with "fixable" Socket alerts

          Usage
            $ socket fix [options] [CWD=.]

          API Token Requirements
            - Quota: 101 units
            - Permissions: full-scans:create and packages:list

          Options
            --autopilot         Enable auto-merge for pull requests that Socket opens.
                                See GitHub documentation (https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-auto-merge-for-pull-requests-in-your-repository) for managing auto-merge for pull requests in your repository.
            --id                Provide a list of GHSA IDs (https://docs.github.com/en/code-security/security-advisories/working-with-global-security-advisories-from-the-github-advisory-database/about-the-github-advisory-database#about-ghsa-ids) to compute fixes for, as either a comma separated value or as multiple flags
            --json              Output result as json
            --limit             The number of fixes to attempt at a time (default 10)
            --markdown          Output result as markdown
            --range-style       Define how dependency version ranges are updated in package.json (default 'preserve').
                                Available styles:
                                  * caret - Use ^ range for compatible updates (e.g. ^1.2.3)
                                  * gt - Use > to allow any newer version (e.g. >1.2.3)
                                  * gte - Use >= to allow any newer version (e.g. >=1.2.3)
                                  * lt - Use < to allow only lower versions (e.g. <1.2.3)
                                  * lte - Use <= to allow only lower versions (e.g. <=1.2.3)
                                  * pin - Use the exact version (e.g. 1.2.3)
                                  * preserve - Retain the existing version range style as-is
                                  * tilde - Use ~ range for patch/minor updates (e.g. ~1.2.3)

          Examples
            $ socket fix
            $ socket fix ./proj/tree --auto-merge"
      `,
      )
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket fix\`, cwd: <redacted>"
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain('`socket fix`')
    },
  )

  cmdit(
    ['fix', '--dry-run', '--config', '{"apiToken":"fakeToken"}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           _____         _       _        /---------------
          |   __|___ ___| |_ ___| |_      | Socket.dev CLI ver <redacted>
          |__   | * |  _| '_| -_|  _|     | Node: <redacted>, API token: <redacted>, org: <redacted>
          |_____|___|___|_,_|___|_|.dev   | Command: \`socket fix\`, cwd: <redacted>"
      `)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Not saving"`)
      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )

  cmdit(
    ['fix', '--dry-run', '--autopilot', '--config', '{"apiToken":"fakeToken"}'],
    'should accept --autopilot flag',
    async cmd => {
      const { code, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Not saving"`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )
  cmdit(
    [
      'fix',
      '--dry-run',
      '--auto-merge',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should accept --auto-merge alias',
    async cmd => {
      const { code, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Not saving"`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    ['fix', '--dry-run', '--test', '--config', '{"apiToken":"fakeToken"}'],
    'should ignore --test flag',
    async cmd => {
      const { code, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Not saving"`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'fix',
      '--dry-run',
      '--test-script',
      'custom-test',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should ignore --test-script flag',
    async cmd => {
      const { code, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Not saving"`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'fix',
      '--dry-run',
      '--limit',
      '5',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should accept --limit flag with custom value',
    async cmd => {
      const { code, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Not saving"`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'fix',
      '--dry-run',
      '--min-satisfying',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should accept --min-satisfying flag',
    async cmd => {
      const { code, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Not saving"`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'fix',
      '--dry-run',
      '--range-style',
      'caret',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should accept --range-style with valid value',
    async cmd => {
      const { code, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Not saving"`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'fix',
      '--range-style',
      'invalid-style',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should fail with invalid range style',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain('Expecting range style of')
      expect(code, 'should exit with non-zero code').not.toBe(0)
    },
  )

  cmdit(
    [
      'fix',
      '--dry-run',
      '--range-style',
      'pin',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should accept range style pin',
    async cmd => {
      const { code, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Not saving"`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'fix',
      '--dry-run',
      '--range-style',
      'tilde',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should accept range style tilde',
    async cmd => {
      const { code, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Not saving"`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'fix',
      '--dry-run',
      '--purl',
      'pkg:npm/lodash@3.9.2',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should accept valid PURL with version',
    async cmd => {
      const { code, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Not saving"`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    ['fix', '--purl', 'pkg:npm/lodash', '--config', '{"apiToken":"fakeToken"}'],
    'should fail with PURL without version',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain('is missing a version and will be ignored')
      expect(output).toContain('No valid --purl values provided')
      expect(code, 'should exit with non-zero code').not.toBe(0)
    },
  )

  cmdit(
    [
      'fix',
      '--dry-run',
      '--purl',
      'pkg:npm/lodash@3.9.2,pkg:npm/axios@1.8.0',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should accept multiple PURLs as comma-separated values',
    async cmd => {
      const { code, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Not saving"`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'fix',
      '--dry-run',
      '--purl',
      'pkg:npm/lodash@3.9.2',
      '--purl',
      'pkg:npm/axios@1.8.0',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should accept multiple --purl flags',
    async cmd => {
      const { code, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Not saving"`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'fix',
      '--dry-run',
      '--auto-merge',
      '--test',
      '--limit',
      '3',
      '--range-style',
      'preserve',
      '--min-satisfying',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should accept comprehensive flag combination',
    async cmd => {
      const { code, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Not saving"`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    ['fix', '/tmp', '--config', '{"apiToken":"fake-token"}'],
    'should show helpful error when no package.json found',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain(
        'Unable to resolve a Socket account organization',
      )
      expect(code, 'should exit with non-zero code').not.toBe(0)
    },
  )

  cmdit(
    [
      'fix',
      'test/fixtures/commands/fix/vulnerable-deps',
      '--config',
      '{"apiToken":"fake-token"}',
    ],
    'should handle vulnerable dependencies fixture project',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain(
        'Unable to resolve a Socket account organization',
      )
      expect(code, 'should exit with non-zero code').not.toBe(0)
    },
  )

  cmdit(
    [
      'fix',
      'test/fixtures/commands/fix/monorepo',
      '--config',
      '{"apiToken":"fake-token"}',
    ],
    'should handle monorepo fixture project',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain(
        'Unable to resolve a Socket account organization',
      )
      expect(code, 'should exit with non-zero code').not.toBe(0)
    },
  )

  cmdit(
    [
      'fix',
      '--dry-run',
      '--autopilot',
      '--limit',
      '1',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should handle autopilot mode with custom limit',
    async cmd => {
      const { code, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Not saving"`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'fix',
      '--dry-run',
      '--range-style',
      'gte',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should accept range style gte',
    async cmd => {
      const { code, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Not saving"`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'fix',
      '--dry-run',
      '--range-style',
      'lt',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should accept range style lt',
    async cmd => {
      const { code, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Not saving"`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'fix',
      '--dry-run',
      '--range-style',
      'lte',
      '--config',
      '{"apiToken":"fakeToken"}',
    ],
    'should accept range style lte',
    async cmd => {
      const { code, stdout } = await invokeNpm(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Not saving"`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )
})
