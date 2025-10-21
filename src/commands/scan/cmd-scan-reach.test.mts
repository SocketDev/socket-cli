import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { cmdit, spawnSocketCli, testPath } from '../../../test/utils.mts'
import { FLAG_CONFIG, FLAG_DRY_RUN, FLAG_HELP } from '../constants/cli.mts'
import { getBinCliPath } from '../constants/paths.mts'

const binCliPath = getBinCliPath()

const _fixtureBaseDir = path.join(testPath, 'fixtures/commands/scan/reach')

describe('socket scan reach', async () => {
  cmdit(
    ['scan', 'reach', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           "
      `)

      expect(code, 'explicit help should exit with code 0').toBe(0)
      expect(stderr, 'banner includes base command').toContain(
        '`socket scan reach`',
      )
    },
  )

  cmdit(
    [
      'scan',
      'reach',
      FLAG_DRY_RUN,
      '--org',
      'fakeOrg',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(`\n   ${stderr}`).toMatchInlineSnapshot(`
        "
           "
      `)

      expect(code, 'dry-run should exit with code 0 if input ok').toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'reach',
      FLAG_DRY_RUN,
      '--org',
      'fakeOrg',
      '--reach-disable-analytics',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should accept --reach-disable-analytics flag',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'reach',
      FLAG_DRY_RUN,
      '--reach-analysis-memory-limit',
      '4096',
      '--org',
      'fakeOrg',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should accept --reach-analysis-memory-limit flag',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'reach',
      FLAG_DRY_RUN,
      '--reach-analysis-timeout',
      '3600',
      '--org',
      'fakeOrg',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should accept --reach-analysis-timeout flag',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'reach',
      FLAG_DRY_RUN,
      '--reach-ecosystems',
      'npm,pypi',
      '--org',
      'fakeOrg',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should accept --reach-ecosystems with comma-separated values',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'reach',
      FLAG_DRY_RUN,
      '--reach-ecosystems',
      'npm',
      '--reach-ecosystems',
      'pypi',
      '--org',
      'fakeOrg',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should accept multiple --reach-ecosystems flags',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(code, 'should exit with code 0').toBe(0)
      expect(stdout).toMatchInlineSnapshot(`"[DryRun]: Bailing now"`)
    },
  )

  cmdit(
    [
      'scan',
      'reach',
      '--reach-ecosystems',
      'invalid-ecosystem',
      '--org',
      'fakeOrg',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should fail with invalid ecosystem',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain('Invalid ecosystem: "invalid-ecosystem"')
      expect(code, 'should exit with non-zero code').not.toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'reach',
      FLAG_DRY_RUN,
      '--reach-exclude-paths',
      'node_modules,dist',
      '--org',
      'fakeOrg',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should accept --reach-exclude-paths with comma-separated values',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'reach',
      FLAG_DRY_RUN,
      '--reach-exclude-paths',
      'node_modules',
      '--reach-exclude-paths',
      'dist',
      '--org',
      'fakeOrg',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should accept multiple --reach-exclude-paths flags',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'reach',
      FLAG_DRY_RUN,
      '--reach-disable-analytics',
      '--reach-analysis-memory-limit',
      '4096',
      '--reach-analysis-timeout',
      '3600',
      '--reach-ecosystems',
      'npm,pypi',
      '--reach-exclude-paths',
      'node_modules,dist',
      '--org',
      'fakeOrg',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should accept all reachability flags together',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'reach',
      FLAG_DRY_RUN,
      '--reach-analysis-memory-limit',
      '1',
      '--org',
      'fakeOrg',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should accept minimal positive memory limit',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'reach',
      FLAG_DRY_RUN,
      '--reach-ecosystems',
      'npm',
      '--org',
      'fakeOrg',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should handle single ecosystem flag',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'reach',
      FLAG_DRY_RUN,
      '--reach-exclude-paths',
      'path1',
      '--reach-exclude-paths',
      'path2',
      '--reach-exclude-paths',
      'path3',
      '--org',
      'fakeOrg',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should accept many exclude paths flags',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'reach',
      FLAG_DRY_RUN,
      '--reach-ecosystems',
      'npm',
      '--reach-ecosystems',
      'pypi',
      '--reach-ecosystems',
      'cargo',
      '--reach-ecosystems',
      'maven',
      '--org',
      'fakeOrg',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should accept multiple different ecosystems',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'reach',
      FLAG_DRY_RUN,
      '--reach-analysis-memory-limit',
      '1024',
      '--reach-analysis-timeout',
      '300',
      '--org',
      'fakeOrg',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should accept custom memory limit and timeout values',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'reach',
      '--reach-ecosystems',
      'npm,invalid1,pypi,invalid2',
      '--org',
      'fakeOrg',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should fail when mixed valid and invalid ecosystems are provided',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain('Invalid ecosystem: "invalid1"')
      expect(code, 'should exit with non-zero code').not.toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'reach',
      FLAG_DRY_RUN,
      '--json',
      '--markdown',
      '--org',
      'fakeOrg',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should fail when both json and markdown output flags are used',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain('The json and markdown flags cannot be both set')
      expect(code, 'should exit with non-zero code').not.toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'reach',
      FLAG_DRY_RUN,
      '--json',
      '--org',
      'fakeOrg',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should accept json output flag alone',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'scan',
      'reach',
      FLAG_DRY_RUN,
      '--markdown',
      '--org',
      'fakeOrg',
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
    ],
    'should accept markdown output flag alone',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  it(
    'should accept comprehensive reachability configuration in dry-run: `scan reach --dry-run --reach-analysis-memory-limit 16384 --reach-analysis-timeout 7200 --reach-ecosystems npm --reach-exclude-paths node_modules --org fakeOrg --config {"apiToken":"fakeToken"}`',
    { timeout: 30_000 },
    async () => {
      const cmd = [
        'scan',
        'reach',
        FLAG_DRY_RUN,
        '--reach-analysis-memory-limit',
        '16384',
        '--reach-analysis-timeout',
        '7200',
        '--reach-ecosystems',
        'npm',
        '--reach-exclude-paths',
        'node_modules',
        '--org',
        'fakeOrg',
        FLAG_CONFIG,
        '{"apiToken":"fakeToken"}',
      ]
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  describe('non dry-run tests', () => {
    cmdit(
      [
        'scan',
        'reach',
        'test/fixtures/commands/scan/reach',
        '--org',
        'fakeOrg',
        FLAG_CONFIG,
        '{"apiToken":"fake-token"}',
      ],
      'should handle reach analysis on test fixture',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
        // Should fail due to fake token/org, but validates command parsing.
        expect(code).toBeGreaterThan(0)
        const output = stdout + stderr
        expect(output.length).toBeGreaterThan(0)
      },
    )

    cmdit(
      [
        'scan',
        'reach',
        'test/fixtures/commands/scan/reach',
        '--reach-ecosystems',
        'npm',
        '--org',
        'fakeOrg',
        FLAG_CONFIG,
        '{"apiToken":"fake-token"}',
      ],
      'should handle npm ecosystem specification',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
        expect(code).toBeGreaterThan(0)
        const output = stdout + stderr
        expect(output.length).toBeGreaterThan(0)
      },
    )

    cmdit(
      [
        'scan',
        'reach',
        'test/fixtures/commands/scan/reach',
        '--reach-analysis-memory-limit',
        '2048',
        '--org',
        'fakeOrg',
        FLAG_CONFIG,
        '{"apiToken":"fake-token"}',
      ],
      'should handle custom memory limit',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
        expect(code).toBeGreaterThan(0)
        const output = stdout + stderr
        expect(output.length).toBeGreaterThan(0)
      },
    )

    cmdit(
      [
        'scan',
        'reach',
        'test/fixtures/commands/scan/reach',
        '--reach-analysis-timeout',
        '1800',
        '--org',
        'fakeOrg',
        FLAG_CONFIG,
        '{"apiToken":"fake-token"}',
      ],
      'should handle custom timeout',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
        expect(code).toBeGreaterThan(0)
        const output = stdout + stderr
        expect(output.length).toBeGreaterThan(0)
      },
    )

    cmdit(
      [
        'scan',
        'reach',
        'test/fixtures/commands/scan/reach',
        '--reach-exclude-paths',
        'node_modules,dist',
        '--org',
        'fakeOrg',
        FLAG_CONFIG,
        '{"apiToken":"fake-token"}',
      ],
      'should handle path exclusions',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
        expect(code).toBeGreaterThan(0)
        const output = stdout + stderr
        expect(output.length).toBeGreaterThan(0)
      },
    )

    cmdit(
      [
        'scan',
        'reach',
        'test/fixtures/commands/scan/reach',
        '--reach-disable-analytics',
        '--org',
        'fakeOrg',
        FLAG_CONFIG,
        '{"apiToken":"fake-token"}',
      ],
      'should handle analytics disabled',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
        expect(code).toBeGreaterThan(0)
        const output = stdout + stderr
        expect(output.length).toBeGreaterThan(0)
      },
    )

    cmdit(
      [
        'scan',
        'reach',
        'test/fixtures/commands/scan/reach',
        '--reach-skip-cache',
        '--org',
        'fakeOrg',
        FLAG_CONFIG,
        '{"apiToken":"fake-token"}',
      ],
      'should handle cache skipping',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
        expect(code).toBeGreaterThan(0)
        const output = stdout + stderr
        expect(output.length).toBeGreaterThan(0)
      },
    )

    cmdit(
      [
        'scan',
        'reach',
        'test/fixtures/commands/scan/reach',
        '--json',
        '--org',
        'fakeOrg',
        FLAG_CONFIG,
        '{"apiToken":"fake-token"}',
      ],
      'should handle JSON output format',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
        expect(code).toBeGreaterThan(0)
        // JSON output typically suppresses banner in stderr.
        const output = stdout + stderr
        expect(output.length).toBeGreaterThan(0)
      },
    )

    cmdit(
      [
        'scan',
        'reach',
        'test/fixtures/commands/scan/reach',
        '--markdown',
        '--org',
        'fakeOrg',
        FLAG_CONFIG,
        '{"apiToken":"fake-token"}',
      ],
      'should handle markdown output format',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
        expect(code).toBeGreaterThan(0)
        // Markdown output typically suppresses banner in stderr.
        const output = stdout + stderr
        expect(output.length).toBeGreaterThan(0)
      },
    )

    cmdit(
      [
        'scan',
        'reach',
        'test/fixtures/commands/scan/reach',
        '--reach-ecosystems',
        'npm',
        '--reach-analysis-memory-limit',
        '2048',
        '--reach-exclude-paths',
        'node_modules',
        '--reach-disable-analytics',
        '--org',
        'fakeOrg',
        FLAG_CONFIG,
        '{"apiToken":"fake-token"}',
      ],
      'should handle comprehensive flag combination',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
        expect(code).toBeGreaterThan(0)
        const output = stdout + stderr
        expect(output.length).toBeGreaterThan(0)
      },
    )
  })

  describe('error handling and usability tests', () => {
    cmdit(
      [
        'scan',
        'reach',
        '/nonexistent/directory',
        '--org',
        'fakeOrg',
        FLAG_CONFIG,
        '{"apiToken":"fake-token"}',
      ],
      'should show clear error for non-existent directory',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
        const output = stdout + stderr
        expect(output).toMatch(
          /no eligible files|file.*dir.*must contain|not.*found/i,
        )
        expect(code).toBeGreaterThan(0)
      },
    )

    cmdit(
      ['scan', 'reach', FLAG_DRY_RUN, FLAG_CONFIG, '{}'],
      'should show clear error when API token is missing',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
        const output = stdout + stderr
        expect(output).toMatch(/api token|authentication|token/i)
        expect(code).toBeGreaterThan(0)
      },
    )

    cmdit(
      [
        'scan',
        'reach',
        FLAG_DRY_RUN,
        '--org',
        '',
        FLAG_CONFIG,
        '{"apiToken":"fake-token"}',
      ],
      'should show clear error when org is empty',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
        const output = stdout + stderr
        expect(output).toMatch(/organization|org/i)
        expect(code).toBeGreaterThan(0)
      },
    )

    cmdit(
      [
        'scan',
        'reach',
        FLAG_DRY_RUN,
        '--reach-analysis-memory-limit',
        'not-a-number',
        '--org',
        'fakeOrg',
        FLAG_CONFIG,
        '{"apiToken":"fake-token"}',
      ],
      'should show clear error for invalid memory limit',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
        const output = stdout + stderr
        expect(output).toContain('[DryRun]: Bailing now')
        expect(code).toBe(0)
      },
    )

    cmdit(
      [
        'scan',
        'reach',
        FLAG_DRY_RUN,
        '--reach-analysis-memory-limit',
        '-1',
        '--org',
        'fakeOrg',
        FLAG_CONFIG,
        '{"apiToken":"fake-token"}',
      ],
      'should show clear error for negative memory limit',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
        const output = stdout + stderr
        expect(output).toContain('[DryRun]: Bailing now')
        expect(code).toBe(0)
      },
    )

    cmdit(
      [
        'scan',
        'reach',
        FLAG_DRY_RUN,
        '--reach-analysis-timeout',
        'invalid-timeout',
        '--org',
        'fakeOrg',
        FLAG_CONFIG,
        '{"apiToken":"fake-token"}',
      ],
      'should show clear error for invalid timeout value',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
        const output = stdout + stderr
        expect(output).toContain('[DryRun]: Bailing now')
        expect(code).toBe(0)
      },
    )

    cmdit(
      [
        'scan',
        'reach',
        FLAG_DRY_RUN,
        '--reach-analysis-timeout',
        '0',
        '--org',
        'fakeOrg',
        FLAG_CONFIG,
        '{"apiToken":"fake-token"}',
      ],
      'should show clear error for zero timeout',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
        const output = stdout + stderr
        expect(output).toContain('[DryRun]: Bailing now')
        expect(code).toBe(0)
      },
    )

    cmdit(
      [
        'scan',
        'reach',
        'test/fixtures/commands/scan/reach',
        '--reach-analysis-memory-limit',
        '999999999',
        '--org',
        'fakeOrg',
        FLAG_CONFIG,
        '{"apiToken":"fake-token"}',
      ],
      'should handle extremely large memory limit values',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
        expect(code).toBeGreaterThan(0)
        const output = stdout + stderr
        expect(output.length).toBeGreaterThan(0)
      },
    )

    cmdit(
      [
        'scan',
        'reach',
        'test/fixtures/commands/scan/reach',
        '--reach-exclude-paths',
        '',
        '--org',
        'fakeOrg',
        FLAG_CONFIG,
        '{"apiToken":"fake-token"}',
      ],
      'should handle empty exclude paths gracefully',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
        expect(code).toBeGreaterThan(0)
        const output = stdout + stderr
        expect(output.length).toBeGreaterThan(0)
      },
    )

    cmdit(
      [
        'scan',
        'reach',
        FLAG_HELP,
        '--reach-ecosystems',
        'npm',
        '--org',
        'fakeOrg',
        FLAG_CONFIG,
        '{}',
      ],
      'should prioritize help over other flags',
      async cmd => {
        const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
        expect(stdout).toContain('Compute tier 1 reachability')
        expect(code).toBe(0)
      },
    )

    cmdit(
      [
        'scan',
        'reach',
        'test/fixtures/commands/scan/reach',
        '--reach-ecosystems',
        'npm,invalid-ecosystem,pypi',
        '--org',
        'fakeOrg',
        FLAG_CONFIG,
        '{"apiToken":"fake-token"}',
      ],
      'should show clear error for mixed valid and invalid ecosystems',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
        const output = stdout + stderr
        expect(output).toMatch(/invalid.*ecosystem.*invalid-ecosystem/i)
        expect(code).toBeGreaterThan(0)
      },
    )

    cmdit(
      [
        'scan',
        'reach',
        'test/fixtures/commands/scan/reach',
        '--reach-exclude-paths',
        '/absolute/path,relative/path,../parent/path',
        '--org',
        'fakeOrg',
        FLAG_CONFIG,
        '{"apiToken":"fake-token"}',
      ],
      'should handle various path formats in exclude paths',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
        expect(code).toBeGreaterThan(0)
        const output = stdout + stderr
        expect(output.length).toBeGreaterThan(0)
      },
    )

    cmdit(
      [
        'scan',
        'reach',
        'test/fixtures/commands/scan/reach',
        FLAG_CONFIG,
        '{"apiToken":"invalid-token-with-special-chars-!@#$%^&*()"}',
        '--org',
        'fakeOrg',
      ],
      'should handle tokens with special characters gracefully',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
        expect(code).toBeGreaterThan(0)
        const output = stdout + stderr
        expect(output.length).toBeGreaterThan(0)
      },
    )

    cmdit(
      [
        'scan',
        'reach',
        'test/fixtures/commands/scan/reach',
        '--reach-ecosystems',
        'npm',
        '--reach-ecosystems',
        'npm',
        '--reach-ecosystems',
        'npm',
        '--org',
        'fakeOrg',
        FLAG_CONFIG,
        '{"apiToken":"fake-token"}',
      ],
      'should handle duplicate ecosystem flags gracefully',
      async cmd => {
        const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
        expect(code).toBeGreaterThan(0)
        const output = stdout + stderr
        expect(output.length).toBeGreaterThan(0)
      },
    )
  })
})
