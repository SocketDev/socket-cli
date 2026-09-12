/**
 * Integration tests for `socket yarn` wrapper command.
 *
 * Tests the Yarn package manager wrapper that adds Socket security scanning to
 * Yarn operations via Socket Firewall (sfw). Commands are forwarded to sfw
 * which provides security scanning before installation.
 *
 * Test Coverage: - Help text display and usage examples - Dry-run behavior
 * validation - Yarn install operations with scanning - Config flag variants -
 * Issue rules configuration.
 *
 * Security Features: - Pre-installation security scanning via Socket Firewall -
 * Malware detection integration - Workspace support.
 *
 * Related Files: - src/commands/yarn/cmd-yarn.mts - yarn command
 * implementation.
 *
 * - Src/yarn-cli.mts - yarn CLI entry point - src/util/dlx/resolve-binary.mjs -
 *   sfw resolution - test/integration/cli/cmd-yarn-malware.test.mts - Malware
 *   tests.
 */

import { describe, expect } from 'vitest'

import { YARN } from '@socketsecurity/lib-stable/constants/package-managers'

import {
  FLAG_CONFIG,
  FLAG_DRY_RUN,
  FLAG_HELP,
  FLAG_QUIET,
} from '../../../src/constants/cli.mts'
import { getBinCliPath } from '../../../src/constants/paths.mts'
import { expectDryRunOutput } from '../../helpers/output-assertions.mts'
import { cmdit, spawnSocketCli } from '../../utils.mts'

const binCliPath = getBinCliPath()

describe('socket yarn', async () => {
  cmdit(
    [YARN, FLAG_DRY_RUN, FLAG_CONFIG, '{}', FLAG_HELP],
    `should forward ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expectDryRunOutput(stderr)
      expect(stderr).toContain('Arguments: yarn --help')
      expect(stdout).toBe('')
      expect(code, 'forwarded help should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [YARN, FLAG_DRY_RUN, FLAG_CONFIG, '{"apiToken":"fakeToken"}'],
    'should require args with just dry-run',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
        timeout: 30_000,
      })

      // Validate dry-run output to prevent flipped snapshots.
      expectDryRunOutput(stderr)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(stderr).toContain('CLI')
      expect(code, 'dry-run without args should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'yarn',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
      'add',
      'lodash',
    ],
    'should handle add with --dry-run flag',
    async cmd => {
      const { code } = await spawnSocketCli(binCliPath, cmd, {
        timeout: 30_000,
      })

      expect(code, 'dry-run add should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'yarn',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
      FLAG_QUIET,
      'dlx',
      'cowsay@^1.6.0',
      'hello',
    ],
    'should handle dlx with version',
    async cmd => {
      const { code } = await spawnSocketCli(binCliPath, cmd, {
        timeout: 30_000,
      })

      expect(code, 'dry-run dlx should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [YARN, FLAG_DRY_RUN, FLAG_CONFIG, '{"apiToken":"fakeToken"}', 'install'],
    'should handle install with --dry-run flag',
    async cmd => {
      const { code } = await spawnSocketCli(binCliPath, cmd, {
        timeout: 30_000,
      })

      expect(code, 'dry-run install should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'yarn',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken"}',
      'add',
      '@types/node@^20.0.0',
    ],
    'should handle scoped packages with version',
    async cmd => {
      const { code } = await spawnSocketCli(binCliPath, cmd, {
        timeout: 30_000,
      })

      expect(code, 'dry-run add scoped package should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'yarn',
      FLAG_DRY_RUN,
      '-c',
      '{"apiToken":"fakeToken","issueRules":{"malware":true}}',
      'exec',
      'cowsay@^1.6.0',
      'hello',
    ],
    'should handle exec with -c flag and issueRules for malware',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
        timeout: 30_000,
      })

      // Validate dry-run output to prevent flipped snapshots.
      expectDryRunOutput(stderr)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(code, 'dry-run exec with -c should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'yarn',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken","issueRules":{"malware":true}}',
      'exec',
      'cowsay@^1.6.0',
      'hello',
    ],
    'should handle exec with --config flag and issueRules for malware',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
        timeout: 30_000,
      })

      // Validate dry-run output to prevent flipped snapshots.
      expectDryRunOutput(stderr)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(code, 'dry-run exec with --config should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'yarn',
      FLAG_DRY_RUN,
      '-c',
      '{"apiToken":"fakeToken","issueRules":{"malware":true,"gptMalware":true}}',
      'exec',
      'cowsay@^1.6.0',
      'hello',
    ],
    'should handle exec with -c flag and multiple issueRules (malware and gptMalware)',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
        timeout: 30_000,
      })

      // Validate dry-run output to prevent flipped snapshots.
      expectDryRunOutput(stderr)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(
        code,
        'dry-run exec with multiple issueRules should exit with code 0',
      ).toBe(0)
    },
  )

  cmdit(
    [
      'yarn',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{"apiToken":"fakeToken","issueRules":{"malware":true,"gptMalware":true}}',
      'exec',
      'cowsay@^1.6.0',
      'hello',
    ],
    'should handle exec with --config flag and multiple issueRules (malware and gptMalware)',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
        timeout: 30_000,
      })

      // Validate dry-run output to prevent flipped snapshots.
      expectDryRunOutput(stderr)
      expect(stdout).toMatchInlineSnapshot(`""`)
      expect(
        code,
        'dry-run exec with --config and multiple issueRules should exit with code 0',
      ).toBe(0)
    },
  )
})
