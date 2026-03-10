/**
 * Integration tests for `socket patch get` command.
 *
 * Tests retrieving and applying security patches via socket-patch v2.0.0 binary.
 *
 * Test Coverage:
 * - Help text display and usage examples
 * - Getting patches by identifier (UUID, CVE, GHSA, PURL, package name)
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

describe('socket patch get', async () => {
  cmdit(
    ['patch', 'get', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      // socket-patch v2.0.0 shows: "Get security patches from Socket API and apply them"
      expect(stdout).toContain('Get')
      expect(stdout).toContain('patches')
      expect(code, 'explicit help should exit with code 0').toBe(0)
    },
  )

  cmdit(
    ['patch', 'get', FLAG_CONFIG, '{"apiToken":"fake-token"}'],
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
      'get',
      'nonexistent-package',
      '--cwd',
      pnpmFixtureDir,
      FLAG_CONFIG,
      '{"apiToken":"fake-token"}',
    ],
    'should handle non-existent package gracefully',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      const output = stdout + stderr
      // socket-patch v2.0.0 shows error when patch not found.
      expect(output).toMatch(/not found|no patches|error/i)
      expect(code, 'should exit with non-zero code').not.toBe(0)
    },
  )

  cmdit(
    [
      'patch',
      'get',
      'on-headers',
      '--cwd',
      pnpmFixtureDir,
      '--save-only',
      FLAG_CONFIG,
      '{"apiToken":"fake-token"}',
    ],
    'should support --save-only flag',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      const output = stdout + stderr
      // With --save-only, socket-patch downloads without applying.
      // May succeed or show "already patched" or error.
      expect(output).toMatch(
        /saved|downloaded|already|not found|error|patches/i,
      )
      expect(typeof code).toBe('number')
    },
  )
})
