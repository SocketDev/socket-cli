/**
 * Integration tests for `socket patch rm` command.
 *
 * Tests removing specific patches from the project.
 *
 * Test Coverage:
 * - Help text display and usage examples
 * - Dry-run behavior validation
 * - Patch removal
 * - Dependency restoration
 *
 * Related Files:
 * - src/commands/patch/cmd-patch-rm.mts - Command definition
 * - src/commands/patch/handle-patch-rm.mts - Removal logic
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

import { afterEach, describe, expect } from 'vitest'

import { FLAG_CONFIG, FLAG_HELP } from '../../../src/constants/cli.mts'
import { getBinCliPath } from '../../../src/constants/paths.mts'
import { cmdit, spawnSocketCli, testPath } from '../../utils.mts'

const binCliPath = getBinCliPath()

const fixtureBaseDir = path.join(testPath, 'fixtures/commands/patch')
const pnpmFixtureDir = path.join(fixtureBaseDir, 'pnpm')

const originalManifest = {
  patches: {
    'pkg:npm/on-headers@1.0.2': {
      uuid: '00000000-0000-0000-0000-000000000000',
      exportedAt: '2025-09-10T20:10:19.407Z',
      files: {
        'index.js': {
          beforeHash:
            'c8327f00a843dbcfa6476286110d33bca8f0cc0e82bbe6f7d7171e0606e5dfe5',
          afterHash:
            '76682a9fc3bbe62975176e2541f39a8168877d828d5cad8b56461fc36ac2b856',
        },
      },
      vulnerabilities: {
        'GHSA-76c9-3jph-rj3q': {
          cves: ['CVE-2025-7339'],
          summary:
            'on-headers is vulnerable to http response header manipulation',
          severity: 'LOW',
          description:
            '### Impact\n\nA bug in on-headers versions `< 1.1.0` may result in response headers being inadvertently modified when an array is passed to `response.writeHead()`\n\n### Patches\n\nUsers should upgrade to `1.1.0`\n\n### Workarounds\n\nUses are encouraged to upgrade to `1.1.0`, but this issue can be worked around by passing an object to `response.writeHead()` rather than an array.',
          patchExplanation: '',
        },
      },
    },
  },
}

async function cleanupNodeModules() {
  // Clean up node_modules from all package manager directories.
  Promise.allSettled([
    fs.rm(path.join(pnpmFixtureDir, 'node_modules'), {
      force: true,
      recursive: true,
    }),
    fs.rm(path.join(fixtureBaseDir, 'npm/node_modules'), {
      force: true,
      recursive: true,
    }),
    fs.rm(path.join(fixtureBaseDir, 'yarn/node_modules'), {
      force: true,
      recursive: true,
    }),
  ])
}

async function restoreManifest() {
  // Restore the manifest.json fixture to its original state.
  const manifestPath = path.join(pnpmFixtureDir, '.socket/manifest.json')
  await fs.writeFile(manifestPath, JSON.stringify(originalManifest, null, 2))
}

describe('socket patch rm', async () => {
  afterEach(async () => {
    await cleanupNodeModules()
    await restoreManifest()
  })

  cmdit(
    ['patch', 'rm', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toContain(
        'Remove applied patch and restore original files',
      )
      expect(stderr).toContain('`socket patch rm`')
      expect(code, 'explicit help should exit with code 0').toBe(0)
    },
  )

  cmdit(
    ['patch', 'rm', FLAG_CONFIG, '{"apiToken":"fake-token"}'],
    'should show error when PURL is not provided',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: pnpmFixtureDir,
      })
      const output = stdout + stderr
      expect(output).toContain('PURL is required')
      expect(code, 'should exit with non-zero code').not.toBe(0)
    },
  )

  cmdit(
    [
      'patch',
      'rm',
      'pkg:npm/on-headers@1.0.2',
      path.join(fixtureBaseDir, 'nonexistent'),
      FLAG_CONFIG,
      '{"apiToken":"fake-token"}',
    ],
    'should show error when no .socket directory found',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain('No .socket directory found')
      expect(code, 'should exit with non-zero code').not.toBe(0)
    },
  )

  cmdit(
    [
      'patch',
      'rm',
      'pkg:npm/nonexistent@1.0.0',
      pnpmFixtureDir,
      FLAG_CONFIG,
      '{"apiToken":"fake-token"}',
    ],
    'should show error when patch not found',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain('Patch not found')
      expect(code, 'should exit with non-zero code').not.toBe(0)
    },
  )

  cmdit(
    [
      'patch',
      'rm',
      'pkg:npm/on-headers@1.0.2',
      pnpmFixtureDir,
      FLAG_CONFIG,
      '{"apiToken":"fake-token"}',
    ],
    'should handle removing patch without backups gracefully',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      // Since the fixture doesn't have actual backups, it should warn.
      expect(
        stdout.includes('No backups found') || stdout.includes('Removed patch'),
      ).toBe(true)
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'patch',
      'rm',
      'pkg:npm/on-headers@1.0.2',
      pnpmFixtureDir,
      '--json',
      FLAG_CONFIG,
      '{"apiToken":"fake-token"}',
    ],
    'should output patch rm result in JSON format',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      const json = JSON.parse(stdout)
      expect(json.ok).toBe(true)
      expect(json.data?.purl).toBe('pkg:npm/on-headers@1.0.2')
      expect(json.data?.filesRestored).toBeDefined()
      expect(typeof json.data.filesRestored).toBe('number')
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'patch',
      'rm',
      'pkg:npm/on-headers@1.0.2',
      pnpmFixtureDir,
      '--markdown',
      FLAG_CONFIG,
      '{"apiToken":"fake-token"}',
    ],
    'should output patch rm result in markdown format',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toContain('## Patch Removed')
      expect(stdout).toContain('**PURL**: pkg:npm/on-headers@1.0.2')
      expect(stdout).toContain('**Files Restored**')
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'patch',
      'rm',
      'pkg:npm/on-headers@1.0.2',
      pnpmFixtureDir,
      '--json',
      '--markdown',
      FLAG_CONFIG,
      '{"apiToken":"fake-token"}',
    ],
    'should fail when both json and markdown flags are used',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      const output = stdout + stderr
      expect(output).toContain('json and markdown flags cannot be both set')
      expect(code, 'should exit with non-zero code').not.toBe(0)
    },
  )
})
