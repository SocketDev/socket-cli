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
  await Promise.all([
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

describe('socket patch info', async () => {
  afterEach(async () => {
    await cleanupNodeModules()
  })

  cmdit(
    ['patch', 'info', FLAG_HELP, FLAG_CONFIG, '{}'],
    `should support ${FLAG_HELP}`,
    async cmd => {
      const { code, stderr, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toContain(
        'Show detailed information about a specific patch',
      )
      expect(stderr).toContain('`socket patch info`')
      expect(code, 'explicit help should exit with code 0').toBe(0)
    },
  )

  cmdit(
    ['patch', 'info', FLAG_CONFIG, '{"apiToken":"fake-token"}'],
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
      'info',
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
      'info',
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
      'info',
      'pkg:npm/on-headers@1.0.2',
      pnpmFixtureDir,
      FLAG_CONFIG,
      '{"apiToken":"fake-token"}',
    ],
    'should show patch information',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toContain('pkg:npm/on-headers@1.0.2')
      expect(stdout).toContain('index.js')
      expect(stdout).toContain('GHSA-76c9-3jph-rj3q')
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'patch',
      'info',
      'pkg:npm/on-headers@1.0.2',
      pnpmFixtureDir,
      '--json',
      FLAG_CONFIG,
      '{"apiToken":"fake-token"}',
    ],
    'should output patch info in JSON format',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      const json = JSON.parse(stdout)
      expect(json.purl).toBe('pkg:npm/on-headers@1.0.2')
      expect(json.files).toBeDefined()
      expect(json.files['index.js']).toBeDefined()
      expect(json.vulnerabilities).toBeDefined()
      expect(json.vulnerabilities['GHSA-76c9-3jph-rj3q']).toBeDefined()
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'patch',
      'info',
      'pkg:npm/on-headers@1.0.2',
      pnpmFixtureDir,
      '--markdown',
      FLAG_CONFIG,
      '{"apiToken":"fake-token"}',
    ],
    'should output patch info in markdown format',
    async cmd => {
      const { code, stdout } = await spawnSocketCli(binCliPath, cmd)
      expect(stdout).toContain('## Patch Information')
      expect(stdout).toContain('**PURL**: pkg:npm/on-headers@1.0.2')
      expect(stdout).toContain('### Files')
      expect(stdout).toContain('### Vulnerabilities')
      expect(code, 'should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'patch',
      'info',
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
