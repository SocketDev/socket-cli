/**
 * Integration tests for `socket pycli` command.
 *
 * Tests the Python CLI (socketsecurity) passthrough command that provides
 * explicit access to Python CLI features not yet available in the Node.js CLI.
 *
 * Test Coverage:
 * - Help text display and usage examples
 * - Dry-run behavior (--dry-run flag)
 * - Python CLI features documentation
 * - Banner and exit code validation
 *
 * Related Files:
 * - src/commands/pycli/cmd-pycli.mts - pycli command implementation
 * - src/utils/python/standalone.mts - Python CLI spawning
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

describe('socket pycli', async () => {
  cmdit(
    ['pycli', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toContain('Run Socket Python CLI')
      expect(stdout).toContain('socketsecurity')
      expect(stdout).toContain('Usage')
      expect(stdout).toContain('Python CLI Features')
      expect(stdout).toContain('--generate-license')
      expect(stdout).toContain('--enable-sarif')
      expect(stdout).toContain('--strict-blocking')
      expect(code, 'explicit help should exit with code 0').toBe(0)
    },
  )

  cmdit(
    ['pycli', FLAG_DRY_RUN, FLAG_CONFIG, '{}'],
    `should support ${FLAG_DRY_RUN}`,
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expectDryRunOutput(stdout)
      expect(code, 'dry-run should exit with code 0').toBe(0)
    },
  )

  cmdit(
    ['pycli', FLAG_DRY_RUN, '--generate-license', FLAG_CONFIG, '{}'],
    `should support ${FLAG_DRY_RUN} with Python CLI flags`,
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expectDryRunOutput(stdout)
      expect(code, 'dry-run should exit with code 0').toBe(0)
    },
  )
})
