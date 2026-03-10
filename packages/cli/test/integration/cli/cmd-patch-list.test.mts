/**
 * Integration tests for `socket patch list` command.
 *
 * Tests listing all patches in the local manifest via socket-patch v2.0.0 binary.
 *
 * Test Coverage:
 * - Help text display and usage examples
 * - Listing patches from manifest
 * - JSON output format
 *
 * Related Files:
 * - src/commands/patch/cmd-patch.mts - Root command that forwards to socket-patch
 */

import path from 'node:path'

import { describe, expect } from 'vitest'

import { FLAG_CONFIG, FLAG_HELP } from '../../../src/constants/cli.mts'
import { getBinCliPath } from '../../../src/constants/paths.mts'
import { cmdit, spawnSocketCli, testPath } from '../../utils.mts'

const binCliPath = getBinCliPath()

const fixtureBaseDir = path.join(testPath, 'fixtures/commands/patch')
const pnpmFixtureDir = path.join(fixtureBaseDir, 'pnpm')

describe('socket patch list', async () => {
  cmdit(
    ['patch', 'list', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      // socket-patch v2.0.0 shows: "List all patches in the local manifest"
      expect(stdout).toContain('List')
      expect(stdout).toContain('manifest')
      expect(code, 'explicit help should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'patch',
      'list',
      '--cwd',
      path.join(fixtureBaseDir, 'nonexistent'),
      FLAG_CONFIG,
      '{"apiToken":"fake-token"}',
    ],
    'should handle missing manifest gracefully',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      const output = stdout + stderr
      // socket-patch v2.0.0 shows error when no manifest found.
      expect(output).toMatch(/No .socket|manifest|not found/i)
      expect(code, 'should exit with non-zero code').not.toBe(0)
    },
  )

  cmdit(
    [
      'patch',
      'list',
      '--cwd',
      pnpmFixtureDir,
      FLAG_CONFIG,
      '{"apiToken":"fake-token"}',
    ],
    'should list patches from manifest',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      // Fixture has a manifest with on-headers patch.
      expect(stdout).toContain('on-headers')
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'patch',
      'list',
      '--cwd',
      pnpmFixtureDir,
      '--json',
      FLAG_CONFIG,
      '{"apiToken":"fake-token"}',
    ],
    'should output patches in JSON format',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      // socket-patch v2.0.0 outputs JSON when --json flag is used.
      // Verify it's valid JSON.
      let parsed: unknown
      try {
        parsed = JSON.parse(stdout)
      } catch {
        // If not valid JSON, the test should fail.
        expect.fail(`Expected valid JSON output, got: ${stdout.slice(0, 200)}`)
      }
      expect(parsed).toBeDefined()
      expect(code, 'should exit with code 0').toBe(0)
    },
  )
})
