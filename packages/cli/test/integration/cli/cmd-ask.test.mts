/**
 * Integration tests for `socket ask` command.
 *
 * Tests the natural language query command that translates plain English
 * questions into Socket CLI commands.
 *
 * Test Coverage:
 * - Help text display and usage examples
 * - Dry-run behavior (--dry-run flag)
 * - Query processing and command translation
 * - Error handling for missing query
 * - Banner and exit code validation
 *
 * Related Files:
 * - src/commands/ask/cmd-ask.mts - ask command implementation
 * - src/commands/ask/handle-ask.mts - NLP query parsing
 * - src/commands/ask/output-ask.mts - Output formatting
 */

import { describe, expect } from 'vitest'

import {
  FLAG_CONFIG,
  FLAG_DRY_RUN,
  FLAG_HELP,
} from '../../../src/constants/cli.mts'
import { getBinCliPath } from '../../../src/constants/paths.mts'
import { expectDryRunOutput } from '../../helpers/output-assertions.mts'
import { cmdit, spawnSocketCli } from '../../utils.mts'

const binCliPath = getBinCliPath()

describe('socket ask', async () => {
  cmdit(
    ['ask', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toContain('Ask in plain English')
      expect(stdout).toContain('Usage')
      expect(stdout).toContain('<question>')
      expect(stdout).toContain('--execute')
      expect(stdout).toContain('--explain')
      expect(stdout).toContain('Examples')
      expect(stdout).toContain('scan for vulnerabilities')
      expect(code, 'explicit help should exit with code 0').toBe(0)
    },
  )

  cmdit(
    ['ask', FLAG_DRY_RUN, FLAG_CONFIG, '{}'],
    `should support ${FLAG_DRY_RUN}`,
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expectDryRunOutput(stdout)
      expect(code, 'dry-run should exit with code 0').toBe(0)
    },
  )

  cmdit(
    ['ask', FLAG_CONFIG, '{}'],
    'should error when no query provided',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toContain('requires a QUERY positional argument')
      expect(code, 'should exit with non-zero code').not.toBe(0)
    },
  )

  cmdit(
    ['ask', 'scan for vulnerabilities', FLAG_CONFIG, '{}'],
    'should process natural language query',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      // Should show query interpretation.
      expect(stdout).toContain('You asked')
      expect(stdout).toContain('scan for vulnerabilities')
      // Should show interpreted command.
      expect(stdout).toContain('Command')
      expect(stdout).toContain('socket')
      // Should show tip about execute flag.
      expect(stdout).toContain('--execute')
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    ['ask', 'fix critical issues', FLAG_CONFIG, '{}'],
    'should interpret fix command with severity',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toContain('You asked')
      expect(stdout).toContain('fix critical issues')
      expect(stdout).toContain('Command')
      expect(code, 'should exit with code 0').toBe(0)
    },
  )
})
