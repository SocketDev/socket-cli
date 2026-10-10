/**
 * Integration tests for `socket patch remove` command.
 *
 * Tests patch removal, including the in-process skip-rollback operation.
 *
 * The default remove path delegates rollback to socket-patch. The local
 * `--skip-rollback` path removes only the manifest record.
 *
 * Test Coverage: - Help text display and usage examples - Removing patches by
 * PURL or UUID - Error handling for missing identifiers.
 *
 * Related Files: - src/command/patch/cmd-patch.mts - Root command that
 * dispatches local operations and forwards other operations to socket-patch.
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect } from 'vitest'

import { FLAG_CONFIG, FLAG_HELP } from '../../../src/constants/cli.mts'
import { getBinCliPath } from '../../../src/constants/paths.mts'
import { withTempFixture } from '../../helpers/test-fixtures.mts'
import { cmdit, spawnSocketCli, testPath } from '../../utils.mts'

const binCliPath = getBinCliPath()

const fixtureBaseDir = path.join(testPath, 'fixtures/commands/patch')
const pnpmFixtureDir = path.join(fixtureBaseDir, 'pnpm')

describe('socket patch remove', async () => {
  cmdit(
    ['patch', 'remove', FLAG_HELP, '--skip-rollback', FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      // socket-patch v2.0.0 shows: "Remove a patch from the manifest by PURL or UUID"
      expect(stdout).toContain('Remove')
      expect(code, 'explicit help should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'patch',
      'remove',
      '--skip-rollback',
      FLAG_CONFIG,
      '{"apiToken":"fake-token"}',
    ],
    'should show error when identifier is not provided',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: pnpmFixtureDir,
      })
      const output = stdout + stderr
      expect(output).toContain('A patch PURL or UUID is required')
      expect(code, 'missing identifier should exit with code 2').toBe(2)
    },
  )

  cmdit(
    [
      'patch',
      'remove',
      'pkg:npm/nonexistent@1.0.0',
      '--skip-rollback',
      '--cwd',
      pnpmFixtureDir,
      FLAG_CONFIG,
      '{"apiToken":"fake-token"}',
    ],
    'should handle non-existent patch gracefully',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain('No patch found for pkg:npm/nonexistent@1.0.0')
      expect(code, 'unknown patch should exit with code 1').toBe(1)
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
      // `patch remove --skip-rollback` edits .socket/manifest.json, so run
      // against a temporary copy to keep the committed fixture pristine.
      const { cleanup, tempDir } = await withTempFixture(pnpmFixtureDir)
      try {
        const isolatedCmd = cmd.map(arg =>
          arg === pnpmFixtureDir ? tempDir : arg,
        )
        const { code, stderr, stdout } = await spawnSocketCli(
          binCliPath,
          isolatedCmd,
        )
        const output = stdout + stderr
        const manifestPath = path.join(tempDir, '.socket', 'manifest.json')
        const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
          patches: Record<string, unknown>
        }

        expect(output).toContain('Removed 1 patch')
        expect(code).toBe(0)
        expect(manifest.patches['pkg:npm/on-headers@1.0.2']).toBeUndefined()
      } finally {
        await cleanup()
      }
    },
  )
})
