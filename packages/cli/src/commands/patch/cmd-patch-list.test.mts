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

describe('socket patch list', async () => {
  afterEach(async () => {
    await cleanupNodeModules()
  })

  cmdit(
    ['patch', 'list', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toContain('List all applied patches')
      expect(stderr).toContain('`socket patch list`')
      expect(code, 'explicit help should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'patch',
      'list',
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
    ['patch', 'list', pnpmFixtureDir, FLAG_CONFIG, '{"apiToken":"fake-token"}'],
    'should list patches from manifest',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toContain('pkg:npm/on-headers@1.0.2')
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'patch',
      'list',
      pnpmFixtureDir,
      '--json',
      FLAG_CONFIG,
      '{"apiToken":"fake-token"}',
    ],
    'should output patches in JSON format',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      const json = JSON.parse(stdout)
      expect(json.patches).toBeDefined()
      expect(Array.isArray(json.patches)).toBe(true)
      expect(json.patches.length).toBeGreaterThan(0)
      expect(json.patches[0]?.purl).toBe('pkg:npm/on-headers@1.0.2')
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'patch',
      'list',
      pnpmFixtureDir,
      '--markdown',
      FLAG_CONFIG,
      '{"apiToken":"fake-token"}',
    ],
    'should output patches in markdown format',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toContain('## Patches')
      expect(stdout).toContain('### pkg:npm/on-headers@1.0.2')
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'patch',
      'list',
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
