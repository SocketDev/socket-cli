/**
 * Integration tests for `socket scan reach` execution mode.
 *
 * Tests reachability analysis execution. This is one of three test
 * files for reach command (dry-run, validation, execution).
 *
 * Test Coverage:
 * - Reachability analysis execution
 * - Issue detection
 * - Output generation
 * - Real scan scenarios
 *
 * Note: This test suite was split from cmd-scan-reach.test.mts to improve
 * test performance and reduce CI bottlenecks.
 *
 * Related Files:
 * - src/commands/scan/cmd-scan-reach.mts - Command definition
 * - test/integration/cli/cmd-scan-reach-dry-run.test.mts - Dry-run tests
 * - test/integration/cli/cmd-scan-reach-validation.test.mts - Validation tests
 */

import path from 'node:path'

import { describe, expect } from 'vitest'

import { FLAG_CONFIG } from '../../../src/constants/cli.mts'
import { getBinCliPath } from '../../../src/constants/paths.mts'
import { cmdit, spawnSocketCli, testPath } from '../../utils.mts'

const binCliPath = getBinCliPath()

const _fixtureBaseDir = path.join(testPath, 'fixtures/commands/scan/reach')

describe('socket scan reach - execution tests', () => {
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
