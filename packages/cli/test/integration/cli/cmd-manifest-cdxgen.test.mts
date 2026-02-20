/**
 * Integration tests for `socket manifest cdxgen` and `socket cdxgen` commands.
 *
 * Tests the CycloneDX SBOM generation command that wraps @cyclonedx/cdxgen.
 * This command generates Software Bill of Materials for projects.
 *
 * Test Coverage:
 * - Help text display via --help flag
 * - Dry-run behavior (--dry-run flag)
 * - cdxgen alias routing (socket cdxgen)
 * - Unknown argument error handling
 * - Banner and exit code validation
 *
 * Related Files:
 * - src/commands/manifest/cmd-manifest-cdxgen.mts - cdxgen command implementation
 * - src/commands/manifest/run-cdxgen.mts - cdxgen spawning logic
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

describe('socket manifest cdxgen', async () => {
  cmdit(
    ['manifest', 'cdxgen', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      // cdxgen --help is passed through to cdxgen itself.
      // We check that the command runs and shows cdxgen help.
      expect(stdout).toContain('cdxgen')
      expect(code, 'help should exit with code 0').toBe(0)
    },
  )

  cmdit(
    ['manifest', 'cdxgen', FLAG_DRY_RUN, FLAG_CONFIG, '{}'],
    `should support ${FLAG_DRY_RUN}`,
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expectDryRunOutput(stdout)
      expect(code, 'dry-run should exit with code 0').toBe(0)
    },
  )

  cmdit(
    ['manifest', 'cdxgen', FLAG_DRY_RUN, '.', FLAG_CONFIG, '{}'],
    `should support ${FLAG_DRY_RUN} with path argument`,
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expectDryRunOutput(stdout)
      expect(code, 'dry-run should exit with code 0').toBe(0)
    },
  )

  cmdit(
    ['manifest', 'cdxgen', 'unknown-fake-arg', FLAG_CONFIG, '{}'],
    'should error on unknown arguments',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toContain('Unknown argument')
      expect(code, 'should exit with code 2 for invalid usage').toBe(2)
    },
  )
})

describe('socket cdxgen (alias)', async () => {
  cmdit(
    ['cdxgen', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should route to manifest cdxgen and support ${FLAG_HELP}`,
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toContain('cdxgen')
      expect(code, 'help should exit with code 0').toBe(0)
    },
  )

  cmdit(
    ['cdxgen', FLAG_DRY_RUN, FLAG_CONFIG, '{}'],
    `should route to manifest cdxgen and support ${FLAG_DRY_RUN}`,
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expectDryRunOutput(stdout)
      expect(code, 'dry-run should exit with code 0').toBe(0)
    },
  )
})
