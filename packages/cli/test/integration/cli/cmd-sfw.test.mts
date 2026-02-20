/**
 * Integration tests for `socket sfw` and `socket firewall` commands.
 *
 * Tests the Socket Firewall (sfw) command that provides direct access to
 * the Socket Firewall tool for intercepting package manager commands.
 *
 * Test Coverage:
 * - Help text display and usage examples
 * - Dry-run behavior (--dry-run flag)
 * - Firewall alias routing
 * - Error handling for missing package manager
 * - Banner and exit code validation
 *
 * Related Files:
 * - src/commands/sfw/cmd-sfw.mts - sfw command implementation
 * - src/utils/dlx/spawn.mts - DLX spawning for sfw
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

describe('socket sfw', async () => {
  cmdit(
    ['sfw', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toContain('Run Socket Firewall directly')
      expect(stdout).toContain('Usage')
      expect(stdout).toContain('<package-manager>')
      expect(stdout).toContain('Supported Package Managers')
      expect(stdout).toContain('npm, npx, pnpm, yarn, pip')
      expect(code, 'explicit help should exit with code 0').toBe(0)
    },
  )

  cmdit(
    ['sfw', FLAG_DRY_RUN, FLAG_CONFIG, '{}'],
    `should support ${FLAG_DRY_RUN} without package manager`,
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expectDryRunOutput(stdout)
      expect(code, 'dry-run should exit with code 0').toBe(0)
    },
  )

  cmdit(
    ['sfw', FLAG_DRY_RUN, 'npm', 'install', 'lodash', FLAG_CONFIG, '{}'],
    `should support ${FLAG_DRY_RUN} with npm command`,
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expectDryRunOutput(stdout)
      expect(code, 'dry-run should exit with code 0').toBe(0)
    },
  )

  cmdit(
    ['sfw', FLAG_CONFIG, '{}'],
    'should error when no package manager specified',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toContain('No package manager command specified')
      expect(code, 'should exit with code 2').toBe(2)
    },
  )
})

describe('socket firewall (alias)', async () => {
  cmdit(
    ['firewall', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should route to sfw and support ${FLAG_HELP}`,
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toContain('Run Socket Firewall directly')
      expect(stdout).toContain('alias: firewall')
      expect(code, 'explicit help should exit with code 0').toBe(0)
    },
  )

  cmdit(
    ['firewall', FLAG_DRY_RUN, FLAG_CONFIG, '{}'],
    `should route to sfw and support ${FLAG_DRY_RUN}`,
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expectDryRunOutput(stdout)
      expect(code, 'dry-run should exit with code 0').toBe(0)
    },
  )

  cmdit(
    ['firewall', FLAG_CONFIG, '{}'],
    'should error when no package manager specified (via alias)',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toContain('No package manager command specified')
      expect(code, 'should exit with code 2').toBe(2)
    },
  )
})
