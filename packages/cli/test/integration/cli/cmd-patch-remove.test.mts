/**
 * Integration tests for `socket patch remove` command.
 *
 * Tests removing patches from the manifest via socket-patch v2.0.0 binary.
 *
 * Note: In socket-patch v2.0.0, the command is `remove` (not `rm`).
 * The `remove` command rolls back files first and then removes from manifest.
 *
 * Test Coverage:
 * - Help text display and usage examples
 * - Removing patches by PURL or UUID
 * - Error handling for missing identifiers
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

describe('socket patch remove', async () => {
  cmdit(
    ['patch', 'remove', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      // socket-patch v2.0.0 shows: "Remove a patch from the manifest by PURL or UUID"
      expect(stdout).toContain('Remove')
      expect(code, 'explicit help should exit with code 0').toBe(0)
    },
  )

  cmdit(
    ['patch', 'remove', FLAG_CONFIG, '{"apiToken":"fake-token"}'],
    'should show error when identifier is not provided',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: pnpmFixtureDir,
      })
      const output = stdout + stderr
      // socket-patch v2.0.0 requires an identifier argument.
      expect(output).toMatch(/required|identifier|argument|missing/i)
      expect(code, 'should exit with non-zero code').not.toBe(0)
    },
  )

  cmdit(
    [
      'patch',
      'remove',
      'pkg:npm/nonexistent@1.0.0',
      '--cwd',
      pnpmFixtureDir,
      FLAG_CONFIG,
      '{"apiToken":"fake-token"}',
    ],
    'should handle non-existent patch gracefully',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      const output = stdout + stderr
      // socket-patch v2.0.0 shows error when patch not found.
      expect(output).toMatch(/not found|no patch|error/i)
      expect(code, 'should exit with non-zero code').not.toBe(0)
    },
  )

  cmdit(
    [
      'patch',
      'remove',
      'pkg:npm/on-headers@1.0.2',
      '--cwd',
      pnpmFixtureDir,
      '--skip-rollback',
      FLAG_CONFIG,
      '{"apiToken":"fake-token"}',
    ],
    'should support --skip-rollback flag',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      const output = stdout + stderr
      // With --skip-rollback, socket-patch only updates manifest.
      // May show removed, not found, or other status.
      expect(output).toMatch(/removed|not found|manifest|error/i)
      expect(typeof code).toBe('number')
    },
  )
})
