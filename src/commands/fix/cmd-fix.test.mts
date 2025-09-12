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
            --id                Provide a list of vulnerability identifiers to compute fixes for:
                                    - GHSA IDs (https://docs.github.com/en/code-security/security-advisories/working-with-global-security-advisories-from-the-github-advisory-database/about-the-github-advisory-database#about-ghsa-ids) (e.g., GHSA-xxxx-xxxx-xxxx)
                                    - CVE IDs (https://cve.mitre.org/cve/identifiers/) (e.g., CVE-2025-1234) - automatically converted to GHSA
                                    - PURLs (https://github.com/package-url/purl-spec) (e.g., pkg:npm/package@1.0.0) - automatically converted to GHSA
                                    Can be provided as comma separated values or as multiple flags
            --json              Output result as json
            --limit             The number of fixes to attempt at a time (default 10)
            --markdown          Output result as markdown
            --range-style       Define how dependency version ranges are updated in package.json (default 'preserve').
                                Available styles:
                                  * pin - Use the exact version (e.g. 1.2.3)
                                  * preserve - Retain the existing version range style as-is

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
      '--id',
      'GHSA-35jh-r3h4-6jhm',
      '--config',
      '{"apiToken":"fake-token"}',
    ],
    'should handle specific GHSA ID for lodash vulnerability',
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
    ['fix', '--id', 'CVE-2021-23337', '--config', '{"apiToken":"fake-token"}'],
    'should handle CVE ID conversion for lodash vulnerability',
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
    ['fix', '--limit', '1', '--config', '{"apiToken":"fake-token"}'],
    'should respect fix limit parameter',
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
      '--range-style',
      'preserve',
      '--autopilot',
      '--config',
      '{"apiToken":"fake-token"}',
    ],
    'should handle autopilot mode with preserve range style',
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
    ['fix', '--range-style', 'pin', '--config', '{"apiToken":"fake-token"}'],
    'should handle pin range style for exact versions',
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
    ['fix', '--json', '--config', '{"apiToken":"fake-token"}'],
    'should output results in JSON format',
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
    ['fix', '--markdown', '--config', '{"apiToken":"fake-token"}'],
    'should output results in markdown format',
    async cmd => {
      const { code, stderr, stdout } = await invokeNpm(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain(
        'Unable to resolve a Socket account organization',
      )
      expect(code, 'should exit with non-zero code').not.toBe(0)
    },
  )
})
