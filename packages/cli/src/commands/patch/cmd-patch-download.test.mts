import { promises as fs } from 'node:fs'
import path from 'node:path'

import { afterEach, describe, expect } from 'vitest'

import { cmdit, spawnSocketCli, testPath } from '../../../test/utils.mts'
import { FLAG_CONFIG, FLAG_HELP } from '../../constants/cli.mts'
import { getBinCliPath } from '../../constants/paths.mts'

const binCliPath = getBinCliPath()

const fixtureBaseDir = path.join(testPath, 'fixtures/commands/patch')
const pnpmFixtureDir = path.join(fixtureBaseDir, 'pnpm')

async function cleanupNodeModules() {
  // Clean up node_modules from all package manager directories.
  Promise.all([
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

describe('socket patch download', async () => {
  afterEach(async () => {
    await cleanupNodeModules()
  })

  cmdit(
    ['patch', 'download', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toContain('Download patches')
      expect(stderr).toContain('`socket patch download`')
      expect(code, 'explicit help should exit with code 0').toBe(0)
    },
  )

  cmdit(
    ['patch', 'download', FLAG_CONFIG, '{"apiToken":"fake-token"}'],
    'should show error when no UUIDs or --scan provided',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: pnpmFixtureDir,
      })
      const output = stdout + stderr
      expect(output).toContain('Must provide patch UUIDs or use --scan flag')
      expect(code, 'should exit with non-zero code').not.toBe(0)
    },
  )

  cmdit(
    [
      'patch',
      'download',
      'abc123-def456-789',
      FLAG_CONFIG,
      '{"apiToken":"fake-token"}',
    ],
    'should accept UUID argument',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: pnpmFixtureDir,
      })
      const output = stdout + stderr
      // Should not complain about missing UUIDs.
      expect(output).not.toContain('Must provide patch UUIDs')
      expect(code, 'should accept UUID argument').toBeDefined()
    },
  )

  cmdit(
    [
      'patch',
      'download',
      'abc123-def456-789',
      'xyz789-abc123-456',
      FLAG_CONFIG,
      '{"apiToken":"fake-token"}',
    ],
    'should accept multiple UUID arguments',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: pnpmFixtureDir,
      })
      const output = stdout + stderr
      // Should accept multiple UUIDs.
      expect(output).not.toContain('Must provide patch UUIDs')
      expect(code, 'should accept multiple UUIDs').toBeDefined()
    },
  )

  cmdit(
    [
      'patch',
      'download',
      '--scan',
      'test-scan-id',
      FLAG_CONFIG,
      '{"apiToken":"fake-token"}',
    ],
    'should accept --scan flag',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: pnpmFixtureDir,
      })
      const output = stdout + stderr
      // Should not complain about missing UUIDs when using --scan.
      expect(output).not.toContain('Must provide patch UUIDs')
      expect(code, 'should accept --scan flag').toBeDefined()
    },
  )

  cmdit(
    [
      'patch',
      'download',
      '-s',
      'test-scan-id',
      FLAG_CONFIG,
      '{"apiToken":"fake-token"}',
    ],
    'should support -s short flag for --scan',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: pnpmFixtureDir,
      })
      const output = stdout + stderr
      // Should accept -s as alias for --scan.
      expect(output).not.toContain('Unknown flag')
      expect(code, 'should accept -s flag').toBeDefined()
    },
  )

  cmdit(
    [
      'patch',
      'download',
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
      'download',
      'abc123-def456-789',
      '--json',
      '--markdown',
      FLAG_CONFIG,
      '{"apiToken":"fake-token"}',
    ],
    'should reject both --json and --markdown flags',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: pnpmFixtureDir,
      })
      const output = stdout + stderr
      expect(output).toContain('json and markdown flags cannot be both set')
      expect(code, 'should exit with non-zero code').not.toBe(0)
    },
  )

  cmdit(
    [
      'patch',
      'download',
      'abc123-def456-789',
      '--json',
      FLAG_CONFIG,
      '{"apiToken":"fake-token"}',
    ],
    'should support --json output format',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: pnpmFixtureDir,
      })
      const output = stdout + stderr
      // Should accept --json flag without error.
      expect(output).not.toContain('Unknown flag')
      expect(code, 'should accept --json flag').toBeDefined()
    },
  )

  cmdit(
    [
      'patch',
      'download',
      'abc123-def456-789',
      '--markdown',
      FLAG_CONFIG,
      '{"apiToken":"fake-token"}',
    ],
    'should support --markdown output format',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd, {
        cwd: pnpmFixtureDir,
      })
      const output = stdout + stderr
      // Should accept --markdown flag without error.
      expect(output).not.toContain('Unknown flag')
      expect(code, 'should accept --markdown flag').toBeDefined()
    },
  )

  cmdit(
    [
      'patch',
      'download',
      pnpmFixtureDir,
      'abc123-def456-789',
      FLAG_CONFIG,
      '{"apiToken":"fake-token"}',
    ],
    'should accept custom directory path as first argument',
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      const output = stdout + stderr
      // Should accept path as first argument followed by UUIDs.
      expect(output).not.toContain('Unexpected argument')
      expect(code, 'should accept path and UUID arguments').toBeDefined()
    },
  )
})
